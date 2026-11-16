import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bookingDay, bookingTime, groupBookings, isBookingSunday, moveBookingDay, applyFinishSewing, applyReportSewingIssue, applyBooking, freeDuring, jobsBookedDuring, applyMachineStatus, applyRepairEta, repairStatus, applyStartSewing, cancelBookings, checkBooking, checkStartSewing, floorSummary, isValidMachineCode, machineCode, machineState, planSewing, sewQueue, SEW_NEEDS, needText } from '../src/proto/sewing.ts'
import { nextAction, todoList } from '../src/proto/actions.ts'

// วันที่ตายตัว (จันทร์ 16 พ.ย. 2569 10:00 เวลาไทย) ไม่พึ่งเวลาปัจจุบัน
const now = new Date('2026-11-16T10:00:00+07:00')
const day = d => new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 17)
const ok = { admin: true, qc: true, production: true }
let n = 0
const job = (over) => ({ id: String(++n), no: `SC${n}`, customer: 'ลูกค้า', product: 'สินค้า', unit: 'ตัว', qty: 10,
  due: day(5), route: 'plain', phase: 'production', since: now, sampleRound: 1, materials: ok, ...over })
const machine = (id, type, extra = {}) => ({ id, code: id, type, status: 'ready', ...extra })

test('สรุปจักร: ว่าง · ใช้อยู่ · เสีย · ไม่ใช้งาน นับแยกกัน', () => {
  const s = floorSummary([machine('a', 'ovl4'), machine('b', 'ovl4', { jobId: '1' }), machine('c', 'ovl4', { status: 'broken' }),
    machine('d', 'single', { status: 'off' }), machine('e', 'single')])
  assert.equal(s.count, 5)
  assert.equal(s.inUse, 1)
  assert.equal(s.broken, 1)
  assert.equal(s.off, 1)
  assert.equal(s.freeTotal, 2)
  assert.equal(s.free.ovl4, 1)
  assert.equal(s.total.ovl4, 3)
})

test('จักรเสียที่ยังผูกกับงานไม่นับว่าใช้อยู่และไม่นับว่าว่าง', () => {
  const s = floorSummary([machine('a', 'ovl4', { status: 'broken', jobId: '1' })])
  assert.equal(s.inUse, 0)
  assert.equal(s.freeTotal, 0)
})

test('คิวเย็บ (รวมงานกำลังมา สำหรับคนดูทั้งกระบวนการ): งานที่สถานีเย็บแต่ยังไม่ได้จักร + งานที่สถานีถัดไปคือเย็บ', () => {
  const atSewNoMachine = job({ station: 'sew', status: 'queued' })
  const atSewWithMachine = job({ station: 'sew', status: 'doing' })
  const cutPlain = job({ station: 'cut', status: 'doing' })                    // ไม่พิมพ์: ตัด → เย็บ
  const cutDtf = job({ route: 'dtf', station: 'cut', status: 'doing' })         // DTF: ตัด → รีด DTF (ยังไม่ถึงเย็บ)
  const dtfPress = job({ route: 'dtf', station: 'dtf_press', status: 'doing' }) // รีด DTF → เย็บ
  const sample = job({ phase: 'sample', station: 'cut', status: 'queued' })
  const materials = job({ phase: 'materials' })
  const q = sewQueue([atSewNoMachine, atSewWithMachine, cutPlain, cutDtf, dtfPress, sample, materials],
    [machine('m', 'single', { jobId: atSewWithMachine.id })], true)
  const ids = Object.fromEntries(q.map(r => [r.job.id, r.source]))
  assert.deepEqual(ids, { [atSewNoMachine.id]: 'waiting', [cutPlain.id]: 'coming', [dtfPress.id]: 'coming', [sample.id]: 'coming' })
})

test('ขึ้นเย็บได้เมื่อจักรว่างครบทุกชนิดที่สินค้าต้องใช้', () => {
  const j = job({ station: 'sew', status: 'queued', productCode: 'apron' })
  const plan = planSewing([j], [machine('a', 'single'), machine('b', 'binding')], SEW_NEEDS, now)
  assert.equal(plan.rows[0].verdict, 'ready')
  assert.equal(plan.readyCount, 1)
  assert.equal(plan.leftAfter.single, 0)
})

test('ขาดจักร: บอกชนิดและจำนวนที่ขาด', () => {
  const j = job({ station: 'sew', status: 'queued', productCode: 'tshirt' }) // โพ้ง 4 ×2 · ลา · ลาคอ · เข็มเดี่ยว
  const plan = planSewing([j], [machine('a', 'ovl4'), machine('b', 'cover'), machine('c', 'single')], SEW_NEEDS, now)
  assert.equal(plan.rows[0].verdict, 'wait')
  assert.deepEqual(plan.rows[0].missing, [{ type: 'ovl4', qty: 1 }, { type: 'flat', qty: 1 }])
  assert.equal(needText(plan.rows[0].missing), 'โพ้ง 4 เส้น · ลาคอ / ฟลัตล็อก')
})

