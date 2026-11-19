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
const row = (over: Partial<{ warn: boolean; over: boolean; need_report: boolean }>) =>
  ({ job_id: 'a', warn: false, over: false, need_report: false, ...over })

describe('สถานะเวลามาตรฐานบนการ์ด', () => {
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

  it('ต้องทำตอนนี้: เกินเวลายังไม่รายงาน = แดงบอกให้รายงาน · ใกล้ครบ = ส้ม', () => {
    const report = nextAction({ ...base, sla: 'report' }, now)
    expect(report?.tone).toBe('danger')
    expect(report?.text).toContain('ส่งรายงานปัญหาก่อนกดเสร็จ')
    expect(nextAction({ ...base, sla: 'warn' }, now)?.tone).toBe('warn')
    expect(nextAction(base, now)?.tone).toBe('info')
  })
})
