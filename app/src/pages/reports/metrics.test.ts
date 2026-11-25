import { describe, expect, it } from 'vitest'
import { reportMetrics, reportWindow, workDays, type ReportJob, type ReportRows, type ReportVisit } from './metrics'

const HOUR = 3_600_000
const at = (day: string, time = '10:00:00') => `2026-11-${day}T${time}+07:00`
const now = new Date(at('25'))
const window = reportWindow('7', now)
const job: ReportJob = {
  id: 'j1', confirmation_no: 'SC-1', customer_name: 'ลูกค้าทดสอบ', route_code: 'emb',
  due_date: '2026-11-23', created_at: at('21'), finished_at: at('23'), needs_sample: false,
}

function rows(overrides: Partial<ReportRows> = {}): ReportRows {
  return {
    jobs: [], visits: [], issues: [], firstPieces: [], qc: [], samples: [], delays: [], stations: [], routes: [], reasonCodes: [],
    ...overrides,
  }
}

function visit(station: string, seq: number, started_at: string, done_at: string | null,
  options: Partial<ReportVisit> = {}): ReportVisit {
  return { job_id: job.id, station_code: station, phase: 'production', visit: seq, started_at, done_at, rework: false, ...options }
}

const metrics = (input: Partial<ReportRows>) => reportMetrics(rows(input), window)

describe('ช่วงรายงานและวันทำงานไทย', () => {
  it.each([
    [at('21'), at('23'), 1],
    [at('20', '12:00:00'), at('21', '12:00:00'), 1],
    [at('22', '00:00:00'), at('23', '00:00:00'), 0],
    [at('23', '00:00:00'), at('22', '00:00:00'), 0],
    [at('21', '23:30:00'), at('23', '00:30:00'), 1 / 24],
    [at('16', '00:00:00'), at('23', '00:00:00'), 6],
  ])('นับวันทำงานจาก %s ถึง %s ได้ %s ตาม private.work_days', (start, end, expected) => {
    expect(workDays(Date.parse(start), Date.parse(end))).toBeCloseTo(expected)
  })

  it('ช่วง 7 วันเริ่มเที่ยงคืนไทยและสิ้นสุดก่อนเที่ยงคืนวันถัดไป', () => {
    const fromUtc = new Date('2026-11-24T17:00:01Z')
    expect(reportWindow('7', fromUtc)).toEqual({
      start: Date.parse(at('19', '00:00:00')), end: Date.parse(at('26', '00:00:00')),
    })
  })

  it.each(['7', '30', '90'] as const)('ช่วง %s วันรวมวันนี้และนับตามวันปฏิทิน', period => {
    const result = reportWindow(period, now)
    expect(result.end - result.start).toBe(Number(period) * 24 * HOUR)
  })
})

