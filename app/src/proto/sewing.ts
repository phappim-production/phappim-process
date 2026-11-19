// คำนวณกฎเดียวกับ public.start_sewing ล่วงหน้าเพื่อบอกเหตุผลก่อนกด (ฐานข้อมูลตรวจจริง)
import { byQueue, ROUTES, type Job } from './model.ts'

export type MachineType =
  | 'single' | 'double' | 'ovl3' | 'ovl4' | 'ovl5' | 'cover' | 'flat'
  | 'button' | 'buttonhole' | 'elastic' | 'binding'

export const MACHINE_TYPE_NAME: Record<MachineType, string> = {
  single: 'เข็มเดี่ยว',
  double: 'สองเข็ม',
  ovl3: 'โพ้ง 3 เส้น',
  ovl4: 'โพ้ง 4 เส้น',
  ovl5: 'โพ้ง 5 เส้น',
  cover: 'จักรลา',
  flat: 'ลาคอ / ฟลัตล็อก',
  button: 'ติดกระดุม',
  buttonhole: 'เจาะรังดุม',
  elastic: 'ยางยืด',
  binding: 'เข้าขอบ',
}
export const MACHINE_TYPES = Object.keys(MACHINE_TYPE_NAME) as MachineType[]

// รหัสจักร = นำหน้า-เลข 3 หลัก เช่น OL4-001 ตามที่ติดบนตัวจักร
export const MACHINE_PREFIX: Record<MachineType, string> = {
  single: 'SN', double: 'DN', ovl3: 'OL3', ovl4: 'OL4', ovl5: 'OL5', cover: 'CV', flat: 'FL',
  button: 'BT', buttonhole: 'BH', elastic: 'EL', binding: 'BD',
}
export function machineCode(type: MachineType, no: number): string {
  return `${MACHINE_PREFIX[type]}-${String(no).padStart(3, '0')}`
}
export function isValidMachineCode(type: MachineType, code: string): boolean {
  return new RegExp(`^${MACHINE_PREFIX[type]}-\\d{3}$`).test(code)
}

export type MachineStatus = 'ready' | 'broken' | 'off'
export const MACHINE_STATUS_NAME: Record<MachineStatus, string> = { ready: 'ใช้ได้', broken: 'เสีย', off: 'ปิดใช้งาน' }

export type Machine = {
  id: string
  code: string
  type: MachineType
  status: MachineStatus
  jobId?: string
  note?: string
  repairEta?: Date
}

export type Need = { type: MachineType; qty: number }

// ค่าเริ่มต้น · แก้ได้ที่หน้าตั้งค่า
const TEE: Need[] = [{ type: 'ovl4', qty: 2 }, { type: 'cover', qty: 1 }, { type: 'flat', qty: 1 }, { type: 'single', qty: 1 }]
const SHIRT: Need[] = [{ type: 'ovl4', qty: 1 }, { type: 'single', qty: 1 }, { type: 'double', qty: 1 }, { type: 'button', qty: 1 }, { type: 'buttonhole', qty: 1 }]
const PANTS: Need[] = [{ type: 'ovl4', qty: 1 }, { type: 'elastic', qty: 1 }, { type: 'cover', qty: 1 }]
const FLAT: Need[] = [{ type: 'ovl3', qty: 1 }, { type: 'single', qty: 1 }]
const EDGE: Need[] = [{ type: 'single', qty: 1 }, { type: 'binding', qty: 1 }]
const BAG: Need[] = [{ type: 'single', qty: 1 }, { type: 'ovl4', qty: 1 }, { type: 'double', qty: 1 }]

