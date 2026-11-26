import { describe, expect, it } from 'vitest'
import { customerFilm, serviceLabel, serviceRoute, specProduct, suppliedChecklist } from './service'
import { draftFromConfirmation, syncConfirmationSpec } from './confirmation'
import { ROUTES } from '../proto/model'

const spec = (product: string, part: Record<string, unknown> = {}) => ({ product, h: { doc_no: 'SC-SV-1', customer: 'ลูกค้า' }, p: { [product]: part } })

describe('ใบงานบริการกำหนดเส้นทางผลิต', () => {
  it.each([
    ['svc_sew', {}, 'sew_only'],
    ['svc_print', { print_output: 'ส่งกระดาษให้ลูกค้า (ลูกค้ารีดเอง)' }, 'print_only'],
    ['svc_print', { print_output: 'พิมพ์แล้วรีดลงผ้าของลูกค้า' }, 'print_press_only'],
    ['svc_press', {}, 'press_only'],
    ['svc_dtf', { film_source: 'โรงงานสั่งฟิล์ม' }, 'dtf_only'],
  ])('%s %j → %s', (product, part, route) => {
    expect(serviceRoute(spec(product, part))).toBe(route)
  })
  it('สินค้าปกติ / งานบริการอื่นๆ ไม่ล็อกเส้นทาง', () => {
    expect(serviceRoute(spec('tshirt'))).toBeNull()
    expect(serviceRoute(spec('service'))).toBeNull()
  })
  it('เส้นทางสถานีเดียวแล้ว QC (พิมพ์ + รีดมี 2 สถานี)', () => {
    expect(ROUTES.sew_only.stations).toEqual(['sew', 'qc_pack'])
    expect(ROUTES.print_press_only.stations).toEqual(['print', 'press', 'qc_pack'])
    expect(ROUTES.dtf_only.stations).toEqual(['dtf_press', 'qc_pack'])
  })
})

describe('เย็บอย่างเดียวใช้รหัสสินค้าเสื้อผ้าที่เลือก', () => {
  it('รหัสสินค้ามาจาก garment_code · ยังไม่เลือก = null', () => {
    expect(specProduct(spec('svc_sew', { garment_code: 'polo' }))).toBe('polo')
    expect(specProduct(spec('svc_sew', { garment_code: '' }))).toBeNull()
    expect(specProduct(spec('svc_print'))).toBe('svc_print')
  })
  it('หน้ารับงาน: สินค้า = เสื้อผ้า · เส้นทางตั้งให้ · สเปกยังเป็นใบ svc_sew (แก้ใบภายหลังได้)', () => {
    const d = draftFromConfirmation({ ...spec('svc_sew', { garment: 'เสื้อโปโล', garment_code: 'polo', sizes: [{ q: { M: 10 } }] }), h: { doc_no: 'SC-SV-1', customer: 'ลูกค้า', due_date: '2026-12-20' } })!
    expect(d.product).toBe('polo')
    expect(d.route).toBe('sew_only')
    expect(d.qty).toBe(10)
    const synced = syncConfirmationSpec({ ...d, spare: 2, needsSample: false }, 'เสื้อโปโล')
    expect(synced.product).toBe('svc_sew')
    expect(Object.keys(synced.p as object)).toEqual(['svc_sew'])
    expect((synced.p as Record<string, Record<string, unknown>>).svc_sew.spare).toBe(2)
  })
})

describe('รายการเช็คของตั้งต้นตอนรอผลิต', () => {
  it('จากของที่ลูกค้าส่งมา + ฟิล์มของลูกค้า', () => {
    const s = spec('svc_dtf', { film_source: 'ลูกค้าส่งฟิล์มมาเอง', supplied: [
      { item: 'เสื้อยืดสีดำ', qty: 1200, unit: 'ตัว', note: 'ไม่มีตำหนิ' }, { item: ' ', qty: 1 }, { item: 'ถุงแพ็ค', qty: '', unit: 'ชิ้น' },
    ] })
    expect(customerFilm(s)).toBe(true)
    expect(suppliedChecklist(s)).toEqual(['เสื้อยืดสีดำ 1,200 ตัว (ไม่มีตำหนิ)', 'ถุงแพ็ค', 'ฟิล์ม DTF ของลูกค้า'])
  })
  it('สินค้าปกติไม่ใส่รายการให้', () => {
    expect(suppliedChecklist(spec('tshirt', { supplied: [{ item: 'ผ้า' }] }))).toEqual([])
  })
})


describe('ป้ายบนการ์ดงานบริการ', () => {
  it('เย็บอย่างเดียวบอกขั้น + สินค้าที่เย็บ · ใบ svc_* ใช้ชื่อขั้นอย่างเดียว · งานปกติเหมือนเดิม', () => {
    expect(serviceLabel({ route: 'sew_only', product: 'เสื้อโปโล', productCode: 'polo' })).toEqual({ service: 'เย็บอย่างเดียว', product: 'เสื้อโปโล' })
    expect(serviceLabel({ route: 'print_press_only', product: 'งานบริการ: พิมพ์อย่างเดียว', productCode: 'svc_print' })).toEqual({ service: 'พิมพ์+รีด', product: '' })
    expect(serviceLabel({ route: 'normal', product: 'เสื้อยืด', productCode: 'tshirt' })).toEqual({ service: null, product: 'เสื้อยืด' })
  })
})
