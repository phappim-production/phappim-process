// ตรงกับ private.out_span ในฐานข้อมูล
import { OUTSOURCEABLE, ROUTES, type Job, type StationCode } from './model.ts'

// หยุดที่สถานีแรกที่ต้องทำในโรงงาน
export function outSpan(job: Job, from: StationCode): StationCode[] {
  const route = ROUTES[job.route].stations
  const out: StationCode[] = []
  for (const s of route.slice(route.indexOf(from))) {
    if (!OUTSOURCEABLE.includes(s)) break
    out.push(s)
  }
  return out
}

export function defaultBack(arrive: Date, days: number): Date {
  return new Date(arrive.getTime() + Math.max(0, days) * 86_400_000)
}

