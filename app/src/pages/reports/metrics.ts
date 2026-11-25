import { thaiDay } from '../../proto/model'

const DAY = 86_400_000
const BANGKOK_OFFSET = 7 * 3_600_000

export type Period = '7' | '30' | '90'
export type ReportWindow = { start: number; end: number }

export type ReportJob = {
  id: string
  confirmation_no: string
  customer_name: string
  route_code: string
  due_date: string
  created_at: string
  finished_at: string | null
  needs_sample: boolean
  develop?: boolean
}

export type ReportVisit = {
  job_id: string; station_code: string; phase: string; visit: number | null
  started_at: string | null; done_at: string | null; rework: boolean | null
}
export type ReportIssue = { id: number; job_id: string; opened_at: string; closed_at: string | null; reason: string }
export type ReportFirstPiece = { job_id: string; sent_at: string; decided_at: string | null }
export type ReportQc = { job_id: string; failed: number; source_station: string | null; reasons: unknown }
export type ReportSample = { job_id: string; round: number; result: 'pass' | 'fail' }
export type ReportDelay = { at: string; reasons: string[] }
export type ReportStation = { code: string; name: string; sla_days: number | null }
export type ReportRouteStep = { route_code: string; station_code: string; seq: number }
export type ReportReason = { code: string; name: string }

export type ReportRows = {
  jobs: ReportJob[]
  visits: ReportVisit[]
  issues: ReportIssue[]
  firstPieces: ReportFirstPiece[]
  qc: ReportQc[]
  samples: ReportSample[]
  delays: ReportDelay[]
  stations: ReportStation[]
  routes: ReportRouteStep[]
  reasonCodes: ReportReason[]
}

export type Ranked = { key: string; label: string; count: number }
type Span = { start: number; end: number }
type StationTotal = { count: number; workMs: number; workDays: number; waitMs: number; waitCount: number }

const timestamp = (value: string | null) => value === null ? NaN : Date.parse(value)
const thaiMidnight = (day: string) => Date.parse(`${day}T00:00:00+07:00`)
const within = (value: number, window: ReportWindow) => value >= window.start && value < window.end

export function reportWindow(period: Period, now: Date): ReportWindow {
  const today = thaiMidnight(thaiDay(now))
  return { start: today - (Number(period) - 1) * DAY, end: today + DAY }
}

export function workDays(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  // เหมือน private.work_days: ใช้วันไทยเต็ม 24 ชม. ไม่นับอาทิตย์
  const firstDay = Math.floor((start + BANGKOK_OFFSET) / DAY) * DAY - BANGKOK_OFFSET
  let ms = 0
  for (let day = firstDay; day < end; day += DAY) {
    if (new Date(day + BANGKOK_OFFSET).getUTCDay() === 0) continue
    ms += Math.min(end, day + DAY) - Math.max(start, day)
  }
  return ms / DAY
}

function groupByJob<T extends { job_id: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groups.get(row.job_id)
    if (group) group.push(row)
    else groups.set(row.job_id, [row])
  }
  return groups
}

function addCount(counts: Map<string, number>, key: string, qty = 1) {
  counts.set(key, (counts.get(key) ?? 0) + qty)
}

