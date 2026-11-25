import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { confirmationPath, developChoice, draftFromConfirmation, pdfProblem, reviseArgs, sampleChoice, specYearProblem, syncConfirmationSpec, totalQty } from '../src/data/confirmation.ts'
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
  assert.equal(d.route, null)
})

test('กรณีบั๊กจริง G1 รอบ 2: เสื้อยืด + งานปัก + ซับลิเมชั่น พิมพ์ทั้งตัว + M=20 → 20 ตัว (เส้นทางแอดมินเลือกเอง)', () => {
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
  assert.equal(d.route, null)
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

test('ไม่เดาเส้นทางจากเทคนิคพิมพ์หรือ summary เก่า: แอดมินเลือกเองตอนรับงาน (เจ้าของตัดสิน 19 พ.ย.)', () => {
  assert.equal(draftFromConfirmation(form({ p: { polo: { print_method: ['งานปัก'] } } })).route, null)
  assert.equal(draftFromConfirmation(form({ summary: { qty: 3, route: 'emb' } })).route, null)
})

test('รองรับไฟล์รุ่นเก่า (p เก็บคำตอบไว้ชั้นบนสุด) และตารางรายการ items ใน draftFromConfirmation', () => {
  const legacy = draftFromConfirmation(form({
    p: { sizes: [{ q: { S: '4', M: '6' } }], spare: '1', print_method: 'งานปัก' },
  }))
  assert.equal(legacy.qty, 10)
  assert.equal(legacy.spare, 1)

  const itemJob = draftFromConfirmation(form({
    product: 'banner',
    p: { banner: { items: [{ name: 'A', qty: '7' }, { name: 'B', qty: '8' }], spare: '2', print_method: ['ซิลค์สกรีน'] } },
  }))
  assert.equal(itemJob.qty, 15)
  assert.equal(itemJob.spare, 2)
})

test('ใช้ summary.qty จากฟอร์มก่อนเมื่อมีค่าถูกต้อง · ว่าง/0 ให้คำนวณเอง', () => {
  const withSummary = draftFromConfirmation(form({
    // จำลองค่าค้างใน sizes ของชุดไซซ์ที่ปิดไปแล้ว แต่ฟอร์มสรุปยอดจริงใน summary เป็น 12 และ route เป็น emb
    p: { polo: { sizes: [{ q: { S: '99' } }], spare: '2', print_method: ['DTF (ฟิล์มรีดร้อน)'] } },
    summary: { qty: 12, route: 'emb' },
  }))
  assert.equal(withSummary.qty, 12)

  const customRoute = draftFromConfirmation(form({
    summary: { qty: 35, route: 'custom' },
  }))
  assert.equal(customRoute.qty, 35)

  const emptySummary = draftFromConfirmation(form({
    summary: { qty: 0, route: '' },
  }))
  assert.equal(emptySummary.qty, 35)
})

test('อ่านไฟล์ fixture จริงจาก production-confirmation.html 3 แบบได้ถูกต้อง (ทั้งมี summary และไม่มี summary)', () => {
  const cases = [
    ['tshirt-print-emb.json', 'TEST-C7-1', 'tshirt', 20, 2, null, true],
    ['polo-dtf.json', 'TEST-C7-2', 'polo', 25, 1, null, false],
    ['banner-items.json', 'TEST-C7-3', 'banner', 15, 1, null, true],
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

test('งาน Develop: ขึ้นตัวอย่าง + จบที่ตัวอย่าง · ขึ้นตัวอย่างปกติ/ไม่ขึ้น/ไฟล์เก่า ไม่ใช่ Develop', () => {
  const dev = { sample: 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)' }
  assert.equal(sampleChoice(dev), true)
  assert.equal(developChoice(dev), true)
  assert.equal(developChoice({ sample: 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)' }), false)
  assert.equal(developChoice({ sample: 'ไม่ขึ้นตัวอย่าง' }), false)
  assert.equal(developChoice({}), false)
  const d = draftFromConfirmation({ h: { doc_no: 'SC1', ...dev }, p: { tshirt: { qty: 2 } }, product: 'tshirt' })
  assert.equal(d?.needsSample, true)
  assert.equal(d?.develop, true)
})

test('วันกำหนดส่งรูปแบบผิด = ว่าง ให้กรอกเอง', () => {
  assert.equal(draftFromConfirmation(form({ h: { ...form().h, due_date: '30/11/2569' } })).due, '')
})

test('ชื่อไฟล์ PDF เป็นอังกฤษ/ตัวเลขเท่านั้น และตั้งจากเนื้อไฟล์ (ส่งซ้ำได้ชื่อเดิม)', () => {
  const key = '0a1b2c3d4e5f6071'
  assert.equal(confirmationPath('SC691451', key), `SC691451/${key}.pdf`)
  assert.equal(confirmationPath('SC 69/14 ไทย', key), `SC_69_14____/${key}.pdf`)
  assert.equal(confirmationPath('  ', key), `job/${key}.pdf`)
  assert.match(confirmationPath('SC 69/14 ไทย', key), /^[A-Za-z0-9_-]{1,200}\/[A-Za-z0-9]{1,64}\.pdf$/)
})

test('PDF: ต้องมีไฟล์ · ต้องเป็น PDF · ไม่เกิน 20 MB', () => {
  assert.match(pdfProblem(null), /ต้องแนบ PDF/)
  assert.match(pdfProblem({ name: 'a.jpg', size: 10, type: 'image/jpeg' }), /ต้องเป็น PDF/)
  assert.match(pdfProblem({ name: 'a.pdf', size: 21 * 1024 * 1024, type: 'application/pdf' }), /เกิน 20 MB/)
  assert.equal(pdfProblem({ name: 'a.pdf', size: 200_000, type: 'application/pdf' }), null)
  assert.equal(pdfProblem({ name: 'a.pdf', size: 20 * 1024 * 1024, type: 'application/pdf' }), null)
  assert.match(pdfProblem({ name: 'a.pdf', size: 20 * 1024 * 1024 + 1, type: 'application/pdf' }), /20\.1 MB เกิน 20 MB/)
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

test('วันคาดว่าเสร็จใหม่: ใช้ 18:00 ไทย (เลิกงาน) · เลยเวลาเลิกงานวันนี้ใช้สิ้นวัน · วันที่ผ่านไปแล้วใช้ไม่ได้', () => {
  const morning = new Date('2026-11-17T09:00:00+07:00')
  assert.equal(etaFromDay('2026-11-17', morning).toISOString(), '2026-11-17T11:00:00.000Z')
  const evening = new Date('2026-11-17T18:00:00+07:00')
  assert.equal(etaFromDay('2026-11-17', evening).toISOString(), '2026-11-17T16:59:00.000Z')
  assert.equal(etaFromDay('2026-11-16', evening), null)
  assert.equal(etaFromDay('', evening), null)
})

test('ใบที่แก้หลังรับงาน → ค่าส่งให้ revise_job_spec · ไม่เก็บค่าชั่วคราวของฟอร์มในสเปก', () => {
  const a = reviseArgs(form({
    revise_job: true, from_job: true, mockup: 'data:image/jpeg;base64,AAAA', mockup_path: 'SC691451/a.jpg', job_img: 'https://x/y',
    changes: ['สีผ้าพื้น', ' สีผ้าพื้น ', '', 5, 'ที่อยู่จัดส่ง'],
    h: { doc_no: ' SC691451 ', rev: '2', job_name: 'เสื้อทีม', customer: 'บริษัท เซอร์ราวด์', due_date: '2026-12-05', sample: 'ไม่ขึ้นตัวอย่าง' },
  }))
  assert.equal(a.p_rev, 2)
  assert.equal(a.p_qty, 35)
  assert.equal(a.p_spare_qty, 3)
  assert.equal(a.p_due_date, '2026-12-05')
  assert.equal(a.p_needs_sample, false)
  assert.equal(a.p_customer_name, 'บริษัท เซอร์ราวด์')
  assert.deepEqual(a.p_changes, ['สีผ้าพื้น', 'ที่อยู่จัดส่ง'])
  for (const k of ['imgs', 'revise_job', 'from_job', 'mockup', 'mockup_path', 'job_img', 'changes']) assert.ok(!(k in a.p_spec), k)
  assert.equal(a.p_spec.product, 'polo')
  assert.equal(a.p_spec.h.doc_no, ' SC691451 ')
})

test('ใบแก้ที่ไม่มีกำหนดส่ง / ไม่ได้เลือกขึ้นตัวอย่าง ส่งค่าว่างให้ฐานข้อมูลปฏิเสธพร้อมเหตุผล', () => {
  const a = reviseArgs(form({ h: { doc_no: 'SC1', rev: 1, customer: 'ก', due_date: '' } }))
  assert.equal(a.p_due_date, null)
  assert.equal(a.p_needs_sample, null)
  assert.deepEqual(a.p_changes, [])
  assert.equal(reviseArgs({ h: {} }), null)
})

test('ไฟล์ .json ที่มีฉบับคัดแล้ว (sys) ใช้ฉบับคัด · ชุดไซซ์ที่ไม่ได้ติ๊ก สินค้าอื่น และลายเซ็นฟอร์มไม่เข้าสเปก', () => {
  const d = draftFromConfirmation(form({
    product: 'tshirt', sent_sig: 'x'.repeat(5000), pickOpen: false, summary: { qty: 10 },
    p: { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ q: { M: '10', 'เด็ก S': '5' } }], personal_pos: 'ซ่อนอยู่' }, polo: { sizes: [{ q: { M: '3' } }] } },
    sys: { h: { doc_no: 'SC691451', customer: 'บริษัท เซอร์ราวด์', due_date: '2026-11-30' }, p: { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ q: { M: '10' } }] } } },
  }))
  assert.equal(d.qty, 10)
  assert.deepEqual(d.spec.p, { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ q: { M: '10' } }] } })
  for (const k of ['sys', 'sent_sig', 'pickOpen', 'imgs']) assert.equal(k in d.spec, false, k)
})

