import { expect, it } from 'vitest'
import type { Job } from './model'
import { machineUse, toStationMachines } from './machines'

let n = 0
const job = (over: Partial<Job>): Job => ({
  id: `j${++n}`, no: `SC-${n}`, customer: 'ลูกค้า', product: 'เสื้อ', unit: 'ตัว', qty: 10, due: new Date(2026, 11, 1),
  route: 'normal', phase: 'production', station: 'print', status: 'doing', since: new Date(2026, 10, 19), sampleRound: 1,
  materials: { admin: true, qc: true, production: true }, ...over,
})
const cfg = toStationMachines([
  { code: 'print', machines: 2, machine_pool: 'print' },
  { code: 'press', machines: 1, machine_pool: 'heat_press' },
  { code: 'dtf_press', machines: 1, machine_pool: 'heat_press' },
  { code: 'emb', machines: null, machine_pool: null },
])

it('นับเฉพาะงานกำลังทำ · งานพักและงานข้างนอกไม่ใช้เครื่อง', () => {
  const use = machineUse([job({}), job({ status: 'hold' }), job({ status: 'out' }), job({ status: 'queued' })], cfg, 'print')
  expect(use).toMatchObject({ total: 2, full: false })
  expect(use!.used).toHaveLength(1)
  expect(machineUse([job({}), job({})], cfg, 'print')!.full).toBe(true)
})

it('รีดกับรีดฟิล์มใช้เครื่องรีดร้อนตัวเดียวกัน', () => {
  const use = machineUse([job({ route: 'dtf', station: 'dtf_press' })], cfg, 'press')!
  expect(use.full).toBe(true)
  expect(use.used[0].station).toBe('dtf_press')
})

it('สถานีไม่จำกัดเครื่อง หรือไม่มีข้อมูล = ไม่ตรวจ', () => {
  expect(machineUse([job({ station: 'emb' })], cfg, 'emb')).toBeNull()
  expect(machineUse([], cfg, 'cut')).toBeNull()
})
