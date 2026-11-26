import type { EmployeeRole, PageKey } from './access.ts'
import type { DashTab } from './scope.ts'

export type OverviewView = 'follow' | 'find' | 'plan'
export type SettingsTab = 'users' | 'assign' | 'stations'

export type Route = {
  page: PageKey
  overviewView?: OverviewView
  tab?: DashTab
  settingsTab?: SettingsTab
}

export const ROUTES: Record<string, Route> = {
  '#/': { page: 'overview' },
  '#/production': { page: 'overview' },
  '#/jobs': { page: 'overview', overviewView: 'find' },
  '#/reviews': { page: 'reviews' },
  '#/admin': { page: 'sysOverview' },
  '#/roles': { page: 'roles' },
  '#/audit': { page: 'audit' },
  '#/board': { page: 'board', tab: 'board' },
  '#/queue': { page: 'board', tab: 'todo' },
  '#/sewing': { page: 'board', tab: 'sewing' },
  '#/mine': { page: 'board', tab: 'todo' },
  '#/dept': { page: 'dept' },
  '#/issues': { page: 'issues' },
  '#/report': { page: 'report' },
  '#/history': { page: 'history' },
  '#/production-queue': { page: 'queueAll' },
  '#/deliveries': { page: 'deliveries' },
  '#/inbox': { page: 'inbox' },
  '#/reports': { page: 'reports' },
  '#/users': { page: 'settings', settingsTab: 'users' },
  '#/assign': { page: 'settings', settingsTab: 'assign' },
  '#/settings': { page: 'settings', settingsTab: 'stations' },
  '#/system': { page: 'system' },
  '#/label': { page: 'label' },
  '#/mockup': { page: 'mockup' },
  '#/artwork': { page: 'artwork' },
  '#/words': { page: 'words' },
}

export function routeOf(path: string): Route {
  return ROUTES[path] ?? ROUTES['#/']
}

export type MenuIcon = 'gauge' | 'list' | 'columns' | 'chart' | 'queue' | 'users' | 'sliders' | 'inbox' | 'flag' | 'clock' | 'shield' | 'pin' | 'log' | 'truck'

export type MenuItem = { hash: string; name: string; short: string; icon: MenuIcon }
export type MenuGroup = { title: string; items: MenuItem[] }

const item = (hash: string, name: string, icon: MenuIcon, short = name): MenuItem => ({ hash, name, short, icon })
const INBOX = item('#/inbox', 'กล่องจดหมาย', 'inbox')
const DELIVERIES = item('#/deliveries', 'กำหนดส่งลูกค้า', 'truck', 'กำหนดส่ง')

export function roleMenu(role: EmployeeRole): MenuGroup[] {
  switch (role) {
    case 'manager':
      return [{ title: 'เมนู', items: [
        item('#/', 'ภาพรวมการผลิต', 'gauge', 'ภาพรวม'),
        DELIVERIES,
        item('#/jobs', 'ใบงานทั้งหมด', 'list', 'ใบงาน'),
        item('#/board', 'ทุกสถานี', 'columns', 'สถานี'),
        item('#/reports', 'รายงาน', 'chart'),
        item('#/reviews', 'รายการรออนุมัติ', 'flag', 'รออนุมัติ'),
        INBOX,
      ] }]
    case 'owner':
      return [
        { title: 'เมนู', items: [
          item('#/admin', 'ภาพรวมระบบ', 'gauge', 'ภาพรวม'),
          item('#/users', 'ผู้ใช้งาน', 'users', 'ผู้ใช้'),
          item('#/roles', 'บทบาทและสิทธิ์', 'shield', 'สิทธิ์'),
          item('#/assign', 'จับคู่สถานี', 'pin', 'จับคู่'),
          item('#/audit', 'บันทึกการเปลี่ยนแปลง', 'log', 'บันทึก'),
          item('#/settings', 'ตั้งค่าระบบ', 'sliders', 'ตั้งค่า'),
        ] },
        { title: 'งานผลิต', items: [
          item('#/production', 'ภาพรวมการผลิต', 'chart', 'การผลิต'),
          DELIVERIES,
          item('#/board', 'ทุกสถานี', 'columns', 'สถานี'),
          item('#/reports', 'รายงาน', 'chart'),
          INBOX,
        ] },
      ]
    case 'admin':
      return [{ title: 'เมนู', items: [
        item('#/', 'ภาพรวมใบงาน', 'gauge', 'ภาพรวม'),
        DELIVERIES,
        item('#/jobs', 'จัดการใบงาน', 'list', 'ใบงาน'),
        item('#/production-queue', 'คิวการผลิต', 'queue', 'คิว'),
        item('#/board', 'ติดตามสถานี', 'columns', 'สถานี'),
        item('#/reports', 'รายงาน', 'chart'),
        INBOX,
      ] }]
    case 'production':
    case 'supervisor':
      return [{ title: 'เมนู', items: [
        item('#/dept', 'ภาพรวมแผนก', 'gauge', 'ภาพรวม'),
        item('#/queue', 'คิวงาน', 'queue'),
        DELIVERIES,
        item('#/board', 'สถานีที่ดูแล', 'columns', 'สถานี'),
        item('#/issues', 'ปัญหา / งานแก้', 'flag', 'ปัญหา'),
        item('#/reports', 'รายงานแผนก', 'chart', 'รายงาน'),
        INBOX,
      ] }]
    case 'qc':
    case 'staff':
      return [{ title: 'เมนู', items: [
        item('#/mine', 'งานของฉัน', 'gauge'),
        item('#/board', 'คิวงานสถานี', 'queue', 'คิวงาน'),
        item('#/history', 'ประวัติการทำงาน', 'clock', 'ประวัติ'),
        item('#/report', 'รายงานปัญหา', 'flag', 'ปัญหา'),
        INBOX,
      ] }]
  }
}

export function bottomBar(groups: MenuGroup[], path: string): { shown: MenuItem[]; more: MenuItem[] } {
  const items = groups.flatMap(g => g.items).filter(i => i.hash !== '#/inbox')
  if (items.length <= 5) return { shown: items, more: [] }
  const active = items.findIndex(i => i.hash === path)
  const shown = items.slice(0, 4)
  if (active >= 4) shown[3] = items[active]
  return { shown, more: items.filter(i => !shown.includes(i)) }
}
