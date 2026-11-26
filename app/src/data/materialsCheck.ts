// ตรงกับ public.set_job_materials / add_job_material / add_material_photos / release_job ในฐานข้อมูล
import { thaiDay } from '../proto/model.ts'
import { yearOutOfRange } from '../proto/format.ts'

export const MAX_MATERIAL_ITEMS = 30
export const MAX_MATERIAL_NAME = 80
export const MAX_MATERIAL_PHOTOS = 12

export type MaterialItem = { id: number; name: string; checked_at: string | null; eta: string | null }
export type MaterialPhoto = { id: number; path: string }
export type MaterialLine = { name: string; eta: Date | null; checked: boolean }

// ช่องว่างแปลก (เช่น วางจาก LINE / Excel) ฐานข้อมูลนับเป็นช่องว่างเดียว
export const cleanName = (typed: string) => typed.replace(/\s+/gu, ' ').trim().slice(0, MAX_MATERIAL_NAME)
const sameName = (a: string, b: string) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase()

export function withItem(names: readonly string[], typed: string): { ok: true; names: string[] } | { ok: false; reason: string } {
  const name = cleanName(typed)
  if (!name) return { ok: false, reason: 'พิมพ์ชื่อวัตถุดิบก่อนกดเพิ่ม' }
  if (names.some(n => sameName(n, name))) return { ok: false, reason: `มี "${name}" ในรายการแล้ว` }
  if (names.length >= MAX_MATERIAL_ITEMS) return { ok: false, reason: `รายการวัตถุดิบไม่เกิน ${MAX_MATERIAL_ITEMS} รายการ · รวมของที่เป็นชุดเดียวกันไว้ในรายการเดียว` }
  return { ok: true, names: [...names, name] }
}

/** ช่องวันเวลา (YYYY-MM-DDTHH:mm) · ไม่มีของ = ต้องใส่วันคาดว่าได้รับ */
export function addProblem(names: readonly string[], typed: string, eta: string, have: boolean): string | null {
  const next = withItem(names, typed)
  if (!next.ok) return next.reason
  const name = next.names[next.names.length - 1]
  if (!have && !eta) return `ใส่วันเวลาที่คาดว่าจะได้รับ "${name}" หรือติ๊ก "มีของแล้ว"`
  if (eta && yearOutOfRange(eta)) return 'ปีของวันที่คาดว่าได้รับไม่ถูกต้อง · ระบบใช้ปี ค.ศ. (พ.ศ. 2569 = ค.ศ. 2026) เลือกจากปฏิทินใหม่'
  return null
}

export const withoutItem = (names: readonly string[], name: string) => names.filter(n => n !== name)

// แท็บเล็ตตั้งเขตเวลาผิดได้ · วันเวลาของของที่จะมาถึงนับเป็นเวลาไทยเสมอ
export const fromBangkokInput = (value: string): Date | null => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? new Date(`${value}:00+07:00`) : null)
const inputFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export function toBangkokInput(at: Date): string {
  const p = Object.fromEntries(inputFormat.formatToParts(at).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export type Arrival = 'received' | 'late' | 'today' | 'later' | 'unset'

export function arrival(line: MaterialLine, now: Date): Arrival {
  if (line.checked) return 'received'
  if (!line.eta) return 'unset'
  if (line.eta.getTime() < now.getTime()) return 'late'
  return thaiDay(line.eta) === thaiDay(now) ? 'today' : 'later'
}

export const toLine = (m: MaterialItem): MaterialLine => ({ name: m.name, eta: m.eta ? new Date(m.eta) : null, checked: !!m.checked_at })

// การ์ดบนบอร์ด / วันคาดว่าเสร็จ: ของที่ยังไม่ได้รับ
export function materialsOutlook(lines: readonly MaterialLine[], now: Date): { late: MaterialLine[]; next: Date | null; last: Date | null; unset: number } {
  const open = lines.filter(l => !l.checked)
  const dated = open.filter(l => l.eta).map(l => l.eta as Date).sort((a, b) => a.getTime() - b.getTime())
  return {
    late: open.filter(l => arrival(l, now) === 'late').sort((a, b) => (a.eta as Date).getTime() - (b.eta as Date).getTime()),
    next: dated.find(d => d.getTime() >= now.getTime()) ?? null,
    last: dated.length ? dated[dated.length - 1] : null,
    unset: open.filter(l => !l.eta).length,
  }
}

export function releaseBlocker(items: readonly MaterialItem[], photos: number): string | null {
  if (!items.length) return 'เพิ่มรายการวัตถุดิบที่ต้องเช็คอย่างน้อย 1 รายการก่อนปล่อยเข้าไลน์'
  const left = items.filter(m => !m.checked_at).map(m => m.name)
  if (left.length) return `ยังไม่ได้ติ๊กวัตถุดิบ: ${left.join(', ')} · เช็คของให้ครบก่อนปล่อยเข้าไลน์`
  if (photos < 1) return 'ถ่ายรูปวัตถุดิบอย่างน้อย 1 รูปก่อนปล่อยเข้าไลน์'
  return null
}
