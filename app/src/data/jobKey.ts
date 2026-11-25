import type { Job } from '../proto/model.ts'

// รายละเอียดงานโหลดใหม่เมื่อค่านี้เปลี่ยน ไม่ใช่ทุกครั้งที่บอร์ดโหลด
export function jobKey(j: Job): string {
  const at = (d?: Date) => d?.getTime() ?? ''
  return [
    j.id, j.phase, j.station ?? '', j.status ?? '', at(j.since), j.sampleRound, j.qty, at(j.due), j.queue ?? '',
    j.film ? `${at(j.film.eta)}${j.film.received ? 'r' : ''}` : '', j.sewCount ?? '', j.sewingReports?.length ?? '',
    j.rework ? `${j.rework.qty}:${j.rework.reason}` : '', j.holdReason ?? '', at(j.heldSince), at(j.doneAt),
    j.delivered ? `${at(j.delivered.at)}:${j.delivered.note}` : '', j.mockup ?? '', j.sla ?? '', j.lead?.due ?? '',
    j.out ? `${j.out.id}:${at(j.out.backAt)}` : '', j.specSheet ? `${j.specSheet.id}:${j.specSheet.rev}:${j.specSheet.acked.join(',')}` : '',
    j.revision ? `${j.revision.eventId}:${j.revision.acked.join(',')}` : '',
  ].join('|')
}

type Change = { new?: unknown; old?: unknown }
const text = (row: unknown, key: string) => {
  const v = typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' && v ? v : undefined
}

// งานที่การเปลี่ยนจาก Realtime กระทบ · 'all' = บอกไม่ได้ว่างานไหน (แถวที่ถูกลบส่งมาแค่ id ของแถว) · null = ไม่เกี่ยวกับงาน
export function changedJob(table: string, change: Change): string | null {
  if (table === 'sewing_machines') return null
  const key = table === 'jobs' ? 'id' : 'job_id'
  return text(change.new, key) ?? text(change.old, key) ?? 'all'
}

let epoch = 0
const touched = new Map<string, number>()

export function touchJob(id: string | null) {
  if (id === null) return
  if (id === 'all') { epoch++; touched.clear(); return }
  touched.set(id, (touched.get(id) ?? 0) + 1)
}

export function jobVersion(id: string): string {
  return `${epoch}.${touched.get(id) ?? 0}`
}
