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
    case 'materials_set': {
      const items = Array.isArray(p.items) ? p.items.map(str).filter(Boolean) : []
      return { title: word('ตั้งรายการวัตถุดิบ {n} รายการ', { n: items.length }), detail: free(items.join(', ')), tone: 'neutral' }
    }
    case 'material_added':
      return { title: word('เพิ่มวัตถุดิบ: {name}', { name: str(p.name) }), tone: 'neutral',
        detail: p.have === true ? word('มีของแล้ว') : p.eta ? word('คาดว่าได้รับ {at} น.', { at: date(p.eta) }) : undefined }
    case 'material_eta':
      if (!p.from) return { title: word('ใส่วันที่คาดว่าได้รับ: {name}', { name: str(p.name) }), tone: 'neutral', detail: word('คาดว่าได้รับ {at} น.', { at: date(p.eta) }) }
      return { title: word('เลื่อนวันที่คาดว่าได้รับ: {name}', { name: str(p.name) }), tone: 'warn',
        detail: word('{from} น. → {at} น.', { from: date(p.from), at: date(p.eta) }) }
    case 'material_photos': return { title: word('ถ่ายรูปวัตถุดิบ {n} รูป', { n: num(p.added) }), tone: 'info' }
    case 'material_photo_removed': return { title: word('ลบรูปวัตถุดิบ 1 รูป'), tone: 'warn' }
    case 'released':
      if (p.manual === true && p.outsource === true) return {
        title: word('ปล่อยเข้าไลน์การผลิต'), tone: 'ok',
        detail: word('ส่งออกบริษัทภายนอก · ไม่ต้องเช็ควัตถุดิบ'),
      }
      if (p.manual === true) return {
        title: word('ปล่อยเข้าไลน์การผลิต'), tone: 'ok',
        detail: joined(word('เช็ควัตถุดิบครบ {n} รายการ · รูป {m} รูป', { n: num(p.materials), m: num(p.photos) }),
          e.phase === 'production' ? word('เข้าผลิตจริงที่สถานีแรก') : word('ไปขึ้นตัวอย่าง{round}', { round })),
      }
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
      return { title: word('ส่งรายงานสาเหตุที่ช้า'), detail: joined(free(list(p.reasons)), !!str(p.new_eta) && word('คาดว่าเสร็จ {at}', { at: date(p.new_eta) })), tone: 'warn' }
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
    case 'confirmation_no_freed': return { title: word('ใช้เลข {from} กับใบใหม่ · งานนี้เปลี่ยนเลขเป็น {to}', { from: str(p.from), to: str(p.to) }), tone: 'neutral' }
    case 'job_split_from': return { title: word('แบ่งมาจาก {parent}', { parent: str(p.parent) }), detail: word('{n} ชิ้น', { n: num(p.qty) }), tone: 'neutral' }
    case 'queue_insert': return { title: word('แทรกคิวงานด่วน (ก่อน {no})', { no: str(p.before) }), detail: reason, tone: 'warn' }
    case 'queue_skip': return { title: word('เริ่มก่อนคิว{at}', { at }), detail: joined(reason, !!list(p.ahead) && word('ข้ามคิว {jobs}', { jobs: list(p.ahead) })), tone: 'warn' }
    case 'correction': return { title: word('แจ้งว่ารายการก่อนหน้ากดผิด'), detail: reason, tone: 'warn' }
    case 'confirmation_pdf': return { title: p.replaced ? word('เปลี่ยน PDF ใบยืนยัน') : word('แนบ PDF ใบยืนยันที่ลูกค้าเซ็น'), tone: 'ok' }
    case 'spec_revised': {
      const stale = typeof p.mockup_stale === 'number' && p.mockup_stale > 0
      const moved = (k: string) => p[`${k}_from`] != null && str(p[`${k}_from`]) !== str(p[`${k}_to`])
      return {
        title: word('แก้ใบยืนยัน ครั้งที่ {rev} · ผลิตตามสเปกใหม่', { rev: num(p.rev) }), tone: 'warn',
        detail: joined(moved('qty') && word('จำนวน {from} → {to} {unit}', { from: num(p.qty_from), to: num(p.qty_to), unit: u }),
          moved('due') && word('กำหนดส่ง {from} → {to}', { from: date(p.due_from), to: date(p.due_to) }),
          moved('spare') && word('เผื่อเสีย {from} → {to}', { from: num(p.spare_from), to: num(p.spare_to) }),
          free(list(p.renamed)), !!list(p.fields) && word('ช่องที่แก้: {fields}', { fields: list(p.fields) }),
          stale && word('ม็อคอัพกำกับสเปกฉบับ {rev} ยังเป็นค่าเก่า {n} จุด', { rev: num(p.mockup_rev), n: num(p.mockup_stale) })),
      }
    }
    case 'first_piece_sent':
      return { title: p.resend === true ? word('ส่งรูปชิ้นแรกใหม่{at} · รออนุมัติ', { at }) : word('ส่งรูปชิ้นแรก{at} · รออนุมัติ', { at }), detail: word('{n} รูป', { n: num(p.photos) }), tone: 'warn' }
    case 'first_piece_ok': return { title: word('ชิ้นแรกผ่าน{at} · ทำทั้งล็อตได้', { at }), tone: 'ok' }
    case 'first_piece_rejected': return { title: word('ชิ้นแรกไม่ผ่าน{at}', { at }), detail: reason, tone: 'danger' }
    case 'confirmation_ack': return { title: word('รับทราบใบยืนยันแก้ไขครั้งที่ {rev}{at}', { rev: num(p.rev), at }), tone: 'ok' }
    case 'finish_photo': return { title: word('ส่งรูปงานเสร็จ{at}', { at }), detail: word('{n} รูป', { n: num(p.photos) }), tone: 'ok' }
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

