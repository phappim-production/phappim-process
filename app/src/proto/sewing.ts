// จักรเย็บ (S14 · docs/แผน-1-สัปดาห์.md) · งานรอเย็บกดเริ่มได้เมื่อจักรครบทุกชนิดที่สินค้าต้องใช้ว่างจริง
// กฎเดียวกับฐานข้อมูล (public.start_sewing) · หน้าเว็บใช้คำนวณล่วงหน้าเพื่อบอกเหตุผลก่อนกด
// ชนิดจักรและจักรที่สินค้าต้องใช้ ตรงกับ supabase/migrations/20261118000002_sewing_machines.sql (ร่างจาก PP-SOP-01 ST-05)
import { isOverdue, ROUTES, startOfDay, type Job } from './model.ts'

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

// รหัสนำหน้าของแต่ละประเภท · รหัสจักร = นำหน้า-เลข 2 หลัก เช่น OL4-01 (ติดบนตัวจักร หน้างานเรียกตามนี้)
export const MACHINE_PREFIX: Record<MachineType, string> = {
  single: 'SN', double: 'DN', ovl3: 'OL3', ovl4: 'OL4', ovl5: 'OL5', cover: 'CV', flat: 'FL',
  button: 'BT', buttonhole: 'BH', elastic: 'EL', binding: 'BD',
}
export function machineCode(type: MachineType, no: number): string {
  return `${MACHINE_PREFIX[type]}-${String(no).padStart(2, '0')}`
}
export function isValidMachineCode(type: MachineType, code: string): boolean {
  return new RegExp(`^${MACHINE_PREFIX[type]}-\\d{2,3}$`).test(code)
}

export type MachineStatus = 'ready' | 'broken' | 'off'
export const MACHINE_STATUS_NAME: Record<MachineStatus, string> = { ready: 'ใช้ได้', broken: 'เสีย', off: 'ปิดใช้งาน' }

export type Machine = {
  id: string
  code: string          // รหัสที่ติดบนตัวจักร เช่น OL4-01
  type: MachineType
  status: MachineStatus
  jobId?: string        // งานที่ใช้จักรนี้อยู่ (ไม่มี = ว่าง)
  note?: string         // อาการตอนแจ้งเสีย
}

export type Need = { type: MachineType; qty: number }

// สินค้า → จักรที่ต้องใช้พร้อมกันเพื่อเดินงาน 1 งาน (ร่าง · เจ้าของระบบแก้ได้ที่หน้าตั้งค่า)
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

// สถานะที่หน้างานเห็นบนตัวจักร · เสีย/ปิด มาก่อนเสมอ (จักรเสียที่ยังผูกงานอยู่ ไม่นับว่าใช้งาน)
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

export type QueueSource = 'waiting' | 'coming'  // รอเย็บแล้ว (อยู่สถานีเย็บ ยังไม่ได้จักร) · กำลังมา (สถานีก่อนหน้าเย็บ)
export type QueueRow = {
  job: Job
  source: QueueSource
  verdict: 'ready' | 'wait' | 'unknown'
  needs: Need[]
  missing: Need[]       // ขาดจักรชนิดใด กี่ตัว (เมื่อ verdict = wait)
}

function nextStation(j: Job) {
  if (!j.station) return undefined
  const list = ROUTES[j.route].stations
  return list[list.indexOf(j.station) + 1]
}

// งานที่จะต้องใช้จักร: อยู่สถานีเย็บแต่ยังไม่ได้จักร + งานที่สถานีถัดไปคือเย็บ
export function sewQueue(jobs: Job[], machines: Machine[], includeComing = false): { job: Job; source: QueueSource }[] {
  const hasMachine = new Set(machines.filter(m => m.jobId).map(m => m.jobId))
  const out: { job: Job; source: QueueSource }[] = []
  for (const j of jobs) {
    if (j.phase !== 'sample' && j.phase !== 'production') continue
    if (j.station === 'sew' && !hasMachine.has(j.id)) out.push({ job: j, source: 'waiting' })
    else if (includeComing && nextStation(j) === 'sew') out.push({ job: j, source: 'coming' })
  }
  return out
}

// ลำดับขึ้นเย็บ: รอเย็บแล้วก่อนกำลังมา · เลยกำหนดก่อน · กำหนดส่งใกล้ก่อน · ตัวอย่างก่อน (ชิ้นน้อย รีบให้ลูกค้าดู)
function rank(a: { job: Job; source: QueueSource }, b: { job: Job; source: QueueSource }, now: Date) {
  return (a.source === 'waiting' ? 0 : 1) - (b.source === 'waiting' ? 0 : 1)
    || Number(isOverdue(b.job, now)) - Number(isOverdue(a.job, now))
    || startOfDay(a.job.due).getTime() - startOfDay(b.job.due).getTime()
    || (a.job.phase === 'sample' ? 0 : 1) - (b.job.phase === 'sample' ? 0 : 1)
}

