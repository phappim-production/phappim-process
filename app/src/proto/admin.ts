import { ROLE_LABELS, type EmployeeRole } from '../auth/access.ts'

export type AuditRow = {
  id: number; at: string; by: string | null; table_name: string; row_key: string
  action: 'insert' | 'update' | 'delete'; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null
}

export const TABLE_LABEL: Record<string, string> = {
  profiles: 'ผู้ใช้', staff_stations: 'จับคู่พนักงานกับสถานี', stations: 'สถานี', route_stations: 'เส้นทางผลิต',
  sla_segments: 'เวลามาตรฐานของช่วง', material_templates: 'แม่แบบวัตถุดิบ', reason_codes: 'รหัสสาเหตุ',
  sewing_machines: 'จักรเย็บ', machine_types: 'ชนิดจักร', product_machine_needs: 'สูตรจักรต่อสินค้า',
  inbox_settings: 'การแจ้งเตือน', product_types: 'สินค้า', routes: 'เส้นทาง', station_photo_settings: 'ระบบรูปยืนยันงาน',
}
const SINGLE_ROW_TABLES = new Set(['station_photo_settings'])
const FIELD_LABEL: Record<string, string> = {
  name: 'ชื่อ', role: 'บทบาท', active: 'ใช้งาน', section: 'เฟส', code: 'รหัส', sort: 'ลำดับ',
  enabled: 'เปิดแจ้งเตือน', enabled_at: 'เปิดใช้เมื่อ', remind_minutes: 'เตือนเมื่อรอเกิน (นาที)',
  first_piece_check: 'รออนุมัติชิ้นแรก', sla_days: 'เวลามาตรฐาน (วัน)', big_qty: 'จำนวนที่นับเป็นงานใหญ่',
  big_sla_days: 'เวลามาตรฐานงานใหญ่ (วัน)', warn_pct: 'เตือนที่ (%)', machines: 'จำนวนเครื่อง', machine_pool: 'ใช้เครื่องร่วมกับ',
  substeps: 'ขั้นย่อย', status: 'สถานะ', type_code: 'ชนิดจักร', shared: 'ใช้ร่วมกัน', station_code: 'สถานี', user_id: 'ผู้ใช้',
}
const ACTION_LABEL = { insert: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ' } as const
const HIDDEN_FIELDS = new Set(['created_at', 'updated_at'])

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const thaiTime = (iso: string) => new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' น.'
const show = (v: unknown) => v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'ใช่' : 'ไม่')
  : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'string' && TIMESTAMP.test(v) ? thaiTime(v) : String(v)

export function auditChanges(row: AuditRow): string[] {
  if (row.action !== 'update' || !row.old_row || !row.new_row) return []
  const keys = [...new Set([...Object.keys(row.old_row), ...Object.keys(row.new_row)])].filter(k => !HIDDEN_FIELDS.has(k))
  return keys
    .filter(k => JSON.stringify(row.old_row![k]) !== JSON.stringify(row.new_row![k]))
    .map(k => `${FIELD_LABEL[k] ?? k}: ${show(k === 'role' ? roleName(row.old_row![k]) : row.old_row![k])} → ${show(k === 'role' ? roleName(row.new_row![k]) : row.new_row![k])}`)
}

function roleName(v: unknown) {
  return typeof v === 'string' && Object.hasOwn(ROLE_LABELS, v) ? ROLE_LABELS[v as EmployeeRole] : v
}

export function auditTitle(row: AuditRow, name: (id: string) => string): string {
  const table = TABLE_LABEL[row.table_name] ?? row.table_name
  const subject = row.new_row ?? row.old_row ?? {}
  if (SINGLE_ROW_TABLES.has(row.table_name)) return `${ACTION_LABEL[row.action]}${table}`
  const label = row.table_name === 'profiles' ? name(row.row_key)
    : row.table_name === 'staff_stations' ? `${name(String(subject.user_id ?? ''))} · ${String(subject.station_code ?? '')}`
    : String(subject.name ?? subject.code ?? row.row_key)
  return `${ACTION_LABEL[row.action]}${table}: ${label}`
}

export type ReviewItem = { kind: 'delay_report' | 'queue_event'; ref: number; jobId: string; at: string }

export function pendingReviews<T extends ReviewItem>(items: T[], acked: { kind: string; ref_id: number }[]): T[] {
  const done = new Set(acked.map(a => `${a.kind}:${a.ref_id}`))
  return items.filter(i => !done.has(`${i.kind}:${i.ref}`)).sort((a, b) => a.at.localeCompare(b.at))
}

export function roleCounts(users: { role: EmployeeRole | null; active: boolean | null }[]): { role: EmployeeRole; n: number }[] {
  const out = new Map<EmployeeRole, number>()
  for (const u of users) if (u.role && u.active) out.set(u.role, (out.get(u.role) ?? 0) + 1)
  return (Object.keys(ROLE_LABELS) as EmployeeRole[]).filter(r => out.has(r)).map(role => ({ role, n: out.get(role)! }))
}