export const SEW_NEEDS: Record<string, Need[]> = {
  tshirt: TEE, sport: TEE, running: TEE, worker: TEE, pe: TEE, mourning: TEE, kids: TEE, pet: TEE,
  polo: SHIRT, gown: SHIRT, student: SHIRT, hawaii: SHIRT,
  jacket: [{ type: 'ovl4', qty: 1 }, { type: 'single', qty: 1 }, { type: 'cover', qty: 1 }, { type: 'elastic', qty: 1 }],
  elephant: PANTS, muaythai: PANTS, pajama: PANTS, scrub: PANTS,
  banner: FLAT, yan: FLAT, cheer: FLAT, scarf: FLAT, glasses: FLAT, blanket: FLAT,
  apron: EDGE, wristband: EDGE, lanyard: EDGE,
  bag: BAG, foldable: BAG, sachet: BAG, spunbond: [{ type: 'single', qty: 1 }],
}

export type FreeCount = Record<MachineType, number>

export function emptyCount(): FreeCount {
  return Object.fromEntries(MACHINE_TYPES.map(t => [t, 0])) as FreeCount
}

// เสีย/ปิดมาก่อนเสมอ: จักรเสียที่ยังผูกงานอยู่ไม่นับว่าใช้งาน
export type MachineState = 'free' | 'busy' | 'broken' | 'off'
export const MACHINE_STATE_NAME: Record<MachineState, string> = { free: 'ว่าง', busy: 'ใช้อยู่', broken: 'เสีย', off: 'ปิดใช้งาน' }
export function machineState(m: Machine): MachineState {
  if (m.status === 'broken') return 'broken'
  if (m.status === 'off') return 'off'
  return m.jobId ? 'busy' : 'free'
}

export function floorSummary(machines: Machine[]) {
  const free = emptyCount()
  const total = emptyCount()
  let inUse = 0, broken = 0, off = 0
  for (const m of machines) {
    total[m.type]++
    if (m.status === 'broken') broken++
    else if (m.status === 'off') off++
    else if (m.jobId) inUse++
    else free[m.type]++
  }
  const freeTotal = MACHINE_TYPES.reduce((s, t) => s + free[t], 0)
  return { total, free, count: machines.length, inUse, broken, off, freeTotal }
}

export type QueueSource = 'waiting' | 'coming'
export type QueueRow = {
  job: Job
  source: QueueSource
  verdict: 'ready' | 'wait' | 'unknown'
  needs: Need[]
  missing: Need[]
}

// งานข้างนอกนับต่อจากสถานีสุดท้ายที่บริษัททำ · งานแก้กลับไป QC เสมอ
function nextStation(j: Job) {
  if (!j.station) return undefined
  if (j.status === 'out' && j.out && j.out.rework) return undefined
  const from = j.status === 'out' && j.out ? j.out.stations[j.out.stations.length - 1] : j.station
  const list = ROUTES[j.route].stations
  return list[list.indexOf(from) + 1]
}

export function sewQueue(jobs: Job[], machines: Machine[], includeComing = false): { job: Job; source: QueueSource }[] {
  const hasMachine = new Set(machines.filter(m => m.jobId).map(m => m.jobId))
  const out: { job: Job; source: QueueSource }[] = []
  for (const j of jobs) {
    if (j.phase !== 'sample' && j.phase !== 'production') continue
    // เย็บที่บริษัทภายนอกไม่ใช้จักรโรงงาน
    if (j.status === 'out' && j.out?.stations.includes('sew')) continue
    if (j.station === 'sew' && !hasMachine.has(j.id)) out.push({ job: j, source: 'waiting' })
    else if (includeComing && nextStation(j) === 'sew') out.push({ job: j, source: 'coming' })
  }
  return out
}

// รอเย็บแล้วก่อนกำลังมา แล้วตามคิว (ไม่เรียงตามกำหนดส่ง)
function rank(a: { job: Job; source: QueueSource }, b: { job: Job; source: QueueSource }) {
  return (a.source === 'waiting' ? 0 : 1) - (b.source === 'waiting' ? 0 : 1) || byQueue(a.job, b.job)
}

