import { describe, expect, it } from 'vitest'
import { canOpenPage, type EmployeeRole } from '../auth/access'
import { bottomBar, roleMenu, routeOf, ROUTES } from '../auth/menus'
import { machineUse, toStationMachines } from './machines'
import { defaultPick, pickGroups, pickProblems } from './machinePick'
import { MACHINE_TYPE_NAME, type Booking, type Machine } from './sewing'
import type { Job } from './model'

const manager = [
  ['#/', 'ภาพรวมการผลิต'], ['#/jobs', 'ใบงานทั้งหมด'], ['#/board', 'ทุก Station'],
  ['#/reports', 'รายงาน'], ['#/reviews', 'รายการรออนุมัติ'],
]
const production = [
  ['#/dept', 'ภาพรวมแผนก'], ['#/queue', 'คิวงาน'], ['#/board', 'Station ที่ดูแล'],
  ['#/issues', 'ปัญหา / งานแก้'], ['#/reports', 'รายงานแผนก'],
]
const staff = [
  ['#/mine', 'งานของฉัน'], ['#/board', 'คิวงาน Station'], ['#/history', 'ประวัติการทำงาน'], ['#/report', 'แจ้งปัญหา'],
]
const menus: Record<EmployeeRole, string[][]> = {
  owner: [
    ['#/admin', 'ภาพรวมระบบ'], ['#/users', 'ผู้ใช้งาน'], ['#/roles', 'Roles & Permissions'],
    ['#/assign', 'Station Assignment'], ['#/audit', 'Audit Log'], ['#/settings', 'ตั้งค่าระบบ'],
    ['#/production', 'ภาพรวมการผลิต'], ['#/board', 'ทุก Station'], ['#/reports', 'รายงาน'],
  ],
  admin: [
    ['#/', 'ภาพรวมใบงาน'], ['#/jobs', 'จัดการใบงาน'], ['#/production-queue', 'คิวการผลิต'],
    ['#/board', 'ติดตาม Station'], ['#/reports', 'รายงาน'],
  ],
  manager, production, supervisor: production, staff, qc: staff,
}

describe('เมนูตามบทบาท', () => {
  it.each(Object.entries(menus) as [EmployeeRole, string[][]][])('%s มีเมนูตามแบบและเปิดได้ทุกลิงก์', (role, expected) => {
    const menu = roleMenu(role)
    const items = menu.flatMap(group => group.items)
    expect(items.map(({ hash, name }) => [hash, name])).toEqual([...expected, ['#/inbox', 'กล่องจดหมาย']])
    for (const item of items) {
      expect(ROUTES).toHaveProperty([item.hash])
      expect(canOpenPage(role, routeOf(item.hash).page)).toBe(true)
      if (item.hash === '#/inbox') continue
      const mobile = bottomBar(menu, item.hash)
      expect(mobile.shown.map(x => x.hash)).toContain(item.hash)
      expect(new Set([...mobile.shown, ...mobile.more].map(x => x.hash)).size).toBe(expected.length)
    }
    expect(canOpenPage(role, 'label')).toBe(true)
    expect(canOpenPage(role, 'settings')).toBe(role === 'owner')
    expect(canOpenPage(role, 'reviews')).toBe(role === 'manager' || role === 'owner')
  })
})

const now = new Date('2026-11-19T04:00:00Z')
function job(id: string, changes: Partial<Job> = {}): Job {
  return {
    id, no: 'TEST-R9-' + id, customer: 'ลูกค้าจำลอง', product: 'เสื้อยืด', productCode: 'tshirt',
    unit: 'ตัว', qty: 10, due: now, route: 'normal', phase: 'production', station: 'print',
    status: 'doing', since: now, sampleRound: 1, materials: { admin: true, production: true, qc: true },
    ...changes,
  }
}

