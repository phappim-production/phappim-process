// เฟส 1 (ต้นแบบ): รูปแบบข้อมูลงานฝั่งหน้าจอ + ข้อมูลตั้งค่าที่คัดจาก supabase/migrations/20261116000002_master_data.sql
// เฟส 2 จะเปลี่ยนไปอ่านจากฐานข้อมูลจริง (ตาราง jobs, stations, routes)

export type StationCode = 'print' | 'press' | 'cut' | 'dtf_press' | 'sew' | 'qc_pack'
export type RouteCode = 'normal' | 'dtf' | 'plain'
export type Dept = 'admin' | 'qc' | 'production'
export type Phase = 'materials' | 'sample' | 'sample_review' | 'production' | 'done'
export type StationStatus = 'queued' | 'doing' | 'hold'

export const STATION_NAME: Record<StationCode, string> = {
  print: 'พิมพ์งาน',
  press: 'รีดงาน',
  cut: 'ตัดงาน',
  dtf_press: 'รีด DTF',
  sew: 'เย็บงาน',
  qc_pack: 'QC + Packing',
}

export const ROUTES: Record<RouteCode, { name: string; short: string; stations: StationCode[] }> = {
  normal: { name: 'ปกติ (ซับลิเมชั่น / ดิจิทัล)', short: 'ปกติ', stations: ['print', 'press', 'cut', 'sew', 'qc_pack'] },
  dtf: { name: 'DTF', short: 'DTF', stations: ['cut', 'dtf_press', 'sew', 'qc_pack'] },
  plain: { name: 'ไม่มีงานพิมพ์', short: 'ไม่พิมพ์', stations: ['cut', 'sew', 'qc_pack'] },
}

export const DEPT_NAME: Record<Dept, string> = { admin: 'แอดมิน', qc: 'QC', production: 'ฝ่ายผลิต' }

export const STATUS_NAME: Record<StationStatus, string> = { queued: 'รอคิว', doing: 'กำลังทำ', hold: 'ติดปัญหา' }

export type Job = {
  id: string
  no: string                 // เลขที่ใบยืนยัน
  customer: string
  product: string
  productCode?: string       // product_types.code · ใช้หาจักรที่สินค้าต้องใช้
  unit: string
  qty: number
  due: Date
  route: RouteCode
  phase: Phase
  station?: StationCode      // ใช้เมื่อ phase = sample / production
  status?: StationStatus
  since: Date                // เวลาที่เข้าขั้นปัจจุบัน
  sampleRound: number
  materials: Record<Dept, boolean>
  film?: { eta: Date; received: boolean }  // เฉพาะเส้นทาง DTF
  sewCount?: number
  sewingReports?: { reason: string; at: Date; paused: boolean }[]
  rework?: { qty: number; reason: string }
  holdReason?: string
  doneAt?: Date
}

// คอลัมน์ของบอร์ด (DEVELOPMENT.md หัวข้อ 8)
export type ColumnKey = 'materials' | 'sample' | 'sample_review' | StationCode | 'done'
export const COLUMNS: { key: ColumnKey; name: string }[] = [
  { key: 'materials', name: 'รอวัตถุดิบ' },
  { key: 'sample', name: 'ขึ้นตัวอย่าง' },
  { key: 'sample_review', name: 'รอผลตัวอย่าง' },
  { key: 'print', name: 'พิมพ์' },
  { key: 'press', name: 'รีด' },
  { key: 'cut', name: 'ตัด' },
  { key: 'dtf_press', name: 'รีด DTF' },
  { key: 'sew', name: 'เย็บ' },
  { key: 'qc_pack', name: 'QC + Packing' },
  { key: 'done', name: 'เสร็จ' },
]

export function columnOf(j: Job): ColumnKey {
  // กันข้อมูลเพี้ยน: งานผลิตที่ไม่มีสถานี ให้ไปอยู่สถานีแรกของเส้นทาง
  if (j.phase === 'production') return j.station ?? ROUTES[j.route].stations[0]
  return j.phase
}

const DAY = 86_400_000
// ใช้เรียงลำดับ (ไม่ใช้ตัดสินวัน) · การตัดสินว่า "วันไหน" ต้องใช้ thaiDay
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// วันตามปฏิทินไทย (YYYY-MM-DD) ไม่ขึ้นกับเขตเวลาของเครื่อง
// แท็บเล็ตที่ตั้งเขตเวลาผิดต้องยังขึ้นแดง "เลยกำหนด" ทันทีหลังเที่ยงคืนไทย ไม่ใช่ช้าไปหลายชั่วโมง
const thaiDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
export const thaiDay = (d: Date) => thaiDayFormat.format(d)
/** a อยู่หลัง b กี่วันตามปฏิทินไทย (ติดลบ = ก่อน) */
export function thaiDayDiff(a: Date, b: Date) {
  return Math.round((Date.parse(thaiDay(a)) - Date.parse(thaiDay(b))) / DAY)
}

export function isOverdue(j: Job, now: Date) {
  return j.phase !== 'done' && thaiDay(j.due) < thaiDay(now)
}
export function isDueSoon(j: Job, now: Date) {
  const days = thaiDayDiff(j.due, now)
  return j.phase !== 'done' && days >= 0 && days <= 2
}
export function isWaitingFilm(j: Job) {
  if (j.route !== 'dtf' || !j.film || j.film.received || j.phase === 'done') return false
  return true
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
