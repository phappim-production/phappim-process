// รอบตรวจบั๊กทั้งระบบ: ปี ค.ศ. เฉพาะช่องที่เปลี่ยน · ใบแก้จากฟอร์มเก่าทับใบใหม่ไม่ได้ · รับทราบม็อคอัพตามเฟส
import { readFileSync } from 'node:fs'

export async function bugSweepTests({ db, ok }) {
  // sweep-fixes.mjs รัน 20261128000000 ซ้ำ ทับ revise_job_spec ด้วยฉบับเก่า
  try { await db.exec(readFileSync(new URL('../migrations/20261202000000_bug_sweep.sql', import.meta.url), 'utf8')); ok('รันซ้ำบนฐานที่ลงแล้วได้: 20261202000000_bug_sweep.sql', true) }
  catch (e) { ok('รันซ้ำบนฐานที่ลงแล้วได้: 20261202000000_bug_sweep.sql', false, e.message.split('\n')[0]) }
  const U = {
    admin: '00000000-0000-0000-0000-00000000bb01', sup1: '00000000-0000-0000-0000-00000000bb02',
    sup2: '00000000-0000-0000-0000-00000000bb03', prod: '00000000-0000-0000-0000-00000000bb04',
  }
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  const q = s => s.replace(/'/g, "''")
  // บทบาทตั้งใน savepoint · ถูกปฏิเสธแล้ว rollback คืนบทบาทเดิมไปด้วย (reset role ในธุรกรรมที่ล้มทำไม่ได้)
  const run = async (uid, sql) => {
    if (!uid) return db.query(sql)
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const attempt = async (uid, sql) => {
    await db.exec('savepoint bs')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint bs; reset role') }
  }
  const pass = async (name, uid, sql) => { const err = await attempt(uid, sql); ok(name, !err, err ?? '') }
  const reject = async (name, uid, sql, re) => { const err = await attempt(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','bs-admin@test'),('${U.sup1}','bs-sup1@test'),('${U.sup2}','bs-sup2@test'),('${U.prod}','bs-prod@test');
      insert into public.profiles (user_id,name,role,active,section) values
        ('${U.admin}','แอดมิน ตรวจบั๊ก','admin',true,null),('${U.sup1}','คุมเฟส 1 ตรวจบั๊ก','supervisor',true,1),
        ('${U.sup2}','คุมเฟส 2 ตรวจบั๊ก','supervisor',true,2),('${U.prod}','ฝ่ายผลิต ตรวจบั๊ก','production',true,null);
    `)
    const spec = (rev, extra = {}) => ({ app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'SC-BS-1', customer: 'ลูกค้าตรวจบั๊ก', rev, ...extra.h }, p: { tshirt: { note: extra.note ?? 'เดิม' } }, ...extra.top })
    const job = await val(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, spare_qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status, needs_sample, spec)
      values ('SC-BS-1','ลูกค้าตรวจบั๊ก','เสื้อทีม','tshirt',100,0,'ตัว','2026-12-20','normal','x.pdf','production',1,'queued',false,$1::jsonb)
      returning id`, [JSON.stringify(spec(''))])

    // ปีผิดที่ค้างในฐานก่อนมีการตรวจ ต้องไม่บล็อกการแก้ช่องอื่น
    await db.exec(`alter table public.jobs disable trigger jobs_ce_year`)
    await db.query(`update public.jobs set due_date = '2569-12-20' where id = $1`, [job])
    await db.exec(`alter table public.jobs enable trigger jobs_ce_year`)
    await pass('ปีผิดค้างอยู่ในกำหนดส่ง · บันทึกวันคาดว่าได้รับฟิล์ม (ปีถูก) ได้', null,
      `update public.jobs set dtf_film_eta = '2026-12-10' where id = '${job}'`)
    await reject('ปีผิดค้างอยู่ · แก้วันฟิล์มเป็นปี พ.ศ. ยังถูกปฏิเสธ', null,
      `update public.jobs set dtf_film_eta = '2569-12-10' where id = '${job}'`, /ปี 2569 ไม่ถูกต้อง/)
    await db.query(`update public.jobs set due_date = '2026-12-20' where id = $1`, [job])

    const revise = (s, rev) => `public.revise_job_spec('${job}', '${q(JSON.stringify(s))}'::jsonb, ${rev}, 'ลูกค้าตรวจบั๊ก', 'เสื้อทีม', 100, 0, '2026-12-20', false, array[]::text[])`
    await db.exec('savepoint flow')
    await run(U.admin, revise(spec(1, { note: 'แท็บ B', top: { base_rev: 0 } }), 1))
    await reject('แท็บที่เปิดใบตอนครั้งที่ 0 บันทึกทับใบแก้ครั้งที่ 1 ของคนอื่นไม่ได้', U.admin,
      revise(spec(1, { note: 'แท็บ A', top: { base_rev: 0 } }), 1), /มีการบันทึกใบแก้ไขครั้งที่ 1 ของงาน SC-BS-1 หลังจากเปิดใบนี้/)
    ok('สเปกยังเป็นของแท็บ B', await val(`select spec->'p'->'tshirt'->>'note' from public.jobs where id = $1`, [job]) === 'แท็บ B')
    await pass('เปิดใบล่าสุด (ครั้งที่ 1) แล้วแก้เป็นครั้งที่ 2 ได้', U.admin, revise(spec(2, { note: 'แท็บ A ใหม่', top: { base_rev: 1 } }), 2))
    await pass('ใบที่ไม่ได้ส่งเลขครั้งตอนเปิด (ไฟล์ .json เก่า) ยังบันทึกได้ตามกฎเดิม', U.admin, revise(spec(1, { note: 'ไฟล์เก่า' }), 1))
    await run(U.admin, revise(spec(2, { note: 'เก็บ', top: { base_rev: 1, sent_sig: 'abc', sys: { h: {}, p: {} } } }), 2))
    const stored = await val(`select spec from public.jobs where id = $1`, [job])
    ok('ไม่เก็บค่าชั่วคราวของฟอร์ม (base_rev / sent_sig / sys) ในสเปก', !('base_rev' in stored) && !('sent_sig' in stored) && !('sys' in stored), JSON.stringify(stored))
    await db.exec('rollback to savepoint flow')

    const sheet = await val(`insert into public.mockup_sheets (job_id, rev, status) values ($1, 1, 'approved') returning id`, [job])
    await pass('ผู้ควบคุมเฟส 1 รับทราบม็อคอัพที่สถานีพิมพ์ (เฟส 1)', U.sup1, `public.ack_mockup_sheet('${sheet}', 'print')`)
    await reject('ผู้ควบคุมเฟส 1 รับทราบแทนสถานีเย็บ (เฟส 2) ไม่ได้', U.sup1, `public.ack_mockup_sheet('${sheet}', 'sew')`, /ให้ผู้ควบคุมงานเฟส 2/)
    await pass('ผู้ควบคุมเฟส 2 รับทราบที่สถานีเย็บได้', U.sup2, `public.ack_mockup_sheet('${sheet}', 'sew')`)
    await pass('ฝ่ายผลิตรับทราบได้ทุกสถานี', U.prod, `public.ack_mockup_sheet('${sheet}', 'sew')`)
    await db.query(`update public.jobs set phase = 'cancelled', station_seq = null, station_status = null where id = $1`, [job])
    await reject('งานที่ยกเลิกแล้วรับทราบม็อคอัพไม่ได้', U.prod, `public.ack_mockup_sheet('${sheet}', 'print')`, /ถูกยกเลิกแล้ว/)
  } finally {
    await db.exec('rollback')
  }
}
