// ต้องรันหลัง queue / outsourcing: ชุดนี้ปิดงานของชุดอื่นก่อน เพื่อให้คิวของสถานีมีแค่งานในชุดนี้ · คืนค่าตั้งค่าและลบจักรทดสอบตอนจบ
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export async function sweepFixTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-000000000011', qc: '00000000-0000-0000-0000-000000000012',
    prod: '00000000-0000-0000-0000-000000000013', mgr: '00000000-0000-0000-0000-000000000014',
  }
  const firstLine = e => e.message.split('\n')[0]
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql} as r`))
  const pass = async (name, uid, sql) => {
    try { const r = await call(uid, sql); ok(name, true); return r.rows[0]?.r } catch (e) { ok(name, false, firstLine(e)) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re.test(e.message), firstLine(e)) }
  }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const job = id => one('select * from public.jobs where id = $1', [id])
  const sla = async id => (await one('select private.lead_state($1) s', [id])).s
  const jobAt = async (no, route, seq, { product = 'tshirt', phase = 'production', status = 'queued', qty = 10, sample = false } = {}) => (await one(`
    insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date,
      route_code, phase, station_seq, station_status, needs_sample, dtf_film_received_at)
    values ($1, 'ลูกค้ากวาดบั๊ก', 'งานกวาดบั๊ก', $2, $3, 'ตัว', '2026-12-31', $4, $5, $6, $7, $8, now())
    returning id`, [no, product, qty, route, phase, seq, status, sample])).id
  const retire = id => db.query(`update public.jobs set phase = 'cancelled', station_seq = null, station_status = null where id = $1`, [id])
  const machinesOf = async id => (await db.query(`select m.code from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id
    where a.job_id = $1 and a.released_at is null order by m.code`, [id])).rows.map(r => r.code)
  const liveBookings = async id => (await one(`select count(*)::int n from public.machine_bookings
    where job_id = $1 and cancelled_at is null and ends_at > now()`, [id])).n
  const lastEvent = (id, type) => one('select payload from public.events where job_id = $1 and type = $2 order by id desc limit 1', [id, type])
  const { code: delayCode } = await one('select code from public.reason_codes where active order by code limit 1')
  const report = id => `public.submit_delay_report('${id}', array['${delayCode}'], 'ทดสอบรายงานล่าช้า', now() + interval '1 day')`

  for (const { id } of (await db.query('select id from public.outsource_runs where closed_at is null')).rows) {
    await call(U.admin, `public.receive_back(${id})`)
  }
  await db.exec(`update public.jobs set phase = 'cancelled', station_status = null where phase not in ('done', 'cancelled')`)

  for (const file of ['20261127000000_develop_sample.sql', '20261128000000_sweep_fixes.sql']) {
    try { await db.exec(readFileSync(join(migrations, file), 'utf8')); ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, true) }
    catch (e) { ok(`รันซ้ำบนฐานที่ลงแล้วได้: ${file}`, false, firstLine(e)) }
  }
  ok('receive_job มีตัวเดียว (14 อาร์กิวเมนต์) ไม่มีตัวซ้ำชื่อ', (await db.query(
    `select pronargs from pg_proc where proname = 'receive_job' and pronamespace = 'public'::regnamespace`)).rows.map(r => r.pronargs).join() === '14')
  ok('job_live ยังมีคอลัมน์ develop หลังรันซ้ำ', (await one(`select count(*)::int n from information_schema.columns
    where table_schema = 'public' and table_name = 'job_live' and column_name = 'develop'`)).n === 1)
  const indexes = (await db.query(`select indexname from pg_indexes where schemaname = 'public' and indexname = any($1)`, [[
    'jobs_mockup_path_idx', 'jobs_confirmation_pdf_path_idx', 'jobs_spec_mockups_idx', 'mockup_views_image_path_idx',
    'events_at_idx', 'events_split_parent_idx']])).rows
  ok('index ของ path ไฟล์ · events ตามเวลา · งานแม่ของส่วนที่แบ่ง มีครบ 6 ตัว', indexes.length === 6, indexes.map(r => r.indexname).join())

  const saved = (await db.query(`select code, sla_days, big_qty, big_sla_days, warn_pct, machines, machine_pool from public.stations`)).rows
  const noRecipe = (await one(`select code from public.product_types pt
    where code <> 'hat' and not exists (select 1 from public.product_machine_needs n where n.product_type_code = pt.code) order by code limit 1`)).code
  await db.exec(`
    insert into public.machine_types (code, prefix, name, sort) values ('swp', 'SWP', 'จักรทดสอบกวาดบั๊ก', 990);
    insert into public.sewing_machines (code, type_code) values ('SWP-001', 'swp'), ('SWP-002', 'swp');
    insert into public.product_machine_needs (product_type_code, type_code, qty) values ('hat', 'swp', 1);
  `)
  try {
    await splitLead()
    await requeueClock()
    await queueRule()
    await noRecipeMessages()
    await sewingMachines()
    await bookings()
    await reviseRework()
    await locks()
    await renumber()
  } finally {
    await db.exec(`update public.jobs set phase = 'cancelled', station_seq = null, station_status = null where phase not in ('done', 'cancelled')`)
    for (const s of saved) {
      await db.query(`update public.stations set sla_days = $2, big_qty = $3, big_sla_days = $4, warn_pct = $5, machines = $6, machine_pool = $7 where code = $1`,
        [s.code, s.sla_days, s.big_qty, s.big_sla_days, s.warn_pct, s.machines, s.machine_pool])
    }
    await db.exec(`
      delete from public.product_machine_needs where type_code = 'swp';
      alter table public.sewing_machines disable trigger sewing_machines_guard_history;
      delete from public.machine_status_log where machine_id in (select id from public.sewing_machines where type_code = 'swp');
      delete from public.machine_bookings where machine_id in (select id from public.sewing_machines where type_code = 'swp');
      delete from public.machine_assignments where machine_id in (select id from public.sewing_machines where type_code = 'swp');
      delete from public.sewing_machines where type_code = 'swp';
      alter table public.sewing_machines enable trigger sewing_machines_guard_history;
      delete from public.machine_types where code = 'swp';
    `)
  }

  async function splitLead() {
    const overdue = async (no, qty) => {
      const id = await jobAt(no, 'normal', 2, { qty })
      await db.query(`update public.jobs set created_at = now() - interval '40 days' where id = $1`, [id])
      return id
    }
    const parent = await overdue('SC-SWP-SLA1', 600)
    const before = await sla(parent)
    ok('งาน 600 ชิ้น = 15 วันทำงาน · รับมา 40 วัน = เกินเวลาผลิต', before.lead_days === 15 && before.lead_over === true && before.lead_reported === false, JSON.stringify(before))
    const child = await pass('แบ่งงานที่เกินเวลาผลิต', U.admin, `public.split_job('${parent}', 400)`)
    const part = await sla(child)
    ok('ส่วนที่แบ่ง 400 ชิ้น ใช้จำนวนรวม 600 และวันรับงานของงานแม่ (ยังเป็น 15 วัน)',
      part.lead_qty === 600 && part.lead_days === 15 && part.lead_start === before.lead_start && part.lead_due === before.lead_due && part.lead_over === true, JSON.stringify(part))
    ok('งานแม่หลังแบ่งเหลือ 200 ชิ้น แต่กำหนดเวลาผลิตไม่เปลี่ยน', (await sla(parent)).lead_days === 15)
    await pass('งานแม่ส่งรายงานหลังแบ่ง', U.prod, report(parent))
    ok('รายงานของงานแม่หลังแบ่ง ไม่นับให้ส่วนที่แบ่ง', (await sla(parent)).lead_reported === true && (await sla(child)).lead_reported === false)
    await retire(child)
    ok('ส่วนที่แบ่งถูกยกเลิก ยังนับจำนวน → งานแม่ยัง 15 วัน (เวลาผลิตไม่หดย้อนหลัง)', (await sla(parent)).lead_qty === 600 && (await sla(parent)).lead_days === 15)

    const reported = await overdue('SC-SWP-SLA2', 10)
    await pass('งานแม่ส่งรายงานก่อนแบ่ง', U.prod, report(reported))
    const heir = await pass('แบ่งงานที่รายงานแล้ว', U.admin, `public.split_job('${reported}', 3)`)
    ok('รายงานของงานแม่ก่อนแบ่ง นับให้ส่วนที่แบ่ง', (await sla(heir)).lead_reported === true)
    const grand = await pass('แบ่งซ้ำจากส่วนที่แบ่ง', U.admin, `public.split_job('${heir}', 1)`)
    const deep = await sla(grand)
    ok('ส่วนที่แบ่งซ้ำ (-2-2) ยังนับวันจากงานแม่ต้นทาง', deep.lead_over === true && deep.lead_reported === true
      && deep.lead_start === (await sla(reported)).lead_start && deep.lead_qty === 10, JSON.stringify(deep))
    for (const id of [parent, reported, heir, grand]) await retire(id)
  }

  async function requeueClock() {
    await db.exec(`update public.stations set machines = 1, machine_pool = 'cut' where code = 'cut'`)
    const held = await jobAt('SC-SWP-RQ2', 'cut_only', 1)
    const other = await jobAt('SC-SWP-RQ3', 'cut_only', 1)
    await pass('เริ่มตัดงานแรก', U.prod, `public.start_station('${held}')`)
    await db.query(`update public.jobs set station_started_at = now() - interval '9 days' where id = $1`, [held])
    await pass('พักงานแรก', U.prod, `public.open_issue('${held}', 'ใบมีดหัก')`)
    await pass('เครื่องว่าง เริ่มงานถัดไป', U.prod, `public.start_station('${other}')`)
    await pass('แก้แล้วตอนเครื่องเต็ม', U.prod, `public.close_issue('${held}')`)
    const resume = (await lastEvent(held, 'resume')).payload
    ok('กลับเข้าคิว: บันทึกว่ารอเครื่อง (requeued + waiting)', (await job(held)).station_status === 'queued' && resume.requeued === true && resume.waiting === true, JSON.stringify(resume))
    await pass('งานถัดไปเสร็จ เครื่องว่าง', U.prod, `public.finish_station('${other}', 'cut')`)
    await pass('เริ่มงานแรกอีกครั้ง', U.prod, `public.start_station('${held}')`)
    ok('เริ่มใหม่หลังกลับเข้าคิว: เวลาเริ่มสถานีเดิมอยู่ครบ', (await one(`select station_started_at < now() - interval '8 days' as kept from public.jobs where id = $1`, [held])).kept === true)
    await pass('สถานีกลางทางกดเสร็จได้', U.prod, `public.finish_station('${held}', 'cut')`)
    const fresh = await jobAt('SC-SWP-RQ4', 'cut_only', 1)
    await pass('งานที่เริ่มครั้งแรก', U.prod, `public.start_station('${fresh}')`)
    ok('เริ่มครั้งแรกยังเริ่มนับเวลาตอนกดเริ่ม', (await one(`select station_started_at > now() - interval '1 minute' as fresh from public.jobs where id = $1`, [fresh])).fresh === true)
    for (const id of [held, other, fresh]) await retire(id)
    await db.exec(`update public.stations set machines = null where code = 'cut'`)
  }

  async function queueRule() {
    const first = await jobAt('SC-SWP-Q1', 'cut_only', 1)
    const second = await jobAt('SC-SWP-Q2', 'cut_only', 1)
    const third = await jobAt('SC-SWP-Q3', 'cut_only', 1)
    await reject('start_station ตรง: ไม่ใช่คิวแรกและยังไม่มีเหตุผล ถูกปฏิเสธ', U.prod, `public.start_station('${second}')`,
      /ไม่ใช่คิวแรกแล้ว \(คิวก่อนหน้า: SC-SWP-Q1\) กด "เริ่มก่อนคิว" แล้วใส่เหตุผล/)
    ok('ถูกปฏิเสธแล้วงานยังรอคิว ไม่มี event', (await job(second)).station_status === 'queued' && !(await lastEvent(second, 'station_start')))
    await reject('start_in_queue ไม่มีเหตุผลยังถูกปฏิเสธเหมือนเดิม', U.prod, `public.start_in_queue('${second}', null)`, /ไม่ใช่คิวแรก/)
    ok('บันทึกเหตุผลข้ามคิวก่อน', await pass('note_queue_skip', U.prod, `public.note_queue_skip('${second}', 'ผ้างานแรกยังไม่มา')`) === true)
    await pass('มีเหตุผลข้ามคิวของรอบนี้แล้ว start_station ตรงผ่าน', U.prod, `public.start_station('${second}')`)
    const skip = (await lastEvent(second, 'queue_skip')).payload
    ok('เหตุผลข้ามคิวจดรอบสถานี (visit) ไว้', skip.visit === (await job(second)).visit && skip.ahead.join() === 'SC-SWP-Q1', JSON.stringify(skip))
    await pass('start_in_queue พร้อมเหตุผล: บันทึกแล้วเริ่มในครั้งเดียว', U.prod, `public.start_in_queue('${third}', 'ลูกค้าเร่ง')`)
    ok('start_in_queue บันทึกเหตุผลข้ามคิว 1 ครั้ง', (await one(`select count(*)::int n from public.events where job_id = $1 and type = 'queue_skip'`, [third])).n === 1)
    await pass('คิวแรกเริ่มตรงได้ ไม่ต้องมีเหตุผล', U.prod, `public.start_station('${first}')`)

    const atQc = await jobAt('SC-SWP-Q0', 'cut_only', 2)
    await db.query(`update public.jobs set queue_seq = (select min(queue_seq) - 1024 from public.jobs) where id = $1`, [atQc])
    await pass('งานที่ข้ามคิวที่ตัด ตัดเสร็จไป QC', U.prod, `public.finish_station('${second}', 'cut')`)
    await reject('เหตุผลข้ามคิวของสถานีก่อนหน้าใช้กับสถานีถัดไปไม่ได้', U.qc, `public.start_station('${second}')`, /ไม่ใช่คิวแรกแล้ว \(คิวก่อนหน้า: SC-SWP-Q0\)/)

    const sewFirst = await jobAt('SC-SWP-QS1', 'plain', 2, { product: 'hat' })
    const sewSecond = await jobAt('SC-SWP-QS2', 'plain', 2, { product: 'hat' })
    await reject('start_sewing ตรง: ไม่ใช่คิวแรกและยังไม่มีเหตุผล ถูกปฏิเสธ', U.prod, `public.start_sewing('${sewSecond}')`,
      /ไม่ใช่คิวแรกแล้ว \(คิวก่อนหน้า: SC-SWP-QS1\) กด "เริ่มก่อนคิว"/)
    ok('start_sewing ถูกปฏิเสธแล้วไม่ถือจักร', (await machinesOf(sewSecond)).length === 0)
    await pass('start_in_queue ที่เย็บ: บันทึกเหตุผลแล้วเริ่มเย็บ', U.prod, `public.start_in_queue('${sewSecond}', 'ด้ายงานแรกยังไม่มา')`)
    ok('เริ่มเย็บข้ามคิวได้จักรครบชุด', (await machinesOf(sewSecond)).length === 1 && (await job(sewSecond)).station_status === 'doing')
    await pass('คิวแรกที่เย็บเริ่มตรงได้', U.prod, `public.start_sewing('${sewFirst}')`)
    for (const id of [first, second, third, atQc, sewFirst, sewSecond]) await retire(id)
    await db.exec(`update public.machine_assignments set released_at = now() where released_at is null and machine_id in (select id from public.sewing_machines where type_code = 'swp')`)
  }

  async function noRecipeMessages() {
    const message = /ยังไม่มีสูตรจักรเย็บ เย็บในโรงงานไม่ได้ · ให้เจ้าของระบบเพิ่มสูตรที่ ตั้งค่า → จักรเย็บ หรือให้แอดมินส่งงานเย็บออกบริษัทภายนอก/
    const bare = await jobAt('SC-SWP-NR1', 'plain', 2, { product: noRecipe })
    await reject('สินค้าไม่มีสูตรจักร: start_sewing บอกให้เพิ่มสูตรหรือส่งเย็บข้างนอก', U.prod, `public.start_sewing('${bare}')`, message)
    await reject('สินค้าไม่มีสูตรจักร: start_station ข้อความเดียวกัน', U.prod, `public.start_station('${bare}')`, message)
    await reject('สินค้าไม่มีสูตรจักร: assign_machines ข้อความเดียวกัน', U.prod, `public.assign_machines('${bare}', array['SWP-001'])`, message)
    await reject('สินค้าไม่มีสูตรจักร: set_job_machines ข้อความเดียวกัน', U.prod, `public.set_job_machines('${bare}', 'swp', 1)`, message)
    await reject('สินค้าไม่มีสูตรจักร: book_machines ข้อความเดียวกัน', U.prod, `public.book_machines('${bare}', ${slot(1)})`, message)
    ok('ถูกปฏิเสธทุกทาง งานยังรอเย็บ ไม่ถือจักร', (await job(bare)).station_status === 'queued' && (await machinesOf(bare)).length === 0)
    const ready = await jobAt('SC-SWP-NR2', 'plain', 2, { product: 'hat' })
    await reject('สินค้ามีสูตรจักรที่ยังไม่เริ่มเย็บ: assign_machines ยังบอกให้กดเริ่มเย็บ', U.prod, `public.assign_machines('${ready}', array['SWP-001'])`, /ยังไม่เริ่มเย็บ กด "เริ่มเย็บ" ก่อน/)
    await pass('สินค้ามีสูตรจักรเริ่มเย็บได้ (มีเหตุผลข้ามคิว)', U.prod, `public.start_in_queue('${ready}', 'ทดสอบ')`)
    await retire(bare); await retire(ready)
  }

  function slot(hour) {
    const monday = `date_trunc('week', now() at time zone 'Asia/Bangkok') + interval '7 days'`
    return `(${monday} + interval '${hour} hours') at time zone 'Asia/Bangkok', (${monday} + interval '${hour + 1} hours') at time zone 'Asia/Bangkok'`
  }

  async function sewingMachines() {
    const s1 = await jobAt('SC-SWP-S1', 'plain', 2, { product: 'hat' })
    await pass('พักงานที่ยังรอเย็บ', U.prod, `public.open_issue('${s1}', 'รอด้าย')`)
    await pass('เย็บต่องานที่พักตอนรอคิว', U.prod, `public.resume_sewing('${s1}')`)
    ok('เย็บต่องานที่พักตอนรอคิว: กลับไปรอคิว ไม่ได้จักร', (await job(s1)).station_status === 'queued' && (await machinesOf(s1)).length === 0, (await machinesOf(s1)).join())
    await pass('เริ่มเย็บหลังกลับเข้าคิว', U.prod, `public.start_sewing('${s1}')`)
    ok('เริ่มเย็บได้จักรชุดเดียวตามสูตร (1 ตัว)', (await machinesOf(s1)).join() === 'SWP-001', (await machinesOf(s1)).join())

    const s2 = await jobAt('SC-SWP-S2', 'plain', 2, { product: 'hat' })
    await db.query(`insert into public.machine_assignments (machine_id, job_id) select id, $1 from public.sewing_machines where code = 'SWP-002'`, [s2])
    const reused = await pass('งานรอเย็บที่ถือจักรอยู่แล้ว เริ่มเย็บได้', U.prod, `public.start_sewing('${s2}')`)
    ok('start_sewing ใช้จักรที่งานถืออยู่ ไม่จ่ายอีกชุด', (await machinesOf(s2)).join() === 'SWP-002' && reused?.join() === 'SWP-002', JSON.stringify(reused))

    await pass('จักรของงานแรกเสีย → พักงานอัตโนมัติ', U.prod, `public.set_machine_status('SWP-001', 'broken', 'เข็มหัก', now() + interval '2 hours')`)
    ok('จักรเสีย: งานพักและคืนจักร', (await job(s1)).station_status === 'hold' && (await machinesOf(s1)).length === 0)
    await reject('เย็บต่อตอนไม่มีจักรว่าง ถูกปฏิเสธ', U.prod, `public.resume_sewing('${s1}')`, /จักรไม่ครบ เย็บต่อไม่ได้/)
    await pass('ซ่อมเสร็จ', U.prod, `public.set_machine_status('SWP-001', 'ready')`)
    await pass('เย็บต่องานที่พักระหว่างเย็บ', U.prod, `public.resume_sewing('${s1}')`)
    ok('เย็บต่องานที่พักระหว่างเย็บ: กลับมากำลังเย็บ ได้จักรที่ขาด', (await job(s1)).station_status === 'doing' && (await machinesOf(s1)).join() === 'SWP-001')
    await pass('เย็บเสร็จงานแรก', U.prod, `public.finish_sewing('${s1}')`)
    await pass('เย็บเสร็จงานที่สอง', U.prod, `public.finish_sewing('${s2}')`)

    const s3 = await jobAt('SC-SWP-S3', 'plain', 2, { product: 'hat' })
    const s4 = await jobAt('SC-SWP-S4', 'plain', 2, { product: 'hat' })
    await db.query(`insert into public.machine_assignments (machine_id, job_id) select id, $1 from public.sewing_machines where code = 'SWP-002'`, [s3])
    await reject('เลือกจักรที่งานอื่นถืออยู่ไม่ได้', U.prod, `public.start_sewing('${s4}', array['SWP-002'])`, /SWP-002 ใช้กับงาน SC-SWP-S3/)
    await pass('เลือกจักรที่งานนี้ถืออยู่แล้วได้', U.prod, `public.start_sewing('${s3}', array['SWP-002'])`)
    ok('เลือกจักรที่ถืออยู่: ยังมีจักรตัวเดียว', (await machinesOf(s3)).join() === 'SWP-002')
    for (const id of [s1, s2, s3, s4]) await retire(id)
  }

  async function bookings() {
    const vendor = await pass('เพิ่มบริษัทรับเย็บ', U.admin, `public.add_vendor('บริษัททดสอบกวาดบั๊ก', array['cut', 'sew'], null)`)
    const plan = `now() + interval '1 hour', 2, now() + interval '3 days'`
    const out = await jobAt('SC-SWP-B1', 'plain', 1, { product: 'hat' })
    await pass('งานก่อนถึงเย็บจองจักรได้', U.prod, `public.book_machines('${out}', ${slot(9)})`)
    ok('มีการจองล่วงหน้า', await liveBookings(out) === 1)
    const run = await pass('ส่งออกบริษัทภายนอก ตัดถึงเย็บ', U.admin, `public.send_out('${out}', ${vendor}, 'sew', ${plan})`)
    ok('ส่งเย็บข้างนอกแล้วการจองจักรถูกยกเลิก', await liveBookings(out) === 0)
    await reject('งานที่ส่งเย็บข้างนอกจองจักรไม่ได้', U.prod, `public.book_machines('${out}', ${slot(10)})`, /ส่งเย็บที่บริษัทภายนอก ไม่ต้องจองจักร/)
    await pass('รับของกลับ', U.admin, `public.receive_back(${run})`)
    await reject('งานที่ผ่านเย็บไปแล้วจองจักรไม่ได้', U.prod, `public.book_machines('${out}', ${slot(10)})`, /เย็บเสร็จแล้ว จองจักรไม่ได้/)

    const sample = await jobAt('SC-SWP-B2', 'plain', 1, { product: 'hat', phase: 'sample', sample: true })
    await pass('งานตัวอย่างจองจักรล่วงหน้า', U.prod, `public.book_machines('${sample}', ${slot(11)})`)
    await pass('ส่งตัวอย่างเย็บข้างนอก', U.admin, `public.send_out('${sample}', ${vendor}, 'sew', ${plan})`)
    ok('ตัวอย่างส่งเย็บข้างนอก: การจองล่วงหน้าของผลิตจริงยังอยู่ (เหมือนตอนออกจากสถานีเย็บ)', await liveBookings(sample) === 1)

    const jump = await jobAt('SC-SWP-B3', 'plain', 1, { product: 'hat' })
    await pass('จองจักรให้งานที่ตัด', U.prod, `public.book_machines('${jump}', ${slot(12)})`)
    await db.query(`update public.jobs set station_seq = 3 where id = $1`, [jump])
    ok('งานข้ามสถานีเย็บไป QC: การจองถูกยกเลิก', await liveBookings(jump) === 0)

    const noSew = await jobAt('SC-SWP-B4', 'cut_only', 1, { product: 'hat' })
    await reject('เส้นทางไม่มีสถานีเย็บ จองจักรไม่ได้', U.prod, `public.book_machines('${noSew}', ${slot(13)})`, /เส้นทางที่ไม่มีสถานีเย็บ ไม่ต้องจองจักร/)
    await pass('QC เริ่มตรวจงานที่รับกลับ', U.qc, `public.start_in_queue('${out}', 'ทดสอบ')`)
    await pass('QC ส่งแก้กลับไปตัด', U.qc, `public.send_rework('${out}', 2, 'ตัดคลาด', 'cut')`)
    await reject('งานแก้ที่สถานีก่อนเย็บ (กลับ QC เลย) จองจักรไม่ได้', U.prod, `public.book_machines('${out}', ${slot(13)})`, /งานแก้นี้.*ไม่ผ่านสถานีเย็บ/)
    await db.query(`update public.jobs set phase = 'done', station_seq = null, station_status = null where id = $1`, [jump])
    await reject('งานเสร็จแล้วจองจักรไม่ได้', U.prod, `public.book_machines('${jump}', ${slot(13)})`, /เสร็จแล้ว จองจักรไม่ได้/)
    const closing = await jobAt('SC-SWP-B5', 'plain', 1, { product: 'hat' })
    await pass('จองจักรให้งานที่จะถูกปิด', U.prod, `public.book_machines('${closing}', ${slot(14)})`)
    await db.query(`update public.jobs set phase = 'done', station_seq = null, station_status = null where id = $1`, [closing])
    ok('งานจบแล้วไม่เหลือการจองจักร', await liveBookings(closing) === 0)
    await db.query(`update public.outsource_runs set closed_at = now() where closed_at is null and job_id = $1`, [sample])
    await db.exec(`alter table public.jobs disable trigger jobs_guard_outsourced`)
    for (const id of [out, sample, noSew]) await retire(id)
    await db.exec(`alter table public.jobs enable trigger jobs_guard_outsourced`)
  }

  async function reviseRework() {
    const id = await jobAt('SC-SWP-RV1', 'cut_only', 2)
    const spec = JSON.stringify({ app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'SC-SWP-RV1', rev: 1 }, p: { tshirt: {} } })
    const revise = (qty, rev) => `public.revise_job_spec('${id}', '${spec}'::jsonb, ${rev}, 'ลูกค้ากวาดบั๊ก', 'งานกวาดบั๊ก', ${qty}, 0, '2026-12-31', false, '{}'::text[])`
    await pass('QC เริ่มตรวจ', U.qc, `public.start_in_queue('${id}', 'ทดสอบ')`)
    await pass('QC ผ่าน 6 ชิ้น', U.qc, `public.record_qc('${id}', 6)`)
    await pass('ส่งแก้ 4 ชิ้นกลับไปตัด', U.qc, `public.send_rework('${id}', 4, 'ตัดคลาด', 'cut')`)
    await reject('งานกำลังแก้: ลดจำนวนจนไม่เหลือชิ้นที่กำลังแก้ ถูกปฏิเสธ', U.admin, revise(6, 1), /กำลังแก้ 4 ชิ้น \(QC ผ่านแล้ว 6 ชิ้น\) ลดจำนวนเหลือ 6 ไม่ได้ .* ใส่จำนวนอย่างน้อย 7/)
    ok('ถูกปฏิเสธแล้วจำนวนและจำนวนส่งแก้คงเดิม', (await job(id)).qty === 10 && (await job(id)).rework_qty === 4)
    const result = await pass('งานกำลังแก้: ลดจำนวน 10 → 8', U.admin, revise(8, 1))
    const after = await job(id)
    ok('ลดจำนวนตอนเป็นงานแก้: จำนวนส่งแก้ลดเหลือชิ้นที่ยังไม่ผ่าน (2)', result?.changed === true && after.qty === 8 && after.rework_qty === 2, `${after.qty} / ${after.rework_qty}`)
    const summary = (await lastEvent(id, 'spec_revised')).payload.summary
    ok('ประวัติแก้ใบบอกว่าจำนวนส่งแก้เปลี่ยน', summary.includes('จำนวนส่งแก้ 4 → 2'), JSON.stringify(summary))
    await pass('เพิ่มจำนวนกลับ 8 → 9 จำนวนส่งแก้ไม่เปลี่ยน', U.admin, revise(9, 2))
    ok('เพิ่มจำนวนไม่แตะจำนวนส่งแก้', (await job(id)).rework_qty === 2)
    await retire(id)
  }

  async function locks() {
    const held = async (key, uid, sql) => {
      await db.exec('begin')
      try {
        await call(uid, sql)
        return (await one(`select count(*)::int n from pg_locks where locktype = 'advisory'
          and objid = (hashtext($1)::bigint & 4294967295)::oid`, [key])).n > 0
      } catch { return null } finally { await db.exec('rollback') }
    }
    const id = await jobAt('SC-SWP-L1', 'plain', 2, { product: 'hat' })
    await pass('เริ่มเย็บ', U.prod, `public.start_sewing('${id}')`)
    ok('set_job_machines ล็อกการเลือกจักรตัวเดียวกับ start_sewing', await held('pp142.sewing_machines', U.prod, `public.set_job_machines('${id}', 'swp', 2)`) === true)
    await pass('พักงานเย็บ', U.prod, `public.open_issue('${id}', 'รอด้าย')`)
    ok('resume_sewing ล็อกการเลือกจักรตัวเดียวกับ start_sewing', await held('pp142.sewing_machines', U.prod, `public.resume_sewing('${id}')`) === true)
    ok('release_machines ไม่ได้เลือกจักร จึงไม่ล็อก (การตรวจล็อกแยกได้จริง)', false === (await held('pp142.sewing_machines', U.prod, `public.release_machines('${id}')`)))
    const spec = JSON.stringify({ product: 'hat', h: { doc_no: 'SC-SWP-L1' }, p: { hat: { note: 'ก' } } })
    ok('revise_job_spec ล็อกคิวตัวเดียวกับ split_job ก่อนหาครอบครัวงาน', await held('pp142.job_queue', U.admin,
      `public.revise_job_spec('${id}', '${spec}'::jsonb, 1, 'ลูกค้ากวาดบั๊ก', 'งานกวาดบั๊ก', 10, 0, '2026-12-31', false, '{}'::text[])`) === true)
    await retire(id)
  }

  async function renumber() {
    const done = await jobAt('SC-SWP-N0', 'cut_only', 1)
    const a = await jobAt('SC-SWP-N1', 'cut_only', 1)
    const b = await jobAt('SC-SWP-N2', 'cut_only', 1)
    const c = await jobAt('SC-SWP-N3', 'cut_only', 1)
    await db.query(`update public.jobs set phase = 'done', station_seq = null, station_status = null where id = $1`, [done])
    await pass('แทรกงานที่ 3 ขึ้นก่อนงานที่ 1', U.prod, `public.move_job_ahead('${c}', '${a}', 'ลูกค้าเร่ง')`)
    const seqs = async () => (await db.query(`select id, confirmation_no, phase, queue_seq::text q from public.jobs`)).rows
    const before = await seqs()
    await db.exec('select private.queue_renumber()')
    const after = await seqs()
    const finished = before.filter(r => ['done', 'cancelled'].includes(r.phase))
    ok('จัดเลขคิวใหม่: งานที่เสร็จ/ยกเลิกทุกงานคงเลขเดิม', finished.length > 3 && finished.every(r => after.find(x => x.id === r.id).q === r.q)
      && after.find(x => x.id === done).q === before.find(x => x.id === done).q)
    const order = list => list.filter(r => !['done', 'cancelled'].includes(r.phase)).sort((x, y) => Number(x.q) - Number(y.q)).map(r => r.confirmation_no).join()
    ok('จัดเลขคิวใหม่: ลำดับงานที่ยังไม่จบเหมือนเดิม', order(after) === order(before) && order(after) === 'SC-SWP-N3,SC-SWP-N1,SC-SWP-N2', order(after))
    const live = after.filter(r => !['done', 'cancelled'].includes(r.phase)).map(r => Number(r.q)).sort((x, y) => x - y)
    const top = Math.max(...before.map(r => Number(r.q)))
    ok('จัดเลขคิวใหม่: เลขใหม่ห่างกัน 1024 และอยู่เหนือทุกเลขเดิม ไม่ชนงานที่จบแล้ว',
      live.every((q, i) => q > top && (i === 0 || q - live[i - 1] === 1024)) && new Set(after.map(r => r.q)).size === after.length, live.join())
    const next = await jobAt('SC-SWP-N4', 'cut_only', 1)
    ok('งานที่รับเข้าหลังจัดเลข ต่อท้ายคิว', Number((await job(next)).queue_seq) === live.at(-1) + 1024, String((await job(next)).queue_seq))
    await reject('หลังจัดเลขใหม่ งานท้ายคิวยังเริ่มตรงไม่ได้ถ้าไม่มีเหตุผล', U.prod, `public.start_station('${next}')`, /คิวก่อนหน้า: SC-SWP-N3, SC-SWP-N1, SC-SWP-N2/)
    await pass('หลังจัดเลขใหม่ คิวแรกเริ่มได้', U.prod, `public.start_station('${c}')`)
  }
}
