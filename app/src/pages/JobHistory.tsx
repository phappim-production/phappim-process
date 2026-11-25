import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../data/useFactoryData'
import { reasonCodes, staffNames, stationInfo } from '../data/lookups'
import { thaiError } from '../data/live'
import { corrections, eventWords, visitLines, type EventRow, type EventWords, type VisitRow } from '../data/history'
import { Tr } from '../i18n/Tr'
import { durationWord } from '../proto/format'
import { useLang, useT, type Lang } from '../i18n/lang'
import { STATION_NAME, type StationCode } from '../proto/model'
import type { EmployeeRole } from '../auth/access'
import { TONE } from '../components/tone'
import { Pill } from '../components/ui'
import { fieldClass, secondaryBtn, dangerBtn } from '../components/Dialog'
import { signStationPhotos } from '../data/stationPhotos'

type SampleRow = { round: number; result: 'pass' | 'fail'; note: string | null; customer_confirmed_at: string | null; by: string | null; at: string }
type QcRow = { passed: number; failed: number; reasons: unknown; source_station: string | null; by: string | null; at: string }
type DelayRow = { reasons: string[]; detail: string; new_eta: string; need_help: string | null; station_code: string | null; by: string | null; at: string }
type StationRow = { code: string; name: string; substeps: { key: string; name: string }[] }
type PhotoRow = { id: number; station_code: string; kind: 'first_piece' | 'finish'; status: 'pending' | 'approved' | 'rejected' | 'recorded'; photos: string[]; reject_reason: string | null; sent_by: string | null; sent_at: string }

type History = {
  unit: string
  events: EventRow[]; visits: VisitRow[]; samples: SampleRow[]; qc: QcRow[]; delays: DelayRow[]; photos: PhotoRow[]
  names: Map<string, string>; reasons: Map<string, string>; stations: StationRow[]
}

const SHOW = 30
// พม่าใช้ วัน/เดือน ตัวเลข ให้ตรงกับป้ายกำหนดส่งบนจอ
const when = (at: string, lang: Lang = 'th') => new Date(at).toLocaleString(lang === 'my' ? 'en-GB' : 'th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: lang === 'my' ? 'numeric' : 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '')

async function load(jobId: string): Promise<Omit<History, 'unit'>> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const [ev, vi, sa, qc, de, ph, rc, st, names] = await Promise.all([
    supabase.from('events').select('id, type, phase, station_code, payload, by, at').eq('job_id', jobId).order('at').order('id'),
    supabase.from('station_visits').select('station_code, phase, visit, started_at, done_at, rework').eq('job_id', jobId),
    supabase.from('sample_results').select('round, result, note, customer_confirmed_at, by, at').eq('job_id', jobId).order('round'),
    supabase.from('qc_results').select('passed, failed, reasons, source_station, by, at').eq('job_id', jobId).order('at'),
    supabase.from('delay_reports').select('reasons, detail, new_eta, need_help, station_code, by, at').eq('job_id', jobId).order('at'),
    supabase.from('station_checks').select('id, station_code, kind, status, photos, reject_reason, sent_by, sent_at').eq('job_id', jobId).order('sent_at'),
    reasonCodes.get(),
    stationInfo.get(),
    // ชื่อพนักงานโหลดไม่ได้ ยังแสดงประวัติได้ (แค่ไม่มีชื่อผู้กด)
    staffNames.get().catch(() => new Map<string, string>()),
  ])
  const err = ev.error ?? vi.error ?? sa.error ?? qc.error ?? de.error
  if (err) throw new Error(err.message)
  return {
    events: (ev.data ?? []) as EventRow[],
    visits: (vi.data ?? []) as VisitRow[],
    samples: (sa.data ?? []) as SampleRow[],
    qc: (qc.data ?? []) as QcRow[],
    delays: (de.data ?? []) as DelayRow[],
    // ฐานข้อมูลที่ยังไม่มีตารางรูป = ไม่มีรูป ประวัติยังแสดงได้
    photos: ph.error ? [] : (ph.data ?? []) as PhotoRow[],
    reasons: new Map(rc.map(r => [r.code, r.name])),
    stations: st.map(s => ({ code: s.code, name: s.name, substeps: s.substeps ?? [] })),
    names,
  }
}

