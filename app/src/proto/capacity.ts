import { ROUTES, byQueue, startOfDay, type Job, type RouteCode, type StationCode } from './model'
import type { Machine, MachineType, Need } from './sewing'

// ชิ้นต่อวันของสถานีที่ช่างแต่ละคนทำชิ้นงานจนจบเอง (ไม่ใช่ไลน์แบ่งขั้น) · ปัดลง เพราะชิ้นที่ทำไม่จบไม่นับ
export function piecesPerDay(workers: number, minutesPerPiece: number, workMinutes: number): number {
  return Math.floor(workers * workMinutes / minutesPerPiece)
}

// เย็บ: ข้อมูลหน้างาน 17 พ.ย. · จับเวลาจากช่าง 3 คน: เสื้อยืด 20.17 นาที/ตัว/คน (ป้ายผ้า 60x60 20 นาที/ผืน ใกล้กัน จึงใช้ค่าเดียว)
// ทั้งโรงงานมีช่างเย็บ 15 คน · เวลางาน 09:00–18:00 หักพักเที่ยง 1 ชม. = 480 นาที
export const SEWERS = 15
export const SEW_MINUTES_PER_PIECE = 20.17
export const WORK_MINUTES_PER_DAY = 480
// 1 งาน = 1 ไลน์เย็บ: ได้จักรครบชุดตามสินค้าประจำงานจนเย็บเสร็จ (start_sewing บันทึกรหัสจักรไว้ที่งาน) จักรที่เหลือเปิดไลน์ให้งานถัดไป
// ช่าง 3 คนที่จับเวลาคือ 1 ไลน์ → ไลน์ละ 71 ตัว/วัน · ช่าง 15 คน = เปิดพร้อมกันได้สูงสุด 5 ไลน์ ถ้าจักรพอ
export const SEW_CREW_PER_LINE = 3
export const SEW_MAX_LINES = Math.floor(SEWERS / SEW_CREW_PER_LINE)
// ไม่รู้สินค้า → คิดแบบเสื้อยืด (สินค้าหลัก · ต้องใช้จักรลาที่มีน้อย)
export const DEFAULT_SEW_PRODUCT = 'tshirt'

// เวลาเย็บต่อชิ้นต่อคน (นาที) ตามสินค้า (product_types.code) · ใส่เฉพาะที่จับเวลาจริงแล้ว
// สินค้าอื่น (กางเกง · ฮาวาย · โปโล ...) ยังไม่มีข้อมูล → ใช้เวลาเสื้อยืดไปก่อน และหน้าจอบอกว่ายังไม่มีเวลาจริง
export const SEW_MINUTES: Record<string, number> = {
  tshirt: SEW_MINUTES_PER_PIECE,
  banner: 20,   // ป้ายผ้า 60x60
}
export function hasSewMinutes(productCode?: string): boolean {
  return (productCode ?? DEFAULT_SEW_PRODUCT) in SEW_MINUTES
}
// ชิ้นต่อวันของ 1 ไลน์ (ช่าง 3 คน) สำหรับสินค้านี้
export function lineRate(productCode?: string): number {
  return piecesPerDay(SEW_CREW_PER_LINE, SEW_MINUTES[productCode ?? DEFAULT_SEW_PRODUCT] ?? SEW_MINUTES_PER_PIECE, WORK_MINUTES_PER_DAY)
}
export const SEW_LINE_RATE = lineRate(DEFAULT_SEW_PRODUCT)

export type MachineCount = Partial<Record<MachineType, number>>
// จักรที่ใช้ได้บนพื้นโรงงาน (รวมที่ใช้อยู่ · ไม่นับเสีย/ปิด) + สูตรจักรของสินค้า (หน้าตั้งค่า)
// shared = จักรใช้ร่วม (ไม่อยู่ใน needsOf · ไม่จำกัดจำนวนไลน์)
export type SewFloor = { ready: MachineCount; needsOf: (productCode?: string) => Need[]; shared?: MachineType[] }

export function sewFloorOf(machines: Machine[], needsMap: Record<string, Need[]>, shared: MachineType[] = []): SewFloor {
  const ready: MachineCount = {}
  for (const m of machines) if (m.status === 'ready') ready[m.type] = (ready[m.type] ?? 0) + 1
  return { ready, needsOf: code => needsMap[code ?? DEFAULT_SEW_PRODUCT] ?? [], shared }
}

// จักรครบชุดได้กี่ชุดพร้อมกัน · สินค้าไม่มีสูตรจักร = ไม่จำกัด
export function machineSets(needs: Need[], ready: MachineCount): number {
  if (!needs.length) return Infinity
  return Math.min(...needs.map(n => Math.floor((ready[n.type] ?? 0) / n.qty)))
}

