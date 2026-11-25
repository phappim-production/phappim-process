import { thaiError } from '../../data/live'
import { supabase } from '../../lib/supabase'
import type {
  ReportDelay, ReportFirstPiece, ReportIssue, ReportJob, ReportQc, ReportReason, ReportRouteStep,
  ReportRows, ReportSample, ReportStation, ReportVisit, ReportWindow,
} from './metrics'

const PAGE_SIZE = 500
const JOB_BATCH = 100

type ReadPage = (first: number, last: number) => PromiseLike<{
  data: unknown
  error: { message: string } | null
}>

async function readAll<T>(read: ReadPage, signal: AbortSignal): Promise<T[]> {
  const result: T[] = []
  for (let start = 0; ; start += PAGE_SIZE) {
    signal.throwIfAborted()
    const { data, error } = await read(start, start + PAGE_SIZE - 1)
    if (error) throw new Error(thaiError(error.message))
    const page = (data ?? []) as T[]
    result.push(...page)
    if (page.length < PAGE_SIZE) return result
  }
}

export async function loadReport(window: ReportWindow, signal: AbortSignal): Promise<ReportRows> {
  const db = supabase
  if (!db) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const start = new Date(window.start).toISOString()
  const end = new Date(window.end).toISOString()

  const [jobs, stations, routes, reasonCodes, delays, periodIssues] = await Promise.all([
    readAll<ReportJob>((from, to) => db.from('job_live')
      .select('id,confirmation_no,customer_name,route_code,due_date,created_at,finished_at,needs_sample,develop,sla')
      .eq('phase', 'done').gte('finished_at', start).lt('finished_at', end).order('id').range(from, to).abortSignal(signal), signal),
    readAll<ReportStation>((from, to) => db.from('stations').select('code,name')
      .order('sort').order('code').range(from, to).abortSignal(signal), signal),
    readAll<ReportRouteStep>((from, to) => db.from('route_stations').select('route_code,station_code,seq')
      .order('route_code').order('seq').range(from, to).abortSignal(signal), signal),
    readAll<ReportReason>((from, to) => db.from('reason_codes').select('code,name')
      .order('code').range(from, to).abortSignal(signal), signal),
    readAll<ReportDelay>((from, to) => db.from('delay_reports').select('at,reasons')
      .gte('at', start).lt('at', end).order('id').range(from, to).abortSignal(signal), signal),
    readAll<ReportIssue>((from, to) => db.from('issues').select('id,job_id,opened_at,closed_at,reason')
      .gte('opened_at', start).lt('opened_at', end).order('id').range(from, to).abortSignal(signal), signal),
  ])

  const issues = new Map(periodIssues.map(issue => [issue.id, issue]))
  const visits: ReportVisit[] = []
  const qc: ReportQc[] = []
  const samples: ReportSample[] = []
  const firstPieces: ReportFirstPiece[] = []

  // งานที่เสร็จในช่วงนี้อาจมีประวัติตั้งแต่ก่อนเริ่มช่วงรายงาน
  for (let offset = 0; offset < jobs.length; offset += JOB_BATCH) {
    const ids = jobs.slice(offset, offset + JOB_BATCH).map(job => job.id)
    const [jobVisits, jobIssues, jobQc, jobSamples, jobFirstPieces] = await Promise.all([
      readAll<ReportVisit>((from, to) => db.from('station_visits')
        .select('job_id,station_code,phase,visit,started_at,done_at,rework').in('job_id', ids)
        .eq('phase', 'production').order('job_id').order('visit').order('station_code').range(from, to).abortSignal(signal), signal),
      readAll<ReportIssue>((from, to) => db.from('issues').select('id,job_id,opened_at,closed_at,reason')
        .in('job_id', ids).lt('opened_at', start).order('id').range(from, to).abortSignal(signal), signal),
      readAll<ReportQc>((from, to) => db.from('qc_results').select('job_id,failed,source_station,reasons')
        .in('job_id', ids).gt('failed', 0).order('id').range(from, to).abortSignal(signal), signal),
      readAll<ReportSample>((from, to) => db.from('sample_results').select('job_id,round,result')
        .in('job_id', ids).order('id').range(from, to).abortSignal(signal), signal),
      readAll<ReportFirstPiece>((from, to) => db.from('station_checks').select('job_id,sent_at,decided_at')
        .in('job_id', ids).eq('kind', 'first_piece').order('id').range(from, to).abortSignal(signal), signal),
    ])
    visits.push(...jobVisits)
    qc.push(...jobQc)
    samples.push(...jobSamples)
    firstPieces.push(...jobFirstPieces)
    for (const issue of jobIssues) issues.set(issue.id, issue)
  }

  return { jobs, visits, issues: [...issues.values()], firstPieces, qc, samples, delays, stations, routes, reasonCodes }
}
