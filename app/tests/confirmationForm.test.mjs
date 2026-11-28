import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Script } from 'node:vm'

const html = readFileSync(new URL('../../production-confirmation.html', import.meta.url), 'utf8')
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])

test('ฟอร์มใบยืนยัน: สคริปต์ทุกก้อนไม่มี syntax error (พังแล้วฟอร์มทั้งหน้าใช้ไม่ได้)', () => {
  assert.ok(scripts.length > 0)
  for (const js of scripts) assert.doesNotThrow(() => new Script(js))
})

test('ฟอร์มใบยืนยัน: เปิดใบจากระบบ (takeInbox) เรียกหลังประกาศค่าคงที่ทุกตัว ไม่งั้นสคริปต์หยุดและส่งออก PDF ไม่ได้', () => {
  const js = scripts.find(s => s.includes('function takeInbox'))
  assert.ok(js)
  const call = js.lastIndexOf('\ntakeInbox();')
  assert.ok(call > 0, 'ต้องเรียก takeInbox() ที่ระดับบนสุด')
  assert.doesNotMatch(js.slice(call), /^(const|let|class)\s/m)
  assert.doesNotMatch(js.slice(0, call), /\(function takeInbox/)
})

test('ฟอร์มใบยืนยัน: เปิดแบบใบใหม่ (?new) เรียกก่อนเปิดใบจากระบบ และหลังประกาศค่าคงที่ทุกตัว', () => {
  const js = scripts.find(s => s.includes('function takeNew'))
  assert.ok(js)
  const call = js.lastIndexOf('\ntakeNew();')
  assert.ok(call > 0 && call < js.lastIndexOf('\ntakeInbox();'))
  assert.doesNotMatch(js.slice(call), /^(const|let|class)\s/m)
})

function newForm({ url, saved, prev }) {
  const js = scripts.join('\n')
  const start = js.indexOf('const formSig =')
  const end = js.indexOf('// หน้าระบบกด "เปิดในฟอร์ม"')
  assert.ok(start > 0 && end > start)
  const store = new Map(Object.entries({ pc142: saved && JSON.stringify(saved), 'pc142.prev': prev && JSON.stringify(prev) }).filter(([, v]) => v))
  const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
  const afterSave = { innerHTML: '' }
  const ctx = { state: saved ?? { h: {}, p: {}, imgs: [] }, replaced: null, toasts: [], rendered: 0, asked: [], startedOver: 0 }
  const fresh = () => ({ h: { issue_date: '2026-11-25' }, product: 'tshirt', pickOpen: true, p: {}, imgs: [], callouts: [] })
  const load = key => { const s = JSON.parse(localStorage.getItem(key)); return s && s.h ? s : null }
  const api = new Function('ctx', 'LS', 'localStorage', 'location', 'history', '$', 'fresh', 'load', 'esc', 'toast', 'rerender', 'scrollTo', 'confirm', 'startOver',
    'let state=ctx.state, coTab=0, missing=[];\n' + js.slice(start, end) + '\nreturn { takeNew, restorePrev, get state(){ return state } }')(
    ctx, 'pc142', localStorage, new URL(url), { replaceState: (a, b, u) => { ctx.replaced = u } }, () => afterSave, fresh, load,
    s => String(s), m => ctx.toasts.push(m), () => { ctx.rendered++ }, () => {}, m => { ctx.asked.push(m); return true }, () => { ctx.startedOver++ })
  return { api, store, afterSave, ctx }
}

test('ฟอร์มใบยืนยัน: กด "เปิดฟอร์มใบยืนยัน (ใบใหม่)" ได้ฟอร์มว่าง · ใบที่กรอกค้างเก็บแยกไว้เปิดคืนได้', () => {
  const old = { h: { doc_no: 'SC690101-0001', customer: 'ลูกค้าเก่า' }, product: 'tshirt', p: { qty: 30 }, imgs: [] }
  const { api, store, afterSave, ctx } = newForm({ url: 'https://pp142.test/confirmation?new=1', saved: old })
  api.takeNew()
  assert.equal(ctx.replaced, '/confirmation')
  assert.equal(api.state.h.doc_no, undefined)
  assert.deepEqual(JSON.parse(store.get('pc142.prev')), old)
  assert.match(afterSave.innerHTML, /SC690101-0001/)
  assert.match(afterSave.innerHTML, /data-act="restoreprev"/)
  api.state.p = { tshirt: { sew_mode: 'เย็บตามมาตรฐานโรงงาน' } }
  api.restorePrev()
  assert.deepEqual(ctx.asked, [], 'ฟอร์มใหม่ที่ยังไม่ได้กรอก ไม่ต้องถามก่อนเปิดใบเดิมคืน')
  assert.equal(api.state.h.doc_no, 'SC690101-0001')
  assert.equal(store.has('pc142.prev'), false)
  assert.equal(afterSave.innerHTML, '')
})

test('ฟอร์มใบยืนยัน: เปิดแบบใบใหม่ตอนฟอร์มว่างอยู่แล้ว ไม่สร้างใบค้าง · เปิดปกติ (ไม่มี ?new) ได้ใบเดิม', () => {
  const blank = newForm({ url: 'https://pp142.test/confirmation?new=1', saved: { h: { issue_date: '2026-11-25' }, product: 'tshirt', p: { tshirt: { sew_mode: 'เย็บตามมาตรฐานโรงงาน' } }, imgs: [] } })
  blank.api.takeNew()
  assert.equal(blank.store.has('pc142.prev'), false)
  assert.equal(blank.afterSave.innerHTML, '')
  const old = { h: { doc_no: 'SC1' }, product: 'tshirt', p: {}, imgs: [] }
  const plain = newForm({ url: 'https://pp142.test/confirmation', saved: old })
  plain.api.takeNew()
  assert.equal(plain.api.state.h.doc_no, 'SC1')
  assert.equal(plain.ctx.replaced, null)
})

test('ฟอร์มใบยืนยัน: PDF ที่ลูกค้าเซ็นไม่พิมพ์กำหนดส่ง (วันส่งใช้ภายใน)', () => {
  const js = scripts.join('\n')
  assert.doesNotMatch(js, /thDate\(h\.due_date\)/)
  assert.match(js, /data-act="next"/)
})

test('ฟอร์มใบยืนยัน: ช่องขนาดเลือกหน่วย ซม. / นิ้ว ได้ · ค่าเดิมที่ไม่ได้เลือกใช้หน่วยตั้งต้นของช่อง', () => {
  const js = scripts.join('\n')
  const start = js.indexOf('const LEN_UNITS=')
  const end = js.indexOf('\n', js.indexOf('const colLabel='))
  assert.ok(start > 0 && end > start)
  const { unitOf, fieldLabel, colLabel, lenDefault } = new Function(js.slice(start, end) + '\nreturn { unitOf, fieldLabel, colLabel, lenDefault }')()
  const width = { id: 'fabric_width', type: 'number', unit: 'นิ้ว' }
  assert.equal(unitOf(width, {}), 'นิ้ว')
  assert.equal(unitOf(width, { fabric_width__unit: 'ซม.' }), 'ซม.')
  assert.equal(unitOf(width, { fabric_width__unit: 'ฟุต' }), 'นิ้ว')
  assert.equal(lenDefault({ id: 'per_box', type: 'number', unit: 'ชิ้น' }), null)
  assert.equal(unitOf({ id: 'per_box', type: 'number', unit: 'ชิ้น' }, { per_box__unit: 'นิ้ว' }), 'ชิ้น')
  const measure = { id: 'measure_rows', type: 'itemTable', label: 'ขนาดสำเร็จแต่ละไซซ์', lenUnit: 'นิ้ว', cols: [{ c: 'chest', label: 'รอบอก' }] }
  assert.equal(fieldLabel(measure, {}), 'ขนาดสำเร็จแต่ละไซซ์ (นิ้ว)')
  assert.equal(fieldLabel(measure, { measure_rows__unit: 'ซม.' }), 'ขนาดสำเร็จแต่ละไซซ์ (ซม.)')
  const items = { id: 'items', type: 'itemTable', label: 'รายการ', lenUnit: 'ซม.', cols: [{ c: 'w', label: 'กว้าง', len: true }, { c: 'qty', label: 'จำนวน (ผืน)' }] }
  assert.equal(fieldLabel(items, {}), 'รายการ')
  assert.equal(colLabel(items.cols[0], items, { items__unit: 'นิ้ว' }), 'กว้าง (นิ้ว)')
  assert.equal(colLabel(items.cols[1], items, { items__unit: 'นิ้ว' }), 'จำนวน (ผืน)')
})

test('ฟอร์มใบยืนยัน: หัวตาราง / ตารางพิมพ์ไม่ล็อกหน่วย ซม. ตายตัว', () => {
  const js = scripts.join('\n')
  assert.doesNotMatch(js, /label:'[^']*\((ซม|นิ้ว)\.?\)'/)
  assert.doesNotMatch(js, /<th>ขนาด \(ซม\.\)<\/th>/)
})

test('ฟอร์มใบยืนยัน: ทุกสินค้าใส่ได้หลายแบบใน 1 ใบ (ตารางแถวละแบบที่มีจำนวน) และเลือกรูปของแต่ละแบบได้', () => {
  const js = scripts.join('\n')
  const start = js.indexOf('const MUST_FILL=')
  const end = js.indexOf('// แอดมินกับลูกค้ามักไม่รู้วิธีเย็บ')
  assert.ok(start > 0 && end > start)
  const { PRODUCTS } = new Function(js.slice(start, end) + '\nreturn { PRODUCTS }')()
  const lacking = []
  for (const [key, p] of Object.entries(PRODUCTS)) {
    const fields = p.sections.flatMap(s => s.fields)
    const table = fields.find(f => f.type === 'sizeTable' || (f.type === 'itemTable' && f.cols.some(c => c.sum)))
    if (!table || fields.some(f => f.id === 'qty')) { lacking.push(key); continue }
    if (table.type === 'itemTable' && (table.id !== 'items' || !table.cols.some(c => c.t === 'img'))) lacking.push(key)
  }
  assert.deepEqual(lacking, [])
})

test('ฟอร์มใบยืนยัน: ทำสินค้าถัดไปเลื่อนเลขท้ายอัตโนมัติ (เติม -0002 เมื่อยังไม่มีเลขต่อท้าย)', () => {
  const js = scripts.join('\n')
  const line = js.match(/const nextDocNo = .+;/)?.[0]
  assert.ok(line)
  const { nextDocNo } = new Function(line + '\nreturn { nextDocNo }')()
  assert.equal(nextDocNo('SC690871'), 'SC690871-0002')
  assert.equal(nextDocNo('SC690871-0001'), 'SC690871-0002')
  assert.equal(nextDocNo('SC690871-0009'), 'SC690871-0010')
  assert.equal(nextDocNo(''), '')
})

test('ฟอร์มใบยืนยัน: ตั้งรูปอื่นเป็นรูป 1 แล้วเลื่อนเลขรูปในแถวและจุดกำกับตามไม่ให้ชี้ผิดแบบ', () => {
  const js = scripts.join('\n')
  const start = js.indexOf('function moveImgToFirst(')
  const end = js.indexOf('\nconst sampleLocked=')
  assert.ok(start > 0 && end > start)
  const fnSrc = js.slice(start, end)
  const state = {
    imgs: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
    callouts: [{ img: 0, title: 'หน้า' }, { img: 2, title: 'แขน' }],
    co_size: { w: 100, h: 100 },
    co_sizes: [{ w: 100, h: 100 }, { w: 200, h: 200 }, { w: 300, h: 150 }],
    p: { bag: { items: [{ img: '1' }, { img: '2' }, { img: '3' }, { img: '4' }] } },
  }
  const { moveImgToFirst } = new Function(
    'state', 'coList', 'scope', 'allFields', 'rerender',
    fnSrc + '\nreturn { moveImgToFirst }',
  )(
    state,
    () => state.callouts,
    () => state.p.bag,
    () => [{ id: 'items', type: 'itemTable' }],
    () => {},
  )
  moveImgToFirst(2)
  assert.deepEqual(state.imgs.map(m => m.name), ['C', 'A', 'B', 'D'])
  assert.deepEqual(state.p.bag.items.map(r => r.img), ['2', '3', '1', '4'])
  assert.deepEqual(state.callouts.map(c => c.img), [1, 0])
  assert.deepEqual(state.co_sizes.map(s => s.w), [300, 100, 200])
})

test('ฟอร์มใบยืนยัน: ชี้จุดกำกับได้ทุกรูปม็อคอัพ และพิมพ์แสดงทุกรูปที่มีจุดในตัวอย่าง/PDF', () => {
  const js = scripts.join('\n')
  const start = js.indexOf('const CO_MX=')
  const end = js.indexOf('\nlet coDrag=null;')
  assert.ok(start > 0 && end > start)
  const fnSrc = js.slice(start, end)
  const state = {
    imgs: [
      { name: 'ด้านหน้า', src: 'data:image/png;base64,a', w: 800, h: 600 },
      { name: 'ด้านหลัง', src: 'data:image/png;base64,b', w: 600, h: 800 },
    ],
    callouts: [
      { img: 0, x: 0.2, y: 0.3, bx: -0.1, by: 0.3, title: 'อกซ้าย', ref: '', body: '' },
      { img: 1, x: 0.5, y: 0.4, bx: 1.1, by: 0.4, title: 'กลางหลัง', ref: '', body: 'พิมพ์ใหญ่' },
    ],
    co_size: { w: 800, h: 600 },
    co_sizes: [{ w: 800, h: 600 }, { w: 600, h: 800 }],
    p: { tshirt: {} },
  }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const imgName = n => { const m = state.imgs[n - 1]; return m ? `รูป ${n}${m.name ? ' · ' + m.name : ''}` : '' }
  const { coEditorHTML, coDocHTML } = new Function(
    'state', 'coTab', 'scope', 'unitOf', 'OTHER', 'isNone', 'form', 'esc', 'imgName', 'MOCKUP_NOTE', 'allFields', 'visible', 'allSecs', 'customerSees', 'customerCopy',
    fnSrc + '\nreturn { coEditorHTML, coDocHTML }',
  )(
    state,
    1,
    () => state.p.tshirt,
    () => 'ซม.',
    'อื่นๆ',
    x => !x,
    { querySelector: () => null, querySelectorAll: () => [] },
    esc,
    imgName,
    'หมายเหตุทดสอบ',
    () => [],
    () => true,
    () => [],
    () => true,
    () => true,
  )
  assert.match(coEditorHTML(), /class="co-tabs"/)
  assert.match(coEditorHTML(), /รูป 1 · ด้านหน้า \(1\)/)
  assert.match(coEditorHTML(), /รูป 2 · ด้านหลัง \(1\)/)
  assert.match(coEditorHTML(), /data-co-img="1"/)
  assert.match(coEditorHTML(), /src="data:image\/png;base64,b"/)
  assert.match(coEditorHTML(), /data-co="1" data-cf="img"/)
  const doc = coDocHTML()
  assert.match(doc, /^<table class="dt">/)
  assert.match(doc, /<td>รูป 1<\/td>/)
  assert.match(doc, /<td>รูป 2<\/td>/)
})

test('ฟอร์มใบยืนยัน: ติ๊ก "มาตรฐาน" ในตารางได้ค่ามาตรฐานของคอลัมน์ ไม่ใช่ค่า on ของช่องติ๊ก', () => {
  const js = scripts.join('\n')
  const change = js.slice(js.indexOf("form.addEventListener('change'"), js.indexOf("form.addEventListener('focusin'"))
  const table = change.indexOf('if(d.t')
  assert.ok(table > 0)
  assert.match(change.slice(table, change.indexOf('{', table)), /t\.type!=='checkbox'/)
  assert.match(change, /d\.std!==undefined\)\{ scope\('p'\)\[d\.t\]\[\+d\.r\]\[d\.c\]=t\.checked\?d\.std:''/)
})

test('ฟอร์มใบยืนยัน: เปลี่ยนเลขที่ใบแล้วรูปของใบเดิมไม่ถูกตัดทิ้งเงียบๆ (เลขรูปของแบบและจุดกำกับจะชี้ผิดรูป)', () => {
  const js = scripts.join('\n')
  const save = js.slice(js.indexOf('function saveToSystem'), js.indexOf("const url='/#/board?confirmation=save'"))
  assert.doesNotMatch(save, /payload\.mockups=payload\.mockups\.filter/)
  assert.match(save, /if\(foreign\.length\)\{ alert\(/)
  assert.ok(save.indexOf('foreign.length') < save.indexOf('const payload='))
})

function autosave(state, tab = null) {
  const js = scripts.join('\n')
  const start = js.indexOf('let warnedQuota=false')
  const end = js.indexOf('function toast(')
  assert.ok(start > 0 && end > start)
  const writes = []
  const timers = new Map()
  let nextTimer = 0
  const api = new Function('state', 'localStorage', 'LS', 'tabStore', 'TAB_LS', 'setTimeout', 'clearTimeout', 'toast', js.slice(start, end) + '\nreturn { save, saveSoon, flushSave }')(
    state, { setItem: (key, text) => writes.push([key, JSON.parse(text)]) }, 'pc142', () => tab, 'pc142.tab',
    (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer }, id => { timers.delete(id) }, () => {},
  )
  const tick = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn() } }
  return { ...api, writes, timers, tick }
}

test('ฟอร์มใบยืนยัน: พิมพ์รัวเขียนลงเครื่องครั้งเดียวหลังหยุดพิมพ์ 0.4 วิ ด้วยค่าล่าสุด', () => {
  const state = { h: { customer: '' }, imgs: [] }
  const form = autosave(state)
  for (const text of ['ส', 'สม', 'สมช', 'สมชาย']) { state.h.customer = text; form.saveSoon() }
  assert.equal(form.writes.length, 0)
  assert.deepEqual([...form.timers.values()].map(t => t.ms), [400])
  form.tick()
  assert.deepEqual(form.writes, [['pc142', { h: { customer: 'สมชาย' }, imgs: [] }]])
  form.tick()
  assert.equal(form.writes.length, 1)
})

test('ฟอร์มใบยืนยัน: สิ่งที่พิมพ์ค้างถูกเขียนทันทีเมื่อสั่ง flush · ไม่มีอะไรค้าง = ไม่เขียนซ้ำ', () => {
  const state = { h: { customer: 'ก' }, imgs: [] }
  const form = autosave(state)
  form.flushSave()
  assert.equal(form.writes.length, 0)
  form.saveSoon()
  state.h.customer = 'กข'
  form.flushSave()
  assert.deepEqual(form.writes.map(w => w[1].h.customer), ['กข'])
  assert.equal(form.timers.size, 0)
  form.flushSave()
  form.tick()
  assert.equal(form.writes.length, 1)
})

test('ฟอร์มใบยืนยัน: การบันทึกทันที (เปลี่ยนสินค้า โหลดใบ ล้างฟอร์ม) ยกเลิกรอบที่รออยู่ ไม่เขียนค่าเก่าทับทีหลัง', () => {
  const state = { h: { customer: 'เดิม' }, imgs: [] }
  const form = autosave(state)
  form.saveSoon()
  state.h.customer = 'ใหม่'
  form.save()
  assert.equal(form.timers.size, 0)
  form.tick()
  assert.deepEqual(form.writes.map(w => w[1].h.customer), ['ใหม่'])
})

test('ฟอร์มใบยืนยัน: flush ครบทุกทางออก (ออกจากช่อง · ซ่อนแท็บ · ปิดหน้า · บันทึกเข้าระบบ · ส่งออก PDF) และมีแต่การพิมพ์ที่หน่วง', () => {
  const js = scripts.join('\n')
  assert.match(js, /form\.addEventListener\('change',flushSave\)/)
  assert.match(js, /addEventListener\('pagehide',flushSave\)/)
  assert.match(js, /addEventListener\('visibilitychange',\(\)=>\{ if\(document\.visibilityState==='hidden'\) flushSave\(\); \}\)/)
  assert.match(js, /function saveToSystem\(\)\{\s*flushSave\(\);/)
  assert.match(js, /async function exportPdf\(\)\{\s*flushSave\(\);/)
  const input = js.slice(js.indexOf("form.addEventListener('input'"), js.indexOf("form.addEventListener('change',e=>"))
  assert.equal((input.match(/saveSoon\(\)/g) ?? []).length, 3)
  assert.doesNotMatch(input, /[^a-zA-Z]save\(\)/)
  assert.equal((js.replace(input, '').match(/saveSoon\(\)/g) ?? []).length, 1)
  for (const name of ['startOver', 'loadData', 'rerender']) {
    const at = js.indexOf(`function ${name}(`)
    assert.match(js.slice(at, js.indexOf('\nfunction ', at + 1)), /[^a-zA-Z]save\(\);/, name)
  }
})

test('ฟอร์มใบยืนยัน: ปุ่มใบใหม่ในหน้ารับงานเปิด ?new=1 · ใบที่บันทึกเข้าระบบแล้วล้างได้เลย ไม่ต้องเก็บแยก · แก้หลังบันทึกยังเก็บแยก', () => {
  const receive = readFileSync(new URL('../src/pages/ReceiveJob.tsx', import.meta.url), 'utf8')
  assert.match(receive, /NEW_CONFIRMATION_FORM = '\/confirmation\?new=1'/)
  assert.match(receive, /href=\{NEW_CONFIRMATION_FORM\}[^>]*>เปิดฟอร์มใบยืนยัน \(ใบใหม่\)</)
  const js = scripts.join('\n')
  assert.match(js, /state\.sent_sig=formSig\(state\); save\(\);\s*showAfterSave/)
  const formSig = new Function(js.slice(js.indexOf('const formSig ='), js.indexOf('const PREV=')) + '\nreturn formSig')()
  const filled = { h: { doc_no: 'SC690999', customer: 'ร้าน ก' }, product: 'tshirt', p: { qty: 10 }, callouts: [], imgs: [] }
  const sent = newForm({ url: 'https://pp142.test/confirmation?new=1', saved: { ...filled, sent_sig: formSig(filled) } })
  sent.api.takeNew()
  assert.equal(sent.ctx.startedOver, 1)
  assert.equal(sent.store.has('pc142.prev'), false)
  const edited = newForm({ url: 'https://pp142.test/confirmation?new=1', saved: { ...filled, p: { qty: 12 }, sent_sig: formSig(filled) } })
  edited.api.takeNew()
  assert.equal(edited.ctx.startedOver, 0)
  assert.equal(edited.store.has('pc142.prev'), true)
})
