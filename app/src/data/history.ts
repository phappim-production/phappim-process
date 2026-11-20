// pure function ทั้งหมด จึงทดสอบได้โดยไม่ต้องต่อฐานข้อมูล
import type { Tone } from '../components/tone.ts'
import { spaced } from '../proto/format.ts'

export type EventRow = {
  id: number
  type: string
  phase: string | null
  station_code: string | null
  payload: Record<string, unknown> | null
  by: string | null
  at: string
}

export type VisitRow = {
  station_code: string
  phase: string
  visit: number | null
  started_at: string | null
  done_at: string | null
  rework: boolean | null
}

export type Names = {
  station: (code: string) => string
  step: (station: string, key: string) => string
}

export type EventLine = { title: string; detail?: string; tone: Tone }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('th-TH') : str(v))
const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).join(', ') : str(v))
const thaiDate = (v: unknown) => {
  const s = str(v)
  if (!s) return ''
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00+07:00` : s)
  if (Number.isNaN(d.getTime())) return s
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }
  if (s.length > 10) Object.assign(opts, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleString('th-TH', opts)
}

const stationNames = (v: unknown, n: Names) => (Array.isArray(v) ? v.map(x => n.station(str(x))).join(' → ') : '')

// ชนิดที่ไม่รู้จักแสดงรหัสเดิม (ดีกว่าซ่อน)
export function eventLine(e: EventRow, n: Names, unit = 'ชิ้น'): EventLine {
  const p = e.payload ?? {}
  const jobUnit = str(unit) || 'ชิ้น'
  const st = e.station_code ? n.station(e.station_code) : ''
  const sample = e.phase === 'sample' ? ' (ตัวอย่าง)' : ''
  const round = p.round !== undefined ? ` รอบ ${str(p.round)}` : ''
  switch (e.type) {
    case 'received': {
      const bits = [str(p.qty) && `${num(p.qty)} ${jobUnit}`, p.sample === false ? 'ไม่ขึ้นตัวอย่าง' : p.sample === true ? 'ขึ้นตัวอย่าง' : '', p.pdf === false ? 'ยังไม่มี PDF ที่ลูกค้าเซ็น' : ''].filter(Boolean)
      return { title: 'รับงานเข้าโรงงาน', detail: bits.join(' · ') || undefined, tone: 'brand' }
    }
    case 'material_checked': return { title: `ติ๊กวัตถุดิบ: ${str(p.name)}`, tone: 'ok' }
    case 'material_unchecked': return { title: `ยกเลิกติ๊กวัตถุดิบ: ${str(p.name)}`, tone: 'warn' }
    case 'released':
      return e.phase === 'production'
        ? { title: 'เข้าผลิตจริงที่สถานีแรก', detail: 'งานนี้ไม่ขึ้นตัวอย่าง', tone: 'ok' }
        : { title: `ไปขึ้นตัวอย่าง${round}`, tone: 'ok' }
    case 'film_ordered': return { title: 'บันทึกสั่งฟิล์ม', detail: `คาดว่าได้รับ ${thaiDate(p.eta)}`, tone: 'neutral' }
    case 'film_received': return { title: 'ได้รับฟิล์มแล้ว', tone: 'ok' }
    case 'station_start':
      return { title: `เริ่ม${spaced(st).trimEnd()}${sample}`, detail: p.rework === true ? 'งานแก้' : undefined, tone: 'info' }
    case 'substep_done': {
      const v = p.value
      return { title: `ติ๊ก: ${e.station_code ? n.step(e.station_code, str(p.key)) : str(p.key)}`, detail: typeof v === 'number' ? `ค่า ${num(v)}` : undefined, tone: 'neutral' }
    }
    case 'sew_count': return { title: `กรอกยอดเย็บ ${num(p.count)} จาก ${num(p.qty)}`, tone: 'neutral' }
    case 'station_done':
      return { title: `${spaced(st).trimStart()}เสร็จ${sample}`, detail: p.rework === true ? 'งานแก้' : undefined, tone: 'ok' }
    case 'sample_sent': return { title: `ส่งตัวอย่างให้แอดมิน${round}`, tone: 'info' }
    case 'sample_result':
      return p.pass === true
        ? { title: `ตัวอย่างผ่าน${round}`, tone: 'ok' }
        : { title: `ตัวอย่างไม่ผ่าน${round}`, detail: str(p.note) ? `ต้องแก้: ${str(p.note)}` : undefined, tone: 'danger' }
    case 'qc_result': return { title: `บันทึกผ่าน QC ${num(p.passed)} ${jobUnit}`, tone: 'ok' }
    case 'rework':
      return { title: `QC ส่งกลับแก้ ${num(p.qty)} ${jobUnit}`, detail: [st && `ที่${st}`, str(p.reason) && `สาเหตุ: ${str(p.reason)}`].filter(Boolean).join(' · ') || undefined, tone: 'danger' }
    case 'hold': return { title: `พักงาน${st ? ` ที่${st}` : ''}`, detail: str(p.reason) || undefined, tone: 'danger' }
    case 'resume': return { title: 'แก้แล้ว ทำต่อ', detail: str(p.note) || undefined, tone: 'ok' }
    case 'delay_report':
      return { title: 'ส่งรายงานปัญหา (เกินเวลามาตรฐาน)', detail: [list(p.reasons), str(p.new_eta) && `คาดว่าเสร็จ ${thaiDate(p.new_eta)}`].filter(Boolean).join(' · ') || undefined, tone: 'warn' }
    case 'sewing_issue_reported': return { title: 'รายงานปัญหาที่สถานีเย็บ', detail: str(p.reason) || undefined, tone: 'warn' }
    case 'machines_assigned': return { title: 'จ่ายจักร', detail: list(p.machines) || undefined, tone: 'neutral' }
    // คืนเพราะจักรเสีย/ปิดใช้งาน ต้องเห็นสาเหตุและอาการ ไม่ใช่แค่รหัส
    case 'machines_released': {
      const why = str(p.reason) && `${str(p.reason)}${str(p.note) ? ` (${str(p.note)})` : ''}`
      return { title: 'คืนจักร', detail: [list(p.machines), why].filter(Boolean).join(' · ') || undefined, tone: why ? 'warn' : 'neutral' }
    }
    case 'machines_booked':
      return { title: 'จองจักร', detail: [list(p.machines), str(p.starts_at) && `${thaiDate(p.starts_at)} – ${thaiDate(p.ends_at)}`].filter(Boolean).join(' · ') || undefined, tone: 'neutral' }
    case 'booking_cancelled': return { title: 'ยกเลิกการจองจักร', tone: 'neutral' }
    case 'outsource_sent': return { title: `ส่งออก ${str(p.vendor)}`, detail: [list(p.stations) && `ทำ ${stationNames(p.stations, n)}`, str(p.arrive_at) && `ถึงบริษัท ${thaiDate(p.arrive_at)}`, p.lead_days != null && `ใช้ ${num(p.lead_days)} วัน`, str(p.back_at) && `คาดว่าของกลับ ${thaiDate(p.back_at)}`, str(p.note)].filter(Boolean).join(' · ') || undefined, tone: 'info' }
    case 'outsource_forwarded': return { title: `ส่งต่อจาก ${str(p.from_vendor)} ไป ${str(p.vendor)}`, detail: [list(p.stations) && `ทำ ${stationNames(p.stations, n)}`, str(p.arrive_at) && `ถึงบริษัท ${thaiDate(p.arrive_at)}`, p.lead_days != null && `ใช้ ${num(p.lead_days)} วัน`, str(p.back_at) && `คาดว่าเสร็จ ${thaiDate(p.back_at)}`].filter(Boolean).join(' · ') || undefined, tone: 'info' }
    case 'outsource_received': return { title: `รับของกลับจาก ${str(p.vendor)}`, detail: [list(p.done_stations) && `ทำแล้ว ${stationNames(p.done_stations, n)}`, p.late === true && 'ช้ากว่ากำหนด', str(p.note)].filter(Boolean).join(' · ') || undefined, tone: p.late === true ? 'warn' : 'ok' }
    case 'outsource_plan': return { title: 'แก้กำหนดงานข้างนอก', detail: [str(p.back_at) && `คาดว่าของถึง ${thaiDate(p.back_at)}`, str(p.old_back_at) && `(เดิม ${thaiDate(p.old_back_at)})`].filter(Boolean).join(' ') || undefined, tone: 'warn' }
    case 'job_split': return { title: `แบ่งงาน ${num(p.qty)} ชิ้นเป็น ${str(p.child)}`, detail: `งานนี้เหลือ ${num(p.left)} ชิ้น`, tone: 'neutral' }
    case 'job_split_from': return { title: `แบ่งมาจาก ${str(p.parent)}`, detail: `${num(p.qty)} ชิ้น`, tone: 'neutral' }
    case 'queue_insert': return { title: `แทรกคิวงานด่วน (ก่อน ${str(p.before)})`, detail: str(p.reason) || undefined, tone: 'warn' }
    case 'queue_skip': return { title: `เริ่มก่อนคิว${st ? ` ที่${st}` : ''}`, detail: [str(p.reason), list(p.ahead) && `ข้ามคิว ${list(p.ahead)}`].filter(Boolean).join(' · ') || undefined, tone: 'warn' }
    case 'correction': return { title: 'แจ้งว่ารายการก่อนหน้ากดผิด', detail: str(p.reason) || undefined, tone: 'warn' }
    case 'confirmation_pdf': return { title: p.replaced ? 'เปลี่ยน PDF ใบยืนยัน' : 'แนบ PDF ใบยืนยันที่ลูกค้าเซ็น', tone: 'ok' }
    case 'mockup': return { title: p.replaced ? 'เปลี่ยนรูปม็อคอัพ' : 'เพิ่มรูปม็อคอัพ', tone: 'ok' }
    case 'mockup_approved': return { title: `อนุมัติม็อคอัพกำกับสเปก ฉบับ ${num(p.rev)}`, detail: [p.replaced_rev != null && `แทนฉบับ ${num(p.replaced_rev)}`, str(p.note)].filter(Boolean).join(' · ') || undefined, tone: 'ok' }
    case 'mockup_revision': return { title: `เริ่มแก้ม็อคอัพ ฉบับ ${num(p.rev)}`, detail: str(p.reason) || undefined, tone: 'warn' }
    case 'done': return { title: 'งานเสร็จ · พร้อมส่ง', tone: 'ok' }
    case 'delivered': return { title: 'จัดส่งให้ลูกค้าแล้ว', detail: str(p.note) || undefined, tone: 'ok' }
    case 'delivery_undone': return { title: 'ยกเลิกการบันทึกจัดส่ง', detail: str(p.reason) || undefined, tone: 'warn' }
    default: return { title: e.type, tone: 'neutral' }
  }
}

// แสดงกำกับบนรายการเดิม ไม่ลบประวัติ
export function corrections(events: EventRow[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const e of events) {
    if (e.type !== 'correction') continue
    const id = Number(e.payload?.event_id)
    if (Number.isFinite(id)) map.set(id, str(e.payload?.reason))
  }
  return map
}

export function spanText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} นาที`
  const h = ms / 3_600_000
  const fmt = (v: number, digits: number) => v.toFixed(digits).replace(/\.0$/, '')
  if (h < 24) return `${fmt(h, h < 10 ? 1 : 0)} ชม.`
  return `${fmt(h / 24, 1)} วัน`
}

