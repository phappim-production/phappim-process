import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmationPath, draftFromConfirmation, pdfProblem, suggestRoute, totalQty } from '../src/data/confirmation.ts'
import { etaFromDay, missingSteps } from '../src/data/stationSteps.ts'

const form = (over = {}) => ({
  app: 'phappim-confirm', v: 1, product: 'polo', imgs: ['data:image/png;base64,AAAA'],
  h: { doc_no: ' SC691451 ', rev: '1', job_name: 'เสื้อทีม', customer: 'บริษัท เซอร์ราวด์', due_date: '2026-11-30' },
  p: { sizes: [{ q: { S: '10', M: 20 } }, { q: { L: '5', XL: '' } }], spare: '3', print_method: ['DTF (ฟิล์มรีดร้อน)'] },
  ...over,
})

test('ไฟล์ .json จากฟอร์มใบยืนยัน → ช่องหน้ารับงาน', () => {
  const d = draftFromConfirmation(form())
  assert.equal(d.no, 'SC691451')
  assert.equal(d.rev, 1)
  assert.equal(d.customer, 'บริษัท เซอร์ราวด์')
  assert.equal(d.product, 'polo')
  assert.equal(d.qty, 35)
  assert.equal(d.spare, 3)
  assert.equal(d.due, '2026-11-30')
  assert.equal(d.route, 'dtf')
})

test('ภาพม็อคอัพไม่ถูกเก็บลงฐานข้อมูล แต่คำตอบอื่นเก็บครบ', () => {
  const d = draftFromConfirmation(form())
  assert.equal('imgs' in d.spec, false)
  assert.deepEqual(d.spec.h, form().h)
})

test('ไฟล์อื่นที่ไม่ใช่ใบยืนยัน = null', () => {
  assert.equal(draftFromConfirmation(null), null)
  assert.equal(draftFromConfirmation({ hello: 1 }), null)
  assert.equal(draftFromConfirmation({ h: {}, p: {} }), null)
})

test('จำนวน: ไม่มีตารางไซซ์ใช้ช่องจำนวน · ค่าเพี้ยนนับเป็น 0', () => {
  assert.equal(totalQty({ qty: '2' }), 2)
  assert.equal(totalQty({ sizes: [{ q: { S: 'สิบ', M: -3 } }] }), 0)
  assert.equal(totalQty({}), 0)
})

test('เส้นทางตามเทคนิคพิมพ์: DTF · ซับลิเมชั่น/ดิจิทัล = ปกติ · อื่นๆ = ไม่พิมพ์', () => {
  assert.equal(suggestRoute({ print_method: ['ซับลิเมชั่น พิมพ์ทั้งตัว (All-over)', 'DTF (ฟิล์มรีดร้อน)'] }), 'dtf')
  assert.equal(suggestRoute({ print_method: 'ดิจิทัลพริ้นท์' }), 'normal')
  assert.equal(suggestRoute({ print_method: ['งานปัก'] }), 'plain')
  assert.equal(suggestRoute({}), 'plain')
})

test('วันกำหนดส่งรูปแบบผิด = ว่าง ให้กรอกเอง', () => {
  assert.equal(draftFromConfirmation(form({ h: { ...form().h, due_date: '30/11/2569' } })).due, '')
})

test('ชื่อไฟล์ PDF ใน Storage เป็นอังกฤษ/ตัวเลขเท่านั้น และไม่ซ้ำ', () => {
  const at = new Date('2026-11-17T03:00:00Z')
  assert.equal(confirmationPath('SC691451', at), `SC691451/${at.getTime()}.pdf`)
  assert.equal(confirmationPath('SC 69/14 ไทย', at), `SC_69_14____/${at.getTime()}.pdf`)
  assert.equal(confirmationPath('  ', at), `job/${at.getTime()}.pdf`)
})

test('PDF: ต้องมีไฟล์ · ต้องเป็น PDF · ไม่เกิน 20 MB', () => {
  assert.match(pdfProblem(null), /ต้องแนบ PDF/)
  assert.match(pdfProblem({ name: 'a.jpg', size: 10, type: 'image/jpeg' }), /ต้องเป็น PDF/)
  assert.match(pdfProblem({ name: 'a.pdf', size: 21 * 1024 * 1024, type: 'application/pdf' }), /เกิน 20 MB/)
  assert.equal(pdfProblem({ name: 'a.pdf', size: 200_000, type: 'application/pdf' }), null)
})

