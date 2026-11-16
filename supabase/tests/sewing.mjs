// ทดสอบจักรเย็บ (S14 · docs/แผน-1-สัปดาห์.md) · เรียกจาก run.mjs หลัง sections.mjs (ใช้ผู้ใช้ sup1/sup2 ร่วม)
// ต้องรันหลังชุดทดสอบอื่น: พอมีจักรในระบบแล้ว สถานีเย็บจะเริ่มได้เฉพาะเมื่อจักรครบ

export async function sewingTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001', sup: '00000000-0000-0000-0000-000000000002',
    nobody: '00000000-0000-0000-0000-000000000003',
    qc: '00000000-0000-0000-0000-000000000012', prod: '00000000-0000-0000-0000-000000000013',
    sup1: '00000000-0000-0000-0000-000000000021', sup2: '00000000-0000-0000-0000-000000000022',
  }
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql}`))
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

  // ---------- ข้อมูลตั้งค่า ----------
  const count = async t => (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n
  ok('ชนิดจักร 11 ชนิด มีรหัสนำหน้าทุกชนิด', await count('machine_types') === 11
    && (await db.query(`select count(*)::int n from public.machine_types where prefix is null`)).rows[0].n === 0)
  const tee = (await db.query(`select type_code, qty from public.product_machine_needs where product_type_code = 'tshirt' order by type_code`)).rows
  ok('เสื้อยืดใช้ โพ้ง 4 ×2 · ลา · ลาคอ · เข็มเดี่ยว', JSON.stringify(tee) === JSON.stringify([
    { type_code: 'cover', qty: 1 }, { type_code: 'flat', qty: 1 }, { type_code: 'ovl4', qty: 2 }, { type_code: 'single', qty: 1 }]))
  ok('หมวกยังไม่มีสูตรจักร (ไม่เดา)', (await db.query(`select 1 from public.product_machine_needs where product_type_code = 'hat'`)).rows.length === 0)

  // ---------- รหัสจักรตามประเภท ----------
  await rejectSql('รหัสจักรไม่มีรหัสนำหน้าประเภท ถูกปฏิเสธ', `insert into public.sewing_machines (code, type_code) values ('J01','ovl4')`, /OL4-เลข/)
  await rejectSql('รหัสนำหน้าผิดประเภท ถูกปฏิเสธ', `insert into public.sewing_machines (code, type_code) values ('SN-01','ovl4')`, /ไม่ตรงประเภท/)
  await db.exec(`insert into public.sewing_machines (code, type_code) values ('ol4-01','ovl4'),('OL4-02','ovl4'),('OL4-03','ovl4'),('SN-01','single'),('CV-01','cover'),('FL-01','flat'),('BD-01','binding')`)
  ok('รหัสพิมพ์เล็กถูกแปลงเป็นตัวใหญ่', (await db.query(`select 1 from public.sewing_machines where code = 'OL4-01'`)).rows.length === 1)
  await rejectSql('เปลี่ยนประเภทโดยไม่เปลี่ยนรหัส ถูกปฏิเสธ', `update public.sewing_machines set type_code = 'single' where code = 'OL4-03'`, /ไม่ตรงประเภท/)

  // ---------- สิทธิ์ ----------
  await rejectSql('ผู้ควบคุมงานเพิ่มจักรตรงเข้าตารางไม่ได้', `insert into public.sewing_machines (code, type_code) values ('SN-99','single')`, /row-level security/, U.sup2)
  await as(U.sup2, () => db.query(`update public.sewing_machines set status = 'off'`))
  ok('ผู้ควบคุมงานแก้สถานะจักรตรงเข้าตารางไม่ได้ (ต้องผ่านฟังก์ชัน)', (await db.query(`select count(*)::int n from public.sewing_machines where status = 'off'`)).rows[0].n === 0)
  await rejectSql('จ่ายจักรตรงเข้าตารางไม่ได้',
    `insert into public.machine_assignments (machine_id, job_id) select id, (select id from public.jobs limit 1) from public.sewing_machines limit 1`, /row-level security/, U.sup2)
  ok('ทุกบทบาทที่ล็อกอินอ่านจักรได้', (await as(U.qc, () => db.query(`select count(*)::int n from public.sewing_machines`))).rows[0].n === 7)
  ok('ผู้ใช้ไม่มีบทบาทอ่านจักรไม่ได้', (await as(U.nobody, () => db.query(`select count(*)::int n from public.sewing_machines`))).rows[0].n === 0)

  // ---------- กดเริ่มเย็บ (ตามจริง) ----------
  const tee1 = await jobAt('SC-SEW-T1', 'normal', 4)
  const tee2 = await jobAt('SC-SEW-T2', 'plain', 2)
  const cut = await jobAt('SC-SEW-CUT', 'normal', 3)
  const hat = await jobAt('SC-SEW-HAT', 'plain', 2, 'hat')
  await reject('เริ่มเย็บงานที่ยังไม่ถึงสถานีเย็บไม่ได้', U.sup2, `public.start_sewing('${cut}')`, /ยังไม่ถึงสถานีเย็บ/)
  await reject('ผู้ควบคุมงานเฟส 1 กดเริ่มเย็บไม่ได้', U.sup1, `public.start_sewing('${tee1}')`, /เฟส 2/)
  await reject('สินค้าที่ไม่มีสูตรจักร เริ่มเย็บไม่ได้', U.sup2, `public.start_sewing('${hat}')`, /ยังไม่มีข้อมูล/)
  await reject('กดเริ่มสถานีเย็บแบบเดิมโดยไม่มีจักร ถูกปฏิเสธ', U.sup2, `public.start_station('${tee1}')`, /จักรไม่ครบ/)
  ok('ถูกปฏิเสธแล้วงานยังรอเย็บ', await status(tee1) === 'queued')
  const r1 = await pass('จักรว่างครบ กดเริ่มเย็บได้', U.sup2, `public.start_sewing('${tee1}') as picked`)
  ok('ระบบเลือกจักรว่างตามรหัส', JSON.stringify(r1?.picked) === '["CV-01","FL-01","OL4-01","OL4-02","SN-01"]', JSON.stringify(r1?.picked))
  ok('งานเปลี่ยนเป็นกำลังเย็บ', await status(tee1) === 'doing')
  ok('บันทึก event เริ่มสถานี', (await lastEvent(tee1)).type === 'station_start')
  await reject('จักรติดงานอื่น เริ่มเย็บงานถัดไปไม่ได้ และบอกว่าติดที่จักรตัวไหน', U.sup2, `public.start_sewing('${tee2}')`,
    /โพ้ง 4 เส้น ขาด 1 ตัว \(OL4-01 ใช้กับ SC-SEW-T1, OL4-02 ใช้กับ SC-SEW-T1\).*จักรลา ขาด 1 ตัว/)
  ok('เริ่มไม่ได้ = ไม่มีจักรถูกจองค้าง', (await active(tee2)).length === 0)
  await reject('กดเริ่มซ้ำงานที่เย็บอยู่แล้ว', U.sup2, `public.start_sewing('${tee1}')`, /สถานะงานเปลี่ยนไปแล้ว/)

  // ---------- จักรเสียระหว่างเย็บ ----------
  await reject('แจ้งจักรเสียต้องบอกอาการ', U.sup2, `public.set_machine_status('SN-01', 'broken')`, /บอกอาการ/)
  await reject('สถานะจักรที่ไม่รู้จัก ถูกปฏิเสธ', U.sup2, `public.set_machine_status('SN-01', 'lost')`, /ใช้ได้ \/ เสีย/)
  await reject('ผู้ควบคุมงานเฟส 1 แจ้งจักรเสียไม่ได้', U.sup1, `public.set_machine_status('SN-01', 'broken', 'ด้ายพัน')`, /เฟส 2 หรือฝ่ายผลิต/)
  await call(U.sup2, `public.open_issue('${tee1}', 'จักรเข็มเดี่ยวด้ายพัน')`)
  await pass('แจ้งจักรเสียระหว่างใช้งานได้', U.sup2, `public.set_machine_status('SN-01', 'broken', 'ด้ายพัน')`)
  ok('จักรเสียถูกคืนจากงานอัตโนมัติ', !(await active(tee1)).includes('SN-01'))
  const evBroken = await lastEvent(tee1)
  ok('งานบันทึกว่าจักรถูกคืนเพราะเสีย', evBroken.type === 'machines_released' && evBroken.payload.reason === 'จักรเสีย')
  await reject('จักรยังไม่ครบ กดแก้แล้ว (เย็บต่อ) ไม่ได้', U.sup2, `public.close_issue('${tee1}')`, /ขาด เข็มเดี่ยว 1 ตัว/)
  ok('งานยังพักอยู่', await status(tee1) === 'hold')
  await reject('จักรเสียจ่ายให้งานไม่ได้', U.sup2, `public.assign_machines('${tee1}', array['SN-01'])`, /SN-01 เสีย/)
  await pass('ซ่อมเสร็จ ตั้งกลับเป็นใช้ได้', U.sup2, `public.set_machine_status('SN-01', 'ready')`)
  await pass('จ่ายจักรที่ซ่อมแล้วคืนให้งาน', U.sup2, `public.assign_machines('${tee1}', array['SN-01'])`)
  await pass('จักรครบ กดแก้แล้วเย็บต่อได้', U.sup2, `public.close_issue('${tee1}')`)
  ok('งานกลับมากำลังเย็บ', await status(tee1) === 'doing')

  // ---------- จ่าย / คืนจักรด้วยมือ ----------
  await reject('จ่ายจักรให้งานที่ยังไม่ถึงสถานีเย็บไม่ได้', U.sup2, `public.assign_machines('${cut}', array['BD-01'])`, /เฉพาะงานที่อยู่สถานีเย็บ/)
  await reject('ต้องเลือกจักรอย่างน้อย 1 ตัว', U.sup2, `public.assign_machines('${tee2}', array[]::text[])`, /อย่างน้อย 1/)
  await reject('รหัสจักรที่ไม่มี ถูกปฏิเสธ', U.sup2, `public.assign_machines('${tee2}', array['SN-77'])`, /ไม่พบจักร/)
  await reject('จักรที่ใช้อยู่จ่ายให้อีกงานไม่ได้', U.sup2, `public.assign_machines('${tee2}', array['OL4-01'])`, /OL4-01 ใช้กับงาน SC-SEW-T1/)
  await reject('จ่ายจักรว่างปนกับไม่ว่าง ถูกปฏิเสธทั้งชุด', U.sup2, `public.assign_machines('${tee2}', array['OL4-03','OL4-01'])`, /OL4-01/)
  ok('OL4-03 ไม่ถูกจองค้าง', (await active(tee2)).length === 0)
  await reject('ผู้ควบคุมงานเฟส 1 คืนจักรไม่ได้', U.sup1, `public.release_machines('${tee1}')`, /เฟส 2/)
  await pass('คืนจักรบางตัวได้', U.sup2, `public.release_machines('${tee1}', array['FL-01'])`)
  ok('FL-01 ว่างแล้ว', !(await active(tee1)).includes('FL-01'))

  // ---------- ออกจากสถานีเย็บ = คืนจักรอัตโนมัติ ----------
  await db.exec(`update public.jobs set station_seq = 5, station_status = 'queued' where id = '${tee1}'`)
  ok('งานไป QC แล้วคืนจักรทุกตัว', (await active(tee1)).length === 0)
  await pass('จักรที่คืนแล้ว งานถัดไปกดเริ่มเย็บได้', U.sup, `public.start_sewing('${tee2}')`)
  await db.exec(`update public.jobs set phase = 'done', station_seq = null, station_status = null where id = '${tee2}'`)
  ok('งานเสร็จแล้วคืนจักรทุกตัว', (await active(tee2)).length === 0)
  await reject('คืนจักรของงานที่ไม่มีจักร ถูกปฏิเสธ', U.owner, `public.release_machines('${tee2}')`, /ไม่มีจักร/)
  ok('ประวัติการใช้จักรยังอยู่ครบ', (await db.query(`select count(*)::int n from public.machine_assignments`)).rows[0].n === 11)

  // ---------- แจ้งเสีย / ซ่อมเสร็จ (สถานะจักร) ----------
  await rejectSql('owner แก้สถานะจักรตรงเข้าตารางไม่ได้ (ต้องผ่านปุ่มแจ้งเสีย)',
    `update public.sewing_machines set status = 'broken' where code = 'OL4-03'`, /แจ้งเสีย/, U.owner)
  await as(U.owner, () => db.query(`update public.sewing_machines set sort = 5 where code = 'OL4-03'`))
  ok('owner แก้ข้อมูลตั้งค่าจักร (ลำดับ) ได้ตามปกติ', (await db.query(`select sort from public.sewing_machines where code = 'OL4-03'`)).rows[0].sort === 5)
  for (const [role, uid] of [['ฝ่าย QC', U.qc], ['ผู้ใช้ไม่มีบทบาท', U.nobody]]) {
    await reject(`${role}แจ้งจักรเสียไม่ได้`, uid, `public.set_machine_status('OL4-03', 'broken', 'x')`, /บทบาท|เข้าสู่ระบบ/)
  }
  const tee3 = await jobAt('SC-SEW-T3', 'plain', 2)
  await call(U.sup2, `public.start_sewing('${tee3}')`)
  ok('งานใหม่กำลังเย็บ', await status(tee3) === 'doing')
  await pass('แจ้งจักรเสียระหว่างเย็บ', U.sup2, `public.set_machine_status('ol4-02', 'broken', 'มอเตอร์ไม่หมุน')`)
  ok('งานที่กำลังเย็บถูกพักอัตโนมัติ', await status(tee3) === 'hold')
  const reason = (await db.query(`select reason from public.issues where job_id = '${tee3}' and closed_at is null`)).rows[0]?.reason
  ok('สาเหตุพักงานบอกจักรและอาการ', reason === 'จักร OL4-02 เสีย: มอเตอร์ไม่หมุน', reason)
  ok('event ล่าสุดของงานคือพักงาน', (await lastEvent(tee3)).type === 'hold')
  const log = (await db.query(`select l.status, l.note, l.job_id from public.machine_status_log l join public.sewing_machines m on m.id = l.machine_id where m.code = 'OL4-02' order by l.id desc limit 1`)).rows[0]
  ok('ประวัติจักรบันทึกอาการและงานที่ใช้อยู่', log.status === 'broken' && log.note === 'มอเตอร์ไม่หมุน' && log.job_id === tee3)
  ok('จักรเก็บอาการไว้แสดงบนจอ', (await db.query(`select note from public.sewing_machines where code = 'OL4-02'`)).rows[0].note === 'มอเตอร์ไม่หมุน')
  await reject('แจ้งเสียซ้ำ (อีกคนกดไปแล้ว) ได้ข้อความสถานะเปลี่ยนแล้ว', U.sup2, `public.set_machine_status('OL4-02', 'broken', 'ซ้ำ')`, /สถานะงานเปลี่ยนไปแล้ว.*เสีย อยู่แล้ว/)
  await pass('แจ้งจักรว่างเสียได้ (ไม่มีงานถูกพัก)', U.owner, `public.set_machine_status('BD-01', 'off')`)
  await pass('ซ่อมเสร็จ ตั้งกลับเป็นใช้ได้', U.sup2, `public.set_machine_status('OL4-02', 'ready')`)
  ok('ซ่อมเสร็จแล้วล้างอาการ', (await db.query(`select note from public.sewing_machines where code = 'OL4-02'`)).rows[0].note === null)
  await pass('เปิดใช้งานจักรที่ปิดไว้', U.sup2, `public.set_machine_status('BD-01', 'ready')`)
  // ฝ่ายผลิตเจอจักรเสียก่อน จึงแจ้งเสีย / ซ่อมเสร็จได้ · แต่จ่ายจักรและเริ่มเย็บไม่ได้
  await pass('ฝ่ายผลิตแจ้งจักรเสียได้', U.prod, `public.set_machine_status('BD-01', 'broken', 'เข็มหัก')`)
  ok('ประวัติบันทึกว่าฝ่ายผลิตเป็นคนแจ้ง', (await db.query(`select l.by from public.machine_status_log l join public.sewing_machines m on m.id = l.machine_id where m.code = 'BD-01' order by l.id desc limit 1`)).rows[0].by === U.prod)
  await pass('ฝ่ายผลิตกดซ่อมเสร็จได้', U.prod, `public.set_machine_status('BD-01', 'ready')`)
  await reject('ฝ่ายผลิตกดเริ่มเย็บไม่ได้', U.prod, `public.start_sewing('${tee3}')`, /บทบาท/)
  await reject('ฝ่ายผลิตจ่ายจักรไม่ได้', U.prod, `public.assign_machines('${tee3}', array['BD-01'])`, /บทบาท/)
  await call(U.sup2, `public.release_machines('${tee3}')`)  // คืนจักรของงานที่พักอยู่ เพื่อให้งานถัดไปใช้
  const tee4 = await jobAt('SC-SEW-T4', 'plain', 2)
  await call(U.sup2, `public.start_sewing('${tee4}')`)
  const used = (await active(tee4))[0]
  await pass('ฝ่ายผลิตแจ้งจักรที่กำลังเย็บเสีย → พักงานได้', U.prod, `public.set_machine_status('${used}', 'broken', 'ด้ายพัน')`)
  ok('งานที่ฝ่ายผลิตแจ้งถูกพัก', await status(tee4) === 'hold')
  await call(U.prod, `public.set_machine_status('${used}', 'ready')`)
  ok('ประวัติจักรครบทุกครั้งที่กด', (await db.query(`select count(*)::int n from public.machine_status_log`)).rows[0].n === 10) // SN-01 · OL4-02 · BD-01 ปิด/เปิด · BD-01 ฝ่ายผลิต · จักรของ T4 (ละ 2 ครั้ง)
  await rejectSql('แก้ประวัติจักรตรงไม่ได้', `insert into public.machine_status_log (machine_id, status) select id, 'ready' from public.sewing_machines limit 1`, /row-level security/, U.owner)

  // ---------- จองจักรเป็นวัน-เวลา ----------
  // วันจันทร์หน้า 08:00 เวลาไทย (ไม่พึ่งวันที่ตายตัว จึงไม่หมดอายุ)
  const MON = `((date_trunc('week', now() at time zone 'Asia/Bangkok') + interval '7 days 8 hours') at time zone 'Asia/Bangkok')`
  const at = h => `${MON} + interval '${h} hours'`
  const booked = async id => (await db.query(`
    select m.code from public.machine_bookings b join public.sewing_machines m on m.id = b.machine_id
    where b.job_id = '${id}' and b.cancelled_at is null and b.ends_at > now() order by m.code`)).rows.map(r => r.code)
  const bk1 = await jobAt('SC-BK-1', 'normal', 3)   // ยังอยู่สถานีตัด (เฟส 1) จองล่วงหน้าได้
  const bk2 = await jobAt('SC-BK-2', 'normal', 1)
  await reject('ผู้ควบคุมงานเฟส 1 จองจักรไม่ได้', U.sup1, `public.book_machines('${bk1}', ${at(0)}, ${at(9)})`, /เฟส 2/)
  await reject('ฝ่าย QC จองจักรไม่ได้', U.qc, `public.book_machines('${bk1}', ${at(0)}, ${at(9)})`, /บทบาท/)
  await reject('เวลาจบก่อนเวลาเริ่ม ถูกปฏิเสธ', U.sup2, `public.book_machines('${bk1}', ${at(9)}, ${at(0)})`, /เวลาจบต้องหลังเวลาเริ่ม/)
  await reject('ช่วงเวลาที่ผ่านไปแล้ว ถูกปฏิเสธ', U.sup2, `public.book_machines('${bk1}', now() - interval '3 hours', now() - interval '1 hour')`, /ผ่านไปแล้ว/)
  await reject('เริ่มวันอาทิตย์ ถูกปฏิเสธ', U.sup2, `public.book_machines('${bk1}', ${at(-24)}, ${at(-20)})`, /วันอาทิตย์/)
  const atQc = await jobAt('SC-BK-QC', 'normal', 5)
  await reject('งานผลิตที่ผ่านเย็บแล้ว (อยู่ QC) จองจักรไม่ได้', U.sup2, `public.book_machines('${atQc}', ${at(0)}, ${at(9)})`, /เย็บเสร็จแล้ว/)
  await reject('สินค้าไม่มีสูตรจักร จองไม่ได้', U.sup2, `public.book_machines('${hat}', ${at(0)}, ${at(9)})`, /ยังไม่มีข้อมูล/)
  const r = await pass('ผู้ควบคุมงานเฟส 2 จองจักรให้งานที่ยังอยู่เฟส 1 ได้ (จันทร์ 08:00–17:00)', U.sup2, `public.book_machines('${bk1}', ${at(0)}, ${at(9)}) as picked`)
  ok('จองจักรครบทุกชนิดตามสินค้า', JSON.stringify(r?.picked) === '["CV-01","FL-01","OL4-01","OL4-02","SN-01"]', JSON.stringify(r?.picked))
  ok('จองแล้วบันทึก event', (await lastEvent(bk1)).type === 'machines_booked')
  await reject('จองซ้ำงานเดิม ถูกปฏิเสธ', U.sup2, `public.book_machines('${bk1}', ${at(10)}, ${at(12)})`, /จองจักรไว้แล้ว/)
  await reject('จองทับช่วงเวลาที่งานอื่นจองไว้ไม่ได้ และบอกว่าจองให้งานไหน', U.sup2,
    `public.book_machines('${bk2}', ${at(4)}, ${at(7)})`, /จองไม่ได้ ช่วงเวลานี้จักรไม่พอ.*OL4-01 จองให้ SC-BK-1/)
  ok('จองไม่สำเร็จ = ไม่มีจักรถูกจองค้าง', (await booked(bk2)).length === 0)
  await pass('จองต่อท้ายพอดี (17:00–20:00) ได้', U.sup2, `public.book_machines('${bk2}', ${at(9)}, ${at(12)})`)
  await pass('ยกเลิกการจองได้', U.sup2, `public.cancel_booking('${bk2}')`)
  ok('ยกเลิกแล้วไม่มีจักรจอง', (await booked(bk2)).length === 0)
  await reject('ยกเลิกซ้ำ ถูกปฏิเสธ', U.sup2, `public.cancel_booking('${bk2}')`, /ไม่มีการจอง/)
  await pass('ยกเลิกแล้วจองช่วงเดิมใหม่ได้', U.sup2, `public.book_machines('${bk2}', ${at(9)}, ${at(12)})`)

  // ---------- การจองที่ครอบคลุม "ตอนนี้" กับปุ่มเริ่มเย็บ ----------
  await call(U.sup2, `public.release_machines('${tee4}')`)   // ให้จักรว่างทั้งหมดก่อน
  const bk4 = await jobAt('SC-BK-4', 'plain', 2, 'apron')
  const bk5 = await jobAt('SC-BK-5', 'plain', 2, 'apron')
  await pass('จองตั้งแต่ตอนนี้ได้', U.sup2, `public.book_machines('${bk4}', now() - interval '1 minute', now() + interval '8 hours')`)
  ok('จองเข็มเดี่ยวกับเข้าขอบให้ SC-BK-4', JSON.stringify(await booked(bk4)) === '["BD-01","SN-01"]')
  await reject('จักรที่งานอื่นจองช่วงนี้ไว้ กดเริ่มเย็บไม่ได้', U.sup2, `public.start_sewing('${bk5}')`, /จองให้ SC-BK-4/)
  const r4 = await pass('งานที่จองไว้กดเริ่มเย็บได้ และได้จักรที่จองไว้', U.sup2, `public.start_sewing('${bk4}') as picked`)
  ok('ได้จักรตามที่จอง', JSON.stringify(r4?.picked) === '["BD-01","SN-01"]', JSON.stringify(r4?.picked))
  await db.exec(`update public.jobs set station_seq = 3, station_status = 'queued' where id = '${bk4}'`)
  ok('เย็บเสร็จก่อนเวลา = คืนช่วงจองที่เหลือ', (await booked(bk4)).length === 0)
  await pass('ช่วงที่คืนแล้ว งานอื่นกดเริ่มเย็บได้', U.sup2, `public.start_sewing('${bk5}')`)
  await rejectSql('จองตรงเข้าตารางไม่ได้', `insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at)
    select id, '${bk2}', now(), now() + interval '1 hour' from public.sewing_machines limit 1`, /row-level security/, U.sup2)
}
