import { supabase } from '../lib/supabase'
import { isStationCode, type StationCode } from '../proto/model'
import type { Callout, Draft, MockView, SheetStatus, SpecKind, Unit, ViewKey } from '../proto/annotation'
import { VIEW_ORDER } from '../proto/annotation'
import { MOCKUP_BUCKET, contentKey, mockupExt, mockupFolder, mockupProblem, signMockups } from './mockups'
import { rpc, type RpcResult } from './useFactoryData'
import { thaiError } from './live'

export type SheetRow = {
  id: string; job_id: string; rev: number; status: SheetStatus; version: number; based_on: string | null
  confirmation_rev: number | null; change_reason: string | null; return_reason: string | null; approve_note: string | null
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string
  submitted_by: string | null; submitted_at: string | null; approved_by: string | null; approved_at: string | null
}
type ViewRow = { id: string; view: ViewKey; image_path: string; width: number; height: number }
type SpecRow = {
  id: string; code: string; name: string; kind: SpecKind; position: string | null; detail: string | null
  width: number | string | null; height: number | string | null; unit: Unit; color: string | null; color_code: string | null
  material: string | null; method: string | null; artwork_ref: string | null; note: string | null; stations: string[]
}
type CalloutRow = {
  id: string; view_id: string; no: number; x: number | string; y: number | string; box_x: number | string; box_y: number | string
  title: string; body: string | null; spec_ref: string | null; ref_value: string | null; spec_id: string | null; stations: string[]
}
export type AckRow = { sheet_id: string; rev: number; user_id: string | null; station_code: StationCode; at: string }
export type MockupJob = {
  id: string; no: string; customer: string; jobName: string; qty: number; unit: string; due: string
  route: string; phase: string; started: boolean; spec: unknown; confirmationRev: number; stations: StationCode[]
}
export type MockupData = { job: MockupJob; sheets: SheetRow[]; acks: AckRow[]; names: Map<string, string> }

const stations = (list: string[] | null | undefined): StationCode[] => (list ?? []).filter(isStationCode)
const num = (v: number | string | null) => (v === null || v === '' ? null : Number(v))

export async function loadMockupJob(jobId: string): Promise<MockupData | null> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const [job, sheets, acks, names] = await Promise.all([
    supabase.from('jobs').select('id, confirmation_no, customer_name, job_name, qty, unit, due_date, route_code, phase, spec, confirmation_rev').eq('id', jobId).maybeSingle(),
    supabase.from('mockup_sheets').select('*').eq('job_id', jobId).order('rev', { ascending: false }),
    supabase.from('mockup_acks').select('sheet_id, rev, user_id, station_code, at').eq('job_id', jobId).order('at'),
    rpc<{ user_id: string; name: string }[]>('staff_names', {}),
  ])
  const failed = [job, sheets, acks].find(r => r.error)
  if (failed?.error) throw new Error(thaiError(failed.error.message))
  if (!job.data) return null
  const j = job.data as { id: string; confirmation_no: string; customer_name: string; job_name: string; qty: number; unit: string; due_date: string; route_code: string; phase: string; spec: unknown; confirmation_rev: number }
  const [route, started] = await Promise.all([
    supabase.from('route_stations').select('station_code, seq').eq('route_code', j.route_code).order('seq'),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('type', 'station_start'),
  ])
  if (route.error) throw new Error(thaiError(route.error.message))
  return {
    job: {
      id: j.id, no: j.confirmation_no, customer: j.customer_name, jobName: j.job_name, qty: j.qty, unit: j.unit, due: j.due_date,
      route: j.route_code, phase: j.phase, spec: j.spec, confirmationRev: j.confirmation_rev,
      started: j.phase === 'production' || j.phase === 'done' || (started.count ?? 0) > 0,
      stations: stations((route.data as { station_code: string }[]).map(r => r.station_code)),
    },
    sheets: sheets.data as SheetRow[],
    acks: acks.data as AckRow[],
    names: new Map((names.ok ? names.data : []).map(n => [n.user_id, n.name])),
  }
}

export type LoadedSheet = { draft: Draft; urls: Map<string, string> }

