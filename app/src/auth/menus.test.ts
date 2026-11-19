import { expect, it } from 'vitest'
import { canOpenPage, ROLE_LABELS, type EmployeeRole } from './access'
import { bottomBar, ROUTES, roleMenu, routeOf } from './menus'

const ROLES = Object.keys(ROLE_LABELS) as EmployeeRole[]
const names = (role: EmployeeRole) => roleMenu(role).flatMap(g => g.items.map(i => i.name))

it('ทุกเมนูของทุกบทบาทมีหน้าจริงและบทบาทนั้นเปิดได้', () => {
  for (const role of ROLES) {
    for (const item of roleMenu(role).flatMap(g => g.items)) {
      expect(ROUTES[item.hash], `${role} ${item.hash}`).toBeDefined()
      expect(canOpenPage(role, routeOf(item.hash).page), `${role} ${item.name}`).toBe(true)
    }
  }
})

it('แถบเมนูล่างบนมือถือไม่เกิน 5 ช่อง · เกินแล้วรวมไว้ใน "เพิ่มเติม" · เมนูที่เปิดอยู่ต้องเห็นบนแถบ', () => {
  for (const role of ROLES) {
    const all = roleMenu(role).flatMap(g => g.items).filter(i => i.hash !== '#/inbox')
    for (const { hash } of all) {
      const { shown, more } = bottomBar(roleMenu(role), hash)
      expect(shown.length + (more.length ? 1 : 0), role).toBeLessThanOrEqual(5)
      expect([...shown, ...more].length, role).toBe(all.length)
      expect(shown.some(i => i.hash === hash), `${role} ${hash}`).toBe(true)
    }
  }
})

it('เมนูตามบทบาท', () => {
  expect(names('manager')).toEqual(['ภาพรวมการผลิต', 'ใบงานทั้งหมด', 'ทุก Station', 'รายงาน', 'กล่องจดหมาย'])
  expect(names('admin')).toEqual(['ภาพรวมใบงาน', 'จัดการใบงาน', 'ติดตาม Station', 'รายงาน', 'กล่องจดหมาย'])
  expect(names('production')).toContain('Station ที่ดูแล')
  expect(names('supervisor')).toEqual(names('production'))
  expect(names('qc')).toEqual(['งานของฉัน', 'คิวงาน Station', 'กล่องจดหมาย'])
  expect(names('staff')).toEqual(names('qc'))
  expect(names('owner')).toEqual(expect.arrayContaining(['ผู้ใช้งาน', 'ตั้งค่าระบบ', 'ภาพรวมการผลิต']))
})

it('ลิงก์ที่ไม่รู้จักไปภาพรวม · ใบงานเปิดมุมมองค้นหา · คิวงานเปิดแท็บต้องทำตอนนี้', () => {
  expect(routeOf('#/nope')).toEqual({ page: 'overview' })
  expect(routeOf('#/jobs')).toEqual({ page: 'overview', overviewView: 'find' })
  expect(routeOf('#/queue').tab).toBe('todo')
  expect(routeOf('#/users').settingsTab).toBe('users')
})

it('รายงานเปิดได้ทุกบทบาทยกเว้น QC และพนักงานสถานี', () => {
  for (const role of ROLES) expect(canOpenPage(role, 'reports'), role).toBe(role !== 'qc' && role !== 'staff')
})
