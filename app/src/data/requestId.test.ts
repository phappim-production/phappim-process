import { describe, expect, it } from 'vitest'
import { requestSlot } from './requestId'

describe('รหัสคำขอ', () => {
  it('ส่งซ้ำเนื้อหาเดิมได้รหัสเดิม · แก้ค่าแล้วได้รหัสใหม่ · บันทึกสำเร็จแล้วเริ่มรหัสใหม่', () => {
    let n = 0
    const slot = requestSlot(() => `id-${++n}`)
    expect(slot.idFor('10')).toBe('id-1')
    expect(slot.idFor('10')).toBe('id-1')
    expect(slot.idFor('5')).toBe('id-2')
    slot.clear()
    expect(slot.idFor('5')).toBe('id-3')
  })
})