// จ่ายจักรว่างให้คิวตามลำดับ (แบบโลภ): งานที่ขึ้นได้จะจองจักรไว้ งานที่ขาดจักรไม่จอง จึงไม่กันงานถัดไปที่ใช้จักรคนละชนิด
export function planSewing(jobs: Job[], machines: Machine[], needsMap: Record<string, Need[]>, _now: Date, includeComing = false) {
  const left = { ...floorSummary(machines).free }
  const queue = sewQueue(jobs, machines, includeComing).sort(rank)
  const rows: QueueRow[] = queue.map(({ job, source }) => {
    const needs = (job.productCode && needsMap[job.productCode]) || []
    if (needs.length === 0) return { job, source, verdict: 'unknown', needs, missing: [] }
    const missing = needs
      .filter(n => left[n.type] < n.qty)
      .map(n => ({ type: n.type, qty: n.qty - left[n.type] }))
    if (missing.length === 0) for (const n of needs) left[n.type] -= n.qty
    return { job, source, verdict: missing.length ? 'wait' : 'ready', needs, missing }
  })
  return {
    rows,
    readyCount: rows.filter(r => r.verdict === 'ready').length,
    waitCount: rows.filter(r => r.verdict === 'wait').length,
    leftAfter: left,
  }
}

export function needText(list: Need[]): string {
  return list.map(n => `${MACHINE_TYPE_NAME[n.type]}${n.qty > 1 ? ` ×${n.qty}` : ''}`).join(' · ')
}

// ตรงกับ public.book_machines / cancel_booking
export type Booking = { id: string; machineId: string; jobId: string; starts: Date; ends: Date }

export const BOOKING_TIME_ZONE = 'Asia/Bangkok'
const bookingDate = new Intl.DateTimeFormat('sv-SE', { timeZone: BOOKING_TIME_ZONE })

export function bookingDay(date: Date): string {
  return bookingDate.format(date)
}

export function bookingTime(day: string, time: string): Date {
  return new Date(`${day}T${time}:00+07:00`)
}

export function moveBookingDay(day: string, offset: number): string {
  const date = bookingTime(day, '12:00')
  date.setUTCDate(date.getUTCDate() + offset)
  return bookingDay(date)
}

export function isBookingSunday(day: string): boolean {
  return bookingTime(day, '12:00').getUTCDay() === 0
}

export function groupBookings(bookings: Booking[]): Booking[][] {
  const groups = new Map<string, Booking[]>()
  for (const booking of bookings) {
    const key = `${booking.jobId}/${booking.starts.getTime()}/${booking.ends.getTime()}`
    const group = groups.get(key)
    if (group) group.push(booking)
    else groups.set(key, [booking])
  }
  return [...groups.values()].sort((a, b) => a[0].starts.getTime() - b[0].starts.getTime())
}

export function bookedByOther(machineId: string, from: Date, to: Date, bookings: Booking[], exceptJob?: string): Booking | undefined {
  return bookings
    .filter(b => b.machineId === machineId && b.jobId !== exceptJob && b.starts < to && b.ends > from)
    .sort((a, b) => a.starts.getTime() - b.starts.getTime())[0]
}
const ONE_MINUTE = 60_000

// ตรงกับ public.start_sewing
export type Blocker = { code: string; state: 'busy' | 'broken' | 'off' | 'booked'; jobId?: string; until?: Date }
export type StartCheck =
  | { ok: true; picked: Machine[] }
  | { ok: false; reason: string; missing: Need[]; blockers: Blocker[] }