export type VisitLine = {
  station: string; label: string; start: Date; end: Date | null; span: string
  paused: string | null; workedMs: number; pausedMs: number; waited: string | null; waitedMs: number
}

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

// รูปที่ยังไม่ได้ตัดสินนับถึงตอนนี้ แต่ถ้ารอบสถานีจบแล้ว (ปิดระบบรูประหว่างรอ) ไม่หัก
export function firstPieceWaits(events: Pick<EventRow, 'type' | 'at'>[], now: Date): { from: number; to: number; open: boolean }[] {
  const out: { from: number; to: number; open: boolean }[] = []
  let from: number | null = null
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.type === 'first_piece_sent' && from === null) from = new Date(e.at).getTime()
    else if ((e.type === 'first_piece_ok' || e.type === 'first_piece_rejected') && from !== null) { out.push({ from, to: new Date(e.at).getTime(), open: false }); from = null }
  }
  if (from !== null) out.push({ from, to: now.getTime(), open: true })
  return out
}

function coveredMs(ranges: { from: number; to: number }[], start: number, end: number): number {
  const clipped = ranges.map(r => ({ from: Math.max(r.from, start), to: Math.min(r.to, end) })).filter(r => r.to > r.from).sort((a, b) => a.from - b.from)
  let total = 0
  let reach = -Infinity
  for (const r of clipped) {
    if (r.to <= reach) continue
    total += r.to - Math.max(r.from, reach)
    reach = r.to
  }
  return total
}

// หักช่วงพักงานและรออนุมัติชิ้นแรกออก เพราะหน้ารายงานเวลาต่อสถานีไม่นับ · ช่วงที่ซ้อนกันหักครั้งเดียว
export function visitLines(rows: VisitRow[], n: Pick<Names, 'station'>, now: Date, events: Pick<EventRow, 'type' | 'at'>[] = []): VisitLine[] {
  const pauses = pauseRanges(events, now)
  const waits = firstPieceWaits(events, now)
  return rows
    .filter((r): r is VisitRow & { started_at: string } => !!r.started_at)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map(r => {
      const start = new Date(r.started_at)
      const end = r.done_at ? new Date(r.done_at) : null
      const to = (end ?? now).getTime()
      const pausedMs = coveredMs(pauses, start.getTime(), to)
      const waitedMs = coveredMs([...pauses, ...waits.filter(w => !(w.open && end))], start.getTime(), to) - pausedMs
      const workedMs = to - start.getTime() - pausedMs - waitedMs
      const tag = [r.phase === 'sample' ? 'ตัวอย่าง' : '', r.rework ? 'งานแก้' : ''].filter(Boolean).join(' · ')
      return {
        station: r.station_code,
        label: `${n.station(r.station_code)}${tag ? ` (${tag})` : ''}`,
        start, end,
        span: `${spanText(workedMs)}${end ? '' : ' (ยังทำอยู่)'}`,
        paused: pausedMs >= 60_000 ? spanText(pausedMs) : null,
        workedMs, pausedMs,
        waited: waitedMs >= 60_000 ? spanText(waitedMs) : null, waitedMs,
      }
    })
}
