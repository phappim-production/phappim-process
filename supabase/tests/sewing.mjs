// ต้องรันหลังชุดทดสอบอื่น: พอมีจักรในระบบแล้ว สถานีเย็บจะเริ่มได้เฉพาะเมื่อจักรครบ

import { queueSkips } from './queue-skip.mjs'

export async function sewingTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001', sup: '00000000-0000-0000-0000-000000000002',
    nobody: '00000000-0000-0000-0000-000000000003',
    admin: '00000000-0000-0000-0000-000000000011', qc: '00000000-0000-0000-0000-000000000012', prod: '00000000-0000-0000-0000-000000000013',
    sup1: '00000000-0000-0000-0000-000000000021', sup2: '00000000-0000-0000-0000-000000000022',
  }
  const skips = queueSkips(db, 'sewing')
  const call = async (uid, sql) => { await skips.beforeSql(as, uid, sql); return as(uid, () => db.query(`select ${sql}`)) }
  const pass = async (name, uid, sql) => {
    try { const r = await call(uid, sql); ok(name, true); return r.rows[0] } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const rejectSql = async (name, sql, re, uid) => {
    try { uid ? await as(uid, () => db.query(sql)) : await db.query(sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const jobAt = async (no, route, seq, product = 'tshirt', status = 'queued') => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status)
    values ('${no}','ลูกค้าทดสอบ','งานทดสอบจักร','${product}',10,'ตัว','2026-12-31','${route}','x.pdf','production',${seq},'${status}')
    returning id`)).rows[0].id
  const active = async id => (await db.query(`
    select m.code from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id
    where a.job_id = '${id}' and a.released_at is null order by m.code`)).rows.map(r => r.code)
  const status = async id => (await db.query(`select station_status s from public.jobs where id = '${id}'`)).rows[0].s
  const lastEvent = async id => (await db.query(`select type, payload from public.events where job_id = '${id}' order by id desc limit 1`)).rows[0]

  const count = async t => (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n
  ok('ชนิดจักร 11 ชนิด มีรหัสนำหน้าทุกชนิด', await count('machine_types') === 11
    && (await db.query(`select count(*)::int n from public.machine_types where prefix is null`)).rows[0].n === 0)
  // ใช้สูตรสมมติที่มีหลายชนิดเพื่อทดสอบกลไก · สูตรจริงตรวจใน sop.mjs
  ok('migration ตั้งจักรลา · ติดกระดุม · เจาะรังดุม · โพ้ง 4 เส้น เป็นใช้ร่วม', JSON.stringify((await db.query(
    `select array_agg(code order by code) c from public.machine_types where shared`)).rows[0].c) === '["button","buttonhole","cover","ovl4"]')
  // กลไกจักรประจำไลน์ทดสอบด้วยจักรลาแบบประจำไลน์ · จักรใช้ร่วม (ค่าจริง) ทดสอบแยกท้ายไฟล์
  await db.exec(`update public.machine_types set shared = false`)
  await db.exec(`insert into public.product_machine_needs (product_type_code, type_code, qty) values ('tshirt','flat',1),('apron','binding',1)`)
  const tee = (await db.query(`select type_code, qty from public.product_machine_needs where product_type_code = 'tshirt' order by type_code`)).rows
  ok('สูตรสมมติ: เสื้อยืดใช้ โพ้ง 4 ×2 · ลา · ลาคอ · เข็มเดี่ยว', JSON.stringify(tee) === JSON.stringify([
    { type_code: 'cover', qty: 1 }, { type_code: 'flat', qty: 1 }, { type_code: 'ovl4', qty: 2 }, { type_code: 'single', qty: 1 }]))
  ok('หมวกยังไม่มีสูตรจักร (ไม่เดา)', (await db.query(`select 1 from public.product_machine_needs where product_type_code = 'hat'`)).rows.length === 0)

  await rejectSql('รหัสจักรไม่มีรหัสนำหน้าประเภท ถูกปฏิเสธ', `insert into public.sewing_machines (code, type_code) values ('J01','ovl4')`, /OL4-เลข/)
  await rejectSql('รหัสนำหน้าผิดประเภท ถูกปฏิเสธ', `insert into public.sewing_machines (code, type_code) values ('SN-001','ovl4')`, /OL4-เลข 3 หลัก/)
  await rejectSql('รหัสจักรเลขท้าย 2 หลัก ถูกปฏิเสธ (ต้อง 3 หลัก)', `insert into public.sewing_machines (code, type_code) values ('OL4-09','ovl4')`, /OL4-เลข 3 หลัก เช่น OL4-001/)
  await rejectSql('รหัสจักรเลขท้าย 4 หลัก ถูกปฏิเสธ', `insert into public.sewing_machines (code, type_code) values ('OL4-0009','ovl4')`, /OL4-เลข 3 หลัก/)
  await db.exec(`insert into public.sewing_machines (code, type_code) values ('ol4-001','ovl4'),('OL4-002','ovl4'),('OL4-003','ovl4'),('SN-001','single'),('CV-001','cover'),('FL-001','flat'),('BD-001','binding')`)
  ok('รหัสพิมพ์เล็กถูกแปลงเป็นตัวใหญ่', (await db.query(`select 1 from public.sewing_machines where code = 'OL4-001'`)).rows.length === 1)
  await rejectSql('เปลี่ยนประเภทโดยไม่เปลี่ยนรหัส ถูกปฏิเสธ', `update public.sewing_machines set type_code = 'single' where code = 'OL4-003'`, /ไม่ตรงประเภท/)

  await rejectSql('ผู้ควบคุมงานเพิ่มจักรตรงเข้าตารางไม่ได้', `insert into public.sewing_machines (code, type_code) values ('SN-099','single')`, /row-level security/, U.sup2)
  await as(U.sup2, () => db.query(`update public.sewing_machines set status = 'off'`))
  ok('ผู้ควบคุมงานแก้สถานะจักรตรงเข้าตารางไม่ได้ (ต้องผ่านฟังก์ชัน)', (await db.query(`select count(*)::int n from public.sewing_machines where status = 'off'`)).rows[0].n === 0)
  await rejectSql('จ่ายจักรตรงเข้าตารางไม่ได้',
    `insert into public.machine_assignments (machine_id, job_id) select id, (select id from public.jobs limit 1) from public.sewing_machines limit 1`, /row-level security/, U.sup2)
  ok('ทุกบทบาทที่ล็อกอินอ่านจักรได้', (await as(U.qc, () => db.query(`select count(*)::int n from public.sewing_machines`))).rows[0].n === 7)
  ok('ผู้ใช้ไม่มีบทบาทอ่านจักรไม่ได้', (await as(U.nobody, () => db.query(`select count(*)::int n from public.sewing_machines`))).rows[0].n === 0)

  const tee1 = await jobAt('SC-SEW-T1', 'normal', 4)
  const tee2 = await jobAt('SC-SEW-T2', 'plain', 2)
  const cut = await jobAt('SC-SEW-CUT', 'normal', 3)
  const hat = await jobAt('SC-SEW-HAT', 'plain', 2, 'hat')
  await reject('เริ่มเย็บงานที่ยังไม่ถึงสถานีเย็บไม่ได้', U.sup2, `public.start_sewing('${cut}')`, /ยังไม่ถึงสถานีเย็บ/)
  await reject('ผู้ควบคุมงานเฟส 1 กดเริ่มเย็บไม่ได้', U.sup1, `public.start_sewing('${tee1}')`, /เฟส 2/)
  await reject('สินค้าที่ไม่มีสูตรจักร เริ่มเย็บไม่ได้', U.sup2, `public.start_sewing('${hat}')`, /ยังไม่มีสูตรจักรเย็บ .*ตั้งค่า → จักรเย็บ/)
  await reject('กดเริ่มสถานีเย็บแบบเดิมโดยไม่มีจักร ถูกปฏิเสธ', U.sup2, `public.start_station('${tee1}')`, /จักรไม่ครบ/)
  ok('ถูกปฏิเสธแล้วงานยังรอเย็บ', await status(tee1) === 'queued')
  const r1 = await pass('จักรว่างครบ กดเริ่มเย็บได้', U.sup2, `public.start_sewing('${tee1}') as picked`)
  ok('ระบบเลือกจักรว่างตามรหัส', JSON.stringify(r1?.picked) === '["CV-001","FL-001","OL4-001","OL4-002","SN-001"]', JSON.stringify(r1?.picked))
  ok('งานเปลี่ยนเป็นกำลังเย็บ', await status(tee1) === 'doing')
  ok('บันทึก event เริ่มสถานี', (await lastEvent(tee1)).type === 'station_start')
  await reject('จักรติดงานอื่น เริ่มเย็บงานถัดไปไม่ได้ และบอกว่าติดที่จักรตัวไหน', U.sup2, `public.start_sewing('${tee2}')`,
    /โพ้ง 4 เส้น ขาด 1 ตัว \(OL4-001 ใช้กับ SC-SEW-T1, OL4-002 ใช้กับ SC-SEW-T1\).*จักรลา ขาด 1 ตัว/)
  ok('เริ่มไม่ได้ = ไม่มีจักรถูกจองค้าง', (await active(tee2)).length === 0)
  await reject('กดเริ่มซ้ำงานที่เย็บอยู่แล้ว', U.sup2, `public.start_sewing('${tee1}')`, /สถานะงานเปลี่ยนไปแล้ว/)

  await reject('แจ้งจักรเสียต้องบอกอาการ', U.sup2, `public.set_machine_status('SN-001', 'broken')`, /บอกอาการ/)
  await reject('สถานะจักรที่ไม่รู้จัก ถูกปฏิเสธ', U.sup2, `public.set_machine_status('SN-001', 'lost')`, /ใช้ได้ \/ เสีย/)
  await reject('ผู้ควบคุมงานเฟส 1 แจ้งจักรเสียไม่ได้', U.sup1, `public.set_machine_status('SN-001', 'broken', 'ด้ายพัน')`, /เฟส 2 หรือฝ่ายผลิต/)
  await call(U.sup2, `public.open_issue('${tee1}', 'จักรเข็มเดี่ยวด้ายพัน')`)
  await pass('แจ้งจักรเสียระหว่างใช้งานได้', U.sup2, `public.set_machine_status('SN-001', 'broken', 'ด้ายพัน')`)
  ok('จักรเสียถูกคืนจากงานอัตโนมัติ', !(await active(tee1)).includes('SN-001'))
  const evBroken = await lastEvent(tee1)
  ok('งานบันทึกว่าจักรถูกคืนเพราะเสีย', evBroken.type === 'machines_released' && evBroken.payload.reason === 'จักรเสีย')
  await reject('จักรยังไม่ครบ กดแก้แล้ว (เย็บต่อ) ไม่ได้', U.sup2, `public.close_issue('${tee1}')`, /ขาด เข็มเดี่ยว 1 ตัว/)
  ok('งานยังพักอยู่', await status(tee1) === 'hold')
  await reject('จักรเสียจ่ายให้งานไม่ได้', U.sup2, `public.assign_machines('${tee1}', array['SN-001'])`, /SN-001 เสีย/)
  await pass('ซ่อมเสร็จ ตั้งกลับเป็นใช้ได้', U.sup2, `public.set_machine_status('SN-001', 'ready')`)
  await pass('กดเย็บต่อแล้วระบบจ่ายเฉพาะจักรที่ขาด', U.sup2, `public.resume_sewing('${tee1}')`)
  ok('เย็บต่อได้จักรที่ซ่อมแล้วและคงจักรเดิมครบ', (await active(tee1)).length === 5 && (await active(tee1)).includes('SN-001'))
  ok('งานกลับมากำลังเย็บ', await status(tee1) === 'doing')

  await reject('จ่ายจักรให้งานที่ยังไม่ถึงสถานีเย็บไม่ได้', U.sup2, `public.assign_machines('${cut}', array['BD-001'])`, /เฉพาะงานที่อยู่สถานีเย็บ/)
  // จัดจักรด้วยมือ = งานที่กำลังเย็บ / พัก เท่านั้น (ยังไม่เริ่ม = ปุ่มเริ่มเย็บจ่ายชุดแรกเอง)
  await reject('งานที่ยังไม่เริ่มเย็บ จ่ายจักรเพิ่มไม่ได้ (บอกให้กดเริ่มเย็บ)', U.sup2, `public.assign_machines('${tee2}', array['OL4-003'])`, /กด "เริ่มเย็บ" ก่อน/)
  const t2h = await jobAt('SC-SEW-T2H', 'plain', 2, 'tshirt', 'hold')
  await reject('ต้องเลือกจักรอย่างน้อย 1 ตัว', U.sup2, `public.assign_machines('${t2h}', array[]::text[])`, /อย่างน้อย 1/)
  await reject('รหัสว่างอย่างเดียว = ไม่ได้เลือกจักร', U.sup2, `public.assign_machines('${t2h}', array['  '])`, /อย่างน้อย 1/)
  await reject('รหัสจักรที่ไม่มี ถูกปฏิเสธ', U.sup2, `public.assign_machines('${t2h}', array['SN-077'])`, /ไม่พบจักร/)
  await reject('จักรที่ใช้อยู่จ่ายให้อีกงานไม่ได้', U.sup2, `public.assign_machines('${t2h}', array['OL4-001'])`, /OL4-001 ใช้กับงาน SC-SEW-T1/)
  await reject('จ่ายจักรว่างปนกับไม่ว่าง ถูกปฏิเสธทั้งชุด', U.sup2, `public.assign_machines('${t2h}', array['OL4-003','OL4-001'])`, /OL4-001/)
  ok('OL4-003 ไม่ถูกจองค้าง', (await active(t2h)).length === 0)
  await reject('ผู้ควบคุมงานเฟส 1 คืนจักรไม่ได้', U.sup1, `public.release_machines('${tee1}')`, /เฟส 2/)
  await reject('กำลังเย็บ คืนจักรจนไม่ครบชุดไม่ได้ (บอกว่าขาดอะไร + ให้พักงานก่อน)', U.sup2, `public.release_machines('${tee1}', array['FL-001'])`, /ขาด ลาคอ \/ ฟลัตล็อก 1 ตัว.*พักงานก่อน/)
  await reject('กำลังเย็บ คืนจักรทุกตัวไม่ได้', U.sup2, `public.release_machines('${tee1}')`, /ไม่ครบชุด/)
  ok('ถูกปฏิเสธแล้วจักรยังอยู่ครบ', (await active(tee1)).length === 5)
  await pass('ฝ่ายผลิตเพิ่มจักรให้งานที่กำลังเย็บได้ (รหัสพิมพ์เล็ก/ซ้ำ = ตัวเดียว)', U.prod, `public.assign_machines('${tee1}', array['ol4-003', ' OL4-003 '])`)
  ok('เพิ่มแล้วงานมีจักร 6 ตัว', (await active(tee1)).length === 6)
  const evAdd = await lastEvent(tee1)
  ok('บันทึก event จ่ายจักรเพิ่ม', evAdd.type === 'machines_assigned' && JSON.stringify(evAdd.payload.machines) === '["OL4-003"]', JSON.stringify(evAdd))
  await reject('กดเพิ่มจักรตัวเดิมซ้ำ = บอกว่าอยู่กับงานนี้แล้ว', U.prod, `public.assign_machines('${tee1}', array['OL4-003'])`, /อยู่กับงานนี้แล้ว/)
  await reject('แอดมินเพิ่มจักรไม่ได้', U.admin, `public.assign_machines('${tee1}', array['BD-001'])`, /บทบาท/)
  await pass('คืนจักรส่วนที่เกินชุดได้ระหว่างเย็บ', U.prod, `public.release_machines('${tee1}', array['OL4-003'])`)
  ok('OL4-003 ว่างแล้ว งานเหลือครบชุด', !(await active(tee1)).includes('OL4-003') && (await active(tee1)).length === 5)
  await reject('กดคืนจักรตัวเดิมซ้ำ = บอกว่าคืนไปแล้ว', U.prod, `public.release_machines('${tee1}', array['OL4-003'])`, /คืนไปแล้ว/)

  // ส่งจำนวนที่ต้องการ → กดซ้ำได้ผลเดียว
  await reject('ตั้งจำนวนจักรของงานที่ยังไม่เริ่มเย็บไม่ได้', U.prod, `public.set_job_machines('${tee2}', 'ovl4', 3)`, /กด "เริ่มเย็บ" ก่อน/)
  await reject('แอดมินตั้งจำนวนจักรไม่ได้', U.admin, `public.set_job_machines('${tee1}', 'ovl4', 3)`, /บทบาท/)
  await reject('ชนิดจักรที่ไม่มี ถูกปฏิเสธ', U.prod, `public.set_job_machines('${tee1}', 'laser', 1)`, /ไม่พบชนิดจักร/)
  await reject('จำนวนติดลบ ถูกปฏิเสธ', U.prod, `public.set_job_machines('${tee1}', 'ovl4', -1)`, /0 ขึ้นไป/)
  const plus = await pass('กด + เพิ่มโพ้งเป็น 3 ตัว ระบบหยิบตัวว่างให้เอง', U.prod, `public.set_job_machines('${tee1}', 'ovl4', 3) as codes`)
  ok('ได้จักรว่างตัวที่เหลือ', JSON.stringify(plus?.codes) === '["OL4-003"]', JSON.stringify(plus?.codes))
  ok('บันทึก event จ่ายจักร', (await lastEvent(tee1)).type === 'machines_assigned')
  await reject('กด + ซ้ำ (จำนวนเดิม) = บอกว่ามีอยู่แล้ว ไม่จ่ายเกิน', U.prod, `public.set_job_machines('${tee1}', 'ovl4', 3)`, /มี 3 ตัวอยู่แล้ว/)
  await reject('จักรว่างไม่พอ = บอกว่าว่างกี่ตัว ไม่จ่ายบางส่วน', U.prod, `public.set_job_machines('${tee1}', 'ovl4', 5)`, /ว่างอยู่ 0 ตัว เพิ่มเป็น 5 ตัวไม่ได้/)
  ok('ยังมีโพ้ง 3 ตัว', (await active(tee1)).filter(c => c.startsWith('OL4')).length === 3)
  await reject('กำลังเย็บ ลดต่ำกว่าที่สินค้าต้องใช้ไม่ได้', U.prod, `public.set_job_machines('${tee1}', 'ovl4', 1)`, /ต้องมีโพ้ง 4 เส้น อย่างน้อย 2 ตัว.*พักงานก่อน/)
  const minus = await pass('กด − คืนตัวที่ได้มาล่าสุด', U.prod, `public.set_job_machines('${tee1}', 'ovl4', 2) as codes`)
  ok('คืน OL4-003 (ตัวล่าสุด) เก็บตัวเดิมไว้', JSON.stringify(minus?.codes) === '["OL4-003"]' && (await active(tee1)).includes('OL4-001'), JSON.stringify(minus?.codes))
  ok('บันทึก event คืนจักร', (await lastEvent(tee1)).type === 'machines_released')

  await call(U.prod, `public.set_job_machines('${tee1}', 'ovl4', 3)`)
  await pass('แจ้งจักรเสีย 1 ตัวของงานที่มีจักรเกินชุด', U.prod, `public.set_machine_status('OL4-003', 'broken', 'เข็มหัก', now() + interval '2 hours')`)
  ok('งานยังกำลังเย็บ (จักรที่เหลือยังครบชุด)', await status(tee1) === 'doing')
  ok('จักรที่เสียออกจากงาน ตัวอื่นยังอยู่', !(await active(tee1)).includes('OL4-003') && (await active(tee1)).filter(c => c.startsWith('OL4')).length === 2)
  const evKeep = await lastEvent(tee1)
  ok('บันทึกว่าคืนจักรเพราะเสีย', evKeep.type === 'machines_released' && evKeep.payload.reason === 'จักรเสีย', JSON.stringify(evKeep))
  ok('ไม่เปิดปัญหาพักงาน', (await db.query(`select count(*)::int n from public.issues where job_id = '${tee1}' and closed_at is null`)).rows[0].n === 0)
  await call(U.prod, `public.set_machine_status('OL4-003', 'ready')`)

  await db.exec(`update public.jobs set station_seq = 5, station_status = 'queued' where id = '${tee1}'`)
  ok('งานไป QC แล้วคืนจักรทุกตัว', (await active(tee1)).length === 0)
  await pass('จักรที่คืนแล้ว งานถัดไปกดเริ่มเย็บได้', U.sup, `public.start_sewing('${tee2}')`)
  await db.exec(`update public.jobs set phase = 'done', station_seq = null, station_status = null where id = '${tee2}'`)
  ok('งานเสร็จแล้วคืนจักรทุกตัว', (await active(tee2)).length === 0)
  await reject('คืนจักรของงานที่ไม่มีจักร ถูกปฏิเสธ', U.owner, `public.release_machines('${tee2}')`, /ไม่มีจักร/)
  ok('ประวัติการใช้จักรยังอยู่ครบ', (await db.query(`select count(*)::int n from public.machine_assignments`)).rows[0].n === 14)

  await rejectSql('owner แก้สถานะจักรตรงเข้าตารางไม่ได้ (ต้องผ่านปุ่มแจ้งเสีย)',
    `update public.sewing_machines set status = 'broken' where code = 'OL4-003'`, /แจ้งเสีย/, U.owner)
  await as(U.owner, () => db.query(`update public.sewing_machines set sort = 5 where code = 'OL4-003'`))
  ok('owner แก้ข้อมูลตั้งค่าจักร (ลำดับ) ได้ตามปกติ', (await db.query(`select sort from public.sewing_machines where code = 'OL4-003'`)).rows[0].sort === 5)
  for (const [role, uid] of [['ฝ่าย QC', U.qc], ['ผู้ใช้ไม่มีบทบาท', U.nobody]]) {
    await reject(`${role}แจ้งจักรเสียไม่ได้`, uid, `public.set_machine_status('OL4-003', 'broken', 'x')`, /บทบาท|เข้าสู่ระบบ/)
  }
  const tee3 = await jobAt('SC-SEW-T3', 'plain', 2)
  await call(U.sup2, `public.start_sewing('${tee3}')`)
  ok('งานใหม่กำลังเย็บ', await status(tee3) === 'doing')
  await pass('แจ้งจักรเสียระหว่างเย็บ', U.sup2, `public.set_machine_status('ol4-002', 'broken', 'มอเตอร์ไม่หมุน')`)
  ok('งานที่กำลังเย็บถูกพักอัตโนมัติ', await status(tee3) === 'hold')
  const reason = (await db.query(`select reason from public.issues where job_id = '${tee3}' and closed_at is null`)).rows[0]?.reason
  ok('สาเหตุพักงานบอกจักรและอาการ', reason === 'จักร OL4-002 เสีย: มอเตอร์ไม่หมุน', reason)
  ok('event ล่าสุดของงานคือพักงาน', (await lastEvent(tee3)).type === 'hold')
  const log = (await db.query(`select l.status, l.note, l.job_id from public.machine_status_log l join public.sewing_machines m on m.id = l.machine_id where m.code = 'OL4-002' order by l.id desc limit 1`)).rows[0]
  ok('ประวัติจักรบันทึกอาการและงานที่ใช้อยู่', log.status === 'broken' && log.note === 'มอเตอร์ไม่หมุน' && log.job_id === tee3)
  ok('จักรเก็บอาการไว้แสดงบนจอ', (await db.query(`select note from public.sewing_machines where code = 'OL4-002'`)).rows[0].note === 'มอเตอร์ไม่หมุน')
  await reject('แจ้งเสียซ้ำ (อีกคนกดไปแล้ว) ได้ข้อความสถานะเปลี่ยนแล้ว', U.sup2, `public.set_machine_status('OL4-002', 'broken', 'ซ้ำ')`, /สถานะงานเปลี่ยนไปแล้ว.*เสีย อยู่แล้ว/)
  await pass('แจ้งจักรว่างเสียได้ (ไม่มีงานถูกพัก)', U.owner, `public.set_machine_status('BD-001', 'off')`)
  await pass('ซ่อมเสร็จ ตั้งกลับเป็นใช้ได้', U.sup2, `public.set_machine_status('OL4-002', 'ready')`)
  ok('ซ่อมเสร็จแล้วล้างอาการ', (await db.query(`select note from public.sewing_machines where code = 'OL4-002'`)).rows[0].note === null)
  await pass('เปิดใช้งานจักรที่ปิดไว้', U.sup2, `public.set_machine_status('BD-001', 'ready')`)
  // ฝ่ายผลิตเจอจักรเสียก่อน จึงแจ้งเสีย / ซ่อมเสร็จได้ · แต่จ่ายจักรและเริ่มเย็บไม่ได้
  await reject('ฝ่ายผลิตแจ้งเสียโดยไม่ใส่เวลาซ่อมไม่ได้', U.prod, `public.set_machine_status('BD-001', 'broken', 'เข็มหัก')`, /ต้องกำหนดเวลาซ่อมเสร็จ/)
  await reject('เวลาซ่อมเสร็จที่ผ่านไปแล้ว ถูกปฏิเสธ', U.prod, `public.set_machine_status('BD-001', 'broken', 'เข็มหัก', now() - interval '1 hour')`, /เวลาข้างหน้า/)
  await reject('กรอบเวลาซ่อมเกิน 30 วัน ถูกปฏิเสธ', U.prod, `public.set_machine_status('BD-001', 'broken', 'เข็มหัก', now() + interval '31 days')`, /เกิน 30 วัน/)
  await reject('ผู้ควบคุมงานใส่เวลาซ่อมไม่ได้ (หน้าที่ฝ่ายผลิต)', U.sup2, `public.set_machine_status('BD-001', 'broken', 'เข็มหัก', now() + interval '2 hours')`, /หน้าที่ของฝ่ายผลิต/)
  await pass('ฝ่ายผลิตแจ้งจักรเสียพร้อมเวลาซ่อมเสร็จได้', U.prod, `public.set_machine_status('BD-001', 'broken', 'เข็มหัก', now() + interval '2 hours')`)
  ok('จักรเก็บเวลาซ่อมเสร็จ', (await db.query(`select repair_eta is not null as has from public.sewing_machines where code = 'BD-001'`)).rows[0].has)
  ok('ประวัติเก็บกรอบเวลาซ่อม', (await db.query(`select l.repair_eta is not null as has from public.machine_status_log l join public.sewing_machines m on m.id = l.machine_id where m.code = 'BD-001' order by l.id desc limit 1`)).rows[0].has)
  await pass('ฝ่ายผลิตเลื่อนเวลาซ่อมได้ (รออะไหล่)', U.prod, `public.set_repair_eta('BD-001', now() + interval '1 day', 'รออะไหล่')`)
  await reject('ผู้ควบคุมงานเลื่อนเวลาซ่อมไม่ได้', U.sup2, `public.set_repair_eta('BD-001', now() + interval '2 days')`, /บทบาท/)
  await reject('กำหนดเวลาซ่อมจักรที่ไม่ได้เสียไม่ได้', U.prod, `public.set_repair_eta('OL4-003', now() + interval '2 hours')`, /ไม่ได้เสียอยู่/)
  ok('ประวัติบันทึกว่าฝ่ายผลิตเป็นคนแจ้ง', (await db.query(`select l.by from public.machine_status_log l join public.sewing_machines m on m.id = l.machine_id where m.code = 'BD-001' order by l.id desc limit 1`)).rows[0].by === U.prod)
  await reject('ใส่เวลาซ่อมตอนกดซ่อมเสร็จไม่ได้', U.prod, `public.set_machine_status('BD-001', 'ready', null, now() + interval '1 hour')`, /เฉพาะตอนแจ้งเสีย/)
  await pass('ฝ่ายผลิตกดซ่อมเสร็จได้', U.prod, `public.set_machine_status('BD-001', 'ready')`)
  ok('ซ่อมเสร็จแล้วล้างเวลาซ่อม', (await db.query(`select repair_eta from public.sewing_machines where code = 'BD-001'`)).rows[0].repair_eta === null)
  await reject('แอดมินกดเริ่มเย็บไม่ได้', U.admin, `public.start_sewing('${tee3}')`, /บทบาท/)
  await reject('แอดมินจ่ายจักรไม่ได้', U.admin, `public.assign_machines('${tee3}', array['BD-001'])`, /บทบาท/)
  await call(U.sup2, `public.release_machines('${tee3}')`)  // คืนจักรของงานที่พักอยู่ เพื่อให้งานถัดไปใช้
  const tee4 = await jobAt('SC-SEW-T4', 'plain', 2)
  await call(U.sup2, `public.start_sewing('${tee4}')`)
  const used = (await active(tee4))[0]
  await pass('ฝ่ายผลิตแจ้งจักรที่กำลังเย็บเสีย → พักงานได้', U.prod, `public.set_machine_status('${used}', 'broken', 'ด้ายพัน', now() + interval '3 hours')`)
  ok('งานที่ฝ่ายผลิตแจ้งถูกพัก', await status(tee4) === 'hold')
  const reason4 = (await db.query(`select reason from public.issues where job_id = '${tee4}' and closed_at is null`)).rows[0]?.reason ?? ''
  ok('สาเหตุพักงานบอกเวลาคาดว่าซ่อมเสร็จ', /คาดว่าซ่อมเสร็จ \d\d\/\d\d \d\d:\d\d$/.test(reason4), reason4)
  await call(U.prod, `public.set_machine_status('${used}', 'ready')`)
  ok('ประวัติจักรครบทุกครั้งที่กด', (await db.query(`select count(*)::int n from public.machine_status_log`)).rows[0].n === 13) // OL4-003 เสีย/ซ่อม · SN-001 · OL4-002 · BD-001 ปิด/เปิด · BD-001 ฝ่ายผลิต · จักรของ T4 (ละ 2 ครั้ง)
  await rejectSql('แก้ประวัติจักรตรงไม่ได้', `insert into public.machine_status_log (machine_id, status) select id, 'ready' from public.sewing_machines limit 1`, /row-level security/, U.owner)

  // วันจันทร์หน้า 08:00 เวลาไทย (ไม่พึ่งวันที่ตายตัว จึงไม่หมดอายุ)
  const MON = `((date_trunc('week', now() at time zone 'Asia/Bangkok') + interval '7 days 8 hours') at time zone 'Asia/Bangkok')`
  const at = h => `${MON} + interval '${h} hours'`
  const booked = async id => (await db.query(`
    select m.code from public.machine_bookings b join public.sewing_machines m on m.id = b.machine_id
    where b.job_id = '${id}' and b.cancelled_at is null and b.ends_at > now() order by m.code`)).rows.map(r => r.code)
  const bk1 = await jobAt('SC-BK-1', 'normal', 3)   // ยังอยู่สถานีตัด (เฟส 1) จองล่วงหน้าได้
  const bk2 = await jobAt('SC-BK-2', 'normal', 1)
  await reject('ผู้ควบคุมงานเฟส 2 จองจักรไม่ได้', U.sup2, `public.book_machines('${bk1}', ${at(0)}, ${at(9)})`, /บทบาท/)
  await reject('ผู้ควบคุมงานเฟส 1 จองจักรไม่ได้', U.sup1, `public.book_machines('${bk1}', ${at(0)}, ${at(9)})`, /บทบาท/)
  await reject('ผู้ควบคุมงานทุกเฟสจองจักรไม่ได้', U.sup, `public.book_machines('${bk1}', ${at(0)}, ${at(9)})`, /บทบาท/)
  await reject('ฝ่าย QC จองจักรไม่ได้', U.qc, `public.book_machines('${bk1}', ${at(0)}, ${at(9)})`, /บทบาท/)
  await reject('เวลาจบก่อนเวลาเริ่ม ถูกปฏิเสธ', U.prod, `public.book_machines('${bk1}', ${at(9)}, ${at(0)})`, /เวลาจบต้องหลังเวลาเริ่ม/)
  await reject('ช่วงเวลาที่ผ่านไปแล้ว ถูกปฏิเสธ', U.prod, `public.book_machines('${bk1}', now() - interval '3 hours', now() - interval '1 hour')`, /ผ่านไปแล้ว/)
  await reject('เริ่มวันอาทิตย์ ถูกปฏิเสธ', U.prod, `public.book_machines('${bk1}', ${at(-24)}, ${at(-20)})`, /วันอาทิตย์/)
  const atQc = await jobAt('SC-BK-QC', 'normal', 5)
  await reject('งานผลิตที่ผ่านเย็บแล้ว (อยู่ QC) จองจักรไม่ได้', U.prod, `public.book_machines('${atQc}', ${at(0)}, ${at(9)})`, /เย็บเสร็จแล้ว/)
  await reject('สินค้าไม่มีสูตรจักร จองไม่ได้', U.prod, `public.book_machines('${hat}', ${at(0)}, ${at(9)})`, /ยังไม่มีสูตรจักรเย็บ/)
  const r = await pass('ฝ่ายผลิตจองจักรให้งานที่ยังอยู่เฟส 1 ได้ (จันทร์ 08:00–17:00)', U.prod, `public.book_machines('${bk1}', ${at(0)}, ${at(9)}) as picked`)
  ok('จองจักรครบทุกชนิดตามสินค้า', JSON.stringify(r?.picked) === '["CV-001","FL-001","OL4-001","OL4-002","SN-001"]', JSON.stringify(r?.picked))
  ok('จองแล้วบันทึก event', (await lastEvent(bk1)).type === 'machines_booked')
  await reject('จองซ้ำงานเดิม ถูกปฏิเสธ', U.prod, `public.book_machines('${bk1}', ${at(10)}, ${at(12)})`, /จองจักรไว้แล้ว/)
  await reject('จองทับช่วงเวลาที่งานอื่นจองไว้ไม่ได้ และบอกว่าจองให้งานไหน', U.prod,
    `public.book_machines('${bk2}', ${at(4)}, ${at(7)})`, /จองไม่ได้ ช่วงเวลานี้จักรไม่พอ.*OL4-001 จองให้ SC-BK-1/)
  ok('จองไม่สำเร็จ = ไม่มีจักรถูกจองค้าง', (await booked(bk2)).length === 0)
  await rejectSql('ข้อบังคับฐานข้อมูลกันจองจักรทับ แม้เขียนข้าม RPC', `
    insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at)
    select id, '${bk2}', ${at(4)}, ${at(7)} from public.sewing_machines where code = 'OL4-001'
  `, /machine_bookings_no_overlap/)
  // หลายงานในวันเดียวกัน: จักรที่ว่างรับงานอื่นได้ ถ้าครบทุกชนิดตามสินค้าของงานนั้น
  await db.exec(`insert into public.sewing_machines (code, type_code) values ('SN-002','single')`)
  const bkA = await jobAt('SC-BK-APRON', 'plain', 1, 'apron')
  const rA = await pass('งานที่ 2 ขึ้นเย็บวันเดียวกัน ช่วงเดียวกันได้ ถ้าจักรชนิดที่ต้องใช้ยังว่างครบ', U.prod, `public.book_machines('${bkA}', ${at(0)}, ${at(9)}) as picked`)
  ok('งานที่ 2 ได้จักรตัวอื่นที่ยังว่าง ไม่ชนงานแรก', JSON.stringify(rA?.picked) === '["BD-001","SN-002"]', JSON.stringify(rA?.picked))
  const bkB = await jobAt('SC-BK-APRON2', 'plain', 1, 'apron')
  await reject('งานที่ 3 ชนิดเดียวกันช่วงเดียวกัน จักรไม่ครบ = จองไม่ได้ทั้งชุด', U.prod, `public.book_machines('${bkB}', ${at(0)}, ${at(9)})`, /เข็มเดี่ยว ขาด 1 ตัว.*เข้าขอบ ขาด 1 ตัว/)
  ok('จองไม่ครบ = ไม่จองบางส่วนค้าง', (await booked(bkB)).length === 0)
  await pass('งานที่ 3 จองช่วงบ่ายหลังงานที่ 2 เสร็จได้', U.prod, `public.book_machines('${bkB}', ${at(9)}, ${at(12)})`)
  await pass('จองต่อท้ายพอดี (17:00–20:00) ได้', U.prod, `public.book_machines('${bk2}', ${at(9)}, ${at(12)})`)
  await reject('ผู้ควบคุมงานเฟส 2 ยกเลิกการจองไม่ได้', U.sup2, `public.cancel_booking('${bk2}')`, /บทบาท/)
  await pass('ฝ่ายผลิตยกเลิกการจองได้', U.prod, `public.cancel_booking('${bk2}')`)
  ok('ยกเลิกแล้วไม่มีจักรจอง', (await booked(bk2)).length === 0)
  await reject('ยกเลิกซ้ำ ถูกปฏิเสธ', U.prod, `public.cancel_booking('${bk2}')`, /ไม่มีการจอง/)
  await pass('ยกเลิกแล้วจองช่วงเดิมใหม่ได้', U.prod, `public.book_machines('${bk2}', ${at(9)}, ${at(12)})`)

  await call(U.sup2, `public.release_machines('${tee4}')`)   // ให้จักรว่างทั้งหมดก่อน
  const bk4 = await jobAt('SC-BK-4', 'plain', 2, 'apron')
  const bk5 = await jobAt('SC-BK-5', 'plain', 2, 'apron')
  await pass('จองตั้งแต่ตอนนี้ได้', U.prod, `public.book_machines('${bk4}', now() - interval '1 minute', now() + interval '8 hours')`)
  ok('จองเข็มเดี่ยวกับเข้าขอบให้ SC-BK-4', JSON.stringify(await booked(bk4)) === '["BD-001","SN-001"]')
  await reject('จักรที่งานอื่นจองช่วงนี้ไว้ กดเริ่มเย็บไม่ได้', U.sup2, `public.start_sewing('${bk5}')`, /จองให้ SC-BK-4/)
  const r4 = await pass('งานที่จองไว้กดเริ่มเย็บได้ และได้จักรที่จองไว้', U.sup2, `public.start_sewing('${bk4}') as picked`)
  ok('ได้จักรตามที่จอง', JSON.stringify(r4?.picked) === '["BD-001","SN-001"]', JSON.stringify(r4?.picked))
  await db.exec(`update public.jobs set station_seq = 3, station_status = 'queued' where id = '${bk4}'`)
  ok('เย็บเสร็จก่อนเวลา = คืนช่วงจองที่เหลือ', (await booked(bk4)).length === 0)
  await pass('ช่วงที่คืนแล้ว งานอื่นกดเริ่มเย็บได้', U.sup2, `public.start_sewing('${bk5}')`)
  await rejectSql('จองตรงเข้าตารางไม่ได้ (แม้ฝ่ายผลิต)', `insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at)
    select id, '${bk2}', now(), now() + interval '1 hour' from public.sewing_machines limit 1`, /row-level security/, U.prod)

  await db.exec(`update public.jobs set station_seq = 3, station_status = 'queued' where id = '${bk5}'`)   // เย็บเสร็จ = จักรเข้าขอบว่าง
  const fin = await jobAt('SC-SEW-FIN', 'plain', 2, 'apron')
  await call(U.sup2, `public.start_sewing('${fin}')`)
  const finMachines = await active(fin)
  ok('งานที่จะเย็บเสร็จได้จักรครบ', finMachines.length === 2, JSON.stringify(finMachines))
  await reject('ผู้ควบคุมงานเฟส 1 รายงานปัญหาที่เย็บไม่ได้', U.sup1, `public.report_sewing_issue('${fin}', 'กำลังปรับจักร')`, /เฟส 2/)
  await reject('รายงานปัญหาต้องระบุสาเหตุ', U.sup2, `public.report_sewing_issue('${fin}', '  ')`, /ระบุปัญหา/)
  await pass('รายงานปัญหาระหว่างเย็บโดยไม่พักได้', U.sup2, `public.report_sewing_issue('${fin}', 'เปลี่ยนด้ายตรงตามสี')`)
  ok('ยังทำงานต่อและบันทึกรายงานลงไทม์ไลน์', await status(fin) === 'doing' && (await lastEvent(fin)).type === 'sewing_issue_reported')
  await pass('เลือกพักงานจากรายงานปัญหาได้', U.sup2, `public.report_sewing_issue('${fin}', 'รอผ้าเพิ่ม', true)`)
  ok('รายงานแบบพักงานเก็บสาเหตุและจักรเดิม', await status(fin) === 'hold' && (await lastEvent(fin)).payload.reason === 'รอผ้าเพิ่ม' && (await active(fin)).length === 2)
  await reject('งานพักกดเย็บเสร็จไม่ได้', U.sup2, `public.finish_sewing('${fin}')`, /พักอยู่/)
  await pass('กดเย็บต่อได้เมื่อแก้ปัญหาแล้ว', U.sup2, `public.resume_sewing('${fin}')`)
  await pass('เย็บเสร็จครั้งเดียวโดยไม่ต้องติ๊กหรือกรอกยอด', U.sup2, `public.finish_sewing('${fin}')`)
  await reject('ปุ่มเย็บเสร็จเดิมกดซ้ำแล้วไม่ข้าม QC', U.sup2, `public.finish_sewing('${fin}')`, /งานออกจากสถานีเย็บแล้ว/)
  const recorded = (await db.query(`select sew_count, first_piece_ok from public.jobs where id = '${fin}'`)).rows[0]
  ok('ยืนยันเสร็จไม่สร้างยอดเย็บหรือผลอนุมัติแทนพนักงาน', recorded.sew_count === 0 && recorded.first_piece_ok === false)
  const after = (await db.query(`select s.code, j.station_status from public.jobs j join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq join public.stations s on s.code = rs.station_code where j.id = '${fin}'`)).rows[0]
  ok('เย็บเสร็จแล้วงานไป QC + Packing รอคิว', after.code === 'qc_pack' && after.station_status === 'queued', JSON.stringify(after))
  ok('เย็บเสร็จแล้วคืนจักรทุกตัวอัตโนมัติ', (await active(fin)).length === 0)
  ok('จักรที่คืนกลับมาว่างให้งานอื่น', (await db.query(`select count(*)::int n from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id where m.code = any(array['${finMachines.join("','")}']) and a.released_at is null`)).rows[0].n === 0)

  // จ่ายจักรด้วยมือต้องเคารพการจองของงานอื่น เหมือนปุ่มเริ่มเย็บ
  const bx = await jobAt('SC-BUG-X', 'plain', 1, 'apron')
  const by = await jobAt('SC-BUG-Y', 'plain', 2, 'apron', 'hold')
  await call(U.prod, `public.book_machines('${bx}', now(), now() + interval '2 hours')`)
  const bxCodes = await booked(bx)
  await reject('จ่ายจักรด้วยมือ ข้ามการจองของงานอื่นไม่ได้', U.sup2, `public.assign_machines('${by}', array['${bxCodes[0]}'])`, /จองให้ SC-BUG-X/)
  await call(U.prod, `public.cancel_booking('${bx}')`)
  await pass('ยกเลิกการจองแล้ว จ่ายจักรตัวนั้นได้', U.sup2, `public.assign_machines('${by}', array['${bxCodes[0]}'])`)
  await call(U.sup2, `public.release_machines('${by}')`)

  // ตัวอย่างเย็บเสร็จ → การจองล่วงหน้าของรอบผลิตจริงต้องยังอยู่ · ผลิตจริงเย็บเสร็จ → ยกเลิก
  const smp = (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status)
    values ('SC-BUG-SMP','ลูกค้าทดสอบ','ตัวอย่าง','apron',10,'ตัว','2026-12-31','plain','x.pdf','sample',2,'queued') returning id`)).rows[0].id
  await call(U.prod, `public.book_machines('${smp}', ${at(24)}, ${at(33)})`)
  await db.exec(`update public.jobs set station_seq = 3 where id = '${smp}'`)
  ok('ตัวอย่างเย็บเสร็จ การจองรอบผลิตจริงยังอยู่', (await booked(smp)).length === 2)
  const prd = await jobAt('SC-BUG-PRD', 'plain', 2, 'apron')
  await call(U.prod, `public.book_machines('${prd}', ${at(48)}, ${at(57)})`)
  await db.exec(`update public.jobs set station_seq = 3 where id = '${prd}'`)
  ok('ผลิตจริงเย็บเสร็จ การจองล่วงหน้าที่เหลือถูกยกเลิก', (await booked(prd)).length === 0)

  // now() คงที่ใน transaction จึงทดสอบขอบเวลาเริ่มเดียวกันได้
  await db.exec('begin')
  try {
    const boundary = await jobAt('SC-BOOK-BOUNDARY', 'plain', 2, 'apron')
    const seedBooking = `insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at)
      select id, '${boundary}', now(), now() + interval '2 hours' from public.sewing_machines where code = 'SN-001'`
    await db.exec(seedBooking)
    await pass('ยกเลิกการจองตรงเวลาเริ่มได้', U.prod, `public.cancel_booking('${boundary}')`)
    ok('ยกเลิกตรงเวลาเริ่มเก็บเวลาเดิมไว้ในประวัติ', (await db.query(`
      select 1 from public.machine_bookings where job_id = '${boundary}'
        and cancelled_at = starts_at and ends_at > starts_at`)).rows.length === 1)
    await db.exec(seedBooking)
    await db.exec(`update public.jobs set station_seq = 3 where id = '${boundary}'`)
    ok('ออกจากเย็บตรงเวลาเริ่ม คืนจักรที่จองและไม่สร้างช่วงความยาวศูนย์', (await booked(boundary)).length === 0)
  } finally {
    await db.exec('rollback')
  }

  // จักรใช้ร่วม: จักรลาตัวเดียวสลับกันหลายไลน์ถ้าว่าง
  await db.exec('begin')
  try {
    await db.exec(`update public.machine_types set shared = (code in ('cover', 'button', 'buttonhole'))`)
    await db.exec(`update public.machine_assignments set released_at = now() where released_at is null`)
    await db.exec(`delete from public.product_machine_needs where product_type_code = 'pet'`)
    await db.exec(`insert into public.product_machine_needs (product_type_code, type_code, qty) values ('pet','cover',1)`)
    const p1 = await jobAt('SC-SHARE-1', 'plain', 2, 'pet')
    const p2 = await jobAt('SC-SHARE-2', 'plain', 2, 'pet')
    const r1 = await pass('จักรใช้ร่วม: งานแรกเริ่มเย็บได้ ไม่ผูกจักรลากับงาน', U.sup2, `public.start_sewing('${p1}') as picked`)
    ok('จักรใช้ร่วมไม่อยู่ในรายการจักรของงาน', JSON.stringify(r1?.picked ?? []) === '[]' && (await active(p1)).length === 0, JSON.stringify(r1?.picked))
    await pass('จักรใช้ร่วม: งานที่สองเริ่มเย็บพร้อมกันได้ (จักรลาตัวเดียวสลับใช้)', U.sup2, `public.start_sewing('${p2}') as picked`)
    ok('ทั้งสองงานกำลังเย็บ', (await status(p1)) === 'doing' && (await status(p2)) === 'doing')
    await pass('แจ้งจักรลาเสีย (จักรใช้ร่วมไม่พักงานที่เย็บอยู่)', U.sup2, `public.set_machine_status('CV-001', 'broken', 'มอเตอร์ไหม้')`)
    ok('งานที่เย็บอยู่ไม่ถูกพักเมื่อจักรใช้ร่วมเสีย', (await status(p1)) === 'doing')
    // อยู่ในธุรกรรม: error ทำให้ธุรกรรมใช้ไม่ได้ จึงครอบด้วย savepoint
    await db.exec(`savepoint shared_assign; set role authenticated; select set_config('request.jwt.claim.sub', '${U.prod}', false)`)
    try {
      await db.query(`select public.assign_machines('${p1}', array['CV-001'])`)
      ok('จ่ายจักรใช้ร่วมให้งานไม่ได้ (ทุกไลน์ใช้ร่วมกันอยู่แล้ว)', false, 'ควรถูกปฏิเสธแต่ผ่าน')
    } catch (e) {
      ok('จ่ายจักรใช้ร่วมให้งานไม่ได้ (ทุกไลน์ใช้ร่วมกันอยู่แล้ว)', /CV-001 เป็นจักรลา.*ใช้ร่วมกันอยู่แล้ว/.test(e.message), e.message.split('\n')[0])
    } finally { await db.exec('rollback to savepoint shared_assign; reset role') }
    await db.exec(`savepoint shared_count; set role authenticated; select set_config('request.jwt.claim.sub', '${U.prod}', false)`)
    try {
      await db.query(`select public.set_job_machines('${p1}', 'cover', 1)`)
      ok('ตั้งจำนวนจักรใช้ร่วมให้งานไม่ได้', false, 'ควรถูกปฏิเสธแต่ผ่าน')
    } catch (e) {
      ok('ตั้งจำนวนจักรใช้ร่วมให้งานไม่ได้', /จักรลา ทุกไลน์ใช้ร่วมกันอยู่แล้ว/.test(e.message), e.message.split('\n')[0])
    } finally { await db.exec('rollback to savepoint shared_count; reset role') }
    const p3 = await jobAt('SC-SHARE-3', 'plain', 2, 'pet')
    // อยู่ในธุรกรรม: ข้อผิดพลาดทำให้ธุรกรรมค้าง จึงย้อนกลับถึง savepoint เองแทน helper reject
    await db.exec('savepoint brk')
    let msg = ''
    try {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U.sup2}', false);`)
      await db.query(`select public.start_sewing('${p3}')`)
    } catch (e) { msg = e.message }
    await db.exec('rollback to savepoint brk')
    await db.exec('reset role')
    ok('จักรลาเสียทุกตัว: เริ่มเย็บสินค้าที่ต้องใช้จักรลาไม่ได้', /จักรลา ใช้ไม่ได้ทุกตัว/.test(msg), msg.split(String.fromCharCode(10))[0] || 'ควรถูกปฏิเสธแต่ผ่าน')
    ok('ขาดจักรใช้ร่วมไม่นับใน machines_short (ไม่บล็อกงานที่เย็บอยู่)',
      (await db.query(`select count(*)::int n from private.machines_short('${p1}') where short > 0`)).rows[0].n === 0)

    // โพ้ง 4 เส้นตั้งเป็นใช้ร่วม · ต้องมีตัวที่ใช้ได้ครบจำนวนที่สินค้าต้องใช้
    await db.exec(`delete from public.product_machine_needs where product_type_code = 'pet'`)
    await db.exec(`insert into public.product_machine_needs (product_type_code, type_code, qty) values ('pet','ovl4',2)`)
    const p4 = await jobAt('SC-SHARE-4', 'plain', 2, 'pet')
    await pass('โพ้งยังประจำไลน์: เริ่มเย็บได้จักร 2 ตัว', U.sup2, `public.start_sewing('${p4}') as picked`)
    ok('งานถือโพ้ง 2 ตัว', (await active(p4)).length === 2, JSON.stringify(await active(p4)))
    await as(U.owner, () => db.query(`update public.machine_types set shared = true where code = 'ovl4'`))
    ok('เจ้าของตั้งโพ้งเป็นใช้ร่วม → ปล่อยโพ้งที่ผูกกับงานคืน', (await active(p4)).length === 0, JSON.stringify(await active(p4)))
    const p5 = await jobAt('SC-SHARE-5', 'plain', 2, 'pet')
    await pass('โพ้งใช้ร่วม: งานที่สองเริ่มเย็บพร้อมกันได้', U.sup2, `public.start_sewing('${p5}') as picked`)
    await pass('แจ้งโพ้งเสีย 1', U.sup2, `public.set_machine_status('OL4-001', 'broken', 'เข็มหัก')`)
    await pass('แจ้งโพ้งเสีย 2', U.sup2, `public.set_machine_status('OL4-002', 'broken', 'มอเตอร์')`)
    const p6 = await jobAt('SC-SHARE-6', 'plain', 2, 'pet')
    await db.exec('savepoint ovl')
    let msg2 = ''
    try {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U.sup2}', false);`)
      await db.query(`select public.start_sewing('${p6}')`)
    } catch (e) { msg2 = e.message }
    await db.exec('rollback to savepoint ovl')
    await db.exec('reset role')
    ok('โพ้งใช้ได้เหลือ 1 ตัวแต่สินค้าต้องใช้ 2 ตัว: เริ่มเย็บไม่ได้', /โพ้ง 4 เส้น ใช้ได้ 1 ตัว ต้องใช้ 2 ตัว/.test(msg2), msg2.split(String.fromCharCode(10))[0] || 'ควรถูกปฏิเสธแต่ผ่าน')
    await as(U.sup2, () => db.query(`update public.machine_types set shared = false where code = 'cover'`))
    ok('ผู้ควบคุมงานตั้งจักรใช้ร่วมเองไม่ได้ (RLS · เจ้าของระบบเท่านั้น)', (await db.query(`select shared from public.machine_types where code = 'cover'`)).rows[0].shared === true)
  } finally {
    await db.exec('rollback')
  }
  skips.report()
}
