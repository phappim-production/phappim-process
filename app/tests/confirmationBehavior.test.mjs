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

test('ฟอร์มใบยืนยัน: เสื้อทุกแบบที่มีตัวเลือกคอ ใส่ปกได้ทุกคอ (คอกลม / คอวี มีปกได้) · ตั้งต้นไม่มีปก · ไม่มีปกไม่พิมพ์ลง PDF', () => {
  const collarOf = (api, product) => api.PRODUCTS[product].sections.flatMap(s => s.fields).find(f => f.id === 'collar')
  for (const [product, key, round] of [['tshirt', 'neck', 'คอวี'], ['sport', 'cut', 'คอกลม แขนสั้น'], ['jersey', 'neck', 'คอกลม'], ['running', 'cut', 'คอวี แขนสั้น'],
    ['worker', 'cut', 'คอกลม'], ['pe', 'cut', 'คอวี'], ['student', 'cut', 'เสื้อยืดคอกลม'], ['mourning', 'cut', 'เสื้อยืดคอวี']]) {
    const { api, v } = filled(product)
    const collar = collarOf(api, product)
    assert.deepEqual(collar?.options, ['ไม่มีปก', 'ปกสำเร็จ', 'ปกพิมพ์', 'ปกจีน'], product)
    assert.equal(collar.def, 'ไม่มีปก', product)
    v[key] = round
    assert.equal(api.visible(collar, v), true, `${product}: ${round}`)
    v.collar = 'ไม่มีปก'
    assert.equal(api.validate().some(m => m.id === 'fld_p_collar'), false, `${product}: ไม่มีปก กับคอที่ไม่ใช่คอปก ไม่เตือน`)
  }
  const polo = filled('polo').api.PRODUCTS.polo.sections.flatMap(s => s.fields).find(f => f.id === 'collar')
  assert.deepEqual(polo.options, ['ปกสำเร็จ', 'ปกพิมพ์', 'ปกจีน'])

  const { api, els, v } = filled('tshirt')
  api.setViewOnly(true)
  Object.assign(v, { neck: 'คอวี', collar: 'ปกพิมพ์' })
  api.renderDoc()
  assert.match(els.get('#doc').innerHTML, /ปกพิมพ์/)
  v.collar = 'ไม่มีปก'
  api.renderDoc()
  assert.equal(els.get('#doc').innerHTML.includes('ไม่มีปก'), false)
})

test('ฟอร์มใบยืนยัน: เลือกคอปก / เสื้อโปโลแต่ยังเป็น "ไม่มีปก" ฟอร์มเตือนให้เลือกชนิดปก', () => {
  for (const [product, key, value] of [['sport', 'cut', 'คอปก แขนสั้น'], ['jersey', 'neck', 'คอปก'], ['student', 'cut', 'เสื้อโปโล']]) {
    const { api, v } = filled(product)
    Object.assign(v, { [key]: value, collar: 'ไม่มีปก' })
    assert.ok(api.validate().some(m => m.id === 'fld_p_collar' && /ชนิดปก/.test(m.why)), product)
    v.collar = 'ปกสำเร็จ'
    assert.equal(api.validate().some(m => m.id === 'fld_p_collar'), false, product)
  }
})

test('ฟอร์มใบยืนยัน: ปกสำเร็จต้องระบุสีปก · ปกแบบอื่นไม่ถาม · สีปกพิมพ์ลง PDF ฉบับโรงงาน', () => {
  for (const product of ['tshirt', 'sport', 'jersey', 'running', 'worker', 'pe', 'student', 'mourning']) {
    const { api, v } = filled(product)
    const color = api.PRODUCTS[product].sections.flatMap(s => s.fields).find(f => f.id === 'collar_color')
    v.collar = 'ปกจีน'
    assert.equal(api.visible(color, v), false, product)
    assert.equal(api.validate().some(m => m.id === 'fld_p_collar_color'), false, product)
    v.collar = 'ปกสำเร็จ'
    assert.equal(api.visible(color, v), true, product)
    assert.ok(api.validate().some(m => m.id === 'fld_p_collar_color'), product)
    v.collar_color = 'ขาว ริ้วกรม'
    assert.equal(api.validate().some(m => m.id === 'fld_p_collar_color'), false, product)
  }
  const { api, els, v } = filled('tshirt')
  api.setViewOnly(true)
  Object.assign(v, { collar: 'ปกสำเร็จ', collar_color: 'ขาว ริ้วกรม' })
  api.renderDoc()
  assert.match(els.get('#doc').innerHTML, /ขาว ริ้วกรม/)
})

