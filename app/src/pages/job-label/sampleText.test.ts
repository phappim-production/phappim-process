import { describe, expect, it } from 'vitest'
import { sampleText } from './sampleText'

describe('ข้อความตัวอย่างบนใบปะงาน', () => {
  it('ไม่ขึ้นตัวอย่าง', () => {
    expect(sampleText({ needs_sample: false, sample_round: 1, phase: 'production' })).toBe('ไม่ขึ้นตัวอย่าง')
  })
  it('ผ่านตัวอย่างแล้ว เมื่อเข้าผลิตจริงหรือเสร็จ', () => {
    expect(sampleText({ needs_sample: true, sample_round: 2, phase: 'production' })).toBe('ผ่านตัวอย่างแล้ว (รอบ 2)')
    expect(sampleText({ needs_sample: null, sample_round: 1, phase: 'done' })).toBe('ผ่านตัวอย่างแล้ว (รอบ 1)')
  })
  it('ยังอยู่ขั้นตัวอย่าง', () => {
    expect(sampleText({ needs_sample: true, sample_round: 2, phase: 'sample' })).toBe('ขึ้นตัวอย่าง รอบ 2 · ยังไม่ผ่าน')
  })
})
