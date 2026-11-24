import { supabase } from '../lib/supabase'
import type { StationMachineRow } from '../proto/machines'
import type { MachineTypeRow, NeedRow, ProductRow, VendorRow } from './live'
import type { Substep } from './stationSteps'
import { createStaticCache } from './staticCache'
import { onUserChange } from './userScope'

type Reply = { data: unknown; error: { message: string } | null }

async function rows<T>(query: PromiseLike<Reply>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

function db() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  return supabase
}

export type BoardStatics = { products: ProductRow[]; needs: NeedRow[]; types: MachineTypeRow[]; vendors: VendorRow[] }
export type ReasonCode = { code: string; grp: string; name: string; active: boolean }
export type StationInfo = { code: string; name: string; substeps: Substep[] | null }

export const boardStatics = createStaticCache<BoardStatics>(async () => {
  const [products, needs, types, vendors] = await Promise.all([
    rows<ProductRow>(db().from('product_types').select('code, name')),
    rows<NeedRow>(db().from('product_machine_needs').select('product_type_code, type_code, qty')),
    rows<MachineTypeRow>(db().from('machine_types').select('code, shared')),
    rows<VendorRow>(db().from('vendors').select('id, name, stations, kind, phone, address, map_url, specialty, contact').eq('active', true)),
  ])
  return { products, needs, types, vendors }
})

export const stationMachineRows = createStaticCache(() => rows<StationMachineRow>(db().from('stations').select('code, machines, machine_pool')))
export const stationInfo = createStaticCache(() => rows<StationInfo>(db().from('stations').select('code, name, substeps')))
export const reasonCodes = createStaticCache(() => rows<ReasonCode>(db().from('reason_codes').select('code, grp, name, active').order('sort')))

export const staffNames = createStaticCache(async () => {
  const { data, error } = await db().rpc('staff_names')
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as { user_id: string; name: string }[]).map(r => [r.user_id, r.name]))
})

onUserChange(() => { for (const c of [boardStatics, stationMachineRows, stationInfo, reasonCodes, staffNames]) c.invalidate() })
