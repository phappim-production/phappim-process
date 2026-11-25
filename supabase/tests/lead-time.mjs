// วันที่ตายตัว: พ.ย. 2569 วันที่ 1 เป็นวันอาทิตย์
export async function leadTimeTests({ db, ok }) {
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
  const dayN = (start, n) => val(`select private.lead_day_n($1::date, $2)::text`, [start, n])
  const used = (from, to) => val(`select private.lead_used($1::date, $2::date)`, [from, to])

  const days = await Promise.all([1, 499, 500, 999, 1000, 5000].map(q => val('select private.lead_days($1)', [q])))
  ok('เวลาผลิต: 1–499 = 10 · 500–999 = 15 · 1000 ขึ้นไป = 20 วันทำงาน', days.join() === '10,10,15,15,20,20', days.join())

  ok('รับงานจันทร์ 2 พ.ย. · วันที่ 10 = พฤหัส 12 พ.ย. (ไม่นับอาทิตย์)', await dayN('2026-11-02', 10) === '2026-11-12')
  ok('รับงานจันทร์ 2 พ.ย. · วันที่ 15 = พุธ 18 พ.ย.', await dayN('2026-11-02', 15) === '2026-11-18')
  ok('รับงานจันทร์ 2 พ.ย. · วันที่ 20 = อังคาร 24 พ.ย.', await dayN('2026-11-02', 20) === '2026-11-24')
  ok('รับงานวันอาทิตย์ นับวันที่ 1 เป็นวันจันทร์', await dayN('2026-11-01', 1) === '2026-11-02' && await dayN('2026-11-01', 10) === '2026-11-12')
  ok('ข้ามเดือนและปี: รับ 24 ธ.ค. วันที่ 10 = 4 ม.ค. (ตรงกับหน้าเว็บ)', await dayN('2026-12-24', 10) === '2027-01-04')
  ok('รับงานวันเสาร์ = วันที่ 1 · วันที่ 2 ข้ามอาทิตย์ไปจันทร์', await dayN('2026-11-07', 1) === '2026-11-07' && await dayN('2026-11-07', 2) === '2026-11-09')
  ok('นับวันที่ใช้ไป รวมวันรับงาน ไม่นับอาทิตย์', await used('2026-11-02', '2026-11-12') === 10 && await used('2026-11-01', '2026-11-01') === 0
    && await used('2026-11-07', '2026-11-09') === 2)

  await db.exec('begin')
  try {
    const make = async (no, qty) => val(`insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit,
      due_date, route_code, phase, station_seq, station_status, created_at)
      values ($1, 'ลูกค้าเวลาผลิต', 'งานเวลาผลิต', 'tshirt', $2, 'ตัว', '2026-12-31', 'cut_only', 'production', 1, 'queued', '2026-11-02 08:00+07')
      returning id`, [no, qty])
    const at = (id, day) => val(`select private.lead_state($1, $2::date)`, [id, day])
    const id = await make('SC-LEAD-10', 10)
    const s7 = await at(id, '2026-11-09'), s8 = await at(id, '2026-11-10'), s10 = await at(id, '2026-11-12'), s11 = await at(id, '2026-11-13')
    ok('วันที่ 7 ยังไม่เตือน', s7.lead_used === 7 && !s7.lead_warn && !s7.lead_over, JSON.stringify(s7))
    ok('วันที่ 8 (80% ของ 10) เตือน', s8.lead_used === 8 && s8.lead_warn && !s8.lead_over && s8.lead_warn_on === '2026-11-10', JSON.stringify(s8))
    ok('วันที่ 10 = วันครบ ยังไม่เกิน', s10.lead_due === '2026-11-12' && s10.lead_warn && !s10.lead_over, JSON.stringify(s10))
    ok('วันที่ 11 เกินเวลาผลิต', s11.lead_used === 11 && s11.lead_over && !s11.lead_reported, JSON.stringify(s11))
    ok('วันอาทิตย์หลังวันครบ = เกิน', (await at(id, '2026-11-15')).lead_over === true)

    const big = await make('SC-LEAD-500', 500)
    const b = await at(big, '2026-11-13')
    ok('งาน 500 ชิ้น วันที่ 11 ยังไม่เกิน (15 วัน) · เตือนวันที่ 12', b.lead_days === 15 && !b.lead_warn && !b.lead_over && b.lead_due === '2026-11-18', JSON.stringify(b))
    const huge = await make('SC-LEAD-1000', 1000)
    ok('งาน 1000 ชิ้น ครบวันอังคาร 24 พ.ย.', (await at(huge, '2026-11-24')).lead_over === false && (await at(huge, '2026-11-25')).lead_over === true)

    const late = await make('SC-LEAD-UTC', 10)
    await db.query(`update public.jobs set created_at = '2026-11-01 20:00Z' where id = $1`, [late])
    ok('รับงานตี 3 เวลาไทย (ยังเป็นวันก่อนตามเวลาสากล) นับตามวันที่ไทย', (await at(late, '2026-11-12')).lead_start === '2026-11-02')

    const visit = await val('select visit from public.jobs where id = $1', [id])
    const report = when => db.query(`insert into public.delay_reports (job_id, visit, reasons, detail, new_eta, at)
      values ($1, $2, array['M1'], 'ทดสอบ', '2026-12-01', $3)`, [id, visit, when])
    await report('2026-11-09 10:00+07')
    ok('รายงานก่อนถึงวันเตือน ไม่นับ', (await at(id, '2026-11-13')).lead_reported === false)
    await report('2026-11-10 09:00+07')
    ok('รายงานตั้งแต่วันเตือน นับ', (await at(id, '2026-11-13')).lead_reported === true)

    const done = await make('SC-LEAD-DONE', 10)
    await db.query(`update public.jobs set phase = 'done', station_seq = null, station_status = null, finished_at = '2026-11-12 23:30+07' where id = $1`, [done])
    ok('เสร็จวันครบตอน 23:30 เวลาไทย = ทัน (วันหลังจากนั้นไม่นับ)', (await at(done, '2026-12-20')).lead_over === false)
    await db.query(`update public.jobs set finished_at = '2026-11-12 18:00Z' where id = $1`, [done])
    ok('เสร็จตี 1 ของวันถัดไปเวลาไทย = เกิน', (await at(done, '2026-11-12')).lead_over === true)

    const develop = await make('SC-LEAD-DEV', 10)
    await db.query(`update public.jobs set develop = true, needs_sample = true where id = $1`, [develop])
    ok('งาน Develop ไม่มีเวลาผลิต', Object.keys(await at(develop, '2026-11-30')).length === 0)
    const cancelled = await make('SC-LEAD-CXL', 10)
    await db.query(`update public.jobs set phase = 'cancelled', station_seq = null, station_status = null where id = $1`, [cancelled])
    ok('งานที่ยกเลิกไม่มีเวลาผลิต', Object.keys(await at(cancelled, '2026-11-30')).length === 0)

    const parent = await make('SC-LEAD-SPLIT', 300)
    const part = await make('SC-LEAD-SPLIT-B', 300)
    await db.query(`insert into public.events (job_id, type, payload) values ($1, 'job_split_from', '{"parent":"SC-LEAD-SPLIT"}')`, [part])
    const before = await at(parent, '2026-11-14')
    ok('งาน 600 ชิ้นแบ่งเป็น 300 + 300 ยังเป็น 15 วัน ครบ 18 พ.ย.', before.lead_days === 15 && before.lead_due === '2026-11-18' && !before.lead_over, JSON.stringify(before))
    await db.query(`update public.jobs set phase = 'cancelled', station_seq = null, station_status = null where id = $1`, [part])
    const after = await at(parent, '2026-11-14')
    ok('ยกเลิกส่วนที่แบ่ง เวลาผลิตของส่วนที่เหลือไม่หดย้อนหลัง (ยัง 15 วัน ไม่เกิน)', after.lead_days === 15 && after.lead_due === '2026-11-18' && !after.lead_over, JSON.stringify(after))

    const overdue = await make('SC-LEAD-INBOX', 10)
    const fresh = await make('SC-LEAD-FRESH', 10)
    await db.query(`update public.jobs set created_at = now() - interval '40 days' where id = $1`, [overdue])
    await db.query(`update public.jobs set created_at = now() where id = $1`, [fresh])
    await db.query('select private.inbox_scan_all()')
    const msg = (await db.query(`select title, body, audience::text from public.inbox_messages where kind = 'sla_over' and dedupe_key = $1`, ['lead:' + overdue])).rows[0]
    ok('เกินเวลาผลิต แจ้งฝ่ายผลิต/แอดมิน/ผู้บริหาร พร้อมวันรับงานและวันครบ', msg?.title === 'เกินเวลาผลิต SC-LEAD-INBOX'
      && /รับงาน \d+\/\d+\/\d{4} · เวลาผลิต 10 วันทำงาน ครบ \d+\/\d+\/\d{4}/.test(msg.body) && msg.audience === '{production,admin,manager}', JSON.stringify(msg))
    await db.query('select private.inbox_scan_all()')
    ok('แจ้งเตือนเกินเวลาผลิตครั้งเดียวต่องาน', Number(await val(`select count(*) from public.inbox_messages where dedupe_key = $1`, ['lead:' + overdue])) === 1)
    ok('งานที่ยังไม่เกิน ไม่แจ้งเตือน', Number(await val(`select count(*) from public.inbox_messages where dedupe_key = $1`, ['lead:' + fresh])) === 0)
  } finally {
    await db.exec('rollback')
  }
}