test('ฟอร์มใบยืนยัน: ใบโปโลเก่าที่เลือกปกริบทอ / ปกผ้าเดียวกับตัว เปิดแล้วเป็นปกสำเร็จ / ปกพิมพ์', () => {
  const { api } = boot()
  api.loadData({ h: { doc_no: 'SC-POLO', customer: 'x' }, product: 'polo', p: { polo: { collar: 'ปกริบทอ' }, sport: { collar: 'ปกผ้าเดียวกับตัว' } } }, 'x')
  assert.equal(api.state.p.polo.collar, 'ปกสำเร็จ')
  assert.equal(api.state.p.sport.collar, 'ปกพิมพ์')
})

test('ฟอร์มใบยืนยัน: ไม่ใช้หน่วย มม. · ใบเก่าที่เลือกความกว้างสาย / วัสดุเหรียญเป็น มม. เปิดแล้วเป็น ซม.', () => {
  const { api, els } = boot()
  api.loadData({ h: { doc_no: 'SC-MM', customer: 'x' }, product: 'lanyard', p: { lanyard: { width: '25 มม.' }, medal: { material: 'อะคริลิค หนา 5 มม. (พิมพ์สี)' } } }, 'x')
  assert.equal(api.state.p.lanyard.width, '2.5 ซม.')
  assert.equal(api.state.p.medal.material, 'อะคริลิค หนา 0.5 ซม. (พิมพ์สี)')
  api.renderDoc()
  assert.equal(els.get('#doc').innerHTML.includes('มม.'), false)
})

test('ฟอร์มใบยืนยัน: ทุกสินค้าไม่มีหน่วย มม. ในชื่อช่อง ตัวเลือก คำแนะนำ', () => {
  const { api } = boot()
  const texts = Object.values(api.PRODUCTS).flatMap(p => p.sections.flatMap(s => (s.fields || []).flatMap(f => [
    f.label, f.hint, f.ph, ...(f.options || []), ...(f.parts || []), ...(f.cols || []).flatMap(c => [c.label, ...(c.options || [])]),
  ]))).filter(t => typeof t === 'string')
  assert.deepEqual(texts.filter(t => /มม\.|มิลลิเมตร/.test(t)), [])
})

test('ฟอร์มใบยืนยัน: เปิดดูจากระบบ (ฝ่ายผลิต) แสดงใบล่าสุดแบบดูอย่างเดียว ไม่เขียนทับใบที่แอดมินกรอกค้างในเครื่อง', () => {
  const { api, store, els } = boot()
  const mine = { h: { doc_no: 'SC-DRAFT', customer: 'ใบที่แอดมินกรอกค้าง' }, product: 'tshirt', p: { tshirt: {} }, imgs: [] }
  store.set('phappim-confirm-v1', JSON.stringify(mine))
  store.set('pp142.confirmation.inbox', JSON.stringify({ view: true, h: { doc_no: 'SC-JOB', customer: 'ลูกค้างาน', rev: 2 }, product: 'polo', p: { polo: { collar: 'ปกสำเร็จ' } },
    revision: { rev: 2, at: '25/11/2569 14:32', by: 'แอดมิน 1', fields: ['ปก', 'จำนวน'] } }))
  api.takeInbox()
  assert.equal(api.state.h.doc_no, 'SC-JOB')
  assert.equal(api.state.p.polo.collar, 'ปกสำเร็จ')
  assert.deepEqual(JSON.parse(store.get('phappim-confirm-v1')), mine)
  api.rerender()
  assert.deepEqual(JSON.parse(store.get('phappim-confirm-v1')), mine)
  assert.equal(store.has('pp142.confirmation.inbox'), false)
  assert.match(els.get('#doc').innerHTML, /แก้ไขครั้งที่ 2/)
})

test('ฟอร์มใบยืนยัน: จำนวนชิ้นเป็นทศนิยม บันทึกเข้าระบบไม่ได้ · บอกให้แก้เป็นจำนวนเต็ม', () => {
  const { api, store, v } = filled()
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'a', q: { M: '2.5' } }]
  assert.ok(api.validate().some(m => m.hard && /จำนวนเต็ม/.test(m.why)))
  api.saveToSystem()
  assert.equal(store.has(OUTBOX), false)
  v.sizes = [{ label: 'a', q: { M: '3' } }]
  assert.equal(api.validate().some(m => /จำนวนเต็ม/.test(m.why ?? '')), false)
})