export type VisitLine = { station: string; label: string; start: Date; end: Date | null; span: string; paused: string | null }

// ยังไม่ทำต่อ = พักถึงตอนนี้
export function pauseRanges(events: Pick<EventRow, 'type' | 'at'>[], now: Date): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let from: number | null = null
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.type === 'hold' && from === null) from = new Date(e.at).getTime()
    else if (e.type === 'resume' && from !== null) { out.push({ from, to: new Date(e.at).getTime() }); from = null }
  }
  if (from !== null) out.push({ from, to: now.getTime() })
  return out
}

// หักช่วงพักงานออก เพราะเวลามาตรฐานและหน้ารายงานไม่นับเวลาพัก
export function visitLines(rows: VisitRow[], n: Pick<Names, 'station'>, now: Date, events: Pick<EventRow, 'type' | 'at'>[] = []): VisitLine[] {
  const pauses = pauseRanges(events, now)
  return rows
    .filter((r): r is VisitRow & { started_at: string } => !!r.started_at)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map(r => {
      const start = new Date(r.started_at)
      const end = r.done_at ? new Date(r.done_at) : null
      const to = (end ?? now).getTime()
      const pausedMs = pauses.reduce((sum, p) => sum + Math.max(0, Math.min(p.to, to) - Math.max(p.from, start.getTime())), 0)
      const tag = [r.phase === 'sample' ? 'ตัวอย่าง' : '', r.rework ? 'งานแก้' : ''].filter(Boolean).join(' · ')
      return {
        station: r.station_code,
        label: `${n.station(r.station_code)}${tag ? ` (${tag})` : ''}`,
        start, end,
        span: `${spanText(to - start.getTime() - pausedMs)}${end ? '' : ' (ยังทำอยู่)'}`,
        paused: pausedMs >= 60_000 ? spanText(pausedMs) : null,
      }
    })
}
