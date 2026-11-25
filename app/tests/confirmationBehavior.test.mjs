import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { boot } from './confirmationHarness.mjs'

const OUTBOX = 'pp142.confirmation.outbox'
const SAMPLE_YES = 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)'
const sent = store => JSON.parse(store.get(OUTBOX))

function filled(product = 'tshirt') {
  const b = boot()
  const s = b.api.state
  s.pickOpen = false
  s.product = product
  Object.assign(s.h, { doc_no: 'SC-T1', customer: 'ลูกค้า', issue_date: '2026-11-24', due_date: '2026-12-10' })
  return { ...b, s, v: b.api.scope('p') }
}

test('ฟอร์มใบยืนยัน: ขนาดสำเร็จที่กรอกเอง (ตารางขนาดเสื้อ) ส่งเข้าระบบครบ ไม่ถูกตัดเพราะช่อง id เดียวกันของกางเกงถูกซ่อน', () => {
  const { api, store, v } = filled()
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'ขาว', q: { M: '10' } }]
  v.size_chart = 'กำหนดขนาดเอง (ตามตารางด้านล่าง)'
  v.measure_rows = [{ size: 'M', chest: '40' }]
  api.saveToSystem()
  assert.deepEqual(sent(store).p.tshirt.measure_rows, [{ size: 'M', chest: '40' }])
})

test('ฟอร์มใบยืนยัน: เอาติ๊กชุดไซซ์ออกแล้ว จำนวนของชุดนั้นไม่ถูกส่ง (ไม่โผล่เป็นแบบในระบบ)', () => {
  const { api, store, v } = filled()
  v.size_sets = ['ไซซ์ผู้ใหญ่', 'ไซซ์เด็ก']
  v.sizes = [{ label: 'ขาว', q: { M: '10', 'เด็ก S': '5' } }]
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  api.saveToSystem()
  const out = sent(store)
  assert.deepEqual(out.p.tshirt.sizes[0].q, { M: '10' })
  assert.equal(out.summary.qty, 10)
})

test('ฟอร์มใบยืนยัน: จำนวนติดลบ บันทึกเข้าระบบไม่ได้ · บอกให้แก้', () => {
  const { api, store, g, v } = filled()
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'a', q: { M: '10', L: '-3' } }]
  api.saveToSystem()
  assert.equal(store.has(OUTBOX), false)
  assert.match(g.alerts.at(-1), /ต้องแก้ 1 รายการก่อนบันทึกเข้าระบบ/)
})

test('ฟอร์มใบยืนยัน: เปลี่ยนเป็นไม่ขึ้นตัวอย่าง วันนัดส่งตัวอย่างที่ซ่อนอยู่ไม่บล็อก ไม่พิมพ์ ไม่ส่ง', () => {
  const { api, store, els, s, v } = filled()
  Object.assign(s.h, { sample: SAMPLE_YES, sample_date: '2026-12-20' })
  s.h.sample = 'ไม่ขึ้นตัวอย่าง'
  assert.deepEqual(api.validate().filter(m => m.hard).map(m => m.id), [])
  s.h.sample_date = '2026-12-05'
  api.renderDoc()
  assert.equal(els.get('#doc').innerHTML.includes('วันนัดส่งตัวอย่าง'), false)
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'a', q: { M: '1' } }]
  api.saveToSystem()
  assert.equal('sample_date' in sent(store).h, false)
})

test('ฟอร์มใบยืนยัน: เปลี่ยนเป็นไม่มีลาย ข้อความรายตัวที่กรอกไว้ไม่พิมพ์และไม่ส่ง', () => {
  const { api, store, els, v } = filled()
  v.print_method = ['DTF (ฟิล์มรีดร้อน)']
  v.personal = ['ชื่อรายตัว']
  v.personal_pos = 'หลัง 10 ซม.'
  v.print_method = ['ไม่มีลาย']
  api.renderDoc()
  assert.equal(els.get('#doc').innerHTML.includes('หลัง 10 ซม.'), false)
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'a', q: { M: '1' } }]
  api.saveToSystem()
  assert.equal(sent(store).p.tshirt.personal_pos, undefined)
})

