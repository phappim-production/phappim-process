// ลายเซ็นผู้อนุมัติ: แอดมินตัดจากใบที่ลูกค้าเซ็นใบเดียวกัน · แยกจากลายเซ็นลูกค้า · สคริปต์ล้างข้อมูลไม่ลบรูปที่งานยังใช้
import { readFileSync } from 'node:fs'

export async function approverSignatureTests({ db, ok }) {
  const file = '20261218000000_approver_signature.sql'
  try { await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
  catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, e.message.split('\n')[0]) }
  const U = {
    admin: '00000000-0000-0000-0000-00000000a501', prod: '00000000-0000-0000-0000-00000000a502',
    staff: '00000000-0000-0000-0000-00000000a503', off: '00000000-0000-0000-0000-00000000a504',
  }
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  const run = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', true);`)
    const r = await db.query(`select ${sql}`)
    await db.exec('reset role')
    return r
  }
  const tryOnly = async (uid, sql) => {
    await db.exec('savepoint ap')
    try { await run(uid, sql); return null } catch (e) { return e.message.split('\n')[0] }
    finally { await db.exec('rollback to savepoint ap; reset role') }
  }
  const keep = async (uid, sql) => {
    await db.exec('savepoint ap')
    try { const r = await run(uid, sql); await db.exec('release savepoint ap'); return r.rows[0] ? Object.values(r.rows[0])[0] : null }
    catch (e) { await db.exec('rollback to savepoint ap; reset role'); throw e }
  }
  const pass = async (name, uid, sql) => { try { await keep(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) } }
  const reject = async (name, uid, sql, re) => { const err = await tryOnly(uid, sql); ok(name, !!err && re.test(err), err ?? 'ควรถูกปฏิเสธแต่ผ่าน') }
  const receive = no => keep(U.admin, `public.receive_job(p_confirmation_no => '${no}', p_customer_name => 'ลูกค้าผู้อนุมัติ', p_job_name => 'เสื้อทีม',
    p_product_type_code => 'tshirt', p_qty => 120, p_unit => 'ตัว', p_due_date => current_date + 30, p_route_code => 'normal',
    p_confirmation_pdf_path => null, p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false)::text`)
  const approve = (job, path, on = 'current_date') => `public.set_approver_signature('${job}', ${path === null ? 'null' : `'${path}'`}, ${on})`
  const customer = (job, path) => `public.set_customer_signature('${job}', '${path}', current_date)`
  const sigOf = job => keep(U.prod, `public.job_customer_signature('${job}')`)

  await db.exec('begin')
  try {
    await db.exec(`
      insert into auth.users values ('${U.admin}','ap-admin@test'),('${U.prod}','ap-prod@test'),('${U.staff}','ap-staff@test'),('${U.off}','ap-off@test');
      insert into public.profiles (user_id,name,role,active) values
        ('${U.admin}','แอดมิน ผู้อนุมัติ','admin',true),('${U.prod}','ฝ่ายผลิต ผู้อนุมัติ','production',true),
        ('${U.staff}','พนักงาน ผู้อนุมัติ','staff',true),('${U.off}','บัญชีปิด ผู้อนุมัติ','admin',false);
      insert into public.staff_stations (user_id, station_code) values ('${U.staff}','print');
      update public.production_settings set materials_check = false;
      insert into private.file_settings (record_secret) values (repeat('s', 32)) on conflict do nothing;
    `)
    const a = await receive('SC-AP-A')
    const folder = await val(`select private.mockup_folder('SC-AP-A')`)
    const cust = `${folder}/sigc1c1c1.png`, appr = `${folder}/siga1a1a1.png`, appr2 = `${folder}/siga2a2a2.png`
    await db.query(`insert into private.file_objects (kind, path, size, content_type, uploaded_at) values
      ('mockups', $1, 10, 'image/png', now() - interval '2 hours'), ('mockups', $2, 10, 'image/png', now() - interval '2 hours'),
      ('mockups', $3, 10, 'image/png', now() - interval '2 hours'), ('mockups', 'SC-AP-OTHER/sigx.png', 10, 'image/png', now() - interval '2 hours')`, [cust, appr, appr2])

    ok('ยังไม่มีลายเซ็น = บอกแค่ใบครั้งปัจจุบัน', JSON.stringify(await sigOf(a)) === '{"current_rev":0}')
    await reject('ฝ่ายผลิตแนบลายเซ็นผู้อนุมัติไม่ได้', U.prod, approve(a, appr), /บทบาทของคุณ \(production\)/)
    await reject('บัญชีที่ปิดแล้วแนบไม่ได้', U.off, approve(a, appr), /เข้าสู่ระบบ/)
    await reject('รูปจากโฟลเดอร์งานอื่นใช้ไม่ได้', U.admin, approve(a, 'SC-AP-OTHER/sigx.png'), /ลายเซ็นผู้อนุมัตินี้ไม่ใช่ของงาน SC-AP-A/)
    await reject('รูปที่ยังไม่อัปโหลดใช้ไม่ได้', U.admin, approve(a, `${folder}/signope.png`), /ยังไม่พบรูป/)
    await reject('ไม่ใส่วันที่ผู้อนุมัติเซ็น ถูกปฏิเสธ', U.admin, approve(a, appr, 'null'), /วันที่ผู้อนุมัติเซ็น/)
    await reject('ใส่ปี พ.ศ. ถูกปฏิเสธ', U.admin, approve(a, appr, `'2569-11-27'`), /ปี ค.ศ./)
    await reject('วันที่ในอนาคตถูกปฏิเสธ', U.admin, approve(a, appr, 'current_date + 2'), /อนาคต/)

    await pass('แอดมินแนบลายเซ็นผู้อนุมัติ (ยังไม่มีลายเซ็นลูกค้า)', U.admin, approve(a, appr, 'current_date - 1'))
    let s = await sigOf(a)
    ok('มีแต่ลายเซ็นผู้อนุมัติ: ช่องลูกค้ายังว่าง', !s.path && s.approver?.path === appr && s.approver?.rev === 0, JSON.stringify(s))
    await pass('แนบลายเซ็นลูกค้าแยกกันได้', U.admin, customer(a, cust))
    s = await sigOf(a)
    ok('อ่านได้ทั้งสองลายเซ็น แยกช่องกัน', s.path === cust && s.approver?.path === appr && s.current_rev === 0, JSON.stringify(s))
    const readable = await keep(U.staff, `public.file_read_allowed('mockups', array['${appr}', '${cust}', 'SC-AP-OTHER/sigx.png'])`)
    ok('พนักงานสถานีขอลิงก์รูปลายเซ็นทั้งสองได้ (รูปอื่นไม่ได้)', JSON.stringify([...readable].sort()) === JSON.stringify([appr, cust].sort()), JSON.stringify(readable))

    await db.exec(`update public.jobs set confirmation_rev = 1 where id = '${a}'`)
    s = await sigOf(a)
    ok('ใบแก้ครั้งใหม่ = ลายเซ็นผู้อนุมัติยังเป็นของใบครั้งเดิม', s.approver?.rev === 0 && s.current_rev === 1, JSON.stringify(s))
    await pass('เปลี่ยนลายเซ็นผู้อนุมัติเป็นของใบแก้', U.admin, approve(a, appr2))
    ok('ลายเซ็นผู้อนุมัติใหม่ผูกกับใบครั้งที่ 1', (await sigOf(a)).approver?.rev === 1)

    const part = await keep(U.admin, `public.split_job('${a}', 40)::text`)
    ok('ส่วนที่แบ่งเห็นลายเซ็นผู้อนุมัติของงานแม่', (await sigOf(part)).approver?.path === appr2)
    await pass('ลบลายเซ็นผู้อนุมัติ', U.admin, approve(a, null))
    s = await sigOf(a)
    ok('ลบผู้อนุมัติแล้ว ลายเซ็นลูกค้ายังอยู่', s.path === cust && !s.approver, JSON.stringify(s))
    ok('ลบแล้วทุกส่วนที่แบ่งไม่มีลายเซ็นผู้อนุมัติ', (await val(`select count(*)::int from public.jobs where id in ($1, $2) and approver_signature_path is not null`, [a, part])) === 0)
    const ev = (await db.query(`select payload from public.events where job_id = $1 and type = 'approver_signature' order by id`, [a])).rows.map(r => r.payload)
    ok('แนบ / เปลี่ยน / ลบ บันทึกใน events ครั้งละ 1 แถว', ev.length === 3 && ev[0].replaced === false && ev[1].replaced === true && ev[2].removed === true, JSON.stringify(ev))

    await db.exec('savepoint direct')
    let directBlocked = false
    try { await run(U.admin, `1; update public.jobs set approver_signature_path = 'x.png' where id = '${a}'`) } catch { directBlocked = true }
    await db.exec('rollback to savepoint direct; reset role')
    ok('แก้ช่องลายเซ็นผู้อนุมัติตรงในตารางไม่ได้', directBlocked || (await val('select approver_signature_path from public.jobs where id = $1', [a])) === null)

    await pass('แนบลายเซ็นผู้อนุมัติอีกครั้ง (ไว้ตรวจสคริปต์ล้างข้อมูล)', U.admin, approve(a, appr))
    const mat = `${folder}/m1m1m1.jpg`, photo = `${folder}/p1p1p1.jpg`, loose = `${folder}/z9z9z9.png`
    await db.query(`insert into private.file_objects (kind, path, size, content_type, uploaded_at) values
      ('mockups', $1, 10, 'image/jpeg', now() - interval '2 hours'), ('station_photos', $2, 10, 'image/jpeg', now() - interval '2 hours'),
      ('mockups', $3, 10, 'image/png', now() - interval '2 hours')`, [mat, photo, loose])
    await db.query('insert into public.job_material_photos (job_id, path) values ($1, $2)', [a, mat])
    await db.query(`insert into public.station_checks (job_id, station_code, visit, kind, status, photos) values ($1, 'print', 1, 'finish', 'recorded', array[$2])`, [a, photo])
    const script = readFileSync(new URL('../scripts/golive-cleanup.sql', import.meta.url), 'utf8').replace(/^(begin|commit);\r?$/gm, '')
    await db.exec(script)
    const left = (await db.query('select path from private.file_objects where path = any($1)', [[cust, appr, mat, photo, loose]])).rows.map(r => r.path)
    ok('สคริปต์ล้างข้อมูลเก็บลายเซ็นลูกค้า/ผู้อนุมัติ รูปวัตถุดิบ รูปสถานี', [cust, appr, mat, photo].every(p => left.includes(p)), JSON.stringify(left))
    ok('สคริปต์ล้างข้อมูลยังลบไฟล์ที่ไม่มีอะไรอ้าง', !left.includes(loose))
  } finally {
    await db.exec('rollback')
  }
}
