import { expect, it } from 'vitest'
import { boardColumnOf, boardScope, jobInScope } from './scope'
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
  expect(none.sub).toMatch(/จับคู่สถานี/)
})

it('งานขึ้นตัวอย่างเข้าขอบเขตพนักงานสถานีเฉพาะเมื่ออยู่สถานีที่จับคู่ และแสดงในคอลัมน์สถานีนั้น', () => {
  const staff = boardScope('staff', null, ['cut', 'print'])
  const atCut: Job = { ...job, phase: 'sample', station: 'cut', status: 'queued' }
  const atSew: Job = { ...job, phase: 'sample', station: 'sew', status: 'queued' }

  expect(jobInScope(atCut, staff)).toBe(true)
  expect(boardColumnOf(atCut, staff)).toBe('cut')
  expect(jobInScope(atSew, staff)).toBe(false)
  expect(jobInScope({ ...job, phase: 'sample' }, staff)).toBe(false)
  expect(jobInScope(atCut, boardScope('staff', null, []))).toBe(false)
})

it('งานขึ้นตัวอย่างเข้าขอบเขต QC เฉพาะเมื่อถึงสถานี QC + Packing', () => {
  const qc = boardScope('qc', null)
  const atQc: Job = { ...job, phase: 'sample', station: 'qc_pack', status: 'queued' }

  expect(jobInScope(atQc, qc)).toBe(true)
  expect(boardColumnOf(atQc, qc)).toBe('qc_pack')
  expect(jobInScope({ ...job, phase: 'sample', station: 'cut', status: 'doing' }, qc)).toBe(false)
})

it('บทบาทที่มีคอลัมน์ขึ้นตัวอย่างยังเห็นงานตัวอย่างในคอลัมน์เดิม', () => {
  const atCut: Job = { ...job, phase: 'sample', station: 'cut', status: 'queued' }

  expect(boardColumnOf(atCut, boardScope('production', null))).toBe('sample')
  expect(boardColumnOf(atCut, boardScope('supervisor', 1))).toBe('sample')
  expect(jobInScope(atCut, boardScope('supervisor', 2))).toBe(false)
  expect(boardColumnOf({ ...job, station: 'cut' }, boardScope('staff', null, ['cut']))).toBe('cut')
})