// ไลน์ของสินค้านี้ที่เปิดพร้อมกันได้ (ใช้คำนวณภาระสถานี) · จักรเสียจนไม่ครบชุด → ถือว่าซ่อมได้ 1 ชุด ไม่ให้คาดการณ์เป็นอนันต์
export function linesFor(needs: Need[], ready: MachineCount, maxLines = SEW_MAX_LINES): number {
  return Math.max(1, Math.min(maxLines, machineSets(needs, ready)))
}

export type SewLine = { start: number; end: number; needs: Need[] }

/**
 * เปิดไลน์ใหม่ช่วง [start, start + days) ได้ไหม: ทุกช่วงเวลาต้องมีไลน์เย็บอยู่ไม่ถึงสูงสุด
 * และจักรที่ไลน์อื่นไม่ได้ใช้ต้องครบชุดของสินค้านี้ (ข้ามเงื่อนไขจักรถ้าทั้งโรงงานมีไม่ครบชุดอยู่แล้ว)
 */
export function canOpenLine(start: number, days: number, needs: Need[], lines: SewLine[], ready: MachineCount, maxLines = SEW_MAX_LINES): boolean {
  const checkMachines = machineSets(needs, ready) >= 1
  const checkpoints = [start, ...lines.map(l => l.start).filter(t => t > start && t < start + days)]
  return checkpoints.every(t => {
    const active = lines.filter(l => l.start <= t && l.end > t)
    if (active.length >= maxLines) return false
    if (!checkMachines) return true
    return needs.every(n => {
      const used = active.reduce((sum, l) => sum + (l.needs.find(x => x.type === n.type)?.qty ?? 0), 0)
      return (ready[n.type] ?? 0) - used >= n.qty
    })
  })
}

// เวลาเร็วที่สุดที่เปิดไลน์ได้ (ไม่ก่อน earliest) · ลองตอนพร้อม และตอนแต่ละไลน์เย็บเสร็จ
export function earliestLineStart(earliest: number, days: number, needs: Need[], lines: SewLine[], ready: MachineCount, maxLines = SEW_MAX_LINES): number {
  const candidates = [earliest, ...lines.map(l => l.end).filter(t => t > earliest)].sort((a, b) => a - b)
  return candidates.find(t => canOpenLine(t, days, needs, lines, ready, maxLines)) ?? candidates[candidates.length - 1]
}

// ── ตัวเลขร่าง (ยังไม่ได้ยืนยันกับหน้างาน · เช็คลิสต์หัวข้อ 5 ข้อ 8) ยกเว้นเย็บ ─────────
// กำลังผลิตต่อวันของแต่ละสถานี (ชิ้นต่อวันทำงาน)
export const CAPACITY: Record<StationCode, number> = {
  print: 600, press: 600, cut: 800, dtf_press: 400, emb: 300, qc_pack: 800,  // emb = ร้านปักนอก (ยังไม่รู้กำลังจริง)
  sew: SEW_LINE_RATE * SEW_MAX_LINES,  // ทั้งโรงงาน ถ้าจักรพอเปิดครบทุกไลน์
}
// วันทำงานโดยประมาณก่อนเข้าผลิตจริง
export const LEAD = {
  materials: 2,      // จากรอวัตถุดิบ → ขึ้นตัวอย่างเสร็จ + ลูกค้ายืนยัน
  sample: 2,         // จากกำลังขึ้นตัวอย่าง → ลูกค้ายืนยัน
  sampleReview: 1,   // รอลูกค้ายืนยัน
  newJob: 3,         // งานใหม่ที่ไม่รู้ว่าขึ้นตัวอย่างไหม: เผื่อขึ้นตัวอย่าง + ลูกค้ายืนยัน (ไม่มีขั้นวัตถุดิบแล้ว 17 พ.ย.)
  hold: 0.5,         // งานที่ติดปัญหาอยู่ คิดว่าเสียเวลาเพิ่ม
}
// เกณฑ์ตัดสิน "รับงานใหม่ได้ไหม" (จำนวนวันที่คิวสถานีที่แน่นที่สุดยาว)
export const QUEUE_OK_DAYS = 3
export const QUEUE_FULL_DAYS = 6
export const WORKDAYS = [1, 2, 3, 4, 5, 6] // จันทร์–เสาร์ (หยุดอาทิตย์)