test('ฟอร์มใบยืนยัน: ยอดรวมเกิน 100,000 ถือว่าพิมพ์ผิด บันทึกไม่ได้ · 100,000 พอดีบันทึกได้', () => {
  const { api, store, v } = filled()
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'a', q: { M: '999999999' } }]
  assert.ok(api.validate().some(m => m.hard && /มากเกินไป/.test(m.why)))
  api.saveToSystem()
  assert.equal(store.has(OUTBOX), false)
  v.sizes = [{ label: 'a', q: { M: '60000', L: '40000' } }]
  assert.equal(api.validate().some(m => /มากเกินไป/.test(m.why ?? '')), false)
})

test('ฟอร์มใบยืนยัน: โหมดแก้ใบหลังรับงาน ช่องเลขที่ใบพิมพ์แก้ไม่ได้', () => {
  const { api } = boot()
  api.loadData({ h: { doc_no: 'SC-R2', customer: 'x' }, p: { tshirt: {} }, product: 'tshirt', from_job: true }, 'x')
  const field = api.HEADER.flatMap(sec => sec.fields).find(f => f.id === 'doc_no')
  assert.match(api.fieldHTML(field, 'h', api.state.h), /data-k="doc_no"[^>]*disabled/)
  const fresh = boot()
  assert.doesNotMatch(fresh.api.fieldHTML(field, 'h', { doc_no: 'SC-NEW' }), /disabled/)
})

test('ฟอร์มใบยืนยัน: ผ้าเพิ่มต้องกรอกจำนวน + หน่วย (หลา หรือ ชิ้น) · พิมพ์ลง PDF ทั้งฉบับโรงงานและฉบับลูกค้า', () => {
  const { api, els, v } = filled('tshirt')
  const table = api.PRODUCTS.tshirt.sections.flatMap(s => s.fields).find(f => f.id === 'fabric_rows')
  assert.deepEqual(table.cols.find(c => c.c === 'unit').options, ['หลา', 'ชิ้น'])
  const rowProblem = () => api.validate().some(m => m.id === 'fld_p_fabric_rows' && /ไม่ครบ/.test(m.why))
  v.fabric_rows = [{ part: 'แขน', color: 'แดง' }]
  assert.ok(rowProblem())
  v.fabric_rows[0].qty = '40'
  assert.ok(rowProblem())
  v.fabric_rows[0].unit = 'ชิ้น'
  assert.equal(rowProblem(), false)
  v.fabric_rows.push({ part: 'ปก', fabric: 'ผ้าริบ', color: 'ขาว', qty: '0', unit: 'หลา' })
  assert.ok(rowProblem())
  v.fabric_rows[1].qty = '12.5'
  assert.equal(rowProblem(), false)
  api.setViewOnly(true)
  api.renderDoc()
  const factory = els.get('#doc').innerHTML
  assert.match(factory, /40<\/td><td class="l">ชิ้น/)
  assert.match(factory, /12\.5<\/td><td class="l">หลา/)
  api.setViewOnly(false)
  api.renderDoc()
  assert.match(els.get('#doc').innerHTML, /12\.5<\/td><td class="l">หลา/)
})

test('ฟอร์มใบยืนยัน: ใบเย็บอย่างเดียว ของที่ลูกค้าส่งมาแยกจำนวนตามไซซ์ · รวมให้ · แก้ชื่อไซซ์ย้ายตาม · ส่งเข้าระบบเฉพาะไซซ์ที่มี', () => {
  const { api, els, v } = filled('svc_sew')
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  const table = () => api.PRODUCTS.svc_sew.sections.flatMap(s => s.fields).find(f => f.id === 'supplied')
  const sizes = api.sizeCols(v)
  assert.deepEqual(table().cols.map(c => c.label), ['ของที่ส่งมา', 'หน่วย', 'สี / สภาพ / หมายเหตุ', ...sizes, 'รวม'])
  const order = api.PRODUCTS.svc_sew.sections.map(s => s.title)
  assert.ok(order.indexOf('ไซซ์และจำนวน') < order.indexOf('ของที่ลูกค้าส่งมา'))
  v.supplied = [{ item: 'ชกแขน', 'sz:S': '20', 'sz:M': '40', unit: 'ชิ้น', note: 'สีกรม' }, { item: 'ด้าย', qty: '3', unit: 'ม้วน' }]
  api.rerender()
  assert.equal(v.supplied[0].qty, '60')
  assert.equal(v.supplied[1].qty, '3')
  assert.equal(api.validate().some(m => m.id === 'fld_p_supplied'), false)
  const sent = api.systemCopy().p.svc_sew.supplied
  assert.equal(sent[0]['sz:S'], '20')
  assert.equal(sent[0].qty, '60')
  v.supplied[0]['sz:ไม่มีไซซ์นี้'] = '9'
  assert.equal(Object.keys(api.systemCopy().p.svc_sew.supplied[0]).includes('sz:ไม่มีไซซ์นี้'), false)
  v.size_sets = ['ไซซ์ผู้ใหญ่', 'อื่นๆ']
  api.keepSizeQty(v, () => { v.size_names = { S: '1-2' } })
  assert.equal(v.supplied[0]['sz:1-2'], '20')
  assert.equal(v.supplied[0]['sz:S'], undefined)
  api.keepSizeQty(v, () => { v.size_names = {} })
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  api.setViewOnly(true)
  api.renderDoc()
  const doc = els.get('#doc').innerHTML
  assert.match(doc, /<th>หน่วย<\/th><th>สี \/ สภาพ \/ หมายเหตุ<\/th><th>S<\/th><th>M<\/th><th>รวม<\/th>/)
  assert.match(doc, /ชกแขน<\/td><td class="l">ชิ้น<\/td><td class="l">สีกรม<\/td><td class="">20<\/td><td class="">40<\/td><td class="">60<\/td>/)
})

