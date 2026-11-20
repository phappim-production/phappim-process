export async function deliveryTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001',
    admin: '00000000-0000-0000-0000-000000000071', prod: '00000000-0000-0000-0000-000000000072',
    mgr: '00000000-0000-0000-0000-000000000073', staff: '00000000-0000-0000-0000-000000000074',
  }
  await db.exec(`
    insert into auth.users values ('${U.admin}','dl-admin@test'),('${U.prod}','dl-prod@test'),('${U.mgr}','dl-mgr@test'),('${U.staff}','dl-staff@test');
    insert into public.profiles (user_id,name,role,active) values
      ('${U.admin}','แอดมิน ส่ง','admin',true),('${U.prod}','ฝ่ายผลิต ส่ง','production',true),
      ('${U.mgr}','ผู้บริหาร ส่ง','manager',true),('${U.staff}','พนักงาน ส่ง','staff',true);
    insert into public.staff_stations (user_id, station_code) values ('${U.staff}','qc_pack');
  `)
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql}`))
  const pass = async (name, uid, sql) => {
    try { await call(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const jobOf = async (no, phase) => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, finished_at)
    values ('${no}','ลูกค้าส่งของ','งานส่งของ','tshirt',10,'ตัว','2026-12-31','normal','x.pdf','${phase}', ${phase === 'done' ? 'now()' : 'null'})
    returning id`)).rows[0].id
  const row = async id => (await db.query(`select delivered_at, delivered_by, delivery_note from public.jobs where id = '${id}'`)).rows[0]
  const events = async (id, type) => (await db.query(`select payload from public.events where job_id = '${id}' and type = '${type}'`)).rows

  const done = await jobOf('SC-DL-1', 'done')
  const doing = await jobOf('SC-DL-2', 'production')

  await reject('งานที่ยังผลิตไม่เสร็จ บันทึกจัดส่งไม่ได้', U.admin, `public.mark_delivered('${doing}')`, /ยังผลิตไม่เสร็จ/)
  await reject('ฝ่ายผลิตบันทึกจัดส่งไม่ได้', U.prod, `public.mark_delivered('${done}')`, /บทบาทของคุณ/)
  await reject('ผู้บริหารบันทึกจัดส่งไม่ได้', U.mgr, `public.mark_delivered('${done}')`, /บทบาทของคุณ/)
  await reject('พนักงานสถานี QC บันทึกจัดส่งไม่ได้', U.staff, `public.mark_delivered('${done}')`, /บทบาทของคุณ|สถานี/)
  ok('ถูกปฏิเสธแล้วยังไม่จัดส่ง', (await row(done)).delivered_at === null)

  await pass('แอดมินบันทึกจัดส่งพร้อมเลขพัสดุ', U.admin, `public.mark_delivered('${done}', '  Kerry KEX123 · คุณสมชายรับ ')`)
  const r = await row(done)
  ok('บันทึกเวลา ผู้ส่ง และหมายเหตุ (ตัดช่องว่าง)', !!r.delivered_at && r.delivered_by === U.admin && r.delivery_note === 'Kerry KEX123 · คุณสมชายรับ')
  ok('ลง events ชนิด delivered 1 แถว', (await events(done, 'delivered')).length === 1)
  await reject('บันทึกจัดส่งซ้ำไม่ได้', U.admin, `public.mark_delivered('${done}')`, /บันทึกจัดส่งไปแล้ว/)
  ok('กดซ้ำไม่เพิ่ม events', (await events(done, 'delivered')).length === 1)
  ok('job_live มีคอลัมน์จัดส่ง', (await db.query(`select delivery_note from public.job_live where id = '${done}'`)).rows[0]?.delivery_note === 'Kerry KEX123 · คุณสมชายรับ')

  await reject('ยกเลิกจัดส่งต้องมีเหตุผล', U.admin, `public.undo_delivery('${done}', ' ')`, /ใส่เหตุผล/)
  await reject('ฝ่ายผลิตยกเลิกจัดส่งไม่ได้', U.prod, `public.undo_delivery('${done}', 'กดผิด')`, /บทบาทของคุณ/)
  await pass('แอดมินยกเลิกจัดส่ง (กดผิดงาน)', U.admin, `public.undo_delivery('${done}', 'กดผิดงาน')`)
  const u = await row(done)
  ok('ยกเลิกแล้วกลับเป็นรอส่ง', u.delivered_at === null && u.delivered_by === null && u.delivery_note === null)
  const undone = await events(done, 'delivery_undone')
  ok('ยกเลิกลง events พร้อมเหตุผลและข้อมูลเดิม', undone.length === 1 && undone[0].payload.reason === 'กดผิดงาน' && undone[0].payload.note === 'Kerry KEX123 · คุณสมชายรับ')
  await reject('ยกเลิกงานที่ยังไม่จัดส่งไม่ได้', U.admin, `public.undo_delivery('${done}', 'ทดสอบ')`, /ยังไม่ได้บันทึกจัดส่ง/)
  await pass('เจ้าของบันทึกจัดส่งได้ (ไม่ใส่หมายเหตุ)', U.owner, `public.mark_delivered('${done}')`)
  ok('ไม่ใส่หมายเหตุ = ว่าง', (await row(done)).delivery_note === null)
  try {
    await as(U.admin, () => db.query(`update public.jobs set delivered_at = null where id = '${done}'`))
    ok('แอดมินแก้ตาราง jobs ตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', (await row(done)).delivered_at !== null)
  } catch { ok('แอดมินแก้ตาราง jobs ตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', true) }

  await db.exec(`alter table public.events disable trigger events_append_only;
    delete from public.jobs where id in ('${done}', '${doing}');
    alter table public.events enable trigger events_append_only;`)
}
