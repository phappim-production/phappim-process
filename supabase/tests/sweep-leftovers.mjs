// งานค้างจากตรวจบั๊ก: ใบแก้เลขครั้งเดิมจาก 2 แท็บ · วันที่ infinity · QC รายงานสาเหตุเฉพาะ QC + Packing
import { readFileSync } from 'node:fs'

export async function sweepLeftoverTests({ db, ok }) {
  const file = '20261204000000_sweep_leftovers.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = { admin: '00000000-0000-0000-0000-00000000cc01', qc: '00000000-0000-0000-0000-00000000cc02', prod: '00000000-0000-0000-0000-00000000cc03' }
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  const q = s => s.replace(/'/g, "''")
  const run = async (uid, sql) => {
    if (!uid) return db.query(sql)
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const attempt = async (uid, sql) => {
    await db.exec('savepoint sl')
    try { await run(uid, sql); await db.exec('release savepoint sl'); return null }
    catch (e) { await db.exec('rollback to savepoint sl; reset role'); return e.message.split('\n')[0] }
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint sl')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint sl; reset role') }
  }
  const pass = async (name, uid, sql, keep = false) => { const err = keep ? await attempt(uid, sql) : await tryOnly(uid, sql); ok(name, !err, err ?? '') }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','sl-admin@test'),('${U.qc}','sl-qc@test'),('${U.prod}','sl-prod@test');
      insert into public.profiles (user_id,name,role,active) values
        ('${U.admin}','แอดมิน งานค้าง','admin',true),('${U.qc}','QC งานค้าง','qc',true),('${U.prod}','ฝ่ายผลิต งานค้าง','production',true);
    `)
    const spec = (rev, note, top = {}) => ({ app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'SC-SL-1', customer: 'ลูกค้างานค้าง', rev }, p: { tshirt: { note } }, ...top })
    const job = await val(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, spare_qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status, needs_sample, spec)
      values ('SC-SL-1','ลูกค้างานค้าง','เสื้อทีม','tshirt',100,0,'ตัว','2026-12-20','cut_only','x.pdf','production',1,'queued',false,$1::jsonb)
      returning id`, [JSON.stringify(spec('', 'รับงาน'))])

    await reject('กำหนดส่งเป็น infinity (เรียก API ตรง) ถูกปฏิเสธ', null, `update public.jobs set due_date = 'infinity' where id = '${job}'`, /วันที่ไม่ถูกต้อง \(infinity\)/)
    await reject('วันคาดว่าได้รับฟิล์มเป็น -infinity ถูกปฏิเสธ', null, `update public.jobs set dtf_film_eta = '-infinity' where id = '${job}'`, /วันที่ไม่ถูกต้อง/)
    await reject('วันที่ก่อนคริสตกาล (BC) ถูกปฏิเสธ', null, `update public.jobs set due_date = '2026-12-20 BC' where id = '${job}'`, /วันที่ไม่ถูกต้อง/)
    await pass('วันที่ปกติยังบันทึกได้ · ล้างวันฟิล์มเป็นค่าว่างได้', null, `update public.jobs set due_date = '2026-12-21', dtf_film_eta = null where id = '${job}'`)
    await reject('ปี พ.ศ. ยังถูกปฏิเสธด้วยข้อความเดิม', null, `update public.jobs set due_date = '2569-12-20' where id = '${job}'`, /ปี 2569 ไม่ถูกต้อง/)

    const revise = (s, rev) => `public.revise_job_spec('${job}', '${q(JSON.stringify(s))}'::jsonb, ${rev}, 'ลูกค้างานค้าง', 'เสื้อทีม', 100, 0, '2026-12-20', false, array[]::text[])`
    const token = () => val(`select spec->>'rev_token' from public.jobs where id = $1`, [job])
    await pass('แท็บ B เปิดใบก่อนมีรหัส แล้วบันทึกใบแก้ครั้งที่ 1 ได้', U.admin, revise(spec(1, 'แท็บ B', { base_rev: 0, base_token: '' }), 1), true)
    const t1 = await token()
    ok('บันทึกใบแก้แล้วสเปกได้รหัสใหม่', typeof t1 === 'string' && t1.length > 10, String(t1))
    await pass('แท็บ B แก้ครั้งที่ 1 ซ้ำ (เลขครั้งเดิม) จากใบล่าสุดได้', U.admin, revise(spec(1, 'แท็บ B แก้ซ้ำ', { base_rev: 1, base_token: t1 }), 1), true)
    const t2 = await token()
    ok('บันทึกซ้ำเลขครั้งเดิมแล้วรหัสเปลี่ยน', t2 !== t1, `${t1} → ${t2}`)
    await reject('แท็บ A ที่เปิดใบครั้งที่ 1 ไว้ก่อน บันทึกครั้งที่ 1 ทับของแท็บ B ไม่ได้', U.admin,
      revise(spec(1, 'แท็บ A', { base_rev: 1, base_token: t1 }), 1), /มีคนบันทึกใบแก้ของงาน SC-SL-1 หลังจากเปิดใบนี้/)
    ok('สเปกยังเป็นของแท็บ B', await val(`select spec->'p'->'tshirt'->>'note' from public.jobs where id = $1`, [job]) === 'แท็บ B แก้ซ้ำ')
    await pass('ไฟล์ .json เก่าที่ไม่มีรหัส ยังบันทึกได้ตามกฎเลขครั้ง', U.admin, revise(spec(1, 'ไฟล์เก่า', { base_rev: 1 }), 1))
    await pass('ใบที่ไม่เปลี่ยนอะไรไม่ถือว่าแก้ (รหัสไม่นับเป็นช่องที่เปลี่ยน)', U.admin, revise(spec(1, 'แท็บ B แก้ซ้ำ', { base_rev: 1, base_token: t2 }), 1), true)
    ok('ใบที่ไม่เปลี่ยนอะไรรหัสคงเดิม', await token() === t2)
    const stored = await val(`select spec from public.jobs where id = $1`, [job])
    ok('ไม่เก็บ base_token ของฟอร์มในสเปก', !('base_token' in stored), JSON.stringify(stored))

    const [code] = (await db.query('select code from public.reason_codes where active order by code limit 1')).rows
    const report = `public.submit_delay_report('${job}', array['${code.code}'], 'ผ้ามาช้า', now() + interval '2 days')`
    await reject('QC รายงานสาเหตุของงานที่ยังอยู่สถานีตัดไม่ได้', U.qc, report, /ฝ่าย QC รายงานสาเหตุได้เฉพาะงานที่อยู่สถานี QC \+ Packing/)
    await pass('ฝ่ายผลิตรายงานสาเหตุของงานที่สถานีตัดได้', U.prod, report)
    await db.query(`update public.jobs set station_seq = 2, station_status = 'doing', station_started_at = now() where id = $1`, [job])
    await pass('QC รายงานสาเหตุของงานที่อยู่สถานี QC + Packing ได้', U.qc, report)
  } finally {
    await db.exec('rollback')
  }
}
