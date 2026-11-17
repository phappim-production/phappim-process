// แปลงแถวจากฐานข้อมูลจริง (view job_live และตารางจักร) เป็นรูปแบบที่หน้าจอใช้ (proto/model · proto/sewing)
// แยกเป็น pure function เพื่อทดสอบได้โดยไม่ต้องต่อ Supabase · ตัวดึงข้อมูลอยู่ที่ useFactoryData.ts
import { usesFilm, type Dept, type Job, type Phase, type RouteCode, type StationCode, type StationStatus } from '../proto/model.ts'
import type { Booking, Machine, MachineStatus, MachineType, Need } from '../proto/sewing.ts'

export type JobRow = {
  id: string
  confirmation_no: string
  customer_name: string
  job_name: string | null
  product_type_code: string
  qty: number
  unit: string
  due_date: string                // YYYY-MM-DD
  route_code: RouteCode
  phase: Phase | 'cancelled'
  current_station: StationCode | null
  station_status: StationStatus | null
  stage_entered_at: string
  sample_round: number
  needs_sample?: boolean     // ไม่มีในแถวเก่า = ขึ้นตัวอย่าง
  materials_waiting_depts: Dept[] | null
  dtf_film_eta: string | null
  dtf_film_received_at: string | null
  sew_count: number
  is_rework: boolean
  rework_qty: number | null
  hold_reason: string | null
  finished_at: string | null
}
export type ProductRow = { code: string; name: string }
export type ReworkRow = { job_id: string; failed: number; reasons: string[] | null; at: string }
export type SewEventRow = { job_id: string; type: string; payload: { reason?: string } | null; at: string }
export type MachineRow = { id: number; code: string; type_code: MachineType; status: MachineStatus; note: string | null; repair_eta: string | null; sort: number }
export type AssignmentRow = { machine_id: number; job_id: string }
export type BookingRow = { id: number; machine_id: number; job_id: string; starts_at: string; ends_at: string }
export type NeedRow = { product_type_code: string; type_code: MachineType; qty: number }

// กำหนดส่งเป็นวันที่ไทย · ใช้ 17:00 (เลิกงาน) เหมือนข้อมูลจำลองเดิม การเทียบวันจึงไม่เพี้ยนตามเขตเวลาเครื่อง
export function dueDate(day: string): Date {
  return new Date(`${day}T17:00:00+07:00`)
}

const DEPTS: Dept[] = ['admin', 'qc', 'production']

export function toJobs(rows: JobRow[], products: ProductRow[], reworks: ReworkRow[], sewEvents: SewEventRow[]): Job[] {
  const productName = new Map(products.map(p => [p.code, p.name]))
  // สาเหตุงานแก้ล่าสุดของแต่ละงาน
  const reworkReason = new Map<string, string>()
  for (const r of [...reworks].sort((a, b) => a.at.localeCompare(b.at))) {
    if (r.failed > 0) reworkReason.set(r.job_id, r.reasons?.[0] ?? '')
  }
  const reports = new Map<string, Job['sewingReports']>()
  for (const e of [...sewEvents].sort((a, b) => a.at.localeCompare(b.at))) {
    const reason = e.payload?.reason?.trim()
    if (!reason) continue
    const list = reports.get(e.job_id) ?? []
    list.push({ reason, at: new Date(e.at), paused: e.type === 'hold' })
    reports.set(e.job_id, list)
  }

  return rows.filter(r => r.phase !== 'cancelled').map(r => {
    const waiting = new Set(r.materials_waiting_depts ?? [])
    const job: Job = {
      id: r.id,
      no: r.confirmation_no,
      customer: r.customer_name,
      product: productName.get(r.product_type_code) ?? r.job_name ?? r.product_type_code,
      productCode: r.product_type_code,
      unit: r.unit,
      qty: r.qty,
      due: dueDate(r.due_date),
      route: r.route_code,
      phase: r.phase as Phase,
      since: new Date(r.stage_entered_at),
      sampleRound: r.sample_round,
      needsSample: r.needs_sample ?? true,
      materials: Object.fromEntries(DEPTS.map(d => [d, !waiting.has(d)])) as Record<Dept, boolean>,
    }
    if (r.current_station) job.station = r.current_station
    if (r.station_status) job.status = r.station_status
    if (usesFilm(r.route_code) && r.dtf_film_eta) job.film = { eta: dueDate(r.dtf_film_eta), received: !!r.dtf_film_received_at }
    if (r.sew_count > 0) job.sewCount = r.sew_count
    if (r.is_rework) job.rework = { qty: r.rework_qty ?? 0, reason: reworkReason.get(r.id) ?? '' }
    if (r.hold_reason) job.holdReason = r.hold_reason
    if (r.finished_at) job.doneAt = new Date(r.finished_at)
    const list = reports.get(r.id)
    if (list) job.sewingReports = list
    return job
  })
}

