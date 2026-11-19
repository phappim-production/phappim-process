export async function auditReviewTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001', qc: '00000000-0000-0000-0000-000000000012',
    prod: '00000000-0000-0000-0000-000000000013', mgr: '00000000-0000-0000-0000-000000000041',
  }
  await db.exec(`
    insert into auth.users values ('${U.mgr}','mgr-audit@test');
    insert into public.profiles (user_id,name,role,active) values ('${U.mgr}','ผู้บริหารทดสอบ','manager',true);
  `)
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql}`))
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const logCount = async () => (await db.query('select count(*)::int n from public.audit_log')).rows[0].n

  const before = await logCount()
  await as(U.owner, () => db.query(`update public.reason_codes set name = name || ' (แก้)' where code = (select code from public.reason_codes order by code limit 1)`))
  const row = (await db.query('select * from public.audit_log order by id desc limit 1')).rows[0]
  ok('Audit Log: เจ้าของแก้ตั้งค่า → บันทึก 1 แถว พร้อมค่าเดิมและค่าใหม่', await logCount() === before + 1
    && row.table_name === 'reason_codes' && row.action === 'update' && row.by === U.owner
    && row.new_row.name.endsWith('(แก้)') && !row.old_row.name.endsWith('(แก้)'))
  await as(U.owner, () => db.query(`update public.reason_codes set name = name where code = '${row.row_key}'`))
  ok('Audit Log: บันทึกโดยไม่เปลี่ยนค่า ไม่สร้างแถว', await logCount() === before + 1)
  await as(U.owner, () => db.query(`insert into public.staff_stations (user_id, station_code) values ('${U.prod}', 'cut')`))
  const link = (await db.query(`select row_key, action from public.audit_log order by id desc limit 1`)).rows[0]
  ok('Audit Log: จับคู่สถานีบันทึกด้วยรหัสคู่ ผู้ใช้:สถานี', link.action === 'insert' && link.row_key === `${U.prod}:cut`)
  await as(U.owner, () => db.query(`delete from public.staff_stations where user_id = '${U.prod}'`))

  const n = await logCount()
  await call(U.prod, `public.open_issue((select id from public.jobs where phase = 'production' and station_seq is not null and station_status = 'queued' limit 1), 'ทดสอบ audit')`).catch(() => {})
  ok('Audit Log: การกดงานของคนหน้างานไม่ลง Audit Log (อยู่ใน events แล้ว)', await logCount() === n)
  const seen = (await as(U.prod, () => db.query('select count(*)::int n from public.audit_log'))).rows[0].n
  ok('Audit Log: บทบาทอื่นอ่านไม่ได้', seen === 0)
  ok('Audit Log: เจ้าของอ่านได้', (await as(U.owner, () => db.query('select count(*)::int n from public.audit_log'))).rows[0].n === n)
  try { await db.exec('update public.audit_log set table_name = \'x\''); ok('Audit Log: แก้ย้อนหลังไม่ได้', false, 'ควรถูกปฏิเสธแต่ผ่าน') }
  catch (e) { ok('Audit Log: แก้ย้อนหลังไม่ได้', /เพิ่มอย่างเดียว/.test(e.message)) }
  try { await db.exec('delete from public.audit_log'); ok('Audit Log: ลบไม่ได้', false, 'ควรถูกปฏิเสธแต่ผ่าน') }
  catch (e) { ok('Audit Log: ลบไม่ได้', /เพิ่มอย่างเดียว/.test(e.message)) }

  const job = (await db.query(`select id from public.jobs order by created_at limit 1`)).rows[0].id
  const ev = (await db.query(`insert into public.events (job_id, type, payload) values ('${job}', 'queue_insert', '{"reason":"ด่วน"}') returning id`)).rows[0].id
  const other = (await db.query(`insert into public.events (job_id, type) values ('${job}', 'started') returning id`)).rows[0].id
  await reject('รับทราบ: ฝ่ายผลิตกดแทนผู้บริหารไม่ได้', U.prod, `public.ack_review('queue_event', ${ev})`, /ทำขั้นนี้ไม่ได้/)
  await reject('รับทราบ: QC กดไม่ได้', U.qc, `public.ack_review('queue_event', ${ev})`, /ทำขั้นนี้ไม่ได้/)
  await call(U.mgr, `public.ack_review('queue_event', ${ev})`)
  await call(U.mgr, `public.ack_review('queue_event', ${ev})`)
  const acks = (await db.query(`select * from public.manager_acks where ref_id = ${ev}`)).rows
  ok('รับทราบ: ผู้บริหารกดรับทราบการแทรกคิวได้ · กดซ้ำไม่เพิ่มแถว', acks.length === 1 && acks[0].by === U.mgr && acks[0].job_id === job)
  await reject('รับทราบ: เหตุการณ์ที่ไม่ใช่แทรกคิว/ข้ามคิว ถูกปฏิเสธ', U.mgr, `public.ack_review('queue_event', ${other})`, /ไม่พบรายการ/)
  await reject('รับทราบ: ชนิดไม่รู้จัก ถูกปฏิเสธ', U.mgr, `public.ack_review('other', 1)`, /ชนิดรายการไม่ถูกต้อง/)
  await reject('รับทราบ: รายงานที่ไม่มีอยู่ ถูกปฏิเสธ', U.mgr, `public.ack_review('delay_report', 999999)`, /ไม่พบรายการ/)
  try {
    await as(U.mgr, () => db.query(`insert into public.manager_acks (kind, ref_id, job_id) values ('queue_event', ${other}, '${job}')`))
    ok('รับทราบ: เขียนตารางตรงไม่ได้ (ต้องผ่าน ack_review)', false, 'ควรถูกปฏิเสธแต่ผ่าน')
  } catch (e) { ok('รับทราบ: เขียนตารางตรงไม่ได้ (ต้องผ่าน ack_review)', /permission denied|row-level security/.test(e.message)) }
}
