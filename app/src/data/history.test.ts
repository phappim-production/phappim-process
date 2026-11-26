import { describe, expect, it } from 'vitest'
import { eventLine, visitLines, type EventRow, type Names, type VisitRow } from './history'

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

describe('เวลาที่ใช้ต่อสถานี: รออนุมัติชิ้นแรก', () => {
  const visit = (started_at: string, done_at: string | null): VisitRow =>
    ({ station_code: 'print', phase: 'production', visit: 0, started_at, done_at, rework: false })
  const e = (type: string, at: string) => ({ type, at })
  it('หักเวลารออนุมัติชิ้นแรกเหมือนเวลามาตรฐาน · ทับช่วงพักหักครั้งเดียว', () => {
    const [line] = visitLines([visit('2026-11-23T01:00:00Z', '2026-11-23T09:00:00Z')], names, new Date('2026-11-24T00:00:00Z'), [
      e('hold', '2026-11-23T02:00:00Z'), e('resume', '2026-11-23T04:00:00Z'),
      e('first_piece_sent', '2026-11-23T03:00:00Z'), e('first_piece_ok', '2026-11-23T05:00:00Z'),
    ])
    expect(line.pausedMs).toBe(2 * 3_600_000)
    expect(line.waitedMs).toBe(3_600_000)
    expect(line.workedMs).toBe(5 * 3_600_000)
    expect(line.waited).toBe('1 ชม.')
  })
  it('รูปที่ค้างไม่ได้ตัดสินแล้วสถานีจบไปแล้ว ไม่หัก · ยังทำอยู่หักถึงตอนนี้', () => {
    const events = [e('first_piece_sent', '2026-11-23T03:00:00Z')]
    const [done] = visitLines([visit('2026-11-23T01:00:00Z', '2026-11-23T09:00:00Z')], names, new Date('2026-11-24T00:00:00Z'), events)
    expect(done.waitedMs).toBe(0)
    const [doing] = visitLines([visit('2026-11-23T01:00:00Z', null)], names, new Date('2026-11-23T05:00:00Z'), events)
    expect(doing.waitedMs).toBe(2 * 3_600_000)
    expect(doing.workedMs).toBe(2 * 3_600_000)
  })
})

describe('ไทม์ไลน์: เช็ควัตถุดิบก่อนเข้าไลน์', () => {
  const row = (type: string, payload: Record<string, unknown>, phase = 'materials'): EventRow => ({ id: 4, type, phase, station_code: null, payload, by: null, at: '2026-11-26T03:00:00Z' })
  it('ตั้งรายการ = บอกจำนวนและชื่อรายการ', () => {
    expect(eventLine(row('materials_set', { items: ['ผ้า', 'ด้าย'] }), names)).toEqual({ title: 'ตั้งรายการวัตถุดิบ 2 รายการ', detail: 'ผ้า, ด้าย', tone: 'neutral' })
  })
  it('ถ่ายรูป / ลบรูปวัตถุดิบ', () => {
    expect(eventLine(row('material_photos', { added: 3 }), names).title).toBe('ถ่ายรูปวัตถุดิบ 3 รูป')
    expect(eventLine(row('material_photo_removed', { path: 'a/b.jpg' }), names).title).toBe('ลบรูปวัตถุดิบ 1 รูป')
  })
  it('แอดมินปล่อยเข้าไลน์ = บอกยอดที่เช็คและที่ไปต่อ · ปล่อยเองตอนรับงาน = ข้อความเดิม', () => {
    expect(eventLine(row('released', { manual: true, materials: 4, photos: 2 }, 'production'), names))
      .toEqual({ title: 'ปล่อยเข้าไลน์การผลิต', detail: 'เช็ควัตถุดิบครบ 4 รายการ · รูป 2 รูป · เข้าผลิตจริงที่สถานีแรก', tone: 'ok' })
    expect(eventLine(row('released', { manual: true, materials: 1, photos: 1 }, 'sample'), names).detail).toMatch(/ไปขึ้นตัวอย่าง$/)
    expect(eventLine(row('released', {}, 'production'), names).title).toBe('เข้าผลิตจริงที่สถานีแรก')
  })
})
