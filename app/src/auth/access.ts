export const ROLE_LABELS = {
  owner: 'เจ้าของระบบ',
  supervisor: 'ผู้ควบคุมงาน',
  admin: 'แอดมิน',
  qc: 'ฝ่าย QC',
  production: 'ฝ่ายผลิต',
  manager: 'ผู้บริหาร',
} as const

export type EmployeeRole = keyof typeof ROLE_LABELS
export type PageKey = 'overview' | 'board' | 'reports' | 'settings' | 'system' | 'inbox' | 'label'

// เฟสของผู้ควบคุมงาน (docs/แผน-1-สัปดาห์.md หัวข้อ 1.3) · ฐานข้อมูลบังคับเอง หน้าเว็บใช้แสดงและกรองงาน
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

// ปิดปัญหา ("แก้แล้ว ทำต่อ") ตรงกับ close_issue ในฐานข้อมูล · แอดมินไม่มีหน้าที่แก้ปัญหาของสถานี (เจ้าของ 18 พ.ย.)
// งานเย็บที่พักใช้ resume_sewing ซึ่งต้องจ่ายจักร จึงเป็นของฝ่ายผลิตเท่านั้น
export function canCloseIssue(role: EmployeeRole, station: string | null | undefined): boolean {
  const floor = role === 'production' || role === 'supervisor' || role === 'owner'
  return station === 'sew' ? floor : floor || role === 'manager'
}

export function canOpenPage(role: EmployeeRole, page: PageKey): boolean {
  switch (page) {
    case 'settings':
      return role === 'owner'
    case 'reports':
      return role === 'owner' || role === 'manager'
    // ภาพรวม (รับงานเพิ่มได้ไหม · งานเสี่ยงทั้งโรงงาน) เป็นข้อมูลสำหรับคนตัดสินใจ · คนหน้างานใช้บอร์ดของตัวเอง
    case 'overview':
      return role === 'owner' || role === 'admin' || role === 'manager'
    default:
      return true
  }
}
