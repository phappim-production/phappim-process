import { describe, expect, it } from 'vitest'
import { MAX_MATERIAL_ITEMS, addProblem, arrival, fromBangkokInput, materialsOutlook, releaseBlocker, toBangkokInput, withItem, withoutItem, type MaterialItem } from './materialsCheck'

const item = (id: number, name: string, checked = false): MaterialItem => ({ id, name, checked_at: checked ? '2026-11-26T03:00:00Z' : null, eta: null })

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

describe('วันเวลาที่คาดว่าได้รับ', () => {
  const now = new Date('2026-11-26T10:00:00+07:00')
  const line = (eta: string | null, checked = false) => ({ name: 'ผ้า', eta: eta ? new Date(eta) : null, checked })

  it('ช่องวันเวลาเป็นเวลาไทยเสมอ แม้เครื่องตั้งเขตเวลาอื่น', () => {
    expect(fromBangkokInput('2026-11-28T14:30')?.toISOString()).toBe('2026-11-28T07:30:00.000Z')
    expect(toBangkokInput(new Date('2026-11-28T07:30:00Z'))).toBe('2026-11-28T14:30')
    expect(toBangkokInput(new Date('2026-11-27T18:00:00Z'))).toBe('2026-11-28T01:00')
    expect(fromBangkokInput('')).toBeNull()
  })
  it('สถานะของแต่ละรายการ: ได้รับแล้ว / เลยกำหนด / วันนี้ / วันอื่น / ยังไม่ใส่วัน', () => {
    expect(arrival(line('2026-11-25T09:00:00+07:00', true), now)).toBe('received')
    expect(arrival(line('2026-11-26T09:59:00+07:00'), now)).toBe('late')
    expect(arrival(line('2026-11-26T23:30:00+07:00'), now)).toBe('today')
    expect(arrival(line('2026-11-27T00:10:00+07:00'), now)).toBe('later')
    expect(arrival(line(null), now)).toBe('unset')
  })
  it('สรุปบนการ์ด: เลยกำหนดเรียงเก่าก่อน · ของถึงครั้งถัดไป · ชิ้นสุดท้าย · ไม่นับของที่ได้รับแล้ว', () => {
    const o = materialsOutlook([
      { name: 'ด้าย', eta: new Date('2026-11-26T08:00:00+07:00'), checked: false },
      { name: 'ผ้า', eta: new Date('2026-11-25T08:00:00+07:00'), checked: false },
      { name: 'ป้าย', eta: new Date('2026-11-30T08:00:00+07:00'), checked: false },
      { name: 'หมึก', eta: new Date('2026-12-20T08:00:00+07:00'), checked: true },
      { name: 'ถุง', eta: null, checked: false },
      { name: 'กล่อง', eta: new Date('2026-11-28T08:00:00+07:00'), checked: false },
    ], now)
    expect(o.late.map(l => l.name)).toEqual(['ผ้า', 'ด้าย'])
    expect(o.next?.toISOString()).toBe(new Date('2026-11-28T08:00:00+07:00').toISOString())
    expect(o.last?.toISOString()).toBe(new Date('2026-11-30T08:00:00+07:00').toISOString())
    expect(o.unset).toBe(1)
  })
  it('เพิ่มรายการต้องมีวันคาดว่าได้รับหรือมีของแล้ว · ปี พ.ศ. ไม่รับ (ตรงกับฐานข้อมูล)', () => {
    expect(addProblem([], 'ผ้า', '', false)).toBe('ใส่วันเวลาที่คาดว่าจะได้รับ "ผ้า" หรือติ๊ก "มีของแล้ว"')
    expect(addProblem([], 'ผ้า', '', true)).toBeNull()
    expect(addProblem([], 'ผ้า', '2026-11-28T10:00', false)).toBeNull()
    expect(addProblem([], 'ผ้า', '2569-11-28T10:00', false)).toMatch(/ปี ค\.ศ\./)
    expect(addProblem(['ผ้า'], ' ผ้า ', '2026-11-28T10:00', false)).toBe('มี "ผ้า" ในรายการแล้ว')
  })
})