test('งานที่ขึ้นได้จองจักร งานถัดไปที่ใช้จักรชนิดเดียวกันต้องรอ', () => {
  const a = job({ station: 'sew', status: 'queued', productCode: 'apron', due: day(1) })
  const b = job({ station: 'sew', status: 'queued', productCode: 'apron', due: day(3) })
  const plan = planSewing([b, a], [machine('s', 'single'), machine('t', 'binding')], SEW_NEEDS, now)
  assert.equal(plan.rows[0].job.id, a.id, 'กำหนดส่งใกล้กว่าขึ้นก่อน')
  assert.equal(plan.rows[0].verdict, 'ready')
  assert.equal(plan.rows[1].verdict, 'wait')
})

test('งานที่รอจักรไม่จองจักร งานหลังที่ใช้จักรคนละชนิดยังขึ้นได้', () => {
  const tee = job({ station: 'sew', status: 'queued', productCode: 'tshirt', due: day(1) })
  const banner = job({ station: 'sew', status: 'queued', productCode: 'banner', due: day(4) })
  const plan = planSewing([tee, banner], [machine('s', 'single'), machine('o', 'ovl3')], SEW_NEEDS, now)
  assert.deepEqual(plan.rows.map(r => r.verdict), ['wait', 'ready'])
})

test('งานรอเย็บแล้วมาก่อนงานกำลังมา และงานเลยกำหนดมาก่อน', () => {
  const coming = job({ station: 'cut', status: 'doing', productCode: 'apron', due: day(-3) })
  const waiting = job({ station: 'sew', status: 'queued', productCode: 'apron', due: day(5) })
  const lateWaiting = job({ station: 'sew', status: 'queued', productCode: 'apron', due: day(-1) })
  const plan = planSewing([coming, waiting, lateWaiting], [], SEW_NEEDS, now, true)
  assert.deepEqual(plan.rows.map(r => r.job.id), [lateWaiting.id, waiting.id, coming.id])
})

test('สินค้าที่ยังไม่มีข้อมูลจักร = ไม่รู้ ไม่เดาว่าขึ้นได้', () => {
  const j = job({ station: 'sew', status: 'queued', productCode: 'hat' })
  const plan = planSewing([j], [machine('a', 'single')], SEW_NEEDS, now)
  assert.equal(plan.rows[0].verdict, 'unknown')
  assert.equal(plan.readyCount, 0)
  assert.equal(plan.leftAfter.single, 1)
})

test('จักรเสีย / ไม่ใช้งาน ไม่นับเป็นจักรว่าง', () => {
  const j = job({ station: 'sew', status: 'queued', productCode: 'apron' })
  const plan = planSewing([j], [machine('a', 'single', { status: 'broken' }), machine('b', 'binding', { status: 'off' })], SEW_NEEDS, now)
  assert.equal(plan.rows[0].verdict, 'wait')
})

test('ไม่มีงานในคิว = ไม่พัง', () => {
  const plan = planSewing([], [], SEW_NEEDS, now)
  assert.equal(plan.rows.length, 0)
  assert.equal(plan.readyCount, 0)
})

test('สิ่งที่ต้องทำต่อของแต่ละสถานะ', () => {
  assert.equal(nextAction(job({ phase: 'done' }), now), null)
  assert.match(nextAction(job({ phase: 'materials', materials: { admin: true, qc: false, production: false } }), now).text, /รอ QC, ฝ่ายผลิต/)
  const hold = nextAction(job({ station: 'sew', status: 'hold', holdReason: 'จักรเสีย' }), now)
  assert.equal(hold.tone, 'danger')
  assert.match(hold.text, /แก้ปัญหา เย็บงาน: จักรเสีย/)
  assert.match(nextAction(job({ station: 'sew', status: 'doing' }), now).text, /กำลังทำเย็บงาน/)
  assert.match(nextAction(job({ route: 'dtf', station: 'dtf_press', status: 'queued', film: { eta: day(1), received: false } }), now).text, /รอฟิล์ม/)
  assert.match(nextAction(job({ phase: 'sample', station: 'print', status: 'queued' }), now).text, /^ตัวอย่าง · เริ่มพิมพ์งาน/)
  assert.match(nextAction(job({ phase: 'sample_review', sampleRound: 2 }), now).text, /รอบ 2/)
})

test('งานเลยกำหนดเป็นสีแดงและขึ้นก่อนงานปกติ', () => {
  const late = job({ station: 'cut', status: 'doing', due: day(-1) })
  const normal = job({ station: 'cut', status: 'queued', due: day(5) })
  const hold = job({ station: 'cut', status: 'hold', holdReason: 'x', due: day(5) })
  const list = todoList([normal, late, hold, job({ phase: 'done' })], now)
  assert.equal(list.length, 3)
  assert.deepEqual(list.map(a => a.job.id), [hold.id, late.id, normal.id])
  assert.equal(list[1].tone, 'danger')
})

