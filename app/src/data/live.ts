// แยกเป็น pure function เพื่อทดสอบได้โดยไม่ต้องต่อ Supabase
import { isStationCode, thaiDay, thaiWorkEnd, usesFilm, type OutRun, type Vendor, type Dept, type Job, type Phase, type RouteCode, type SlaLevel, type StationCode, type StationStatus } from '../proto/model.ts'
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
  develop?: boolean
  materials_waiting_depts: Dept[] | null
  dtf_film_eta: string | null
  dtf_film_received_at: string | null
  sew_count: number
  is_rework: boolean
  rework_qty: number | null
  hold_reason: string | null
  finished_at: string | null
  queue_seq?: number | string     // numeric จาก PostgREST อาจมาเป็นข้อความ
  mockup_path?: string | null
  delivered_at?: string | null
  delivery_note?: string | null
}
export type ProductRow = { code: string; name: string }
export type ReworkRow = { job_id: string; failed: number; reasons: string[] | null; at: string }
export type SewEventRow = { job_id: string; type: string; payload: { reason?: string } | null; at: string }
export type MachineRow = { id: number; code: string; type_code: MachineType; status: MachineStatus; note: string | null; repair_eta: string | null; sort: number }
export type AssignmentRow = { machine_id: number; job_id: string }
export type BookingRow = { id: number; machine_id: number; job_id: string; starts_at: string; ends_at: string }
export type VendorRow = {
  id: number; name: string; stations: StationCode[] | null; kind?: 'outsource' | 'supplier' | null
  phone?: string | null; address?: string | null; map_url?: string | null; specialty?: string | null; contact?: string | null
}
export type OutRunRow = {
  id: number; job_id: string; vendor_id: number; stations: StationCode[]; qty: number; is_rework: boolean
  sent_at: string; arrive_at: string; lead_days: number | string; back_at: string; note: string | null
}
export function toVendors(rows: VendorRow[]): Vendor[] {
  return rows.map(r => {
    const v: Vendor = { id: Number(r.id), name: r.name, stations: r.stations ?? [], kind: r.kind ?? 'outsource' }
    if (r.phone) v.phone = r.phone
    if (r.address) v.address = r.address
    if (r.map_url) v.mapUrl = r.map_url
    if (r.specialty) v.specialty = r.specialty
    if (r.contact) v.contact = r.contact
    return v
  }).sort((a, b) => a.name.localeCompare(b.name, 'th'))
}
// 1 งาน = 1 รอบเปิด
export type SlaFlagRow = { job_id: string; warn: boolean; over: boolean; need_report: boolean; lead_days?: number | null; lead_due?: string | null }

// งานที่ไม่ส่งมา = ปกติ
export function attachSla(jobs: Job[], rows: SlaFlagRow[]): Job[] {
  const byJob = new Map(rows.map(r => [r.job_id, r]))
  return jobs.map(j => {
    const r = byJob.get(j.id)
    const sla: SlaLevel | undefined = !r ? undefined : r.need_report ? 'report' : r.over ? 'over' : r.warn ? 'warn' : undefined
    const lead = r?.lead_days && r.lead_due ? { days: r.lead_days, due: r.lead_due.slice(0, 10) } : undefined
    if (sla === j.sla && lead?.due === j.lead?.due && lead?.days === j.lead?.days) return j
    const { sla: _sla, lead: _lead, ...rest } = j
    return { ...rest, ...(sla ? { sla } : {}), ...(lead ? { lead } : {}) }
  })
}

export type SpecSheetRow = { id: string; job_id: string; rev: number }
export type SpecAckRow = { sheet_id: string; station_code: string }

export function attachSpecSheets(jobs: Job[], sheets: SpecSheetRow[], acks: SpecAckRow[]): Job[] {
  if (!sheets.length) return jobs
  const byJob = new Map(sheets.map(s => [s.job_id, s]))
  const ackedBy = new Map<string, Set<string>>()
  for (const a of acks) ackedBy.set(a.sheet_id, (ackedBy.get(a.sheet_id) ?? new Set<string>()).add(a.station_code))
  return jobs.map(j => {
    const s = byJob.get(j.id)
    if (!s) return j
    const acked = [...(ackedBy.get(s.id) ?? [])].filter(isStationCode)
    return { ...j, specSheet: { id: s.id, rev: s.rev, acked } }
  })
}

export type HoldRow = { job_id: string; opened_at: string }

export function attachHolds(jobs: Job[], holds: HoldRow[]): Job[] {
  if (!holds.length) return jobs
  const opened = new Map<string, string>()
  for (const h of holds) if ((opened.get(h.job_id) ?? '') < h.opened_at) opened.set(h.job_id, h.opened_at)
  return jobs.map(j => {
    const at = j.status === 'hold' ? opened.get(j.id) : undefined
    return at ? { ...j, heldSince: new Date(at) } : j
  })
}

