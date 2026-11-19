export async function staffRoleTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001',
    staff: '00000000-0000-0000-0000-000000000031', loose: '00000000-0000-0000-0000-000000000032',
  }
  await db.exec(`
    insert into auth.users values ('${U.staff}','staff@test'),('${U.loose}','loose@test');
    insert into public.profiles (user_id,name,role,active) values
      ('${U.staff}','พนักงานพิมพ์','staff',true),('${U.loose}','พนักงานยังไม่จับคู่','staff',true);
  `)
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql}`))
  const pass = async (name, uid, sql) => {
    try { await call(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const jobAt = async (no, seq, phase = 'production') => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status)
    values ('${no}','ลูกค้าทดสอบ','งานทดสอบพนักงาน','tshirt',10,'ตัว','2026-12-31','normal','x.pdf','${phase}',${seq},'queued')
    returning id`)).rows[0].id

  try {
    await db.exec(`update public.profiles set role = 'worker' where user_id = '${U.loose}'`)
    ok('บทบาทที่ไม่รู้จักถูกปฏิเสธ', false, 'ควรถูกปฏิเสธแต่ผ่าน')
  } catch (e) { ok('บทบาทที่ไม่รู้จักถูกปฏิเสธ', /profiles_role_check/.test(e.message)) }

  try {
    await as(U.staff, () => db.query(`insert into public.staff_stations values ('${U.staff}','cut')`))
    ok('พนักงานจับคู่สถานีให้ตัวเองไม่ได้', false, 'ควรถูกปฏิเสธแต่ผ่าน')
  } catch (e) { ok('พนักงานจับคู่สถานีให้ตัวเองไม่ได้', /row-level security/.test(e.message), e.message.split('\n')[0]) }
  await as(U.owner, () => db.query(`insert into public.staff_stations (user_id, station_code) values ('${U.staff}','print')`))
  const seen = (await as(U.staff, () => db.query('select station_code from public.staff_stations'))).rows
  ok('เจ้าของจับคู่พนักงานกับสถานีได้ · พนักงานเห็นสถานีของตัวเอง', seen.some(r => r.station_code === 'print'))

  const print = await jobAt('SC-STAFF-P', 1)
  const cut = await jobAt('SC-STAFF-C', 3)
  await pass('พนักงานพิมพ์เริ่มงานที่สถานีพิมพ์ได้', U.staff, `public.start_station('${print}')`)
  await reject('พนักงานพิมพ์เริ่มงานที่สถานีตัดไม่ได้', U.staff, `public.start_station('${cut}')`, /ไม่ใช่สถานีของคุณ/)
  await reject('พนักงานที่ยังไม่จับคู่สถานีเริ่มงานไม่ได้', U.loose, `public.start_station('${print}')`, /จับคู่สถานี/)
  await pass('พนักงานพิมพ์พักงานที่สถานีพิมพ์ได้', U.staff, `public.open_issue('${print}', 'หมึกหมด')`)
  await reject('พนักงานพิมพ์พักงานที่สถานีตัดไม่ได้', U.staff, `public.open_issue('${cut}', 'ทดสอบ')`, /ไม่ใช่สถานีของคุณ/)
  await reject('พนักงานกด "แก้แล้ว ทำต่อ" ไม่ได้', U.staff, `public.close_issue('${print}', 'แก้แล้ว')`, /ทำขั้นนี้ไม่ได้/)
  await reject('พนักงานแทรกคิวไม่ได้', U.staff, `public.move_job_ahead('${cut}', '${print}', 'ด่วน')`, /ทำขั้นนี้ไม่ได้/)
  await reject('พนักงานรับงานใหม่ไม่ได้', U.staff,
    `public.receive_job('SC-STAFF-NEW', 'ลูกค้าทดสอบ', 'งานใหม่', 'tshirt', 10, 'ตัว', '2026-12-31', 'normal', 'confirmations/SC-STAFF-NEW.pdf')`)
  const waiting = await jobAt('SC-STAFF-W', 1, 'materials')
  await reject('งานที่ยังไม่ถึงสถานี พนักงานกดไม่ได้', U.staff, `public.open_issue('${waiting}', 'ทดสอบ')`, /ยังไม่อยู่ที่สถานี/)
  await pass('เจ้าของยังกดได้ทุกสถานี', U.owner, `public.start_station('${cut}')`)
}
