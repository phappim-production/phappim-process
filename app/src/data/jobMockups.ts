// รูปม็อคอัพทุกรูปและแบบ (ลาย / สี) ของงาน อ่านจากสเปกที่ฟอร์มใบยืนยันส่งมา · ไฟล์นี้ไม่พึ่ง React ให้ node test import ได้

export type JobMockup = { name: string; path: string }
export type FormMockup = { name: string; path?: string; data?: string }
export type Variant = { name: string; color: string; sizes: string; qty: number; img: number | null }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const count = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** รูปของงานตามลำดับในฟอร์ม (รูป 1 = รูปบนการ์ด) · สเปกรุ่นก่อนหรือลบรูปทั้งหมดใช้ mockup_path */
export function specMockups(spec: unknown, mockupPath: string | null): JobMockup[] {
  const list = isObj(spec) && Array.isArray(spec.mockups)
    ? spec.mockups.flatMap(m => (isObj(m) && text(m.path) ? [{ name: text(m.name), path: text(m.path) }] : []))
    : []
  const first = list[0]
  if (!first) return mockupPath ? [{ name: '', path: mockupPath }] : []
  // เปลี่ยนรูปที่รายละเอียดงานแก้แค่ mockup_path สเปกยังชี้รูปเก่า · รูป 1 ต้องตามรูปบนการ์ด
  if (mockupPath && first.path !== mockupPath) return [{ name: first.name, path: mockupPath }, ...list.slice(1)]
  return list
}

/** รายการรูปจากฟอร์ม · null = ฟอร์มรุ่นเก่าที่ส่งรูปแรกรูปเดียว */
export function formMockups(value: unknown): FormMockup[] | null {
  if (!Array.isArray(value)) return null
  return value.map(m => {
    if (!isObj(m)) return { name: '' }
    const out: FormMockup = { name: text(m.name) }
    if (text(m.path)) out.path = text(m.path)
    else if (typeof m.data === 'string') out.data = m.data
    return out
  })
}

function productPart(spec: unknown): Obj | null {
  if (!isObj(spec) || !isObj(spec.p) || typeof spec.product !== 'string') return null
  const part = spec.p[spec.product]
  return isObj(part) ? part : null
}

const imgNo = (v: unknown, total: number) => {
  const n = count(v)
  return n >= 1 && n <= total ? n : null
}

/** แบบในงาน: ตารางไซซ์ของเสื้อผ้า (แถว = แบบ / สี) หรือตารางรายการ / ตารางแบบ · แถวที่ไม่มีจำนวนไม่นับ */
export function specVariants(spec: unknown, imageCount: number): Variant[] {
  const p = productPart(spec)
  if (!p) return []
  if (Array.isArray(p.sizes) && p.sizes.length) {
    return p.sizes.flatMap(r => {
      if (!isObj(r) || !isObj(r.q)) return []
      const sizes = Object.entries(r.q).map(([s, q]) => [s, count(q)] as const).filter(([, q]) => q > 0)
      const qty = sizes.reduce((a, [, q]) => a + q, 0)
      return qty > 0 ? [{ name: text(r.label), color: '', sizes: sizes.map(([s, q]) => `${s} ${q}`).join(' · '), qty, img: imgNo(r.img, imageCount) }] : []
    })
  }
  if (Array.isArray(p.items)) {
    return p.items.flatMap(r => {
      if (!isObj(r)) return []
      const qty = count(r.qty)
      return qty > 0 ? [{ name: text(r.name), color: text(r.color), sizes: '', qty, img: imgNo(r.img, imageCount) }] : []
    })
  }
  return []
}

// ชื่อโฟลเดอร์ต้องตรงกับ mockupFolder ใน mockups.ts · รูปจากโฟลเดอร์ใบอื่นใช้เป็นรูปบนการ์ดไม่ได้ (receive_job ตรวจโฟลเดอร์)
export function cardPath(list: readonly JobMockup[], folder: string): string | null {
  const first = list[0]
  return first && first.path.split('/')[0] === folder ? first.path : null
}

/** ข้อมูลรูปสำหรับเปิดในฟอร์ม · รูปที่ขอลิงก์ไม่ได้ยังอยู่ในรายการ เลขรูปของแต่ละแบบจะได้ไม่เลื่อน */
export function formImages(list: readonly JobMockup[], urls: ReadonlyMap<string, string>): { name: string; src: string; path: string }[] {
  return list.map(m => ({ name: m.name, src: urls.get(m.path) ?? '', path: m.path }))
}