export type StationLoad = { days: number; qty: number; jobs: number; rate: number }  // rate = ชิ้นต่อวันเฉลี่ยของงานที่ค้าง (เย็บขึ้นกับจักรของสินค้า)
export type Forecast = {
  finishDay: Map<string, number>          // วันทำงานนับจากตอนนี้
  load: Record<StationCode, StationLoad>  // งานที่ยังต้องผ่านสถานีนี้
  bottleneck: StationCode
}
// lead = วันทำงานก่อนเข้าสถานีแรก (ไม่ใส่ = LEAD.newJob)
export type NewJob = { route: RouteCode; qty: number; productCode?: string; lead?: number }

/**
 * ประมาณการแบบง่าย: แต่ละสถานีทำได้ทีละงาน (ยกเว้นเย็บ) ใช้เวลา = จำนวนชิ้นที่เหลือ ÷ กำลังผลิตต่อวัน
 * งานไหนพร้อมเข้าสถานีก่อนได้ทำก่อน (พร้อมเท่ากัน → คิวก่อนได้ก่อน ไม่ใช่กำหนดส่ง) · รีด DTF เริ่มไม่ได้จนกว่าฟิล์มถึง
 * งานใหม่ (extra) เข้าคิวเหมือนงานอื่น หลังเผื่อเวลาวัตถุดิบ + ตัวอย่าง
 * เย็บ: 1 งาน = 1 ไลน์ (ไลน์ละ SEW_LINE_RATE ชิ้น/วัน) · หลายงานเย็บพร้อมกันได้ถ้าช่างและจักรครบชุดพอ (floor) · ไม่ส่ง floor = จำกัดแค่จำนวนไลน์
 */
