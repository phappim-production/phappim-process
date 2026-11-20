import { expect, it } from 'vitest'
import { parseUnsaved, pickSheets, unsavedKey, type SheetRow } from './mockupSheets'
import { attachSpecSheets } from './live'
import type { Job } from '../proto/model'
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

it('งานที่ยังไม่บันทึกในเครื่อง: อ่านกลับได้ · ข้อมูลเสีย/ผิดรูปแบบ = ไม่กู้', () => {
  const draft = { views: [{ view: 'front', path: 'SC-1/sheet/a.png', width: 10, height: 20 }], specs: [], callouts: [{ key: 'a', x: 0.1, y: 0.2 }] }
  expect(parseUnsaved(JSON.stringify(draft))?.callouts).toHaveLength(1)
  expect(parseUnsaved(null)).toBeNull()
  expect(parseUnsaved('{oops')).toBeNull()
  expect(parseUnsaved(JSON.stringify({ views: [{ path: 'x', width: 0, height: 1 }], specs: [], callouts: [] }))).toBeNull()
  expect(parseUnsaved(JSON.stringify({ views: [], specs: [] }))).toBeNull()
  expect(unsavedKey('s1', 3)).not.toBe(unsavedKey('s1', 4))
})

it('การ์ดงานรู้ว่าสถานีไหนรับทราบสเปกฉบับที่ใช้ผลิตแล้ว', () => {
  const jobs = [{ id: 'j1' }, { id: 'j2' }] as Job[]
  const out = attachSpecSheets(jobs, [{ id: 's2', job_id: 'j1', rev: 2 }],
    [{ sheet_id: 's2', station_code: 'print' }, { sheet_id: 's2', station_code: 'print' }, { sheet_id: 's1', station_code: 'cut' }, { sheet_id: 's2', station_code: 'laser' }])
  expect(out[0]!.specSheet).toEqual({ id: 's2', rev: 2, acked: ['print'] })
  expect(out[1]).toBe(jobs[1])
})
