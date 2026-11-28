// ฟอร์มอยู่เว็บเดียวกับระบบ จึงส่งใบกันผ่าน localStorage ไม่ต้องล็อกอินในฟอร์ม · ชื่อ key ต้องตรงกับ production-confirmation.html
import { formImages, specMockups } from './jobMockups.ts'

export const OUTBOX_KEY = 'pp142.confirmation.outbox'
export const INBOX_KEY = 'pp142.confirmation.inbox'
export const SAVE_HASH = 'confirmation=save'
// มือถือบางเครื่อง window.open คืน null ทั้งที่เปิดแท็บได้ = 2 แท็บแย่งอ่านใบเดียวกัน · แท็บที่ช้ากว่าจึงบอกว่าบันทึกแล้วในอีกแท็บ
export const TAKEN_KEY = 'pp142.confirmation.taken'
const TAKEN_MS = 2 * 60 * 1000

export type DraftRow = { id: string; confirmation_no: string; customer_name: string | null; data: unknown; updated_at: string }

type Store = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

// บันทึกครั้งเดียว: อ่านแล้วลบออก
export function takeOutbox(store: Store, now = Date.now()): { data: Record<string, unknown>; no: string } | null {
  let raw: string | null = null
  try {
    raw = store.getItem(OUTBOX_KEY)
    store.removeItem(OUTBOX_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const h = (data as { h?: unknown }).h
    // เลขใบไม่ใช่ข้อความ = ข้อมูลเสีย ไม่บันทึก ไม่จดว่าหยิบแล้ว
    const docNo = h && typeof h === 'object' ? (h as { doc_no?: unknown }).doc_no : undefined
    const no = typeof docNo === 'string' ? docNo.trim() : ''
    if (!no) return null
    try { store.setItem(TAKEN_KEY, JSON.stringify({ no, at: now })) } catch { /* จดไม่ได้ก็บันทึกต่อได้ */ }
    return { data: data as Record<string, unknown>, no }
  } catch {
    return null
  }
}

/** เลขที่ใบที่อีกแท็บเพิ่งหยิบไปบันทึก (ภายใน 2 นาที) · ไม่มี = null */
export function recentlyTaken(store: Pick<Storage, 'getItem'>, now = Date.now()): string | null {
  try {
    const t: unknown = JSON.parse(store.getItem(TAKEN_KEY) ?? 'null')
    if (!t || typeof t !== 'object') return null
    const { no, at } = t as { no?: unknown; at?: unknown }
    return typeof no === 'string' && typeof at === 'number' && now - at >= 0 && now - at < TAKEN_MS ? no : null
  } catch {
    return null
  }
}

export function draftLabel(d: Pick<DraftRow, 'confirmation_no' | 'customer_name' | 'updated_at'>): string {
  const day = new Date(d.updated_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })
  return [d.confirmation_no, d.customer_name, `บันทึก ${day}`].filter(Boolean).join(' · ')
}

// งานที่รับแล้วหลุดจากรายการใบร่าง จึงเปิดฟอร์มจากข้อมูลบนงาน · รูปเป็นลิงก์ชั่วคราว ฟอร์มคงรูปในระบบด้วย path ของแต่ละรูป
export function formDataFromJob(spec: unknown, mockupPath: string | null, urls: ReadonlyMap<string, string>): Record<string, unknown> | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null
  const s = spec as Record<string, unknown>
  if (!s.h || typeof s.h !== 'object' || !s.p || typeof s.p !== 'object' || typeof s.product !== 'string') return null
  const out: Record<string, unknown> = { ...s, imgs: formImages(specMockups(s, mockupPath), urls), from_job: true }
  delete out.mockup
  delete out.mockups
  if (mockupPath) out.mockup_path = mockupPath
  return out
}

// ฟอร์มที่เปิดใบของงานไว้ยังส่งมาเป็นใบแก้ แม้งานนั้นถูกยกเลิกไปแล้ว · บันทึกเป็นใบใหม่เลขเดิมแทน (รับงานแล้วงานเก่าเปลี่ยนเป็น "(ยกเลิก)")
const REVISE_ONLY_KEYS = ['revise_job', 'changes', 'base_rev', 'base_token', 'from_job']

export function asNewDraft(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data }
  for (const k of REVISE_ONLY_KEYS) delete out[k]
  return out
}

/** ใบร่างที่บันทึกไว้ → ข้อมูลเปิดในฟอร์มพร้อมรูปทุกรูป */
export function formDataFromDraft(data: unknown, urls: ReadonlyMap<string, string>): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const path = typeof d.mockup_path === 'string' && d.mockup_path ? d.mockup_path : null
  const out: Record<string, unknown> = { ...d, imgs: formImages(specMockups(d, path), urls) }
  delete out.mockups
  return out
}
