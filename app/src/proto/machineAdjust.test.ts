import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SewingNow, type SewActions } from '../pages/SewingNow'
import { type Job } from './model'
import { machineAdjust, type Booking, type Machine, type MachineType, type Need } from './sewing'

const now = new Date('2026-11-21T03:00:00Z')
const job = (id: string, fields: Partial<Job> = {}): Job => ({
  id, no: 'TEST-M-' + id, customer: 'ลูกค้าจำลอง', product: 'เสื้อยืด',
  productCode: 'tshirt', unit: 'ตัว', qty: 300, due: new Date('2026-12-31T10:00:00Z'),
  route: 'normal', phase: 'production', station: 'sew', status: 'doing', since: now,
  sampleRound: 1, materials: { admin: true, production: true, qc: true }, ...fields,
})
const m = (code: string, type: MachineType, fields: Partial<Machine> = {}): Machine =>
  ({ id: code, code, type, status: 'ready', ...fields })
const shared: MachineType[] = ['ovl4', 'cover', 'button', 'buttonhole']
const needs: Need[] = [{ type: 'single', qty: 1 }]   // toNeeds ตัดจักรใช้ร่วมออกแล้ว
const noOf = (id: string) => 'TEST-M-' + id

describe('machineAdjust (จัดจักรระหว่างเย็บ)', () => {
  const machines = [
    m('SN-002', 'single', { jobId: 'a' }),
    m('SN-001', 'single'),
    m('SN-003', 'single', { jobId: 'b' }),
    m('SN-004', 'single', { status: 'broken' }),
    m('SN-005', 'single', { status: 'off' }),
    m('BD-001', 'binding'),
    m('OL4-001', 'ovl4'),
    m('CV-001', 'cover'),
  ]

  it('กำลังเย็บ เหลือจักรเดี่ยวตัวเดียว = คืนไม่ได้ พร้อมเหตุผล', () => {
    const { mine } = machineAdjust(job('a'), machines, needs, shared, [], now, noOf)
    expect(mine.map(x => x.machine.code)).toEqual(['SN-002'])
    expect(mine[0].blocked).toMatch(/ต้องเหลือเข็มเดี่ยวอย่างน้อย 1 ตัว.*พักงานก่อน/)
  })

  it('เพิ่มแล้วมีเกินชุด = คืนตัวไหนก็ได้ (เหลือครบชุด)', () => {
    const more = machines.map(x => x.code === 'SN-001' ? { ...x, jobId: 'a' } : x)
    const { mine } = machineAdjust(job('a'), more, needs, shared, [], now, noOf)
    expect(mine.map(x => [x.machine.code, x.blocked])).toEqual([['SN-001', undefined], ['SN-002', undefined]])
  })

  it('งานพักอยู่ คืนได้หมด (กดเย็บต่อแล้วระบบจ่ายที่ขาดให้)', () => {
    const { mine } = machineAdjust(job('a', { status: 'hold' }), machines, needs, shared, [], now, noOf)
    expect(mine[0].blocked).toBeUndefined()
  })

  it('จักรว่าง: เฉพาะจักรประจำไลน์ที่ใช้ได้และไม่มีงาน · ไม่จำกัดตามสูตรสินค้า · ไม่มีจักรใช้ร่วม', () => {
    const { free } = machineAdjust(job('a'), machines, needs, shared, [], now, noOf)
    // จักรผูกกับสเปกที่ลูกค้าสั่ง: เข้าขอบไม่อยู่ในสูตรเสื้อยืด แต่ฝ่ายผลิตเพิ่มได้
    expect(free.map(x => x.machine.code)).toEqual(['BD-001', 'SN-001'])
  })

  it('จักรที่งานอื่นจองช่วงนี้ไว้ = ติ๊กไม่ได้ และบอกว่าจองให้งานไหน', () => {
    const bookings: Booking[] = [
      { id: '1', machineId: 'SN-001', jobId: 'c', starts: new Date(now.getTime() - 3_600_000), ends: new Date(now.getTime() + 3_600_000) },
    ]
    const { free } = machineAdjust(job('a'), machines, needs, shared, bookings, now, noOf)
    expect(free.find(x => x.machine.code === 'SN-001')?.blocked).toBe('จองให้ TEST-M-c อยู่')
  })

  it('จองไว้ให้งานนี้เอง = เพิ่มได้', () => {
    const bookings: Booking[] = [
      { id: '1', machineId: 'SN-001', jobId: 'a', starts: new Date(now.getTime() - 3_600_000), ends: new Date(now.getTime() + 3_600_000) },
    ]
    const { free } = machineAdjust(job('a'), machines, needs, shared, bookings, now, noOf)
    expect(free.find(x => x.machine.code === 'SN-001')?.blocked).toBeUndefined()
  })
})

describe('ปุ่มจัดจักรในงานระหว่างเย็บ', () => {
  const ok = async () => ({ ok: true as const, text: '' })
  const actions: SewActions = { report: ok, resume: ok, finish: ok, assign: ok, release: ok }
  const render = (a?: SewActions, status: Job['status'] = 'doing') => renderToStaticMarkup(createElement(SewingNow, {
    jobs: [job('a', { status })], machines: [m('SN-002', 'single', { jobId: 'a' })], now, onOpen: () => {}, actions: a,
  }))

  it('ฝ่ายผลิตเห็นปุ่มจัดจักรทั้งงานที่กำลังเย็บและงานพัก', () => {
    expect(render(actions)).toContain('จัดจักร')
    expect(render(actions, 'hold')).toContain('จัดจักร')
  })

  it('บทบาทที่ดูอย่างเดียวไม่เห็นปุ่มจัดจักร', () => {
    expect(render(undefined)).not.toContain('จัดจักร')
  })
})
