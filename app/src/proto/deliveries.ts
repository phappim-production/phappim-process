import { thaiDay, thaiDayDiff, type Job } from './model.ts'

export type DeliveryState = 'late' | 'risk' | 'hold' | 'sample' | 'waiting' | 'doing' | 'out' | 'ready' | 'delivered'
export type DeliveryItem = { job: Job; state: DeliveryState; finish?: Date }
export type DeliveryKind = 'overdue' | 'today' | 'tomorrow' | 'day' | 'later'
export type DeliveryDay = { key: string; kind: DeliveryKind; date?: Date; items: DeliveryItem[] }
export type DeliverySummary = { overdue: number; today: number; todayReady: number; tomorrow: number; week: number; risk: number }

// เรียงในวันเดียวกัน: เรื่องที่ต้องตามก่อน แล้วค่อยงานที่พร้อมส่ง
const ORDER: DeliveryState[] = ['late', 'risk', 'hold', 'sample', 'waiting', 'doing', 'out', 'ready', 'delivered']

export function deliveryState(j: Job, now: Date, finish?: Date): DeliveryState {
  if (j.delivered) return 'delivered'
  if (j.phase === 'done') return 'ready'
  if (thaiDayDiff(j.due, now) < 0) return 'late'
  if (finish && thaiDayDiff(finish, j.due) > 0) return 'risk'
  if (j.status === 'hold') return 'hold'
  if (j.phase === 'sample_review') return 'sample'
  if (j.status === 'out') return 'out'
  if (j.status === 'doing') return 'doing'
  return 'waiting'
}

const byOrder = (a: DeliveryItem, b: DeliveryItem) =>
  ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.job.no.localeCompare(b.job.no)

// วันแสดงตามวันไทย (กำหนดส่งเก็บเป็นวันที่ไม่มีเวลา) · งานที่ส่งแล้วไม่อยู่ในตาราง ยกเว้นส่งวันนี้ (ดูว่าออกไปแล้ว)
export function deliverySchedule(jobs: readonly Job[], now: Date, finishOf: (j: Job) => Date | undefined, days = 14):
  { days: DeliveryDay[]; deliveredToday: DeliveryItem[]; summary: DeliverySummary } {
  const today = thaiDay(now)
  const groups = new Map<string, DeliveryDay>()
  const deliveredToday: DeliveryItem[] = []
  const summary: DeliverySummary = { overdue: 0, today: 0, todayReady: 0, tomorrow: 0, week: 0, risk: 0 }
  for (const job of jobs) {
    if (job.delivered) {
      if (thaiDay(job.delivered.at) === today) deliveredToday.push({ job, state: 'delivered' })
      continue
    }
    const finish = job.phase === 'done' ? undefined : finishOf(job)
    const state = deliveryState(job, now, finish)
    const diff = thaiDayDiff(job.due, now)
    const kind: DeliveryKind = diff < 0 ? 'overdue' : diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff <= days ? 'day' : 'later'
    const key = kind === 'overdue' || kind === 'later' ? kind : thaiDay(job.due)
    if (!groups.has(key)) groups.set(key, { key, kind, date: kind === 'overdue' || kind === 'later' ? undefined : job.due, items: [] })
    groups.get(key)!.items.push({ job, state, finish })
    if (kind === 'overdue') summary.overdue++
    if (kind === 'today') { summary.today++; if (state === 'ready') summary.todayReady++ }
    if (kind === 'tomorrow') summary.tomorrow++
    if (diff >= 0 && diff <= 6) summary.week++
    if (state === 'risk') summary.risk++
  }
  const rank = (d: DeliveryDay) => (d.kind === 'overdue' ? '0' : d.kind === 'later' ? '9' : '1' + d.key)
  const list = [...groups.values()].sort((a, b) => rank(a).localeCompare(rank(b)))
  for (const d of list) {
    d.items.sort(d.kind === 'overdue' || d.kind === 'later'
      ? (a, b) => a.job.due.getTime() - b.job.due.getTime() || byOrder(a, b)
      : byOrder)
  }
  deliveredToday.sort((a, b) => a.job.no.localeCompare(b.job.no))
  return { days: list, deliveredToday, summary }
}
