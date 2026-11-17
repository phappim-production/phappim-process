import { describe, expect, it } from 'vitest'
import {
  AUTO_UPDATE_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  canAutoUpdate,
  canCheckForUpdate,
  isEditingElement,
} from './appUpdateModel'

describe('appUpdateModel', () => {
  it('ใช้ช่วงเวลาตรวจ 10 นาที และรอก่อนโหลดเอง 2 นาที', () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(10 * 60 * 1000)
    expect(AUTO_UPDATE_DELAY_MS).toBe(2 * 60 * 1000)
  })

  it('ตรวจจับช่องกรอกข้อมูลและ contentEditable ได้ถูกต้อง', () => {
    expect(isEditingElement('input')).toBe(true)
    expect(isEditingElement('TEXTAREA')).toBe(true)
    expect(isEditingElement('select')).toBe(true)
    expect(isEditingElement('div', true)).toBe(true)
    expect(isEditingElement('button')).toBe(false)
    expect(isEditingElement('body')).toBe(false)
    expect(isEditingElement(null)).toBe(false)
  })

  it('ยังไม่โหลดเองเมื่อไม่มีรุ่นใหม่ หรือกำลังโหลด หรือยังไม่ครบ 2 นาที', () => {
    expect(canAutoUpdate({ needRefresh: false, elapsedMs: 300_000, hasOpenDialog: false, isEditing: false })).toBe(false)
    expect(canAutoUpdate({ needRefresh: true, elapsedMs: 300_000, hasOpenDialog: false, isEditing: false, updating: true })).toBe(false)
    expect(canAutoUpdate({ needRefresh: true, elapsedMs: 119_999, hasOpenDialog: false, isEditing: false })).toBe(false)
  })

  it('ไม่โหลดเองเมื่อมีกล่องโต้ตอบ/ฟอร์มเปิดอยู่ หรือผู้ใช้กำลังพิมพ์', () => {
    expect(canAutoUpdate({ needRefresh: true, elapsedMs: 180_000, hasOpenDialog: true, isEditing: false })).toBe(false)
    expect(canAutoUpdate({ needRefresh: true, elapsedMs: 180_000, hasOpenDialog: false, isEditing: true })).toBe(false)
  })

  it('โหลดเองได้เมื่อมีรุ่นใหม่ค้าง >= 2 นาที ไม่มีฟอร์มเปิด และไม่ได้พิมพ์อยู่', () => {
    expect(canAutoUpdate({ needRefresh: true, elapsedMs: 120_000, hasOpenDialog: false, isEditing: false })).toBe(true)
  })

  it('ตรวจหารุ่นใหม่เฉพาะตอนมีเน็ตและแท็บกำลังเปิดดูอยู่', () => {
    expect(canCheckForUpdate(false, 'visible')).toBe(false)
    expect(canCheckForUpdate(true, 'hidden')).toBe(false)
    expect(canCheckForUpdate(true, 'visible')).toBe(true)
  })
})