const steps = [
  { key: 'receive_job', name: 'รับใบงาน', kind: 'req' },
  { key: 'check_ink', name: 'ตรวจหมึก', kind: 'opt' },
  { key: 'nesting', name: 'เลย์เอาต์', kind: 'num' },
  { key: 'test_print', name: 'พิมพ์ทดสอบ', kind: 'appr' },
  { key: 'check_print', name: 'ตรวจงานพิมพ์', kind: 'req' },
]
const ctx = over => ({ station: 'print', phase: 'production', rework: false, done: new Set(), filmReceived: false, qcPassed: 0, qty: 10, ...over })
const names = list => list.map(s => s.name)

test('ผลิตจริง: ขั้นบังคับทุกชนิดยกเว้นเช็คลิสต์ ต้องทำก่อนกดเสร็จ', () => {
  assert.deepEqual(names(missingSteps(steps, ctx())), ['รับใบงาน', 'เลย์เอาต์', 'พิมพ์ทดสอบ', 'ตรวจงานพิมพ์'])
  assert.deepEqual(names(missingSteps(steps, ctx({ done: new Set(['receive_job', 'nesting', 'test_print']) }))), ['ตรวจงานพิมพ์'])
})

test('ขึ้นตัวอย่าง: บังคับเฉพาะขั้น "ต้องติ๊ก" · QC ไม่บังคับ', () => {
  assert.deepEqual(names(missingSteps(steps, ctx({ phase: 'sample' }))), ['รับใบงาน', 'ตรวจงานพิมพ์'])
  assert.deepEqual(missingSteps([{ key: 'boxed', name: 'ลงลัง', kind: 'req' }], ctx({ phase: 'sample', station: 'qc_pack' })), [])
})

test('งานแก้ไม่ต้องติ๊กซ้ำ ยกเว้น QC · เย็บใช้ยืนยันเสร็จครั้งเดียว', () => {
  assert.deepEqual(missingSteps(steps, ctx({ rework: true })), [])
  assert.equal(missingSteps([{ key: 'boxed', name: 'ลงลัง', kind: 'req' }], ctx({ rework: true, station: 'qc_pack' })).length, 1)
  assert.deepEqual(missingSteps([{ key: 'issue_to_sew', name: 'จ่ายงาน', kind: 'req' }], ctx({ station: 'sew' })), [])
})

test('ฟิล์ม DTF ล็อกจนได้รับ · ผล QC ผ่านครบตามจำนวนสั่ง', () => {
  const film = [{ key: 'film_received', name: 'ได้รับฟิล์ม', kind: 'lock' }]
  assert.equal(missingSteps(film, ctx({ station: 'dtf_press' })).length, 1)
  assert.equal(missingSteps(film, ctx({ station: 'dtf_press', filmReceived: true })).length, 0)
  const qc = [{ key: 'inspect', name: 'ตรวจ', kind: 'num' }]
  assert.equal(missingSteps(qc, ctx({ station: 'qc_pack', qcPassed: 9 })).length, 1)
  assert.equal(missingSteps(qc, ctx({ station: 'qc_pack', qcPassed: 10 })).length, 0)
})

test('วันคาดว่าเสร็จใหม่: ใช้ 17:00 ไทย · เลยเวลาเลิกงานวันนี้ใช้สิ้นวัน · วันที่ผ่านไปแล้วใช้ไม่ได้', () => {
  const morning = new Date('2026-11-17T09:00:00+07:00')
  assert.equal(etaFromDay('2026-11-17', morning).toISOString(), '2026-11-17T10:00:00.000Z')
  const evening = new Date('2026-11-17T18:00:00+07:00')
  assert.equal(etaFromDay('2026-11-17', evening).toISOString(), '2026-11-17T16:59:00.000Z')
  assert.equal(etaFromDay('2026-11-16', evening), null)
  assert.equal(etaFromDay('', evening), null)
})