test('ฟอร์มใบยืนยัน: จุดกำกับบนม็อคอัพอ้างช่องที่ถูกซ่อนไม่ได้ · "อื่นๆ" แสดงข้อความที่พิมพ์', () => {
  const { api, v } = filled()
  v.print_method = ['DTF (ฟิล์มรีดร้อน)']
  v.placements = { 'หน้าอกซ้าย': { on: true, size: '8x8' } }
  v.print_method = ['ซับลิเมชั่น พิมพ์ทั้งตัว (All-over)']
  v.fabric = 'อื่นๆ'
  v.fabric__other = 'ผ้าไมโครพีช'
  const refs = api.coRefs()
  assert.equal(refs.some(r => r.ref.startsWith('placement:')), false)
  assert.equal(refs.find(r => r.ref === 'field:fabric')?.val, 'อื่นๆ: ผ้าไมโครพีช')
})

test('ฟอร์มใบยืนยัน: ส่งเข้าระบบเฉพาะสินค้าที่เลือก ไม่พาข้อมูลสินค้าอื่นที่เคยกรอกในฟอร์มไปด้วย', () => {
  const { api, store, s, v } = filled()
  s.p.polo = { collar: 'ปกจีน' }
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'a', q: { M: '1' } }]
  api.saveToSystem()
  assert.deepEqual(Object.keys(sent(store).p), ['tshirt'])
})

test('ฟอร์มใบยืนยัน: บันทึกไฟล์ใบแก้แล้วเปิดใหม่ ยังเป็นโหมดแก้ใบ (ไม่กลายเป็นใบใหม่ที่ระบบปฏิเสธ)', () => {
  const { api } = boot()
  api.loadData({ h: { doc_no: 'SC-R1', customer: 'x', rev: '' }, p: { tshirt: {} }, product: 'tshirt', from_job: true }, 'x')
  assert.equal(api.revising(), true)
  const file = JSON.parse(JSON.stringify({ app: 'phappim-confirm', v: 1, ...api.state }))
  const again = boot()
  again.api.loadData(file, 'file')
  assert.equal(again.api.revising(), true)
})

test('ฟอร์มใบยืนยัน: คำอธิบายใต้ตัวเลือกทุกคำตรงกับตัวเลือกที่มีจริง (พิมพ์ผิด = คำอธิบายไม่ขึ้น)', () => {
  const { api } = boot()
  const html = readFileSync(new URL('../../production-confirmation.html', import.meta.url), 'utf8')
  const block = html.slice(html.indexOf('const OPT_DESC = {'), html.indexOf('};', html.indexOf('const OPT_DESC = {')))
  const keys = [...block.matchAll(/^\s+'([^']+)':/gm)].map(m => m[1])
  assert.ok(keys.length > 30)
  const options = new Set(Object.values(api.PRODUCTS).flatMap(p => p.sections.flatMap(s => s.fields.flatMap(f => [...(f.options || []), ...(f.cols || []).flatMap(c => c.options || [])]))))
  assert.deepEqual(keys.filter(k => !options.has(k)), [])
})

test('ฟอร์มใบยืนยัน: ตัวเลือก "ลูกค้าส่งผ้ามาเอง" ไม่อยู่ในสินค้าที่ไม่ใช่ผ้า (โล่ ของพรีเมียม กระเป๋าสาน)', () => {
  const { api } = boot()
  for (const code of ['plaque', 'premium', 'kajood']) {
    const methods = api.PRODUCTS[code].sections.flatMap(s => s.fields).find(f => f.id === 'print_method').options
    assert.equal(methods.some(m => m.startsWith('ลูกค้าส่งผ้ามาเอง')), false, code)
  }
})

test('ฟอร์มใบยืนยัน: ใบเก่าที่ใช้ชื่อตัวเลือกเดิม (แขนจั๊ม (Raglan) · ม้วนริม มม.) เปิดแล้วเป็นชื่อใหม่ ไม่ต้องเลือกใหม่', () => {
  const { api } = boot()
  api.loadData({ h: { doc_no: 'SC-OLD', customer: 'x' }, product: 'tshirt', p: { tshirt: { sleeve: 'แขนจั๊ม (Raglan)' }, scarf: { sew_style: 'ม้วนริม 0.3 มม.', fit: ['แขนจั๊ม (Raglan)'] } } }, 'x')
  assert.equal(api.state.p.tshirt.sleeve, 'แขนแร็กแลน (Raglan)')
  assert.equal(api.state.p.scarf.sew_style, 'ม้วนริม 0.3 ซม.')
  assert.deepEqual(api.state.p.scarf.fit, ['แขนแร็กแลน (Raglan)'])
  const sleeve = api.PRODUCTS.tshirt.sections.flatMap(s => s.fields).find(f => f.id === 'sleeve').options
  assert.ok(sleeve.includes('แขนแร็กแลน (Raglan)') && !sleeve.includes('แขนจั๊ม (Raglan)'))
})