function ranked(counts: Map<string, number>, name = (key: string) => key): Ranked[] {
  return [...counts].map(([key, count]) => ({ key, label: name(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'th') || a.key.localeCompare(b.key))
}

function reasonNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
}

function overlapHolds(issues: ReportIssue[], start: number, end: number): Span[] {
  const clipped = issues.map(issue => ({
    start: Math.max(start, timestamp(issue.opened_at)),
    end: Math.min(end, issue.closed_at === null ? end : timestamp(issue.closed_at)),
  })).filter(span => span.end > span.start).sort((a, b) => a.start - b.start)

  // รวมช่วงพักซ้อนกันก่อนหักเวลา เพื่อหักแต่ละนาทีครั้งเดียว
  const merged: Span[] = []
  for (const span of clipped) {
    const last = merged.at(-1)
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push(span)
  }
  return merged
}

function stationTimes(rows: ReportRows, jobs: ReportJob[]) {
  const routes = new Map<string, ReportRouteStep[]>()
  for (const step of rows.routes) {
    const path = routes.get(step.route_code)
    if (path) path.push(step)
    else routes.set(step.route_code, [step])
  }
  for (const path of routes.values()) path.sort((a, b) => a.seq - b.seq)

  const visits = groupByJob(rows.visits)
  const issues = groupByJob(rows.issues)
  // รูปที่ไม่ได้ตัดสิน (ปิดระบบรูประหว่างรอ) ไม่หักเวลา เหมือนเวลามาตรฐานในฐานข้อมูล
  const waits = groupByJob(rows.firstPieces.filter(c => c.decided_at !== null)
    .map(c => ({ id: 0, job_id: c.job_id, opened_at: c.sent_at, closed_at: c.decided_at, reason: '' })))
  const totals = new Map<string, StationTotal>()

  for (const job of jobs) {
    const route = routes.get(job.route_code) ?? []
    const holds = [...(issues.get(job.id) ?? []), ...(waits.get(job.id) ?? [])]
    const readings = (visits.get(job.id) ?? [])
      .filter(visit => visit.phase === 'production' && visit.rework !== true)
      .map(visit => ({ ...visit, start: timestamp(visit.started_at), end: timestamp(visit.done_at) }))
      .filter(visit => Number.isFinite(visit.start) && Number.isFinite(visit.end) && visit.end >= visit.start)
      .sort((a, b) => a.start - b.start || (a.visit ?? 0) - (b.visit ?? 0))

    const doneByStation = new Map<string, { end: number; visit: number | null }[]>()
    for (const reading of readings) {
      const { station_code: code, start, end } = reading
      const total = totals.get(code) ?? { count: 0, workMs: 0, workDays: 0, waitMs: 0, waitCount: 0 }
      let netMs = end - start
      let netDays = workDays(start, end)
      for (const hold of overlapHolds(holds, start, end)) {
        netMs -= hold.end - hold.start
        netDays -= workDays(hold.start, hold.end)
      }
      total.count++
      total.workMs += netMs
      total.workDays += Math.max(0, netDays)

      const index = route.findIndex(step => step.station_code === code)
      if (index > 0) {
        const previous = doneByStation.get(route[index - 1].station_code) ?? []
        const done = previous.reduce<number | null>((latest, item) => {
          const older = item.visit === null || reading.visit === null || item.visit < reading.visit
          return older && item.end <= start && (latest === null || item.end > latest) ? item.end : latest
        }, null)
        if (done !== null) {
          total.waitMs += start - done
          total.waitCount++
        }
      }
      const completed = doneByStation.get(code)
      if (completed) completed.push({ end, visit: reading.visit })
      else doneByStation.set(code, [{ end, visit: reading.visit }])
      totals.set(code, total)
    }
  }

  const settings = new Map(rows.stations.map(station => [station.code, station]))
  const order = [...new Set([...rows.stations.map(station => station.code), ...totals.keys()])]
  const items = order.flatMap(code => {
    const total = totals.get(code)
    if (!total) return []
    const station = settings.get(code)
    return [{
      code,
      name: station?.name ?? code,
      external: code === 'emb',
      count: total.count,
      workMs: total.workMs / total.count,
      workDays: total.workDays / total.count,
      waitMs: total.waitCount ? total.waitMs / total.waitCount : null,
      slaDays: station?.sla_days ?? null,
    }]
  })
  const bottleneck = items.reduce<{ code: string; wait: number } | null>((slowest, item) => {
    if (item.external || item.waitMs === null || item.waitMs <= (slowest?.wait ?? 0)) return slowest
    return { code: item.code, wait: item.waitMs }
  }, null)
  return { items, bottleneck: bottleneck?.code ?? null }
}

export function reportMetrics(rows: ReportRows, window: ReportWindow) {
  const finishedInWindow = rows.jobs.filter(job => within(timestamp(job.finished_at), window))
  // งาน Develop จบที่ตัวอย่าง ไม่ใช่งานผลิต จึงนับแยก ไม่ปนกับงานเสร็จ/ทันกำหนด/เวลาต่อสถานี
  const jobs = finishedInWindow.filter(job => !job.develop)
  const developJobs = finishedInWindow.filter(job => job.develop)
  const ids = new Set(jobs.map(job => job.id))
  const stationNames = new Map(rows.stations.map(station => [station.code, station.name]))
  const lateJobs = jobs.flatMap(job => {
    if (job.finished_at === null) return []
    const finish = timestamp(job.finished_at)
    const daysLate = (thaiMidnight(thaiDay(new Date(finish))) - thaiMidnight(job.due_date)) / DAY
    return daysLate > 0 ? [{ ...job, finished_at: job.finished_at, daysLate }] : []
  }).sort((a, b) => b.daysLate - a.daysLate || timestamp(b.finished_at) - timestamp(a.finished_at) ||
    a.confirmation_no.localeCompare(b.confirmation_no))

  const sampledJobs = jobs.filter(job => job.needs_sample)
  const samplesByJob = groupByJob(rows.samples)
  const rounds = sampledJobs.map(job => new Map((samplesByJob.get(job.id) ?? []).map(sample => [sample.round, sample.result])))
  const knownRounds = rounds.filter(results => results.size > 0)
  const knownFirstRounds = rounds.filter(results => results.has(1))

  const byStation = new Map<string, number>()
  const byReason = new Map<string, number>()
  let reworkQty = 0
  for (const record of rows.qc) {
    if (!ids.has(record.job_id) || record.failed <= 0) continue
    reworkQty += record.failed
    addCount(byStation, record.source_station ?? '', record.failed)
    const reasons = reasonNames(record.reasons)
    for (const reason of reasons.length ? reasons : ['ไม่ระบุสาเหตุ']) addCount(byReason, reason, record.failed)
  }

  const delayReasons = new Map<string, number>()
  const holdReasons = new Map<string, number>()
  const knownReasonCodes = new Map(rows.reasonCodes.map(reason => [reason.code, reason.name]))
  for (const report of rows.delays) {
    if (!within(timestamp(report.at), window)) continue
    for (const code of reasonNames(report.reasons)) addCount(delayReasons, code)
  }
  for (const issue of rows.issues) {
    if (within(timestamp(issue.opened_at), window)) addCount(holdReasons, issue.reason.trim())
  }

  const onTime = jobs.length - lateJobs.length
  return {
    summary: {
      finished: jobs.length, onTime,
      onTimePct: jobs.length ? 100 * onTime / jobs.length : null,
      averageLeadDays: jobs.length ? jobs.reduce((sum, job) => sum + workDays(timestamp(job.created_at), timestamp(job.finished_at)), 0) / jobs.length : null,
      reworkQty,
      develop: developJobs.length,
    },
    stations: stationTimes(rows, jobs),
    samples: {
      required: sampledJobs.length,
      skipped: jobs.length - sampledJobs.length,
      recorded: knownRounds.length,
      averageRounds: knownRounds.length ? knownRounds.reduce((sum, result) => sum + result.size, 0) / knownRounds.length : null,
      firstRoundCount: knownFirstRounds.length,
      firstPassPct: knownFirstRounds.length ? 100 * knownFirstRounds.filter(result => result.get(1) === 'pass').length / knownFirstRounds.length : null,
    },
    rework: {
      byStation: ranked(byStation, code => (stationNames.get(code) ?? code) || 'ไม่ระบุสถานี'),
      byReason: ranked(byReason),
    },
    delays: ranked(delayReasons, code => knownReasonCodes.get(code) ?? code),
    holds: ranked(holdReasons).slice(0, 10),
    lateJobs,
  }
}

export type ReportMetrics = ReturnType<typeof reportMetrics>