test('ฟอร์มใบยืนยัน: แก้ชื่อไซซ์ที่หัวตารางได้ทุกชุดไซซ์ (ไม่ต้องเลือก "อื่นๆ") · จำนวนย้ายตาม · ส่งเข้าระบบด้วยชื่อใหม่', () => {
  const { api, v } = filled('tshirt')
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'ขาว', q: { S: '10', M: '20' } }]
  const table = api.allFields().find(f => f.id === 'sizes')
  assert.match(api.fieldHTML(table, 'p', v), /data-rename="S"/)
  api.keepSizeQty(v, () => { v.size_names = { S: 'F' } })
  assert.deepEqual(api.sizeCols(v).slice(0, 3), ['SS', 'F', 'M'])
  assert.deepEqual(v.sizes[0].q, { F: '10', M: '20' })
  const sent = api.systemCopy().p.tshirt
  assert.deepEqual(sent.size_names, { S: 'F' })
  assert.deepEqual(sent.sizes[0].q, { F: '10', M: '20' })
  assert.equal(api.totalQty(), 30)
})

function withFactoryDetails(v) {
  v.fabric = 'TC (คอตตอน/โพลี)'
  v.fabric_color = 'กรมท่าเข้ม'
  v.fabric_rows = [{ part: 'ปก', fabric: 'ผ้าริบ', color: 'ขาวนวล', print: 'พิมพ์สีพิเศษ 2 สี' }, { part: 'ตัวหลังพิเศษ', color: 'แดงสด' }]
  v.collar = 'ปกจีน'
  v.print_method = ['ซิลค์สกรีน', 'งานปัก']
  v.placements = { 'หน้าอกซ้าย': { on: true, tech: 'งานปัก', size: '8x8' } }
  v.ink_colors = 'หมึกขาวล้วน'
  v.emb_colors = 'ด้ายปักทองเบอร์ 9'
  v.sew_mode = 'ลูกค้ากำหนดวิธีเย็บเอง'
  v.thread = 'อื่นๆ'
  v.thread__other = 'ด้ายเย็บสีเทา'
  v.spare = '7'
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'แบบหลัก', q: { M: '20' } }]
  v.bag = 'แพ็ค 1/1 (ถุงแยกตัว)'
  v.notes = 'หมายเหตุภายในโรงงาน'
}
const FACTORY_HEAD = { contact: 'คุณติดต่อภายใน', phone: '081-555-0000', admin: 'แอดมินน้ำ', admin_phone: '090-111-2222', delivery: 'รถบริษัทไปส่ง' }
const FACTORY_TEXT = ['ซิลค์สกรีน', 'งานปัก', 'หมึกขาวล้วน', 'ด้ายปักทองเบอร์ 9', 'ด้ายเย็บสีเทา', 'เผื่อเสีย', 'ปกจีน', 'หน้าอกซ้าย', '8x8',
  'พิมพ์สีพิเศษ 2 สี', 'กรมท่าเข้ม', 'ขาวนวล', 'แดงสด', 'ตัวหลังพิเศษ', 'หมายเหตุภายในโรงงาน', 'คุณติดต่อภายใน', '081-555-0000']
const CUSTOMER_TEXT = ['SC-T1', 'เสื้อยืด', 'วันที่สั่งงาน', '24/11/2569', 'ผู้ประสานงาน', 'แอดมินน้ำ · 090-111-2222', 'การจัดส่ง', 'รถบริษัทไปส่ง',
  'TC (คอตตอน/โพลี)', 'ผ้าริบ', 'แบบหลัก', 'แพ็ค 1/1 (ถุงแยกตัว)', 'ผู้อนุมัติ']

