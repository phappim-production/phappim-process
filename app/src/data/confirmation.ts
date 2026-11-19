// อ่านไฟล์ .json ที่ฟอร์มใบยืนยันการผลิต (production-confirmation.html) บันทึกไว้ → เติมช่องหน้ารับงานให้
// ไม่ต้องพิมพ์เลขที่ใบ ลูกค้า จำนวน กำหนดส่ง ซ้ำ (พิมพ์ซ้ำ = โอกาสพิมพ์ผิด)
import { ROUTES, type RouteCode } from '../proto/model.ts'

export type ReceiveDraft = {
  no: string
  rev: number
  customer: string
  jobName: string
  product: string        // product_types.code
  qty: number
  spare: number
  due: string            // YYYY-MM-DD
  route: RouteCode | null       // null = ยังไม่ได้เลือก · แอดมินกำหนดเองทุกงาน (เทคนิคพิมพ์ไม่ได้บอกเส้นทางตายตัว)
  needsSample: boolean | null   // null = ยังไม่ได้เลือก (ต้องเลือกก่อนรับงาน)
  spec: Record<string, unknown>
}

type Answers = Record<string, unknown>
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// คำตอบของสินค้าอยู่ใน d.p[d.product] · รองรับไฟล์รุ่นเก่าที่เก็บคำตอบไว้ที่ d.p ตรงๆ
function productAnswers(p: Answers, product: string): Answers {
  const scoped = p[product]
  if (scoped && typeof scoped === 'object' && !Array.isArray(scoped)) {
    return scoped as Answers
  }
  return p
}

// ยอดรวม: ตารางไซซ์ → ตารางรายการ (คอลัมน์ qty) → ช่องจำนวน · ลำดับเดียวกับ totalQty() ในฟอร์ม
export function totalQty(p: Answers): number {
  const sizes = p.sizes
  if (Array.isArray(sizes) && sizes.length) {
    return sizes.reduce((sum: number, row: unknown) => {
      const q = row && typeof row === 'object' ? (row as { q?: Record<string, unknown> }).q : undefined
      return sum + (q ? Object.values(q).reduce((s: number, v) => s + num(v), 0) : 0)
    }, 0)
  }
  const items = p.items
  if (Array.isArray(items) && items.length) {
    return items.reduce((sum: number, row: unknown) => {
      const q = row && typeof row === 'object' ? (row as { qty?: unknown }).qty : undefined
      return sum + num(q)
    }, 0)
  }
  return num(p.qty)
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
  const d = raw as {
    h?: Answers
    p?: Answers
    product?: unknown
    summary?: { qty?: unknown; route?: unknown }
    imgs?: unknown
  }
  if (!d.h || !d.p || typeof d.product !== 'string') return null
  const ans = productAnswers(d.p, d.product)
  const sum = d.summary && typeof d.summary === 'object' ? d.summary : undefined
  const sumQty = sum ? num(sum.qty) : 0
  // ภาพม็อคอัพในไฟล์หนักหลาย MB ไม่เก็บลงฐานข้อมูล (ดูภาพได้จาก PDF)
  const { imgs: _imgs, ...spec } = d as Record<string, unknown>
  return {
    no: text(d.h.doc_no),
    rev: num(d.h.rev),
    customer: text(d.h.customer),
    jobName: text(d.h.job_name),
    product: d.product,
    qty: sumQty > 0 ? sumQty : totalQty(ans),
    spare: num(ans.spare),
    due: /^\d{4}-\d{2}-\d{2}$/.test(text(d.h.due_date)) ? text(d.h.due_date) : '',
    route: null,   // เจ้าของตัดสิน 19 พ.ย.: เส้นทางไม่ตายตัวตามเทคนิค แอดมินเลือกเองตอนรับงาน
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

// สินค้าที่ยังไม่มีสูตรจักร + เส้นทางผ่านเย็บ = ฝ่ายผลิตกดเริ่มเย็บไม่ได้ (ฐานข้อมูลปฏิเสธ) งานค้างที่เย็บ
// เตือนแอดมินก่อนส่งงานเข้า (ตรวจก่อนทดลองจริง 19 พ.ย.: หมวก หมอน เหรียญ โล่ กระจูด พรีเมียม งานบริการ ยังไม่มีสูตร)
export function sewRecipeProblem(route: RouteCode | null, recipe: readonly unknown[]): string | null {
  if (!route || !ROUTES[route].stations.includes('sew') || recipe.length > 0) return null
  return 'สินค้านี้ยังไม่มีข้อมูลจักรเย็บ ถ้าเลือกเส้นทางที่ผ่านเย็บ ฝ่ายผลิตจะกดเริ่มเย็บไม่ได้ · ถ้าไม่ต้องเย็บให้เลือก "ตัดงานลูกค้า" · ถ้าต้องเย็บให้เจ้าของระบบใส่จักรของสินค้านี้ที่ ตั้งค่า ก่อน'
}