describe('งานเสร็จ ผลตัวอย่าง และงานล่าช้า', () => {
  it('กรองด้วยเวลาเสร็จ ไม่ใช้วันรับงาน และตัดเที่ยงคืนวันถัดไป', () => {
    const data = metrics({ jobs: [
      { ...job, created_at: at('10'), finished_at: at('19', '00:00:00') },
      { ...job, id: 'before', finished_at: at('18', '23:59:59.999') },
      { ...job, id: 'after', finished_at: at('26', '00:00:00') },
      { ...job, id: 'pending', finished_at: null },
    ] })
    expect(data.summary.finished).toBe(1)
  })

  it('วัดกำหนดส่งถึงสิ้นวันไทย และนับวันที่ล่าช้าตามปฏิทิน', () => {
    const data = metrics({ jobs: [
      { ...job, finished_at: '2026-11-23T16:59:59.999999Z' },
      { ...job, id: 'late1', finished_at: '2026-11-23T17:00:00.000Z' },
      { ...job, id: 'late2', finished_at: at('25') },
    ] })
    expect(data.summary.onTime).toBe(1)
    expect(data.summary.onTimePct).toBeCloseTo(100 / 3)
    expect(data.lateJobs.map(item => [item.id, item.daysLate])).toEqual([['late2', 2], ['late1', 1]])
  })

  it('เวลาเฉลี่ยรับงานถึงเสร็จ นับวันรับงานเป็นวันที่ 1 ข้ามอาทิตย์ (เสาร์ 21 → จันทร์ 23 = 2 วัน)', () => {
    const data = metrics({ jobs: [job, { ...job, id: 'j2', created_at: at('20'), finished_at: at('23') }] })
    expect(data.summary.averageLeadDays).toBe(2.5)
  })

  it('ใช้วันที่ใช้ไปจากฐานข้อมูลเมื่อมี (งานที่แบ่งใบนับจากงานแม่) และนับงานที่เสร็จภายในเวลาผลิต', () => {
    const data = metrics({ jobs: [
      { ...job, sla: { lead_days: 10, lead_due: '2026-11-24', lead_used: 9, lead_over: false } },
      { ...job, id: 'late', sla: { lead_days: 10, lead_due: '2026-11-20', lead_used: 12, lead_over: true } },
      { ...job, id: 'old' },
    ] })
    expect(data.summary).toMatchObject({ leadJobs: 2, withinLead: 1, withinLeadPct: 50 })
    expect(data.summary.averageLeadDays).toBeCloseTo((9 + 12 + 2) / 3)
  })

  it('นับตัวอย่างเฉพาะงานที่เลือกขึ้นตัวอย่าง และแยกงานที่ข้าม', () => {
    const data = metrics({
      jobs: [{ ...job, needs_sample: true }, { ...job, id: 'j2', needs_sample: true }, { ...job, id: 'skipped' }],
      samples: [
        { job_id: job.id, round: 1, result: 'fail' }, { job_id: job.id, round: 2, result: 'pass' },
        { job_id: 'j2', round: 1, result: 'pass' }, { job_id: 'skipped', round: 1, result: 'fail' },
      ],
    })
    expect(data.samples).toMatchObject({ required: 2, skipped: 1, recorded: 2, averageRounds: 1.5, firstRoundCount: 2, firstPassPct: 50 })
  })

  it('งาน Develop นับแยก ไม่ปนกับงานเสร็จ ทันกำหนด และผลตัวอย่างของงานผลิต', () => {
    const data = metrics({
      jobs: [{ ...job, id: 'prod' }, { ...job, id: 'dev', needs_sample: true, develop: true, due_date: '2026-11-20' }],
      samples: [{ job_id: 'dev', round: 1, result: 'pass' }],
    })
    expect(data.summary).toMatchObject({ finished: 1, onTime: 1, develop: 1 })
    expect(data.samples.required).toBe(0)
    expect(data.lateJobs).toEqual([])
  })

  it('แยกงานที่ขาดบันทึกผลตัวอย่างออกจากฐานคำนวณ', () => {
    const data = metrics({
      jobs: [{ ...job, needs_sample: true }, { ...job, id: 'missing', needs_sample: true }],
      samples: [{ job_id: job.id, round: 2, result: 'pass' }],
    })
    expect(data.samples).toMatchObject({ required: 2, recorded: 1, averageRounds: 1, firstRoundCount: 0, firstPassPct: null })
  })

  it('ช่วงว่างแสดงค่าที่คำนวณไม่ได้เป็น null และยอดนับเป็น 0', () => {
    const data = metrics({})
    expect(data.summary).toEqual({ finished: 0, onTime: 0, onTimePct: null, withinLead: 0, leadJobs: 0, withinLeadPct: null, averageLeadDays: null, reworkQty: 0, develop: 0 })
    expect(data.samples.firstPassPct).toBeNull()
    expect(data.stations).toEqual({ items: [], bottleneck: null })
  })
})

