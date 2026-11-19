import { rpc } from '../../data/useFactoryData'
import { thaiError } from '../../data/live'
import { supabase } from '../../lib/supabase'
import type { EventRow } from '../../data/history'
import type { EmployeeRole } from '../../auth/access'
import type { AuditRow, ReviewItem } from '../../proto/admin'

const DAY = 86_400_000

function client() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  return supabase
}

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(thaiError(error.message))
  return (data ?? []) as T[]
}

export async function loadNames(): Promise<Map<string, string>> {
  const r = await rpc<{ user_id: string; name: string }[]>('staff_names', {})
  if (!r.ok) throw new Error(r.reason)
  return new Map((r.data ?? []).map(n => [n.user_id, n.name]))
}

export type JobEvent = EventRow & { job_id: string; jobs: { confirmation_no: string; unit: string } | null }

export async function loadAudit(days: number) {
  const since = new Date(Date.now() - days * DAY).toISOString()
  const db = client()
  const [settings, events, names] = await Promise.all([
    rows<AuditRow>(db.from('audit_log').select('*').gte('at', since).order('at', { ascending: false }).limit(500)),
    rows<JobEvent>(db.from('events').select('id, job_id, type, phase, station_code, payload, by, at, jobs(confirmation_no, unit)')
      .gte('at', since).order('at', { ascending: false }).limit(500)),
    loadNames(),
  ])
  return { settings, events, names }
}

export type UserLite = { user_id: string; name: string | null; email: string | null; role: EmployeeRole | null; active: boolean | null }

export async function loadSystemOverview() {
  const db = client()
  const users = await rpc<UserLite[]>('owner_list_users', {})
  if (!users.ok) throw new Error(users.reason)
  const [links, products, needs, broken, audit] = await Promise.all([
    rows<{ user_id: string }>(db.from('staff_stations').select('user_id')),
    rows<{ code: string; name: string }>(db.from('product_types').select('code,name').order('name')),
    rows<{ product_type_code: string }>(db.from('product_machine_needs').select('product_type_code')),
    rows<{ code: string; note: string | null }>(db.from('sewing_machines').select('code,note').eq('status', 'broken').order('code')),
    rows<AuditRow>(db.from('audit_log').select('*').order('at', { ascending: false }).limit(5)),
  ])
  const withRecipe = new Set(needs.map(n => n.product_type_code))
  const linked = new Set(links.map(l => l.user_id))
  const all = users.data ?? []
  return {
    users: all,
    unassigned: all.filter(u => u.role === 'staff' && u.active && !linked.has(u.user_id)),
    noRole: all.filter(u => !u.role),
    noRecipe: products.filter(p => !withRecipe.has(p.code)),
    broken,
    audit,
    names: new Map(all.map(u => [u.user_id, u.name || u.email || 'ไม่มีชื่อ'])),
  }
}

export type DelayReview = ReviewItem & {
  kind: 'delay_report'; station: string | null; reasons: string[]; detail: string; newEta: string; needHelp: string | null; by: string | null
}
export type QueueReview = ReviewItem & { kind: 'queue_event'; type: string; station: string | null; reason: string; by: string | null }

export async function loadReviews(days = 14) {
  const since = new Date(Date.now() - days * DAY).toISOString()
  const db = client()
  const [delays, queue, acks, reasons, names] = await Promise.all([
    rows<{ id: number; job_id: string; station_code: string | null; reasons: string[]; detail: string; new_eta: string; need_help: string | null; by: string | null; at: string }>(
      db.from('delay_reports').select('id, job_id, station_code, reasons, detail, new_eta, need_help, by, at').gte('at', since)),
    rows<{ id: number; job_id: string; type: string; station_code: string | null; payload: Record<string, unknown> | null; by: string | null; at: string }>(
      db.from('events').select('id, job_id, type, station_code, payload, by, at').in('type', ['queue_insert', 'queue_skip']).gte('at', since)),
    rows<{ kind: string; ref_id: number }>(db.from('manager_acks').select('kind, ref_id')),
    rows<{ code: string; name: string }>(db.from('reason_codes').select('code, name')),
    loadNames(),
  ])
  const reasonName = new Map(reasons.map(r => [r.code, r.name]))
  const delayItems: DelayReview[] = delays.map(d => ({
    kind: 'delay_report', ref: d.id, jobId: d.job_id, at: d.at, station: d.station_code,
    reasons: d.reasons.map(c => reasonName.get(c) ?? c), detail: d.detail, newEta: d.new_eta, needHelp: d.need_help, by: d.by,
  }))
  const queueItems: QueueReview[] = queue.map(e => ({
    kind: 'queue_event', ref: e.id, jobId: e.job_id, at: e.at, type: e.type, station: e.station_code,
    reason: typeof e.payload?.reason === 'string' ? e.payload.reason : '', by: e.by,
  }))
  return { delayItems, queueItems, acks, names }
}
