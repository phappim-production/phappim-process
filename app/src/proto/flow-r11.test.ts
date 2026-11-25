import { describe, expect, it } from 'vitest'
import { canAckMockup, canEditMockup, canOpenPage, type EmployeeRole } from '../auth/access'
import { bottomBar, roleMenu, routeOf } from '../auth/menus'
import { cell, PERMISSIONS } from '../auth/permissions'
import { boardScope } from '../auth/scope'
import { reportMetrics, reportWindow, type ReportRows } from '../pages/reports/metrics'
import { confirmationDraft, forStation, parseSize, refValue, submitProblems, toPayload } from './annotation'

const menus = {
  owner: ['admin', 'users', 'roles', 'assign', 'audit', 'settings', 'production', 'board', 'reports', 'inbox'],
  manager: ['', 'jobs', 'board', 'reports', 'reviews', 'inbox'],
  admin: ['', 'jobs', 'production-queue', 'board', 'reports', 'inbox'],
  production: ['dept', 'queue', 'board', 'issues', 'reports', 'inbox'],
  staff: ['mine', 'board', 'history', 'report', 'inbox'],
} as const

describe('รอบ 11 · เมนูและสิทธิ์บัญชีจำลอง', () => {
  it.each(Object.keys(menus) as (keyof typeof menus)[])('%s เปิดได้ครบตามเมนูและแถบมือถือ', role => {
    const menu = roleMenu(role)
    const hashes = menus[role].map(path => '#/' + path)
    expect(menu.flatMap(group => group.items.map(item => item.hash))).toEqual(hashes)
    for (const hash of hashes) {
      expect(canOpenPage(role, routeOf(hash).page)).toBe(true)
      const { shown, more } = bottomBar(menu, hash)
      expect(shown.length + Number(more.length > 0)).toBeLessThanOrEqual(5)
      expect([...shown, ...more].map(item => item.hash).sort()).toEqual(hashes.filter(h => h !== '#/inbox').sort())
    }
  })

  it('จำกัดสถานี 3/1/0 และปุ่มของ staff ที่จับคู่ QC', () => {
    expect(boardScope('staff', null, ['cut', 'print', 'press']).columns).toEqual(['print', 'press', 'cut'])
    expect(boardScope('staff', null, ['cut']).columns).toEqual(['cut'])
    expect(boardScope('staff', null).title).toBe('ยังไม่ได้จับคู่สถานี')
    expect(boardScope('staff', null, ['qc_pack']).columns).toEqual(['qc_pack'])
    const permission = (key: string, role: EmployeeRole) => cell(PERMISSIONS.find(p => p.key === key)!, role)
    expect(permission('qc', 'staff')).toBe('ถ้าจับคู่ QC')
    for (const key of ['receive', 'close', 'insert', 'sew', 'outsource', 'mockup_edit', 'mockup_approve']) {
      expect(permission(key, 'staff')).toBe(false)
    }
    expect(canAckMockup('staff')).toBe(true)
    expect(canEditMockup('admin')).toBe(true)
    expect(canOpenPage('staff', 'reports')).toBe(false)
  })
})

it('รอบ 11 · รายงานฐานว่างทุกช่วงเวลาใช้ค่า 0 และ null', () => {
  const empty: ReportRows = { jobs: [], visits: [], issues: [], firstPieces: [], qc: [], samples: [], delays: [], stations: [], routes: [], reasonCodes: [] }
  const clock = new Date('2026-11-20T04:00:00Z')
  for (const period of ['7', '30', '90'] as const) {
    const report = reportMetrics(empty, reportWindow(period, clock))
    expect(report.summary).toEqual({ finished: 0, onTime: 0, onTimePct: null, withinLead: 0, leadJobs: 0, withinLeadPct: null, averageLeadDays: null, reworkQty: 0, develop: 0 })
    expect(report.samples).toMatchObject({ averageRounds: null, firstPassPct: null })
    expect(report.lateJobs).toEqual([])
  }
})

describe('รอบ 11 · ใบยืนยันไปม็อคอัพ', () => {
  const spec = {
    product: 'tshirt', co_size: { w: 800, h: 600 },
    p: { tshirt: { placements: {
      'อกซ้าย': { on: true, size: '8x8 ซม.' },
      'อกขวา': { on: true, size: '3 นิ้ว' },
      'หลัง': { on: true, size: '10 × 12' },
    } } },
    callouts: [
      { x: 0.456789, y: 0.35, bx: -0.125, by: 1.08, title: 'อกซ้าย', ref: 'placement:อกซ้าย' },
      { x: 0.61, y: 0.4, bx: 1.125, by: -0.08, title: 'อกขวา', body: 'ตรวจตำแหน่งก่อนผลิต' },
    ],
  }
  it('ส่ง 2 จุด ขนาดภาพ และกล่องนอกภาพถึง payload บันทึกร่าง', () => {
    const draft = confirmationDraft(spec, 'fixture/main.png')!
    expect(submitProblems(draft)).toEqual([])
    expect(toPayload(draft)).toMatchObject({
      views: [{ image_path: 'fixture/main.png', width: 800, height: 600 }],
      callouts: [
        { no: 1, x: 0.4568, box_x: -0.125, box_y: 1.08, spec_ref: 'placement:อกซ้าย' },
        { no: 2, box_x: 1.125, box_y: -0.08, body: 'ตรวจตำแหน่งก่อนผลิต' },
      ],
    })
    const [print, qc] = draft.callouts
    expect(forStation([{ ...print!, stations: ['print'] }, { ...qc!, stations: ['qc_pack'] }], 'qc_pack').map(c => c.no)).toEqual([2])
    expect(confirmationDraft(spec, null)).toBeNull()
  })

  it('แสดงหน่วยจากใบยืนยันและปฏิเสธตัวเลขที่ใช้ไม่ได้', () => {
    expect(['อกซ้าย', 'อกขวา', 'หลัง'].map(label => refValue(spec, 'placement:' + label))).toEqual(['8x8 ซม.', '3 นิ้ว', '10 × 12 ซม.'])
    expect(['abc', '0', '-2', 'Infinity'].map(parseSize)).toEqual([undefined, undefined, undefined, undefined])
    expect(['', '8', '3,5'].map(parseSize)).toEqual([null, 8, 3.5])
  })
})
