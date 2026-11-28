// เติมช่องหน้ารับงานจากไฟล์ของฟอร์มใบยืนยัน เพราะพิมพ์ซ้ำ = โอกาสพิมพ์ผิด
import { ROUTES, type RouteCode } from '../proto/model.ts'
import { yearOutOfRange } from '../proto/format.ts'
import { serviceRoute, specProduct } from './service.ts'

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
  develop: boolean
  spec: Record<string, unknown>
}

type Answers = Record<string, unknown>
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
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

export function developChoice(h: Answers): boolean {
  return /^ขึ้นตัวอย่าง.*Develop/.test(text(h.sample))
}

// ต้องตรงกับตัวเลือกช่อง "ขึ้นตัวอย่าง" ในฟอร์มใบยืนยันทุกตัวอักษร ฟอร์มเทียบข้อความนี้ตอนแก้ใบ
const SAMPLE_TEXT = {
  yes: 'ขึ้นตัวอย่าง (ลูกค้าจ่ายค่าตัวอย่าง)',
  develop: 'ขึ้นตัวอย่าง (งาน Develop · จบที่ตัวอย่าง ไม่ผลิตจริง)',
  no: 'ไม่ขึ้นตัวอย่าง',
}

/** null = ไม่ใช่ไฟล์จากฟอร์มใบยืนยัน */
export function draftFromConfirmation(raw: unknown): ReceiveDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const file = raw as {
    h?: Answers
    p?: Answers
    product?: unknown
    summary?: { qty?: unknown; route?: unknown }
    imgs?: unknown
    sys?: unknown
  }
  if (!file.h || !file.p || typeof file.product !== 'string') return null
  // ไฟล์จาก "บันทึกไฟล์" เก็บฟอร์มครบทุกสินค้าไว้เปิดแก้ต่อ · sys = ฉบับที่คัดช่องซ่อนและชุดไซซ์ที่ไม่ได้ติ๊กออกแล้ว
  const sys = isRecord(file.sys) && isRecord(file.sys.h) && isRecord(file.sys.p) ? file.sys : null
  const d = { ...file, h: sys ? sys.h as Answers : file.h, p: sys ? sys.p as Answers : file.p, product: file.product }
  const ans = productAnswers(d.p, d.product)
  const sum = d.summary && typeof d.summary === 'object' ? d.summary : undefined
  const sumQty = sum ? num(sum.qty) : 0
  // ภาพม็อคอัพในไฟล์หนักหลาย MB ไม่เก็บลงฐานข้อมูล (ดูภาพได้จาก PDF)
  const { imgs: _imgs, sys: _sys, sent_sig: _sig, pickOpen: _pick, ...rest } = d as Record<string, unknown>
  const spec = isRecord(d.p[d.product]) ? { ...rest, p: { [d.product]: d.p[d.product] } } : rest
  return {
    no: text(d.h.doc_no),
    rev: num(d.h.rev),
    customer: text(d.h.customer),
    jobName: text(d.h.job_name),
    product: specProduct(spec) ?? d.product,
    qty: sumQty > 0 ? sumQty : totalQty(ans),
    spare: num(ans.spare),
    due: /^\d{4}-\d{2}-\d{2}$/.test(text(d.h.due_date)) ? text(d.h.due_date) : '',
    route: serviceRoute(spec),
    needsSample: sampleChoice(d.h),
    develop: developChoice(d.h),
    spec,
  }
}

export type ReviseArgs = {
  p_spec: Record<string, unknown>
  p_rev: number
  p_customer_name: string
  p_job_name: string
  p_qty: number
  p_spare_qty: number
  p_due_date: string | null
  p_needs_sample: boolean | null
  p_changes: string[]
}

// ใบที่มาจากฟอร์ม: จำนวนและสินค้าอยู่ในสเปกด้วย แก้ที่หน้ารับงานอย่างเดียวจะไม่ตรงกับใบ
export function isFormDraft(draft: Pick<ReceiveDraft, 'spec'>): boolean {
  const s = draft.spec
  return isRecord(s.h) && isRecord(s.p) && typeof s.product === 'string'
}
export const FORM_LOCK_REASON = 'แก้ในฟอร์มใบยืนยัน แล้วบันทึกเข้าระบบใหม่'

/** ปรับหัวใบและจำนวนเผื่อเสียใน spec ให้ตรงกับค่าที่แอดมินแก้หน้ารับงาน ก่อนส่งเข้า receive_job */
export function syncConfirmationSpec(draft: ReceiveDraft, productName: string): Record<string, unknown> {
  const s = draft.spec
  if (!isRecord(s.h) || !isRecord(s.p) || typeof s.product !== 'string') return s
  const h: Record<string, unknown> = {
    ...s.h,
    doc_no: draft.no.trim(),
    rev: draft.rev > 0 ? draft.rev : '',
    customer: draft.customer.trim(),
    job_name: draft.jobName.trim() || productName,
    due_date: draft.due || s.h.due_date,
    sample: draft.needsSample === null ? s.h.sample : !draft.needsSample ? SAMPLE_TEXT.no : draft.develop ? SAMPLE_TEXT.develop : SAMPLE_TEXT.yes,
  }
  // ใบงานบริการเก็บคำตอบไว้ที่ชนิดใบ (svc_*) แม้งานเย็บอย่างเดียวใช้รหัสสินค้าเสื้อผ้า
  if (serviceRoute(s)) {
    const own = s.p[s.product]
    return { ...s, h, p: isRecord(own) ? { [s.product]: { ...own, spare: draft.spare > 0 ? draft.spare : '' } } : s.p }
  }
  // สินค้าในใบปิดใช้แล้ว แอดมินเลือกสินค้าใหม่ · สเปกต้องเป็นสินค้าเดียวกับงาน ไม่อย่างนั้นแก้ใบภายหลังไม่ได้
  const part = s.p[draft.product] ?? s.p[s.product]
  const p = isRecord(part)
    ? { [draft.product]: { ...part, spare: draft.spare > 0 ? draft.spare : '' } }
    : s.p
  return { ...s, product: draft.product, h, p }
}

