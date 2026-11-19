import { describe, expect, it } from 'vitest'
import { sewRecipeProblem } from './confirmation'

describe('sewRecipeProblem (สินค้าไม่มีสูตรจักร + เส้นทางผ่านเย็บ)', () => {
  it('ไม่มีสูตรจักร + ผ่านเย็บ = เตือนก่อนส่งงานเข้า พร้อมบอกทางแก้', () => {
    expect(sewRecipeProblem('plain', [])).toMatch(/ยังไม่มีข้อมูลจักรเย็บ.*ตัดงานลูกค้า.*ตั้งค่า/)
    expect(sewRecipeProblem('emb', [])).not.toBeNull()
  })
  it('ไม่ผ่านเย็บ (ตัดงานลูกค้า) = ไม่เตือน', () => {
    expect(sewRecipeProblem('cut_only', [])).toBeNull()
  })
  it('มีสูตรจักรแล้ว = ไม่เตือน', () => {
    expect(sewRecipeProblem('normal', [{ type: 'single', qty: 1 }])).toBeNull()
  })
})
