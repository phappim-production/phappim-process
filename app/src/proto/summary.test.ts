import { expect, it } from 'vitest'
import { roleSummary } from './summary'
import type { Job } from './model'

const now = new Date(2026, 10, 17, 10)
const yesterday = new Date(2026, 10, 16, 10)
const job: Job = {
  id: 'j1', no: 'SC-1', customer: 'ลูกค้าทดสอบ', product: 'เสื้อยืด',
  unit: 'ตัว', qty: 80, due: now, since: yesterday,
  route: 'plain', phase: 'production', station: 'cut', status: 'queued',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}

it('งานที่ทั้งพักและเลยกำหนดนับเป็นงานด่วนเพียงครั้งเดียว', () => {
  const jobs: Job[] = [
    { ...job, due: yesterday, status: 'hold' },
    { ...job, id: 'overdue', due: yesterday },
    { ...job, id: 'done', due: yesterday, phase: 'done', status: 'hold' },
  ]

  const urgent = roleSummary('factory', jobs, jobs, [], now).find(tile => tile.key === 'urgent')

  expect(urgent).toMatchObject({ value: 2, note: 'พักงาน 1 · เลยกำหนด 1' })
})

it('ผลรวม QC นับจำนวนชิ้นจากงานใน QC และไม่นับยอดของงานเสร็จ', () => {
  const jobs: Job[] = [
    { ...job, station: 'qc_pack', qty: 20 },
    { ...job, id: 'qc2', station: 'qc_pack', qty: 35 },
    { ...job, id: 'done', station: 'qc_pack', phase: 'done', doneAt: now },
  ]

  const tiles = roleSummary('qc', jobs, jobs, [], now)

  expect(tiles.find(tile => tile.key === 'qc')).toMatchObject({ value: 2, note: '55 ชิ้น' })
  expect(tiles.find(tile => tile.key === 'done')?.value).toBe(1)
})

it('งานแก้ที่อยู่นอกขอบเขต QC ยังอยู่ในยอดงานแก้ แต่ตัดงานแก้ที่เสร็จแล้วออก', () => {
  const rework = { qty: 5, reason: 'แก้ขนาด' }
  const jobs: Job[] = [
    { ...job, rework },
    { ...job, id: 'done', phase: 'done', doneAt: yesterday, rework },
  ]

  const tiles = roleSummary('qc', [], jobs, [], now)

  expect(tiles.find(tile => tile.key === 'rework')?.value).toBe(1)
  expect(tiles.find(tile => tile.key === 'done')?.value).toBe(0)
})

it('ฝ่ายผลิตนับเฉพาะวัตถุดิบที่ยังรอการยืนยันของฝ่ายผลิต', () => {
  const jobs: Job[] = [
    { ...job, phase: 'materials', materials: { ...job.materials, production: false } },
    { ...job, id: 'waiting-qc', phase: 'materials', materials: { ...job.materials, qc: false } },
    { ...job, id: 'cutting', materials: { ...job.materials, production: false } },
  ]

  const materials = roleSummary('production', jobs, jobs, [], now).find(tile => tile.key === 'materials')

  expect(materials).toMatchObject({ value: 1, tab: 'todo' })
})
