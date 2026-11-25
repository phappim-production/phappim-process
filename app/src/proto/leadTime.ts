import { thaiDay } from './model'

// ตรงกับ private.lead_days / lead_day_n / lead_used ในฐานข้อมูล
export const LEAD_WARN_RATIO = 0.8
export const LEAD_RULES = [
  { from: 1, to: 499, days: 10 },
  { from: 500, to: 999, days: 15 },
  { from: 1000, to: null, days: 20 },
] as const

export function leadDaysFor(qty: number): number {
  return qty >= 1000 ? 20 : qty >= 500 ? 15 : 10
}

const DAY = 86_400_000
const dayIndex = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY
const isoOf = (index: number) => new Date(index * DAY).toISOString().slice(0, 10)
const isSunday = (index: number) => new Date(index * DAY).getUTCDay() === 0

// รับงานวันอาทิตย์ นับวันที่ 1 เป็นวันจันทร์
export function leadDayN(start: string, n: number): string {
  let left = Math.max(1, Math.floor(n))
  for (let d = dayIndex(start); ; d++) {
    if (!isSunday(d) && --left === 0) return isoOf(d)
  }
}

export function leadUsed(start: string, end: string): number {
  let used = 0
  for (let d = dayIndex(start), last = dayIndex(end); d <= last; d++) if (!isSunday(d)) used++
  return used
}

export type LeadTime = { days: number; start: string; due: string; warnOn: string }

export function leadTimeFor(received: Date, qty: number): LeadTime {
  const start = thaiDay(received)
  const days = leadDaysFor(qty)
  return { days, start, due: leadDayN(start, days), warnOn: leadDayN(start, Math.ceil(days * LEAD_WARN_RATIO)) }
}

export function isLeadLate(due: string, finished: Date): boolean {
  return thaiDay(finished) > due
}

// ค่าบวก = เกินวันที่ต้องเสร็จกี่วัน (วันปฏิทิน)
export function leadLateDays(finish: Date, due: string): number {
  return dayIndex(thaiDay(finish)) - dayIndex(due)
}

export const leadDueDate = (due: string) => new Date(`${due}T12:00:00+07:00`)