test('ฟอร์มใบยืนยัน: ใบที่ส่งลูกค้าแสดงเฉพาะเลขที่ใบ ประเภทสินค้า วันที่สั่งงาน ผู้ประสานงาน การจัดส่ง วัสดุ ไซซ์ จำนวน แพ็คกิ้ง + ช่องเซ็น · ระบบยังได้รับครบ', () => {
  const { api, store, els, s, v } = filled()
  Object.assign(s.h, FACTORY_HEAD)
  withFactoryDetails(v)
  api.renderDoc()
  const doc = els.get('#doc').innerHTML
  for (const t of FACTORY_TEXT) assert.equal(doc.includes(t), false, t)
  for (const t of CUSTOMER_TEXT) assert.ok(doc.includes(t), t)
  assert.equal(doc.includes('ฉบับโรงงาน'), false)
  assert.match(doc, /จำนวนรวม <b>20 ตัว<\/b>/)
  api.saveToSystem()
  const p = sent(store).p.tshirt
  assert.equal(p.spare, '7')
  assert.deepEqual(p.print_method, ['ซิลค์สกรีน', 'งานปัก'])
  assert.equal(p.ink_colors, 'หมึกขาวล้วน')
  assert.equal(p.thread__other, 'ด้ายเย็บสีเทา')
  assert.equal(p.collar, 'ปกจีน')
  assert.equal(p.placements['หน้าอกซ้าย'].tech, 'งานปัก')
  assert.equal(p.fabric_rows[0].print, 'พิมพ์สีพิเศษ 2 สี')
})

test('ฟอร์มใบยืนยัน: จุดกำกับบนม็อคอัพในใบลูกค้าอ้างได้เฉพาะช่องที่ลูกค้าเห็น · ในฟอร์มแอดมินยังเห็นทุกช่อง', () => {
  const { api, s, v } = filled()
  withFactoryDetails(v)
  s.imgs = [{ src: 'data:image/png;base64,AA==', w: 4, h: 3 }]
  s.callouts = [
    { ref: 'field:print_method', title: 'โลโก้', body: '', x: 0.5, y: 0.5, bx: 0.8, by: 0.2 },
    { ref: 'placement:หน้าอกซ้าย', title: 'อก', body: '', x: 0.3, y: 0.3, bx: 0.1, by: 0.1 },
    { ref: 'field:thread', title: 'ตะเข็บ', body: '', x: 0.2, y: 0.8, bx: 0.1, by: 0.9 },
    { ref: 'field:fabric', title: 'ตัวเสื้อ', body: 'ลายตามภาพ', x: 0.5, y: 0.7, bx: 0.9, by: 0.9 },
  ]
  const doc = api.coDocHTML()
  for (const t of FACTORY_TEXT) assert.equal(doc.includes(t), false, t)
  assert.match(doc, /ชนิดผ้า: TC \(คอตตอน\/โพลี\) · ลายตามภาพ/)
  const formRefs = api.coRefs()
  assert.match(formRefs.find(r => r.ref === 'field:print_method').val, /ซิลค์สกรีน/)
  assert.match(formRefs.find(r => r.ref === 'placement:หน้าอกซ้าย').val, /งานปัก/)
})

test('ฟอร์มใบยืนยัน: ฝ่ายผลิตเปิดดูจากระบบ เห็นทุกช่องครบ (เผื่อเสีย เทคนิค แบบ ตำแหน่ง) และหัวใบบอกว่าเป็นฉบับโรงงาน', () => {
  const { api, store, els } = boot()
  const p = {}
  withFactoryDetails(p)
  store.set('pp142.confirmation.inbox', JSON.stringify({ view: true, h: { doc_no: 'SC-FAC', customer: 'ลูกค้า', ...FACTORY_HEAD }, product: 'tshirt', p: { tshirt: p } }))
  api.takeInbox()
  const doc = els.get('#doc').innerHTML
  for (const t of FACTORY_TEXT) assert.ok(doc.includes(t), t)
  assert.match(doc, /ฉบับโรงงาน/)
  assert.match(doc, /เผื่อเสีย 7 ตัว/)
})