test('ไฟล์ .json เก่าที่ไม่มี sys: เก็บเฉพาะคำตอบของสินค้าที่เลือก ไม่พาสินค้าอื่นและลายเซ็นฟอร์มเข้าสเปก', () => {
  const d = draftFromConfirmation(form({ sent_sig: 'x', p: { polo: { sizes: [{ q: { M: '2' } }] }, tshirt: { sizes: [{ q: { M: '9' } }] } } }))
  assert.deepEqual(Object.keys(d.spec.p), ['polo'])
  assert.equal('sent_sig' in d.spec, false)
})

test('สินค้าในใบปิดใช้แล้ว แอดมินเลือกสินค้าใหม่: สเปกเปลี่ยนเป็นสินค้าใหม่ (แก้ใบภายหลังได้) · สินค้าเดิมสเปกไม่เปลี่ยน', () => {
  const d = draftFromConfirmation(form())
  const same = syncConfirmationSpec(d, 'เสื้อโปโล')
  assert.equal(same.product, 'polo')
  assert.equal(same.p.polo.spare, 3)
  const moved = syncConfirmationSpec({ ...d, product: 'tshirt' }, 'เสื้อยืด')
  assert.equal(moved.product, 'tshirt')
  assert.deepEqual(Object.keys(moved.p), ['tshirt'])
  assert.deepEqual(moved.p.tshirt.sizes, d.spec.p.polo.sizes)
})

test('ปีของวันที่ออกใบ / วันนัดส่งตัวอย่างในไฟล์เป็น พ.ศ. ต้องแก้ในฟอร์มก่อนรับงาน · ปี ค.ศ. ผ่าน', () => {
  assert.equal(specYearProblem(draftFromConfirmation(form())), null)
  assert.equal(specYearProblem(draftFromConfirmation(form({ h: { ...form().h, issue_date: '2569-11-20' } }))), 'วันที่ออกใบ')
  assert.equal(specYearProblem(draftFromConfirmation(form({ h: { ...form().h, issue_date: '2026-11-20', sample_date: '2569-11-25' } }))), 'วันนัดส่งตัวอย่าง')
})
