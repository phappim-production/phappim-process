import { expect, it } from 'vitest'
import { canAckMockup, canApproveMockup, canCloseIssue, canEditMockup, canOpenPage, ROLE_LABELS, type EmployeeRole } from './access'
import { cell, PERMISSIONS, ROLE_ORDER } from './permissions'

const row = (key: string) => PERMISSIONS.find(p => p.key === key)!

it('ตารางสิทธิ์ครบทุกบทบาท', () => {
  expect([...ROLE_ORDER].sort()).toEqual((Object.keys(ROLE_LABELS) as EmployeeRole[]).sort())
})

it('ตารางสิทธิ์ตรงกับที่หน้าเว็บใช้ (ปิดปัญหา · รายงาน · ภาพรวม · ตั้งค่า)', () => {
  for (const role of ROLE_ORDER) {
    expect(cell(row('close'), role) !== false, role).toBe(canCloseIssue(role, 'cut'))
    expect(cell(row('reports'), role) !== false, role).toBe(canOpenPage(role, 'reports'))
    expect(cell(row('overview'), role) !== false, role).toBe(canOpenPage(role, 'overview'))
    expect(cell(row('settings'), role) !== false, role).toBe(canOpenPage(role, 'settings'))
  }
})

it('ตารางสิทธิ์ม็อคอัพตรงกับที่หน้าเว็บใช้ · แอดมินอนุมัติใช้ผลิตเองได้', () => {
  for (const role of ROLE_ORDER) {
    expect(cell(row('mockup_edit'), role) !== false, role).toBe(canEditMockup(role))
    expect(cell(row('mockup_approve'), role) !== false, role).toBe(canApproveMockup(role))
    expect(cell(row('mockup_ack'), role) !== false, role).toBe(canAckMockup(role))
  }
  expect(canApproveMockup('admin')).toBe(true)
  expect(canApproveMockup('supervisor')).toBe(false)
  expect(canOpenPage('staff', 'artwork')).toBe(false)
})