test('ฟอร์มใบยืนยัน: ผ้าเช็ดหน้าเลือกพับริมเย็บได้ (มีรูป) และต้องใส่ขนาดพับ · ม้วนริมที่มีขนาดในชื่อไม่ถาม', () => {
  const { api, els, v } = filled('scarf')
  Object.assign(v, { item: 'ผ้าเช็ดหน้า', sew_mode: 'ลูกค้ากำหนดวิธีเย็บเอง', sew_style: 'พับริมเย็บ' })
  const opts = api.PRODUCTS.scarf.sections.flatMap(s => s.fields).find(f => f.id === 'sew_style').options
  assert.ok(opts.includes('พับริมเย็บ') && opts.includes('ม้วนริม 0.6 ซม.'))
  const ids = () => api.validate().map(m => m.id)
  assert.ok(ids().includes('fld_p_edge_size'))
  v.edge_size = '0.6 ซม.'
  assert.equal(ids().includes('fld_p_edge_size'), false)
  api.renderDoc()
  const doc = els.get('#doc').innerHTML
  assert.match(doc, /รูปแบบการเย็บ<\/span><b>พับริมเย็บ<img class="optimg"/)
  assert.match(doc, /ขนาดพับ \/ ม้วนริม<\/span><b>0\.6 ซม\./)
  Object.assign(v, { sew_style: 'ม้วนริม 0.3 ซม.' })
  delete v.edge_size
  assert.equal(ids().includes('fld_p_edge_size'), false)
})

test('ฟอร์มใบยืนยัน: ใบลูกค้าเห็นรูปแบบการเย็บขอบ (ตัวเลือก รูป ขนาด) ของผ้าผืน · ไม่เห็นสีด้าย / วิธีเย็บ', () => {
  const { api, els, v } = filled('scarf')
  Object.assign(v, { item: 'ผ้าเช็ดหน้า', sew_mode: 'ลูกค้ากำหนดวิธีเย็บเอง', sew_style: 'ม้วนริม 0.6 ซม.', thread: 'ขาว' })
  api.renderDoc()
  let doc = els.get('#doc').innerHTML
  assert.match(doc, /รูปแบบการเย็บ<\/span><b>ม้วนริม 0\.6 ซม\.<img class="optimg"/)
  assert.equal(doc.includes('สีด้าย'), false)
  assert.equal(doc.includes('ลูกค้ากำหนดวิธีเย็บเอง'), false)
  Object.assign(v, { item: 'ผ้าพันคอ', edge: 'พับริมเย็บ', edge_size: '1 ซม.' })
  api.renderDoc()
  doc = els.get('#doc').innerHTML
  assert.match(doc, /การเก็บขอบ<\/span><b>พับริมเย็บ<img class="optimg"/)
  assert.match(doc, /ขนาดพับ \/ ม้วนริม<\/span><b>1 ซม\./)
})

test('ฟอร์มใบยืนยัน: ใบลูกค้าไม่มีหัวข้อการเย็บ งานพิมพ์ / ตกแต่ง ไฟล์งาน · ภาพม็อคอัพยังพิมพ์ · ฉบับโรงงานมีครบ', () => {
  const { api, els, s, v } = filled()
  withFactoryDetails(v)
  v.art_file = 'logo-final.ai'
  s.imgs = [{ name: 'ด้านหน้า', src: 'data:image/png;base64,AA==', w: 4, h: 3 }]
  const headings = () => [...els.get('#doc').innerHTML.matchAll(/<h3>\d+\. ([^<]*)<\/h3>/g)].map(m => m[1])
  api.renderDoc()
  assert.deepEqual(headings(), ['ผ้า', 'ไซซ์และจำนวน', 'แพ็คกิ้ง'])
  assert.equal(els.get('#doc').innerHTML.includes('logo-final.ai'), false)
  assert.match(els.get('#doc').innerHTML, /รูป 1 · ด้านหน้า/)
  api.setViewOnly(true)
  api.renderDoc()
  for (const h of ['การเย็บ', 'งานพิมพ์ / ตกแต่ง', 'ไฟล์งานและหมายเหตุ']) assert.ok(headings().includes(h), h)
  assert.match(els.get('#doc').innerHTML, /logo-final\.ai/)
})

const signBoxes = html => [...html.matchAll(/<div class="t">([^<]*)<\/div>/g)].map(m => m[1])

test('ฟอร์มใบยืนยัน: ฉบับลูกค้ามีช่องเซ็น ลูกค้า + ผู้อนุมัติ', () => {
  const { api, els } = filled()
  api.renderDoc()
  assert.deepEqual(signBoxes(els.get('#doc').innerHTML), ['ลูกค้า', 'ผู้อนุมัติ'])
})

