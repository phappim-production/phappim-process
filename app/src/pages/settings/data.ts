import { rpc } from '../../data/useFactoryData'
import { thaiError } from '../../data/live'
import { supabase } from '../../lib/supabase'
import type {
  InboxSetting, Machine, MachineType, Material, NamedCode, Need, Reason, RouteStation, Segment, Sla, Station, UserRow,
} from './model'

export const tabOptions = [
  ['users', 'ผู้ใช้และบทบาท'],
  ['stations', 'สถานีและขั้นย่อย'],
  ['segments', 'เวลามาตรฐานของช่วง'],
  ['materials', 'แม่แบบวัตถุดิบ'],
  ['reasons', 'รหัสสาเหตุ'],
  ['machines', 'จักรเย็บ'],
  ['inbox', 'การแจ้งเตือน'],
] as const

export type Tab = typeof tabOptions[number][0]

function client() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  return supabase
}

type DbError = { message: string; code?: string }
type Query = PromiseLike<{ data: unknown; error: DbError | null }>

function errorText(error: DbError) {
  if (/[\u0e00-\u0e7f]/.test(error.message)) return error.message
  switch (error.code) {
    case '23505': return 'รหัสซ้ำกับรายการที่มีอยู่ กรุณาใช้รหัสอื่น'
    case '23503': return 'รายการนี้ถูกอ้างอิงอยู่หรือข้อมูลที่เลือกเปลี่ยนแล้ว กรุณาโหลดใหม่'
    case 'PGRST116': return 'ไม่พบรายการหรือไม่มีสิทธิ์แก้ไข กรุณาโหลดใหม่'
    default: return thaiError(error.message)
  }
}

async function rows<T>(query: Query): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(errorText(error))
  return (data ?? []) as T[]
}

async function write(query: Query) {
  const { error } = await query
  if (error) throw new Error(errorText(error))
}

export async function loadOwnUserId() {
  const { data, error } = await client().auth.getSession()
  if (error || !data.session) throw new Error('ตรวจบัญชีปัจจุบันไม่ได้ กรุณาเข้าสู่ระบบอีกครั้ง')
  return data.session.user.id
}

const slaColumns = 'sla_days,warn_pct,big_qty,big_sla_days'

async function loadUsers() {
  const db = client()
  const result = await rpc<Omit<UserRow, 'section'>[]>('owner_list_users', {})
  if (!result.ok) throw new Error(result.reason)
  const users = result.data ?? []
  // ดึงเฟสเฉพาะบัญชี supervisor เดิม โดยไม่อ่านโปรไฟล์ของบัญชีปัจจุบันซ้ำ
  const old = users.some(user => user.role === 'supervisor')
    ? await rows<Pick<UserRow, 'user_id' | 'section'>>(db.from('profiles').select('user_id,section').eq('role', 'supervisor'))
    : []
  const sections = new Map(old.map(user => [user.user_id, user.section]))
  return { users: users.map(user => ({ ...user, section: sections.get(user.user_id) ?? null })) }
}

function named(table: 'routes' | 'product_types') {
  return rows<NamedCode>(client().from(table).select('code,name').order('name'))
}

async function loadStations() {
  const db = client()
  const [stations, routes, routeStations] = await Promise.all([
    rows<Station>(db.from('stations').select(`code,name,section,substeps,${slaColumns}`).order('sort').order('code')),
    named('routes'),
    rows<RouteStation>(db.from('route_stations').select('route_code,station_code,seq').order('seq')),
  ])
  return { stations, routes, routeStations }
}

async function loadSegments() {
  const [segments, routes, stations] = await Promise.all([
    rows<Segment>(client().from('sla_segments').select(`code,name,route_code,from_station,to_station,${slaColumns}`).order('name').order('code')),
    named('routes'),
    rows<NamedCode>(client().from('stations').select('code,name')),
  ])
  return { segments, routes, stations }
}

async function loadMaterials() {
  const [materials, products, routes] = await Promise.all([
    rows<Material>(client().from('material_templates').select('id,key,name,dept,product_type_code,route_code,sort').order('sort').order('id')),
    named('product_types'),
    named('routes'),
  ])
  return { materials, products, routes }
}

