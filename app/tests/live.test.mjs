import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dueDate, thaiError, toBookings, toJobs, toMachines, toNeeds } from '../src/data/live.ts'
import { checkStartSewing, machineState } from '../src/proto/sewing.ts'
import { isOverdue, missingDepts } from '../src/proto/model.ts'

const row = over => ({
  id: 'j1', confirmation_no: 'SC1', customer_name: 'ลูกค้า', job_name: 'งาน', product_type_code: 'polo', qty: 100, unit: 'ตัว',
  due_date: '2026-11-20', route_code: 'plain', phase: 'production', current_station: 'sew', station_status: 'queued',
  stage_entered_at: '2026-11-17T02:00:00Z', sample_round: 1, materials_waiting_depts: null, dtf_film_eta: null,
  dtf_film_received_at: null, sew_count: 0, is_rework: false, rework_qty: null, hold_reason: null, finished_at: null, ...over,
})
const products = [{ code: 'polo', name: 'เสื้อโปโล' }]

test('กำหนดส่งเป็นวันที่ไทย ไม่เพี้ยนตามเขตเวลาเครื่อง', () => {
  assert.equal(dueDate('2026-11-20').toISOString(), '2026-11-20T10:00:00.000Z')
})

test('งานจากฐานข้อมูล: ชื่อสินค้า · สถานี · สถานะ', () => {
  const [j] = toJobs([row()], products, [], [])
  assert.equal(j.no, 'SC1')
  assert.equal(j.product, 'เสื้อโปโล')
  assert.equal(j.productCode, 'polo')
  assert.equal(j.station, 'sew')
  assert.equal(j.status, 'queued')
  assert.equal(j.film, undefined)
})

test('วัตถุดิบ: ฝ่ายที่ยังรอ = ยังไม่ติ๊ก · ฝ่ายอื่นถือว่าครบ', () => {
  const [j] = toJobs([row({ phase: 'materials', current_station: null, station_status: null, materials_waiting_depts: ['qc'] })], products, [], [])
  assert.deepEqual(missingDepts(j), ['qc'])
  assert.equal(j.station, undefined)
})

test('งานยกเลิกไม่ขึ้นบอร์ด · งานเสร็จมีเวลาเสร็จ', () => {
  const jobs = toJobs([row({ id: 'a', phase: 'cancelled' }), row({ id: 'b', phase: 'done', current_station: null, finished_at: '2026-11-17T03:00:00Z' })], products, [], [])
  assert.deepEqual(jobs.map(j => j.id), ['b'])
  assert.equal(jobs[0].doneAt.toISOString(), '2026-11-17T03:00:00.000Z')
})

test('DTF: มีฟิล์มเมื่อสั่งแล้ว · ได้รับแล้วหรือยัง', () => {
  const [wait, got] = toJobs([
    row({ id: 'w', route_code: 'dtf', dtf_film_eta: '2026-11-19' }),
    row({ id: 'g', route_code: 'dtf', dtf_film_eta: '2026-11-19', dtf_film_received_at: '2026-11-18T01:00:00Z' }),
  ], products, [], [])
  assert.deepEqual([wait.film.received, got.film.received], [false, true])
})

test('DTG / สกรีน มีฟิล์มเหมือน DTF · ปักไม่มี · ขึ้นตัวอย่างหรือไม่ตามที่รับงาน', () => {
  const [g, s, e] = toJobs([
    row({ id: 'g', route_code: 'dtg', dtf_film_eta: '2026-11-19', needs_sample: false }),
    row({ id: 's', route_code: 'screen', dtf_film_eta: '2026-11-19' }),
    row({ id: 'e', route_code: 'emb', dtf_film_eta: '2026-11-19' }),
  ], products, [], [])
  assert.deepEqual([!!g.film, !!s.film, !!e.film], [true, true, false])
  assert.deepEqual([g.needsSample, s.needsSample], [false, true])
})

test('งานแก้: จำนวนและสาเหตุล่าสุดจากผล QC', () => {
  const reworks = [
    { job_id: 'j1', failed: 2, reasons: ['สีเพี้ยน'], at: '2026-11-17T01:00:00Z' },
    { job_id: 'j1', failed: 3, reasons: ['ตะเข็บหลุด'], at: '2026-11-17T05:00:00Z' },
  ]
  const [j] = toJobs([row({ is_rework: true, rework_qty: 3 })], products, reworks, [])
  assert.deepEqual(j.rework, { qty: 3, reason: 'ตะเข็บหลุด' })
})