export function JobHistory({ jobId, unit, role, version, now, onChanged }: {
  jobId: string; unit: string; role: EmployeeRole; version: string; now: Date; onChanged: () => Promise<void>
}) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Omit<History, 'unit'> }>({ status: 'loading' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    load(jobId).then(
      data => { if (alive) setState({ status: 'ready', data }) },
      e => { if (alive) setState(s => s.status === 'ready' ? s : { status: 'error', message: thaiError(e instanceof Error ? e.message : undefined) }) },
    )
    return () => { alive = false }
  }, [jobId, version, reload])

  if (state.status === 'loading') return <Box title="ประวัติงาน"><p role="status" className="text-muted"><Tr th="กำลังโหลดประวัติ…" /></p></Box>
  if (state.status === 'error') {
    return (
      <Box title="ประวัติงาน">
        <p role="alert" className="text-danger"><Tr th="โหลดประวัติไม่สำเร็จ · {reason}" vars={{ reason: { th: state.message } }} /></p>
        <button type="button" className={`${secondaryBtn} mt-2`} onClick={() => { setState({ status: 'loading' }); setReload(n => n + 1) }}><Tr th="ลองอีกครั้ง" /></button>
      </Box>
    )
  }
  return <HistoryView data={{ ...state.data, unit }} role={role} now={now} jobId={jobId} onChanged={async () => { await onChanged(); setReload(n => n + 1) }} />
}

