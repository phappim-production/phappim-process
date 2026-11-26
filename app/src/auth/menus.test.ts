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
  expect(names('manager')).toEqual(['ภาพรวมการผลิต', 'ใบงานทั้งหมด', 'ทุกสถานี', 'รายการรออนุมัติ', 'รายงาน', 'กำหนดส่งลูกค้า', 'กล่องจดหมาย'])
  expect(names('admin')).toEqual(['ภาพรวมใบงาน', 'กำหนดส่งลูกค้า', 'จัดการใบงาน', 'ติดตามสถานี', 'คิวการผลิต', 'รายงาน', 'กล่องจดหมาย'])
  expect(names('production')).toEqual(['ภาพรวมแผนก', 'คิวงาน', 'สถานีที่ดูแล', 'ปัญหา / งานแก้', 'รายงานแผนก', 'กำหนดส่งลูกค้า', 'กล่องจดหมาย'])
  expect(names('supervisor')).toEqual(names('production'))
  expect(names('qc')).toEqual(['งานของฉัน', 'คิวงานสถานี', 'ประวัติการทำงาน', 'รายงานปัญหา', 'กล่องจดหมาย'])
  expect(names('staff')).toEqual(names('qc'))
  expect(roleMenu('owner')[0].items.map(i => i.name)).toEqual(['ภาพรวมระบบ', 'ผู้ใช้งาน', 'บทบาทและสิทธิ์', 'จับคู่สถานี', 'บันทึกการเปลี่ยนแปลง', 'ตั้งค่าระบบ'])
})

it('ลิงก์ที่ไม่รู้จักไปภาพรวม · ใบงานเปิดมุมมองค้นหา · คิวงานเปิดแท็บต้องทำตอนนี้', () => {
  expect(routeOf('#/nope')).toEqual({ page: 'overview' })
  expect(routeOf('#/jobs')).toEqual({ page: 'overview', overviewView: 'find' })
  expect(routeOf('#/queue').tab).toBe('todo')
  expect(routeOf('#/board').tab).toBe('board')
  expect(routeOf('#/sewing').tab).toBe('sewing')
  expect(routeOf('#/users').settingsTab).toBe('users')
})

it('รายงานเปิดได้ทุกบทบาทยกเว้น QC และพนักงานสถานี', () => {
  for (const role of ROLES) expect(canOpenPage(role, 'reports'), role).toBe(role !== 'qc' && role !== 'staff')
})

it('หน้าปัญหา/งานแก้ เปิดได้เฉพาะคนที่กดแก้หรือคุมงาน · ภาพรวมแผนกเฉพาะฝ่ายผลิต', () => {
  expect(ROLES.filter(r => canOpenPage(r, 'issues')).sort()).toEqual(['manager', 'owner', 'production', 'supervisor'])
  expect(ROLES.filter(r => canOpenPage(r, 'dept')).sort()).toEqual(['owner', 'production', 'supervisor'])
})

it('คิวการผลิตทั้งโรงงานเปิดตรงๆ ไม่ได้สำหรับพนักงานสถานีและ QC', () => {
  expect(ROLES.filter(r => !canOpenPage(r, 'queueAll')).sort()).toEqual(['qc', 'staff'])
})

it('หน้าของผู้ดูแลระบบเปิดได้เฉพาะเจ้าของ · รายการรออนุมัติเฉพาะผู้บริหาร/เจ้าของ', () => {
  for (const page of ['sysOverview', 'roles', 'audit'] as const) expect(ROLES.filter(r => canOpenPage(r, page)), page).toEqual(['owner'])
  expect(ROLES.filter(r => canOpenPage(r, 'reviews')).sort()).toEqual(['manager', 'owner'])
})

it('กำหนดส่งลูกค้า: แอดมิน ผู้บริหาร ฝ่ายผลิต เจ้าของ เปิดได้ · พนักงานสถานีและ QC ไม่เห็น', () => {
  expect(ROLES.filter(r => !canOpenPage(r, 'deliveries')).sort()).toEqual(['qc', 'staff'])
  expect(routeOf('#/deliveries')).toEqual({ page: 'deliveries' })
  for (const role of ['admin', 'manager', 'production', 'owner'] as EmployeeRole[]) expect(roleMenu(role).flatMap(g => g.items).some(i => i.hash === '#/deliveries'), role).toBe(true)
})

it('แถบล่างมือถือยังเห็นหน้าหลักของแต่ละบทบาทหลังเพิ่มเมนูกำหนดส่ง', () => {
  const shown = (role: EmployeeRole) => bottomBar(roleMenu(role), '#/').shown.map(i => i.hash)
  expect(shown('manager')).toContain('#/reviews')
  expect(shown('production')).toContain('#/issues')
  expect(shown('admin')).toEqual(expect.arrayContaining(['#/deliveries', '#/board']))
})