test('สถานะบนตัวจักร: เสีย/ปิด มาก่อน · มีงาน = ใช้อยู่ · ไม่มีงาน = ว่าง', () => {
  assert.equal(machineState(machine('a', 'ovl4')), 'free')
  assert.equal(machineState(machine('a', 'ovl4', { jobId: '1' })), 'busy')
  assert.equal(machineState(machine('a', 'ovl4', { jobId: '1', status: 'broken' })), 'broken')
  assert.equal(machineState(machine('a', 'ovl4', { status: 'off' })), 'off')
})

test('P2 เห็นเฉพาะงานที่ถึงสถานีเย็บแล้ว (ค่าเริ่ม ไม่รวมงานกำลังมา)', () => {
  const arrived = job({ station: 'sew', status: 'queued' })
  const coming = job({ station: 'cut', status: 'doing' })
  assert.deepEqual(sewQueue([arrived, coming], []).map(r => r.job.id), [arrived.id])
})

test('รหัสจักรตามประเภท', () => {
  assert.equal(machineCode('ovl4', 1), 'OL4-01')
  assert.equal(machineCode('single', 12), 'SN-12')
  assert.equal(isValidMachineCode('ovl4', 'OL4-01'), true)
  assert.equal(isValidMachineCode('ovl4', 'SN-01'), false)
  assert.equal(isValidMachineCode('cover', 'CV1'), false)
})

test('กดเริ่มเย็บ: จักรครบ = เลือกจักรว่างตามรหัส', () => {
  const j = job({ station: 'sew', status: 'queued', productCode: 'apron' })
  const r = checkStartSewing(j, [machine('SN-02', 'single'), machine('SN-01', 'single'), machine('BD-01', 'binding')], SEW_NEEDS)
  assert.equal(r.ok, true)
  assert.deepEqual(r.picked.map(m => m.code), ['SN-01', 'BD-01'])
})

test('กดเริ่มเย็บ: จักรไม่ว่าง = ปฏิเสธ บอกจักรที่ติดงานอื่นและที่เสีย', () => {
  const j = job({ station: 'sew', status: 'queued', productCode: 'apron' })
  const r = checkStartSewing(j, [machine('SN-01', 'single', { jobId: '99' }), machine('SN-02', 'single', { status: 'broken' }), machine('BD-01', 'binding')], SEW_NEEDS)
  assert.equal(r.ok, false)
  assert.match(r.reason, /ขาด เข็มเดี่ยว/)
  assert.deepEqual(r.blockers, [{ code: 'SN-01', state: 'busy', jobId: '99' }, { code: 'SN-02', state: 'broken', jobId: undefined }])
})

test('กดเริ่มเย็บ: งานยังไม่ถึงเย็บ / พักอยู่ / เริ่มแล้ว / ไม่มีข้อมูลจักร = ปฏิเสธ', () => {
  const ms = [machine('SN-01', 'single'), machine('BD-01', 'binding')]
  assert.match(checkStartSewing(job({ station: 'cut', status: 'queued', productCode: 'apron' }), ms, SEW_NEEDS).reason, /ยังไม่ถึงสถานีเย็บ/)
  assert.match(checkStartSewing(job({ station: 'sew', status: 'hold', productCode: 'apron' }), ms, SEW_NEEDS).reason, /พักอยู่/)
  assert.match(checkStartSewing(job({ station: 'sew', status: 'doing', productCode: 'apron' }), ms, SEW_NEEDS).reason, /เริ่มเย็บไปแล้ว/)
  assert.match(checkStartSewing(job({ station: 'sew', status: 'queued', productCode: 'hat' }), ms, SEW_NEEDS).reason, /ยังไม่มีข้อมูล/)
})

test('เริ่มเย็บแล้ว จักรถูกจองให้งาน และงานถัดไปที่ใช้จักรชนิดเดียวกันเริ่มไม่ได้', () => {
  const a = job({ station: 'sew', status: 'queued', productCode: 'apron' })
  const b = job({ station: 'sew', status: 'queued', productCode: 'apron' })
  const first = applyStartSewing([a, b], [machine('SN-01', 'single'), machine('BD-01', 'binding')], a.id, SEW_NEEDS, now)
  assert.equal(first.ok, true)
  assert.deepEqual(first.picked, ['SN-01', 'BD-01'])
  assert.equal(first.jobs.find(j => j.id === a.id).status, 'doing')
  assert.ok(first.machines.every(m => m.jobId === a.id))
  const second = applyStartSewing(first.jobs, first.machines, b.id, SEW_NEEDS, now)
  assert.equal(second.ok, false)
  assert.equal(second.jobs.find(j => j.id === b.id).status, 'queued')
})

