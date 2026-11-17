import { ROUTES, startOfDay, type Job, type RouteCode, type StationCode } from './model'

// ชิ้นต่อวันของสถานีที่ช่างแต่ละคนทำชิ้นงานจนจบเอง (ไม่ใช่ไลน์แบ่งขั้น) · ปัดลง เพราะชิ้นที่ทำไม่จบไม่นับ
export function piecesPerDay(workers: number, minutesPerPiece: number, workMinutes: number): number {
  return Math.floor(workers * workMinutes / minutesPerPiece)
}

// เย็บ: ข้อมูลหน้างาน 17 พ.ย. · ช่าง 3 คน · เสื้อยืด 20.17 นาที/ตัว (ป้ายผ้า 60x60 20 นาที/ผืน ใกล้กัน จึงใช้ค่าเดียว)
// เวลางาน 09:00–18:00 หักพักเที่ยง 1 ชม. = 480 นาที
export const SEWERS = 3
export const SEW_MINUTES_PER_PIECE = 20.17
export const WORK_MINUTES_PER_DAY = 480

// ── ตัวเลขร่าง (ยังไม่ได้ยืนยันกับหน้างาน · เช็คลิสต์หัวข้อ 5 ข้อ 8) ยกเว้นเย็บ ─────────
// กำลังผลิตต่อวันของแต่ละสถานี (ชิ้นต่อวันทำงาน)
export const CAPACITY: Record<StationCode, number> = {
  print: 600, press: 600, cut: 800, dtf_press: 400, emb: 300, qc_pack: 800,  // emb = ร้านปักนอก (ยังไม่รู้กำลังจริง)
  sew: piecesPerDay(SEWERS, SEW_MINUTES_PER_PIECE, WORK_MINUTES_PER_DAY),
}
// วันทำงานโดยประมาณก่อนเข้าผลิตจริง
export const LEAD = {
  materials: 2,      // จากรอวัตถุดิบ → ขึ้นตัวอย่างเสร็จ + ลูกค้ายืนยัน
  sample: 2,         // จากกำลังขึ้นตัวอย่าง → ลูกค้ายืนยัน
  sampleReview: 1,   // รอลูกค้ายืนยัน
  newJob: 4,         // งานใหม่: รับงาน + วัตถุดิบ + ตัวอย่าง + ลูกค้ายืนยัน
  hold: 0.5,         // งานที่ติดปัญหาอยู่ คิดว่าเสียเวลาเพิ่ม
}
// เกณฑ์ตัดสิน "รับงานใหม่ได้ไหม" (จำนวนวันที่คิวสถานีที่แน่นที่สุดยาว)
export const QUEUE_OK_DAYS = 3
export const QUEUE_FULL_DAYS = 6
export const WORKDAYS = [1, 2, 3, 4, 5, 6] // จันทร์–เสาร์ (หยุดอาทิตย์)

export type StationLoad = { days: number; qty: number; jobs: number }
export type Forecast = {
  finishDay: Map<string, number>          // วันทำงานนับจากตอนนี้
  load: Record<StationCode, StationLoad>  // งานที่ยังต้องผ่านสถานีนี้
  bottleneck: StationCode
}
export type NewJob = { route: RouteCode; qty: number }

/**
 * ประมาณการแบบง่าย: แต่ละสถานีทำได้ทีละงาน ใช้เวลา = จำนวนชิ้นที่เหลือ ÷ กำลังผลิตต่อวัน
 * งานไหนพร้อมเข้าสถานีก่อนได้ทำก่อน (พร้อมเท่ากัน → กำหนดส่งใกล้กว่าก่อน) · รีด DTF เริ่มไม่ได้จนกว่าฟิล์มถึง
 * งานใหม่ (extra) เข้าคิวเหมือนงานอื่น หลังเผื่อเวลาวัตถุดิบ + ตัวอย่าง
 */
