import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { withMockups } from './mockups'
import type { Job, Vendor } from '../proto/model'
import type { Booking, Machine, MachineType, Need } from '../proto/sewing'
import {
  RPC_TIMEOUT_MS, SLOW_REPLY, withTimeout,
  attachOutRuns, attachSla, sharedTypes, thaiError, toBookings, toJobs, toMachines, toNeeds, toVendors, type MachineTypeRow, type OutRunRow, type VendorRow,
  type AssignmentRow, type BookingRow, type JobRow, type MachineRow, type NeedRow, type ProductRow, type ReworkRow, type SewEventRow, type SlaFlagRow,
} from './live'

export type FactoryData = { vendors: Vendor[]; jobs: Job[]; machines: Machine[]; bookings: Booking[]; needs: Record<string, Need[]>; products: ProductRow[]; shared: MachineType[] }
export type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FactoryData; loadedAt: Date }

const DAY = 86_400_000
// ตารางที่เปลี่ยนแล้วต้องโหลดใหม่ · ทุกการกดงานบันทึก events จึงครอบทุกขั้นของงาน
const WATCH = ['jobs', 'outsource_runs', 'events', 'job_materials', 'issues', 'sewing_machines', 'machine_assignments', 'machine_bookings'] as const
// เฉพาะคอลัมน์ที่หน้าจอใช้ · ไม่ดึง spec (คำตอบทั้งใบยืนยัน) เพราะโหลดใหม่ทุกครั้งที่มีคนกด
const JOB_COLUMNS = 'id, confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, phase, current_station, station_status, stage_entered_at, sample_round, needs_sample, materials_waiting_depts, dtf_film_eta, dtf_film_received_at, sew_count, is_rework, rework_qty, hold_reason, finished_at, queue_seq, mockup_path'

export function isJobId(id: string) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
}

export function decideBoardJob(id: string, jobs: readonly Job[]):
  | { status: 'found'; job: Job }
  | { status: 'fetch'; id: string }
  | { status: 'missing' } {
  if (!isJobId(id)) return { status: 'missing' }
  const key = id.toLowerCase()
  const job = jobs.find(row => row.id === key)
  return job ? { status: 'found', job } : { status: 'fetch', id: key }
}

export async function fetchBoardJob(id: string, signal: AbortSignal): Promise<Job | null> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const result = await supabase.from('job_live').select(JOB_COLUMNS)
    .eq('id', id).neq('phase', 'cancelled').abortSignal(signal).maybeSingle()
  if (result.error) throw new Error(result.error.message)
  if (!result.data) return null
  const row = result.data as JobRow
  const [products, reworks, sewEvents] = await Promise.all([
    supabase.from('product_types').select('code, name').eq('code', row.product_type_code).abortSignal(signal),
    supabase.from('qc_results').select('job_id, failed, reasons, at').eq('job_id', id).gt('failed', 0).abortSignal(signal),
    supabase.from('events').select('job_id, type, payload, at').eq('job_id', id).eq('station_code', 'sew')
      .in('type', ['sewing_issue_reported', 'hold']).abortSignal(signal),
  ])
  const failed = [products, reworks, sewEvents].find(response => response.error)
  if (failed?.error) throw new Error(failed.error.message)
  const [job] = await withMockups(toJobs([row], products.data as ProductRow[], reworks.data as ReworkRow[], sewEvents.data as SewEventRow[]))
  return job ?? null
}

async function load(): Promise<FactoryData> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const recent = new Date(Date.now() - 14 * DAY).toISOString()
  const slaCall = supabase.rpc('job_sla_flags')
  const [jobs, products, reworks, sewEvents, machines, assignments, bookings, needs, types, vendorRows, outRuns] = await Promise.all([
    // งานเสร็จเก่ากว่า 14 วันไม่ต้องแสดงบนบอร์ด
    supabase.from('job_live').select(JOB_COLUMNS).neq('phase', 'cancelled').or(`phase.neq.done,finished_at.gte.${recent}`),
    supabase.from('product_types').select('code, name'),
    supabase.from('qc_results').select('job_id, failed, reasons, at').gt('failed', 0),
    supabase.from('events').select('job_id, type, payload, at').eq('station_code', 'sew').in('type', ['sewing_issue_reported', 'hold']),
    supabase.from('sewing_machines').select('id, code, type_code, status, note, repair_eta, sort'),
    supabase.from('machine_assignments').select('machine_id, job_id').is('released_at', null),
    supabase.from('machine_bookings').select('id, machine_id, job_id, starts_at, ends_at').is('cancelled_at', null).gte('ends_at', new Date(Date.now() - 7 * DAY).toISOString()),
    supabase.from('product_machine_needs').select('product_type_code, type_code, qty'),
    supabase.from('machine_types').select('code, shared'),
    supabase.from('vendors').select('id, name, stations, kind, phone, address, map_url, specialty, contact').eq('active', true),
    supabase.from('outsource_runs').select('id, job_id, vendor_id, stations, qty, is_rework, sent_at, arrive_at, lead_days, back_at, note').is('closed_at', null),
  ])
  // อ่านเวลามาตรฐานไม่ได้ (เน็ตสะดุด) ให้การ์ดสีปกติ ไม่ทำให้ทั้งหน้าโหลดไม่ขึ้น
  const sla = await slaCall
  const failed = [jobs, products, reworks, sewEvents, machines, assignments, bookings, needs, types, vendorRows, outRuns].find(r => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const vendors = toVendors(vendorRows.data as VendorRow[])
  return {
    vendors,
    jobs: await withMockups(attachSla(attachOutRuns(toJobs(jobs.data as JobRow[], products.data as ProductRow[], reworks.data as ReworkRow[], sewEvents.data as SewEventRow[]), outRuns.data as OutRunRow[], vendors),
      sla.error ? [] : (sla.data ?? []) as SlaFlagRow[])),
    machines: toMachines(machines.data as MachineRow[], assignments.data as AssignmentRow[]),
    bookings: toBookings(bookings.data as BookingRow[]),
    needs: toNeeds(needs.data as NeedRow[], new Set(sharedTypes(types.data as MachineTypeRow[]))),
    products: products.data as ProductRow[],
    shared: sharedTypes(types.data as MachineTypeRow[]),
  }
}