test('แจ้งจักรเสียระหว่างเย็บ: คืนจักร · พักงานพร้อมสาเหตุ · เก็บอาการ', () => {
  const j = job({ station: 'sew', status: 'doing', productCode: 'apron' })
  const ms = [machine('m1', 'single', { code: 'SN-01', jobId: j.id }), machine('m2', 'binding', { code: 'BD-01', jobId: j.id })]
  const r = applyMachineStatus([j], ms, 'sn-01', 'broken', ' ด้ายพัน ', now)
  assert.equal(r.ok, true)
  assert.equal(r.heldJob, j.no)
  const m = r.machines.find(x => x.code === 'SN-01')
  assert.equal(m.status, 'broken')
  assert.equal(m.jobId, undefined)
  assert.equal(m.note, 'ด้ายพัน')
  assert.equal(r.machines.find(x => x.code === 'BD-01').jobId, j.id, 'จักรตัวอื่นยังอยู่กับงาน')
  assert.equal(r.jobs[0].status, 'hold')
  assert.equal(r.jobs[0].holdReason, 'จักร SN-01 เสีย: ด้ายพัน')
  // จักรไม่ครบแล้ว เริ่มเย็บใหม่ไม่ได้จนกว่าจะซ่อม
  const fixed = applyMachineStatus(r.jobs, r.machines, 'SN-01', 'ready', '', now)
  assert.equal(fixed.machines.find(x => x.code === 'SN-01').note, undefined)
  assert.equal(machineState(fixed.machines.find(x => x.code === 'SN-01')), 'free')
})

test('แจ้งเสียต้องมีอาการ · กดซ้ำสถานะเดิมถูกปฏิเสธ · จักรว่างเสียไม่พักงานใด', () => {
  const ms = [machine('m1', 'single', { code: 'SN-01' })]
  assert.match(applyMachineStatus([], ms, 'SN-01', 'broken', '  ', now).reason, /บอกอาการ/)
  assert.match(applyMachineStatus([], ms, 'SN-01', 'ready', '', now).reason, /ใช้ได้อยู่แล้ว/)
  assert.match(applyMachineStatus([], ms, 'XX-01', 'off', '', now).reason, /ไม่พบจักร/)
  const off = applyMachineStatus([], ms, 'SN-01', 'off', '', now)
  assert.equal(off.ok, true)
  assert.equal(off.heldJob, undefined)
})

// การจอง: วันจันทร์หน้า (16 พ.ย. 2569 เป็นวันจันทร์ → 23 พ.ย.) เวลาท้องถิ่น
const at = (d, h) => bookingTime(moveBookingDay('2026-11-23', d), `${String(h).padStart(2, '0')}:00`)
const booking = (id, machineId, jobId, starts, ends) => ({ id, machineId, jobId, starts, ends })

test('จองจักร: จองครบทุกชนิดตามสินค้า', () => {
  const j = job({ station: 'cut', status: 'doing', productCode: 'apron' })
  const ms = [machine('s1', 'single', { code: 'SN-01' }), machine('b1', 'binding', { code: 'BD-01' })]
  const r = applyBooking(j, ms, [], at(0, 8), at(0, 17), SEW_NEEDS, now)
  assert.equal(r.ok, true)
  assert.deepEqual(r.picked, ['SN-01', 'BD-01'])
  assert.equal(r.bookings.length, 2)
})

test('จองทับช่วงที่งานอื่นจองไว้ไม่ได้ · ต่อท้ายพอดีได้', () => {
  const a = job({ productCode: 'apron', station: 'cut', status: 'doing' })
  const b = job({ productCode: 'apron', station: 'cut', status: 'doing' })
  const ms = [machine('s1', 'single'), machine('b1', 'binding')]
  const first = applyBooking(a, ms, [], at(0, 8), at(0, 17), SEW_NEEDS, now)
  assert.match(checkBooking(b, ms, first.bookings, at(0, 12), at(0, 15), SEW_NEEDS, now).reason, /จักรไม่พอ: เข็มเดี่ยว ขาด 1 ตัว · เข้าขอบ ขาด 1 ตัว/)
  assert.equal(checkBooking(b, ms, first.bookings, at(0, 17), at(0, 20), SEW_NEEDS, now).ok, true)
})

test('ตรวจช่วงเวลาที่จอง: จบก่อนเริ่ม · ผ่านไปแล้ว · วันอาทิตย์ · เกิน 14 วัน · จองซ้ำ · ไม่มีสูตร', () => {
  const j = job({ productCode: 'apron', station: 'cut', status: 'doing' })
  const ms = [machine('s1', 'single'), machine('b1', 'binding')]
  assert.match(checkBooking(j, ms, [], at(0, 17), at(0, 8), SEW_NEEDS, now).reason, /เวลาจบต้องหลังเวลาเริ่ม/)
  assert.match(checkBooking(j, ms, [], new Date(2026, 10, 10, 8), new Date(2026, 10, 10, 17), SEW_NEEDS, now).reason, /ผ่านไปแล้ว/)
  assert.match(checkBooking(j, ms, [], at(-1, 8), at(-1, 17), SEW_NEEDS, now).reason, /วันอาทิตย์/)
  assert.match(checkBooking(j, ms, [], at(0, 8), at(15, 8), SEW_NEEDS, now).reason, /ไม่เกิน 14 วัน/)
  assert.match(checkBooking(j, ms, [booking('x', 's1', j.id, at(0, 8), at(0, 9))], at(1, 8), at(1, 9), SEW_NEEDS, now).reason, /จองจักรไว้แล้ว/)
  assert.match(checkBooking(job({ productCode: 'hat' }), ms, [], at(0, 8), at(0, 9), SEW_NEEDS, now).reason, /ยังไม่มีข้อมูล/)
  assert.match(checkBooking(job({ productCode: 'apron', station: 'qc_pack', status: 'queued' }), ms, [], at(0, 8), at(0, 9), SEW_NEEDS, now).reason, /เย็บเสร็จแล้ว/)
  assert.equal(checkBooking(job({ productCode: 'apron', phase: 'sample', station: 'qc_pack', status: 'queued' }), ms, [], at(0, 8), at(0, 9), SEW_NEEDS, now).ok, true, 'ตัวอย่างยังต้องเย็บตอนผลิตจริง')
})

