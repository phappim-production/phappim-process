// ประวัติงาน (S8): แปลงแถวจาก events / station_visits เป็นข้อความไทยบนไทม์ไลน์
// pure function ทั้งหมด หน้าจอส่งชื่อสถานี/ขั้นย่อยเข้ามา จึงทดสอบได้โดยไม่ต้องต่อฐานข้อมูล
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

/** ข้อความ 1 บรรทัดของการกด 1 ครั้ง · ชนิดที่ไม่รู้จักแสดงรหัสเดิม (ดีกว่าซ่อน) */
export function eventLine(e: EventRow, n: Names): EventLine {
  const p = e.payload ?? {}
  const st = e.station_code ? n.station(e.station_code) : ''
  const sample = e.phase === 'sample' ? ' (ตัวอย่าง)' : ''
  const round = p.round !== undefined ? ` รอบ ${str(p.round)}` : ''
  switch (e.type) {
    case 'received': {
      const bits = [str(p.qty) && `${num(p.qty)} ชิ้น`, p.sample === false ? 'ไม่ขึ้นตัวอย่าง' : p.sample === true ? 'ขึ้นตัวอย่าง' : ''].filter(Boolean)
      return { title: 'รับงานเข้าโรงงาน', detail: bits.join(' · ') || undefined, tone: 'brand' }
    }
    case 'material_checked': return { title: `ติ๊กวัตถุดิบ: ${str(p.name)}`, tone: 'ok' }
    case 'material_unchecked': return { title: `ยกเลิกติ๊กวัตถุดิบ: ${str(p.name)}`, tone: 'warn' }
    case 'released':
      return e.phase === 'production'
        ? { title: 'วัตถุดิบครบ · เข้าผลิตจริง', detail: 'งานนี้ไม่ขึ้นตัวอย่าง', tone: 'ok' }
        : { title: `วัตถุดิบครบ · ไปขึ้นตัวอย่าง${round}`, tone: 'ok' }
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
    case 'qc_result': return { title: `บันทึกผ่าน QC ${num(p.passed)} ชิ้น`, tone: 'ok' }
    case 'rework':
      return { title: `QC ส่งกลับแก้ ${num(p.qty)} ชิ้น`, detail: [st && `ที่${st}`, str(p.reason) && `สาเหตุ: ${str(p.reason)}`].filter(Boolean).join(' · ') || undefined, tone: 'danger' }
    case 'hold': return { title: `พักงาน${st ? ` ที่${st}` : ''}`, detail: str(p.reason) || undefined, tone: 'danger' }
    case 'resume': return { title: 'แก้แล้ว ทำต่อ', detail: str(p.note) || undefined, tone: 'ok' }
    case 'delay_report':
      return { title: 'ส่งรายงานปัญหา (เกินเวลามาตรฐาน)', detail: [list(p.reasons), str(p.new_eta) && `คาดว่าเสร็จ ${thaiDate(p.new_eta)}`].filter(Boolean).join(' · ') || undefined, tone: 'warn' }
    case 'sewing_issue_reported': return { title: 'รายงานปัญหาที่สถานีเย็บ', detail: str(p.reason) || undefined, tone: 'warn' }
    case 'machines_assigned': return { title: 'จ่ายจักร', detail: list(p.machines) || undefined, tone: 'neutral' }
    case 'machines_released': return { title: 'คืนจักร', detail: list(p.machines) || undefined, tone: 'neutral' }
    case 'machines_booked':
      return { title: 'จองจักร', detail: [list(p.machines), str(p.starts_at) && `${thaiDate(p.starts_at)} – ${thaiDate(p.ends_at)}`].filter(Boolean).join(' · ') || undefined, tone: 'neutral' }
    case 'booking_cancelled': return { title: 'ยกเลิกการจองจักร', tone: 'neutral' }
    case 'correction': return { title: 'แจ้งว่ารายการก่อนหน้ากดผิด', detail: str(p.reason) || undefined, tone: 'warn' }
    case 'done': return { title: 'งานเสร็จ · พร้อมส่ง', tone: 'ok' }
    default: return { title: e.type, tone: 'neutral' }
  }
}

/** รายการที่ถูกแจ้งว่ากดผิด → เหตุผล (แสดงกำกับบนรายการเดิม · ไม่ลบประวัติ) */
export function corrections(events: EventRow[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const e of events) {
    if (e.type !== 'correction') continue
    const id = Number(e.payload?.event_id)
    if (Number.isFinite(id)) map.set(id, str(e.payload?.reason))
  }
  return map
}

/** ระยะเวลาเป็นข้อความไทยสั้น (นาที / ชั่วโมง / วัน) */
export function spanText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} นาที`
  const h = ms / 3_600_000
  const fmt = (v: number, digits: number) => v.toFixed(digits).replace(/\.0$/, '')
  if (h < 24) return `${fmt(h, h < 10 ? 1 : 0)} ชม.`
  return `${fmt(h / 24, 1)} วัน`
}

export type VisitLine = { station: string; label: string; start: Date; end: Date | null; span: string }

/** เวลาที่ใช้ในแต่ละสถานี (เริ่ม → เสร็จ) เรียงตามเวลาเริ่ม · ยังไม่เสร็จ = นับถึงตอนนี้ */
export function visitLines(rows: VisitRow[], n: Pick<Names, 'station'>, now: Date): VisitLine[] {
  return rows
    .filter((r): r is VisitRow & { started_at: string } => !!r.started_at)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map(r => {
      const start = new Date(r.started_at)
      const end = r.done_at ? new Date(r.done_at) : null
      const tag = [r.phase === 'sample' ? 'ตัวอย่าง' : '', r.rework ? 'งานแก้' : ''].filter(Boolean).join(' · ')
      return {
        station: r.station_code,
        label: `${n.station(r.station_code)}${tag ? ` (${tag})` : ''}`,
        start, end,
        span: `${spanText((end ?? now).getTime() - start.getTime())}${end ? '' : ' (ยังทำอยู่)'}`,
      }
    })
}