// จักรที่งานนี้จองไว้ได้ก่อน · จักรที่งานอื่นจองช่วงนี้ใช้ไม่ได้
export function checkStartSewing(job: Job, machines: Machine[], needsMap: Record<string, Need[]>,
  bookings: Booking[] = [], now: Date = new Date(), resume = false): StartCheck {
  if (job.station !== 'sew' || (job.phase !== 'production' && job.phase !== 'sample')) {
    return { ok: false, reason: 'งานนี้ยังไม่ถึงสถานีเย็บ', missing: [], blockers: [] }
  }
  if (resume && job.status !== 'hold') return { ok: false, reason: 'งานนี้ไม่ได้พักอยู่', missing: [], blockers: [] }
  if (!resume && job.status === 'hold') return { ok: false, reason: 'งานนี้พักอยู่ กด "เย็บต่อ" เมื่อแก้ปัญหาแล้ว', missing: [], blockers: [] }
  if (!resume && job.status !== 'queued') return { ok: false, reason: 'งานนี้เริ่มเย็บไปแล้ว', missing: [], blockers: [] }
  const needs = (job.productCode && needsMap[job.productCode]) || []
  if (needs.length === 0) {
    return { ok: false, reason: 'ยังไม่มีข้อมูลว่าสินค้านี้ใช้จักรอะไร ให้เจ้าของระบบใส่ในหน้าตั้งค่า', missing: [], blockers: [] }
  }
  const soon = new Date(now.getTime() + ONE_MINUTE)
  const mine = new Set(bookings.filter(b => b.jobId === job.id && b.ends > now).map(b => b.machineId))
  const other = (m: Machine) => bookedByOther(m.id, now, soon, bookings, job.id)
  const sorted = [...machines].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.code.localeCompare(b.code))
  const picked: Machine[] = []
  const missing: Need[] = []
  const blockers: Blocker[] = []
  for (const n of needs) {
    const assigned = resume ? machines.filter(m => m.type === n.type && m.jobId === job.id && m.status === 'ready').length : 0
    const needed = Math.max(0, n.qty - assigned)
    const free = sorted.filter(m => m.type === n.type && machineState(m) === 'free' && !other(m)).slice(0, needed)
    picked.push(...free)
    if (free.length < needed) {
      missing.push({ type: n.type, qty: needed - free.length })
      for (const m of [...machines].sort((a, b) => a.code.localeCompare(b.code)).filter(x => x.type === n.type)) {
        const st = machineState(m)
        const b = other(m)
        if (st !== 'free') blockers.push({ code: m.code, state: st, jobId: m.jobId })
        else if (b) blockers.push({ code: m.code, state: 'booked', jobId: b.jobId, until: b.ends })
      }
    }
  }
  if (missing.length) return { ok: false, reason: `จักรไม่ว่าง: ขาด ${needText(missing)}`, missing, blockers }
  return { ok: true, picked }
}

// ใช้กับข้อมูลจำลอง · ของจริงเรียก RPC แล้วรอ realtime
export function applyStartSewing(jobs: Job[], machines: Machine[], jobId: string, needsMap: Record<string, Need[]>,
  now: Date, bookings: Booking[] = [], resume = false) {
  const job = jobs.find(j => j.id === jobId)
  if (!job) return { ok: false as const, reason: 'ไม่พบงานนี้', jobs, machines }
  const check = checkStartSewing(job, machines, needsMap, bookings, now, resume)
  if (!check.ok) return { ok: false as const, reason: check.reason, jobs, machines }
  const ids = new Set(check.picked.map(m => m.id))
  return {
    ok: true as const,
    picked: check.picked.map(m => m.code),
    jobs: jobs.map(j => (j.id === jobId ? { ...j, status: 'doing' as const, since: now, holdReason: undefined } : j)),
    machines: machines.map(m => (ids.has(m.id) ? { ...m, jobId } : m)),
  }
}