test('จองเริ่มทันที: จักรที่ติดงานอื่นอยู่ตอนนี้ใช้ไม่ได้ · จองล่วงหน้าไม่ติด', () => {
  const j = job({ productCode: 'apron', station: 'cut', status: 'doing' })
  const ms = [machine('s1', 'single', { jobId: '999' }), machine('b1', 'binding')]
  assert.equal(checkBooking(j, ms, [], new Date(now.getTime() - 60_000), new Date(now.getTime() + 3_600_000), SEW_NEEDS, now).ok, false)
  assert.equal(checkBooking(j, ms, [], at(0, 8), at(0, 17), SEW_NEEDS, now).ok, true)
})

test('เริ่มเย็บ: จักรที่งานอื่นจองช่วงนี้ใช้ไม่ได้ · งานที่จองไว้ได้จักรที่จอง', () => {
  const mine = job({ station: 'sew', status: 'queued', productCode: 'apron' })
  const other = job({ station: 'sew', status: 'queued', productCode: 'apron' })
  const ms = [machine('s1', 'single', { code: 'SN-01' }), machine('s2', 'single', { code: 'SN-02' }), machine('b1', 'binding', { code: 'BD-01' })]
  const bs = [booking('1', 's2', mine.id, new Date(now.getTime() - 60_000), new Date(now.getTime() + 3_600_000)),
              booking('2', 'b1', mine.id, new Date(now.getTime() - 60_000), new Date(now.getTime() + 3_600_000))]
  const r = checkStartSewing(mine, ms, SEW_NEEDS, bs, now)
  assert.equal(r.ok, true)
  assert.deepEqual(r.picked.map(m => m.code), ['SN-02', 'BD-01'], 'ใช้จักรที่จองไว้ก่อน')
  const o = checkStartSewing(other, ms, SEW_NEEDS, bs, now)
  assert.equal(o.ok, false)
  assert.deepEqual(o.blockers.map(b => [b.code, b.state]), [['BD-01', 'booked']])
})

test('ยกเลิกการจอง: ช่วงที่ยังไม่เริ่มหายไป · ช่วงที่กำลังใช้ตัดจบที่ตอนนี้', () => {
  const j = job({})
  const bs = [booking('1', 's1', j.id, at(0, 8), at(0, 17)), booking('2', 's2', j.id, new Date(now.getTime() - 60_000), at(0, 8))]
  const r = cancelBookings(bs, j.id, now)
  assert.equal(r.ok, true)
  assert.equal(r.bookings.length, 1)
  assert.equal(r.bookings[0].ends.getTime(), now.getTime())
  assert.match(cancelBookings(r.bookings, j.id, now).reason, /ไม่มีการจอง/)
})

test('เวลาจองอิงปฏิทินไทย แม้เครื่องตั้งเขตเวลาอื่น', () => {
  const sunday = new Date('2026-11-21T17:30:00Z')
  assert.equal(bookingDay(sunday), '2026-11-22')
  assert.equal(isBookingSunday(bookingDay(sunday)), true)
  assert.equal(moveBookingDay(bookingDay(sunday), 1), '2026-11-23')
  assert.equal(bookingTime('2026-11-23', '08:00').toISOString(), '2026-11-23T01:00:00.000Z')
  assert.match(checkBooking(job({ productCode: 'apron' }), [], [], sunday, new Date('2026-11-22T02:00:00Z'), SEW_NEEDS, now).reason, /วันอาทิตย์/)
})

test('จองใหม่วันเดียวกัน: เก็บแต่ละช่วงแยกกันและจัดกลุ่มจักรในช่วงเดียวกัน', () => {
  const j = job({})
  const earlier = booking('a', 's1', j.id, at(0, 8), at(0, 11))
  const later = booking('b', 's2', j.id, at(0, 13), at(0, 17))
  const secondMachine = booking('c', 'b1', j.id, at(0, 13), at(0, 17))
  assert.deepEqual(groupBookings([later, earlier, secondMachine]), [[earlier], [later, secondMachine]])
})

test('ยกเลิกตรงเวลาเริ่ม ไม่เหลือช่วงจองความยาวศูนย์และจองใหม่ได้', () => {
  const j = job({ productCode: 'apron' })
  const end = new Date(now.getTime() + 3_600_000)
  const bs = [booking('a', 's1', j.id, now, end)]
  const cancelled = cancelBookings(bs, j.id, now)
  assert.deepEqual(cancelled.bookings, [])
  const ms = [machine('s1', 'single'), machine('b1', 'binding')]
  assert.equal(applyBooking(j, ms, cancelled.bookings, now, end, SEW_NEEDS, now).ok, true)
})

