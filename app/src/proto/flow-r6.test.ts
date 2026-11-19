
import { createElement, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canCloseIssue, type EmployeeRole, type Section } from '../auth/access'
import { boardScope, homePage } from '../auth/scope'
import { OUTBOX_KEY, TAKEN_KEY, recentlyTaken, takeOutbox } from '../data/confirmationDrafts'
import { attachSla, type SlaFlagRow } from '../data/live'
import type { FactoryData } from '../data/useFactoryData'
import Dashboard from '../pages/Dashboard'
import { JobActions } from '../pages/JobActions'
import { StationQueue } from '../pages/StationQueue'
import { nextAction } from './actions'
import { slaAmount } from './format'
import { type Job, type StationCode } from './model'
import { planSewing, sewQueue, type Machine, type Need } from './sewing'

vi.mock('../lib/supabase', () => ({ supabase: null, isConfigured: false }))
vi.mock('../data/useFactoryData', async importOriginal => ({
  ...await importOriginal<typeof import('../data/useFactoryData')>(),
  useFactoryData: () => ({
    state: { status: 'ready', data: factory, loadedAt: now },
    live: true,
    refresh,
  }),
}))

vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useState: vi.fn(react.useState) }
})

const roles: EmployeeRole[] = ['owner', 'supervisor', 'admin', 'production', 'qc', 'manager']
const stations: StationCode[] = ['print', 'press', 'cut', 'dtf_press', 'emb', 'sew', 'qc_pack']
const now = new Date('2026-11-18T03:00:00Z')
const refresh = async () => {}
const open = () => {}
const job = (id: string, fields: Partial<Job> = {}): Job => ({
  id, no: 'TEST-R6-' + id, customer: 'ลูกค้าจำลอง', product: 'เสื้อทดสอบ',
  productCode: 'tshirt', unit: 'ตัว', qty: 10, due: new Date('2026-12-31T10:00:00Z'),
  route: 'normal', phase: 'production', station: 'cut', status: 'doing', since: now,
  sampleRound: 1, materials: { admin: true, production: true, qc: true }, ...fields,
})
const factory: FactoryData = { jobs: [], products: [], needs: {}, shared: [], vendors: [], machines: [], bookings: [], stationMachines: [] }
const flag = (id: string, patch: Partial<SlaFlagRow> = {}): SlaFlagRow =>
  ({ job_id: id, warn: false, over: false, need_report: false, ...patch })

