
export type StationCode = 'outside' | 'print' | 'press' | 'cut' | 'dtf_press' | 'emb' | 'sew' | 'qc_pack'
export type RouteCode = 'outside' | 'normal' | 'dtf' | 'dtg' | 'screen' | 'emb' | 'print_emb' | 'cut_only' | 'plain'
  | 'sew_only' | 'print_only' | 'print_press_only' | 'press_only' | 'dtf_only'
export type Dept = 'admin' | 'qc' | 'production'
export type Phase = 'materials' | 'sample' | 'sample_review' | 'production' | 'done'
// out = อยู่ที่บริษัทภายนอก (ส่งออก) · ปุ่มของโรงงานกดไม่ได้จนกว่าแอดมินรับของกลับ
export type StationStatus = 'queued' | 'doing' | 'hold' | 'out'

export const STATION_NAME: Record<StationCode, string> = {
  outside: 'สั่งผลิตข้างนอก',
  print: 'พิมพ์งาน',
  press: 'รีดงาน',
  cut: 'ตัดงาน',
  dtf_press: 'รีดฟิล์ม',
  emb: 'ส่งปัก',
  sew: 'เย็บงาน',
  qc_pack: 'QC + Packing',
}

export const STATION_ORDER: StationCode[] = ['print', 'press', 'cut', 'dtf_press', 'emb', 'sew', 'qc_pack']
// เลข 1–7 ที่คนหน้างานใช้เรียกสถานี (ไทยและพม่าพูดตรงกัน) · ช่องที่ไม่ใช่สถานีในโรงงานไม่มีเลข
export const stationNo = (key: string): number | null => {
  const i = STATION_ORDER.indexOf(key as StationCode)
  return i >= 0 ? i + 1 : null
}


export function isStationCode(value: unknown): value is StationCode {
  return typeof value === 'string' && Object.hasOwn(STATION_NAME, value)
}

