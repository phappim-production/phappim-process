import assert from 'node:assert/strict'
import { test } from 'node:test'
import { corrections, eventLine, pauseRanges, spanText, visitLines } from '../src/data/history.ts'

const names = {
  station: code => ({ print: 'พิมพ์งาน', qc_pack: 'QC + Packing', sew: 'เย็บงาน' })[code] ?? code,
  step: (station, key) => (station === 'cut' && key === 'sort_count' ? 'คัดแยกชิ้นและนับ' : key),
}
const ev = (type, over = {}) => ({ id: 1, type, phase: 'production', station_code: null, payload: {}, by: null, at: '2026-11-17T03:00:00Z', ...over })

test('ไทม์ไลน์: ข้อความไทยตามชนิดการกด · เว้นวรรครอบชื่ออังกฤษ', () => {
  assert.equal(eventLine(ev('station_start', { station_code: 'qc_pack' }), names).title, 'เริ่ม QC + Packing')
  assert.equal(eventLine(ev('station_done', { station_code: 'print', phase: 'sample' }), names).title, 'พิมพ์งานเสร็จ (ตัวอย่าง)')
  assert.equal(eventLine(ev('substep_done', { station_code: 'cut', payload: { key: 'sort_count', value: 120 } }), names).detail, 'ค่า 120')
  assert.equal(eventLine(ev('substep_done', { station_code: 'cut', payload: { key: 'sort_count', value: 120 } }), names).title, 'ติ๊ก: คัดแยกชิ้นและนับ')
  assert.equal(eventLine(ev('material_checked', { payload: { name: 'ด้ายสีตามสเปก' } }), names).title, 'ติ๊กวัตถุดิบ: ด้ายสีตามสเปก')
})

test('ไทม์ไลน์: ตัวอย่างไม่ผ่านบอกสิ่งที่ต้องแก้ · สีแดง', () => {
  const fail = eventLine(ev('sample_result', { payload: { round: 1, pass: false, note: 'สีเพี้ยน' } }), names)
  assert.deepEqual(fail, { title: 'ตัวอย่างไม่ผ่าน รอบ 1', detail: 'ต้องแก้: สีเพี้ยน', tone: 'danger' })
  assert.equal(eventLine(ev('sample_result', { payload: { round: 2, pass: true } }), names).tone, 'ok')
})

test('ไทม์ไลน์: ปล่อยงาน · ขึ้นตัวอย่าง vs เข้าผลิตจริง (ไม่ขึ้นตัวอย่าง)', () => {
  assert.equal(eventLine(ev('released', { phase: 'sample', payload: { round: 1 } }), names).title, 'ไปขึ้นตัวอย่าง รอบ 1')
  assert.equal(eventLine(ev('released', { phase: 'production', payload: { sample: false } }), names).detail, 'งานนี้ไม่ขึ้นตัวอย่าง')
  assert.equal(eventLine(ev('received', { payload: { qty: 1200, sample: false } }), names).detail, '1,200 ชิ้น · ไม่ขึ้นตัวอย่าง')
})

test('ไทม์ไลน์: งานแก้ พักงาน รายงานปัญหา · ชนิดที่ไม่รู้จักแสดงรหัสเดิม', () => {
  const rw = eventLine(ev('rework', { station_code: 'sew', payload: { qty: 5, reason: 'ตะเข็บหลุด' } }), names)
  assert.equal(rw.title, 'QC ส่งกลับแก้ 5 ชิ้น')
  assert.equal(rw.detail, 'ที่เย็บงาน · สาเหตุ: ตะเข็บหลุด')
  assert.equal(eventLine(ev('hold', { station_code: 'sew', payload: { reason: 'จักรเสีย' } }), names).detail, 'จักรเสีย')
  assert.equal(eventLine(ev('machines_assigned', { payload: { machines: ['A1', 'B2'] } }), names).detail, 'A1, B2')
  assert.equal(eventLine(ev('something_new'), names).title, 'something_new')
})

