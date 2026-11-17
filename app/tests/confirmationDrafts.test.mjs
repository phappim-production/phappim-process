import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draftLabel, OUTBOX_KEY, takeOutbox } from '../src/data/confirmationDrafts.ts'
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
  assert.match(rec.detail ?? '', /ยังไม่มี PDF ที่ลูกค้าเซ็น/)
  assert.equal(eventLine({ ...base, type: 'confirmation_pdf', payload: { replaced: false } }, names, 'ตัว').title, 'แนบ PDF ใบยืนยันที่ลูกค้าเซ็น')
  assert.equal(eventLine({ ...base, type: 'confirmation_pdf', payload: { replaced: true } }, names, 'ตัว').title, 'เปลี่ยน PDF ใบยืนยัน')
})
