import type { EmployeeRole, Section } from '../../auth/access'
import type { Substep } from '../../data/stationSteps'
import type { Dept } from '../../proto/model'
import type { MachineStatus } from '../../proto/sewing'
import type { InboxKind } from '../inbox/format'

export const ROLE_OPTIONS = ['owner', 'admin', 'qc', 'production', 'manager', 'staff'] as const
export const EDITABLE_KINDS = ['req', 'num', 'appr', 'opt'] as const

export type NamedCode = { code: string; name: string }
export type UserRow = {
  user_id: string; email: string | null; created_at: string | null
  name: string | null; role: EmployeeRole | null; active: boolean | null; section: Section | null
}
export type ProfileDraft = { name: string; role: EmployeeRole | ''; active: boolean; section: Section | null }
export type Station = NamedCode & { section: Section; substeps: Substep[]; machines: number | null; machine_pool: string | null }
export type StationDraft = { name: string; section: Section; substeps: Substep[]; machines: string; machine_pool: string }
export type RouteStation = { route_code: string; station_code: string; seq: number }
export type Material = {
  id: number; key: string | null; name: string; dept: Dept
  product_type_code: string | null; route_code: string | null; sort: number
}
export type MaterialDraft = { name: string; dept: Dept; product: string; route: string; sort: string }
export type Reason = NamedCode & { grp: string; active: boolean; sort: number }
export type ReasonDraft = { code: string; grp: string; name: string; active: boolean; sort: string }
// shared = จักรใช้ร่วมหลายไลน์ (ไม่จ่าย/ไม่จองให้งาน) · false = ประจำไลน์
export type MachineType = NamedCode & { prefix: string; shared: boolean }
export type Machine = { id: number; code: string; type_code: string; status: MachineStatus; hasHistory: boolean }
export type MachineDraft = { code: string; type: string }
export type Need = { product_type_code: string; type_code: string; qty: number }
export type InboxSetting = { kind: InboxKind; enabled: boolean }

const PROTECTED_STEP_KEYS = new Set(['sew_count', 'first_piece', 'inspect', 'sort_count'])
const MAX_INT = 2_147_483_647

export function requireText(value: string, label: string): string {
  const text = value.trim()
  if (!text) throw new Error(`กรุณากรอก${label}`)
  return text
}

export function integer(value: string, label: string, min: number, max = MAX_INT): number {
  const text = value.trim()
  const n = Number(text)
  if (!/^\d+$/.test(text) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`กรุณากรอก${label}เป็นจำนวนเต็ม${max === MAX_INT ? `ตั้งแต่ ${min} ขึ้นไป` : ` ${min}–${max}`}`)
  }
  return n
}

export function isProtectedStep(step: Substep): boolean {
  return step.kind === 'lock' || PROTECTED_STEP_KEYS.has(step.key)
}

export function nextStepKey(steps: Substep[], seed: string): string {
  const used = new Set(steps.map(step => step.key))
  const base = `step_${seed.toLowerCase().replace(/[^a-z0-9_]/g, '')}`
  let key = base
  for (let suffix = 2; used.has(key); suffix++) key = `${base}_${suffix}`
  return key
}

export function moveStep(steps: Substep[], index: number, offset: -1 | 1): Substep[] {
  const to = index + offset
  if (!steps[index] || !steps[to] || isProtectedStep(steps[index]) || isProtectedStep(steps[to])) return steps
  const next = [...steps]
  next[index] = steps[to]
  next[to] = steps[index]
  return next
}

export function readStation(draft: StationDraft) {
  return {
    name: requireText(draft.name, 'ชื่อสถานี'), section: draft.section,
    machines: draft.machines.trim() ? integer(draft.machines, 'จำนวนเครื่อง', 1, 50) : null,
    machine_pool: draft.machine_pool.trim() || null,
    substeps: draft.substeps.map(step => ({ ...step, name: requireText(step.name, 'ชื่อขั้นย่อยทุกขั้น') })),
  }
}

export function readProfile(draft: ProfileDraft, ownProfile: boolean, originalRole: EmployeeRole | null) {
  const role = draft.role
  if (!role) throw new Error('กรุณาเลือกบทบาท')
  if (ownProfile && (role !== 'owner' || !draft.active)) {
    throw new Error('ปิดบัญชีหรือลดบทบาทเจ้าของระบบของตัวเองไม่ได้')
  }
  if (role === 'supervisor' && originalRole !== 'supervisor') {
    throw new Error('กำหนดบทบาทผู้ควบคุมงานให้บัญชีใหม่ไม่ได้')
  }
  return { name: requireText(draft.name, 'ชื่อผู้ใช้'), role, active: draft.active, section: role === 'supervisor' ? draft.section : null }
}

export function readMachineCode(value: string, prefix: string, usedCodes: ReadonlySet<string>): string {
  const raw = value.trim().toUpperCase()
  const no = raw.slice(prefix.length + 1)
  if (!raw.startsWith(`${prefix}-`) || !/^\d{1,3}$/.test(no)) {
    throw new Error(`กรุณาใช้รหัสจักรตามชนิด เช่น ${prefix}-001 (เลขท้าย 3 หลัก)`)
  }
  // ฐานข้อมูลบังคับเลข 3 หลัก · เติม 0 ให้ เพราะหน้างานมักพิมพ์ SN-12 หรือ SN-5
  const code = `${prefix}-${no.padStart(3, '0')}`
  if (usedCodes.has(code)) throw new Error('รหัสจักรนี้ถูกใช้แล้ว')
  return code
}