test('ไทม์ไลน์: ผ่าน QC แสดงจำนวนและหน่วยจริงของงาน', () => {
  const qc = ev('qc_result', { payload: { passed: 1250 } })
  assert.equal(eventLine(qc, names, 'ผืน').title, 'บันทึกผ่าน QC 1,250 ผืน')
  assert.equal(eventLine(qc, names, ' ใบ ').title, 'บันทึกผ่าน QC 1,250 ใบ')
  assert.equal(eventLine(qc, names).title, 'บันทึกผ่าน QC 1,250 ชิ้น')
  assert.equal(eventLine(qc, names, ' ').title, 'บันทึกผ่าน QC 1,250 ชิ้น')
})

test('ไทม์ไลน์: รับงานและส่งแก้ใช้หน่วยที่ระบุในใบงาน', () => {
  const received = ev('received', { payload: { qty: 3, sample: false } })
  const rework = ev('rework', { payload: { qty: 2 } })
  assert.equal(eventLine(received, names, 'ตัว').detail, '3 ตัว · ไม่ขึ้นตัวอย่าง')
  assert.equal(eventLine(rework, names, 'ใบ').title, 'QC ส่งกลับแก้ 2 ใบ')
})

test('แจ้งกดผิด: จับคู่กับรายการเดิมด้วย event_id · ประวัติเดิมยังอยู่', () => {
  const map = corrections([
    ev('station_done', { id: 7 }),
    ev('correction', { id: 9, payload: { event_id: 7, event_type: 'station_done', reason: 'กดผิดงาน' } }),
  ])
  assert.deepEqual([...map], [[7, 'กดผิดงาน']])
})

test('ระยะเวลา: นาที / ชั่วโมง / วัน', () => {
  assert.equal(spanText(25 * 60_000), '25 นาที')
  assert.equal(spanText(90 * 60_000), '1.5 ชม.')
  assert.equal(spanText(30 * 3_600_000), '1.3 วัน')
  assert.equal(spanText(48 * 3_600_000), '2 วัน')
  assert.equal(spanText(-1), '—')
})

test('เวลาต่อสถานี: เรียงตามเวลาเริ่ม · ยังไม่เสร็จนับถึงตอนนี้ · ติดป้ายตัวอย่าง/งานแก้', () => {
  const now = new Date('2026-11-17T05:00:00Z')
  const lines = visitLines([
    { station_code: 'sew', phase: 'production', visit: 4, started_at: '2026-11-17T04:00:00Z', done_at: null, rework: true },
    { station_code: 'print', phase: 'sample', visit: 1, started_at: '2026-11-17T01:00:00Z', done_at: '2026-11-17T01:30:00Z', rework: false },
    { station_code: 'qc_pack', phase: 'production', visit: 5, started_at: null, done_at: null, rework: false },
  ], names, now)
  assert.deepEqual(lines.map(l => l.label), ['พิมพ์งาน (ตัวอย่าง)', 'เย็บงาน (งานแก้)'])
  assert.deepEqual(lines.map(l => l.span), ['30 นาที', '1 ชม. (ยังทำอยู่)'])
})

test('เวลาต่อสถานี: หักช่วงพักงาน (พักงาน → ทำต่อ) · พักค้างนับถึงตอนนี้ · พักนอกรอบไม่นับ', () => {
  const now = new Date('2026-11-17T06:00:00Z')
  const rows = [
    { station_code: 'print', phase: 'production', visit: 1, started_at: '2026-11-17T01:00:00Z', done_at: '2026-11-17T03:00:00Z', rework: false },
    { station_code: 'cut', phase: 'production', visit: 2, started_at: '2026-11-17T04:00:00Z', done_at: null, rework: false },
  ]
  const events = [
    { type: 'hold', at: '2026-11-17T01:30:00Z' }, { type: 'resume', at: '2026-11-17T02:00:00Z' },
    { type: 'hold', at: '2026-11-17T03:30:00Z' }, { type: 'resume', at: '2026-11-17T03:45:00Z' },  // ระหว่างสถานี
    { type: 'hold', at: '2026-11-17T05:00:00Z' },                                               // ยังพักอยู่
  ]
  const lines = visitLines(rows, names, now, events)
  assert.deepEqual(lines.map(l => l.span), ['1.5 ชม.', '1 ชม. (ยังทำอยู่)'])
  assert.deepEqual(lines.map(l => l.paused), ['30 นาที', '1 ชม.'])
  assert.deepEqual(pauseRanges(events, now).length, 3)
})