afterEach(() => {
  factory.jobs = []
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function queueView(item: Job, role: EmployeeRole) {
  if (!item.station) throw new Error('ไม่ได้ระบุสถานีสำหรับทดสอบ')
  return renderToStaticMarkup(createElement(StationQueue, {
    station: item.station, jobs: [item], role, now, call: async () => ({ ok: true as const }), onOpen: open,
  }))
}

function dashboardView(view: 'board' | 'overview', role: EmployeeRole, jobs: Job[]) {
  factory.jobs = jobs
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  vi.stubGlobal('window', { location: { hash: '' } })
  return renderToStaticMarkup(createElement(Dashboard, { view, role, today: '', scope: boardScope(role, null) }))
}

function actionsView(item: Job, role: EmployeeRole) {
  const shape = [item.id, item.phase, item.station, item.status, '', item.sampleRound].join('/')
  // SSR ไม่ทำ useEffect จึงใส่ผลโหลดจำลองเฉพาะ state รายละเอียดตัวแรกของ JobActions
  vi.mocked(useState).mockReturnValueOnce([{
    shape,
    data: { qcPassed: 0, sla: {}, filmOrdered: false, pdfPath: null, materials: [], steps: [], done: new Map(), reasons: [] },
  }, () => {}])
  return renderToStaticMarkup(createElement(JobActions, { job: item, role, version: 1, now, refresh }))
}

describe('R6 สิทธิ์แก้แล้วทำต่อ', () => {
  it.each(roles)('%s: canCloseIssue ครบทุกสถานีและสถานีที่ไม่ระบุ', role => {
    const allowed = role === 'owner' || role === 'production' || role === 'supervisor'
    for (const station of [...stations, null, undefined]) {
      expect(canCloseIssue(role, station), station ?? 'ไม่ระบุสถานี').toBe(allowed || (role === 'manager' && station !== 'sew'))
    }
  })

  it.each(roles)('%s: ปุ่มและข้อความสถานีทั่วไป, QC, เย็บ และขึ้นตัวอย่าง', role => {
    const floor = role === 'owner' || role === 'production' || role === 'supervisor'
    const canResume = floor || role === 'manager'
    for (const [station, phase] of [['cut', 'production'], ['qc_pack', 'production'], ['cut', 'sample'], ['sew', 'production']] as const) {
      const held = job(station, { station, phase, status: 'hold', holdReason: 'รอตรวจงาน' })
      const queue = queueView(held, role)
      const detail = actionsView(held, role)
      if (station === 'sew') {
        expect(queue.includes('แก้แล้ว เย็บต่อ</button>')).toBe(floor)
        expect(queue.includes('รอฝ่ายผลิตกด')).toBe(!floor)
        expect(detail).toContain('จักรเย็บ')
        expect(detail).not.toContain('แก้แล้ว ทำต่อ</button>')
      } else {
        for (const html of [queue, detail]) {
          expect(html.includes('แก้แล้ว ทำต่อ</button>'), station).toBe(canResume)
          expect(html.includes('รอผู้บริหารหรือฝ่ายผลิตกด'), station).toBe(!canResume)
        }
      }
    }
  })
})

describe('R6 SLA บนบอร์ดและคิว', () => {
  it('รีเฟรชธงทั้งชุด: ใส่ เปลี่ยน และล้างเฉพาะงานที่ต้องเปลี่ยน', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(id => job(id))
    const assigned = attachSla([a, b, c], [flag('a', { warn: true }), flag('b', { warn: true, over: true, need_report: true })])
    expect(assigned.map(j => j.sla)).toEqual(['warn', 'report', undefined])
    expect(assigned[2]).toBe(c)
    const updated = attachSla(assigned, [flag('b', { over: true }), flag('unused', { warn: true })])
    expect(updated.map(j => j.sla)).toEqual([undefined, 'over', undefined])
    expect(updated[0]).not.toHaveProperty('sla')
    expect(attachSla(updated, [flag('b')]).map(j => j.sla)).toEqual([undefined, undefined, undefined])
    expect([a, b, c].map(j => j.sla)).toEqual([undefined, undefined, undefined])
  })

  it.each([
    [undefined, 'info', 'กำลังทำตัดงาน'],
    ['warn', 'warn', 'ใกล้ครบเวลามาตรฐาน'],
    ['over', 'danger', 'เกินเวลามาตรฐาน (รายงานแล้ว)'],
    ['report', 'danger', 'ส่งรายงานปัญหาก่อนกดเสร็จ'],
  ] as const)('nextAction แสดง %s', (sla, tone, text) => {
    expect(nextAction(job('action', { sla }), now)).toMatchObject({ tone, text: expect.stringContaining(text) })
  })

  it.each([
    ['warn', 'border-l-warn', 'border-warn/50', 'bg-warn-soft', 'ใกล้ครบเวลามาตรฐาน'],
    ['over', 'border-l-danger', 'border-danger/40', 'bg-danger-soft', 'เกินเวลามาตรฐาน'],
    ['report', 'border-l-danger', 'border-danger/40', 'bg-danger-soft', 'เกินเวลา · ต้องรายงาน'],
  ] as const)('การ์ดบอร์ดและคิวแสดงสีและป้าย %s', (sla, stripe, border, pill, label) => {
    const item = job('colored', { sla })
    const board = dashboardView('board', 'production', [item])
    const queue = queueView(item, 'production')
    expect(board).toContain(stripe)
    expect(queue).toContain(border)
    for (const html of [board, queue]) expect(html).toMatch(new RegExp(pill + '[^>]*>.*?' + label, 's'))
  })

  it('เลยกำหนดส่งทำให้แถบการ์ดแดงและป้ายเตือน SLA ยังเป็นสีส้ม', () => {
    const html = dashboardView('board', 'production', [job('late-warn', { sla: 'warn', due: new Date('2026-11-16') })])
    expect(html).toContain('border-l-danger')
    expect(html).toMatch(/bg-warn-soft[^>]*>.*?ใกล้ครบเวลามาตรฐาน/s)
  })

  it.each(['admin', 'manager'] as const)('%s เห็นงานเกินเวลาและงานติดปัญหาในภาพรวม', role => {
    const html = dashboardView('overview', role, [
      job('SLA-REPORT', { sla: 'report' }), job('SLA-REPORTED', { sla: 'over' }),
      job('SLA-HOLD', { status: 'hold', sla: 'report', holdReason: 'รอหัวหน้าตรวจ' }),
      job('SLA-WARN', { sla: 'warn' }),
    ])
    const follow = html.split('งานที่ต้องตาม 3 งาน')[1]?.split('</ul>')[0] ?? ''
    expect(follow).toContain('เกินเวลามาตรฐาน')
    expect(follow).toContain('ยังไม่ส่งรายงานปัญหา')
    expect(follow).toContain('รายงานปัญหาแล้ว')
    expect(follow).toContain('ติดปัญหา · รอผู้บริหารแก้')
    expect(follow).not.toContain('TEST-R6-SLA-WARN')
  })
})

const outside = (id: string, station: StationCode, span: StationCode[]) => job(id, {
  station, status: 'out',
  out: { id: 1, vendorId: 1, vendor: 'บริษัทจำลอง', stations: span, qty: 10, rework: false,
    sentAt: now, arriveAt: now, leadDays: 2, backAt: new Date('2026-11-20T10:00:00Z') },
})
const machines: Machine[] = [{ id: '1', code: 'SN-001', type: 'single', status: 'ready' }]
const needs: Record<string, Need[]> = { tshirt: [{ type: 'single', qty: 1 }] }

describe('R6 คิวเย็บและงานข้างนอก', () => {
  it('ตัดงานเย็บนอกออกและเก็บงานตัดนอกที่สถานีถัดไปเข้าเย็บในโรงงาน', () => {
    const sendToSew = outside('out-sew', 'sew', ['sew'])
    const sendsThroughSew = outside('out-cut-sew', 'cut', ['cut', 'sew'])
    const sewingNext = outside('out-cut', 'cut', ['cut'])
    const returned = job('returned', { station: 'sew', status: 'queued' })
    const jobs = [sendToSew, sendsThroughSew, sewingNext, returned]
    expect(sewQueue(jobs, machines).map(r => r.job.id)).toEqual(['returned'])
    expect(sewQueue(jobs, machines, true).map(r => [r.job.id, r.source])).toEqual([['out-cut', 'coming'], ['returned', 'waiting']])
    expect(planSewing(jobs, machines, needs, now, true).rows.map(r => [r.job.id, r.verdict])).toEqual([
      ['returned', 'ready'], ['out-cut', 'wait'],
    ])
  })

  it('งานข้างนอกทำพิมพ์ถึงตัดแล้วกลับมาเย็บ อยู่ในแผนเครื่องจักร (แก้แล้ว)', () => {
    const pending = outside('out-print-cut', 'print', ['print', 'press', 'cut'])
    expect(planSewing([pending], machines, needs, now, true).rows.map(r => [r.job.id, r.source])).toEqual([
      ['out-print-cut', 'coming'],
    ])
  })
})

function storage(initial: [string, string][] = []) {
  const entries = new Map(initial)
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
  }
}

