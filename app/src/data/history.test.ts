import { describe, expect, it } from 'vitest'
import { eventLine, type EventRow, type Names } from './history'

const names: Names = { station: c => c, step: (_s, k) => k }
const ev = (payload: Record<string, unknown>): EventRow =>
  ({ id: 1, type: 'machines_released', phase: 'production', station_code: 'sew', payload, by: null, at: '2026-11-19T03:00:00Z' })

describe('ไทม์ไลน์: คืนจักร', () => {
  it('คืนเพราะจักรเสีย = บอกสาเหตุและอาการ (QA รอบ 7 บั๊ก #1)', () => {
    expect(eventLine(ev({ machines: ['SN-013'], reason: 'จักรเสีย', note: 'เข็มหัก' }), names))
      .toEqual({ title: 'คืนจักร', detail: 'SN-013 · จักรเสีย (เข็มหัก)', tone: 'warn' })
  })
  it('ปิดใช้งานโดยไม่มีหมายเหตุ = บอกสาเหตุ', () => {
    expect(eventLine(ev({ machines: ['SN-013'], reason: 'ปิดใช้งาน' }), names).detail).toBe('SN-013 · ปิดใช้งาน')
  })
  it('คืนด้วยปุ่ม − / เย็บเสร็จ = แสดงรหัสอย่างเดียว', () => {
    expect(eventLine(ev({ machines: ['SN-013', 'SN-014'] }), names)).toEqual({ title: 'คืนจักร', detail: 'SN-013, SN-014', tone: 'neutral' })
  })
})

describe('ไทม์ไลน์: รูปม็อคอัพ', () => {
  const pic = (replaced: boolean): EventRow => ({ id: 2, type: 'mockup', phase: 'production', station_code: null, payload: { path: 'a.jpg', replaced }, by: null, at: '2026-11-19T03:00:00Z' })
  it('เพิ่ม / เปลี่ยนรูปเป็นข้อความไทย ไม่ใช่ชื่อชนิดภาษาอังกฤษ', () => {
    expect(eventLine(pic(false), names)).toEqual({ title: 'เพิ่มรูปม็อคอัพ', tone: 'ok' })
    expect(eventLine(pic(true), names).title).toBe('เปลี่ยนรูปม็อคอัพ')
  })
})

describe('ไทม์ไลน์: จัดส่ง', () => {
  const row = (type: string, payload: Record<string, unknown>): EventRow => ({ id: 3, type, phase: 'done', station_code: null, payload, by: null, at: '2026-11-21T03:00:00Z' })
  it('จัดส่งแล้วแสดงเลขพัสดุ · ยกเลิกแสดงเหตุผล', () => {
    expect(eventLine(row('delivered', { note: 'Kerry KEX123' }), names)).toEqual({ title: 'จัดส่งให้ลูกค้าแล้ว', detail: 'Kerry KEX123', tone: 'ok' })
    expect(eventLine(row('delivered', { note: null }), names)).toEqual({ title: 'จัดส่งให้ลูกค้าแล้ว', tone: 'ok' })
    expect(eventLine(row('delivery_undone', { reason: 'กดผิดงาน' }), names)).toEqual({ title: 'ยกเลิกการบันทึกจัดส่ง', detail: 'กดผิดงาน', tone: 'warn' })
  })
})

describe('ไทม์ไลน์: ยกเลิกงาน', () => {
  it('แสดงสถานีที่งานอยู่ตอนยกเลิกและเหตุผล', () => {
    const row: EventRow = { id: 4, type: 'job_cancelled', phase: 'production', station_code: 'cut', payload: { reason: 'ลูกค้ายกเลิกออเดอร์' }, by: null, at: '2026-11-21T03:00:00Z' }
    const line = eventLine(row, names)
    expect(line.tone).toBe('danger')
    expect(line.title).toMatch(/^ยกเลิกงาน \(อยู่ที่.+\)$/)
    expect(line.detail).toBe('ลูกค้ายกเลิกออเดอร์')
  })
})

describe('ไทม์ไลน์: แก้ใบยืนยันหลังรับงาน', () => {
  const row = (payload: Record<string, unknown>): EventRow =>
    ({ id: 5, type: 'spec_revised', phase: 'production', station_code: 'print', payload, by: null, at: '2026-11-23T03:00:00Z' })
  it('บอกครั้งที่แก้ จำนวน/กำหนดส่งที่เปลี่ยน และช่องที่แก้', () => {
    expect(eventLine(row({ rev: 2, fields: ['สีผ้าพื้น', 'ที่อยู่จัดส่ง'], mockup_stale: 0, qty_from: 100, qty_to: 120,
      due_from: '2026-12-20', due_to: '2026-12-20', spare_from: 2, spare_to: 2, renamed: ['ชื่องาน'] }), names, 'ตัว')).toEqual({
      title: 'แก้ใบยืนยัน ครั้งที่ 2 · ผลิตตามสเปกใหม่', tone: 'warn',
      detail: 'จำนวน 100 → 120 ตัว · ชื่องาน · ช่องที่แก้: สีผ้าพื้น, ที่อยู่จัดส่ง',
    })
  })
  it('เลื่อนกำหนดส่ง = บอกวันเดิมและวันใหม่', () => {
    const line = eventLine(row({ rev: 1, qty_from: 10, qty_to: 10, due_from: '2026-12-20', due_to: '2026-12-25', spare_from: 0, spare_to: 0 }), names)
    expect(line.detail).toMatch(/^กำหนดส่ง .*20.* → .*25/)
  })
  it('ม็อคอัพฉบับอนุมัติยังเป็นค่าเก่า = เตือนในประวัติ', () => {
    expect(eventLine(row({ rev: 1, summary: [], fields: [], mockup_rev: 3, mockup_stale: 2 }), names).detail)
      .toBe('ม็อคอัพกำกับสเปกฉบับ 3 ยังเป็นค่าเก่า 2 จุด')
  })
})
