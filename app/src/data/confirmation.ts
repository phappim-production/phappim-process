// อ่านไฟล์ .json ที่ฟอร์มใบยืนยันการผลิต (production-confirmation.html) บันทึกไว้ → เติมช่องหน้ารับงานให้
// ไม่ต้องพิมพ์เลขที่ใบ ลูกค้า จำนวน กำหนดส่ง ซ้ำ (พิมพ์ซ้ำ = โอกาสพิมพ์ผิด)
import type { RouteCode } from '../proto/model.ts'

export type ReceiveDraft = {
  no: string
  rev: number
  customer: string
  jobName: string
  product: string        // product_types.code
  qty: number
  spare: number
  due: string            // YYYY-MM-DD
  route: RouteCode
  needsSample: boolean | null   // null = ยังไม่ได้เลือก (ต้องเลือกก่อนรับงาน)
  spec: Record<string, unknown>
}

type Answers = Record<string, unknown>
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// ยอดรวม: ตารางไซซ์ (ทุกช่องในแต่ละแถว) → ช่องจำนวน · เหมือน totalQty() ในฟอร์ม
export function totalQty(p: Answers): number {
  const sizes = p.sizes
  if (Array.isArray(sizes) && sizes.length) {
    return sizes.reduce((sum: number, row: unknown) => {
      const q = row && typeof row === 'object' ? (row as { q?: Record<string, unknown> }).q : undefined
      return sum + (q ? Object.values(q).reduce((s: number, v) => s + num(v), 0) : 0)
    }, 0)
  }
  return num(p.qty)
}

// เทคนิคที่เลือกกำหนดเส้นทาง: ฟิล์มที่สั่งเข้า (DTF / DTG / สกรีน) ก่อน · ปัก (มีพิมพ์ซับด้วย = พิมพ์ + ปัก)
// · ซับลิเมชั่น/ดิจิทัล = ปกติ · นอกนั้น ไม่พิมพ์ · หลายเทคนิคที่ไม่มีเส้นทางรวม ให้ผู้รับงานตรวจอีกครั้ง
export function suggestRoute(p: Answers): RouteCode {
  const methods = ([] as unknown[]).concat(p.print_method ?? []).map(String)
  const has = (re: RegExp) => methods.some(m => re.test(m))
  const sub = has(/ซับลิเมชั่น|ดิจิทัล/)
  if (has(/DTF/i)) return 'dtf'
  if (has(/DTG/i)) return 'dtg'
  if (has(/ซิลค์|สกรีน/)) return 'screen'
  if (has(/ปัก/)) return sub ? 'print_emb' : 'emb'
  if (sub) return 'normal'
  return 'plain'
}

// ฟอร์มใบยืนยันมีช่อง "ขึ้นตัวอย่าง" · ไฟล์รุ่นเก่าไม่มีช่องนี้ → null ให้ผู้รับงานเลือกเอง
export function sampleChoice(h: Answers): boolean | null {
  const v = text(h.sample)
  if (/^ไม่ขึ้นตัวอย่าง/.test(v)) return false
  if (/^ขึ้นตัวอย่าง/.test(v)) return true
  return null
}

/** null = ไม่ใช่ไฟล์จากฟอร์มใบยืนยัน */
export function draftFromConfirmation(raw: unknown): ReceiveDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as { h?: Answers; p?: Answers; product?: unknown; imgs?: unknown }
  if (!d.h || !d.p || typeof d.product !== 'string') return null
  // ภาพม็อคอัพในไฟล์หนักหลาย MB ไม่เก็บลงฐานข้อมูล (ดูภาพได้จาก PDF)
  const { imgs: _imgs, ...spec } = d as Record<string, unknown>
  return {
    no: text(d.h.doc_no),
    rev: num(d.h.rev),
    customer: text(d.h.customer),
    jobName: text(d.h.job_name),
    product: d.product,
    qty: totalQty(d.p),
    spare: num(d.p.spare),
    due: /^\d{4}-\d{2}-\d{2}$/.test(text(d.h.due_date)) ? text(d.h.due_date) : '',
    route: suggestRoute(d.p),
    needsSample: sampleChoice(d.h),
    spec,
  }
}

// ชื่อไฟล์ใน Storage ใช้ตัวอักษรอังกฤษ/ตัวเลขเท่านั้น (ชื่อไทยทำให้อัปโหลดไม่ผ่าน) · ใส่เวลากันชื่อซ้ำ
export function confirmationPath(no: string, at: Date): string {
  const safe = no.trim().replace(/[^A-Za-z0-9-]/g, '_') || 'job'
  return `${safe}/${at.getTime()}.pdf`
}

export const MAX_PDF_BYTES = 20 * 1024 * 1024

export function pdfProblem(file: { name: string; size: number; type: string } | null): string | null {
  if (!file) return 'ต้องแนบ PDF ใบยืนยันที่ลูกค้าเซ็นครบ'
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return 'ไฟล์ต้องเป็น PDF'
  if (file.size > MAX_PDF_BYTES) return `ไฟล์ใหญ่ ${(file.size / 1024 / 1024).toFixed(1)} MB เกิน 20 MB ให้ย่อไฟล์ก่อน หรือใช้ PDF ที่ฟอร์มสร้าง`
  return null
}
