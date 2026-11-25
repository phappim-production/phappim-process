import { isStationCode, type Job, type JobRevision } from '../proto/model'

export type RevisionFlagRow = {
  job_id: string; rev: number; revised_at: string; revised_by: string | null
  fields: string[] | null; summary: string[] | null; event_id: number | string; acked_stations: string[] | null
}

export function toRevision(r: RevisionFlagRow): JobRevision {
  return {
    rev: Number(r.rev) || 0, at: new Date(r.revised_at), by: r.revised_by ?? null,
    fields: r.fields ?? [], summary: r.summary ?? [], eventId: Number(r.event_id),
    acked: (r.acked_stations ?? []).filter(isStationCode),
  }
}

export function attachRevisions(jobs: Job[], rows: RevisionFlagRow[]): Job[] {
  const byJob = new Map(rows.map(r => [r.job_id, toRevision(r)]))
  return jobs.map(j => {
    const revision = byJob.get(j.id)
    if (revision) return { ...j, revision }
    if (!j.revision) return j
    const { revision: _gone, ...rest } = j
    return rest
  })
}

// ตรงกับ private.revision_ack_missing · ฐานข้อมูลตรวจซ้ำตอนกดเสร็จ
export function needsRevisionAck(j: Pick<Job, 'revision' | 'phase' | 'station'>): boolean {
  return !!j.revision && (j.phase === 'sample' || j.phase === 'production') && !!j.station && j.station !== 'outside'
    && !j.revision.acked.includes(j.station)
}

const bangkok = (at: Date) => new Date(at.getTime() + 7 * 3600_000)

export function revisionWhen(at: Date): string {
  const d = bangkok(at)
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear() + 543} ${hm}`
}

export function revisionShort(at: Date): string {
  const d = bangkok(at)
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
