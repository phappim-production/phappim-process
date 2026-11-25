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
  | 'issues' | 'report' | 'history' | 'queueAll' | 'dept' | 'reviews' | 'sysOverview' | 'roles' | 'audit' | 'mockup' | 'artwork' | 'words'

export type FactoryView = 'overview' | 'board' | 'issues' | 'report' | 'history' | 'queueAll' | 'dept' | 'reviews'
export const FACTORY_VIEWS: readonly PageKey[] = ['overview', 'board', 'issues', 'report', 'history', 'queueAll', 'dept', 'reviews']

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

// ตรงกับ submit_delay_report (lock_job ปฏิเสธพนักงานที่งานไม่ได้อยู่สถานีของตัวเอง)
export const canReportDelay = (role: EmployeeRole, atMyStation: boolean) =>
  ['owner', 'admin', 'production', 'supervisor', 'qc', 'staff'].includes(role) && (role !== 'staff' || atMyStation)

// ตรงกับ cancel_job · ยกเลิกออเดอร์เป็นการตัดสินใจทางธุรกิจ ฝ่ายผลิต/แอดมินไม่มีสิทธิ์
export function canCancelJob(role: EmployeeRole): boolean {
  return role === 'manager' || role === 'owner'
}

export function canOpenPage(role: EmployeeRole, page: PageKey): boolean {
  switch (page) {
    case 'settings':
    case 'sysOverview':
    case 'roles':
    case 'audit':
      return role === 'owner'
    case 'reviews':
      return role === 'manager' || role === 'owner'
    case 'issues':
      return role === 'production' || role === 'supervisor' || role === 'owner' || role === 'manager'
    case 'dept':
      return role === 'production' || role === 'supervisor' || role === 'owner'
    case 'reports':
      return role !== 'qc' && role !== 'staff'
    // ภาพรวม (รับงานเพิ่มได้ไหม · งานเสี่ยงทั้งโรงงาน) เป็นข้อมูลสำหรับคนตัดสินใจ · คนหน้างานใช้บอร์ดของตัวเอง
    case 'overview':
      return role === 'owner' || role === 'admin' || role === 'manager'
    case 'artwork':
      return role !== 'staff'
    // คิวทั้งโรงงานเป็นของคนวางแผน · staff/QC เห็นแค่คิวสถานีของตัวเองที่บอร์ด
    case 'queueAll':
      return role !== 'staff' && role !== 'qc'
    default:
      return true
  }
}

// ตรงกับ start/save/approve/ack_mockup_sheet ในฐานข้อมูล · แอดมินทำร่างและอนุมัติใช้ผลิตเองได้
export const canEditMockup = (role: EmployeeRole) => role === 'admin' || role === 'owner'
export const canApproveMockup = (role: EmployeeRole) => ['owner', 'admin', 'manager', 'production'].includes(role)
// ตรงกับ return_mockup_sheet: แอดมินเป็นคนทำม็อคอัพ จึงส่งกลับให้ตัวเองแก้ไม่ได้
export const canReturnMockup = (role: EmployeeRole) => ['owner', 'manager', 'production'].includes(role)
export const canAckMockup = (role: EmployeeRole) => ['owner', 'production', 'supervisor', 'qc', 'staff'].includes(role)
export const canSeeMockupDraft = (role: EmployeeRole) => ['owner', 'manager', 'admin', 'production', 'supervisor'].includes(role)
