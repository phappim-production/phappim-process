// ปีในช่องวันที่ต้องเป็น ค.ศ. · ข้อความแจ้งเตือนแสดงปี พ.ศ.
export async function ceYearTests({ db, ok }) {
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] ?? {})[0]
  const reject = async (name, sql, args = []) => {
    await db.exec('savepoint ce')
    try { await db.query(sql, args); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, /ปี \d+ ไม่ถูกต้อง · ระบบใช้ปี ค\.ศ\./.test(e.message), e.message.split('\n')[0]) }
    finally { await db.exec('rollback to savepoint ce') }
  }
  const pass = async (name, sql, args = []) => {
    await db.exec('savepoint ce')
    try { await db.query(sql, args); ok(name, true) }
    catch (e) { ok(name, false, e.message.split('\n')[0]) }
    finally { await db.exec('rollback to savepoint ce') }
  }

  await db.exec('begin')
  try {
    const job = await val(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit,
      due_date, route_code, phase, station_seq, station_status)
      values ('SC-CE-1', 'ลูกค้าปี', 'งานปี', 'tshirt', 10, 'ตัว', '2026-12-31', 'dtf', 'production', 1, 'queued') returning id`)
    const insertJob = due => `insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code)
      values ('SC-CE-${due.slice(0, 4)}', 'ลูกค้าปี', 'งานปี', 'tshirt', 10, 'ตัว', '${due}', 'cut_only')`

    await reject('กำหนดส่งปี 2569 (พิมพ์ พ.ศ.) ถูกปฏิเสธ', insertJob('2569-12-31'))
    await reject('กำหนดส่งปี 1999 ถูกปฏิเสธ', insertJob('1999-12-31'))
    await pass('กำหนดส่งปี ค.ศ. 2026 ผ่าน', insertJob('2026-12-31'))
    await pass('กำหนดส่งปี 2399 (ขอบบน) ผ่าน', insertJob('2399-12-31'))
    await reject('แก้กำหนดส่งเป็นปี 2570 ถูกปฏิเสธ', `update public.jobs set due_date = '2570-01-05' where id = $1`, [job])
    await reject('วันคาดว่าได้รับฟิล์มปี 2569 ถูกปฏิเสธ', `update public.jobs set dtf_film_eta = '2569-12-01' where id = $1`, [job])
    await pass('แก้คอลัมน์อื่นของงาน ไม่ตรวจปีซ้ำ', `update public.jobs set customer_name = 'ลูกค้าปีใหม่' where id = $1`, [job])

    const visit = await val('select visit from public.jobs where id = $1', [job])
    await reject('วันคาดว่าเสร็จใหม่ในรายงานล่าช้าปี 2569 ถูกปฏิเสธ', `insert into public.delay_reports (job_id, visit, reasons, detail, new_eta)
      values ($1, $2, array['M1'], 'ทดสอบ', '2569-12-01 10:00+07')`, [job, visit])
    await pass('รายงานล่าช้าปี 2026 ผ่าน', `insert into public.delay_reports (job_id, visit, reasons, detail, new_eta)
      values ($1, $2, array['M1'], 'ทดสอบ', '2026-12-01 10:00+07')`, [job, visit])
    await reject('วันลูกค้ายืนยันตัวอย่างปี 2569 ถูกปฏิเสธ', `insert into public.sample_results (job_id, round, result, customer_confirmed_at)
      values ($1, 1, 'pass', '2569-11-30')`, [job])

    const machine = await val(`select id from public.sewing_machines order by id limit 1`)
    if (machine) {
      await reject('เวลาซ่อมเสร็จปี 2569 ถูกปฏิเสธ', `update public.sewing_machines set repair_eta = '2569-12-01 10:00+07' where id = $1`, [machine])
      await reject('ประวัติจักรที่มีเวลาซ่อมปี 2569 ถูกปฏิเสธ', `insert into public.machine_status_log (machine_id, status, repair_eta)
        values ($1, 'broken', '2569-12-01 10:00+07')`, [machine])
      await reject('จองจักรปี 2569 ถูกปฏิเสธ', `insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at)
        values ($1, $2, '2569-12-01 09:00+07', '2569-12-01 12:00+07')`, [machine, job])
    } else ok('มีจักรในฐานทดสอบ (ตรวจเวลาซ่อม/จอง)', false)

    const vendor = await val(`insert into public.vendors (name) values ('บริษัทปีทดสอบ') returning id`)
    await reject('ส่งข้างนอกวันถึงปี 2569 ถูกปฏิเสธ', `insert into public.outsource_runs (job_id, vendor_id, stations, qty, arrive_at, lead_days, back_at)
      values ($1, $2, array['print'], 10, '2569-12-01 09:00+07', 2, '2569-12-03 09:00+07')`, [job, vendor])

    await db.query(`update public.jobs set due_date = (now() at time zone 'Asia/Bangkok')::date, dtf_film_eta = (now() at time zone 'Asia/Bangkok')::date - 3 where id = $1`, [job])
    await db.query(`update public.jobs set dtf_film_ordered_at = now() - interval '5 days', dtf_film_received_at = null where id = $1`, [job])
    await db.query('select private.inbox_scan_all()')
    const be = await val(`select extract(year from (now() at time zone 'Asia/Bangkok'))::int + 543`)
    const due = await val(`select body from public.inbox_messages where kind = 'due_soon' and job_id = $1`, [job])
    const film = await val(`select body from public.inbox_messages where kind = 'film_late' and job_id = $1`, [job])
    ok('แจ้งเตือนกำหนดส่งแสดงปี พ.ศ. ไม่ใช่ ค.ศ.', new RegExp(`กำหนดส่ง \\d+/\\d+/${be}$`).test(due ?? '') && !/\/20\d\d\b/.test(due ?? ''), due)
    ok('แจ้งเตือนฟิล์มเลยกำหนดแสดงปี พ.ศ.', new RegExp(`กำหนดรับ \\d+/\\d+/${be} `).test(film ?? ''), film)
  } finally {
    await db.exec('rollback')
  }
}
