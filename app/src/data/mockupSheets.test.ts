import { expect, it } from 'vitest'
import { pickSheets, type SheetRow } from './mockupSheets'
import { mockupProblem } from './mockups'

const sheet = (rev: number, status: SheetRow['status']) => ({ id: `s${rev}`, rev, status }) as SheetRow

it('เลือกฉบับที่ใช้ผลิต และฉบับที่กำลังแก้/รออนุมัติ', () => {
  const r = pickSheets([sheet(3, 'pending'), sheet(2, 'approved'), sheet(1, 'superseded')])
  expect([r.approved?.rev, r.open?.rev]).toEqual([2, 3])
  expect(pickSheets([sheet(1, 'superseded')])).toEqual({ approved: null, open: null })
})

it('ไฟล์ภาพม็อคอัพ: รับ PNG / JPG / WEBP ไม่เกิน 5 MB', () => {
  expect(mockupProblem({ size: 1000, type: 'image/png' })).toBeNull()
  expect(mockupProblem({ size: 1000, type: 'image/webp' })).toBeNull()
  expect(mockupProblem({ size: 1000, type: 'image/gif' })).toMatch(/JPG \/ PNG \/ WEBP/)
  expect(mockupProblem({ size: 1000, type: 'application/pdf' })).toMatch(/JPG \/ PNG \/ WEBP/)
  expect(mockupProblem({ size: 6 * 1024 * 1024, type: 'image/jpeg' })).toMatch(/เกิน 5 MB/)
})
