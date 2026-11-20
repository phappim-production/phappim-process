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
