import { isStationCode, type Job, type StationCode } from './model.ts'

export type StationMachine = { code: StationCode; machines: number | null; pool: string }
export type StationMachineRow = { code: string; machines: number | null; machine_pool: string | null }

export function toStationMachines(rows: StationMachineRow[]): StationMachine[] {
  return rows.filter(r => isStationCode(r.code)).map(r => ({ code: r.code as StationCode, machines: r.machines, pool: r.machine_pool ?? r.code }))
}

// ตรงกับ private.station_full: นับเฉพาะงานกำลังทำ (งานพัก/ข้างนอกไม่ใช้เครื่อง) ของทุกสถานีในกลุ่มเครื่องเดียวกัน
export function machineUse(jobs: Job[], cfg: StationMachine[], station: StationCode): { used: Job[]; total: number; full: boolean } | null {
  const me = cfg.find(c => c.code === station)
  if (!me?.machines) return null
  const pool = new Set(cfg.filter(c => c.pool === me.pool).map(c => c.code))
  const used = jobs.filter(j => (j.phase === 'sample' || j.phase === 'production') && j.status === 'doing' && !!j.station && pool.has(j.station))
  return { used, total: me.machines, full: used.length >= me.machines }
}