test('ฟอร์มใบยืนยัน: ฉบับโรงงานแสดงลายเซ็นลูกค้าที่แอดมินตัดไว้ · ใบแก้ครั้งใหม่บอกว่ายังไม่ได้เซ็น · ฉบับลูกค้าไม่แสดง', () => {
  const open = sig => {
    const b = boot()
    b.store.set('pp142.confirmation.inbox', JSON.stringify({ view: true, h: { doc_no: 'SC-SIG', customer: 'ลูกค้า' }, product: 'tshirt', p: { tshirt: {} }, customer_sig: sig }))
    b.api.takeInbox()
    return b
  }
  const ok = open({ src: 'https://files.test/f/mockups/SC-SIG/sigab.png?sig=1', signed_on: '2026-11-26', rev: 1, current_rev: 1 })
  const doc = ok.els.get('#doc').innerHTML
  assert.match(doc, /<div class="signed"><div class="t">ลูกค้า<\/div><img src="https:\/\/files\.test\/f\/mockups\/SC-SIG\/sigab\.png\?sig=1"/)
  assert.match(doc, /วันที่ 26\/11\/2569/)
  assert.equal((doc.match(/class="signed"/g) || []).length, 1)

  const stale = open({ src: 'https://files.test/x.png', signed_on: '2026-11-20', rev: 0, current_rev: 2 }).els.get('#doc').innerHTML
  assert.equal(stale.includes('class="signed"'), false)
  assert.match(stale, /ลูกค้าเซ็นใบครั้งที่ 0 · ใบนี้ \(ครั้งที่ 2\) ยังไม่ได้เซ็น/)

  const bad = open({ src: 'javascript:alert(1)', signed_on: '2026-11-26', rev: 0, current_rev: 0 }).els.get('#doc').innerHTML
  assert.equal(bad.includes('class="signed"'), false)

  const { api, els } = filled()
  api.renderDoc()
  assert.equal(els.get('#doc').innerHTML.includes('class="signed"'), false)
})

test('ฟอร์มใบยืนยัน: ฉบับโรงงานมีช่องเซ็น ลูกค้า + ผู้อนุมัติ + ผู้ควบคุมการผลิต', () => {
  const { api, store, els } = boot()
  store.set('pp142.confirmation.inbox', JSON.stringify({ view: true, h: { doc_no: 'SC-SIGN', customer: 'ลูกค้า' }, product: 'tshirt', p: { tshirt: {} } }))
  api.takeInbox()
  const doc = els.get('#doc').innerHTML
  assert.deepEqual(signBoxes(doc), ['ลูกค้า', 'ผู้อนุมัติ', 'ผู้ควบคุมการผลิต'])
  assert.match(doc, /class="sign s3"/)
})

test('ฟอร์มใบยืนยัน: ภาพม็อคอัพขึ้นหน้าใหม่ต่อจากรายละเอียด อยู่เหนือข้อตกลงและช่องเซ็น · ไม่มีภาพ = ไม่มีหน้าม็อคอัพ', () => {
  const { api, els, s, v } = filled()
  withFactoryDetails(v)
  api.renderDoc()
  assert.equal(els.get('#doc').innerHTML.includes('d-mockpage'), false)
  assert.match(els.get('#doc').innerHTML, /class="d-mock"/)
  s.imgs = [{ name: 'ด้านหน้า', src: 'data:image/png;base64,AA==', w: 4, h: 3 }]
  api.renderDoc()
  const doc = els.get('#doc').innerHTML
  const page = doc.indexOf('class="d-mockpage"'), accept = doc.indexOf('class="d-accept"')
  assert.ok(page > doc.indexOf('แพ็คกิ้ง') && accept > page)
  assert.ok(doc.indexOf('class="sign') > accept)
  assert.ok(doc.indexOf('รูป 1 · ด้านหน้า') > page)
  assert.match(doc.slice(page), /d-imgs one/)
  assert.equal((doc.match(/class="d-mock"/g) || []).length, 1)
  assert.ok(doc.indexOf('class="d-mock"') > page && doc.indexOf('class="d-mock"') < accept)
})

test('ฟอร์มใบยืนยัน: กล่อง "ส่งใบเข้าระบบแล้ว" ไม่พิมพ์ลง PDF', () => {
  const html = readFileSync(new URL('../../production-confirmation.html', import.meta.url), 'utf8')
  const print = /@media print\{([\s\S]*?)\n\}/.exec(html)[1]
  assert.match(print, /#afterSave[^{]*\{display:none!important\}/)
})

test('ฟอร์มใบยืนยัน: บันทึกเข้าระบบซ้ำ ไม่พารูป base64 ไปกับลายเซ็นฟอร์ม (sent_sig) ทั้งในใบที่ส่งและในเครื่อง', () => {
  const { api, store, s, v } = filled()
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'ขาว', q: { M: '10' } }]
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(50000)
  s.imgs = [{ name: 'a.jpg', src: big, w: 10, h: 10 }]
  api.shrunk.set(big, 'data:image/jpeg;base64,small')
  api.saveToSystem()
  v.sizes[0].q.M = '12'
  api.saveToSystem()
  const out = sent(store)
  assert.equal('sent_sig' in out, false)
  assert.equal('pickOpen' in out, false)
  assert.ok(api.state.sent_sig.length < 100)
})

