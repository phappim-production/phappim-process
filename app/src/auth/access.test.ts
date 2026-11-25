import { expect, it } from 'vitest'
import { canCancelJob, canCloseIssue, canReportDelay, ROLE_LABELS, type EmployeeRole } from './access'

// ต้องตรงกับ close_issue / resume_sewing ในฐานข้อมูล
it('ปิดปัญหาได้เฉพาะฝ่ายผลิต ผู้บริหาร เจ้าของ · แอดมินกับ QC ไม่ได้', () => {
  const allowed: EmployeeRole[] = ['owner', 'production', 'supervisor', 'manager']
  for (const role of ['owner', 'production', 'supervisor', 'manager', 'admin', 'qc'] as EmployeeRole[]) {
    expect(canCloseIssue(role, 'cut'), role).toBe(allowed.includes(role))
    expect(canCloseIssue(role, 'qc_pack'), role).toBe(allowed.includes(role))
  }
})

it('งานเย็บที่พัก ต้องจ่ายจักร จึงเป็นของฝ่ายผลิตเท่านั้น', () => {
  expect(canCloseIssue('production', 'sew')).toBe(true)
  expect(canCloseIssue('owner', 'sew')).toBe(true)
  expect(canCloseIssue('manager', 'sew')).toBe(false)
  expect(canCloseIssue('admin', 'sew')).toBe(false)
})

it('ยกเลิกงานได้เฉพาะผู้บริหารและเจ้าของ', () => {
  for (const role of Object.keys(ROLE_LABELS) as EmployeeRole[]) {
    expect(canCancelJob(role), role).toBe(role === 'manager' || role === 'owner')
  }
})

it('รายงานล่าช้า: พนักงานส่งได้เฉพาะงานที่อยู่สถานีของตัวเอง · บทบาทอื่นตาม submit_delay_report · ผู้บริหารไม่ได้', () => {
  expect(canReportDelay('staff', true)).toBe(true)
  expect(canReportDelay('staff', false)).toBe(false)
  for (const role of ['owner', 'admin', 'production', 'supervisor', 'qc'] as EmployeeRole[]) expect(canReportDelay(role, false), role).toBe(true)
  expect(canReportDelay('manager', true)).toBe(false)
})
