import { describe, expect, it } from 'vitest'
import { MAX_MATERIAL_ITEMS, releaseBlocker, withItem, withoutItem, type MaterialItem } from './materialsCheck'

const item = (id: number, name: string, checked = false): MaterialItem => ({ id, name, checked_at: checked ? '2026-11-26T03:00:00Z' : null })

describe('รายการวัตถุดิบที่แอดมินพิมพ์', () => {
  it('เพิ่มต่อท้ายตามลำดับที่พิมพ์ ตัดช่องว่างหัวท้าย', () => {
    expect(withItem(['ผ้า'], '  ด้ายสีดำ ')).toEqual({ ok: true, names: ['ผ้า', 'ด้ายสีดำ'] })
  })
  it('ชื่อว่างหรือซ้ำ (ไม่สนตัวพิมพ์เล็กใหญ่) ไม่เพิ่ม', () => {
    expect(withItem(['ผ้า'], '   ')).toEqual({ ok: false, reason: 'พิมพ์ชื่อวัตถุดิบก่อนกดเพิ่ม' })
    expect(withItem(['Label A'], 'label a ')).toEqual({ ok: false, reason: 'มี "label a" ในรายการแล้ว' })
  })
  it('เกิน 30 รายการไม่เพิ่ม · ชื่อยาวตัดที่ 80 ตัวอักษรเหมือนฐานข้อมูล', () => {
    const full = Array.from({ length: MAX_MATERIAL_ITEMS }, (_, i) => `ของ ${i}`)
    expect(withItem(full, 'ใหม่').ok).toBe(false)
    const long = withItem([], 'ก'.repeat(100))
    expect(long.ok && long.names[0].length).toBe(80)
  })
  it('ลบเฉพาะรายการที่เลือก', () => {
    expect(withoutItem(['ผ้า', 'ด้าย', 'ป้าย'], 'ด้าย')).toEqual(['ผ้า', 'ป้าย'])
  })
})

describe('ปล่อยเข้าไลน์การผลิตได้เมื่อ', () => {
  it('ยังไม่มีรายการ = ปล่อยไม่ได้', () => {
    expect(releaseBlocker([], 3)).toMatch(/เพิ่มรายการวัตถุดิบ/)
  })
  it('บอกชื่อรายการที่ยังไม่ติ๊ก', () => {
    expect(releaseBlocker([item(1, 'ผ้า', true), item(2, 'ด้าย'), item(3, 'ป้ายคอ')], 1))
      .toBe('ยังไม่ได้ติ๊กวัตถุดิบ: ด้าย, ป้ายคอ · เช็คของให้ครบก่อนปล่อยเข้าไลน์')
  })
  it('ติ๊กครบแต่ยังไม่มีรูป = ปล่อยไม่ได้', () => {
    expect(releaseBlocker([item(1, 'ผ้า', true)], 0)).toBe('ถ่ายรูปวัตถุดิบอย่างน้อย 1 รูปก่อนปล่อยเข้าไลน์')
  })
  it('ติ๊กครบ + มีรูปอย่างน้อย 1 รูป = ปล่อยได้', () => {
    expect(releaseBlocker([item(1, 'ผ้า', true), item(2, 'ด้าย', true)], 1)).toBeNull()
  })
})
