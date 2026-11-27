// ลายเซ็นลูกค้า: แอดมินแนบรูปที่ตัดจากใบที่ลูกค้าเซ็น · เก็บทั้งครอบครัวงานแบ่ง · ทุกบทบาทอ่านได้ · ผูกกับใบแก้ครั้งที่เซ็น
import { readFileSync } from 'node:fs'

export async function customerSignatureTests({ db, ok }) {
  const file = '20261212000000_customer_signature.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split(String.fromCharCode(10))[0]) }
  const U = {
    admin: '00000000-0000-0000-0000-00000000c501', prod: '00000000-0000-0000-0000-00000000c502',
    mgr: '00000000-0000-0000-0000-00000000c503', staff: '00000000-0000-0000-0000-00000000c504',
    off: '00000000-0000-0000-0000-00000000c505',
  }
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint cs')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint cs; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint cs')
    try { const r = await run(uid, sql); await db.exec('release savepoint cs'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint cs; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { await keep(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const receive = no => keep(U.admin, `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้าเซ็น', p_job_name => 'เสื้อทีม',
    p_product_type_code => 'tshirt', p_qty => 120, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => 'normal',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false)::text`)
  const sign = (job, path, on = 'current_date') => `public.set_customer_signature('${job}', ${path === null ? 'null' : `'${path}'`}, ${on})`

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','cs-admin@test'),('${U.prod}','cs-prod@test'),('${U.mgr}','cs-mgr@test'),('${U.staff}','cs-staff@test'),('${U.off}','cs-off@test');
      insert into public.profiles (user_id,name,role,active) values
        ('${U.admin}','แอดมิน ลายเซ็น','admin',true),('${U.prod}','ฝ่ายผลิต ลายเซ็น','production',true),
        ('${U.mgr}','ผู้บริหาร ลายเซ็น','manager',true),('${U.staff}','พนักงาน ลายเซ็น','staff',true),('${U.off}','บัญชีปิด ลายเซ็น','admin',false);
      insert into public.staff_stations (user_id, station_code) values ('${U.staff}','print');
      update public.production_settings set materials_check = false;
      insert into private.file_settings (record_secret) values (repeat('s', 32)) on conflict do nothing;
    `)
    const a = await receive('SC-CS-A')
    const folder = await val(`select private.mockup_folder('SC-CS-A')`)
    const path = `${folder}/sig1a2b3c.png`, path2 = `${folder}/sig4d5e6f.png`
    ok('งานใหม่ยังไม่มีลายเซ็นลูกค้า', (await keep(U.prod, `public.job_customer_signature('${a}')`)) === null)

    await reject('รูปที่ยังอัปโหลดไม่สำเร็จ แนบเป็นลายเซ็นไม่ได้', U.admin, sign(a, path), /ยังไม่พบรูป/)
    await db.query(`insert into private.file_objects (kind, path, size, content_type) values ('mockups', $1, 10, 'image/png'), ('mockups', $2, 10, 'image/png'), ('mockups', 'SC-OTHER/sig9.png', 10, 'image/png')`, [path, path2])
    await reject('ฝ่ายผลิตแนบลายเซ็นลูกค้าไม่ได้', U.prod, sign(a, path), /บทบาทของคุณ \(production\)/)
    await reject('ผู้บริหารแนบลายเซ็นลูกค้าไม่ได้', U.mgr, sign(a, path), /บทบาทของคุณ \(manager\)/)
    await reject('บัญชีที่ปิดแล้วแนบไม่ได้', U.off, sign(a, path), /เข้าสู่ระบบ/)
    await reject('รูปจากโฟลเดอร์งานอื่นใช้เป็นลายเซ็นไม่ได้', U.admin, sign(a, 'SC-OTHER/sig9.png'), /ไม่ใช่ของงาน SC-CS-A/)
    await reject('ไฟล์ที่ไม่ใช่รูปใช้ไม่ได้', U.admin, sign(a, `${folder}/sig1.pdf`), /ไฟล์ภาพ/)
    await reject('ไม่ใส่วันที่ลูกค้าเซ็น ถูกปฏิเสธ', U.admin, sign(a, path, 'null'), /วันที่ลูกค้าเซ็น/)
    await reject('ใส่ปี พ.ศ. ลงช่องวันที่ ถูกปฏิเสธ', U.admin, sign(a, path, `'2569-11-27'`), /ปี ค.ศ./)
    await reject('วันที่ infinity ถูกปฏิเสธ', U.admin, sign(a, path, `'infinity'`), /วันที่ลูกค้าเซ็น/)
    await reject('วันที่ในอนาคตถูกปฏิเสธ', U.admin, sign(a, path, 'current_date + 3'), /อนาคต/)
    await pass('แอดมินแนบลายเซ็นลูกค้า', U.admin, sign(a, path, 'current_date - 1'))
    const s1 = await keep(U.staff, `public.job_customer_signature('${a}')`)
    ok('พนักงานสถานีอ่านลายเซ็นได้ (ผูกกับใบครั้งที่ 0)', s1?.path === path && s1?.rev === 0 && s1?.current_rev === 0, JSON.stringify(s1))
    await reject('บัญชีที่ปิดแล้วอ่านลายเซ็นไม่ได้', U.off, `public.job_customer_signature('${a}')`, /เข้าสู่ระบบ/)
    const readable = await keep(U.staff, `public.file_read_allowed('mockups', array['${path}'])`)
    ok('พนักงานสถานีขอลิงก์รูปลายเซ็นได้', JSON.stringify(readable) === JSON.stringify([path]), JSON.stringify(readable))

    await db.exec(`update public.jobs set confirmation_rev = 2 where id = '${a}'`)
    const s2 = await keep(U.admin, `public.job_customer_signature('${a}')`)
    ok('มีใบแก้ครั้งใหม่ = ลายเซ็นยังเป็นของใบครั้งเดิม', s2?.rev === 0 && s2?.current_rev === 2, JSON.stringify(s2))
    await pass('แอดมินเปลี่ยนเป็นลายเซ็นของใบแก้', U.admin, sign(a, path2))
    ok('ลายเซ็นใหม่ผูกกับใบครั้งที่ 2', (await keep(U.admin, `public.job_customer_signature('${a}')`))?.rev === 2)

    const part = await keep(U.admin, `public.split_job('${a}', 40)::text`)
    const fromPart = await keep(U.prod, `public.job_customer_signature('${part}')`)
    ok('ส่วนที่แบ่งออกมาเห็นลายเซ็นของงานแม่', fromPart?.path === path2, JSON.stringify(fromPart))
    await pass('แนบลายเซ็นจากส่วนที่แบ่ง = เก็บที่งานแม่', U.admin, sign(part, path))
    ok('แนบจากส่วนที่แบ่ง = งานแม่และทุกส่วนได้ลายเซ็นเดียวกัน',
      (await val(`select count(distinct customer_signature_path) || ':' || max(customer_signature_path) from public.jobs where id in ($1, $2)`, [a, part])) === `1:${path}`)

    await pass('แอดมินลบลายเซ็น', U.admin, sign(a, null))
    ok('ลบแล้วไม่มีลายเซ็นทั้งงานแม่และส่วนที่แบ่ง', (await keep(U.admin, `public.job_customer_signature('${a}')`)) === null &&
      (await val(`select count(*) from public.jobs where id in ($1, $2) and customer_signature_path is not null`, [a, part])) === 0)
    const ev = (await db.query(`select payload from public.events where job_id = $1 and type = 'customer_signature' order by id`, [a])).rows.map(r => r.payload)
    ok('แนบ / เปลี่ยน / ลบ บันทึกใน events ครั้งละ 1 แถว',
      ev.length === 4 && ev[0].replaced === false && ev[1].replaced === true && ev[3].removed === true, JSON.stringify(ev))

    await db.exec(`update public.jobs set phase = 'cancelled' where id = '${a}'`)
    await reject('งานที่ยกเลิกแล้วแนบลายเซ็นไม่ได้', U.admin, sign(a, path), /ยกเลิกแล้ว/)

    await db.exec('savepoint direct')
    let directBlocked = false
    try { await run(U.admin, `1; update public.jobs set customer_signature_path = 'x.png' where id = '${a}'`) } catch { directBlocked = true }
    await db.exec('rollback to savepoint direct; reset role')
    const after = await val(`select customer_signature_path from public.jobs where id = $1`, [a])
    ok('แก้ช่องลายเซ็นตรงในตารางไม่ได้', directBlocked || after === null, String(after))
  } finally {
    await db.exec('rollback')
  }
}