test('ฟอร์มใบยืนยัน: "แก้ไขครั้งที่" เป็นทศนิยมหรือติดลบ ต้องแก้ก่อน · จำนวนเต็มผ่าน', () => {
  const { api, s } = filled()
  for (const rev of ['1.5', '-1', 'abc']) {
    s.h.rev = rev
    assert.ok(api.validate().some(m => m.hard && m.id === 'fld_h_rev'), rev)
  }
  for (const rev of ['', '0', '2']) {
    s.h.rev = rev
    assert.equal(api.validate().some(m => m.id === 'fld_h_rev'), false, rev)
  }
})

test('ฟอร์มใบยืนยัน: ผลิตเผื่อเสียเกิน 100,000 ถือว่าพิมพ์ผิด บันทึกไม่ได้', () => {
  const { api, store, v } = filled()
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'a', q: { M: '10' } }]
  v.spare = '3000000000'
  assert.ok(api.validate().some(m => m.hard && m.id === 'fld_p_spare' && /มากเกินไป/.test(m.why)))
  api.saveToSystem()
  assert.equal(store.has(OUTBOX), false)
  v.spare = '5'
  assert.equal(api.validate().some(m => m.id === 'fld_p_spare'), false)
})

test('ฟอร์มใบยืนยัน: ยังไม่มีจำนวนเลย บันทึกเข้าระบบไม่ได้ (ระบบรับงาน 0 ชิ้นไม่ได้)', () => {
  const { api, store, g, v } = filled()
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  v.sizes = [{ label: 'ขาว', q: {} }]
  api.saveToSystem()
  assert.equal(store.has(OUTBOX), false)
  assert.match(g.alerts.at(-1), /ยังไม่มีจำนวน/)
})

test('ฟอร์มใบยืนยัน: ไฟล์ที่บันทึก (.json) มีฉบับคัดสำหรับหน้ารับงาน (sys) เหมือนที่ส่งเข้าระบบ', () => {
  const { api, v } = filled()
  v.size_sets = ['ไซซ์ผู้ใหญ่', 'ไซซ์เด็ก']
  v.sizes = [{ label: 'ขาว', q: { M: '10', 'เด็ก S': '5' } }]
  v.size_sets = ['ไซซ์ผู้ใหญ่']
  const sys = api.systemCopy()
  assert.deepEqual(Object.keys(sys.p), ['tshirt'])
  assert.deepEqual(sys.p.tshirt.sizes[0].q, { M: '10' })
  const html = readFileSync(new URL('../../production-confirmation.html', import.meta.url), 'utf8')
  assert.match(html, /act==='savefile'[^\n]*sys:systemCopy\(\)/)
})

test('ฟอร์มใบยืนยัน: ชุดไซซ์ "อื่นๆ" พิมพ์ไซซ์เองได้ · เป็นคอลัมน์ในตารางจำนวน · นับยอด · ส่งเข้าระบบครบ', () => {
  for (const product of ['tshirt', 'svc_sew']) {
    const { api, v } = filled(product)
    v.size_sets = ['ไซซ์เด็ก', 'อื่นๆ']
    v.size_sets__other = 'เด็ก 2XL, 10 ปี,\n12 ปี , เด็ก M'
    v.sizes = [{ label: 'สีขาว', q: { 'เด็ก M': 5, 'เด็ก 2XL': 3, '10 ปี': 2, '12 ปี': 1, 'ไม่ได้เลือก': 9 } }]
    assert.equal(api.totalQty(), 11, `${product}: นับเฉพาะคอลัมน์ที่มี (ไม่นับไซซ์ที่ไม่ได้เลือก · เด็ก M ซ้ำไม่นับสองครั้ง)`)
    const sys = api.systemCopy().p[product]
    assert.equal(sys.size_sets__other, 'เด็ก 2XL, 10 ปี,\n12 ปี , เด็ก M')
    assert.deepEqual(Object.keys(sys.sizes[0].q).sort(), ['10 ปี', '12 ปี', 'เด็ก 2XL', 'เด็ก M'].sort())
    v.size_sets__other = ''
    assert.ok(api.validate().some(m => m.id === 'fld_p_size_sets'), `${product}: ติ๊กอื่นๆ แต่ไม่พิมพ์ไซซ์ = ฟอร์มเตือน`)
  }
})
