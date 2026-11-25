import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultBack, outSpan } from './outsource'
import { isOutLate, stationCounts, telHref, type Job, type OutRun } from './model'
import { simulate } from './capacity'
import { attachOutRuns, type OutRunRow } from '../data/live'
import { ContactLinks, OutsourcePanel } from '../pages/OutsourcePanel'

const now = new Date('2026-11-18T09:00:00+07:00')
const base: Job = {
  id: 'j', no: 'SC-1', customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 500,
  due: new Date('2026-12-10T18:00:00+07:00'), since: now, route: 'normal', phase: 'production', station: 'print', status: 'queued',
  sampleRound: 1, materials: { admin: true, qc: true, production: true }, queue: 1,
}
const run = (over: Partial<OutRun> = {}): OutRun => ({
  id: 1, vendor: 'บ.A', vendorId: 1, stations: ['print', 'press', 'cut'], qty: 500, rework: false,
  sentAt: now, arriveAt: now, leadDays: 3, backAt: new Date('2026-11-22T10:00:00+07:00'), ...over,
})

// ส่ง พิมพ์-รีด-ตัด ที่ บ.A → เย็บที่ บ.B → กลับมา QC + Packing ที่โรงงาน
describe('ส่งงานออกบริษัทภายนอก', () => {
  it('ส่งได้หลายสถานีติดกัน หยุดที่สถานีที่ต้องทำในโรงงาน', () => {
    expect(outSpan(base, 'print')).toEqual(['print', 'press', 'cut', 'sew'])
    expect(outSpan({ ...base, route: 'dtf' }, 'cut')).toEqual(['cut'])            // รีดฟิล์มทำในโรงงาน
    expect(outSpan({ ...base, route: 'print_emb' }, 'cut')).toEqual(['cut', 'emb', 'sew'])
  })

  it('วันคาดว่าของถึง = ของถึงบริษัท + จำนวนวันที่ใช้', () => {
    expect(defaultBack(new Date('2026-11-19T10:00:00+07:00'), 3).toISOString()).toBe(new Date('2026-11-22T10:00:00+07:00').toISOString())
  })

  it('ผูกรอบส่งออกเข้ากับงาน และรู้ว่าเลยกำหนด', () => {
    const rows: OutRunRow[] = [{ id: 7, job_id: 'j', vendor_id: 3, stations: ['sew'], qty: 300, is_rework: false,
      sent_at: now.toISOString(), arrive_at: now.toISOString(), lead_days: '2', back_at: '2026-11-17T10:00:00+07:00', note: null }]
    const [j] = attachOutRuns([{ ...base, station: 'sew', status: 'out' }], rows, [{ id: 3, name: 'บ.B เย็บ', stations: ['sew'], kind: 'outsource', phone: '081-000-0001', mapUrl: 'https://maps.app.goo.gl/x' }])
    expect(j.out).toMatchObject({ id: 7, vendor: 'บ.B เย็บ', qty: 300, leadDays: 2 })
    expect(isOutLate(j, now)).toBe(true)
  })

  it('คาดวันเสร็จ: งานข้างนอกพร้อมเข้าสถานีถัดไปเมื่อของถึง (ไม่นับกำลังผลิตของโรงงาน)', () => {
    const out = { ...base, status: 'out' as const, out: run() }
    const later = { ...out, out: run({ backAt: new Date('2026-11-27T10:00:00+07:00') }) }
    const a = simulate([out], now).finishDay.get('j')!
    const b = simulate([{ ...later, id: 'k' }], now).finishDay.get('k')!
    expect(b).toBeGreaterThan(a)
  })

  it('สถานีตอนนี้นับงานข้างนอกแยก', () => {
    const rows = stationCounts([{ ...base, status: 'out', out: run() }, { ...base, id: 'x' }], now)
    expect(rows.find(r => r.key === 'print')).toMatchObject({ out: 1, waiting: 1 })
  })
})

