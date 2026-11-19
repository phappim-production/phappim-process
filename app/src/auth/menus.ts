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
  '#/jobs': { page: 'overview', overviewView: 'find' },
  '#/board': { page: 'board' },
  '#/queue': { page: 'board', tab: 'todo' },
  '#/mine': { page: 'board', tab: 'todo' },
  '#/dept': { page: 'dept' },
  '#/issues': { page: 'issues' },
  '#/report': { page: 'report' },
  '#/history': { page: 'history' },
  '#/production-queue': { page: 'queueAll' },
  '#/inbox': { page: 'inbox' },
  '#/reports': { page: 'reports' },
  '#/users': { page: 'settings', settingsTab: 'users' },
  '#/assign': { page: 'settings', settingsTab: 'assign' },
  '#/settings': { page: 'settings', settingsTab: 'stations' },
  '#/system': { page: 'system' },
  '#/label': { page: 'label' },
}

export function routeOf(path: string): Route {
  return ROUTES[path] ?? ROUTES['#/']
}

export type MenuIcon = 'gauge' | 'list' | 'columns' | 'chart' | 'queue' | 'users' | 'sliders' | 'inbox' | 'flag' | 'clock' | 'shield' | 'pin' | 'log'

export type MenuItem = { hash: string; name: string; short: string; icon: MenuIcon }
export type MenuGroup = { title: string; items: MenuItem[] }

const item = (hash: string, name: string, icon: MenuIcon, short = name): MenuItem => ({ hash, name, short, icon })
const INBOX = item('#/inbox', 'กล่องจดหมาย', 'inbox')

export function roleMenu(role: EmployeeRole): MenuGroup[] {
  switch (role) {
    case 'manager':
      return [{ title: 'WORKSPACE', items: [
        item('#/', 'ภาพรวมการผลิต', 'gauge', 'ภาพรวม'),
        item('#/jobs', 'ใบงานทั้งหมด', 'list', 'ใบงาน'),
        item('#/board', 'ทุก Station', 'columns', 'Station'),
        item('#/reports', 'รายงาน', 'chart'),
        INBOX,
      ] }]
    case 'owner':
      return [
        { title: 'WORKSPACE', items: [
          item('#/users', 'ผู้ใช้งาน', 'users', 'ผู้ใช้'),
          item('#/assign', 'Station Assignment', 'pin', 'จับคู่'),
          item('#/settings', 'ตั้งค่าระบบ', 'sliders', 'ตั้งค่า'),
        ] },
        { title: 'งานผลิต', items: [
          item('#/', 'ภาพรวมการผลิต', 'gauge', 'ภาพรวม'),
          item('#/board', 'ทุก Station', 'columns', 'Station'),
          item('#/reports', 'รายงาน', 'chart'),
          INBOX,
        ] },
      ]
    case 'admin':
      return [{ title: 'WORKSPACE', items: [
        item('#/', 'ภาพรวมใบงาน', 'gauge', 'ภาพรวม'),
        item('#/jobs', 'จัดการใบงาน', 'list', 'ใบงาน'),
        item('#/production-queue', 'คิวการผลิต', 'queue', 'คิว'),
        item('#/board', 'ติดตาม Station', 'columns', 'Station'),
        item('#/reports', 'รายงาน', 'chart'),
        INBOX,
      ] }]
    case 'production':
    case 'supervisor':
      return [{ title: 'WORKSPACE', items: [
        item('#/dept', 'ภาพรวมแผนก', 'gauge', 'ภาพรวม'),
        item('#/queue', 'คิวงาน', 'queue'),
        item('#/board', 'Station ที่ดูแล', 'columns', 'Station'),
        item('#/issues', 'ปัญหา / งานแก้', 'flag', 'ปัญหา'),
        item('#/reports', 'รายงานแผนก', 'chart', 'รายงาน'),
        INBOX,
      ] }]
    case 'qc':
    case 'staff':
      return [{ title: 'WORKSPACE', items: [
        item('#/mine', 'งานของฉัน', 'gauge'),
        item('#/board', 'คิวงาน Station', 'queue', 'คิวงาน'),
        item('#/history', 'ประวัติการทำงาน', 'clock', 'ประวัติ'),
        item('#/report', 'แจ้งปัญหา', 'flag'),
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