test('กรอบเวลาซ่อม: ฝ่ายผลิตต้องกรอก · ผู้ควบคุมงานกรอกไม่ได้ · ต้องเป็นเวลาข้างหน้าไม่เกิน 30 วัน', () => {
  const ms = [machine('m1', 'single', { code: 'SN-01' })]
  const soon = new Date(now.getTime() + 2 * 3_600_000)
  assert.match(applyMachineStatus([], ms, 'SN-01', 'broken', 'เข็มหัก', now, { byProduction: true, canSetEta: true }).reason, /ต้องกำหนดเวลาซ่อม/)
  assert.match(applyMachineStatus([], ms, 'SN-01', 'broken', 'เข็มหัก', now, { repairEta: soon }).reason, /หน้าที่ของฝ่ายผลิต/)
  assert.match(applyMachineStatus([], ms, 'SN-01', 'broken', 'เข็มหัก', now, { repairEta: new Date(now.getTime() - 1), canSetEta: true }).reason, /เวลาข้างหน้า/)
  assert.match(applyMachineStatus([], ms, 'SN-01', 'broken', 'เข็มหัก', now, { repairEta: new Date(now.getTime() + 31 * 86_400_000), canSetEta: true }).reason, /เกิน 30 วัน/)
  const ok1 = applyMachineStatus([], ms, 'SN-01', 'broken', 'เข็มหัก', now, { repairEta: soon, byProduction: true, canSetEta: true })
  assert.equal(ok1.ok, true)
  assert.equal(ok1.machines[0].repairEta.getTime(), soon.getTime())
  assert.equal(applyMachineStatus([], ms, 'SN-01', 'broken', 'เข็มหัก', now).ok, true, 'ผู้ควบคุมงานแจ้งเสียได้โดยไม่ใส่เวลา')
  const fixed = applyMachineStatus(ok1.jobs, ok1.machines, 'SN-01', 'ready', '', now)
  assert.equal(fixed.machines[0].repairEta, undefined, 'ซ่อมเสร็จแล้วล้างเวลา')
})

test('สถานะเวลาซ่อมบนช่องจักร และการเลื่อนเวลาซ่อม', () => {
  const broken = machine('m1', 'single', { code: 'SN-01', status: 'broken' })
  assert.equal(repairStatus(machine('m2', 'single'), now), null)
  assert.equal(repairStatus(broken, now).text, 'ยังไม่กำหนดเวลาซ่อม')
  assert.match(repairStatus({ ...broken, repairEta: new Date(now.getTime() + 3_600_000) }, now).text, /^ซ่อมเสร็จประมาณ/)
  assert.equal(repairStatus({ ...broken, repairEta: new Date(now.getTime() - 3_600_000) }, now).tone, 'danger')
  const later = new Date(now.getTime() + 86_400_000)
  assert.equal(applyRepairEta([broken], 'sn-01', later, now).machines[0].repairEta.getTime(), later.getTime())
  assert.match(applyRepairEta([machine('m2', 'single', { code: 'SN-02' })], 'SN-02', later, now).reason, /ไม่ได้เสียอยู่/)
})

test('งานถูกพักเพราะจักรเสีย: สาเหตุบอกเวลาคาดว่าซ่อมเสร็จ', () => {
  const j = job({ station: 'sew', status: 'doing', productCode: 'apron' })
  const r = applyMachineStatus([j], [machine('m1', 'single', { code: 'SN-01', jobId: j.id })], 'SN-01', 'broken', 'ด้ายพัน', now,
    { repairEta: new Date(now.getTime() + 3_600_000), byProduction: true, canSetEta: true })
  assert.match(r.jobs[0].holdReason, /^จักร SN-01 เสีย: ด้ายพัน · คาดว่าซ่อมเสร็จ /)
})

test('หลายงานขึ้นเย็บวันเดียวกัน: จักรที่ว่างรับงานอื่นได้ ถ้าครบชุดตามสินค้า', () => {
  const ms = [machine('s1', 'single'), machine('s2', 'single'), machine('b1', 'binding'), machine('b2', 'binding'), machine('o3', 'ovl3')]
  const a = job({ productCode: 'apron', station: 'cut', status: 'doing' })
  const flag = job({ productCode: 'banner', station: 'cut', status: 'doing' })   // โพ้ง 3 · เข็มเดี่ยว
  const c = job({ productCode: 'apron', station: 'cut', status: 'doing' })
  let bs = applyBooking(a, ms, [], at(0, 8), at(0, 17), SEW_NEEDS, now).bookings
  const r2 = applyBooking(flag, ms, bs, at(0, 8), at(0, 17), SEW_NEEDS, now)
  assert.equal(r2.ok, true, 'งานคนละสินค้าวันเดียวกันได้')
  bs = r2.bookings
  assert.deepEqual(jobsBookedDuring(bs, at(0, 8), at(0, 17)).length, 2)
  const free = freeDuring(ms, bs, at(0, 8), at(0, 17), now)
  assert.equal(free.single, 0)
  assert.equal(free.binding, 1)
  assert.match(checkBooking(c, ms, bs, at(0, 8), at(0, 17), SEW_NEEDS, now).reason, /เข็มเดี่ยว ขาด 1 ตัว/, 'ขาดชนิดเดียวก็จองไม่ได้ทั้งชุด')
  assert.equal(applyBooking(c, ms, bs, at(0, 17), at(0, 20), SEW_NEEDS, now).ok, true, 'ช่วงถัดไปได้')
})