describe('เวลาเฉลี่ยต่อสถานีและคอขวด', () => {
  const cut = visit('cut', 1, at('20', '08:00:00'), at('20', '12:00:00'))
  const emb = visit('emb', 2, at('21', '12:00:00'), at('23', '06:00:00'))
  const sew = visit('sew', 3, at('23', '07:30:00'), at('23', '09:00:00'))
  const routes = [
    { route_code: 'emb', station_code: 'sew', seq: 3 },
    { route_code: 'emb', station_code: 'cut', seq: 1 },
    { route_code: 'emb', station_code: 'emb', seq: 2 },
    { route_code: 'plain', station_code: 'cut', seq: 1 },
    { route_code: 'plain', station_code: 'sew', seq: 2 },
  ]

  it('หักเฉพาะส่วนที่ทับเวลาทำงานและหักช่วงพักซ้อนกันครั้งเดียว', () => {
    const data = metrics({
      jobs: [job], visits: [cut],
      issues: [
        { id: 1, job_id: job.id, opened_at: at('20', '07:00:00'), closed_at: at('20', '09:00:00'), reason: 'รอคน' },
        { id: 2, job_id: job.id, opened_at: at('20', '08:15:00'), closed_at: at('20', '10:00:00'), reason: 'รอของ' },
        { id: 3, job_id: 'other', opened_at: at('20', '08:00:00'), closed_at: null, reason: 'คนละงาน' },
        { id: 4, job_id: job.id, opened_at: at('20', '11:30:00'), closed_at: null, reason: 'ยังไม่ปิดพัก' },
      ],
    })
    expect(data.stations.items[0].workMs).toBe(1.5 * HOUR)
  })

  it('หักเวลารออนุมัติชิ้นแรก · ทับช่วงพักหักครั้งเดียว · รูปที่ไม่ได้ตัดสินไม่หัก', () => {
    const data = metrics({
      jobs: [job], visits: [cut],
      issues: [{ id: 1, job_id: job.id, opened_at: at('20', '08:00:00'), closed_at: at('20', '09:00:00'), reason: 'รอคน' }],
      firstPieces: [
        { job_id: job.id, sent_at: at('20', '08:30:00'), decided_at: at('20', '10:00:00') },
        { job_id: job.id, sent_at: at('20', '10:30:00'), decided_at: null },
        { job_id: 'other', sent_at: at('20', '08:00:00'), decided_at: at('20', '11:00:00') },
      ],
    })
    expect(data.stations.items[0].workMs).toBe(2 * HOUR)
  })

  it('รอคิวจากสถานีก่อนหน้าตามเส้นทางปัก และตัดร้านนอกออกจากคอขวด', () => {
    const data = metrics({ jobs: [job], routes, visits: [sew, emb, cut] })
    const stations = Object.fromEntries(data.stations.items.map(item => [item.code, item]))
    expect(stations.cut.waitMs).toBeNull()
    expect(stations.emb).toMatchObject({ external: true, waitMs: 24 * HOUR, workMs: 42 * HOUR })
    expect(stations.sew.waitMs).toBe(1.5 * HOUR)
    expect(data.stations.bottleneck).toBe('sew')
  })

  it('สถานีเดียวกันใช้สถานีก่อนหน้าที่ต่างกันตามเส้นทางของงานแต่ละใบ', () => {
    const plainJob = { ...job, id: 'plain-2', route_code: 'plain' }
    const plainCut = { ...cut, job_id: plainJob.id, done_at: at('20', '10:00:00') }
    const plainSew = visit('sew', 2, at('20', '11:00:00'), at('20', '12:00:00'), { job_id: plainJob.id })
    const data = metrics({ jobs: [job, plainJob], routes, visits: [cut, emb, sew, plainCut, plainSew] })
    expect(data.stations.items.find(item => item.code === 'sew')).toMatchObject({ count: 2, waitMs: 1.25 * HOUR })
  })

  it('เวลารอที่ขาดสถานีก่อนหน้าหรือเวลาเหลื่อมกันเป็น null และไม่มีคอขวด', () => {
    const data = metrics({ jobs: [job], routes, visits: [sew, { ...emb, done_at: at('23', '08:00:00') }] })
    expect(data.stations.items.every(item => item.waitMs === null)).toBe(true)
    expect(data.stations.bottleneck).toBeNull()
  })

  it('ตัดรอบตัวอย่าง งานแก้ และรอบที่ไม่มีเวลาจบออกจากค่าเฉลี่ย', () => {
    const data = metrics({ jobs: [job], routes, visits: [
      cut, { ...cut, visit: 8, rework: true }, { ...cut, visit: 9, phase: 'sample' }, { ...cut, visit: 10, done_at: null },
    ] })
    expect(data.stations.items[0]).toMatchObject({ code: 'cut', count: 1, workMs: 4 * HOUR })
  })

  it('เก็บเวลาใช้จริงและเวลาวันทำงานแยกกัน', () => {
    const data = metrics({
      jobs: [job], visits: [emb],
      stations: [{ code: 'emb', name: 'ส่งปัก' }],
      issues: [{ id: 1, job_id: job.id, opened_at: at('22', '03:00:00'), closed_at: at('22', '04:00:00'), reason: 'ร้านหยุด' }],
    })
    expect(data.stations.items[0]).toMatchObject({ name: 'ส่งปัก', workMs: 41 * HOUR, workDays: 0.75 })
  })
})