export function checkBooking(job: Job, machines: Machine[], bookings: Booking[], starts: Date, ends: Date,
  needsMap: Record<string, Need[]>, now: Date): { ok: true; picked: Machine[] } | { ok: false; reason: string } {
  if (job.phase === 'done') return { ok: false, reason: 'งานนี้เสร็จแล้ว จองจักรไม่ได้' }
  if (job.phase === 'production' && job.station === 'qc_pack') return { ok: false, reason: 'งานนี้เย็บเสร็จแล้ว จองจักรไม่ได้' }
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) return { ok: false, reason: 'เวลาจบต้องหลังเวลาเริ่ม' }
  if (ends <= now) return { ok: false, reason: 'ช่วงเวลานี้ผ่านไปแล้ว เลือกเวลาใหม่' }
  if (ends.getTime() - starts.getTime() > 14 * 86_400_000) return { ok: false, reason: 'จองได้ครั้งละไม่เกิน 14 วัน' }
  if (isBookingSunday(bookingDay(starts))) return { ok: false, reason: 'วันอาทิตย์โรงงานหยุด เลือกวันเริ่มใหม่' }
  if (bookings.some(b => b.jobId === job.id && b.ends > now)) return { ok: false, reason: 'งานนี้จองจักรไว้แล้ว ยกเลิกการจองเดิมก่อนจองใหม่' }
  const needs = (job.productCode && needsMap[job.productCode]) || []
  if (needs.length === 0) return { ok: false, reason: 'ยังไม่มีข้อมูลว่าสินค้านี้ใช้จักรอะไร ให้เจ้าของระบบใส่ในหน้าตั้งค่า' }
  const available = freeDuring(machines, bookings, starts, ends, now, job.id)
  const sorted = [...machines].sort((a, b) => a.code.localeCompare(b.code))
  const picked: Machine[] = []
  const problems: string[] = []
  for (const n of needs) {
    if (available[n.type] < n.qty) problems.push(`${MACHINE_TYPE_NAME[n.type]} ขาด ${n.qty - available[n.type]} ตัว`)
    else picked.push(...sorted.filter(m => m.type === n.type && isFreeDuring(m, bookings, starts, ends, now, job.id)).slice(0, n.qty))
  }
  if (problems.length) return { ok: false, reason: `ช่วงเวลานี้จักรไม่พอ: ${problems.join(' · ')}` }
  return { ok: true, picked }
}

function isFreeDuring(m: Machine, bookings: Booking[], starts: Date, ends: Date, now: Date, jobId?: string): boolean {
  return m.status === 'ready' && !bookedByOther(m.id, starts, ends, bookings)
    && !(starts <= now && m.jobId && m.jobId !== jobId)
}

export function freeDuring(machines: Machine[], bookings: Booking[], starts: Date, ends: Date, now: Date, jobId?: string): FreeCount {
  const free = emptyCount()
  for (const m of machines) {
    if (isFreeDuring(m, bookings, starts, ends, now, jobId)) free[m.type]++
  }
  return free
}

export function jobsBookedDuring(bookings: Booking[], starts: Date, ends: Date): string[] {
  return [...new Set(bookings.filter(b => b.starts < ends && b.ends > starts).map(b => b.jobId))]
}

export function applyBooking(job: Job, machines: Machine[], bookings: Booking[], starts: Date, ends: Date,
  needsMap: Record<string, Need[]>, now: Date) {
  const check = checkBooking(job, machines, bookings, starts, ends, needsMap, now)
  if (!check.ok) return { ok: false as const, reason: check.reason, bookings }
  const added = check.picked.map(m => ({ id: `b-${job.id}-${starts.getTime()}-${m.id}`, machineId: m.id, jobId: job.id, starts, ends }))
  return { ok: true as const, picked: check.picked.map(m => m.code), bookings: [...bookings, ...added] }
}

// ยกเลิก: ช่วงที่ยังไม่เริ่ม = ลบ · ช่วงที่กำลังใช้ = ตัดจบที่ตอนนี้ (ตรงกับฐานข้อมูลที่เก็บประวัติไว้)
export function cancelBookings(bookings: Booking[], jobId: string, now: Date) {
  const active = bookings.filter(b => b.jobId === jobId && b.ends > now)
  if (active.length === 0) return { ok: false as const, reason: 'งานนี้ไม่มีการจองที่ยกเลิกได้', bookings }
  return {
    ok: true as const,
    bookings: bookings
      .filter(b => !(b.jobId === jobId && b.starts >= now))
      .map(b => (b.jobId === jobId && b.ends > now ? { ...b, ends: now } : b)),
  }
}

