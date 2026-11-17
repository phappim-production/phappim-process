import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { confirmationPath, draftFromConfirmation, pdfProblem, sampleChoice, suggestRoute, totalQty } from '../src/data/confirmation.ts'
import { etaFromDay, missingSteps } from '../src/data/stationSteps.ts'

const form = (over = {}) => ({
  app: 'phappim-confirm', v: 1, product: 'polo', imgs: ['data:image/png;base64,AAAA'],
  h: { doc_no: ' SC691451 ', rev: '1', job_name: 'เสื้อทีม', customer: 'บริษัท เซอร์ราวด์', due_date: '2026-11-30' },
  p: { polo: { sizes: [{ q: { S: '10', M: 20 } }, { q: { L: '5', XL: '' } }], spare: '3', print_method: ['DTF (ฟิล์มรีดร้อน)'] } },
  ...over,
})

const loadFixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

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

test('กรณีบั๊กจริง G1 รอบ 2: เสื้อยืด + งานปัก + ซับลิเมชั่น พิมพ์ทั้งตัว + M=20 → print_emb · 20', () => {
  const d = draftFromConfirmation(form({
    product: 'tshirt',
    h: { doc_no: 'TEST-G2-JSON', customer: 'ทดสอบ', job_name: 'TEST-G2-JSON', sample: 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)' },
    p: {
      tshirt: {
        size_sets: ['ไซซ์ผู้ใหญ่'],
        sizes: [{ q: { M: '20' } }],
        print_method: ['งานปัก', 'ซับลิเมชั่น พิมพ์ทั้งตัว (All-over)'],
      },
    },
  }))
  assert.equal(d.route, 'print_emb')
  assert.equal(d.qty, 20)
  assert.equal(d.needsSample, true)
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

test('จำนวน: ตารางไซซ์ → ตารางรายการ items → ช่องจำนวน · ค่าเพี้ยนนับเป็น 0', () => {
  assert.equal(totalQty({ items: [{ qty: '5' }, { qty: 10 }, { qty: 'bad' }] }), 15)
  assert.equal(totalQty({ qty: '2' }), 2)
  assert.equal(totalQty({ sizes: [{ q: { S: 'สิบ', M: -3 } }] }), 0)
  assert.equal(totalQty({}), 0)
})

test('เส้นทางครบ 7 แบบที่ฟอร์มให้ได้ · อื่นๆ ใช้ print_method__other · print_method เป็น string', () => {
  assert.equal(suggestRoute({ print_method: ['ซับลิเมชั่น พิมพ์ทั้งตัว (All-over)', 'DTF (ฟิล์มรีดร้อน)'] }), 'dtf')
  assert.equal(suggestRoute({ print_method: ['DTG'] }), 'dtg')
  assert.equal(suggestRoute({ print_method: ['ซิลค์สกรีน'] }), 'screen')
  assert.equal(suggestRoute({ print_method: ['ซับลิเมชั่น เฉพาะจุด', 'งานปัก'] }), 'print_emb')
  assert.equal(suggestRoute({ print_method: ['งานปัก'] }), 'emb')
  assert.equal(suggestRoute({ print_method: 'ดิจิทัลพริ้นท์' }), 'normal')
  assert.equal(suggestRoute({ print_method: ['ซับเต็มผืน'] }), 'normal')
  assert.equal(suggestRoute({ print_method: ['อื่นๆ'], print_method__other: 'ซับเฉพาะจุด' }), 'normal')
  assert.equal(suggestRoute({ print_method: ['ไม่มีลาย'] }), 'plain')
  assert.equal(suggestRoute({}), 'plain')
})

test('รองรับไฟล์รุ่นเก่า (p เก็บคำตอบไว้ชั้นบนสุด) และตารางรายการ items ใน draftFromConfirmation', () => {
  const legacy = draftFromConfirmation(form({
    p: { sizes: [{ q: { S: '4', M: '6' } }], spare: '1', print_method: 'งานปัก' },
  }))
  assert.equal(legacy.qty, 10)
  assert.equal(legacy.spare, 1)
  assert.equal(legacy.route, 'emb')

  const itemJob = draftFromConfirmation(form({
    product: 'banner',
    p: { banner: { items: [{ name: 'A', qty: '7' }, { name: 'B', qty: '8' }], spare: '2', print_method: ['ซิลค์สกรีน'] } },
  }))
  assert.equal(itemJob.qty, 15)
  assert.equal(itemJob.spare, 2)
  assert.equal(itemJob.route, 'screen')
})

test('ใช้ summary จากฟอร์มก่อนเมื่อมีค่าถูกต้อง · summary.route เป็น custom หรือว่าง ให้คำนวณเอง', () => {
  const withSummary = draftFromConfirmation(form({
    // จำลองค่าค้างใน sizes ของชุดไซซ์ที่ปิดไปแล้ว แต่ฟอร์มสรุปยอดจริงใน summary เป็น 12 และ route เป็น emb
    p: { polo: { sizes: [{ q: { S: '99' } }], spare: '2', print_method: ['DTF (ฟิล์มรีดร้อน)'] } },
    summary: { qty: 12, route: 'emb' },
  }))
  assert.equal(withSummary.qty, 12)
  assert.equal(withSummary.route, 'emb')

  const customRoute = draftFromConfirmation(form({
    summary: { qty: 35, route: 'custom' },
  }))
  assert.equal(customRoute.qty, 35)
  assert.equal(customRoute.route, 'dtf')

  const emptySummary = draftFromConfirmation(form({
    summary: { qty: 0, route: '' },
  }))
  assert.equal(emptySummary.qty, 35)
  assert.equal(emptySummary.route, 'dtf')
})

test('อ่านไฟล์ fixture จริงจาก production-confirmation.html 3 แบบได้ถูกต้อง (ทั้งมี summary และไม่มี summary)', () => {
  const cases = [
    ['tshirt-print-emb.json', 'TEST-C7-1', 'tshirt', 20, 2, 'print_emb', true],
    ['polo-dtf.json', 'TEST-C7-2', 'polo', 25, 1, 'dtf', false],
    ['banner-items.json', 'TEST-C7-3', 'banner', 15, 1, 'normal', true],
  ]
  for (const [file, no, product, qty, spare, route, needsSample] of cases) {
    const raw = loadFixture(file)
    const d1 = draftFromConfirmation(raw)
    assert.equal(d1.no, no)
    assert.equal(d1.product, product)
    assert.equal(d1.qty, qty)
    assert.equal(d1.spare, spare)
    assert.equal(d1.route, route)
    assert.equal(d1.needsSample, needsSample)

    const { summary: _s, ...withoutSummary } = raw
    const d2 = draftFromConfirmation(withoutSummary)
    assert.equal(d2.qty, qty)
    assert.equal(d2.route, route)
  }
})

test('ขึ้นตัวอย่าง: อ่านจากใบยืนยัน · ไฟล์รุ่นเก่าไม่มีช่องนี้ = ยังไม่เลือก', () => {
  assert.equal(sampleChoice({ sample: 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)' }), true)
  assert.equal(sampleChoice({ sample: 'ไม่ขึ้นตัวอย่าง' }), false)
  assert.equal(sampleChoice({}), null)
  assert.equal(draftFromConfirmation(form()).needsSample, null)
  assert.equal(draftFromConfirmation(form({ h: { ...form().h, sample: 'ไม่ขึ้นตัวอย่าง' } })).needsSample, false)
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

test('เริ่ม → เสร็จ: เช็คลิสต์ขั้นย่อยไม่บังคับทุกชนิด ทั้งผลิตจริงและขึ้นตัวอย่าง', () => {
  assert.deepEqual(missingSteps(steps, ctx()), [])
  assert.deepEqual(missingSteps(steps, ctx({ phase: 'sample' })), [])
  assert.deepEqual(missingSteps([{ key: 'boxed', name: 'ลงลัง', kind: 'req' }], ctx({ station: 'qc_pack', qcPassed: 10 })), [])
})

test('งานแก้ไม่ต้องทำซ้ำ ยกเว้น QC ต้องผ่านครบ · เย็บใช้ยืนยันเสร็จครั้งเดียว', () => {
  assert.deepEqual(missingSteps(steps, ctx({ rework: true })), [])
  assert.equal(missingSteps([{ key: 'inspect', name: 'ตรวจ', kind: 'num' }], ctx({ rework: true, station: 'qc_pack' })).length, 1)
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