function HistoryView({ data: h, role, now, jobId, onChanged }: { data: History; role: EmployeeRole; now: Date; jobId: string; onChanged: () => Promise<void> }) {
  const [all, setAll] = useState(false)
  const t = useT()
  const lang = useLang()
  const at = (iso: string) => when(iso, lang)
  const stationName = (code: string) => STATION_NAME[code as StationCode] ?? h.stations.find(s => s.code === code)?.name ?? code
  const names = {
    station: stationName,
    step: (station: string, key: string) => h.stations.find(s => s.code === station)?.substeps.find(s => s.key === key)?.name ?? key,
  }
  const who = (id: string | null) => (id ? h.names.get(id) ?? t('ไม่ทราบชื่อ') : t('ระบบ'))
  const fixed = corrections(h.events)
  const visits = visitLines(h.visits, names, now, h.events)
  const timeline = [...h.events].reverse()
  const shown = all ? timeline : timeline.slice(0, SHOW)
  // แจ้งกดผิดได้เฉพาะคนคุมหน้างาน (ฐานข้อมูลตรวจซ้ำใน correct_event)
  const canCorrect = role === 'production' || role === 'supervisor' || role === 'owner'

  return (
    <>
      {h.photos.length > 0 && (
        <Box title="รูปจากสถานี">
          <StationPhotoList rows={h.photos} stationName={stationName} who={who} at={at} />
        </Box>
      )}
      {h.samples.length > 0 && (
        <Box title="รอบตัวอย่าง">
          <ul className="grid gap-2">
            {h.samples.map(s => (
              <li key={s.round} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t('รอบ {n}', { n: s.round })}</span>
                  <Pill tone={s.result === 'pass' ? 'ok' : 'danger'}>{t(s.result === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน')}</Pill>
                  <span className="ml-auto text-sm text-muted">{at(s.at)} · {who(s.by)}</span>
                </div>
                {s.note && <p className="mt-1 break-words">{t('ต้องแก้: {note}', { note: s.note })}</p>}
                {s.customer_confirmed_at && <p className="text-sm text-muted">{t('ลูกค้ายืนยันวันที่ {at}', { at: { at: new Date(`${s.customer_confirmed_at}T12:00:00+07:00`) } })}</p>}
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
                {q.passed > 0 && <Pill tone="ok">{t('ผ่าน {n}', { n: q.passed.toLocaleString('th-TH') })}</Pill>}
                {q.failed > 0 && <Pill tone="danger">{t('ส่งแก้ {n}', { n: q.failed.toLocaleString('th-TH') })}</Pill>}
                {q.failed > 0 && <span className="min-w-0 break-words">
                  {q.source_station ? t('ที่{station}', { station: { th: stationName(q.source_station) } }) : ''}{Array.isArray(q.reasons) && q.reasons.length ? ` · ${q.reasons.join(', ')}` : ''}
                </span>}
                <span className="ml-auto text-sm text-muted">{at(q.at)} · {who(q.by)}</span>
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
                <p className="font-medium">{d.reasons.map(c => t(h.reasons.get(c) ?? c)).join(' · ')}</p>
                <p className="break-words">{d.detail}</p>
                <p className="text-sm text-muted">
                  {d.station_code ? `${t(stationName(d.station_code))} · ` : ''}{t('คาดว่าเสร็จ {at}', { at: at(d.new_eta) })}{d.need_help ? ` · ${t('ต้องการความช่วยเหลือ: {who}', { who: d.need_help })}` : ''}
                </p>
                <p className="text-sm text-muted">{at(d.at)} · {who(d.by)}</p>
              </li>
            ))}
          </ul>
        </Box>
      )}

      {visits.length > 0 && (
        <Box title="เวลาที่ใช้ต่อสถานี (ไม่นับเวลาพักและรออนุมัติชิ้นแรก)">
          <ul className="divide-y divide-line">
            {visits.map((v, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="min-w-0 flex-1 font-medium">{lang === 'my' ? t(stationName(v.station)) : v.label}</span>
                <span className={v.end ? 'tabular-nums' : 'font-semibold text-info tabular-nums'}>{lang === 'my' ? t(v.end ? '{time}' : '{time} (ยังทำอยู่)', { time: durationWord(v.workedMs) }) : v.span}</span>
                <span className="w-full text-sm text-muted">{[t('เริ่ม {at}', { at: at(v.start.toISOString()) }), v.end && t('เสร็จ {at}', { at: at(v.end.toISOString()) }), v.paused && t('ไม่นับเวลาพัก {time}', { time: lang === 'my' ? durationWord(v.pausedMs) : v.paused }),
                  v.waited && t('ไม่นับเวลารออนุมัติชิ้นแรก {time}', { time: lang === 'my' ? durationWord(v.waitedMs) : v.waited })].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </Box>
      )}

      <Box title="ไทม์ไลน์ทุกการกด ({n})" vars={{ n: h.events.length }}>
        {h.events.length === 0 ? <p className="text-muted"><Tr th="ยังไม่มีการกดบันทึก" /></p> : (
          <ol className="grid gap-1">
            {shown.map(e => (
              <TimelineItem key={e.id} e={e} line={eventWords(e, names, h.unit)} at={at(e.at)} who={who(e.by)} fixedReason={fixed.get(e.id)}
                canCorrect={canCorrect && e.type !== 'correction'} jobId={jobId} onChanged={onChanged} />
            ))}
          </ol>
        )}
        {timeline.length > SHOW && (
          <button type="button" className={`${secondaryBtn} mt-2 w-full`} onClick={() => setAll(a => !a)}>
            <Tr th={all ? 'ย่อ' : 'ดูทั้งหมด {n} รายการ'} vars={{ n: timeline.length }} />
          </button>
        )}
      </Box>
    </>
  )
}

function TimelineItem({ e, line, at, who, fixedReason, canCorrect, jobId, onChanged }: {
  e: EventRow; line: EventWords; at: string; who: string; fixedReason?: string
  canCorrect: boolean; jobId: string; onChanged: () => Promise<void>
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const t = useT()

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
        <p className={`break-words text-base ${fixedReason !== undefined ? 'text-muted line-through' : 'font-medium'}`}><Tr th={line.title.th} vars={line.title.vars} /></p>
        {line.detail && <p className="break-words text-sm">{t(line.detail.th, line.detail.vars)}</p>}
        <p className="text-sm text-muted">{at} · {who}</p>
        {fixedReason !== undefined && <p className="text-sm font-medium text-warn">{t('แจ้งว่ากดผิด: {reason}', { reason: fixedReason || { th: 'ไม่ระบุเหตุผล' } })}</p>}
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

const PHOTO_LABEL: Record<PhotoRow['status'], { th: string; tone: 'warn' | 'ok' | 'danger' | 'info' }> = {
  pending: { th: 'ชิ้นแรก · รออนุมัติ', tone: 'warn' },
  approved: { th: 'ชิ้นแรก · ผ่าน', tone: 'ok' },
  rejected: { th: 'ชิ้นแรก · ไม่ผ่าน', tone: 'danger' },
  recorded: { th: 'งานเสร็จ', tone: 'info' },
}

function StationPhotoList({ rows, stationName, who, at }: { rows: PhotoRow[]; stationName: (code: string) => string; who: (id: string | null) => string; at: (iso: string) => string }) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const t = useT()
  const key = rows.flatMap(r => r.photos).join('|')
  useEffect(() => {
    let alive = true
    void signStationPhotos(key ? key.split('|') : []).then(m => { if (alive) setUrls(m) })
    return () => { alive = false }
  }, [key])
  return (
    <ul className="grid gap-3">
      {[...rows].reverse().map(r => (
        <li key={r.id} className="grid gap-2 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t(stationName(r.station_code))}</span>
            <Pill tone={PHOTO_LABEL[r.status].tone}>{t(PHOTO_LABEL[r.status].th)}</Pill>
            <span className="ml-auto text-sm text-muted">{at(r.sent_at)} · {who(r.sent_by)}</span>
          </div>
          {r.reject_reason && <p className="text-danger">{t('ต้องแก้: {note}', { note: r.reject_reason })}</p>}
          <div className="flex flex-wrap gap-2">
            {r.photos.map((p, i) => {
              const u = urls.get(p)
              return u
                ? <a key={p} href={u} target="_blank" rel="noreferrer"><img src={u} alt={t('รูปที่ {n}', { n: i + 1 })} className="size-24 rounded-lg border border-line object-cover" /></a>
                : <span key={p} className="grid size-24 place-items-center rounded-lg border border-dashed border-line text-sm text-muted">{t('รูปที่ {n}', { n: i + 1 })}</span>
            })}
          </div>
        </li>
      ))}
    </ul>
  )
}

function Box({ title, vars, children }: { title: string; vars?: Record<string, number>; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-card">
      <h3 className="mb-2 font-semibold"><Tr inline th={title} vars={vars} /></h3>
      {children}
    </section>
  )
}
