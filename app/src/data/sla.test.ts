import { describe, expect, it } from 'vitest'
import { attachSla } from './live'
import { nextAction } from '../proto/actions'
import type { Job } from '../proto/model'

const base: Job = {
  id: 'a', no: 'SC-A', customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 10,
  due: new Date('2026-11-30T18:00:00+07:00'), since: new Date('2026-11-18T09:00:00+07:00'),
  route: 'plain', phase: 'production', station: 'qc_pack', status: 'doing',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}
const now = new Date('2026-11-18T10:00:00+07:00')
const row = (over: Partial<{ warn: boolean; over: boolean; need_report: boolean; lead_days: number; lead_due: string }>) =>
  ({ job_id: 'a', warn: false, over: false, need_report: false, ...over })

describe('สถานะเวลาผลิตบนการ์ด', () => {
  it('แปลงผลจากฐานข้อมูลเป็นระดับ · ต้องรายงานสำคัญกว่าเกินเวลา', () => {
    expect(attachSla([base], [])[0].sla).toBeUndefined()
    expect(attachSla([base], [row({ warn: true })])[0].sla).toBe('warn')
    expect(attachSla([base], [row({ warn: true, over: true })])[0].sla).toBe('over')
    expect(attachSla([base], [row({ warn: true, over: true, need_report: true })])[0].sla).toBe('report')
  })

  it('โหลดสถานะเวลาใหม่ทุก 5 นาที: งานที่รายงานหรือเสร็จแล้วต้องล้างสีเดิมออก', () => {
    const red = { ...base, sla: 'report' as const }
    expect('sla' in attachSla([red], [])[0]).toBe(false)
    expect(attachSla([red], [row({ over: true })])[0].sla).toBe('over')
    expect(attachSla([base], [])[0]).toBe(base)
  })

  it('แนบเวลาผลิตจากฐานข้อมูล · ตัดเวลาออกจากวันที่', () => {
    expect(attachSla([base], [row({ lead_days: 15, lead_due: '2026-11-18T00:00:00' })])[0].lead).toEqual({ days: 15, due: '2026-11-18' })
    const withLead = attachSla([base], [row({ lead_days: 10, lead_due: '2026-11-12' })])[0]
    expect(attachSla([withLead], [row({ lead_days: 10, lead_due: '2026-11-12' })])[0]).toBe(withLead)
  })

  it('ต้องทำตอนนี้: เกินเวลาผลิตที่ QC + Packing ยังไม่รายงาน = แดงบอกให้รายงาน · สถานีอื่นแค่แดง · ใกล้ครบ = ส้ม', () => {
    const report = nextAction({ ...base, sla: 'report' }, now)
    expect(report?.tone).toBe('danger')
    expect(report?.text).toContain('ส่งรายงานสาเหตุก่อนกด QC + Packing เสร็จ')
    const sewing = nextAction({ ...base, station: 'sew', sla: 'report' }, now)
    expect(sewing?.tone).toBe('danger')
    expect(sewing?.text).not.toContain('รายงาน')
    expect(nextAction({ ...base, sla: 'warn' }, now)?.tone).toBe('warn')
    expect(nextAction(base, now)?.tone).toBe('info')
  })
})