// จ่ายจักรว่างให้คิวตามลำดับ (แบบโลภ): งานที่ขึ้นได้จะจองจักรไว้ งานที่ขาดจักรไม่จอง จึงไม่กันงานถัดไปที่ใช้จักรคนละชนิด
export function planSewing(jobs: Job[], machines: Machine[], needsMap: Record<string, Need[]>, now: Date, includeComing = false) {
  const left = { ...floorSummary(machines).free }
  const queue = sewQueue(jobs, machines, includeComing).sort((a, b) => rank(a, b, now))
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

// ---------- จองจักรเป็นวัน-เวลา (ตรงกับ public.book_machines / cancel_booking) ----------
export type Booking = { id: string; machineId: string; jobId: string; starts: Date; ends: Date }

// การจองของงานอื่นที่ทับช่วง [from, to) ของจักรตัวนี้ (ไม่นับงาน exceptJob)
export function bookedByOther(machineId: string, from: Date, to: Date, bookings: Booking[], exceptJob?: string): Booking | undefined {
  return bookings
    .filter(b => b.machineId === machineId && b.jobId !== exceptJob && b.starts < to && b.ends > from)
    .sort((a, b) => a.starts.getTime() - b.starts.getTime())[0]
}
const ONE_MINUTE = 60_000

// ---------- กดเริ่มเย็บ (ตรงกับ public.start_sewing ในฐานข้อมูล) ----------
export type Blocker = { code: string; state: 'busy' | 'broken' | 'off' | 'booked'; jobId?: string; until?: Date }
export type StartCheck =
  | { ok: true; picked: Machine[] }
  | { ok: false; reason: string; missing: Need[]; blockers: Blocker[] }

// เลือกจักรว่างให้ครบทุกชนิดที่สินค้าต้องใช้ · จักรที่งานนี้จองไว้มาก่อน · จักรที่งานอื่นจองช่วงนี้ใช้ไม่ได้
export function checkStartSewing(job: Job, machines: Machine[], needsMap: Record<string, Need[]>,
  bookings: Booking[] = [], now: Date = new Date()): StartCheck {
  if (job.station !== 'sew' || (job.phase !== 'production' && job.phase !== 'sample')) {
    return { ok: false, reason: 'งานนี้ยังไม่ถึงสถานีเย็บ', missing: [], blockers: [] }
  }
  if (job.status === 'hold') return { ok: false, reason: 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อน', missing: [], blockers: [] }
  if (job.status !== 'queued') return { ok: false, reason: 'งานนี้เริ่มเย็บไปแล้ว', missing: [], blockers: [] }
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
    const free = sorted.filter(m => m.type === n.type && machineState(m) === 'free' && !other(m)).slice(0, n.qty)
    picked.push(...free)
    if (free.length < n.qty) {
      missing.push({ type: n.type, qty: n.qty - free.length })
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

// จำลองการกดเริ่มเย็บบนข้อมูลในหน้าจอ (ข้อมูลจำลอง) · ของจริงเรียก RPC แล้วรอ realtime
export function applyStartSewing(jobs: Job[], machines: Machine[], jobId: string, needsMap: Record<string, Need[]>,
  now: Date, bookings: Booking[] = []) {
  const job = jobs.find(j => j.id === jobId)
  if (!job) return { ok: false as const, reason: 'ไม่พบงานนี้', jobs, machines }
  const check = checkStartSewing(job, machines, needsMap, bookings, now)
  if (!check.ok) return { ok: false as const, reason: check.reason, jobs, machines }
  const ids = new Set(check.picked.map(m => m.id))
  return {
    ok: true as const,
    picked: check.picked.map(m => m.code),
    jobs: jobs.map(j => (j.id === jobId ? { ...j, status: 'doing' as const, since: now } : j)),
    machines: machines.map(m => (ids.has(m.id) ? { ...m, jobId } : m)),
  }
}

// ตรวจก่อนจอง: ช่วงเวลา · จักรครบทุกชนิดในช่วงนั้น · ไม่ชนการจองของงานอื่น
export function checkBooking(job: Job, machines: Machine[], bookings: Booking[], starts: Date, ends: Date,
  needsMap: Record<string, Need[]>, now: Date): { ok: true; picked: Machine[] } | { ok: false; reason: string } {
  if (job.phase === 'done') return { ok: false, reason: 'งานนี้เสร็จแล้ว จองจักรไม่ได้' }
  if (job.phase === 'production' && job.station === 'qc_pack') return { ok: false, reason: 'งานนี้เย็บเสร็จแล้ว จองจักรไม่ได้' }
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) return { ok: false, reason: 'เวลาจบต้องหลังเวลาเริ่ม' }
  if (ends <= now) return { ok: false, reason: 'ช่วงเวลานี้ผ่านไปแล้ว เลือกเวลาใหม่' }
  if (ends.getTime() - starts.getTime() > 14 * 86_400_000) return { ok: false, reason: 'จองได้ครั้งละไม่เกิน 14 วัน' }
  if (starts.getDay() === 0) return { ok: false, reason: 'วันอาทิตย์โรงงานหยุด เลือกวันเริ่มใหม่' }
  if (bookings.some(b => b.jobId === job.id && b.ends > now)) return { ok: false, reason: 'งานนี้จองจักรไว้แล้ว ยกเลิกการจองเดิมก่อนจองใหม่' }
  const needs = (job.productCode && needsMap[job.productCode]) || []
  if (needs.length === 0) return { ok: false, reason: 'ยังไม่มีข้อมูลว่าสินค้านี้ใช้จักรอะไร ให้เจ้าของระบบใส่ในหน้าตั้งค่า' }
  const startsNow = starts <= now
  const sorted = [...machines].sort((a, b) => a.code.localeCompare(b.code))
  const picked: Machine[] = []
  const problems: string[] = []
  for (const n of needs) {
    const usable = (m: Machine) => m.type === n.type && m.status === 'ready' && !bookedByOther(m.id, starts, ends, bookings)
      && !(startsNow && m.jobId && m.jobId !== job.id)
    const free = sorted.filter(usable).slice(0, n.qty)
    if (free.length < n.qty) problems.push(`${MACHINE_TYPE_NAME[n.type]} ขาด ${n.qty - free.length} ตัว`)
    else picked.push(...free)
  }
  if (problems.length) return { ok: false, reason: `ช่วงเวลานี้จักรไม่พอ: ${problems.join(' · ')}` }
  return { ok: true, picked }
}

export function applyBooking(job: Job, machines: Machine[], bookings: Booking[], starts: Date, ends: Date,
  needsMap: Record<string, Need[]>, now: Date) {
  const check = checkBooking(job, machines, bookings, starts, ends, needsMap, now)
  if (!check.ok) return { ok: false as const, reason: check.reason, bookings }
  const added = check.picked.map((m, i) => ({ id: `b${now.getTime()}-${i}-${m.id}`, machineId: m.id, jobId: job.id, starts, ends }))
  return { ok: true as const, picked: check.picked.map(m => m.code), bookings: [...bookings, ...added] }
}

// ยกเลิก: ช่วงที่ยังไม่เริ่ม = ลบ · ช่วงที่กำลังใช้ = ตัดจบที่ตอนนี้ (ตรงกับฐานข้อมูลที่เก็บประวัติไว้)
export function cancelBookings(bookings: Booking[], jobId: string, now: Date) {
  const active = bookings.filter(b => b.jobId === jobId && b.ends > now)
  if (active.length === 0) return { ok: false as const, reason: 'งานนี้ไม่มีการจองที่ยกเลิกได้', bookings }
  return {
    ok: true as const,
    bookings: bookings
      .filter(b => !(b.jobId === jobId && b.starts > now))
      .map(b => (b.jobId === jobId && b.ends > now ? { ...b, ends: now } : b)),
  }
}

// ---------- แจ้งเสีย / ปิดใช้งาน / ซ่อมเสร็จ (ตรงกับ public.set_machine_status) ----------
export function applyMachineStatus(jobs: Job[], machines: Machine[], code: string, status: MachineStatus, note: string, now: Date) {
  const m = machines.find(x => x.code === code.trim().toUpperCase())
  if (!m) return { ok: false as const, reason: `ไม่พบจักรรหัส ${code}`, jobs, machines }
  const text = note.trim()
  if (status === 'broken' && !text) return { ok: false as const, reason: 'แจ้งจักรเสียต้องบอกอาการ', jobs, machines }
  if (m.status === status) return { ok: false as const, reason: `จักร ${m.code} ${MACHINE_STATUS_NAME[status]}อยู่แล้ว`, jobs, machines }
  // เสีย/ปิด = คืนจากงาน · งานที่กำลังเย็บถูกพักอัตโนมัติ (เย็บต่อได้เมื่อจักรครบ)
  const jobId = status !== 'ready' ? m.jobId : undefined
  const nextMachines = machines.map(x => x.id !== m.id ? x : {
    ...x, status, note: status === 'ready' ? undefined : text || undefined, jobId: status === 'ready' ? x.jobId : undefined,
  })
  const job = jobId ? jobs.find(j => j.id === jobId) : undefined
  const hold = job && job.status === 'doing'
  const reason = status === 'broken' ? `จักร ${m.code} เสีย: ${text}` : `จักร ${m.code} ปิดใช้งาน`
  return {
    ok: true as const,
    heldJob: hold ? job.no : undefined,
    machines: nextMachines,
    jobs: hold ? jobs.map(j => (j.id === job.id ? { ...j, status: 'hold' as const, holdReason: reason, since: now } : j)) : jobs,
  }
}
