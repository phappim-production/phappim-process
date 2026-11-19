import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { canCloseIssue, type EmployeeRole } from '../auth/access'
import { Card, CardHeader, DueLabel, MockupThumb, Pill, ProcessBar } from '../components/ui'
import { dangerBtn, fieldClass, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconAlert, IconChevronRight, IconClock, IconFlag, IconLayers } from '../components/icons'
import { eventLine, type EventRow } from '../data/history'
import { thaiError } from '../data/live'
import { supabase } from '../lib/supabase'
import { duration } from '../proto/format'
import { SLA_LABEL, STATION_NAME, STATUS_NAME, type Job, type StationCode } from '../proto/model'
import { problemLists, queueBoard, reportable } from '../proto/rolePages'
import { pendingReviews } from '../proto/admin'
import { loadReviews } from './admin/data'
import type { QueueCall } from './StationQueue'

type Notice = { ok: boolean; text: string } | null

function JobRow({ job: j, now, onOpen, children }: { job: Job; now: Date; onOpen: (id: string) => void; children?: ReactNode }) {
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-card p-3">
      <button type="button" onClick={() => onOpen(j.id)} className="flex min-w-0 items-start gap-3 text-left" aria-label={`ดูรายละเอียดงาน ${j.no}`}>
        <MockupThumb job={j} />
        <span className="grid min-w-0 flex-1 grid-cols-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-lg">{j.no}</b>
            {j.station && <Pill tone="neutral">{STATION_NAME[j.station]}</Pill>}
            {j.status && <Pill tone={j.status === 'hold' ? 'danger' : j.status === 'doing' ? 'info' : 'neutral'}>{STATUS_NAME[j.status]}</Pill>}
            {j.rework && <Pill tone="danger">งานแก้ {j.rework.qty} {j.unit}</Pill>}
            {j.sla && <Pill tone={SLA_LABEL[j.sla].tone}>{SLA_LABEL[j.sla].text}</Pill>}
            <IconChevronRight className="ml-auto size-5 text-muted" />
          </span>
          <span className="truncate">{j.customer} · {j.product} {j.qty.toLocaleString('th-TH')} {j.unit}</span>
          <span className="text-sm"><DueLabel job={j} now={now} /></span>
          {j.holdReason && <span className="font-medium text-danger">สาเหตุ: {j.holdReason}</span>}
          {j.rework && <span className="font-medium text-danger">ต้องแก้: {j.rework.reason}</span>}
        </span>
      </button>
      <ProcessBar job={j} />
      {children}
    </li>
  )
}

