import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../data/useFactoryData'
import { thaiError } from '../data/live'
import { corrections, eventLine, visitLines, type EventRow, type VisitRow } from '../data/history'
import { STATION_NAME, type StationCode } from '../proto/model'
import type { EmployeeRole } from '../auth/access'
import { TONE } from '../components/tone'
import { Pill } from '../components/ui'
import { fieldClass, secondaryBtn, dangerBtn } from '../components/Dialog'

type SampleRow = { round: number; result: 'pass' | 'fail'; note: string | null; customer_confirmed_at: string | null; by: string | null; at: string }
type QcRow = { passed: number; failed: number; reasons: unknown; source_station: string | null; by: string | null; at: string }
type DelayRow = { reasons: string[]; detail: string; new_eta: string; need_help: string | null; station_code: string | null; by: string | null; at: string }
type StationRow = { code: string; name: string; substeps: { key: string; name: string }[] }

type History = {
  unit: string
  events: EventRow[]; visits: VisitRow[]; samples: SampleRow[]; qc: QcRow[]; delays: DelayRow[]
  names: Map<string, string>; reasons: Map<string, string>; stations: StationRow[]
}

const SHOW = 30
const when = (at: string) => new Date(at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

async function load(jobId: string): Promise<History> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const [job, ev, vi, sa, qc, de, rc, st, nm] = await Promise.all([
    supabase.from('jobs').select('unit').eq('id', jobId).single(),
    supabase.from('events').select('id, type, phase, station_code, payload, by, at').eq('job_id', jobId).order('at').order('id'),
    supabase.from('station_visits').select('station_code, phase, visit, started_at, done_at, rework').eq('job_id', jobId),
    supabase.from('sample_results').select('round, result, note, customer_confirmed_at, by, at').eq('job_id', jobId).order('round'),
    supabase.from('qc_results').select('passed, failed, reasons, source_station, by, at').eq('job_id', jobId).order('at'),
    supabase.from('delay_reports').select('reasons, detail, new_eta, need_help, station_code, by, at').eq('job_id', jobId).order('at'),
    supabase.from('reason_codes').select('code, name'),
    supabase.from('stations').select('code, name, substeps'),
    rpc<{ user_id: string; name: string }[]>('staff_names', {}),
  ])
  const err = job.error ?? ev.error ?? vi.error ?? sa.error ?? qc.error ?? de.error ?? rc.error ?? st.error
  if (err) throw new Error(err.message)
  return {
    unit: job.data?.unit ?? 'ชิ้น',
    events: (ev.data ?? []) as EventRow[],
    visits: (vi.data ?? []) as VisitRow[],
    samples: (sa.data ?? []) as SampleRow[],
    qc: (qc.data ?? []) as QcRow[],
    delays: (de.data ?? []) as DelayRow[],
    reasons: new Map(((rc.data ?? []) as { code: string; name: string }[]).map(r => [r.code, r.name])),
    stations: (st.data ?? []) as StationRow[],
    // ชื่อพนักงานโหลดไม่ได้ ยังแสดงประวัติได้ (แค่ไม่มีชื่อผู้กด)
    names: new Map(nm.ok ? nm.data.map(r => [r.user_id, r.name]) : []),
  }
}

/** รายละเอียดงาน (S8): รอบตัวอย่าง · QC/งานแก้ · รายงานปัญหา · เวลาต่อสถานี · ไทม์ไลน์ทุกการกด */
export function JobHistory({ jobId, role, version, now, onChanged }: {
  jobId: string; role: EmployeeRole; version: number; now: Date; onChanged: () => Promise<void>
}) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: History }>({ status: 'loading' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    load(jobId).then(
      data => { if (alive) setState({ status: 'ready', data }) },
      e => { if (alive) setState(s => s.status === 'ready' ? s : { status: 'error', message: thaiError(e instanceof Error ? e.message : undefined) }) },
    )
    return () => { alive = false }
  }, [jobId, version, reload])

  if (state.status === 'loading') return <Box title="ประวัติงาน"><p role="status" className="text-muted">กำลังโหลดประวัติ…</p></Box>
  if (state.status === 'error') {
    return (
      <Box title="ประวัติงาน">
        <p role="alert" className="text-danger">โหลดประวัติไม่สำเร็จ · {state.message}</p>
        <button type="button" className={`${secondaryBtn} mt-2`} onClick={() => { setState({ status: 'loading' }); setReload(n => n + 1) }}>ลองอีกครั้ง</button>
      </Box>
    )
  }
  return <HistoryView data={state.data} role={role} now={now} jobId={jobId} onChanged={async () => { await onChanged(); setReload(n => n + 1) }} />
}