test('รายงานปัญหาระหว่างเย็บ: รายงานแบบทำต่อ และแบบพักงาน เรียงตามเวลา', () => {
  const events = [
    { job_id: 'j1', type: 'hold', payload: { reason: 'จักรเสีย' }, at: '2026-11-17T04:00:00Z' },
    { job_id: 'j1', type: 'sewing_issue_reported', payload: { reason: 'ด้ายขาดบ่อย' }, at: '2026-11-17T03:00:00Z' },
    { job_id: 'j1', type: 'hold', payload: {}, at: '2026-11-17T05:00:00Z' },
  ]
  const [j] = toJobs([row()], products, [], events)
  assert.deepEqual(j.sewingReports.map(r => [r.reason, r.paused]), [['ด้ายขาดบ่อย', false], ['จักรเสีย', true]])
})

test('จักร: งานที่ใช้อยู่ · อาการ · เวลาซ่อม · เรียงตามลำดับ', () => {
  const ms = toMachines([
    { id: 2, code: 'OL4-001', type_code: 'ovl4', status: 'ready', note: null, repair_eta: null, sort: 401 },
    { id: 1, code: 'SN-001', type_code: 'single', status: 'broken', note: 'เข็มหัก', repair_eta: '2026-11-18T03:00:00Z', sort: 1001 },
  ], [{ machine_id: 2, job_id: 'j1' }])
  assert.deepEqual(ms.map(m => [m.code, machineState(m)]), [['OL4-001', 'busy'], ['SN-001', 'broken']])
  assert.equal(ms[0].jobId, 'j1')
  assert.equal(ms[1].note, 'เข็มหัก')
  assert.equal(ms[1].repairEta.toISOString(), '2026-11-18T03:00:00.000Z')
})

test('สูตรจักรจากฐานข้อมูลใช้ตรวจปุ่มเริ่มเย็บได้เลย', () => {
  const needs = toNeeds([
    { product_type_code: 'polo', type_code: 'ovl4', qty: 1 }, { product_type_code: 'polo', type_code: 'cover', qty: 1 },
  ])
  const [j] = toJobs([row()], products, [], [])
  const machines = toMachines([
    { id: 1, code: 'OL4-001', type_code: 'ovl4', status: 'ready', note: null, repair_eta: null, sort: 1 },
    { id: 2, code: 'CV-001', type_code: 'cover', status: 'ready', note: null, repair_eta: null, sort: 2 },
  ], [])
  const bookings = toBookings([])
  const now = new Date('2026-11-17T03:00:00Z')
  assert.equal(checkStartSewing(j, machines, needs, bookings, now).ok, true)
  const busy = toMachines([{ id: 2, code: 'CV-001', type_code: 'cover', status: 'ready', note: null, repair_eta: null, sort: 2 },
    { id: 1, code: 'OL4-001', type_code: 'ovl4', status: 'ready', note: null, repair_eta: null, sort: 1 }], [{ machine_id: 2, job_id: 'other' }])
  const check = checkStartSewing(j, busy, needs, bookings, now)
  assert.equal(check.ok, false)
  assert.match(check.reason, /จักรลา/)
})

test('การจอง: แปลงเวลาและรหัสเป็นข้อความ', () => {
  const [b] = toBookings([{ id: 5, machine_id: 9, job_id: 'j1', starts_at: '2026-11-18T01:00:00Z', ends_at: '2026-11-18T10:00:00Z' }])
  assert.deepEqual([b.id, b.machineId, b.jobId], ['5', '9', 'j1'])
  assert.equal(b.ends.getTime() - b.starts.getTime(), 9 * 3_600_000)
})

test('เลยกำหนดส่งคิดตามวันที่ไทย', () => {
  const [j] = toJobs([row({ due_date: '2026-11-16' })], products, [], [])
  assert.equal(isOverdue(j, new Date('2026-11-17T03:00:00Z')), true)
})

test('ข้อความผิดพลาด: ภาษาไทยจากฐานข้อมูลแสดงตรง · ภาษาอังกฤษแปลงเป็นไทย', () => {
  assert.equal(thaiError('จักรไม่ว่าง เริ่มเย็บไม่ได้: โพ้ง 4 เส้น ขาด 1 ตัว'), 'จักรไม่ว่าง เริ่มเย็บไม่ได้: โพ้ง 4 เส้น ขาด 1 ตัว')
  assert.match(thaiError('TypeError: Failed to fetch'), /อินเทอร์เน็ต/)
  assert.match(thaiError('permission denied for function start_sewing'), /บัญชีนี้ทำรายการนี้ไม่ได้/)
  assert.match(thaiError('The object exceeded the maximum allowed size'), /ใหญ่เกิน 20 MB/)
  assert.match(thaiError('mime type application/zip is not supported'), /ต้องเป็น PDF/)
  assert.match(thaiError('Bucket not found'), /ยังไม่พร้อมรับไฟล์ PDF/)
  assert.match(thaiError('new row violates row-level security policy'), /บัญชีนี้ทำรายการนี้ไม่ได้/)
  assert.match(thaiError('something odd'), /ลองใหม่/)
  assert.match(thaiError(undefined), /ลองใหม่/)
})