export function toMachines(rows: MachineRow[], assignments: AssignmentRow[]): Machine[] {
  const jobOf = new Map(assignments.map(a => [a.machine_id, a.job_id]))
  return [...rows].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code)).map(r => {
    const m: Machine = { id: String(r.id), code: r.code, type: r.type_code, status: r.status }
    const jobId = jobOf.get(r.id)
    if (jobId) m.jobId = jobId
    if (r.note) m.note = r.note
    if (r.repair_eta) m.repairEta = new Date(r.repair_eta)
    return m
  })
}

export function toBookings(rows: BookingRow[]): Booking[] {
  return rows.map(r => ({ id: String(r.id), machineId: String(r.machine_id), jobId: r.job_id, starts: new Date(r.starts_at), ends: new Date(r.ends_at) }))
}

// จักรใช้ร่วม (machine_types.shared · เช่น จักรลา) ไม่ผูกกับงาน จึงไม่นับเป็นจักรที่ไลน์ต้องได้ครบ
// ตรงกับ start_sewing / book_machines / machines_short ในฐานข้อมูล (20261119210000)
export type MachineTypeRow = { code: MachineType; shared: boolean | null }
export function toNeeds(rows: NeedRow[], shared: ReadonlySet<MachineType> = new Set()): Record<string, Need[]> {
  const map: Record<string, Need[]> = {}
  for (const r of rows) {
    if (shared.has(r.type_code)) continue
    ;(map[r.product_type_code] ??= []).push({ type: r.type_code, qty: r.qty })
  }
  return map
}
export function sharedTypes(rows: MachineTypeRow[]): MachineType[] {
  return rows.filter(r => r.shared).map(r => r.code)
}

// ข้อความจากฐานข้อมูลเป็นภาษาไทยอยู่แล้ว (บอกว่าต้องทำอะไร) · ข้อความระบบภาษาอังกฤษไม่แสดงให้คนหน้างาน
export function thaiError(message: string | undefined): string {
  if (message && /[฀-๿]/.test(message)) return message
  if (message && /fetch|network|timeout|offline/i.test(message)) return 'เชื่อมต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง'
  // ข้อความจาก Storage ตอนอัปโหลด PDF ใบยืนยัน
  if (message && /exceeded|too large|maximum allowed size|payload too large/i.test(message)) return 'ไฟล์ใหญ่เกิน 20 MB ให้ย่อไฟล์ก่อน หรือใช้ PDF ที่ฟอร์มสร้าง'
  if (message && /mime|content.?type/i.test(message)) return 'ไฟล์ต้องเป็น PDF'
  if (message && /bucket not found/i.test(message)) return 'ระบบยังไม่พร้อมรับไฟล์ PDF แจ้งเจ้าของระบบ'
  if (message && /permission denied|row-level security|jwt/i.test(message)) return 'บัญชีนี้ทำรายการนี้ไม่ได้ ถ้าเพิ่งเปลี่ยนบทบาทให้ออกจากระบบแล้วเข้าใหม่'
  return 'ทำรายการไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้แจ้งเจ้าของระบบ'
}
