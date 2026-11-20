export async function cancelJobTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001',
    admin: '00000000-0000-0000-0000-000000000081', prod: '00000000-0000-0000-0000-000000000082',
    mgr: '00000000-0000-0000-0000-000000000083', qc: '00000000-0000-0000-0000-000000000084',
    staff: '00000000-0000-0000-0000-000000000085',
  }
  await db.exec(`
    insert into auth.users values ('${U.admin}','cx-admin@test'),('${U.prod}','cx-prod@test'),('${U.mgr}','cx-mgr@test'),
      ('${U.qc}','cx-qc@test'),('${U.staff}','cx-staff@test');
    insert into public.profiles (user_id,name,role,active) values
      ('${U.admin}','แอดมิน ยก','admin',true),('${U.prod}','ฝ่ายผลิต ยก','production',true),
      ('${U.mgr}','ผู้บริหาร ยก','manager',true),('${U.qc}','QC ยก','qc',true),('${U.staff}','พนักงาน ยก','staff',true);
    insert into public.staff_stations (user_id, station_code) values ('${U.staff}','print');
  `)
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql}`))
  const pass = async (name, uid, sql) => {
    try { await call(uid, sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, e.message.split('\n')[0]) }
  }
  const seqOf = async station => (await db.query(`select seq from public.route_stations where route_code = 'normal' and station_code = '${station}'`)).rows[0].seq
  const jobOf = async (no, phase, station, status) => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status, finished_at)
    values ('${no}','ลูกค้าเบี้ยว','งานยกเลิก','tshirt',10,'ตัว','2026-12-31','normal','x.pdf','${phase}',
      ${station ? await seqOf(station) : 'null'}, ${status ? `'${status}'` : 'null'}, ${phase === 'done' ? 'now()' : 'null'})
    returning id`)).rows[0].id
  const phase = async id => (await db.query(`select phase from public.jobs where id = '${id}'`)).rows[0].phase
  const events = async (id, type) => (await db.query(`select phase, station_code, payload from public.events where job_id = '${id}' and type = '${type}'`)).rows

  const queued = await jobOf('SC-CX-1', 'production', 'print', 'queued')
  const sewing = await jobOf('SC-CX-2', 'production', 'sew', 'doing')
  const held = await jobOf('SC-CX-3', 'production', 'cut', 'hold')
  const done = await jobOf('SC-CX-4', 'done', null, null)
  const outside = await jobOf('SC-CX-5', 'production', 'print', 'out')
  const machine = (await db.query(`select id from public.sewing_machines order by id limit 1`)).rows[0].id
  await db.exec(`
    insert into public.machine_assignments (machine_id, job_id) values (${machine}, '${sewing}');
    insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at) values
      (${machine}, '${sewing}', now() - interval '1 hour', now() + interval '3 hours'),
      (${machine}, '${sewing}', '2031-01-06 08:00+07', '2031-01-06 12:00+07');
    insert into public.issues (job_id, station_code, reason) values ('${held}', 'cut', 'ผ้าไม่พอ');
  `)

  await reject('แอดมินยกเลิกงานไม่ได้', U.admin, `public.cancel_job('${queued}', 'ลูกค้ายกเลิก')`, /บทบาทของคุณ/)
  await reject('ฝ่ายผลิตยกเลิกงานไม่ได้', U.prod, `public.cancel_job('${queued}', 'ลูกค้ายกเลิก')`, /บทบาทของคุณ/)
  await reject('QC ยกเลิกงานไม่ได้', U.qc, `public.cancel_job('${queued}', 'ลูกค้ายกเลิก')`, /บทบาทของคุณ/)
  await reject('พนักงานสถานียกเลิกงานไม่ได้', U.staff, `public.cancel_job('${queued}', 'ลูกค้ายกเลิก')`, /บทบาทของคุณ/)
  await reject('ยกเลิกต้องใส่เหตุผล', U.mgr, `public.cancel_job('${queued}', '  ')`, /ใส่เหตุผล/)
  ok('ถูกปฏิเสธแล้วงานยังเดินอยู่', await phase(queued) === 'production')
  try {
    await as(U.mgr, () => db.query(`update public.jobs set phase = 'cancelled' where id = '${queued}'`))
    ok('ผู้บริหารแก้ตาราง jobs ตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', await phase(queued) === 'production')
  } catch { ok('ผู้บริหารแก้ตาราง jobs ตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', true) }

  await pass('ผู้บริหารยกเลิกงานที่รอคิว', U.mgr, `public.cancel_job('${queued}', ' ลูกค้ายกเลิกออเดอร์ ')`)
  ok('งานเป็นยกเลิก', await phase(queued) === 'cancelled')
  const ev = await events(queued, 'job_cancelled')
  ok('ลง events 1 แถว พร้อมเหตุผล สถานี และสถานะเดิม', ev.length === 1 && ev[0].payload.reason === 'ลูกค้ายกเลิกออเดอร์'
    && ev[0].phase === 'production' && ev[0].station_code === 'print' && ev[0].payload.station_status === 'queued')
  const inbox = (await db.query(`select title, audience from public.inbox_messages where job_id = '${queued}' and kind = 'job_cancelled'`)).rows
  ok('แจ้งกล่องจดหมายทุกฝ่าย', inbox.length === 1 && /SC-CX-1/.test(inbox[0].title)
    && ['admin', 'production', 'qc', 'manager'].every(r => inbox[0].audience.includes(r)))
  ok('งานที่ยกเลิกไม่อยู่ในคิวสถานี', (await db.query(`select 1 from public.jobs where id = '${queued}' and phase in ('sample','production')`)).rows.length === 0)
  await reject('ยกเลิกซ้ำไม่ได้', U.mgr, `public.cancel_job('${queued}', 'ซ้ำ')`, /ถูกยกเลิกไปแล้ว/)
  ok('กดซ้ำไม่เพิ่ม events', (await events(queued, 'job_cancelled')).length === 1)
  await reject('งานที่ยกเลิกแล้วกดเริ่มไม่ได้', U.prod, `public.start_station('${queued}')`)

  await pass('ผู้บริหารยกเลิกงานที่กำลังเย็บ', U.mgr, `public.cancel_job('${sewing}', 'ลูกค้าไม่จ่ายมัดจำ')`)
  ok('คืนจักรทุกตัว', (await db.query(`select 1 from public.machine_assignments where job_id = '${sewing}' and released_at is null`)).rows.length === 0)
  const bookings = (await db.query(`select ends_at <= now() ended, cancelled_at is not null cancelled, starts_at > now() future from public.machine_bookings where job_id = '${sewing}' order by starts_at`)).rows
  ok('การจองที่กำลังใช้จบทันที · การจองในอนาคตถูกยกเลิก', bookings.length === 2 && bookings[0].ended && !bookings[0].cancelled && bookings[1].future && bookings[1].cancelled)

  await pass('ผู้บริหารยกเลิกงานที่พักอยู่', U.mgr, `public.cancel_job('${held}', 'ลูกค้าเปลี่ยนใจ')`)
  ok('ปัญหาที่ค้างถูกปิด', (await db.query(`select 1 from public.issues where job_id = '${held}' and closed_at is null`)).rows.length === 0)
  ok('จดจำนวนปัญหาที่ปิดใน events', (await events(held, 'job_cancelled'))[0]?.payload.issues_closed === 1)

  await reject('งานที่เสร็จแล้วยกเลิกไม่ได้', U.mgr, `public.cancel_job('${done}', 'ลูกค้ายกเลิก')`, /ผลิตเสร็จแล้ว/)
  await reject('งานที่อยู่บริษัทภายนอกต้องรับของกลับก่อน', U.mgr, `public.cancel_job('${outside}', 'ลูกค้ายกเลิก')`, /รับของกลับ/)
  ok('งานข้างนอกยังไม่ถูกยกเลิก', await phase(outside) === 'production')
  const byOwner = await jobOf('SC-CX-6', 'production', 'print', 'queued')
  await pass('เจ้าของระบบยกเลิกได้', U.owner, `public.cancel_job('${byOwner}', 'ลูกค้ายกเลิก')`)
  ok('งานของเจ้าของระบบเป็นยกเลิก', await phase(byOwner) === 'cancelled')

  const film = (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, dtf_film_ordered_at, dtf_film_eta)
    values ('SC-CX-7','ลูกค้าเบี้ยว','งานฟิล์ม','tshirt',10,'ตัว','2026-12-31','dtf','x.pdf','materials', now(), '2026-12-01')
    returning id`)).rows[0].id
  const sheet = (await db.query(`insert into public.mockup_sheets (job_id, rev) values ('${film}', 1) returning id`)).rows[0].id
  await pass('ผู้บริหารยกเลิกงานที่รอวัตถุดิบ (สั่งฟิล์มแล้ว มีม็อคอัพร่าง)', U.mgr, `public.cancel_job('${film}', 'ลูกค้ายกเลิก')`)
  await reject('งานที่ยกเลิกแล้ว บันทึกได้รับฟิล์มไม่ได้', U.admin, `public.receive_film('${film}')`, /ถูกยกเลิกแล้ว/)
  ok('ฟิล์มยังไม่ถูกบันทึกรับ', (await db.query(`select dtf_film_received_at from public.jobs where id = '${film}'`)).rows[0].dtf_film_received_at === null)
  await reject('งานที่ยกเลิกแล้ว บันทึกม็อคอัพไม่ได้', U.admin, `public.save_mockup_draft('${sheet}', 1, '{"views":[],"specs":[],"callouts":[]}'::jsonb)`, /ถูกยกเลิกแล้ว/)
  await reject('งานที่ยกเลิกแล้ว ส่งม็อคอัพให้อนุมัติไม่ได้', U.admin, `public.submit_mockup_sheet('${sheet}', 1)`, /ถูกยกเลิกแล้ว/)
  await reject('งานที่ยกเลิกแล้ว ทิ้งม็อคอัพร่างไม่ได้', U.admin, `public.discard_mockup_draft('${sheet}')`, /ถูกยกเลิกแล้ว/)

  const all = [queued, sewing, held, done, outside, byOwner, film].map(id => `'${id}'`).join(',')
  await db.exec(`alter table public.events disable trigger events_append_only;
    delete from public.inbox_messages where job_id in (${all});
    delete from public.jobs where id in (${all});
    alter table public.events enable trigger events_append_only;`)
}