describe('งานแก้และสาเหตุที่รายงานในช่วง', () => {
  it('นับงานแก้จากใบงานที่เสร็จในช่วง รวมประวัติก่อนวันเริ่ม และนับสาเหตุซ้ำในรายการเดียวเพียงครั้งเดียว', () => {
    const data = metrics({
      jobs: [job],
      stations: [{ code: 'sew', name: 'เย็บงาน' }],
      qc: [
        { job_id: job.id, failed: 5, source_station: 'sew', reasons: ['ด้ายหลุด', 'ด้ายหลุด', 'ตะเข็บเบี้ยว'] },
        { job_id: job.id, failed: 2, source_station: null, reasons: [] },
        { job_id: 'unfinished', failed: 8, source_station: 'sew', reasons: ['ด้ายหลุด'] },
      ],
    })
    expect(data.summary.reworkQty).toBe(7)
    expect(data.rework.byStation.map(r => [r.label, r.count])).toEqual([['เย็บงาน', 5], ['ไม่ระบุสถานี', 2]])
    expect(data.rework.byReason).toEqual(expect.arrayContaining([
      { key: 'ด้ายหลุด', label: 'ด้ายหลุด', count: 5 }, { key: 'ตะเข็บเบี้ยว', label: 'ตะเข็บเบี้ยว', count: 5 },
    ]))
  })

  it('รายงานความล่าช้านับตามเวลาที่ส่งได้แม้ยังไม่มีงานเสร็จ และคงรหัสเก่าที่ไม่มีชื่อ', () => {
    const data = metrics({
      reasonCodes: [{ code: 'M1', name: 'เครื่องเสีย' }],
      delays: [{ at: at('19'), reasons: ['M1', 'M1', 'OLD'] }, { at: at('21'), reasons: ['M1'] }, { at: at('18'), reasons: ['OLD'] }],
    })
    expect(data.summary.finished).toBe(0)
    expect(data.delays).toEqual([{ key: 'M1', label: 'เครื่องเสีย', count: 2 }, { key: 'OLD', label: 'OLD', count: 1 }])
  })

  it('เหตุพักงานนับตามเวลาเปิดกับทุกงานและแสดงไม่เกิน 10 อันดับ', () => {
    const data = metrics({ issues: [
      ...Array.from({ length: 11 }, (_, i) => ({ id: i, job_id: 'open-job', opened_at: at('20'), closed_at: null, reason: `เหตุ ${i}` })),
      { id: 12, job_id: job.id, opened_at: at('20'), closed_at: at('21'), reason: 'เหตุ 0' },
      { id: 13, job_id: job.id, opened_at: at('18'), closed_at: at('21'), reason: 'เหตุ 0' },
    ] })
    expect(data.holds).toHaveLength(10)
    expect(data.holds[0]).toMatchObject({ key: 'เหตุ 0', count: 2 })
  })
})