export function attachOutRuns(jobs: Job[], runs: OutRunRow[], vendors: Vendor[]): Job[] {
  const byId = new Map(vendors.map(v => [v.id, v]))
  const byJob = new Map(runs.map(r => [r.job_id, r]))
  return jobs.map(j => {
    const r = byJob.get(j.id)
    if (!r) return j
    const out: OutRun = {
      id: Number(r.id), vendorId: Number(r.vendor_id), vendor: byId.get(Number(r.vendor_id))?.name ?? 'บริษัทภายนอก', stations: r.stations, qty: r.qty, rework: r.is_rework,
      sentAt: new Date(r.sent_at), arriveAt: new Date(r.arrive_at), leadDays: Number(r.lead_days), backAt: new Date(r.back_at),
    }
    if (r.note) out.note = r.note
    const v = byId.get(Number(r.vendor_id))
    if (v?.phone) out.phone = v.phone
    if (v?.mapUrl) out.mapUrl = v.mapUrl
    return { ...j, out }
  })
}
export type NeedRow = { product_type_code: string; type_code: MachineType; qty: number }

// กำหนดส่งเป็นวันที่ไทย · ใช้เวลาเลิกงานของวันนั้น การเทียบวันจึงไม่เพี้ยนตามเขตเวลาเครื่อง
export function dueDate(day: string): Date {
  return thaiWorkEnd(day)
}

const DEPTS: Dept[] = ['admin', 'qc', 'production']

export function toJobs(rows: JobRow[], products: ProductRow[], reworks: ReworkRow[], sewEvents: SewEventRow[]): Job[] {
  const productName = new Map(products.map(p => [p.code, p.name]))
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
      develop: r.develop === true,
      materials: Object.fromEntries(DEPTS.map(d => [d, !waiting.has(d)])) as Record<Dept, boolean>,
    }
    if (r.current_station) job.station = r.current_station
    if (r.station_status) job.status = r.station_status
    // ได้รับฟิล์มโดยไม่มีวันคาดว่าได้รับ = ใช้วันที่ได้รับ ไม่อย่างนั้นหน้าจอจะบอกว่ายังไม่ได้สั่งทั้งที่ฐานข้อมูลให้เริ่มรีดได้
    const filmDay = r.dtf_film_eta ?? (r.dtf_film_received_at ? thaiDay(new Date(r.dtf_film_received_at)) : null)
    if (usesFilm(r.route_code) && filmDay) job.film = { eta: dueDate(filmDay), received: !!r.dtf_film_received_at }
    if (r.sew_count > 0) job.sewCount = r.sew_count
    if (r.is_rework) job.rework = { qty: r.rework_qty ?? 0, reason: reworkReason.get(r.id) ?? '' }
    if (r.hold_reason) job.holdReason = r.hold_reason
    if (r.finished_at) job.doneAt = new Date(r.finished_at)
    if (r.queue_seq != null) job.queue = Number(r.queue_seq)
    if (r.mockup_path) job.mockup = r.mockup_path
    if (r.delivered_at) job.delivered = { at: new Date(r.delivered_at), note: r.delivery_note ?? '' }
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

// จักรใช้ร่วม (เช่น จักรลา) ไม่ผูกกับงาน จึงไม่นับเป็นจักรที่ไลน์ต้องได้ครบ (ตรงกับฐานข้อมูล)
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

// เน็ตมือถือสะดุดแล้วคำขอค้าง → ตัดที่ 30 วินาที · ฐานข้อมูลอาจทำเสร็จแล้ว จึงห้ามบอกว่าไม่สำเร็จให้กดซ้ำ
export const RPC_TIMEOUT_MS = 30_000
export const SLOW_REPLY = 'ระบบตอบช้าเกินไป ยังไม่แน่ใจว่าบันทึกแล้วหรือยัง · ดูสถานะงานบนจอก่อน ถ้ายังไม่เปลี่ยนค่อยกดอีกครั้ง'

export async function withTimeout<R>(call: (signal: AbortSignal) => PromiseLike<R>, ms: number):
  Promise<{ timedOut: true } | { timedOut: false; value: R }> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // แข่งกับตัวจับเวลา: แม้คำขอไม่สนใจการยกเลิก ปุ่มก็ต้องกลับมากดได้
  const late = new Promise<{ timedOut: true }>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve({ timedOut: true }) }, ms)
  })
  try {
    return await Promise.race([
      Promise.resolve(call(controller.signal)).then(value => ({ timedOut: false as const, value })),
      late,
    ])
  } finally {
    clearTimeout(timer)
  }
}
