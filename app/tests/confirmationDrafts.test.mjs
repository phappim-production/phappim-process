import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { draftLabel, formDataFromDraft, formDataFromJob, OUTBOX_KEY, takeOutbox } from '../src/data/confirmationDrafts.ts'
import { developChoice, sampleChoice, syncConfirmationSpec } from '../src/data/confirmation.ts'
import { eventLine } from '../src/data/history.ts'

const memory = init => {
  const m = new Map(Object.entries(init))
  return { getItem: k => m.get(k) ?? null, removeItem: k => m.delete(k), size: () => m.size }
}

test('ใบจากฟอร์ม: อ่านแล้วลบออก (บันทึกครั้งเดียว)', () => {
  const store = memory({ [OUTBOX_KEY]: JSON.stringify({ h: { doc_no: ' SC-1 ' }, p: {} }) })
  const item = takeOutbox(store)
  assert.equal(item?.no, 'SC-1')
  assert.equal(store.size(), 0)
  assert.equal(takeOutbox(store), null)
})

test('ใบจากฟอร์ม: ไม่มีเลขที่ใบ / ไม่ใช่ JSON / ไม่ใช่ใบยืนยัน = ไม่บันทึก', () => {
  assert.equal(takeOutbox(memory({ [OUTBOX_KEY]: JSON.stringify({ h: { doc_no: '  ' } }) })), null)
  assert.equal(takeOutbox(memory({ [OUTBOX_KEY]: '{oops' })), null)
  assert.equal(takeOutbox(memory({ [OUTBOX_KEY]: '[1,2]' })), null)
  assert.equal(takeOutbox(memory({})), null)
})

test('ใบจากฟอร์ม: เบราว์เซอร์ปิด localStorage ไม่ทำให้หน้าพัง', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, removeItem: () => {} }
  assert.equal(takeOutbox(broken), null)
})

test('รายการใบในหน้ารับงาน: เลขที่ใบ · ลูกค้า · วันที่บันทึก', () => {
  assert.equal(draftLabel({ confirmation_no: 'SC-9', customer_name: 'ร้านเอ', updated_at: '2026-11-17T10:00:00Z' }), 'SC-9 · ร้านเอ · บันทึก 17 พ.ย.')
  assert.equal(draftLabel({ confirmation_no: 'SC-9', customer_name: null, updated_at: '2026-11-17T10:00:00Z' }), 'SC-9 · บันทึก 17 พ.ย.')
})

test('ไทม์ไลน์: ส่งงานเข้าโดยยังไม่มี PDF และแนบทีหลัง', () => {
  const names = { station: c => c, step: (_s, k) => k }
  const base = { id: 1, phase: 'materials', station_code: null, by: null, at: '2026-11-17T10:00:00Z' }
  const rec = eventLine({ ...base, type: 'received', payload: { qty: 10, sample: false, pdf: false } }, names, 'ตัว')
  assert.match(rec.detail ?? '', /ยังไม่มีใบที่ลูกค้าเซ็น/)
  assert.equal(eventLine({ ...base, type: 'confirmation_pdf', payload: { replaced: false } }, names, 'ตัว').title, 'แนบ PDF ใบยืนยันที่ลูกค้าเซ็น')
  assert.equal(eventLine({ ...base, type: 'confirmation_pdf', payload: { replaced: true } }, names, 'ตัว').title, 'เปลี่ยน PDF ใบยืนยัน')
})

test('เปิดใบของงานที่รับแล้วในฟอร์ม: ใช้ข้อมูลบนงาน + รูปในระบบ', () => {
  const spec = { h: { doc_no: 'SC-9' }, p: { tshirt: { fabric: 'TC' } }, product: 'tshirt', callouts: [{ x: 0.2 }], mockup: 'data:old' }
  const urls = new Map([['SC-9/a.jpg', 'https://files.example/a']])
  const d = formDataFromJob(spec, 'SC-9/a.jpg', urls)
  assert.deepEqual(d.imgs, [{ name: '', src: 'https://files.example/a', path: 'SC-9/a.jpg' }])
  assert.equal(d.mockup_path, 'SC-9/a.jpg')
  assert.equal(d.from_job, true)
  assert.equal(d.mockup, undefined)
  assert.deepEqual(d.callouts, [{ x: 0.2 }])
  assert.deepEqual(formDataFromJob(spec, null, new Map()).imgs, [])
  assert.equal(formDataFromJob({ h: {} }, null, new Map()), null)
  assert.equal(formDataFromJob(null, null, new Map()), null)
})