describe('แผงส่งออกในรายละเอียดงาน', () => {
  const render = (job: Job, admin: boolean) =>
    renderToStaticMarkup(createElement(OutsourcePanel, { job, vendors: [], admin, now, refresh: async () => {} }))

  it('แอดมินเห็นปุ่มส่งออกและแบ่งจำนวน เมื่องานยังไม่เริ่มสถานี', () => {
    const html = render(base, true)
    expect(html).toContain('ส่งออกบริษัทภายนอก')
    expect(html).toContain('แบ่งจำนวน')
  })

  it('ฝ่ายอื่นไม่เห็นปุ่มส่งออก · งานที่เริ่มแล้วส่งออกไม่ได้', () => {
    expect(render(base, false)).toBe('')
    expect(render({ ...base, status: 'doing' }, true)).toBe('')
  })

  it('งานที่อยู่ข้างนอก: เห็นบริษัท กำหนด และปุ่มรับเข้า / ส่งต่อ', () => {
    const html = render({ ...base, status: 'out', out: run() }, true)
    expect(html).toContain('บ.A')
    expect(html).toContain('พิมพ์งาน → รีดงาน → ตัดงาน')
    expect(html).toContain('รับเข้า')
    expect(html).toContain('ส่งต่อบริษัทอื่น')
  })
})

// ข้อมูลจากชีต Supplier: เบอร์มีชื่อคน/ตัวอักษรปน และบางเบอร์ไม่มี 0 นำหน้า
describe('ข้อมูลติดต่อบริษัท', () => {
  it('แปลงเบอร์ในชีตเป็นลิงก์โทร', () => {
    expect(telHref('0810000002 คุณเอ')).toBe('tel:0810000002')
    expect(telHref('081-000-0003')).toBe('tel:0810000003')
    expect(telHref(' 081-0000004')).toBe('tel:0810000004')
    expect(telHref('0810000005A')).toBe('tel:0810000005')
    expect(telHref('810000006')).toBe('tel:0810000006')
    expect(telHref('020000007')).toBe('tel:020000007')
    expect(telHref('คุณบี')).toBeUndefined()
    expect(telHref(undefined)).toBeUndefined()
  })

  it('ปุ่มโทรและแผนที่ · ไม่มีข้อมูลไม่แสดง', () => {
    const html = renderToStaticMarkup(createElement(ContactLinks, { phone: '0810000001', mapUrl: 'https://maps.app.goo.gl/x' }))
    expect(html).toContain('href="tel:0810000001"')
    expect(html).toContain('เปิดแผนที่')
    expect(renderToStaticMarkup(createElement(ContactLinks, {}))).toBe('')
  })

  it('งานข้างนอกแสดงปุ่มโทรบริษัท', () => {
    const html = renderToStaticMarkup(createElement(OutsourcePanel, {
      job: { ...base, status: 'out', out: run({ phone: '0810000001', mapUrl: 'https://maps.app.goo.gl/x' }) }, vendors: [], admin: true, now, refresh: async () => {},
    }))
    expect(html).toContain('tel:0810000001')
  })
})

describe('เส้นทางผลิตข้างนอกทั้งหมด', () => {
  const outside: Job = { ...base, route: 'outside', station: 'outside' }

  it('ส่งออกได้แค่สั่งผลิตข้างนอก แล้วกลับมา QC + Packing ที่โรงงาน', () => {
    expect(outSpan(outside, 'outside')).toEqual(['outside'])
  })

  it('แอดมินเห็นปุ่มส่งออกที่งานรอสั่งผลิตข้างนอก', () => {
    const html = renderToStaticMarkup(createElement(OutsourcePanel, { job: outside, vendors: [], admin: true, now, refresh: async () => {} }))
    expect(html).toContain('ส่งออกบริษัทภายนอก')
  })

  it('รับกลับแล้วบอกว่าไปรอที่ QC + Packing', () => {
    const html = renderToStaticMarkup(createElement(OutsourcePanel, {
      job: { ...outside, status: 'out', out: run({ stations: ['outside'] }) }, vendors: [], admin: true, now, refresh: async () => {},
    }))
    expect(html).toContain('ของถึงโรงงานแล้ว · รับเข้า')
    expect(html).not.toContain('ส่งต่อบริษัทอื่น')
  })

  it('ประมาณวันเสร็จ: งานรอส่งออกหลายงานไม่ต่อคิวกัน และนับเวลาโรงงานนอกก่อนเข้า QC', () => {
    const jobs = [outside, { ...outside, id: 'k', queue: 2 }]
    const result = simulate(jobs, now)
    const [a, b] = [result.finishDay.get('j')!, result.finishDay.get('k')!]
    expect(a).toBeGreaterThanOrEqual(7)
    expect(b - a).toBeLessThan(1)
    expect(result.bottleneck).not.toBe('outside')
  })
})
