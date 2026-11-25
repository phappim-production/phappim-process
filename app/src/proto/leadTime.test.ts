import { describe, expect, it } from 'vitest'
import { leadDayN, leadDaysFor, leadDueDate, leadLateDays, leadTimeFor, leadUsed } from './leadTime'

describe('เวลาผลิตทั้งงาน', () => {
  it('1–499 = 10 · 500–999 = 15 · 1000 ขึ้นไป = 20 วันทำงาน', () => {
    expect([1, 499, 500, 999, 1000, 5000].map(leadDaysFor)).toEqual([10, 10, 15, 15, 20, 20])
  })

  it('นับวันรับงานเป็นวันที่ 1 ไม่นับวันอาทิตย์', () => {
    expect(leadDayN('2026-11-02', 1)).toBe('2026-11-02')
    expect(leadDayN('2026-11-02', 10)).toBe('2026-11-12')
    expect(leadDayN('2026-11-02', 15)).toBe('2026-11-18')
    expect(leadDayN('2026-11-02', 20)).toBe('2026-11-24')
  })

  it('รับงานวันอาทิตย์ เริ่มนับวันจันทร์ · รับวันเสาร์ วันที่ 2 คือวันจันทร์', () => {
    expect(leadDayN('2026-11-01', 1)).toBe('2026-11-02')
    expect(leadDayN('2026-11-01', 10)).toBe('2026-11-12')
    expect(leadDayN('2026-11-07', 2)).toBe('2026-11-09')
  })

  it('ข้ามเดือนและปี', () => {
    expect(leadDayN('2026-12-24', 10)).toBe('2027-01-04')
  })

  it('วันที่ใช้ไปรวมวันรับงานและวันนี้ ไม่นับอาทิตย์', () => {
    expect(leadUsed('2026-11-02', '2026-11-12')).toBe(10)
    expect(leadUsed('2026-11-01', '2026-11-01')).toBe(0)
    expect(leadUsed('2026-11-07', '2026-11-09')).toBe(2)
  })

  it('ใช้วันที่ตามเวลาไทย และเตือนที่ 80%', () => {
    const lead = leadTimeFor(new Date('2026-11-01T20:00:00Z'), 10)
    expect(lead).toEqual({ days: 10, start: '2026-11-02', due: '2026-11-12', warnOn: '2026-11-10' })
    expect(leadTimeFor(new Date('2026-11-02T01:00:00Z'), 500)).toMatchObject({ days: 15, due: '2026-11-18', warnOn: '2026-11-14' })
    expect(leadTimeFor(new Date('2026-11-02T01:00:00Z'), 1000)).toMatchObject({ days: 20, due: '2026-11-24', warnOn: '2026-11-19' })
  })

  it('คาดเสร็จเกินวันที่ต้องเสร็จกี่วัน ตามวันที่ไทย', () => {
    expect(leadLateDays(new Date('2026-11-14T03:00:00Z'), '2026-11-12')).toBe(2)
    expect(leadLateDays(new Date('2026-11-12T16:59:00Z'), '2026-11-12')).toBe(0)
    expect(leadLateDays(new Date('2026-11-10T03:00:00Z'), '2026-11-12')).toBe(-2)
    expect(leadDueDate('2026-11-12').toISOString()).toBe('2026-11-12T05:00:00.000Z')
  })

  it('เสร็จวันครบก่อนเที่ยงคืนเวลาไทย = ทัน · หลังเที่ยงคืน = เกิน', () => {
    expect(leadLateDays(new Date('2026-11-12T16:30:00Z'), '2026-11-12')).toBe(0)
    expect(leadLateDays(new Date('2026-11-12T18:00:00Z'), '2026-11-12')).toBe(1)
  })
})
