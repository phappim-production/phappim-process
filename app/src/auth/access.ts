export const ROLE_LABELS = {
  owner: 'เจ้าของระบบ',
  supervisor: 'ผู้ควบคุมงาน',
  admin: 'แอดมิน',
  qc: 'ฝ่าย QC',
  production: 'ฝ่ายผลิต',
  manager: 'ผู้บริหาร',
  staff: 'พนักงานสถานี',
} as const

export type EmployeeRole = keyof typeof ROLE_LABELS
export type PageKey = 'overview' | 'board' | 'reports' | 'settings' | 'system' | 'inbox' | 'label'
  | 'issues' | 'report' | 'history' | 'queueAll' | 'dept'

export type FactoryView = 'overview' | 'board' | 'issues' | 'report' | 'history' | 'queueAll' | 'dept'
export const FACTORY_VIEWS: readonly PageKey[] = ['overview', 'board', 'issues', 'report', 'history', 'queueAll', 'dept']

// ฐานข้อมูลบังคับเอง หน้าเว็บใช้แสดงและกรองงาน
export const SECTION_LABELS = {
  1: 'เฟส 1 พิมพ์-รีด-ตัด',
  2: 'เฟส 2 เย็บ-QC',
} as const

export type Section = keyof typeof SECTION_LABELS

export function toSection(value: unknown): Section | null {
  return value === 1 || value === 2 ? value : null
}

// ผู้ควบคุมงานไม่กำหนดเฟส = คุมได้ทั้ง 2 เฟส จึงบอกให้ชัด ไม่ปล่อยว่าง
export function roleLabel(role: EmployeeRole, section: Section | null): string {
  if (role !== 'supervisor') return ROLE_LABELS[role]
  return `${ROLE_LABELS.supervisor} · ${section ? SECTION_LABELS[section] : 'ทุกเฟส'}`
}

export function isEmployeeRole(role: unknown): role is EmployeeRole {
  return typeof role === 'string' && Object.hasOwn(ROLE_LABELS, role)
}

// ตรงกับ close_issue · แอดมินไม่แก้ปัญหาของสถานี · เย็บที่พักใช้ resume_sewing ซึ่งจ่ายจักร จึงเป็นของฝ่ายผลิต
export function canCloseIssue(role: EmployeeRole, station: string | null | undefined): boolean {
  const floor = role === 'production' || role === 'supervisor' || role === 'owner'
  return station === 'sew' ? floor : floor || role === 'manager'
}

export function canOpenPage(role: EmployeeRole, page: PageKey): boolean {
  switch (page) {
    case 'settings':
      return role === 'owner'
    case 'issues':
      return role === 'production' || role === 'supervisor' || role === 'owner' || role === 'manager'
    case 'dept':
      return role === 'production' || role === 'supervisor' || role === 'owner'
    case 'reports':
      return role !== 'qc' && role !== 'staff'
    // ภาพรวม (รับงานเพิ่มได้ไหม · งานเสี่ยงทั้งโรงงาน) เป็นข้อมูลสำหรับคนตัดสินใจ · คนหน้างานใช้บอร์ดของตัวเอง
    case 'overview':
      return role === 'owner' || role === 'admin' || role === 'manager'
    default:
      return true
  }
}