export const ROUTES: Record<RouteCode, { name: string; short: string; stations: StationCode[] }> = {
  normal: { name: 'ปกติ (ซับลิเมชั่น / ดิจิทัล)', short: 'ปกติ', stations: ['print', 'press', 'cut', 'sew', 'qc_pack'] },
  dtf: { name: 'DTF', short: 'DTF', stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
  dtg: { name: 'DTG', short: 'DTG', stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
  screen: { name: 'ซิลค์สกรีน', short: 'สกรีน', stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
  emb: { name: 'ปัก', short: 'ปัก', stations: ['cut', 'emb', 'sew', 'qc_pack'] },
  print_emb: { name: 'พิมพ์ + ปัก', short: 'พิมพ์+ปัก', stations: ['print', 'press', 'cut', 'emb', 'sew', 'qc_pack'] },
  cut_only: { name: 'ตัดงานลูกค้า', short: 'ตัดอย่างเดียว', stations: ['cut', 'qc_pack'] },
  plain: { name: 'ไม่มีงานพิมพ์', short: 'ไม่พิมพ์', stations: ['cut', 'sew', 'qc_pack'] },
  outside: { name: 'ผลิตข้างนอกทั้งหมด', short: 'ผลิตข้างนอก', stations: ['outside', 'qc_pack'] },
  sew_only: { name: 'เย็บอย่างเดียว', short: 'เย็บอย่างเดียว', stations: ['sew', 'qc_pack'] },
  print_only: { name: 'พิมพ์อย่างเดียว (ส่งกระดาษ)', short: 'พิมพ์อย่างเดียว', stations: ['print', 'qc_pack'] },
  print_press_only: { name: 'พิมพ์ + รีดลงผ้าลูกค้า', short: 'พิมพ์+รีด', stations: ['print', 'press', 'qc_pack'] },
  press_only: { name: 'รีดอย่างเดียว', short: 'รีดอย่างเดียว', stations: ['press', 'qc_pack'] },
  dtf_only: { name: 'DTF อย่างเดียว', short: 'DTF อย่างเดียว', stations: ['dtf_press', 'qc_pack'] },
}

// เส้นทางที่สั่งฟิล์มมารีด (ตรงกับ private.uses_film)
export const usesFilm = (r: RouteCode) => r === 'dtf' || r === 'dtg' || r === 'screen' || r === 'dtf_only'
export const filmLabel = (r: RouteCode) => (r === 'dtg' ? 'งาน DTG' : r === 'screen' ? 'งานสกรีน' : 'ฟิล์ม DTF')

export const DEPT_NAME: Record<Dept, string> = { admin: 'แอดมิน', qc: 'QC', production: 'ฝ่ายผลิต' }

export const STATUS_NAME: Record<StationStatus, string> = { queued: 'รอคิว', doing: 'กำลังทำ', hold: 'ติดปัญหา', out: 'ส่งออกข้างนอก' }

export type Job = {
  id: string
  no: string
  customer: string
  product: string
  productCode?: string
  unit: string
  qty: number
  due: Date
  route: RouteCode
  phase: Phase
  station?: StationCode      // ใช้เมื่อ phase = sample / production
  status?: StationStatus
  since: Date                // เวลาที่เข้าขั้นปัจจุบัน
  sampleRound: number
  needsSample?: boolean      // false = ลูกค้าไม่จ่ายค่าตัวอย่าง เข้าผลิตจริงเลย
  develop?: boolean          // งาน Develop: ลูกค้ายืนยันตัวอย่างผ่าน = งานเสร็จ ไม่ผลิตจริง
  materials: Record<Dept, boolean>
  materialLines?: { name: string; eta: Date | null; checked: boolean }[]  // เฉพาะงานรอผลิต
  film?: { eta: Date; received: boolean }  // เฉพาะเส้นทางที่สั่งฟิล์ม (DTF / DTG / สกรีน)
  sewCount?: number
  sewingReports?: { reason: string; at: Date; paused: boolean }[]
  mockup?: string            // path รูปม็อคอัพใน Storage (mockups)
  mockupUrl?: string         // ลิงก์ชั่วคราวสำหรับแสดงรูป · ไม่มี = แสดงกรอบว่าง
  rework?: { qty: number; reason: string }
  holdReason?: string
  heldSince?: Date
  doneAt?: Date
  delivered?: { at: Date; note: string }  // แอดมินบันทึกส่งให้ลูกค้าแล้ว (เฉพาะงานเสร็จ)
  queue?: number             // jobs.queue_seq · แทรกงานด่วนได้
  out?: OutRun
  sla?: SlaLevel             // ไม่มี = ยังไม่ถึง 80% ของเวลาผลิต
  lead?: { days: number; due: string }  // เวลาผลิตทั้งงาน (วันทำงาน) · due = วันที่ไทยที่ต้องเสร็จ
  specSheet?: { id: string; rev: number; acked: StationCode[] }
  photos?: PhotoGate         // ไม่มี = รอบนี้ไม่ต้องส่งรูป (ยังไม่เปิดใช้ หรือเริ่มก่อนเปิดใช้)
  revision?: JobRevision     // ไม่มี = ใบยืนยันยังไม่เคยแก้หลังรับงาน
}

export type JobRevision = { rev: number; at: Date; by: string | null; fields: string[]; summary: string[]; eventId: number; acked: StationCode[] }

export type FirstPieceStatus = 'pending' | 'approved' | 'rejected'
export type PhotoGate = {
  station: StationCode
  needsFirstPiece: boolean
  firstPiece?: { status: FirstPieceStatus; id: number; at: Date; reason?: string }
  finishPhotos: number
  folder: string
  visit: number
  remindMinutes: number
}

// ส้ม = ใช้เวลาผลิตถึง 80% · แดง = เกินแล้ว (report = ยังไม่รายงานสาเหตุ · over = รายงานแล้ว)
export type SlaLevel = 'warn' | 'over' | 'report'
export const SLA_LABEL: Record<SlaLevel, { tone: 'warn' | 'danger'; text: string }> = {
  warn: { tone: 'warn', text: 'ใกล้ครบเวลาผลิต' },
  over: { tone: 'danger', text: 'เกินเวลาผลิต' },
  report: { tone: 'danger', text: 'เกินเวลาผลิต · ต้องรายงาน' },
}

// ฐานข้อมูลบังคับรายงานเฉพาะตอนปิดงานที่ QC + Packing (finish_station)
export const leadReportBlocksFinish = (j: Job) => j.sla === 'report' && j.phase === 'production' && j.station === 'qc_pack'

// รอบส่งออกที่ยังเปิดอยู่ (outsource_runs) · บริษัททำ stations แล้วของถึงที่ต่อไปตาม backAt
export type OutRun = {
  id: number; vendor: string; vendorId: number; stations: StationCode[]; qty: number; rework: boolean
  sentAt: Date; arriveAt: Date; leadDays: number; backAt: Date; note?: string
  phone?: string; mapUrl?: string
}
// kind: outsource = รับงานไปทำแทน · supplier = ร้านขายวัตถุดิบ/ฟิล์ม (ไม่ขึ้นในรายการส่งออก)
export type Vendor = {
  id: number; name: string; stations: StationCode[]; kind: 'outsource' | 'supplier'
  phone?: string; address?: string; mapUrl?: string; specialty?: string; contact?: string
}
/** ลิงก์โทรจากเบอร์ในชีต (มีชื่อคน/ตัวอักษรปน · บางเบอร์ไม่มี 0 นำหน้า) · ไม่ใช่เบอร์ = undefined */
export function telHref(phone?: string): string | undefined {
  const digits = (phone ?? '').match(/[\d\s-]{8,}/)?.[0].replace(/\D/g, '') ?? ''
  if (digits.length < 9 || digits.length > 10) return undefined
  return `tel:${digits.length === 9 && !digits.startsWith('0') ? '0' + digits : digits}`
}
/** สถานีที่ส่งออกได้ (ตรงกับ private.outsourceable ในฐานข้อมูล) */
export const OUTSOURCEABLE: StationCode[] = ['outside', 'print', 'press', 'cut', 'dtf_press', 'sew', 'emb']
export const OUTSIDE_START_BLOCK = 'งานผลิตข้างนอกทั้งหมด เริ่มที่โรงงานไม่ได้ · แอดมินกด "ส่งออกบริษัทภายนอก" แล้วกด "รับเข้า" เมื่อของถึง'
export const isOutLate = (j: Job, now: Date) => !!j.out && j.out.backAt.getTime() < now.getTime()

export type ColumnKey = 'materials' | 'sample' | 'sample_review' | StationCode | 'done'
export const COLUMNS: { key: ColumnKey; name: string }[] = [
  { key: 'materials', name: 'รอผลิต' },
  { key: 'sample', name: 'ขึ้นตัวอย่าง' },
  { key: 'sample_review', name: 'รอผลตัวอย่าง' },
  { key: 'print', name: 'พิมพ์' },
  { key: 'press', name: 'รีด' },
  { key: 'cut', name: 'ตัด' },
  { key: 'dtf_press', name: 'รีดฟิล์ม' },
  { key: 'emb', name: 'ส่งปัก' },
  { key: 'outside', name: 'สั่งผลิตข้างนอก' },
  { key: 'sew', name: 'เย็บ' },
  { key: 'qc_pack', name: 'QC + Packing' },
  { key: 'done', name: 'เสร็จ' },
]

export const STATION_GROUPS: { name: string; keys: ColumnKey[] }[] = [
  { name: 'ก่อนผลิต', keys: ['materials', 'sample', 'sample_review'] },
  { name: 'เฟส 1', keys: ['print', 'press', 'cut', 'dtf_press', 'emb', 'outside'] },
  { name: 'เฟส 2', keys: ['sew', 'qc_pack', 'done'] },
]

// คอลัมน์ที่ไม่อยู่ในกลุ่มใดไปต่อท้ายกลุ่มสุดท้าย
export function groupColumns<C extends { key: ColumnKey }>(columns: readonly C[]): { name: string; columns: C[] }[] {
  const grouped = STATION_GROUPS.map(g => ({ name: g.name, columns: columns.filter(c => g.keys.includes(c.key)) }))
  const known = new Set(STATION_GROUPS.flatMap(g => g.keys))
  const rest = columns.filter(c => !known.has(c.key))
  if (rest.length) grouped[grouped.length - 1].columns.push(...rest)
  return grouped.filter(g => g.columns.length > 0)
}

// ใช้ได้เฉพาะสถานีที่บทบาทนี้ยังเห็นอยู่
export function savedStation(raw: string | null, columns: readonly { key: ColumnKey }[]): ColumnKey | 'all' {
  return columns.some(c => c.key === raw) ? raw as ColumnKey : 'all'
}

// พนักงานที่มีสถานีเดียวเปิดมาเจอคิวสถานีตัวเองเลย จนกว่าจะเลือกดูทุกสถานีเอง
export function startStation(raw: string | null, columns: readonly { key: ColumnKey }[], floorRole: boolean): ColumnKey | 'all' {
  const saved = savedStation(raw, columns)
  if (saved !== 'all' || raw === 'all' || !floorRole) return saved
  const own = columns.filter(c => isStationCode(c.key))
  return own.length === 1 ? own[0].key : 'all'
}

export function columnOf(j: Job): ColumnKey {
  // กันข้อมูลเพี้ยน: งานผลิตที่ไม่มีสถานี ให้ไปอยู่สถานีแรกของเส้นทาง
  if (j.phase === 'production') return j.station ?? ROUTES[j.route].stations[0]
  return j.phase
}

const DAY = 86_400_000
// ใช้เรียงลำดับ (ไม่ใช้ตัดสินวัน) · การตัดสินว่า "วันไหน" ต้องใช้ thaiDay
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// แท็บเล็ตที่ตั้งเขตเวลาผิดต้องยังขึ้นเลยกำหนดทันทีหลังเที่ยงคืนไทย
const thaiDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
export const thaiDay = (d: Date) => thaiDayFormat.format(d)
// เที่ยงคืนตามเวลาเครื่องของ "วันไทย" นั้น · ใช้นับวันทำงานให้ตรงวันไทยแม้แท็บเล็ตตั้งเขตเวลาผิด
export function thaiStart(d: Date): Date {
  const [y, m, day] = thaiDay(d).split('-').map(Number)
  return new Date(y, m - 1, day)
}
// ติดลบ = a อยู่ก่อน b
export function thaiDayDiff(a: Date, b: Date) {
  return Math.round((Date.parse(thaiDay(a)) - Date.parse(thaiDay(b))) / DAY)
}

// ตามลำดับรับเข้าเสมอ ไม่ใช่กำหนดส่ง · งานด่วนแทรกคิวในฐานข้อมูล · ไม่มีเลขคิว (ข้อมูลจำลอง) ใช้เวลาเข้าขั้น
export function byQueue(a: Job, b: Job) {
  return (a.queue ?? Infinity) - (b.queue ?? Infinity) || a.since.getTime() - b.since.getTime() || a.id.localeCompare(b.id)
}
// งานพักกดอะไรที่สถานีไม่ได้ จึงไว้หลังงานที่กำลังทำ ให้ปุ่มเสร็จอยู่บนสุด
export function doingFirst(a: Job, b: Job) {
  return Number(a.status === 'hold') - Number(b.status === 'hold') || byQueue(a, b)
}
const inStation = (j: Job) => (j.phase === 'sample' || j.phase === 'production') && !!j.station
// ตรงกับที่ฐานข้อมูลใช้ตรวจเริ่มข้ามคิว (note_queue_skip)
export function waitingAt(jobs: Job[], station: StationCode): Job[] {
  return jobs.filter(j => inStation(j) && j.station === station && j.status === 'queued').sort(byQueue)
}
// 1 = คิวแรก · ไม่ได้รอเริ่ม = undefined
export function queueNo(job: Job, jobs: Job[]): number | undefined {
  if (!job.station || job.status !== 'queued' || !inStation(job)) return undefined
  const i = waitingAt(jobs, job.station).findIndex(j => j.id === job.id)
  return i < 0 ? undefined : i + 1
}

// คิวแรกของสถานีเมื่องานนี้ยังไม่ถึงคิว (เริ่มก่อนต้องมีเหตุผล) · เป็นคิวแรกเอง / ไม่ได้รอเริ่ม = undefined
export function queueHead(job: Job, jobs: Job[]): Job | undefined {
  if (!job.station || job.status !== 'queued' || !inStation(job)) return undefined
  const first = waitingAt(jobs, job.station)[0]
  return first && first.id !== job.id ? first : undefined
}

export function stationCounts(jobs: Job[], now: Date) {
  return COLUMNS.filter(c => c.key in STATION_NAME).map(c => {
    const here = jobs.filter(j => (j.phase === 'sample' || j.phase === 'production') && j.station === c.key)
    return {
      key: c.key as StationCode, name: c.name,
      waiting: here.filter(j => j.status === 'queued').length,
      doing: here.filter(j => j.status === 'doing').length,
      hold: here.filter(j => j.status === 'hold').length,
      out: here.filter(j => j.status === 'out').length,
      late: here.filter(j => isOverdue(j, now)).length,
    }
  })
}

// เวลางานโรงงาน 09:00–18:00 (จันทร์–เสาร์) · ที่เดียวที่กำหนด หน้าจอที่แปลง "วันที่" เป็นเวลาใช้ค่านี้ทั้งหมด
export const WORK_START = '09:00'
export const WORK_END = '18:00'
// ระบุ +07:00 จึงไม่เพี้ยนตามเขตเวลาเครื่อง
export const thaiWorkEnd = (day: string) => new Date(`${day}T${WORK_END}:00+07:00`)

export function isOverdue(j: Job, now: Date) {
  return j.phase !== 'done' && thaiDay(j.due) < thaiDay(now)
}
export function isDueSoon(j: Job, now: Date) {
  const days = thaiDayDiff(j.due, now)
  return j.phase !== 'done' && days >= 0 && days <= 2
}
// รีดฟิล์มส่งบริษัทภายนอกทำได้ ฟิล์มจึงอาจไม่เคยถูกบันทึกว่าได้รับ ทั้งที่งานผ่านสถานีรีดฟิล์มไปแล้ว
export function isPastFilmPress(j: Job) {
  if (j.phase === 'done' || j.rework) return true
  if ((j.phase !== 'production' && j.phase !== 'sample') || !j.station) return false
  const stations = ROUTES[j.route].stations
  return stations.includes('dtf_press') && stations.indexOf(j.station) > stations.indexOf('dtf_press')
}
export function needsFilm(j: Job) {
  return usesFilm(j.route) && !j.film?.received && !isPastFilmPress(j)
}
export function isWaitingFilm(j: Job) {
  return !!j.film && needsFilm(j)
}
// เส้นทางฟิล์มที่แอดมินยังไม่ได้บันทึกสั่ง และงานยังไม่ผ่านสถานีรีดฟิล์ม
export function isFilmNotOrdered(j: Job) {
  if (!usesFilm(j.route) || j.film || j.phase === 'done') return false
  if (j.develop && j.phase === 'sample_review') return false
  if (j.phase !== 'production' || !j.station) return true
  const stations = ROUTES[j.route].stations
  return stations.indexOf(j.station) <= stations.indexOf('dtf_press')
}
export function isFilmLate(j: Job, now: Date) {
  return isWaitingFilm(j) && thaiDay(j.film!.eta) < thaiDay(now)
}
export function isDoneToday(j: Job, now: Date) {
  return j.phase === 'done' && !!j.doneAt && thaiDay(j.doneAt) === thaiDay(now)
}
export function missingDepts(j: Job): Dept[] {
  return (Object.keys(j.materials) as Dept[]).filter(d => !j.materials[d])
}