export function useFactoryData() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  // ขาดการเชื่อมต่อ = โหลดล่าสุดไม่สำเร็จ หรือ Realtime หลุด · แยกกันเพื่อให้แถบเตือนหายเองเมื่อกลับมาครบทั้งคู่
  const [fetchOk, setFetchOk] = useState(true)
  const [channelOk, setChannelOk] = useState(true)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      // ปุ่มรอโหลดใหม่หลังบันทึก → โหลดค้างต้องไม่ทำให้ปุ่มหมุนตลอดไป
      const reply = await withTimeout(() => load(), RPC_TIMEOUT_MS)
      if (reply.timedOut) throw new Error('timeout')
      const data = reply.value
      // คำขอที่ส่งทีหลังชนะเสมอ กันข้อมูลเก่ามาทับข้อมูลใหม่
      if (mine === seq.current) {
        setState({ status: 'ready', data, loadedAt: new Date() })
        setFetchOk(true)
      }
    } catch (e) {
      if (mine !== seq.current) return
      const message = thaiError(e instanceof Error ? e.message : undefined)
      // โหลดได้แล้วครั้งหนึ่ง = เก็บข้อมูลเดิมไว้ แล้วขึ้นแถบเตือนแทน ไม่ล้างจอ
      setState(s => (s.status === 'ready' ? s : { status: 'error', message }))
      setFetchOk(false)
    }
  }, [])

  useEffect(() => {
    // โหลดครั้งแรกนอกรอบ render (setState เกิดหลังได้ข้อมูลเท่านั้น)
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => void refresh(), 0)
    const client = supabase
    if (!client) return () => clearTimeout(timer)
    // หลายตารางเปลี่ยนพร้อมกันในการกดครั้งเดียว → รวมเป็นการโหลดครั้งเดียว
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 250) }
    let channel = client.channel('factory-live')
    for (const table of WATCH) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, soon)
    channel.subscribe(status => {
      setChannelOk(status === 'SUBSCRIBED')
      if (status === 'SUBSCRIBED') soon()   // ต่อกลับได้ = โหลดใหม่ เผื่อพลาดการเปลี่ยนระหว่างหลุด
    })
    const online = () => soon()
    const offline = () => setFetchOk(false)
    const visible = () => { if (document.visibilityState === 'visible') soon() }
    // เวลามาตรฐานเดินเองโดยไม่มีใครกด → โหลดเฉพาะสถานะเวลาทุก 5 นาที
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void client.rpc('job_sla_flags').then(({ data, error }) => {
        if (error) return
        setState(s => s.status === 'ready' ? { ...s, data: { ...s.data, jobs: attachSla(s.data.jobs, (data ?? []) as SlaFlagRow[]) } } : s)
      })
    }, 5 * 60 * 1000)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearTimeout(timer)
      clearInterval(tick)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', visible)
      void client.removeChannel(channel)
    }
  }, [refresh])

  return { state, live: fetchOk && channelOk, refresh }
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; reason: string }

export async function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  if (!supabase) return { ok: false, reason: 'ยังไม่ได้ตั้งค่า Supabase' }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: false, reason: 'ไม่มีอินเทอร์เน็ต ต่อเน็ตแล้วกดอีกครั้ง' }
  const client = supabase
  try {
    const reply = await withTimeout(signal => client.rpc(name, args).abortSignal(signal), RPC_TIMEOUT_MS)
    if (reply.timedOut) return { ok: false, reason: SLOW_REPLY }
    const { data, error } = reply.value
    if (error) return { ok: false, reason: thaiError(error.message) }
    return { ok: true, data: data as T }
  } catch (e) {
    return { ok: false, reason: thaiError(e instanceof Error ? e.message : undefined) }
  }
}
