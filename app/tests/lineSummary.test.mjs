import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boot } from './confirmationHarness.mjs'

const SAMPLE_YES = 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)'
const SAMPLE_DEV = 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)'

function handkerchief() {
  const b = boot()
  const s = b.api.state
  s.pickOpen = false
  s.product = 'scarf'
  Object.assign(s.h, {
    doc_no: 'SC690172', customer: 'บ. ลูกค้าทดสอบ', job_name: 'ผ้าเช็ดหน้า', issue_date: '2026-10-20', due_date: '2026-11-07', sample: SAMPLE_YES,
    contact: 'คุณทดสอบ', phone: '0800000000', delivery: 'จัดส่งตามที่อยู่', address: '99 ถนนทดสอบ',
  })
  Object.assign(b.api.scope('p'), {
    item: 'ผ้าเช็ดหน้า', fabric: 'อื่นๆ', fabric__other: 'ไหมสเปน', print_method: ['ดิจิทัลพริ้นท์'], sides: 'หน้าเดียว',
    sew_style: 'อื่นๆ', sew_style__other: 'ม้วนริม 0.2 ซม.', pack: 'อื่นๆ', pack__other: 'ถุงใส opp 1/1',
    items: [{ name: 'ลายโลโก้', w: '60', h: '60', qty: '300' }],
  })
  return b
}

test('สรุปส่งไลน์: ผ้าเช็ดหน้า ได้เลขที่ใบ ลูกค้า วันส่ง สเปก จำนวน และการขึ้นตัวอย่าง ตามแบบที่แอดมินใช้', () => {
  const lines = handkerchief().api.lineSummary().split('\n')
  assert.deepEqual(lines, [
    'SC690172 บ. ลูกค้าทดสอบ',
    'วันที่ส่งงาน 07/11/2569',
    'ผ้าเช็ดหน้า',
    '- ชนิดผ้า ไหมสเปน',
    '- ลายโลโก้ · ขนาด 60 × 60 ซม. · 300 ผืน',
    '- เทคนิค ดิจิทัลพริ้นท์',
    '- จำนวนหน้า หน้าเดียว',
    '- วิธีเย็บ เย็บตามมาตรฐานโรงงาน',
    '- รูปแบบการเย็บ ม้วนริม 0.2 ซม.',
    '- วิธีแพ็ค ถุงใส opp 1/1',
    '- จำนวนทั้งหมด 300 ผืน',
    '(มีขึ้นตัวอย่าง 1 ผืน ให้ลูกค้ายืนยันก่อนผลิตจริง)',
  ])
})

test('สรุปส่งไลน์: ไม่ใส่ผู้ติดต่อ เบอร์โทร ที่อยู่ลูกค้า (ส่งเข้ากลุ่มไลน์)', () => {
  const text = handkerchief().api.lineSummary()
  for (const x of ['คุณทดสอบ', '0800000000', '99 ถนนทดสอบ', 'จัดส่งตามที่อยู่']) assert.ok(!text.includes(x), x)
})

test('สรุปส่งไลน์: เสื้อแยกจำนวนตามสี/ไซซ์ ตำแหน่งพิมพ์ เผื่อเสีย · ไม่ขึ้นตัวอย่าง = ไม่มีบรรทัดตัวอย่าง', () => {
  const b = boot()
  const s = b.api.state
  s.pickOpen = false
  s.product = 'tshirt'
  Object.assign(s.h, { doc_no: 'SC-T1', customer: 'ลูกค้า', job_name: 'เสื้อทีม', due_date: '2026-12-10', sample: 'ไม่ขึ้นตัวอย่าง' })
  Object.assign(b.api.scope('p'), {
    size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ label: 'ขาว', q: { M: '10', L: '5' } }, { label: 'ดำ', q: { M: '3' } }], spare: '2',
    print_method: ['DTF (ฟิล์มรีดร้อน)'], placements: { 'หน้าอกซ้าย': { on: true, size: '10x10' }, 'กลางหลัง': { on: false, size: '30' } },
  })
  const lines = b.api.lineSummary().split('\n')
  assert.equal(lines[2], 'เสื้อยืด · เสื้อทีม')
  assert.ok(lines.includes('- ขาว: M 10, L 5 (รวม 15)'))
  assert.ok(lines.includes('- ดำ: M 3'))
  assert.ok(lines.includes('- หน้าอกซ้าย: DTF (ฟิล์มรีดร้อน) 10x10 ซม.'))
  assert.ok(!lines.some(l => l.includes('กลางหลัง')))
  assert.ok(!lines.some(l => l.includes('ชุดไซซ์')))
  assert.equal(lines.at(-1), '- จำนวนทั้งหมด 18 ตัว (+ เผื่อเสีย 2 ตัว)')
})

test('สรุปส่งไลน์: ใบแก้บอกครั้งที่แก้ · งาน Develop บอกว่าไม่ผลิตจริงพร้อมวันส่งตัวอย่าง', () => {
  const b = handkerchief()
  Object.assign(b.api.state.h, { rev: '2', sample: SAMPLE_DEV, sample_date: '2026-11-01' })
  const lines = b.api.lineSummary().split('\n')
  assert.equal(lines[0], 'SC690172 บ. ลูกค้าทดสอบ (แก้ไขครั้งที่ 2)')
  assert.equal(lines.at(-1), '(งาน Develop · ทำตัวอย่างให้ลูกค้ายืนยัน ไม่ผลิตจริง · ส่งตัวอย่าง 01/11/2569)')
})

test('สรุปส่งไลน์: ข้อความหลายบรรทัดในช่องหมายเหตุรวมเป็นบรรทัดเดียว', () => {
  const b = handkerchief()
  b.api.scope('p').notes = 'ระวังสี\nเทียบกับตัวอย่างเดิม'
  assert.ok(b.api.lineSummary().split('\n').includes('- หมายเหตุถึงฝ่ายผลิต ระวังสี เทียบกับตัวอย่างเดิม'))
})

test('สรุปส่งไลน์: หน้าระบบเปิดใบมาพร้อม line = เปิดกล่องสรุปให้ทันที · ไม่ส่ง line = ไม่เปิด', () => {
  for (const line of [true, false]) {
    const data = handkerchief().api.state
    const store = new Map([['pp142.confirmation.inbox', JSON.stringify({ h: data.h, product: data.product, p: data.p, view: true, ...(line ? { line: true } : {}) })]])
    const b = boot('', { store })
    b.api.takeInbox()
    const box = b.document.querySelector('#lineBox')
    assert.equal(box.hidden === false, line)
    if (line) assert.match(b.document.querySelector('#lineText').value, /^SC690172 /)
  }
})

test('สรุปส่งไลน์: ทุกสินค้าในฟอร์มสร้างสรุปได้ ไม่พัง และมีบรรทัดจำนวนทั้งหมด', () => {
  const b = boot()
  const keys = Object.keys(b.api.PRODUCTS)
  assert.ok(keys.length >= 38)
  for (const key of keys) {
    const s = b.api.state
    s.pickOpen = false
    s.product = key
    Object.assign(s.h, { doc_no: 'SC-ALL', customer: 'ลูกค้า', due_date: '2026-12-10' })
    const text = b.api.lineSummary()
    assert.match(text, /^SC-ALL ลูกค้า\nวันที่ส่งงาน 10\/12\/2569\n/, key)
    assert.match(text, /- จำนวนทั้งหมด \d+ \S+/, key)
    assert.ok(!text.includes('undefined') && !text.includes('[object'), key)
  }
})
