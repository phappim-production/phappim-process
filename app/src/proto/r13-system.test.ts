import { describe, expect, it } from 'vitest'
import { canOpenPage, type EmployeeRole } from '../auth/access'
import { simulate, workdayToDate, workdaysUntil, lateDays } from './capacity'
import type { Job } from './model'

const saturday = new Date(2026, 10, 21, 9)
const sunday = new Date(2026, 10, 22, 9)
const monday = new Date(2026, 10, 23, 9)
const base: Job = {
  id: 'r13-capacity', no: 'TEST-R13-FORECAST', customer: 'ลูกค้าจำลอง', product: 'หมวก', unit: 'ใบ',
  qty: 10, due: sunday, since: saturday, sampleRound: 1, phase: 'production', station: 'outside',
  route: 'outside', status: 'queued', materials: { admin: true, qc: true, production: true },
}
function estimate(job: Job) {
  const forecast = simulate([job], saturday)
  const finish = forecast.finishDay.get(job.id)
  expect(finish).toBeDefined()
  return { date: workdayToDate(finish ?? 0, saturday), bottleneck: forecast.bottleneck }
}

describe('C15 ปฏิทินและสิทธิ์เมนู', () => {
  it('ฟิล์มถึงอาทิตย์ เลื่อนไปจันทร์และเตือนหากกำหนดส่งอาทิตย์', () => {
    const result = estimate({
      ...base, route: 'dtf', station: 'dtf_press',
      film: { eta: sunday, received: false },
    })
    expect(result.date.getDate()).toBe(23)
    expect(lateDays(result.date, sunday)).toBe(1)
    expect(workdaysUntil(sunday, saturday)).toBe(workdaysUntil(monday, saturday))
  })

  it('ของกลับอาทิตย์เริ่ม QC จันทร์และสถานีนอกไม่เป็นคอขวด', () => {
    const result = estimate({
      ...base, status: 'out', out: {
        id: 1, vendorId: 1, vendor: 'บริษัทจำลอง', stations: ['outside'], qty: 10, rework: false,
        sentAt: saturday, arriveAt: saturday, leadDays: 1, backAt: sunday,
      },
    })
    expect(result.date.getDate()).toBe(23)
    expect(result.bottleneck).toBe('qc_pack')
  })

  it.each(['owner', 'manager', 'production', 'supervisor', 'admin', 'qc', 'staff'] as EmployeeRole[])(
    'เข้าหน้าตั้งค่าและตรวจย้อนหลังโดยตรงด้วย %s',
    role => {
      for (const page of ['settings', 'sysOverview', 'roles', 'audit'] as const) expect(canOpenPage(role, page)).toBe(role === 'owner')
      expect(canOpenPage(role, 'reports')).toBe(role !== 'qc' && role !== 'staff')
    },
  )
})