describe('R6 ใบยืนยันข้ามแท็บและหน่วย SLA', () => {
  const time = now.getTime()

  it('ใบแรกถูกหยิบครั้งเดียว เวลาเครื่องย้อนและครบ 2 นาทีไม่ใช้สถานะเก่า', () => {
    const doc = { h: { doc_no: ' TEST-R6-A ' } }
    const store = storage([[OUTBOX_KEY, JSON.stringify(doc)]])
    expect(takeOutbox(store, time)).toEqual({ data: doc, no: 'TEST-R6-A' })
    expect(takeOutbox(store, time + 1)).toBeNull()
    expect(recentlyTaken(store, time - 1)).toBeNull()
    expect(recentlyTaken(store, time)).toBe('TEST-R6-A')
    expect(recentlyTaken(store, time + 119_999)).toBe('TEST-R6-A')
    expect(recentlyTaken(store, time + 120_000)).toBeNull()
  })

  it('ใบใหม่ภายใน 2 นาทีถูกหยิบและแทนเฉพาะเลขของใบล่าสุด', () => {
    const store = storage()
    for (const [no, at] of [['TEST-R6-A', time], ['TEST-R6-B', time + 1_000]] as const) {
      store.setItem(OUTBOX_KEY, JSON.stringify({ h: { doc_no: no } }))
      expect(takeOutbox(store, at)?.no).toBe(no)
      expect(recentlyTaken(store, at)).toBe(no)
    }
    expect(takeOutbox(store, time + 1_001)).toBeNull()
  })

  it.each(['{', '[]', 'null', 'true', '{"h":{}}', '{"h":{"doc_no":" "}}'])('คัดข้อมูลเสีย %s ออกจาก outbox', raw => {
    const store = storage([[OUTBOX_KEY, raw]])
    expect(takeOutbox(store, time)).toBeNull()
    expect(store.getItem(OUTBOX_KEY)).toBeNull()
    expect(store.getItem(TAKEN_KEY)).toBeNull()
  })

  it.each(['{', '[]', 'null', '{"no":5,"at":0}', '{"no":"TEST-R6-X","at":"0"}'])('ข้าม marker เสีย %s', raw => {
    expect(recentlyTaken(storage([[TAKEN_KEY, raw]]), 0)).toBeNull()
  })

  it('เลขใบยืนยันชนิด object ไม่ถูกบันทึก (แก้แล้ว)', () => {
    const store = storage([[OUTBOX_KEY, '{"h":{"doc_no":{"broken":true}}}']])
    const item = takeOutbox(store, time)
    expect({ item, marker: recentlyTaken(store, time) }).toEqual({ item: null, marker: null })
  })

  it.each([[0, '0 ชม.'], [0.499, '12 ชม.'], [0.5, '0.5 วัน'], [1234.56, '1,234.6 วัน']] as const)('slaAmount %s = %s', (days, text) => {
    expect(slaAmount(days)).toBe(text)
  })
})

describe('R6 แท็บแรกตามบทบาท', () => {
  const cases: [EmployeeRole, Section | null, string, string[]][] = [
    ['production', null, 'board', ['board', 'todo', 'sewing']], ['qc', null, 'board', ['board', 'todo']],
    ['admin', null, 'overview', ['board', 'sewing']], ['owner', null, 'overview', ['board', 'sewing']],
    ['manager', null, 'overview', ['board', 'sewing']], ['supervisor', 1, 'board', ['todo', 'board']],
    ['supervisor', 2, 'board', ['sewing', 'todo', 'board']], ['supervisor', null, 'board', ['sewing', 'todo', 'board']],
  ]
  it.each(cases)('%s เฟส %s เปิด %s และใช้ลำดับแท็บเดิมตามบทบาท', (role, section, home, tabs) => {
    expect(homePage(role)).toBe(home)
    expect(boardScope(role, section).tabs).toEqual(tabs)
  })
})
