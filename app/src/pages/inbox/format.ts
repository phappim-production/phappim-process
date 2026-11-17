import type { Tone } from '../../components/tone.ts'

export type InboxKind =
  | 'hold'
  | 'delay_report'
  | 'rework'
  | 'sewing_issue'
  | 'machine_broken'
  | 'sample_failed'
  | 'sla_over'
  | 'film_late'
  | 'materials_late'
  | 'due_soon'

export type InboxItem = {
  id: number
  kind: InboxKind
  jobId: string | null
  title: string
  body: string
  createdAt: Date
  read: boolean
}

const DANGER_KINDS = new Set<InboxKind>([
  'hold',
  'sla_over',
  'film_late',
  'rework',
  'machine_broken',
  'sample_failed',
])

const KIND_LABELS: Record<InboxKind, string> = {
  hold: 'พักงาน',
  sla_over: 'เกินเวลา',
  film_late: 'ฟิล์มช้า',
  rework: 'งานแก้',
  machine_broken: 'จักรเสีย',
  sample_failed: 'ตัวอย่างไม่ผ่าน',
  due_soon: 'ใกล้กำหนดส่ง',
  materials_late: 'รอวัตถุดิบ',
  delay_report: 'รายงานล่าช้า',
  sewing_issue: 'ปัญหาเย็บ',
}

/** สีตามความหมายของเหตุการณ์ (แดง = ติดปัญหา/เลยกำหนด · ส้ม = ใกล้ครบ/รอ) */
export function kindTone(kind: InboxKind): Tone {
  return DANGER_KINDS.has(kind) ? 'danger' : 'warn'
}

export function kindLabel(kind: InboxKind): string {
  return KIND_LABELS[kind] ?? kind
}

/** วันที่ไทย YYYY-MM-DD เพื่อเทียบวันนี้/เมื่อวานไม่เพี้ยนตามเขตเวลาเครื่อง */
function thaiDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function thaiTime(d: Date): string {
  return d.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** ข้อความเวลาสัมพัทธ์ภาษาไทย เช่น "5 นาทีก่อน" */
export function relativeTime(at: Date, now: Date): string {
  const diffMs = Math.max(0, now.getTime() - at.getTime())
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'เมื่อสักครู่'
  if (mins < 60) return `${mins} นาทีก่อน`

  const atDay = thaiDayKey(at)
  const nowDay = thaiDayKey(now)
  if (atDay === nowDay) {
    return `${Math.floor(mins / 60)} ชม.ก่อน`
  }

  const yesterday = thaiDayKey(new Date(now.getTime() - 86_400_000))
  if (atDay === yesterday) {
    return `เมื่อวาน ${thaiTime(at)}`
  }

  const datePart = at.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
  })
  return `${datePart} ${thaiTime(at)}`
}

export type InboxGroup = {
  label: 'วันนี้' | 'เมื่อวาน' | 'ก่อนหน้า'
  items: InboxItem[]
}

/** เรียงใหม่สุดก่อน และกรองตามสถานะการอ่าน */
export function filterInbox(items: InboxItem[], filter: 'unread' | 'all'): InboxItem[] {
  const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
  return filter === 'unread' ? sorted.filter(item => !item.read) : sorted
}

/** จัดกลุ่มรายการเป็น วันนี้ / เมื่อวาน / ก่อนหน้า ตามเวลาไทย */
export function groupByDay(items: InboxItem[], now: Date): InboxGroup[] {
  const today = thaiDayKey(now)
  const yesterday = thaiDayKey(new Date(now.getTime() - 86_400_000))

  const buckets: Record<InboxGroup['label'], InboxItem[]> = {
    วันนี้: [],
    เมื่อวาน: [],
    ก่อนหน้า: [],
  }

  for (const item of items) {
    const day = thaiDayKey(item.createdAt)
    if (day === today) buckets['วันนี้'].push(item)
    else if (day === yesterday) buckets['เมื่อวาน'].push(item)
    else buckets['ก่อนหน้า'].push(item)
  }

  const order: InboxGroup['label'][] = ['วันนี้', 'เมื่อวาน', 'ก่อนหน้า']
  return order.filter(label => buckets[label].length > 0).map(label => ({ label, items: buckets[label] }))
}

/** ตัวเลขบนปุ่มกระดิ่ง (ซ่อนเมื่อ 0 · เกิน 99 แสดง 99+) */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null
  return count > 99 ? '99+' : String(count)
}