async function loadReasons() {
  return { reasons: await rows<Reason>(client().from('reason_codes').select('code,grp,name,sort,active').order('sort').order('code')) }
}

async function loadMachines() {
  const db = client()
  type HistoryRefs = { machine_assignments: { id: number }[]; machine_bookings: { id: number }[]; machine_status_log: { id: number }[] }
  type MachineRow = Omit<Machine, 'hasHistory'> & HistoryRefs
  const [machines, types, products, needs] = await Promise.all([
    rows<MachineRow>(db.from('sewing_machines').select('id,code,type_code,status,machine_assignments(id),machine_bookings(id),machine_status_log(id)')
      .order('sort').order('code')
      .limit(1, { referencedTable: 'machine_assignments' })
      .limit(1, { referencedTable: 'machine_bookings' })
      .limit(1, { referencedTable: 'machine_status_log' })),
    rows<MachineType>(db.from('machine_types').select('code,name,prefix').order('sort')),
    named('product_types'),
    rows<Need>(db.from('product_machine_needs').select('product_type_code,type_code,qty')),
  ])
  return {
    machines: machines.map(({ machine_assignments, machine_bookings, machine_status_log, ...row }) => ({
      ...row, hasHistory: Boolean(machine_assignments.length || machine_bookings.length || machine_status_log.length),
    })),
    types, products, needs,
  }
}

async function loadInbox() {
  return { settings: await rows<InboxSetting>(client().from('inbox_settings').select('kind,enabled').order('kind')) }
}

export const loaders = {
  users: loadUsers, stations: loadStations, segments: loadSegments, materials: loadMaterials,
  reasons: loadReasons, machines: loadMachines, inbox: loadInbox,
}

export type Loaded<T extends Tab> = Awaited<ReturnType<(typeof loaders)[T]>>

export const saveProfile = (id: string, values: Omit<UserRow, 'user_id' | 'email' | 'created_at'>) =>
  write(client().from('profiles').upsert({ user_id: id, ...values }, { onConflict: 'user_id' }).select('user_id').single())

export const saveStation = (station: Station, values: Omit<Station, 'code'>) =>
  write(client().from('stations').update(values).eq('code', station.code)
    .eq('substeps', JSON.stringify(station.substeps)).select('code').single())

export const saveSegment = (code: string, values: Pick<Segment, 'name' | keyof Sla>) =>
  write(client().from('sla_segments').update(values).eq('code', code).select('code').single())

export function saveMaterial(material: Material | null, values: Omit<Material, 'id' | 'key'>) {
  const table = client().from('material_templates')
  if (!material) return write(table.insert({ ...values, is_draft: false }).select('id').single())
  return write(table.update(material.key !== null ? { name: values.name } : values).eq('id', material.id).select('id').single())
}

export function removeMaterial(material: Material) {
  return write(client().from('material_templates').delete().eq('id', material.id).is('key', null).select('id').single())
}

export function saveReason(code: string | null, values: Reason) {
  const table = client().from('reason_codes')
  if (code === null) return write(table.insert(values).select('code').single())
  const { grp, name, active, sort } = values
  return write(table.update({ grp, name, active, sort }).eq('code', code).select('code').single())
}

export function saveMachine(id: number | null, values: Pick<Machine, 'code' | 'type_code'>) {
  const table = client().from('sewing_machines')
  return write((id === null ? table.insert(values) : table.update(values).eq('id', id)).select('id').single())
}

export const removeMachine = (machine: Machine) =>
  write(client().from('sewing_machines').delete().eq('id', machine.id).select('id').single())

export async function retireMachine(machine: Machine) {
  const result = await rpc('set_machine_status', { p_machine_code: machine.code, p_status: 'off' })
  if (!result.ok) throw new Error(result.reason)
}

export function saveNeed(need: Need) {
  const table = client().from('product_machine_needs')
  if (need.qty === 0) {
    return write(table.delete().eq('product_type_code', need.product_type_code).eq('type_code', need.type_code))
  }
  return write(table.upsert(need, { onConflict: 'product_type_code,type_code' }).select('qty').single())
}

export const saveInbox = (setting: InboxSetting) =>
  write(client().from('inbox_settings').update({ enabled: setting.enabled }).eq('kind', setting.kind).select('kind').single())
