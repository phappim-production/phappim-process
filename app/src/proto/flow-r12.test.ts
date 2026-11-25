import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { boardScope, jobInScope } from '../auth/scope'
import { StationRail } from '../components/StationNav'
import { OutsourcePanel } from '../pages/OutsourcePanel'
import { StationQueue } from '../pages/StationQueue'
import { reportMetrics, reportWindow, type ReportRows } from '../pages/reports/metrics'
import { nextAction } from './actions'
import { CAPACITY, LEAD, receiveForecast, simulate, workdayToDate } from './capacity'
import { OUTSIDE_START_BLOCK, ROUTES, STATION_NAME, type Job, type StationCode } from './model'

const now = new Date('2026-11-19T04:00:00+07:00')
const due = new Date('2026-12-21T00:00:00+07:00')
const job: Job = {
  id: 'outside-job', no: 'TEST-R12-JOB', customer: 'ลูกค้าจำลอง', product: 'หมวก', unit: 'ใบ', qty: 10,
  route: 'outside', phase: 'production', station: 'outside', status: 'queued', queue: 1,
  due, since: now, sampleRound: 1, materials: { admin: true, production: true, qc: true },
}

describe('C14 ผลิตข้างนอกทั้งหมด', () => {
  it.each(['hat', 'pillow'])('ประมาณวันเสร็จสำหรับ %s โดยไม่ใช้สูตรจักร', productCode => {
    expect(ROUTES.outside.stations).toEqual(['outside', 'qc_pack'])
    const result = receiveForecast([], now, undefined, { route: 'outside', qty: 10, productCode, needsSample: false, due: '2026-12-21' })
    expect(result.finish).toEqual(workdayToDate(LEAD.outside + 10 / CAPACITY.qc_pack, now))
    expect(result.late).toBeLessThan(0)
  })

  it('งานข้างนอกเริ่มพร้อมกัน ส่วน QC ใช้กำลังผลิตร่วม', () => {
    const result = simulate([job, { ...job, id: 'next', queue: 2 }], now)
    expect(result.finishDay.get(job.id)).toBeCloseTo(LEAD.outside + 10 / CAPACITY.qc_pack)
    expect(result.finishDay.get('next')).toBeCloseTo(LEAD.outside + 20 / CAPACITY.qc_pack)
    expect(result.load.outside).toMatchObject({ days: 0, qty: 20 })
    expect(result.bottleneck).toBe('qc_pack')
  })

  it('ของกลับวันอาทิตย์ต้องคาดว่า QC เสร็จเร็วสุดวันจันทร์', () => {
    const saturday = new Date(2026, 10, 21, 9)
    const sunday = new Date(2026, 10, 22, 9)
    const sent: Job = { ...job, status: 'out', out: {
      id: 1, vendorId: 1, vendor: 'บริษัทจำลอง', stations: ['outside'], qty: 10, rework: false,
      sentAt: saturday, arriveAt: saturday, leadDays: 1, backAt: sunday,
    } }
    const finishDay = simulate([sent], saturday).finishDay.get(sent.id)
    expect(finishDay).toBeDefined()
    expect(workdayToDate(finishDay ?? 0, saturday)).toEqual(new Date(2026, 10, 23))
  })

  it('ขอบเขตบอร์ดพนักงานขึ้นกับการจับคู่และเปิดดูทั้งโรงงานได้', () => {
    expect(jobInScope(job, boardScope('staff', null, ['cut', 'press']))).toBe(false)
    expect(jobInScope(job, boardScope('staff', null, ['outside']))).toBe(true)
    expect(boardScope('staff', null, ['cut']).allowFactory).toBe(true)
    expect(jobInScope(job, boardScope('supervisor', 1))).toBe(true)
    expect(jobInScope(job, boardScope('supervisor', 2))).toBe(false)
  })

  it('เลขสถานี 1 ถึง 7 คงเดิมเมื่อเพิ่มปุ่ม outside', () => {
    const stations: StationCode[] = ['outside', 'print', 'press', 'cut', 'dtf_press', 'emb', 'sew', 'qc_pack']
    const html = renderToStaticMarkup(createElement(StationRail, {
      columns: stations.map(key => ({ key, name: STATION_NAME[key] })),
      counts: key => key === 'outside' ? 2 : 0, urgent: () => 0, station: 'outside', onPick: () => {},
    }))
    const buttons = html.match(/<button\b.*?<\/button>/g) ?? []
    expect(buttons).toHaveLength(9)
    stations.slice(1).forEach((key, index) => {
      expect(buttons[index + 1]).toContain('>' + (index + 1) + '</span>')
      expect(buttons[index + 1]).toContain(STATION_NAME[key])
    })
    expect(buttons[8]).toContain('aria-pressed="true"')
    expect(buttons[8]).toContain('>2</b>')
    expect(buttons[8]).not.toContain('rounded-full text-xs')
  })

  it.each(['admin', 'owner', 'production', 'manager', 'staff'] as const)('รายละเอียดงานรอส่งออกของ %s', role => {
    const admin = role === 'admin' || role === 'owner'
    const html = renderToStaticMarkup(createElement(OutsourcePanel, {
      job, now, admin, vendors: [], refresh: async () => {},
    }))
    expect(/<button\b[^>]*>[^<]*ส่งออกบริษัทภายนอก/.test(html)).toBe(admin)
    const queue = renderToStaticMarkup(createElement(StationQueue, {
      station: 'outside', jobs: [job], role, myStations: ['outside'], now,
      call: async () => ({ ok: true as const }), onOpen: () => {},
    }))
    expect(queue).not.toMatch(/<button\b[^>]*>\s*(?:เริ่ม|เริ่มก่อนคิว)(?:\s|<)/)
    if (['owner', 'production', 'staff'].includes(role)) {
      expect(queue).toContain(OUTSIDE_START_BLOCK.replaceAll('"', '&quot;'))
    }
  })

  it('ช่องกำลังทำที่ outside ไม่ควรบอกให้กดเริ่มคิว 1', () => {
    const html = renderToStaticMarkup(createElement(StationQueue, {
      station: 'outside', jobs: [job], role: 'production', now,
      call: async () => ({ ok: true as const }), onOpen: () => {},
    }))
    expect(html).not.toContain('กดเริ่มงานคิว 1')
  })

  it('งานรอที่ outside ในต้องทำตอนนี้ไม่ควรขึ้นคำสั่งเริ่มสถานี', () => {
    expect(nextAction(job, now)?.text).not.toMatch(/^เริ่ม/)
  })

  it('รายงานไม่นับรอบ outside และค่าเฉลี่ยรอ QC จากรอบที่วัดได้คงเดิม', () => {
    const minute = 60_000
    const time = (offset: number) => new Date(now.getTime() + offset * minute).toISOString()
    const visit = (job_id: string, station_code: string, seq: number, start: number, end: number) =>
      ({ job_id, station_code, visit: seq, phase: 'production', started_at: time(start), done_at: time(end), rework: false })
    const done = (id: string, route_code: string) =>
      ({ id, route_code, confirmation_no: id, customer_name: 'จำลอง', due_date: '2026-12-21',
        created_at: time(-4_320), finished_at: time(120), needs_sample: false })
    const data: ReportRows = {
      jobs: [done('external', 'outside'), done('internal', 'cut_only')],
      visits: [visit('external', 'qc_pack', 2, 70, 100), visit('internal', 'cut', 1, 0, 20),
        visit('internal', 'qc_pack', 2, 65, 105)],
      stations: ['outside', 'cut', 'qc_pack'].map(code => ({ code, name: code })),
      routes: [
        { route_code: 'outside', station_code: 'outside', seq: 1 }, { route_code: 'outside', station_code: 'qc_pack', seq: 2 },
        { route_code: 'cut_only', station_code: 'cut', seq: 1 }, { route_code: 'cut_only', station_code: 'qc_pack', seq: 2 },
      ],
      issues: [], firstPieces: [], qc: [], samples: [], delays: [], reasonCodes: [],
    }
    const window = reportWindow('7', now)
    const onlyOutside = { ...data, jobs: data.jobs.slice(0, 1), visits: data.visits.slice(0, 1) }
    expect(reportMetrics(onlyOutside, window).stations).toMatchObject({
      bottleneck: null, items: [{ code: 'qc_pack', count: 1, workMs: 30 * minute, waitMs: null }],
    })
    const combined = reportMetrics(data, window).stations
    expect(combined.items.map(item => item.code)).toEqual(['cut', 'qc_pack'])
    expect(combined.items[1]).toMatchObject({ count: 2, workMs: 35 * minute, waitMs: 45 * minute })
    expect(combined.bottleneck).toBe('qc_pack')
  })
})
