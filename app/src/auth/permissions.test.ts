import { expect, it } from 'vitest'
import { canCloseIssue, canOpenPage, ROLE_LABELS, type EmployeeRole } from './access'
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