// ตรงกับ public.set_machine_status
// กรอบเวลาซ่อม (ตรงกับ private.check_repair_eta) · null = ผ่าน
export function repairEtaProblem(eta: Date | undefined, now: Date): string | null {
  if (!eta || Number.isNaN(eta.getTime())) return 'ต้องกำหนดเวลาซ่อมเสร็จ'
  if (eta <= now) return 'เวลาซ่อมเสร็จต้องเป็นเวลาข้างหน้า'
  if (eta.getTime() - now.getTime() > 30 * 86_400_000) return 'กรอบเวลาซ่อมเกิน 30 วัน ถ้าซ่อมไม่ได้ให้ปิดใช้งานแทน'
  return null
}

export function repairStatus(m: Machine, now: Date): { tone: 'warn' | 'danger'; text: string } | null {
  if (m.status !== 'broken') return null
  if (!m.repairEta) return { tone: 'warn', text: 'ยังไม่กำหนดเวลาซ่อม' }
  const at = m.repairEta.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const mins = Math.round((m.repairEta.getTime() - now.getTime()) / 60_000)
  if (mins < 0) return { tone: 'danger', text: `เลยกำหนดซ่อม (${at})` }
  return { tone: 'warn', text: `ซ่อมเสร็จประมาณ ${at}` }
}

