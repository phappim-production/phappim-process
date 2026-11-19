import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SewingNow, type SewActions } from '../pages/SewingNow'
import { SewingFloor } from '../pages/WorkPanels'
import { type Job } from './model'
import { blockerSummary, machineCounts, pausesJob, type Booking, type Machine, type MachineType, type Need } from './sewing'

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
const machines = [
  m('SN-002', 'single', { jobId: 'a' }),
  m('SN-001', 'single'),
  m('SN-006', 'single'),
  m('SN-003', 'single', { jobId: 'b' }),
  m('SN-004', 'single', { status: 'broken' }),
  m('BD-001', 'binding'),
  m('OL4-001', 'ovl4'),
  m('CV-001', 'cover'),
]
const row = (rows: ReturnType<typeof machineCounts>, type: MachineType) => {
  const r = rows.find(x => x.type === type)
  if (!r) throw new Error('ไม่มีแถว ' + type)
  return r
}

describe('machineCounts (จัดจักรแบบตั้งจำนวน)', () => {
  it('แสดงเป็นจำนวนต่อชนิด พร้อมรหัสที่ใช้อยู่และจำนวนตัวว่าง', () => {
    const r = row(machineCounts(job('a'), machines, needs, shared, [], now), 'single')
    expect([r.have, r.codes, r.need, r.free, r.base]).toEqual([1, ['SN-002'], 1, 2, true])
  })

  it('ไม่มีจักรใช้ร่วมในรายการ (ทุกไลน์ใช้ร่วมอยู่แล้ว)', () => {
    const types = machineCounts(job('a'), machines, needs, shared, [], now).map(r => r.type)
    expect(types).toEqual(['single', 'binding'])
  })

  it('ชนิดที่สินค้าไม่ได้ใช้ = ซ่อนไว้ใต้ "ชนิดอื่น" แต่เพิ่มได้ (จักรผูกกับสเปกลูกค้า)', () => {
    const r = row(machineCounts(job('a'), machines, needs, shared, [], now), 'binding')
    expect([r.base, r.have, r.free, r.plusBlocked]).toEqual([false, 0, 1, undefined])
    expect(r.minusBlocked).toBe('ยังไม่มีจักรชนิดนี้')
  })

  it('กำลังเย็บ เหลือขั้นต่ำ = ปุ่ม − กดไม่ได้ พร้อมเหตุผล', () => {
    const r = row(machineCounts(job('a'), machines, needs, shared, [], now), 'single')
    expect(r.minusBlocked).toMatch(/ระหว่างเย็บต้องมีเข็มเดี่ยวอย่างน้อย 1 ตัว.*พักงานก่อน/)
  })

  it('มีเกินขั้นต่ำ = ปุ่ม − กดได้', () => {
    const more = machines.map(x => x.code === 'SN-001' ? { ...x, jobId: 'a' } : x)
    expect(row(machineCounts(job('a'), more, needs, shared, [], now), 'single').minusBlocked).toBeUndefined()
  })

  it('งานพัก ลดเหลือ 0 ได้ (เย็บต่อแล้วระบบจ่ายที่ขาดให้)', () => {
    expect(row(machineCounts(job('a', { status: 'hold' }), machines, needs, shared, [], now), 'single').minusBlocked).toBeUndefined()
  })

  it('ไม่มีตัวว่าง = ปุ่ม + กดไม่ได้ และบอกว่าตัวอื่นติดอะไร', () => {
    const full = machines.map(x => x.code === 'SN-001' || x.code === 'SN-006' ? { ...x, jobId: 'b' } : x)
    expect(row(machineCounts(job('a'), full, needs, shared, [], now), 'single').plusBlocked)
      .toBe('ไม่มีเข็มเดี่ยวว่าง (ใช้กับงานอื่น 3 · เสีย/ปิด 1)')
  })

  it('จักรที่งานอื่นจองช่วงนี้ไม่นับเป็นตัวว่าง · จองให้งานนี้เองนับ', () => {
    const hour = 3_600_000
    const other: Booking[] = [{ id: '1', machineId: 'SN-001', jobId: 'c', starts: new Date(now.getTime() - hour), ends: new Date(now.getTime() + hour) }]
    expect(row(machineCounts(job('a'), machines, needs, shared, other, now), 'single').free).toBe(1)
    const own: Booking[] = [{ ...other[0], jobId: 'a' }]
    expect(row(machineCounts(job('a'), machines, needs, shared, own, now), 'single').free).toBe(2)
  })
})

describe('ปุ่มบนหน้าจอ', () => {
  const ok = async () => ({ ok: true as const, text: '' })
  const actions: SewActions = { report: ok, resume: ok, finish: ok, setCount: ok }
  const sewing = (a?: SewActions, status: Job['status'] = 'doing') => renderToStaticMarkup(createElement(SewingNow, {
    jobs: [job('a', { status })], machines, now, onOpen: () => {}, actions: a,
  }))

  it('ฝ่ายผลิตเห็นปุ่มจัดการจักรทั้งงานที่กำลังเย็บและงานพัก · ดูอย่างเดียวไม่เห็น', () => {
    expect(sewing(actions)).toContain('จัดการจักร')
    expect(sewing(actions, 'hold')).toContain('จัดการจักร')
    expect(sewing(undefined)).not.toContain('จัดการจักร')
  })

  it('งานรอเย็บมีปุ่ม − / + เลือกจำนวนก่อนเริ่ม ค่าเริ่มต้นตามสินค้า', () => {
    const html = renderToStaticMarkup(createElement(SewingFloor, {
      jobs: [job('q', { status: 'queued' })], machines, needs: { tshirt: needs }, shared, now, onOpen: () => {},
      onStart: async () => ({ ok: true as const, picked: [] }),
    }))
    expect(html).toContain('aria-label="เพิ่มเข็มเดี่ยว"')
    expect(html).toContain('ว่าง 2 ตัว')
    expect(html).toContain('เริ่มเย็บ')
  })
})

describe('pausesJob (จักรเสียแล้วงานต้องพักไหม)', () => {
  const needsMap = { tshirt: needs }
  it('งานมีเข็มเดี่ยวตัวเดียว เสีย = พักงาน', () => {
    expect(pausesJob(machines[0], machines, job('a'), needsMap)).toBe(true)
  })
  it('งานมีเข็มเดี่ยว 2 ตัว เสีย 1 = ไม่พัก เย็บต่อได้', () => {
    const two = machines.map(x => x.code === 'SN-001' ? { ...x, jobId: 'a' } : x)
    expect(pausesJob(two[0], two, job('a'), needsMap)).toBe(false)
  })
  it('งานพักอยู่แล้ว หรือจักรว่าง = ไม่มีงานให้พัก', () => {
    expect(pausesJob(machines[0], machines, job('a', { status: 'hold' }), needsMap)).toBe(false)
    expect(pausesJob(machines[1], machines, undefined, needsMap)).toBe(false)
  })
})

describe('blockerSummary (เหตุผลบนการ์ดรอเย็บ)', () => {
  it('สรุปเป็นจำนวน · จักรเสีย/ปิดบอกรหัส', () => {
    expect(blockerSummary([
      { code: 'SN-001', state: 'busy', jobId: 'a' }, { code: 'SN-002', state: 'busy', jobId: 'b' },
      { code: 'SN-003', state: 'booked', jobId: 'c' }, { code: 'SN-004', state: 'broken' }, { code: 'SN-005', state: 'off' },
    ])).toBe('ใช้กับงานอื่น 2 ตัว · จองไว้ให้งานอื่น 1 ตัว · SN-004 เสีย, SN-005 ปิด')
  })
})
