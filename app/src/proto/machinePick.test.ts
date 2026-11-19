import { expect, it } from 'vitest'
import type { Job } from './model'
import type { Machine } from './sewing'
import { MACHINE_TYPE_NAME } from './sewing'
import { defaultPick, pickGroups, pickProblems } from './machinePick'

const now = new Date(2026, 10, 19, 10)
const job = { id: 'J', station: 'sew', phase: 'production', status: 'queued' } as Job
const m = (code: string, type: Machine['type'], over: Partial<Machine> = {}): Machine => ({ id: code, code, type, status: 'ready', ...over })
const machines = [
  m('SN-002', 'single'), m('SN-001', 'single', { jobId: 'OTHER' }), m('SN-003', 'single', { status: 'broken' }),
  m('SN-004', 'single'), m('OL4-001', 'ovl4'), m('CV-001', 'cover'),
]

it('จัดกล่องจักรตามรหัสจริง เรียงรหัส · บอกว่าว่าง / งานอื่นใช้ / เสีย · จักรใช้ร่วมไม่ต้องเลือก', () => {
  const groups = pickGroups(job, machines, [{ type: 'single', qty: 1 }, { type: 'ovl4', qty: 2 }], ['ovl4', 'cover'], [], now)
  expect(groups.map(g => g.type)).toEqual(['single'])
  expect(groups[0].tiles.map(t => `${t.code}:${t.state}`)).toEqual(['SN-001:busy', 'SN-002:free', 'SN-003:broken', 'SN-004:free'])
})

it('จักรที่จองให้งานอื่นเลือกไม่ได้ · จักรของงานนี้ขึ้นว่าเป็นของงานนี้', () => {
  const groups = pickGroups({ ...job, status: 'doing' }, [m('SN-001', 'single', { jobId: 'J' }), m('SN-002', 'single')], [{ type: 'single', qty: 1 }], [],
    [{ id: 'b', machineId: 'SN-002', jobId: 'K', starts: new Date(now.getTime() - 1000), ends: new Date(now.getTime() + 3_600_000) }], now)
  expect(groups[0].tiles.map(t => t.state)).toEqual(['mine', 'booked'])
})

it('ค่าเริ่มต้นเลือกตัวว่างเท่าที่สินค้าต้องใช้ · เลือกไม่ครบบอกว่าขาดอะไร', () => {
  const groups = pickGroups(job, machines, [{ type: 'single', qty: 2 }], ['ovl4', 'cover'], [], now)
  expect(defaultPick(groups)).toEqual(['SN-002', 'SN-004'])
  expect(pickProblems(groups, ['SN-002'], MACHINE_TYPE_NAME)).toEqual([`เลือก${MACHINE_TYPE_NAME.single} 1/2 ตัว`])
  expect(pickProblems(groups, ['SN-002', 'SN-004'], MACHINE_TYPE_NAME)).toEqual([])
})