test('รายงานปัญหาขณะเย็บ และเลือกพักได้เมื่อจำเป็น', () => {
  const j = job({ station: 'sew', status: 'doing', productCode: 'apron' })
  assert.match(applyReportSewingIssue([j], j.id, '  ', false, now).reason, /ระบุปัญหา/)
  const continued = applyReportSewingIssue([j], j.id, ' ด้ายตึง ', false, now)
  assert.equal(continued.jobs[0].status, 'doing')
  assert.deepEqual(continued.jobs[0].sewingReports, [{ reason: 'ด้ายตึง', at: now, paused: false }])
  const paused = applyReportSewingIssue(continued.jobs, j.id, 'รอผ้าเพิ่ม', true, now)
  assert.equal(paused.jobs[0].status, 'hold')
  assert.equal(paused.jobs[0].holdReason, 'รอผ้าเพิ่ม')
  assert.equal(paused.jobs[0].sewingReports.length, 2)
})

test('เย็บต่อใช้จักรเดิมพร้อมจ่ายเฉพาะจักรที่ขาด', () => {
  const j = job({ station: 'sew', status: 'hold', productCode: 'apron', holdReason: 'รอจักร' })
  const assigned = machine('s1', 'single', { jobId: j.id })
  assert.equal(applyStartSewing([j], [assigned], j.id, SEW_NEEDS, now, [], true).ok, false)
  const spare = machine('b1', 'binding', { code: 'BD-01' })
  const result = applyStartSewing([j], [assigned, spare], j.id, SEW_NEEDS, now, [], true)
  assert.deepEqual(result.picked, ['BD-01'])
  assert.equal(result.jobs[0].status, 'doing')
  assert.equal(result.jobs[0].holdReason, undefined)
  assert.ok(result.machines.every(m => m.jobId === j.id))
})

test('เย็บเสร็จโดยไม่ติ๊กขั้นย่อย ไป QC คืนจักรและตัดช่วงจองที่เหลือ', () => {
  const j = job({ station: 'sew', status: 'doing', qty: 10, productCode: 'apron' })
  const ms = [machine('s1', 'single', { code: 'SN-01', jobId: j.id }), machine('b1', 'binding', { code: 'BD-01', jobId: j.id }), machine('x', 'single', { code: 'SN-02' })]
  const bs = [booking('1', 's1', j.id, new Date(now.getTime() - 3_600_000), new Date(now.getTime() + 3_600_000))]
  const r = applyFinishSewing([j], ms, bs, j.id, now)
  assert.equal(r.jobs[0].sewCount, undefined)
  assert.equal(r.ok, true)
  assert.equal(r.next, 'qc_pack')
  assert.deepEqual(r.released, ['BD-01', 'SN-01'])
  assert.equal(r.jobs[0].station, 'qc_pack')
  assert.equal(r.jobs[0].status, 'queued')
  assert.ok(r.machines.every(m => !m.jobId))
  assert.equal(r.bookings[0].ends.getTime(), now.getTime())
})

test('เย็บเสร็จ: งานพักอยู่ / ยังไม่เริ่ม กดไม่ได้', () => {
  assert.match(applyFinishSewing([job({ station: 'sew', status: 'hold' })], [], [], String(n), now).reason, /พักอยู่/)
  assert.match(applyFinishSewing([job({ station: 'sew', status: 'queued' })], [], [], String(n), now).reason, /ยังไม่ได้เริ่มเย็บ/)
})

test('กันบั๊ก: ตัวอย่างเย็บเสร็จ การจองล่วงหน้าของรอบผลิตจริงยังอยู่', () => {
  const j = job({ phase: 'sample', station: 'sew', status: 'doing', productCode: 'apron' })
  const future = booking('f', 's1', j.id, at(1, 8), at(1, 17))
  const r = applyFinishSewing([j], [machine('s1', 'single', { jobId: j.id })], [future], j.id, now)
  assert.equal(r.ok, true)
  assert.deepEqual(r.bookings, [future], 'การจองล่วงหน้ายังเก็บวันเริ่มและจบที่ถูกต้อง')
  const p = job({ station: 'sew', status: 'doing', productCode: 'apron', qty: 1, sewCount: 1 })
  const r2 = applyFinishSewing([p], [], [booking('g', 's1', p.id, at(1, 8), at(1, 17))], p.id, now)
  assert.equal(r2.bookings.length, 0, 'ผลิตจริงเย็บเสร็จ ยกเลิกการจองที่เหลือ')
})

