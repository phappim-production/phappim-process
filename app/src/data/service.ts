// ใบงานบริการ (ลูกค้าส่งของมา) · ต้องตรงกับ private.service_kind / service_route / spec_product ในฐานข้อมูล
import { ROUTES, type Job, type RouteCode } from '../proto/model.ts'
import { yearOutOfRange } from '../proto/format.ts'

type Spec = Record<string, unknown>
const isRecord = (v: unknown): v is Spec => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export const SERVICE_ROUTES: readonly RouteCode[] = ['sew_only', 'print_only', 'print_press_only', 'press_only', 'dtf_only']
const PRINT_ON_FABRIC = 'พิมพ์แล้วรีดลงผ้าของลูกค้า'
const FILM_CUSTOMER = 'ลูกค้าส่งฟิล์มมาเอง'

function part(spec: Spec, form: string): Spec {
  const p = spec.p
  const own = isRecord(p) ? p[form] : undefined
  return isRecord(own) ? own : {}
}

export function serviceRoute(spec: Spec): RouteCode | null {
  switch (spec.product) {
    case 'svc_sew': return 'sew_only'
    case 'svc_print': return part(spec, 'svc_print').print_output === PRINT_ON_FABRIC ? 'print_press_only' : 'print_only'
    case 'svc_press': return 'press_only'
    case 'svc_dtf': return 'dtf_only'
    default: return null
  }
}

/** null = ใบเย็บอย่างเดียวที่ยังไม่ได้เลือกสินค้า */
export function specProduct(spec: Spec): string | null {
  if (typeof spec.product !== 'string') return null
  if (spec.product !== 'svc_sew') return spec.product
  return text(part(spec, 'svc_sew').garment_code) || null
}

export const CUSTOMER_FABRIC_HINT = 'ลูกค้าส่งผ้ามาเอง: ผ้าผืนที่ต้องตัดใช้เส้นทาง "ไม่มีงานพิมพ์" (ตัด → เย็บ) · ผ้าที่ตัดมาแล้วเย็บอย่างเดียว ให้ทำใบ "เย็บอย่างเดียว" ในหมวดงานบริการของฟอร์มใบยืนยันแทนใบนี้'

export function customerFabric(spec: Spec): boolean {
  if (serviceRoute(spec) || typeof spec.product !== 'string') return false
  const methods = part(spec, spec.product).print_method
  return Array.isArray(methods) && methods.some(m => text(m).startsWith('ลูกค้าส่งผ้ามาเอง'))
}

export const customerFilm = (spec: Spec) => spec.product === 'svc_dtf' && part(spec, 'svc_dtf').film_source === FILM_CUSTOMER

// รายการตั้งต้นของขั้นรอผลิต = ของที่ลูกค้าส่งมาตามใบ · วันคาดว่าได้รับ = วันที่ของจะถึงโรงงาน (นับถึงสิ้นวันทำงาน 17:00)
export function suppliedChecklist(spec: Spec): { name: string; eta: Date | null }[] {
  if (!serviceRoute(spec) || typeof spec.product !== 'string') return []
  const own = part(spec, spec.product)
  const day = text(own.supply_date)
  const eta = /^\d{4}-\d{2}-\d{2}$/.test(day) && !yearOutOfRange(day) ? new Date(`${day}T17:00:00+07:00`) : null
  const rows = Array.isArray(own.supplied) ? own.supplied : []
  const names = rows.flatMap(r => {
    if (!isRecord(r)) return []
    const name = text(r.item).replace(/\s+/gu, ' ')
    if (!name) return []
    const qty = Number(r.qty)
    const amount = Number.isFinite(qty) && qty > 0 ? ` ${qty.toLocaleString('th-TH')} ${text(r.unit)}`.trimEnd() : ''
    const note = text(r.note)
    return [`${name}${amount}${note ? ` (${note})` : ''}`.slice(0, 80)]
  })
  if (customerFilm(spec)) names.push('ฟิล์ม DTF ของลูกค้า')
  return [...new Set(names)].slice(0, 30).map(name => ({ name, eta }))
}

// การ์ดงานบริการบอกขั้นที่ทำก่อนชื่อสินค้า · ชื่อสินค้า svc_* บอกบริการอยู่แล้ว (แต่พิมพ์มี 2 แบบ) จึงใช้ชื่อเส้นทางแทน
export function serviceLabel(j: Pick<Job, 'route' | 'product' | 'productCode'>): { service: string | null; product: string } {
  if (!SERVICE_ROUTES.includes(j.route)) return { service: null, product: j.product }
  return { service: ROUTES[j.route].short, product: j.productCode?.startsWith('svc_') ? '' : j.product }
}
