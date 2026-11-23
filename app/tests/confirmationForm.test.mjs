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