// ---- ตัวเลขสรุปตามตำแหน่ง (proto/summary.ts) ----
import { roleSummary } from '../src/proto/summary.ts'
import { boardScope as scopeOf, jobInScope as inScope } from '../src/auth/scope.ts'

const tile = (tiles, key) => tiles.find(t => t.key === key)
const sumJobs = () => [
  job({ station: 'print', status: 'doing' }),
  job({ station: 'cut', status: 'hold', holdReason: 'มีดตัดเสีย' }),
  job({ station: 'press', status: 'queued', due: day(-2) }),
  job({ route: 'dtf', station: 'dtf_press', status: 'queued', film: { eta: day(1), received: false } }),
  job({ station: 'sew', status: 'doing', id: 'sewing1' }),
  job({ station: 'sew', status: 'queued' }),
  job({ station: 'qc_pack', status: 'queued', qty: 40 }),
  job({ phase: 'materials', materials: { admin: true, qc: false, production: false } }),
  job({ station: 'sew', status: 'queued', rework: { qty: 5, reason: 'ด้ายหลุด' } }),
  job({ phase: 'done', doneAt: now }),
]
const sumMachines = () => [machine('a', 'ovl4', { jobId: 'sewing1' }), machine('b', 'ovl4'), machine('c', 'single', { status: 'broken' })]
const summaryFor = (role, section) => {
  const jobs = sumJobs()
  const scope = scopeOf(role, section)
  return roleSummary(scope.summary, jobs.filter(j => inScope(j, scope)), jobs, sumMachines(), now)
}

test('ทุกตำแหน่งได้ตัวเลขสรุป 4 ช่อง และแต่ละช่องพาไปแท็บที่ตำแหน่งนั้นมีจริง', () => {
  for (const [role, section] of [['owner', null], ['admin', null], ['manager', null], ['production', null], ['qc', null], ['supervisor', 1], ['supervisor', 2], ['supervisor', null]]) {
    const scope = scopeOf(role, section)
    const tiles = summaryFor(role, section)
    assert.equal(tiles.length, 4, `${role} ${section}`)
    for (const t of tiles) assert.ok(!t.tab || scope.tabs.includes(t.tab) || t.tab === 'todo' || t.tab === 'board', `${role} ${t.key}`)
  }
})

test('เฟส 1: นับเฉพาะงานที่อยู่สถานีเฟส 1 · งานด่วน = พักงาน + เลยกำหนด · รอฟิล์ม DTF', () => {
  const t = summaryFor('supervisor', 1)
  assert.equal(tile(t, 'doing').value, 1)          // พิมพ์กำลังทำ (เย็บกำลังทำอยู่เฟส 2 ไม่นับ)
  assert.equal(tile(t, 'urgent').value, 2)         // ตัดพักงาน + รีดเลยกำหนด
  assert.equal(tile(t, 'urgent').note, 'พักงาน 1 · เลยกำหนด 1')
  assert.equal(tile(t, 'film').value, 1)
})

test('เฟส 2: กำลังเย็บ · รอเย็บ (ยังไม่มีจักร) · จักรว่าง · รอ QC', () => {
  const t = summaryFor('supervisor', 2)
  assert.equal(tile(t, 'sewing').value, 1)
  assert.equal(tile(t, 'waitingSew').value, 2)     // งานรอเย็บ + งานแก้ที่กลับมาเย็บ
  assert.equal(tile(t, 'machines').value, 1)
  assert.equal(tile(t, 'machines').note, 'จาก 3 ตัว · เสีย 1')
  assert.equal(tile(t, 'qc').value, 1)
})

test('QC: รอ QC พร้อมจำนวนชิ้น · วัตถุดิบที่ QC ยังไม่ติ๊ก · งานแก้ · เสร็จวันนี้', () => {
  const t = summaryFor('qc', null)
  assert.equal(tile(t, 'qc').value, 1)
  assert.equal(tile(t, 'qc').note, '40 ชิ้น')
  assert.equal(tile(t, 'materials').value, 1)
  assert.equal(tile(t, 'rework').value, 1)
  assert.equal(tile(t, 'done').value, 1)
})

test('ฝ่ายผลิต: งานทั้งโรงงานไม่นับงานเสร็จ · วัตถุดิบรอฝ่ายผลิต · จักรเสีย', () => {
  const t = summaryFor('production', null)
  assert.equal(tile(t, 'inScope').value, 9)
  assert.equal(tile(t, 'materials').value, 1)
  assert.equal(tile(t, 'broken').value, 1)
})

test('ไม่มีงานด่วน: ตัวเลขเป็น 0 และบอกว่าไม่มีงานด่วน', () => {
  const t = roleSummary('factory', [job({ station: 'print', status: 'queued' })], [], [], now)
  assert.equal(tile(t, 'urgent').value, 0)
  assert.equal(tile(t, 'urgent').note, 'ไม่มีงานด่วน')
  assert.equal(tile(t, 'machines').note, 'จาก 0 ตัว')
})
