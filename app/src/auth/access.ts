export const ROLE_LABELS = {
  owner: 'เจ้าของระบบ',
  supervisor: 'ผู้ควบคุมงาน',
  admin: 'แอดมิน',
  qc: 'ฝ่าย QC',
  production: 'ฝ่ายผลิต',
  manager: 'ผู้บริหาร',
} as const

export type EmployeeRole = keyof typeof ROLE_LABELS
export type PageKey = 'overview' | 'board' | 'reports' | 'settings' | 'system'

export function isEmployeeRole(role: unknown): role is EmployeeRole {
  return typeof role === 'string' && Object.hasOwn(ROLE_LABELS, role)
}

export function canOpenPage(role: EmployeeRole, page: PageKey): boolean {
  switch (page) {
    case 'settings':
      return role === 'owner'
    case 'reports':
      return role === 'owner' || role === 'manager'
    default:
      return true
  }
}