const SPEC_DATES = [['issue_date', 'วันที่ออกใบ'], ['sample_date', 'วันนัดส่งตัวอย่าง']] as const

/** ชื่อช่องวันที่ในสเปกที่ปีไม่ใช่ ค.ศ. (ไฟล์ .json เก่า) · null = ไม่มีปัญหา */
export function specYearProblem(draft: Pick<ReceiveDraft, 'spec'>): string | null {
  const h = draft.spec.h
  if (!isRecord(h)) return null
  const bad = SPEC_DATES.find(([k]) => typeof h[k] === 'string' && yearOutOfRange(h[k]))
  return bad ? bad[1] : null
}

const FORM_ONLY_KEYS = ['revise_job', 'changes', 'mockup', 'mockup_path', 'from_job', 'job_img', 'job_imgs', 'job_no', 'mockup_no']

/** ใบที่แก้หลังรับงาน → ค่าส่งให้ revise_job_spec · null = ไม่ใช่ข้อมูลจากฟอร์มใบยืนยัน */
export function reviseArgs(raw: unknown): ReviseArgs | null {
  const d = draftFromConfirmation(raw)
  if (!d) return null
  const spec = { ...d.spec }
  for (const k of FORM_ONLY_KEYS) delete spec[k]
  const listed = (raw as { changes?: unknown }).changes
  const changes = Array.isArray(listed) ? [...new Set(listed.map(text).filter(Boolean))].slice(0, 40) : []
  return {
    p_spec: spec, p_rev: d.rev, p_customer_name: d.customer, p_job_name: d.jobName, p_qty: d.qty, p_spare_qty: d.spare,
    p_due_date: d.due || null, p_needs_sample: d.needsSample, p_changes: changes,
  }
}

// ชื่อไฟล์ใช้อังกฤษ/ตัวเลขเท่านั้น (ชื่อไทยอัปโหลดไม่ผ่าน) · ชื่อไฟล์ = ลายนิ้วมือเนื้อไฟล์ ส่งซ้ำได้ไฟล์เดิม
export const SIGNED_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const
export type SignedExt = keyof typeof SIGNED_TYPES
export const SIGNED_ACCEPT = 'application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'

// บางเครื่อง (Android / ไฟล์จากแอปแชต) ไม่บอกชนิดไฟล์ จึงดูนามสกุลด้วย · Worker ตรวจเนื้อไฟล์อีกชั้น
export function signedExt(file: { name: string; type: string }): SignedExt | null {
  const byType = (Object.keys(SIGNED_TYPES) as SignedExt[]).find(k => SIGNED_TYPES[k] === file.type)
  if (byType) return byType
  if (file.type && file.type !== 'application/octet-stream') return null
  const ext = /\.(pdf|jpe?g|png|webp)$/i.exec(file.name)?.[1].toLowerCase()
  return ext === 'jpeg' ? 'jpg' : (ext as SignedExt | undefined) ?? null
}

export function confirmationPath(no: string, key: string, ext: SignedExt = 'pdf'): string {
  const safe = no.trim().replace(/[^A-Za-z0-9-]/g, '_') || 'job'
  return `${safe}/${key}.${ext}`
}

export const isSignedImage = (path: string) => /\.(jpg|png|webp)$/i.test(path)

export const MAX_PDF_BYTES = 20 * 1024 * 1024

export function signedFileProblem(file: { name: string; size: number; type: string } | null): string | null {
  if (!file) return 'ต้องแนบใบยืนยันที่ลูกค้าเซ็นครบ (PDF หรือรูป)'
  if (!signedExt(file)) return 'ไฟล์ต้องเป็น PDF หรือรูป (JPG / PNG / WEBP)'
  if (file.size > MAX_PDF_BYTES) return `ไฟล์ใหญ่ ${(Math.ceil(file.size / 104857.6) / 10).toFixed(1)} MB เกิน 20 MB ให้ย่อไฟล์ก่อน หรือใช้ PDF ที่ฟอร์มสร้าง`
  return null
}

// สินค้าที่ยังไม่มีสูตรจักร + เส้นทางผ่านเย็บ = ฐานข้อมูลไม่ให้เริ่มเย็บ งานจะค้าง จึงเตือนแอดมินก่อนส่งเข้า
export function sewRecipeProblem(route: RouteCode | null, recipe: readonly unknown[]): string | null {
  if (!route || !ROUTES[route].stations.includes('sew') || recipe.length > 0) return null
  return 'สินค้านี้ยังไม่มีข้อมูลจักรเย็บ ถ้าเลือกเส้นทางที่ผ่านเย็บ ฝ่ายผลิตจะกดเริ่มเย็บไม่ได้ · ถ้าไม่ต้องเย็บให้เลือก "ตัดงานลูกค้า" · ถ้าต้องเย็บให้เจ้าของระบบใส่จักรของสินค้านี้ที่ ตั้งค่า ก่อน'
}