export async function loadSheet(sheetId: string): Promise<LoadedSheet> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const [views, specs, callouts] = await Promise.all([
    supabase.from('mockup_views').select('id, view, image_path, width, height').eq('sheet_id', sheetId),
    supabase.from('mockup_specs').select('*').eq('sheet_id', sheetId).order('code'),
    supabase.from('mockup_callouts').select('*').eq('sheet_id', sheetId).order('no'),
  ])
  const failed = [views, specs, callouts].find(r => r.error)
  if (failed?.error) throw new Error(thaiError(failed.error.message))
  const viewRows = (views.data as ViewRow[]).sort((a, b) => VIEW_ORDER.indexOf(a.view) - VIEW_ORDER.indexOf(b.view))
  const viewOf = new Map(viewRows.map(v => [v.id, v.view]))
  const draft: Draft = {
    views: viewRows.map(v => ({ view: v.view, path: v.image_path, width: v.width, height: v.height })),
    specs: (specs.data as SpecRow[]).map(s => ({
      key: s.id, code: s.code, name: s.name, kind: s.kind, position: s.position ?? '', detail: s.detail ?? '',
      width: num(s.width), height: num(s.height), unit: s.unit, color: s.color ?? '', colorCode: s.color_code ?? '',
      material: s.material ?? '', method: s.method ?? '', artworkRef: s.artwork_ref ?? '', note: s.note ?? '', stations: stations(s.stations),
    })),
    callouts: (callouts.data as CalloutRow[]).flatMap(c => {
      const view = viewOf.get(c.view_id)
      return view ? [{
        key: c.id, view, no: c.no, x: Number(c.x), y: Number(c.y), boxX: Number(c.box_x), boxY: Number(c.box_y),
        title: c.title, body: c.body ?? '', specRef: c.spec_ref, specKey: c.spec_id, stations: stations(c.stations), refValue: c.ref_value,
      } satisfies Callout] : []
    }),
  }
  return { draft, urls: await signMockups(draft.views.map(v => v.path)) }
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    return size.width > 0 && size.height > 0 ? size : null
  } catch {
    return null
  }
}

// เก็บไฟล์ต้นฉบับตามที่อัปโหลด ไม่ย่อ ไม่แปลง (ต่างจากรูปการ์ดงานที่ย่อเป็น JPEG)
export async function uploadOriginal(no: string, file: File, view: ViewKey): Promise<RpcResult<MockView & { url: string }>> {
  if (!supabase) return { ok: false, reason: 'ยังไม่ได้ตั้งค่า Supabase' }
  const problem = mockupProblem(file)
  if (problem) return { ok: false, reason: problem }
  const size = await imageSize(file)
  if (!size) return { ok: false, reason: 'เปิดไฟล์รูปนี้ไม่ได้ ไฟล์อาจเสีย ลองบันทึกรูปใหม่แล้วเลือกอีกครั้ง' }
  const path = `${mockupFolder(no)}/sheet/${await contentKey(file)}.${mockupExt(file.type) ?? 'jpg'}`
  try {
    const up = await supabase.storage.from(MOCKUP_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (up.error && !/exists|duplicate/i.test(up.error.message)) {
      return { ok: false, reason: /bucket not found/i.test(up.error.message) ? 'ระบบยังไม่พร้อมรับรูป แจ้งเจ้าของระบบ' : 'อัปโหลดรูปไม่สำเร็จ ลองอีกครั้ง' }
    }
  } catch {
    return { ok: false, reason: 'เชื่อมต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง' }
  }
  const url = (await signMockups([path])).get(path)
  return { ok: true, data: { view, path, ...size, url: url ?? URL.createObjectURL(file) } }
}

export const startSheet = (job: string, reason?: string) => rpc<string>('start_mockup_sheet', { p_job: job, p_reason: reason ?? null })
export const saveDraft = (sheet: string, version: number, payload: unknown) => rpc<number>('save_mockup_draft', { p_sheet: sheet, p_version: version, p_data: payload })
export const discardDraft = (sheet: string) => rpc('discard_mockup_draft', { p_sheet: sheet })
export const submitSheet = (sheet: string, version: number) => rpc<number>('submit_mockup_sheet', { p_sheet: sheet, p_version: version })
export const returnSheet = (sheet: string, reason: string) => rpc('return_mockup_sheet', { p_sheet: sheet, p_reason: reason })
export const approveSheet = (sheet: string, note: string) => rpc('approve_mockup_sheet', { p_sheet: sheet, p_note: note || null })
export const ackSheet = (sheet: string, station: StationCode) => rpc('ack_mockup_sheet', { p_sheet: sheet, p_station: station })

export function pickSheets(sheets: SheetRow[]) {
  return {
    approved: sheets.find(s => s.status === 'approved') ?? null,
    open: sheets.find(s => s.status === 'draft' || s.status === 'pending') ?? null,
  }
}

export function newKey(): string {
  try { return crypto.randomUUID() } catch { return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}` }
}