function Section({ icon, title, sub, empty, children, count }: {
  icon: typeof IconAlert; title: string; sub?: string; empty: string; children: ReactNode; count: number
}) {
  return (
    <Card>
      <CardHeader icon={icon} title={`${title} (${count})`} sub={sub} tone={count ? 'danger' : 'ok'} />
      <div className="px-4 pb-4">{count ? <ul className="grid gap-2">{children}</ul> : <p className="text-muted">{empty}</p>}</div>
    </Card>
  )
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null
  return <p role={notice.ok ? 'status' : 'alert'} className={`rounded-xl px-3 py-2 font-medium ${notice.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>{notice.text}</p>
}

export function IssuesView({ jobs, now, role, stations, call, onOpen, heldOnly }: {
  jobs: Job[]; now: Date; role: EmployeeRole; stations: StationCode[] | null; call: QueueCall; onOpen: (id: string) => void; heldOnly?: boolean
}) {
  const { held, rework, overSla } = useMemo(() => problemLists(jobs, stations), [jobs, stations])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const resume = async (j: Job) => {
    setBusy(j.id)
    const sew = j.station === 'sew'
    const r = await call(sew ? 'resume_sewing' : 'close_issue', sew ? { p_job: j.id } : { p_job: j.id, p_note: null })
    setBusy(null)
    setNotice(r.ok ? { ok: true, text: `${j.no} ${sew ? 'เย็บต่อแล้ว' : 'แก้แล้ว · ทำต่อได้'}` } : { ok: false, text: `${j.no}: ${r.reason}` })
  }
  return (
    <>
      <NoticeLine notice={notice} />
      <Section icon={IconAlert} title="ติดปัญหา / พักงาน" count={held.length} empty="ไม่มีงานติดปัญหา"
        sub="เรียงตามเวลาที่พักนานสุดก่อน · แก้แล้วกดให้สถานีทำต่อ">
        {held.map(j => (
          <JobRow key={j.id} job={j} now={now} onOpen={onOpen}>
            <p className="text-sm text-muted">พักมา {duration(now.getTime() - j.since.getTime())}</p>
            {canCloseIssue(role, j.station)
              ? <button type="button" disabled={busy !== null} className={primaryBtn} onClick={() => void resume(j)}>
                  {busy === j.id ? 'กำลังบันทึก…' : j.station === 'sew' ? 'แก้แล้ว เย็บต่อ' : 'แก้แล้ว ทำต่อ'}
                </button>
              : <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn">
                  {j.station === 'sew' ? 'รอฝ่ายผลิตกด "แก้แล้ว เย็บต่อ" (ต้องจ่ายจักร)' : 'รอผู้บริหารหรือฝ่ายผลิตกด "แก้แล้ว ทำต่อ"'}
                </p>}
          </JobRow>
        ))}
      </Section>
      {!heldOnly && <>
      <Section icon={IconFlag} title="งานแก้" count={rework.length} empty="ไม่มีงานแก้ค้าง" sub="ชิ้นที่ QC ส่งกลับไปแก้ที่สถานีต้นเหตุ">
        {rework.map(j => <JobRow key={j.id} job={j} now={now} onOpen={onOpen} />)}
      </Section>
      <Section icon={IconClock} title="เกินเวลามาตรฐาน" count={overSla.length} empty="ไม่มีงานเกินเวลามาตรฐาน" sub="เปิดงานเพื่อดูรายงานปัญหาและวันเสร็จใหม่">
        {overSla.map(j => <JobRow key={j.id} job={j} now={now} onOpen={onOpen} />)}
      </Section>
      </>}
    </>
  )
}

export function ReportIssueView({ jobs, now, stations, call, onOpen }: {
  jobs: Job[]; now: Date; stations: StationCode[]; call: QueueCall; onOpen: (id: string) => void
}) {
  const list = useMemo(() => reportable(jobs, stations), [jobs, stations])
  const { held } = useMemo(() => problemLists(jobs, stations), [jobs, stations])
  const [open, setOpen] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  if (!stations.length) {
    return <Card className="p-5"><p className="font-semibold">ยังไม่ได้จับคู่สถานี</p><p className="text-muted">ให้เจ้าของระบบจับคู่สถานีให้ที่เมนู Station Assignment</p></Card>
  }
  const send = async (j: Job) => {
    setBusy(true)
    const r = await call('open_issue', { p_job: j.id, p_reason: reason.trim() })
    setBusy(false)
    if (r.ok) { setOpen(null); setReason(''); setNotice({ ok: true, text: `แจ้งปัญหา ${j.no} แล้ว · งานพักไว้รอฝ่ายผลิตแก้` }) }
    else setNotice({ ok: false, text: `${j.no}: ${r.reason}` })
  }
  return (
    <>
      <NoticeLine notice={notice} />
      <Card>
        <CardHeader icon={IconFlag} title="เลือกงานที่มีปัญหา" sub={`งานที่สถานี${stations.map(s => STATION_NAME[s]).join(' · ')} · แจ้งแล้วงานจะพักจนฝ่ายผลิตกดแก้แล้ว`} />
        <div className="px-4 pb-4">
          {list.length === 0 ? <p className="text-muted">ไม่มีงานที่สถานีของคุณตอนนี้</p> : (
            <ul className="grid gap-2">
              {list.map(j => (
                <JobRow key={j.id} job={j} now={now} onOpen={onOpen}>
                  {open === j.id ? (
                    <div className="grid gap-2 rounded-xl bg-danger-soft p-3">
                      <label className="grid gap-1 font-semibold text-danger">ปัญหาคืออะไร (ต้องกรอก)
                        <input value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} placeholder="เช่น ผ้าไม่พอ เครื่องเสีย สีเพี้ยน" />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" disabled={busy || !reason.trim()} className={dangerBtn} onClick={() => void send(j)}>
                          {busy ? 'กำลังบันทึก…' : reason.trim() ? 'แจ้งปัญหา' : 'กรอกปัญหาก่อน'}
                        </button>
                        <button type="button" disabled={busy} className={secondaryBtn} onClick={() => { setOpen(null); setReason('') }}>ยกเลิก</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className={dangerBtn} disabled={open !== null} onClick={() => { setOpen(j.id); setReason('') }}>แจ้งปัญหา</button>
                  )}
                </JobRow>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Section icon={IconAlert} title="ปัญหาที่แจ้งไว้" count={held.length} empty="ไม่มีงานติดปัญหาที่สถานีของคุณ" sub="รอฝ่ายผลิตแก้ · แก้แล้วงานจะกลับมาทำต่อได้">
        {held.map(j => <JobRow key={j.id} job={j} now={now} onOpen={onOpen} />)}
      </Section>
    </>
  )
}

export function QueueAllView({ jobs, now, onOpen }: { jobs: Job[]; now: Date; onOpen: (id: string) => void }) {
  const rows = useMemo(() => queueBoard(jobs), [jobs])
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map(r => {
        const total = r.doing.length + r.waiting.length + r.hold.length + r.out.length
        return (
          <Card key={r.station}>
            <CardHeader icon={IconLayers} title={r.name} sub={total ? `ทำอยู่ ${r.doing.length} · รอคิว ${r.waiting.length}${r.hold.length ? ` · ติดปัญหา ${r.hold.length}` : ''}${r.out.length ? ` · ข้างนอก ${r.out.length}` : ''}` : 'ว่าง'}
              right={<a href={`#/board?station=${r.station}`} className="text-sm font-semibold text-brand">เปิดคิว</a>} />
            {total > 0 && (
              <ol className="grid gap-1 px-4 pb-4">
                {[...r.doing, ...r.hold, ...r.waiting, ...r.out].map(j => {
                  const pos = r.waiting.indexOf(j)
                  return (
                    <li key={j.id}>
                      <button type="button" onClick={() => onOpen(j.id)} className="flex min-h-12 w-full items-center gap-2 rounded-xl px-2 text-left hover:bg-paper">
                        <span className="w-8 shrink-0 text-center font-bold text-muted tabular-nums">{pos >= 0 ? pos + 1 : ''}</span>
                        <b className="shrink-0">{j.no}</b>
                        <span className="min-w-0 flex-1 truncate text-muted">{j.customer}</span>
                        {j.status && j.status !== 'queued' && <Pill tone={j.status === 'hold' ? 'danger' : 'info'}>{STATUS_NAME[j.status]}</Pill>}
                        <span className="hidden shrink-0 text-sm sm:inline"><DueLabel job={j} now={now} /></span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>
        )
      })}
    </div>
  )
}

type MyEvent = EventRow & { job_id: string }
const HISTORY_DAYS = 7

export function MyHistoryView({ jobs, onOpen }: { jobs: Job[]; onOpen: (id: string) => void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; rows: MyEvent[] }>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const db = supabase
    if (!db) return
    let alive = true
    void (async () => {
      const { data: session } = await db.auth.getSession()
      const me = session.session?.user.id
      if (!me) throw new Error('ตรวจบัญชีไม่ได้ กรุณาเข้าสู่ระบบใหม่')
      const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString()
      const { data, error } = await db.from('events').select('id, job_id, type, phase, station_code, payload, by, at')
        .eq('by', me).gte('at', since).order('at', { ascending: false }).limit(300)
      if (error) throw new Error(thaiError(error.message))
      if (alive) setState({ status: 'ready', rows: (data ?? []) as MyEvent[] })
    })().catch((e: unknown) => { if (alive) setState({ status: 'error', message: e instanceof Error ? e.message : thaiError(undefined) }) })
    return () => { alive = false }
  }, [attempt])

  if (state.status === 'loading') return <Card className="p-5"><p role="status" className="text-muted">กำลังโหลดประวัติ…</p></Card>
  if (state.status === 'error') {
    return (
      <Card className="grid gap-3 p-5">
        <p role="alert" className="text-danger">โหลดประวัติไม่สำเร็จ · {state.message}</p>
        <button type="button" className={secondaryBtn} onClick={() => { setState({ status: 'loading' }); setAttempt(n => n + 1) }}>ลองอีกครั้ง</button>
      </Card>
    )
  }
  const names = { station: (code: string) => STATION_NAME[code as StationCode] ?? code, step: (_station: string, key: string) => key }
  const byDay = new Map<string, MyEvent[]>()
  for (const e of state.rows) {
    const day = new Date(e.at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'short' })
    byDay.set(day, [...(byDay.get(day) ?? []), e])
  }
  if (!state.rows.length) return <Card className="p-5"><p className="text-muted">ยังไม่มีงานที่คุณกดใน {HISTORY_DAYS} วันที่ผ่านมา</p></Card>
  return (
    <>
      {[...byDay].map(([day, rows]) => (
        <Card key={day}>
          <CardHeader icon={IconClock} title={day} sub={`${rows.length} รายการ`} />
          <ul className="grid gap-1 px-4 pb-4">
            {rows.map(e => {
              const job = jobs.find(j => j.id === e.job_id)
              const line = eventLine(e, names, job?.unit)
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpen(e.job_id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-paper">
                    <span className="w-14 shrink-0 text-sm text-muted tabular-nums">
                      {new Date(e.at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <b className="shrink-0">{job?.no ?? 'งาน'}</b>
                    <span className="min-w-0 flex-1">{line.title}{line.detail && <span className="text-muted"> · {line.detail}</span>}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      ))}
    </>
  )
}

type ReviewData = Awaited<ReturnType<typeof loadReviews>>

export function ReviewsView({ jobs, now, role, call, onOpen }: {
  jobs: Job[]; now: Date; role: EmployeeRole; call: QueueCall; onOpen: (id: string) => void
}) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ReviewData }>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  useEffect(() => {
    let alive = true
    loadReviews().then(
      data => { if (alive) setState({ status: 'ready', data }) },
      (e: unknown) => { if (alive) setState({ status: 'error', message: e instanceof Error ? e.message : thaiError(undefined) }) },
    )
    return () => { alive = false }
  }, [attempt])
  const canAck = role === 'manager' || role === 'owner'
  const noOf = (id: string) => jobs.find(j => j.id === id)?.no ?? 'งาน'
  const ack = async (kind: 'delay_report' | 'queue_event', ref: number, label: string) => {
    setBusy(`${kind}:${ref}`)
    const r = await call('ack_review', { p_kind: kind, p_ref: ref })
    setBusy(null)
    setNotice(r.ok ? { ok: true, text: `รับทราบ ${label} แล้ว` } : { ok: false, text: r.reason })
    if (r.ok) setAttempt(n => n + 1)
  }
  const ackButton = (kind: 'delay_report' | 'queue_event', ref: number, label: string) => canAck
    ? <button type="button" disabled={busy !== null} className={secondaryBtn} onClick={() => void ack(kind, ref, label)}>
        {busy === `${kind}:${ref}` ? 'กำลังบันทึก…' : 'รับทราบ'}
      </button>
    : null

  return (
    <>
      <p className="text-muted">รายการที่ผู้บริหารควรรู้ · กดรับทราบแล้วรายการหายไป งานไม่หยุดรอ</p>
      <NoticeLine notice={notice} />
      <IssuesView jobs={jobs} now={now} role={role} stations={null} call={call} onOpen={onOpen} heldOnly />
      {state.status === 'loading' && <Card className="p-5"><p role="status" className="text-muted">กำลังโหลดรายการ…</p></Card>}
      {state.status === 'error' && (
        <Card className="grid gap-3 p-5">
          <p role="alert" className="text-danger">โหลดรายการไม่สำเร็จ · {state.message}</p>
          <button type="button" className={secondaryBtn} onClick={() => { setState({ status: 'loading' }); setAttempt(n => n + 1) }}>ลองอีกครั้ง</button>
        </Card>
      )}
      {state.status === 'ready' && (() => {
        const { delayItems, queueItems, acks, names } = state.data
        const who = (id: string | null) => (id ? names.get(id) ?? 'ไม่ทราบชื่อ' : 'ระบบ')
        const delays = pendingReviews(delayItems, acks)
        const queue = pendingReviews(queueItems, acks)
        const at = (iso: string) => new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        return (
          <>
            <Section icon={IconClock} title="รายงานเกินเวลามาตรฐาน" count={delays.length} empty="ไม่มีรายงานรอรับทราบ" sub="14 วันล่าสุด · ที่ขอความช่วยเหลือขึ้นป้ายแดง">
              {delays.map(d => (
                <li key={d.ref} className="grid gap-2 rounded-xl border border-line bg-card p-3">
                  <button type="button" onClick={() => onOpen(d.jobId)} className="grid gap-0.5 text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <b className="text-lg">{noOf(d.jobId)}</b>
                      {d.station && <Pill tone="neutral">{STATION_NAME[d.station as StationCode] ?? d.station}</Pill>}
                      {d.needHelp && <Pill tone="danger">ขอความช่วยเหลือ</Pill>}
                      <span className="ml-auto text-sm text-muted">{at(d.at)} · {who(d.by)}</span>
                    </span>
                    <span>{d.reasons.join(' · ')} · {d.detail}</span>
                    <span className="text-sm text-muted">คาดว่าเสร็จใหม่ {at(d.newEta)}</span>
                    {d.needHelp && <span className="font-medium text-danger">ต้องการ: {d.needHelp}</span>}
                  </button>
                  {ackButton('delay_report', d.ref, `รายงาน ${noOf(d.jobId)}`)}
                </li>
              ))}
            </Section>
            <Section icon={IconLayers} title="แทรกคิว / เริ่มข้ามคิว" count={queue.length} empty="ไม่มีการเปลี่ยนคิวรอรับทราบ" sub="14 วันล่าสุด พร้อมเหตุผลที่คนกดใส่ไว้">
              {queue.map(q => (
                <li key={q.ref} className="grid gap-2 rounded-xl border border-line bg-card p-3">
                  <button type="button" onClick={() => onOpen(q.jobId)} className="grid gap-0.5 text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <b className="text-lg">{noOf(q.jobId)}</b>
                      <Pill tone={q.type === 'queue_insert' ? 'warn' : 'info'}>{q.type === 'queue_insert' ? 'แทรกคิวด่วน' : 'เริ่มข้ามคิว'}</Pill>
                      {q.station && <Pill tone="neutral">{STATION_NAME[q.station as StationCode] ?? q.station}</Pill>}
                      <span className="ml-auto text-sm text-muted">{at(q.at)} · {who(q.by)}</span>
                    </span>
                    {q.reason && <span>เหตุผล: {q.reason}</span>}
                  </button>
                  {ackButton('queue_event', q.ref, `${noOf(q.jobId)}`)}
                </li>
              ))}
            </Section>
          </>
        )
      })()}
    </>
  )
}