export function simulate(jobs: Job[], now: Date, extra?: NewJob, floor: SewFloor = { ready: {}, needsOf: () => [] }): Forecast & { extraFinishDay?: number; extraWaitAt?: StationCode } {
  const free = blank(() => 0)
  const load = blank<StationLoad>(() => ({ days: 0, qty: 0, jobs: 0, rate: 0 }))
  const finishDay = new Map<string, number>()

  type Run = { id: string; stations: StationCode[]; i: number; ready: number; order: number; filmDay: number; firstQty: number; qty: number; needs: Need[]; lineRate: number; isExtra: boolean }
  let lines: SewLine[] = []
  const runs: Run[] = jobs.filter(j => j.phase !== 'done').sort(byQueue).map((j, order) => {
    const stations = ROUTES[j.route].stations
    // อยู่ที่บริษัทภายนอก: ข้ามสถานีที่บริษัททำ · พร้อมเข้าสถานีถัดไปเมื่อของถึงตามกำหนด (งานแก้กลับ QC)
    if (j.status === 'out' && j.out) {
      const last = j.out.stations[j.out.stations.length - 1]
      const i = j.out.rework ? stations.length - 1 : stations.indexOf(last) + 1
      return {
        id: j.id, stations, isExtra: false, i: Math.min(Math.max(i, 0), stations.length), order,
        ready: workdaysUntil(j.out.backAt, now), filmDay: 0,
        firstQty: j.out.qty, qty: j.qty, needs: floor.needsOf(j.productCode), lineRate: lineRate(j.productCode),
      }
    }
    const inLine = j.phase === 'production'
    return {
      id: j.id, stations, isExtra: false,
      i: inLine ? Math.max(0, stations.indexOf(j.station ?? stations[0])) : 0,
      ready: inLine ? (j.status === 'hold' ? LEAD.hold : 0)
        : j.phase === 'materials' ? LEAD.materials : j.phase === 'sample' ? LEAD.sample : LEAD.sampleReview,
      order,
      filmDay: j.film && !j.film.received ? workdaysUntil(j.film.eta, now) : 0,
      firstQty: inLine ? remainingAt(j) : j.qty,
      qty: j.qty,
      needs: floor.needsOf(j.productCode),
      lineRate: lineRate(j.productCode),
    }
  })
  if (extra) runs.push({ id: '__new', stations: ROUTES[extra.route].stations, i: 0, ready: extra.lead ?? LEAD.newJob, order: Infinity, filmDay: 0, firstQty: extra.qty, qty: extra.qty, needs: floor.needsOf(extra.productCode), lineRate: lineRate(extra.productCode), isExtra: true })

  // ภาระงานของสถานี = ชิ้นที่ยังต้องผ่าน ÷ กำลังผลิตต่อวัน (ไม่รวมเวลารอสถานีก่อนหน้า จึงชี้คอขวดได้ตรง)
  for (const r of runs) {
    if (r.isExtra) continue
    r.stations.slice(r.i).forEach((s, k) => {
      const qty = k === 0 ? r.firstQty : r.qty
      load[s].qty += qty; load[s].jobs += 1
      load[s].days += s === 'sew' ? qty / (r.lineRate * linesFor(r.needs, floor.ready)) : qty / CAPACITY[s]
    })
  }
  for (const s of keys()) load[s].rate = load[s].days > 0 ? load[s].qty / load[s].days : s === 'sew' ? SEW_LINE_RATE * linesFor(floor.needsOf(), floor.ready) : CAPACITY[s]
  const bottleneck = keys().reduce((a, b) => (load[b].days > load[a].days ? b : a))

  let extraWaitAt: StationCode | undefined
  let longestWait = 0
  const startOf = (r: Run) => {
    const s = r.stations[r.i]
    if (s === 'sew') return earliestLineStart(Math.max(r.ready, clock), r.firstQty / r.lineRate, r.needs, lines, floor.ready)
    return Math.max(r.ready, free[s], s === 'dtf_press' ? r.filmDay : 0)
  }
  let pending = runs.filter(r => r.i < r.stations.length)
  // เวลาที่เลือกเริ่มแต่ละรอบไม่ลดลง (เลือกงานที่เริ่มเร็วสุดเสมอ) → ไลน์ที่จบก่อนเวลานี้ไม่มีผลกับงานที่เหลือ ตัดทิ้งได้
  let clock = 0
  while (pending.length) {
    // หางานที่เริ่มได้เร็วที่สุด (เท่ากัน → คิวก่อน) · คำนวณวันเริ่มครั้งเดียวต่องานต่อรอบ
    // เดิมเรียง (sort) ซึ่งเรียก startOf ซ้ำทุกการเทียบ งานมากแล้วหน้าภาพรวมหน่วงบนแท็บเล็ต
    let r = pending[0]
    let start = startOf(r)
    for (let k = 1; k < pending.length; k++) {
      const t = startOf(pending[k])
      if (t < start || (t === start && pending[k].order < r.order)) { r = pending[k]; start = t }
    }
    const s = r.stations[r.i]
    if (r.isExtra && start - r.ready > longestWait) { longestWait = start - r.ready; extraWaitAt = s }
    r.ready = start + r.firstQty / (s === 'sew' ? r.lineRate : CAPACITY[s])   // firstQty = ชิ้นที่เหลือของสถานีปัจจุบัน
    if (s === 'sew') lines.push({ start, end: r.ready, needs: r.needs })
    r.firstQty = r.qty                          // สถานีถัดไปทำเต็มจำนวน
    free[s] = r.ready
    r.i++
    if (r.i >= r.stations.length) finishDay.set(r.id, r.ready)
    pending = pending.filter(x => x.i < x.stations.length)
    clock = start
    lines = lines.filter(l => l.end > clock)
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

/**
 * คาดวันเสร็จของงานที่กำลังจะส่งเข้า (หน้ารับงานใหม่) · เตือนอย่างเดียว ไม่บล็อก (เจ้าของตัดสินใจ 17 พ.ย. หลังจำลอง 30 งาน)
 * ไม่มีขั้นวัตถุดิบแล้ว: ไม่ขึ้นตัวอย่าง = เข้าสถานีแรกทันที · ขึ้นตัวอย่าง = เผื่อขึ้นตัวอย่าง + รอลูกค้ายืนยัน
 * due = วันที่ 'YYYY-MM-DD' · late > 0 = ช้ากว่ากำหนดส่งกี่วัน
 */
export function receiveForecast(jobs: Job[], now: Date, floor: SewFloor | undefined,
  job: { route: RouteCode; qty: number; productCode?: string; needsSample: boolean; due: string }): { finish: Date; late: number | null } {
  const lead = job.needsSample ? LEAD.sample + LEAD.sampleReview : 0
  const r = simulate(jobs, now, { route: job.route, qty: Math.max(1, job.qty), productCode: job.productCode, lead }, floor)
  const finish = workdayToDate(r.extraFinishDay ?? 0, now)
  const late = /^\d{4}-\d{2}-\d{2}$/.test(job.due) ? lateDays(finish, new Date(`${job.due}T00:00:00`)) : null
  return { finish, late }
}

export type Verdict = { level: 'ok' | 'tight' | 'full'; title: string }
export function verdict(f: Forecast, atRisk: number): Verdict {
  const days = f.load[f.bottleneck].days
  if (days > QUEUE_FULL_DAYS) return { level: 'full', title: 'คิวเต็ม · รับงานใหม่ได้เฉพาะงานที่กำหนดส่งไม่เร่ง' }
  if (days > QUEUE_OK_DAYS || atRisk > 0) return { level: 'tight', title: 'รับได้ แต่ต้องดูกำหนดส่ง' }
  return { level: 'ok', title: 'รับงานใหม่เพิ่มได้' }
}