function HistoryView({ data: h, role, now, jobId, onChanged }: { data: History; role: EmployeeRole; now: Date; jobId: string; onChanged: () => Promise<void> }) {
  const [all, setAll] = useState(false)
  const stationName = (code: string) => STATION_NAME[code as StationCode] ?? h.stations.find(s => s.code === code)?.name ?? code
  const names = {
    station: stationName,
    step: (station: string, key: string) => h.stations.find(s => s.code === station)?.substeps.find(s => s.key === key)?.name ?? key,
  }
  const who = (id: string | null) => (id ? h.names.get(id) ?? 'ไม่ทราบชื่อ' : 'ระบบ')
  const fixed = corrections(h.events)
  const visits = visitLines(h.visits, names, now, h.events)
  const timeline = [...h.events].reverse()
  const shown = all ? timeline : timeline.slice(0, SHOW)
  // แจ้งกดผิดได้เฉพาะคนคุมหน้างาน (ฐานข้อมูลตรวจซ้ำใน correct_event)
  const canCorrect = role === 'production' || role === 'supervisor' || role === 'owner'

  return (
    <>
      {h.samples.length > 0 && (
        <Box title="รอบตัวอย่าง">
          <ul className="grid gap-2">
            {h.samples.map(s => (
              <li key={s.round} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">รอบ {s.round}</span>
                  <Pill tone={s.result === 'pass' ? 'ok' : 'danger'}>{s.result === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน'}</Pill>
                  <span className="ml-auto text-sm text-muted">{when(s.at)} · {who(s.by)}</span>
                </div>
                {s.note && <p className="mt-1 break-words">ต้องแก้: {s.note}</p>}
                {s.customer_confirmed_at && <p className="text-sm text-muted">ลูกค้ายืนยันวันที่ {new Date(`${s.customer_confirmed_at}T12:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })}</p>}
              </li>
            ))}
          </ul>
        </Box>
      )}

      {h.qc.length > 0 && (
        <Box title="QC และงานแก้">
          <ul className="grid gap-2">
            {h.qc.map((q, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                {q.passed > 0 && <Pill tone="ok">ผ่าน {q.passed.toLocaleString('th-TH')}</Pill>}
                {q.failed > 0 && <Pill tone="danger">ส่งแก้ {q.failed.toLocaleString('th-TH')}</Pill>}
                {q.failed > 0 && <span className="min-w-0 break-words">
                  {q.source_station ? `ที่${stationName(q.source_station)}` : ''}{Array.isArray(q.reasons) && q.reasons.length ? ` · ${q.reasons.join(', ')}` : ''}
                </span>}
                <span className="ml-auto text-sm text-muted">{when(q.at)} · {who(q.by)}</span>
              </li>
            ))}
          </ul>
        </Box>
      )}

      {h.delays.length > 0 && (
        <Box title="รายงานปัญหา (เกินเวลามาตรฐาน)">
          <ul className="grid gap-2">
            {h.delays.map((d, i) => (
              <li key={i} className="rounded-xl border border-warn/40 p-3">
                <p className="font-medium">{d.reasons.map(c => h.reasons.get(c) ?? c).join(' · ')}</p>
                <p className="break-words">{d.detail}</p>
                <p className="text-sm text-muted">
                  {d.station_code ? `${stationName(d.station_code)} · ` : ''}คาดว่าเสร็จ {when(d.new_eta)}{d.need_help ? ` · ต้องการความช่วยเหลือ: ${d.need_help}` : ''}
                </p>
                <p className="text-sm text-muted">{when(d.at)} · {who(d.by)}</p>
              </li>
            ))}
          </ul>
        </Box>
      )}

      {visits.length > 0 && (
        <Box title="เวลาที่ใช้ต่อสถานี (ไม่นับเวลาพัก)">
          <ul className="divide-y divide-line">
            {visits.map((v, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="min-w-0 flex-1 font-medium">{v.label}</span>
                <span className={v.end ? 'tabular-nums' : 'font-semibold text-info tabular-nums'}>{v.span}</span>
                <span className="w-full text-sm text-muted">เริ่ม {when(v.start.toISOString())}{v.end ? ` · เสร็จ ${when(v.end.toISOString())}` : ''}{v.paused ? ` · ไม่นับเวลาพัก ${v.paused}` : ''}</span>
              </li>
            ))}
          </ul>
        </Box>
      )}

      <Box title={`ไทม์ไลน์ทุกการกด (${h.events.length})`}>
        {h.events.length === 0 ? <p className="text-muted">ยังไม่มีการกดบันทึก</p> : (
          <ol className="grid gap-1">
            {shown.map(e => (
              <TimelineItem key={e.id} e={e} line={eventLine(e, names, h.unit)} who={who(e.by)} fixedReason={fixed.get(e.id)}
                canCorrect={canCorrect && e.type !== 'correction'} jobId={jobId} onChanged={onChanged} />
            ))}
          </ol>
        )}
        {timeline.length > SHOW && (
          <button type="button" className={`${secondaryBtn} mt-2 w-full`} onClick={() => setAll(a => !a)}>
            {all ? 'ย่อ' : `ดูทั้งหมด ${timeline.length} รายการ`}
          </button>
        )}
      </Box>
    </>
  )
}

function TimelineItem({ e, line, who, fixedReason, canCorrect, jobId, onChanged }: {
  e: EventRow; line: ReturnType<typeof eventLine>; who: string; fixedReason?: string
  canCorrect: boolean; jobId: string; onChanged: () => Promise<void>
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    if (!reason?.trim()) return
    setBusy(true)
    setError('')
    const r = await rpc('correct_event', { p_job: jobId, p_event_id: e.id, p_reason: reason.trim() })
    setBusy(false)
    if (!r.ok) { setError(r.reason); return }
    setReason(null)
    await onChanged()
  }

  return (
    <li className="flex gap-3 rounded-xl px-1 py-1.5">
      <span className={`mt-2 size-2.5 shrink-0 rounded-full ${TONE[line.tone].dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`break-words text-base ${fixedReason !== undefined ? 'text-muted line-through' : 'font-medium'}`}>{line.title}</p>
        {line.detail && <p className="break-words text-sm">{line.detail}</p>}
        <p className="text-sm text-muted">{when(e.at)} · {who}</p>
        {fixedReason !== undefined && <p className="text-sm font-medium text-warn">แจ้งว่ากดผิด: {fixedReason || 'ไม่ระบุเหตุผล'}</p>}
        {canCorrect && fixedReason === undefined && (reason === null
          ? <button type="button" className="min-h-12 text-sm font-medium text-muted underline" onClick={() => setReason('')}>แจ้งว่ากดผิด</button>
          : (
            <div className="mt-1 grid gap-2 rounded-xl bg-paper p-2">
              <label className="grid gap-1 text-sm font-medium">เหตุผล (ต้องกรอก · ประวัติเดิมไม่ถูกลบ)
                <input value={reason} onChange={ev => setReason(ev.target.value)} placeholder="เช่น กดเสร็จผิดงาน" className={fieldClass} />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={busy || !reason.trim()} className={dangerBtn} onClick={() => void send()}>
                  {busy ? 'กำลังบันทึก…' : reason.trim() ? 'บันทึกว่ากดผิด' : 'กรอกเหตุผลก่อน'}
                </button>
                <button type="button" className={secondaryBtn} onClick={() => { setReason(null); setError('') }}>ยกเลิก</button>
              </div>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            </div>
          ))}
      </div>
    </li>
  )
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-card">
      <h3 className="mb-2 font-semibold">{title}</h3>
      {children}
    </section>
  )
}