export function simulate(jobs: Job[], now: Date, extra?: NewJob): Forecast & { extraFinishDay?: number; extraWaitAt?: StationCode } {
  const free = blank(() => 0)
  const load = blank<StationLoad>(() => ({ days: 0, qty: 0, jobs: 0 }))
  const finishDay = new Map<string, number>()

  type Run = { id: string; stations: StationCode[]; i: number; ready: number; due: number; filmDay: number; firstQty: number; qty: number; isExtra: boolean }
  const runs: Run[] = jobs.filter(j => j.phase !== 'done').map(j => {
    const stations = ROUTES[j.route].stations
    const inLine = j.phase === 'production'
    return {
      id: j.id, stations, isExtra: false,
      i: inLine ? Math.max(0, stations.indexOf(j.station ?? stations[0])) : 0,
      ready: inLine ? (j.status === 'hold' ? LEAD.hold : 0)
        : j.phase === 'materials' ? LEAD.materials : j.phase === 'sample' ? LEAD.sample : LEAD.sampleReview,
      due: j.due.getTime(),
      filmDay: j.film && !j.film.received ? workdaysUntil(j.film.eta, now) : 0,
      firstQty: inLine ? remainingAt(j) : j.qty,
      qty: j.qty,
    }
  })
  if (extra) runs.push({ id: '__new', stations: ROUTES[extra.route].stations, i: 0, ready: LEAD.newJob, due: Infinity, filmDay: 0, firstQty: extra.qty, qty: extra.qty, isExtra: true })

  // ภาระงานของสถานี = ชิ้นที่ยังต้องผ่าน ÷ กำลังผลิตต่อวัน (ไม่รวมเวลารอสถานีก่อนหน้า จึงชี้คอขวดได้ตรง)
  for (const r of runs) {
    if (r.isExtra) continue
    r.stations.slice(r.i).forEach((s, k) => { load[s].qty += k === 0 ? r.firstQty : r.qty; load[s].jobs += 1 })
  }
  for (const s of keys()) load[s].days = load[s].qty / CAPACITY[s]
  const bottleneck = keys().reduce((a, b) => (load[b].days > load[a].days ? b : a))

  let extraWaitAt: StationCode | undefined
  let longestWait = 0
  const startOf = (r: Run) => {
    const s = r.stations[r.i]
    return Math.max(r.ready, free[s], s === 'dtf_press' ? r.filmDay : 0)
  }
  let pending = runs.filter(r => r.i < r.stations.length)
  while (pending.length) {
    pending.sort((a, b) => startOf(a) - startOf(b) || a.due - b.due)
    const r = pending[0]
    const s = r.stations[r.i]
    const start = startOf(r)
    if (r.isExtra && start - r.ready > longestWait) { longestWait = start - r.ready; extraWaitAt = s }
    r.ready = start + r.firstQty / CAPACITY[s]   // firstQty = ชิ้นที่เหลือของสถานีปัจจุบัน
    r.firstQty = r.qty                          // สถานีถัดไปทำเต็มจำนวน
    free[s] = r.ready
    r.i++
    if (r.i >= r.stations.length) finishDay.set(r.id, r.ready)
    pending = pending.filter(x => x.i < x.stations.length)
  }

  const extraFinishDay = extra ? finishDay.get('__new') : undefined
  finishDay.delete('__new')
  return { finishDay, load, bottleneck, extraFinishDay, extraWaitAt }
}

function remainingAt(j: Job) {
  if (j.station === 'sew') return Math.max(j.qty - (j.sewCount ?? 0), j.rework?.qty ?? 0, 1)
  return j.status === 'doing' ? j.qty / 2 : j.qty
}

const keys = () => Object.keys(CAPACITY) as StationCode[]
function blank<T>(make: () => T) {
  return Object.fromEntries(keys().map(k => [k, make()])) as Record<StationCode, T>
}

const isWorkday = (d: Date) => WORKDAYS.includes(d.getDay())

/** แปลง "วันทำงานนับจากตอนนี้" เป็นวันที่ (0–1 = วันนี้ ถ้าวันนี้เป็นวันทำงาน) */
export function workdayToDate(days: number, now: Date) {
  const d = startOfDay(now)
  while (!isWorkday(d)) d.setDate(d.getDate() + 1)
  let left = Math.max(0, Math.ceil(days) - 1)
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    if (isWorkday(d)) left--
  }
  return d
}

export function workdaysUntil(date: Date, now: Date) {
  const d = startOfDay(now)
  const end = startOfDay(date)
  let n = 0
  while (d < end) {
    d.setDate(d.getDate() + 1)
    if (isWorkday(d)) n++
  }
  return n
}

/** วันปฏิทินที่ช้ากว่ากำหนด (ค่าบวก = ไม่ทัน) */
export function lateDays(finish: Date, due: Date) {
  return Math.round((startOfDay(finish).getTime() - startOfDay(due).getTime()) / 86_400_000)
}

export type Verdict = { level: 'ok' | 'tight' | 'full'; title: string }
export function verdict(f: Forecast, atRisk: number): Verdict {
  const days = f.load[f.bottleneck].days
  if (days > QUEUE_FULL_DAYS) return { level: 'full', title: 'คิวเต็ม · รับงานใหม่ได้เฉพาะงานที่กำหนดส่งไม่เร่ง' }
  if (days > QUEUE_OK_DAYS || atRisk > 0) return { level: 'tight', title: 'รับได้ แต่ต้องดูกำหนดส่ง' }
  return { level: 'ok', title: 'รับงานใหม่เพิ่มได้' }
}