describe('จำนวนเครื่องต่อสถานี', () => {
  const config = toStationMachines([
    { code: 'print', machines: 2, machine_pool: null },
    { code: 'press', machines: 1, machine_pool: 'heat_press' },
    { code: 'cut', machines: 2, machine_pool: null },
    { code: 'dtf_press', machines: 2, machine_pool: 'dtf_press' },
    { code: 'emb', machines: null, machine_pool: null },
    { code: 'sew', machines: null, machine_pool: null },
    { code: 'qc_pack', machines: 1, machine_pool: null },
  ])

  it.each([['print', 2], ['press', 1], ['cut', 2], ['dtf_press', 2], ['qc_pack', 1]] as const)(
    '%s นับงานผลิตและตัวอย่างที่กำลังทำถึงเพดาน %s', (station, total) => {
      const busy = Array.from({ length: total }, (_, i) => job('busy-' + i, { station, phase: i === 0 ? 'sample' : 'production' }))
      const jobs = [...busy, job('hold', { station, status: 'hold' }), job('out', { station, status: 'out' }),
        job('queued', { station, status: 'queued' }), job('done', { station, phase: 'done' })]
      expect(machineUse(jobs, config, station)).toEqual({ used: busy, total, full: true })
      expect(machineUse(jobs.slice(1), config, station)?.full).toBe(false)
    },
  )

  it('รีดฟิล์มเต็มแล้วรีดยังว่าง และไม่ขึ้นเพดานที่ปักหรือเย็บ', () => {
    const film = ['1', '2'].map(id => job(id, { station: 'dtf_press' }))
    expect(machineUse(film, config, 'dtf_press')).toEqual({ used: film, total: 2, full: true })
    expect(machineUse(film, config, 'press')).toEqual({ used: [], total: 1, full: false })
    expect(machineUse(film, config, 'emb')).toBeNull()
    expect(machineUse(film, config, 'sew')).toBeNull()
  })
})

describe('ผังเลือกจักร', () => {
  const current = job('sew', { station: 'sew', status: 'queued' })
  const machines: Machine[] = [
    { id: 'free2', code: 'SN-006', type: 'single', status: 'ready' },
    { id: 'busy', code: 'SN-002', type: 'single', status: 'ready', jobId: 'other' },
    { id: 'broken', code: 'SN-003', type: 'single', status: 'broken' },
    { id: 'booked', code: 'SN-004', type: 'single', status: 'ready' },
    { id: 'free1', code: 'SN-005', type: 'single', status: 'ready' },
    { id: 'shared', code: 'OL4-001', type: 'ovl4', status: 'ready' },
    { id: 'unused', code: 'DN-001', type: 'double', status: 'ready' },
  ]
  const bookings: Booking[] = [{ id: '1', machineId: 'booked', jobId: 'other', starts: now, ends: new Date(now.getTime() + 3_600_000) }]
  const groups = pickGroups(current, machines, [{ type: 'single', qty: 2 }, { type: 'ovl4', qty: 1 }], ['ovl4'], bookings, now)

  it('เลือกตัวว่างตามลำดับรหัสและบอกสถานะของตัวที่เลือกไม่ได้', () => {
    expect(groups.map(g => g.type)).toEqual(['single'])
    expect(groups[0].tiles).toEqual([
      { code: 'SN-002', state: 'busy', jobId: 'other' },
      { code: 'SN-003', state: 'broken' },
      { code: 'SN-004', state: 'booked', jobId: 'other' },
      { code: 'SN-005', state: 'free' },
      { code: 'SN-006', state: 'free' },
    ])
    expect(defaultPick(groups)).toEqual(['SN-005', 'SN-006'])
    expect(pickProblems(groups, ['SN-005'], MACHINE_TYPE_NAME)).toEqual(['เลือกเข็มเดี่ยว 1/2 ตัว'])
    expect(pickProblems(groups, defaultPick(groups), MACHINE_TYPE_NAME)).toEqual([])
  })

  it('แสดงจักรเสริมที่งานถืออยู่สำหรับกดคืน', () => {
    const withExtra = machines.map(m => m.id === 'unused' ? { ...m, jobId: current.id } : m)
    const managed = pickGroups(current, withExtra, [{ type: 'single', qty: 1 }], [], bookings, now)
    expect(managed.find(group => group.type === 'double')).toEqual({
      type: 'double', need: 0, tiles: [{ code: 'DN-001', state: 'mine' }],
    })
  })
})