test('เปิดใบในฟอร์ม: รูปครบทุกรูปตามลำดับ · รูปที่ขอลิงก์ไม่ได้ยังอยู่ เลขรูปของแบบจะได้ไม่เลื่อน', () => {
  const mockups = [{ name: 'หน้า', path: 'SC-9/a.jpg' }, { name: 'แดง', path: 'SC-9/b.jpg' }, { name: 'ฟ้า', path: 'SC-9/c.jpg' }]
  const spec = { h: { doc_no: 'SC-9' }, p: { bag: {} }, product: 'bag', mockups }
  const urls = new Map([['SC-9/a.jpg', 'u:a'], ['SC-9/c.jpg', 'u:c']])
  const d = formDataFromJob(spec, 'SC-9/a.jpg', urls)
  assert.deepEqual(d.imgs, [{ name: 'หน้า', src: 'u:a', path: 'SC-9/a.jpg' }, { name: 'แดง', src: '', path: 'SC-9/b.jpg' }, { name: 'ฟ้า', src: 'u:c', path: 'SC-9/c.jpg' }])
  assert.equal(d.mockups, undefined)
  const draft = formDataFromDraft({ h: { doc_no: 'SC-9' }, mockup_path: 'SC-9/a.jpg', mockups }, urls)
  assert.equal(draft.imgs.length, 3)
  assert.equal(draft.mockup_path, 'SC-9/a.jpg')
  assert.deepEqual(formDataFromDraft({ h: {}, mockup_path: 'SC-9/a.jpg' }, urls).imgs, [{ name: '', src: 'u:a', path: 'SC-9/a.jpg' }])
})

test('หน้ารับงาน: ปรับหัวใบและเผื่อเสียใน spec ให้ตรงกับค่าที่แอดมินแก้ก่อนส่งเข้าโรงงาน', () => {
  const synced = syncConfirmationSpec({
    no: ' SC69-NEW ',
    rev: 2,
    customer: ' ลูกค้าใหม่ ',
    jobName: '',
    product: 'tshirt',
    qty: 50,
    spare: 5,
    due: '2026-12-20',
    route: 'normal',
    needsSample: true,
    develop: false,
    spec: { h: { doc_no: 'OLD', customer: 'เก่า', sample: 'ไม่ขึ้นตัวอย่าง' }, p: { tshirt: { spare: 1 } }, product: 'tshirt' },
  }, 'เสื้อยืด')
  assert.deepEqual(synced.h, {
    doc_no: 'SC69-NEW',
    rev: 2,
    customer: 'ลูกค้าใหม่',
    job_name: 'เสื้อยืด',
    due_date: '2026-12-20',
    sample: 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)',
  })
  assert.equal(synced.p.tshirt.spare, 5)
})

test('หน้ารับงาน: ช่องขึ้นตัวอย่างใน spec ตามตัวเลือกที่แอดมินกด (ขึ้นตัวอย่าง / งาน Develop / ไม่ขึ้น) ไม่ค้างค่าจากใบ', () => {
  const base = { no: 'SC69-3', rev: 0, customer: 'ลูกค้า', jobName: 'งาน', product: 'tshirt', qty: 5, spare: 0, due: '2026-12-20', route: 'normal' }
  const sampleOf = (needsSample, develop, sample) => syncConfirmationSpec({ ...base, needsSample, develop, spec: { h: { doc_no: 'SC69-3', sample }, p: { tshirt: {} }, product: 'tshirt' } }, 'เสื้อยืด').h.sample
  const dev = sampleOf(true, true, 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)')
  assert.equal(dev, 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)')
  assert.ok(readFileSync(new URL('../../production-confirmation.html', import.meta.url), 'utf8').includes(`'${dev}'`), 'ข้อความต้องตรงกับตัวเลือกในฟอร์ม')
  assert.equal(developChoice({ sample: dev }), true)
  assert.equal(sampleChoice({ sample: dev }), true)
  assert.equal(sampleOf(true, false, 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)'), 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)')
  assert.equal(sampleOf(false, false, 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)'), 'ไม่ขึ้นตัวอย่าง')
  assert.equal(sampleOf(null, false, 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)'), 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)')
})

test('หน้ารับงาน: แอดมินลบจำนวนเผื่อเสีย → spec ไม่เก็บค่าเดิมไว้ (แก้ใบทีหลังจะไม่ดึงเผื่อเสียกลับมาเอง)', () => {
  const synced = syncConfirmationSpec({
    no: 'SC69-1', rev: 0, customer: 'ลูกค้า', jobName: 'งาน', product: 'tshirt', qty: 50, spare: 0, due: '2026-12-20', route: 'normal', needsSample: false, develop: false,
    spec: { h: { doc_no: 'SC69-1' }, p: { tshirt: { spare: '5' } }, product: 'tshirt' },
  }, 'เสื้อยืด')
  assert.equal(synced.p.tshirt.spare, '')
})
