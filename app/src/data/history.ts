// pure function ทั้งหมด จึงทดสอบได้โดยไม่ต้องต่อฐานข้อมูล
import type { Tone } from '../components/tone.ts'
import { spaced } from '../proto/format.ts'
import { thai, word, type When, type Word } from '../i18n/word.ts'

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
export type EventWords = { title: Word; detail?: Word; tone: Tone }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('th-TH') : str(v))
const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).join(', ') : str(v))
const date = (v: unknown): When | string => {
  const s = str(v)
  if (!s) return ''
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00+07:00` : s)
  return Number.isNaN(at.getTime()) ? s : { at, time: s.length > 10 }
}

const free = (text: string): Word | undefined => (text ? { th: text } : undefined)
const joined = (...parts: (Word | false | '' | undefined)[]): Word | undefined => {
  const kept = parts.filter((x): x is Word => !!x)
  return kept.length ? { th: '{parts}', vars: { parts: kept } } : undefined
}
const stationPath = (v: unknown, n: Names): Word => {
  const names: Word[] = Array.isArray(v) ? v.map(x => ({ th: n.station(str(x)) })) : []
  return { th: names.map((_, i) => `{s${i}}`).join(' → '), vars: Object.fromEntries(names.map((x, i) => [`s${i}`, x])) }
}

export function eventLine(e: EventRow, n: Names, unit = 'ชิ้น'): EventLine {
  const w = eventWords(e, n, unit)
  return w.detail ? { title: thai(w.title), detail: thai(w.detail), tone: w.tone } : { title: thai(w.title), tone: w.tone }
}

// ชนิดที่ไม่รู้จักแสดงรหัสเดิม (ดีกว่าซ่อน)
export function eventWords(e: EventRow, n: Names, unit = 'ชิ้น'): EventWords {
  const p = e.payload ?? {}
  const u: Word = { th: str(unit) || 'ชิ้น' }
  const st = e.station_code ? n.station(e.station_code) : ''
  const sample: Word | string = e.phase === 'sample' ? { th: ' (ตัวอย่าง)' } : ''
  const round: Word | string = p.round !== undefined ? { th: ' รอบ {n}', vars: { n: str(p.round) } } : ''
  const at: Word | string = st ? { th: ' ที่{station}', vars: { station: { th: st } } } : ''
  const reason = free(str(p.reason))
  switch (e.type) {
    case 'received':
      return {
        title: word('รับงานเข้าโรงงาน'), tone: 'brand',
        detail: joined(!!str(p.qty) && word('{qty} {unit}', { qty: num(p.qty), unit: u }),
          p.sample === false ? word('ไม่ขึ้นตัวอย่าง') : p.sample === true && word('ขึ้นตัวอย่าง'),
          p.pdf === false && word('ยังไม่มี PDF ที่ลูกค้าเซ็น')),
      }
    case 'material_checked': return { title: word('ติ๊กวัตถุดิบ: {name}', { name: str(p.name) }), tone: 'ok' }
    case 'material_unchecked': return { title: word('ยกเลิกติ๊กวัตถุดิบ: {name}', { name: str(p.name) }), tone: 'warn' }
    case 'released':
      return e.phase === 'production'
        ? { title: word('เข้าผลิตจริงที่สถานีแรก'), detail: word('งานนี้ไม่ขึ้นตัวอย่าง'), tone: 'ok' }
        : { title: word('ไปขึ้นตัวอย่าง{round}', { round }), tone: 'ok' }
    case 'film_ordered': return { title: word('บันทึกสั่งฟิล์ม'), detail: word('คาดว่าได้รับ {at}', { at: date(p.eta) }), tone: 'neutral' }
    case 'film_received': return { title: word('ได้รับฟิล์มแล้ว'), tone: 'ok' }
    case 'station_start':
      return { title: word('เริ่ม{station}{sample}', { station: { th: spaced(st).trimEnd() }, sample }), detail: p.rework === true ? word('งานแก้') : undefined, tone: 'info' }
    case 'substep_done': {
      const v = p.value
      return {
        title: word('ติ๊ก: {step}', { step: { th: e.station_code ? n.step(e.station_code, str(p.key)) : str(p.key) } }),
        detail: typeof v === 'number' ? word('ค่า {n}', { n: num(v) }) : undefined, tone: 'neutral',
      }
    }
    case 'sew_count': return { title: word('กรอกยอดเย็บ {count} จาก {qty}', { count: num(p.count), qty: num(p.qty) }), tone: 'neutral' }
    case 'station_done':
      return { title: word('{station}เสร็จ{sample}', { station: { th: spaced(st).trimStart() }, sample }), detail: p.rework === true ? word('งานแก้') : undefined, tone: 'ok' }
    case 'sample_sent': return { title: word('ส่งตัวอย่างให้แอดมิน{round}', { round }), tone: 'info' }
    case 'sample_result':
      return p.pass === true
        ? { title: word('ตัวอย่างผ่าน{round}', { round }), tone: 'ok' }
        : { title: word('ตัวอย่างไม่ผ่าน{round}', { round }), detail: str(p.note) ? word('ต้องแก้: {note}', { note: str(p.note) }) : undefined, tone: 'danger' }
    case 'qc_result': return { title: word('บันทึกผ่าน QC {qty} {unit}', { qty: num(p.passed), unit: u }), tone: 'ok' }
    case 'rework':
      return {
        title: word('QC ส่งกลับแก้ {qty} {unit}', { qty: num(p.qty), unit: u }), tone: 'danger',
        detail: joined(!!st && word('ที่{station}', { station: { th: st } }), !!reason && word('สาเหตุ: {reason}', { reason: str(p.reason) })),
      }
    case 'hold': return { title: word('พักงาน{at}', { at }), detail: reason, tone: 'danger' }
    case 'resume': return { title: word('แก้แล้ว ทำต่อ'), detail: free(str(p.note)), tone: 'ok' }
    case 'delay_report':
      return { title: word('ส่งรายงานปัญหา (เกินเวลามาตรฐาน)'), detail: joined(free(list(p.reasons)), !!str(p.new_eta) && word('คาดว่าเสร็จ {at}', { at: date(p.new_eta) })), tone: 'warn' }
    case 'sewing_issue_reported': return { title: word('รายงานปัญหาที่สถานีเย็บ'), detail: reason, tone: 'warn' }
    case 'machines_assigned': return { title: word('จ่ายจักร'), detail: free(list(p.machines)), tone: 'neutral' }
    // คืนเพราะจักรเสีย/ปิดใช้งาน ต้องเห็นสาเหตุและอาการ ไม่ใช่แค่รหัส
    case 'machines_released': {
      const why = str(p.reason) && `${str(p.reason)}${str(p.note) ? ` (${str(p.note)})` : ''}`
      return { title: word('คืนจักร'), detail: joined(free(list(p.machines)), free(why)), tone: why ? 'warn' : 'neutral' }
    }
    case 'machines_booked':
      return { title: word('จองจักร'), detail: joined(free(list(p.machines)), !!str(p.starts_at) && word('{from} – {to}', { from: date(p.starts_at), to: date(p.ends_at) })), tone: 'neutral' }
    case 'booking_cancelled': return { title: word('ยกเลิกการจองจักร'), tone: 'neutral' }
    case 'job_cancelled': return { title: st ? word('ยกเลิกงาน (อยู่ที่{station})', { station: { th: st } }) : word('ยกเลิกงาน'), detail: reason, tone: 'danger' }
    case 'outsource_sent':
      return {
        title: word('ส่งออก {vendor}', { vendor: str(p.vendor) }), tone: 'info',
        detail: joined(!!list(p.stations) && word('ทำ {stations}', { stations: stationPath(p.stations, n) }), !!str(p.arrive_at) && word('ถึงบริษัท {at}', { at: date(p.arrive_at) }),
          p.lead_days != null && word('ใช้ {n} วัน', { n: num(p.lead_days) }), !!str(p.back_at) && word('คาดว่าของกลับ {at}', { at: date(p.back_at) }), free(str(p.note))),
      }
    case 'outsource_forwarded':
      return {
        title: word('ส่งต่อจาก {from} ไป {vendor}', { from: str(p.from_vendor), vendor: str(p.vendor) }), tone: 'info',
        detail: joined(!!list(p.stations) && word('ทำ {stations}', { stations: stationPath(p.stations, n) }), !!str(p.arrive_at) && word('ถึงบริษัท {at}', { at: date(p.arrive_at) }),
          p.lead_days != null && word('ใช้ {n} วัน', { n: num(p.lead_days) }), !!str(p.back_at) && word('คาดว่าเสร็จ {at}', { at: date(p.back_at) })),
      }
    case 'outsource_received':
      return {
        title: word('รับของกลับจาก {vendor}', { vendor: str(p.vendor) }), tone: p.late === true ? 'warn' : 'ok',
        detail: joined(!!list(p.done_stations) && word('ทำแล้ว {stations}', { stations: stationPath(p.done_stations, n) }), p.late === true && word('ช้ากว่ากำหนด'), free(str(p.note))),
      }
    case 'outsource_plan': {
      const back = str(p.back_at) ? word('คาดว่าของถึง {at}', { at: date(p.back_at) }) : undefined
      const old = str(p.old_back_at) ? word('(เดิม {at})', { at: date(p.old_back_at) }) : undefined
      return { title: word('แก้กำหนดงานข้างนอก'), detail: back && old ? { th: '{a} {b}', vars: { a: back, b: old } } : back ?? old, tone: 'warn' }
    }
    case 'job_split': return { title: word('แบ่งงาน {qty} ชิ้นเป็น {child}', { qty: num(p.qty), child: str(p.child) }), detail: word('งานนี้เหลือ {n} ชิ้น', { n: num(p.left) }), tone: 'neutral' }
    case 'job_split_from': return { title: word('แบ่งมาจาก {parent}', { parent: str(p.parent) }), detail: word('{n} ชิ้น', { n: num(p.qty) }), tone: 'neutral' }
    case 'queue_insert': return { title: word('แทรกคิวงานด่วน (ก่อน {no})', { no: str(p.before) }), detail: reason, tone: 'warn' }
    case 'queue_skip': return { title: word('เริ่มก่อนคิว{at}', { at }), detail: joined(reason, !!list(p.ahead) && word('ข้ามคิว {jobs}', { jobs: list(p.ahead) })), tone: 'warn' }
    case 'correction': return { title: word('แจ้งว่ารายการก่อนหน้ากดผิด'), detail: reason, tone: 'warn' }
    case 'confirmation_pdf': return { title: p.replaced ? word('เปลี่ยน PDF ใบยืนยัน') : word('แนบ PDF ใบยืนยันที่ลูกค้าเซ็น'), tone: 'ok' }
    case 'mockup': return { title: p.replaced ? word('เปลี่ยนรูปม็อคอัพ') : word('เพิ่มรูปม็อคอัพ'), tone: 'ok' }
    case 'mockup_approved':
      return { title: word('อนุมัติม็อคอัพกำกับสเปก ฉบับ {rev}', { rev: num(p.rev) }), detail: joined(p.replaced_rev != null && word('แทนฉบับ {rev}', { rev: num(p.replaced_rev) }), free(str(p.note))), tone: 'ok' }
    case 'mockup_revision': return { title: word('เริ่มแก้ม็อคอัพ ฉบับ {rev}', { rev: num(p.rev) }), detail: reason, tone: 'warn' }
    case 'done': return { title: word('งานเสร็จ · พร้อมส่ง'), tone: 'ok' }
    case 'delivered': return { title: word('จัดส่งให้ลูกค้าแล้ว'), detail: free(str(p.note)), tone: 'ok' }
    case 'delivery_undone': return { title: word('ยกเลิกการบันทึกจัดส่ง'), detail: reason, tone: 'warn' }
    default: return { title: { th: e.type }, tone: 'neutral' }
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

export type VisitLine = { station: string; label: string; start: Date; end: Date | null; span: string; paused: string | null; workedMs: number; pausedMs: number }

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
        workedMs: to - start.getTime() - pausedMs, pausedMs,
      }
    })
}
