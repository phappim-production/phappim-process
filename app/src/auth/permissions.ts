import type { EmployeeRole } from './access.ts'

export type Cell = true | false | string
export type Permission = { key: string; name: string; roles: Partial<Record<EmployeeRole, Cell>> }

export const ROLE_ORDER: EmployeeRole[] = ['owner', 'manager', 'admin', 'production', 'supervisor', 'qc', 'staff']

// ตรงกับ require_role / lock_job ในฐานข้อมูล · ฐานข้อมูลบังคับจริง ตารางนี้ใช้อธิบาย
export const PERMISSIONS: Permission[] = [
  { key: 'receive', name: 'รับงานใหม่ · บันทึกใบยืนยัน', roles: { owner: true, admin: true } },
  { key: 'station', name: 'เริ่ม / เสร็จ / พักงานที่สถานี', roles: {
    owner: true, production: true, supervisor: 'เฟสที่ดูแล', qc: 'QC + Packing', staff: 'สถานีที่จับคู่' } },
  { key: 'qc', name: 'บันทึกผล QC · ส่งแก้', roles: { owner: true, production: true, supervisor: 'เฟส 2', qc: true, staff: 'ถ้าจับคู่ QC' } },
  { key: 'issue', name: 'แจ้งปัญหา (พักงาน)', roles: {
    owner: true, admin: true, production: true, supervisor: 'เฟสที่ดูแล', qc: 'QC + Packing', staff: 'สถานีที่จับคู่' } },
  { key: 'close', name: '"แก้แล้ว ทำต่อ"', roles: { owner: true, manager: 'ยกเว้นเย็บ', production: true, supervisor: true } },
  { key: 'insert', name: 'แทรกงานด่วนเข้าคิว', roles: { owner: true, manager: true, production: true, supervisor: true } },
  { key: 'skip', name: 'เริ่มข้ามคิว (ใส่เหตุผล)', roles: { owner: true, production: true, supervisor: true, qc: true, staff: 'สถานีที่จับคู่' } },
  { key: 'sew', name: 'เริ่มเย็บ · จัดการจักร · แจ้งจักรเสีย', roles: { owner: true, production: true, supervisor: 'เฟส 2' } },
  { key: 'outsource', name: 'ส่งออกบริษัทภายนอก · รับกลับ · แบ่งงาน', roles: { owner: true, admin: true } },
  { key: 'admin', name: 'ฟิล์ม · ผลตัวอย่าง · แนบ PDF · รูปม็อคอัพ', roles: { owner: true, admin: true } },
  { key: 'overview', name: 'ดูภาพรวมทั้งโรงงาน', roles: { owner: true, manager: true, admin: true } },
  { key: 'reports', name: 'ดูรายงาน', roles: { owner: true, manager: true, admin: true, production: true, supervisor: true } },
  { key: 'review', name: 'รับทราบรายการรอผู้บริหาร', roles: { owner: true, manager: true } },
  { key: 'settings', name: 'ตั้งค่าระบบ · ผู้ใช้ · จับคู่สถานี · Audit Log', roles: { owner: true } },
]

export function cell(p: Permission, role: EmployeeRole): Cell {
  return p.roles[role] ?? false
}