export function applyMachineStatus(jobs: Job[], machines: Machine[], code: string, status: MachineStatus, note: string, now: Date,
  opts: { repairEta?: Date; byProduction?: boolean; canSetEta?: boolean } = {}) {
  const m = machines.find(x => x.code === code.trim().toUpperCase())
  if (!m) return { ok: false as const, reason: `ไม่พบจักรรหัส ${code}`, jobs, machines }
  const text = note.trim()
  if (status === 'broken' && !text) return { ok: false as const, reason: 'แจ้งจักรเสียต้องบอกอาการ', jobs, machines }
  if (opts.repairEta && status !== 'broken') return { ok: false as const, reason: 'กรอบเวลาซ่อมใส่ได้เฉพาะตอนแจ้งเสีย', jobs, machines }
  if (opts.repairEta && !opts.canSetEta) return { ok: false as const, reason: 'กรอบเวลาซ่อมเป็นหน้าที่ของฝ่ายผลิต', jobs, machines }
  if (status === 'broken' && opts.byProduction && !opts.repairEta) return { ok: false as const, reason: 'ฝ่ายผลิตแจ้งเสียต้องกำหนดเวลาซ่อมเสร็จ', jobs, machines }
  if (opts.repairEta) {
    const problem = repairEtaProblem(opts.repairEta, now)
    if (problem) return { ok: false as const, reason: problem, jobs, machines }
  }
  if (m.status === status) return { ok: false as const, reason: `จักร ${m.code} ${MACHINE_STATUS_NAME[status]}อยู่แล้ว`, jobs, machines }
  // เสีย/ปิด = คืนจากงาน · งานที่กำลังเย็บถูกพักอัตโนมัติ (เย็บต่อได้เมื่อจักรครบ)
  const jobId = status !== 'ready' ? m.jobId : undefined
  const nextMachines = machines.map(x => x.id !== m.id ? x : {
    ...x, status, note: status === 'ready' ? undefined : text || undefined, jobId: status === 'ready' ? x.jobId : undefined,
    repairEta: status === 'broken' ? opts.repairEta : undefined,
  })
  const job = jobId ? jobs.find(j => j.id === jobId) : undefined
  const hold = job && job.status === 'doing'
  const eta = opts.repairEta ? ` · คาดว่าซ่อมเสร็จ ${opts.repairEta.toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''
  const reason = (status === 'broken' ? `จักร ${m.code} เสีย: ${text}` : `จักร ${m.code} ปิดใช้งาน`) + eta
  return {
    ok: true as const,
    heldJob: hold ? job.no : undefined,
    machines: nextMachines,
    jobs: hold ? jobs.map(j => (j.id === job.id ? { ...j, status: 'hold' as const, holdReason: reason, since: now } : j)) : jobs,
  }
}

// ตรงกับ public.set_repair_eta
export function applyRepairEta(machines: Machine[], code: string, eta: Date, now: Date) {
  const m = machines.find(x => x.code === code.trim().toUpperCase())
  if (!m) return { ok: false as const, reason: `ไม่พบจักรรหัส ${code}`, machines }
  if (m.status !== 'broken') return { ok: false as const, reason: `จักร ${m.code} ไม่ได้เสียอยู่ กำหนดเวลาซ่อมไม่ได้`, machines }
  const problem = repairEtaProblem(eta, now)
  if (problem) return { ok: false as const, reason: problem, machines }
  return { ok: true as const, machines: machines.map(x => (x.id === m.id ? { ...x, repairEta: eta } : x)) }
}

function updateJob(jobs: Job[], id: string, patch: (j: Job) => Job) {
  return jobs.map(j => (j.id === id ? patch(j) : j))
}
function sewingJob(jobs: Job[], id: string): Job | string {
  const j = jobs.find(x => x.id === id)
  if (!j) return 'ไม่พบงานนี้'
  if (j.station !== 'sew') return 'งานนี้ไม่ได้อยู่สถานีเย็บ'
  if (j.status === 'hold') return 'งานนี้พักอยู่ กด "เย็บต่อ" เมื่อแก้ปัญหาแล้ว'
  if (j.status !== 'doing') return 'ยังไม่ได้เริ่มเย็บ'
  return j
}

export function applyReportSewingIssue(jobs: Job[], id: string, reason: string, pause: boolean, now: Date) {
  const job = sewingJob(jobs, id)
  if (typeof job === 'string') return { ok: false as const, reason: job, jobs }
  const text = reason.trim()
  if (!text) return { ok: false as const, reason: 'กรุณาระบุปัญหาที่พบ', jobs }
  return {
    ok: true as const,
    jobs: updateJob(jobs, id, j => ({
      ...j,
      sewingReports: [...(j.sewingReports ?? []), { reason: text, at: now, paused: pause }],
      ...(pause ? { status: 'hold' as const, holdReason: text, since: now } : {}),
    })),
  }
}

export function applyFinishSewing(jobs: Job[], machines: Machine[], bookings: Booking[], id: string, now: Date) {
  const j = sewingJob(jobs, id)
  if (typeof j === 'string') return { ok: false as const, reason: j, jobs, machines, bookings }
  const list = ROUTES[j.route].stations
  const next = list[list.indexOf('sew') + 1]
  const released = machines.filter(m => m.jobId === id).map(m => m.code).sort()
  return {
    ok: true as const,
    released,
    next,
    jobs: updateJob(jobs, id, x => ({ ...x, station: next, status: 'queued' as const, since: now })),
    machines: machines.map(m => (m.jobId === id ? { ...m, jobId: undefined } : m)),
    bookings: bookings
      // ตัวอย่างเย็บเสร็จยังต้องเย็บรอบผลิตจริง จึงไม่ยกเลิกการจองล่วงหน้า
      .filter(b => !(b.jobId === id && (b.starts.getTime() === now.getTime() || (b.starts > now && j.phase !== 'sample'))))
      .map(b => (b.jobId === id && b.starts < now && b.ends > now ? { ...b, ends: now } : b)),
  }
}

// ตรงกับ public.set_job_machines
// หน้างานคิดเป็นจำนวนตัว ไม่เลือกรหัส · ฐานข้อมูลตรวจซ้ำ
export type MachineCountRow = {
  type: MachineType
  have: number
  codes: string[]
  need: number
  free: number
  base: boolean         // ชนิดที่สินค้าต้องใช้หรือที่งานถืออยู่ (แสดงก่อน)
  minusBlocked?: string
  plusBlocked?: string
}
export function machineCounts(job: Job, machines: Machine[], needs: Need[], shared: readonly MachineType[], bookings: Booking[], now: Date): MachineCountRow[] {
  const soon = new Date(now.getTime() + ONE_MINUTE)
  const doing = job.status === 'doing'
  // จักรใช้ร่วมทุกไลน์ใช้ได้อยู่แล้ว ไม่ต้องจ่าย · แสดงเฉพาะชนิดที่มีจักรในโรงงาน
  const types = MACHINE_TYPES.filter(t => !shared.includes(t) && machines.some(m => m.type === t))
  return types.map(type => {
    const name = MACHINE_TYPE_NAME[type]
    const ofType = machines.filter(m => m.type === type)
    const mine = ofType.filter(m => m.jobId === job.id)
    const need = needs.find(n => n.type === type)?.qty ?? 0
    const others = ofType.filter(m => m.jobId !== job.id)
    const booked = others.filter(m => machineState(m) === 'free' && bookedByOther(m.id, now, soon, bookings, job.id))
    const free = others.filter(m => machineState(m) === 'free').length - booked.length
    const busy = others.filter(m => machineState(m) === 'busy').length
    const down = others.filter(m => m.status !== 'ready').length
    const min = doing ? need : 0
    const why = [busy && `ใช้กับงานอื่น ${busy}`, down && `เสีย/ปิด ${down}`, booked.length && `จองไว้ ${booked.length}`].filter(Boolean).join(' · ')
    return {
      type, have: mine.length, codes: mine.map(m => m.code).sort(), need, free,
      base: need > 0 || mine.length > 0,
      minusBlocked: mine.length === 0 ? 'ยังไม่มีจักรชนิดนี้'
        : mine.length <= min ? `ระหว่างเย็บต้องมี${name}อย่างน้อย ${min} ตัว · จะหยุดให้รายงานปัญหาและพักงานก่อน` : undefined,
      plusBlocked: free > 0 ? undefined : `ไม่มี${name}ว่าง${why ? ` (${why})` : ''}`,
    }
  })
}

// พักเฉพาะงานที่กำลังเย็บและจักรที่เหลือไม่ครบชุด (ตรงกับ public.set_machine_status)
export function pausesJob(machine: Machine, machines: Machine[], job: Job | undefined, needsMap: Record<string, Need[]>): boolean {
  if (!job || job.status !== 'doing' || machine.jobId !== job.id) return false
  const need = ((job.productCode && needsMap[job.productCode]) || []).find(n => n.type === machine.type)?.qty ?? 0
  const left = machines.filter(m => m.jobId === job.id && m.type === machine.type && m.code !== machine.code).length
  return left < need
}

// สรุปเป็นจำนวนไม่ให้การ์ดสูงเต็มจอมือถือ · จักรเสีย/ปิดยังบอกรหัสเพราะต้องรู้ว่าตัวไหนรอซ่อม
export function blockerSummary(blockers: Blocker[]): string {
  const count = (s: Blocker['state']) => blockers.filter(b => b.state === s).length
  const down = blockers.filter(b => b.state === 'broken' || b.state === 'off').map(b => `${b.code} ${b.state === 'broken' ? 'เสีย' : 'ปิด'}`)
  return [
    count('busy') && `ใช้กับงานอื่น ${count('busy')} ตัว`,
    count('booked') && `จองไว้ให้งานอื่น ${count('booked')} ตัว`,
    down.length > 0 && down.join(', '),
  ].filter(Boolean).join(' · ')
}
