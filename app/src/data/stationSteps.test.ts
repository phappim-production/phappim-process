import { describe, expect, it } from 'vitest'
import { etaFromDay } from './stationSteps'
import { dueDate } from './live'
import { thaiWorkEnd } from '../proto/model'

// เวลาเลิกงานจริงคือ 18:00 (ไม่ใช่ 17:00) · กำหนดส่งและวันคาดว่าเสร็จต้องใช้เวลานี้
describe('เวลาเลิกงาน 18:00', () => {
  it('กำหนดส่ง = 18:00 เวลาไทยของวันนั้น', () => {
    expect(dueDate('2026-11-22').toISOString()).toBe('2026-11-22T11:00:00.000Z')
    expect(thaiWorkEnd('2026-11-22').getTime()).toBe(dueDate('2026-11-22').getTime())
  })

  it('ลงวันคาดว่าเสร็จเป็นวันนี้ ตอน 17:30 → ได้ 18:00 วันนี้ (ไม่ข้ามไปสิ้นวัน)', () => {
    const now = new Date('2026-11-21T17:30:00+07:00')
    expect(etaFromDay('2026-11-21', now)?.toISOString()).toBe('2026-11-21T11:00:00.000Z')
  })

  it('เลย 18:00 แล้ว → ใช้สิ้นวัน 23:59 ให้ยังเป็นเวลาข้างหน้า', () => {
    const now = new Date('2026-11-21T18:30:00+07:00')
    expect(etaFromDay('2026-11-21', now)?.toISOString()).toBe('2026-11-21T16:59:00.000Z')
  })

  it('วันที่ผ่านไปแล้วหรือรูปแบบผิด → ไม่รับ', () => {
    const now = new Date('2026-11-21T10:00:00+07:00')
    expect(etaFromDay('2026-11-20', now)).toBeNull()
    expect(etaFromDay('21/11/2026', now)).toBeNull()
  })
})
