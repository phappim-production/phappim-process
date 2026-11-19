import { expect, it } from 'vitest'
import { boardScope, jobInScope } from './scope'
import type { Job } from '../proto/model'

const date = new Date(2026, 10, 17)
const job: Job = {
  id: 'j1', no: 'SC-1', customer: 'ลูกค้าทดสอบ', product: 'เสื้อยืด',
  unit: 'ตัว', qty: 80, due: date, since: date,
  route: 'dtf', phase: 'production',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}

it('งานผลิตที่ไม่มีสถานีเข้าขอบเขตตามสถานีแรกของเส้นทาง', () => {
  expect(jobInScope(job, boardScope('supervisor', 1))).toBe(true)
  expect(jobInScope(job, boardScope('supervisor', 2))).toBe(false)
})

it('ตัวอย่างที่ยังไม่มีสถานีไม่เข้าบอร์ดผู้ควบคุมรายเฟส', () => {
  const sample: Job = { ...job, phase: 'sample' }

  expect(jobInScope(sample, boardScope('supervisor', 1))).toBe(false)
  expect(jobInScope(sample, boardScope('supervisor', 2))).toBe(false)
  expect(jobInScope(sample, boardScope('production', null))).toBe(true)
})

it('งานรอยืนยันตัวอย่างยังไม่เข้าคิว QC แม้ข้อมูลมีสถานี QC ค้างอยู่', () => {
  const review: Job = { ...job, phase: 'sample_review', station: 'qc_pack' }

  expect(jobInScope(review, boardScope('qc', null))).toBe(false)
})

it('แยกของที่ QC ตรวจแล้วออก แม้จะยังรอวัตถุดิบของฝ่ายผลิต', () => {
  const materials: Job = { ...job, phase: 'materials', materials: { ...job.materials, production: false } }

  expect(jobInScope(materials, boardScope('qc', null))).toBe(false)
  expect(jobInScope(materials, boardScope('production', null))).toBe(true)
})

it('การเปิดมุมมองเจ้าของไม่เพิ่มสิทธิ์ให้มุมมองผู้บริหาร', () => {
  const owner = boardScope('owner', null)

  expect(owner).toMatchObject({ canSew: true, canReportMachines: true, canSetRepairEta: true })
  const manager = boardScope('manager', null)
  expect(manager).toMatchObject({ canSew: false, canReportMachines: false })
  expect(manager.canSetRepairEta).toBeFalsy()
})

it('พนักงานสถานีเห็นและกดได้เฉพาะสถานีที่จับคู่ · ยังไม่จับคู่ = ไม่มีคอลัมน์และบอกให้ไปจับคู่', () => {
  const s = boardScope('staff', null, ['cut', 'print'])
  expect(s.columns).toEqual(['print', 'cut'])
  expect(s.pressStations).toEqual(['print', 'cut'])
  expect(s.canSew).toBe(false)
  const none = boardScope('staff', null, [])
  expect(none.columns).toEqual([])
  expect(none.sub).toMatch(/Station Assignment/)
})
