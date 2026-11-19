import type { Job } from './model.ts'
import { MACHINE_TYPES, bookedByOther, type Booking, type Machine, type MachineType, type Need } from './sewing.ts'

export type TileState = 'mine' | 'free' | 'busy' | 'broken' | 'booked'
export type PickTile = { code: string; state: TileState; jobId?: string }
export type PickGroup = { type: MachineType; need: number; tiles: PickTile[] }

// ชนิดที่ต้องเลือก = ที่สินค้าต้องใช้ + ที่งานถืออยู่ · จักรใช้ร่วมไม่ต้องเลือก
export function pickGroups(job: Job, machines: Machine[], needs: Need[], shared: readonly MachineType[], bookings: Booking[], now: Date): PickGroup[] {
  const soon = new Date(now.getTime() + 60_000)
  const types = MACHINE_TYPES.filter(t => !shared.includes(t)
    && (needs.some(n => n.type === t && n.qty > 0) || machines.some(m => m.type === t && m.jobId === job.id)))
  return types.map(type => ({
    type,
    need: needs.find(n => n.type === type)?.qty ?? 0,
    tiles: machines.filter(m => m.type === type).sort((a, b) => a.code.localeCompare(b.code)).map((m): PickTile => {
      if (m.jobId === job.id) return { code: m.code, state: 'mine' }
      if (m.status !== 'ready') return { code: m.code, state: 'broken' }
      if (m.jobId) return { code: m.code, state: 'busy', jobId: m.jobId }
      const booked = bookedByOther(m.id, now, soon, bookings, job.id)
      return booked ? { code: m.code, state: 'booked', jobId: booked.jobId } : { code: m.code, state: 'free' }
    }),
  }))
}

// ค่าเริ่มต้นตอนเริ่มเย็บ: ตัวว่างตัวแรกๆ ของแต่ละชนิดเท่าที่สินค้าต้องใช้
export function defaultPick(groups: PickGroup[]): string[] {
  return groups.flatMap(g => g.tiles.filter(t => t.state === 'free').slice(0, g.need).map(t => t.code))
}

export function pickProblems(groups: PickGroup[], picked: readonly string[], names: Record<MachineType, string>): string[] {
  return groups.filter(g => g.need > 0)
    .map(g => ({ g, n: g.tiles.filter(t => picked.includes(t.code)).length }))
    .filter(({ g, n }) => n < g.need)
    .map(({ g, n }) => `เลือก${names[g.type]} ${n}/${g.need} ตัว`)
}
