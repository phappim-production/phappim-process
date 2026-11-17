// ใบยืนยันการผลิตที่บันทึกเข้าระบบ (ตาราง confirmation_drafts · 20261119230000)
// ฟอร์ม (/confirmation) อยู่เว็บเดียวกับระบบ จึงส่งข้อมูลกันผ่าน localStorage:
//   ฟอร์ม "บันทึกเข้าระบบ" → OUTBOX → หน้าระบบ (#/board?confirmation=save) เรียก save_confirmation_draft
//   หน้าระบบ "เปิดในฟอร์ม" → INBOX → ฟอร์มโหลดข้อมูลมาแก้ต่อ
// ฟอร์มจึงไม่ต้องมีรหัสเข้าระบบเอง · ชื่อ key ต้องตรงกับใน production-confirmation.html

export const OUTBOX_KEY = 'pp142.confirmation.outbox'
export const INBOX_KEY = 'pp142.confirmation.inbox'
export const SAVE_HASH = 'confirmation=save'

export type DraftRow = { id: string; confirmation_no: string; customer_name: string | null; data: unknown; updated_at: string }

type Store = Pick<Storage, 'getItem' | 'removeItem'>

/** อ่านใบที่ฟอร์มส่งมาให้บันทึก แล้วลบออก (บันทึกครั้งเดียว) · ไม่ใช่ข้อมูลใบยืนยัน = null */
export function takeOutbox(store: Store): { data: Record<string, unknown>; no: string } | null {
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
    const no = h && typeof h === 'object' ? String((h as { doc_no?: unknown }).doc_no ?? '').trim() : ''
    return no ? { data: data as Record<string, unknown>, no } : null
  } catch {
    return null
  }
}

/** ข้อความในรายการเลือกใบ: เลขที่ใบ · ลูกค้า · วันที่บันทึกล่าสุด */
export function draftLabel(d: Pick<DraftRow, 'confirmation_no' | 'customer_name' | 'updated_at'>): string {
  const day = new Date(d.updated_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })
  return [d.confirmation_no, d.customer_name, `บันทึก ${day}`].filter(Boolean).join(' · ')
}
