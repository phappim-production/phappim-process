export async function stationMachineTests({ db, ok, as }) {
  const prod = '00000000-0000-0000-0000-000000000013'
  const call = sql => as(prod, () => db.query(`select ${sql}`))
  const pass = async (name, sql) => {
    try { await call(sql); ok(name, true) } catch (e) { ok(name, false, e.message.split('\n')[0]) }
  }
  const reject = async (name, sql, re) => {
    try { await call(sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') } catch (e) { ok(name, re.test(e.message), e.message.split('\n')[0]) }
  }
  const status = async id => (await db.query(`select station_status from public.jobs where id = '${id}'`)).rows[0].station_status
  const jobAt = async (no, route, seq) => (await db.query(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, confirmation_pdf_path, phase, station_seq, station_status, dtf_film_received_at)
    values ('${no}','ลูกค้าทดสอบ','งานทดสอบเครื่อง','tshirt',10,'ตัว','2026-12-31','${route}','x.pdf','production',${seq},'queued', now())
    returning id`)).rows[0].id

  // ชุดอื่นทิ้งงานกำลังทำไว้ในฐานเดียวกัน → ตั้งจำนวนเครื่อง = งานที่ทำอยู่แล้ว + เครื่องว่างที่ต้องการทดสอบ
  const busy = async codes => (await db.query(`select count(*)::int n from public.jobs j
    where j.phase in ('sample','production') and j.station_status = 'doing'
      and private.station_at(j.route_code, j.station_seq) = any(array['${codes.join("','")}'])`)).rows[0].n
  await db.exec(`update public.stations set machines = ${await busy(['print']) + 2}, machine_pool = 'print' where code = 'print';
    update public.stations set machines = ${await busy(['press', 'dtf_press']) + 1}, machine_pool = 'heat_press' where code in ('press', 'dtf_press')`)
  try {
    const p1 = await jobAt('SC-MC-P1', 'normal', 1)
    const p2 = await jobAt('SC-MC-P2', 'normal', 1)
    const p3 = await jobAt('SC-MC-P3', 'normal', 1)
    await pass('เครื่องพิมพ์ 2 เครื่อง: เริ่มงานที่ 1 ได้', `public.start_station('${p1}')`)
    await pass('เครื่องพิมพ์ 2 เครื่อง: เริ่มงานที่ 2 ได้', `public.start_station('${p2}')`)
    await reject('เครื่องพิมพ์เต็ม: เริ่มงานที่ 3 ไม่ได้ · บอกว่างานไหนใช้เครื่องอยู่', `public.start_station('${p3}')`, /เต็ม .*SC-MC-P1, SC-MC-P2\)/)
    await reject('เริ่มข้ามคิวก็ติดเครื่องเต็มเหมือนกัน', `public.start_in_queue('${p3}', 'ด่วน')`, /เต็ม/)
    await pass('งานที่ติดปัญหายกลงได้ (พักงาน)', `public.open_issue('${p1}', 'หมึกหมด')`)
    await pass('พักงานแล้วเครื่องว่าง: เริ่มงานอื่นได้', `public.start_station('${p3}')`)
    await pass('แก้ปัญหาแล้วตอนเครื่องเต็ม: กดแก้แล้วได้', `public.close_issue('${p1}', 'เติมหมึกแล้ว')`)
    ok('แก้แล้วตอนเครื่องเต็ม → กลับเข้าคิวรอเริ่ม ไม่ใช่กำลังทำ', await status(p1) === 'queued')
    const ev = (await db.query(`select payload from public.events where job_id = '${p1}' and type = 'resume' order by id desc limit 1`)).rows[0].payload
    ok('บันทึกว่ากลับเข้าคิวเพราะเครื่องเต็ม', ev.requeued === true)

    const d1 = await jobAt('SC-MC-D1', 'dtf', 2)
    const r1 = await jobAt('SC-MC-R1', 'normal', 2)
    await pass('รีดฟิล์มเริ่มได้เมื่อเครื่องรีดร้อนว่าง', `public.start_station('${d1}')`)
    await reject('รีดใช้เครื่องรีดร้อนตัวเดียวกับรีดฟิล์ม: เต็มแล้วเริ่มรีดไม่ได้', `public.start_station('${r1}')`, /เต็ม .*SC-MC-D1\)/)
    await db.exec(`update public.stations set machines = null where code in ('press', 'dtf_press')`)
    await pass('สถานีที่ไม่จำกัดเครื่อง (null) เริ่มได้เสมอ', `public.start_station('${r1}')`)
  } finally {
    await db.exec(`update public.stations set machines = null`)
  }
}
