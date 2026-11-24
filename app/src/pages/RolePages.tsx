import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { canCloseIssue, type EmployeeRole } from '../auth/access'
import { Card, CardHeader, DueLabel, MockupThumb, Pill } from '../components/ui'
import { dangerBtn, fieldClass, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconAlert, IconChevronRight, IconClock, IconFlag, IconLayers } from '../components/icons'
import { eventWords, type EventRow } from '../data/history'
import { Tr } from '../i18n/Tr'
import { useLang, useT, type Word } from '../i18n/lang'
import { thaiError } from '../data/live'
import { supabase } from '../lib/supabase'
import { durationWord } from '../proto/format'
import { SLA_LABEL, STATION_NAME, STATUS_NAME, type Job, type StationCode } from '../proto/model'
import { problemLists, queueBoard, reportable } from '../proto/rolePages'
import { pendingReviews } from '../proto/admin'
import { loadReviews } from './admin/data'
import type { QueueCall } from './StationQueue'

type Notice = { ok: boolean; text: Word } | null

function JobRow({ job: j, now, onOpen, children }: { job: Job; now: Date; onOpen: (id: string) => void; children?: ReactNode }) {
  const t = useT()
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-card p-3">
      <button type="button" onClick={() => onOpen(j.id)} className="flex min-w-0 items-start gap-3 text-left" aria-label={t('ดูรายละเอียดงาน {no}', { no: j.no })}>
        <MockupThumb job={j} />
        <span className="grid min-w-0 flex-1 grid-cols-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-lg">{j.no}</b>
            {j.station && <Pill tone="neutral">{t(STATION_NAME[j.station])}</Pill>}
            {j.status && <Pill tone={j.status === 'hold' ? 'danger' : j.status === 'doing' ? 'info' : 'neutral'}>{t(STATUS_NAME[j.status])}</Pill>}
            {j.rework && <Pill tone="danger">{t('งานแก้ {qty} {unit}', { qty: j.rework.qty, unit: { th: j.unit } })}</Pill>}
            {j.sla && <Pill tone={SLA_LABEL[j.sla].tone}>{t(SLA_LABEL[j.sla].text)}</Pill>}
            <IconChevronRight className="ml-auto size-5 text-muted" />
          </span>
          <span className="truncate">{j.customer} · {j.product} {j.qty.toLocaleString('th-TH')} {t(j.unit)}</span>
          <span className="text-sm"><DueLabel job={j} now={now} /></span>
          {j.holdReason && <span className="font-medium text-danger">{t('สาเหตุ: {reason}', { reason: j.holdReason })}</span>}
          {j.rework && <span className="font-medium text-danger">{t('ต้องแก้: {note}', { note: j.rework.reason })}</span>}
        </span>
      </button>
      {children}
    </li>
  )
}

function Section({ icon, title, sub, empty, children, count }: {
  icon: typeof IconAlert; title: string; sub?: string; empty: string; children: ReactNode; count: number
}) {
  const t = useT()
  return (
    <Card>
      <CardHeader icon={icon} title={<Tr inline th="{title} ({n})" vars={{ title: { th: title }, n: count }} />} sub={sub && t(sub)} tone={count ? 'danger' : 'ok'} />
      <div className="px-4 pb-4">{count ? <ul className="grid gap-2">{children}</ul> : <p className="text-muted"><Tr th={empty} /></p>}</div>
    </Card>
  )
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null
  return <p role={notice.ok ? 'status' : 'alert'} className={`rounded-xl px-3 py-2 font-medium ${notice.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}><Tr th={notice.text.th} vars={notice.text.vars} /></p>
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
    setNotice(r.ok ? { ok: true, text: { th: sew ? '{no} เย็บต่อแล้ว' : '{no} แก้แล้ว · ถ้าเครื่องเต็ม งานกลับเข้าคิวรอเริ่ม', vars: { no: j.no } } } : { ok: false, text: { th: '{no}: {reason}', vars: { no: j.no, reason: { th: r.reason } } } })
  }
  return (
    <>
      <NoticeLine notice={notice} />
      <Section icon={IconAlert} title="ติดปัญหา / พักงาน" count={held.length} empty="ไม่มีงานติดปัญหา"
        sub="เรียงตามเวลาที่พักนานสุดก่อน · แก้แล้วกดให้สถานีทำต่อ">
        {held.map(j => (
          <JobRow key={j.id} job={j} now={now} onOpen={onOpen}>
            <p className="text-sm text-muted"><Tr th="พักมา {time}" vars={{ time: durationWord(now.getTime() - (j.heldSince ?? j.since).getTime()) }} /></p>
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
  const t = useT()
  if (!stations.length) {
    return <Card className="p-5"><p className="font-semibold"><Tr th="ยังไม่ได้จับคู่สถานี" /></p><p className="text-muted"><Tr th="ให้เจ้าของระบบจับคู่สถานีให้ที่เมนู Station Assignment" /></p></Card>
  }
  const send = async (j: Job) => {
    setBusy(true)
    const r = await call('open_issue', { p_job: j.id, p_reason: reason.trim() })
    setBusy(false)
    if (r.ok) { setOpen(null); setReason(''); setNotice({ ok: true, text: { th: 'แจ้งปัญหา {no} แล้ว · งานพักไว้รอฝ่ายผลิตแก้', vars: { no: j.no } } }) }
    else setNotice({ ok: false, text: { th: '{no}: {reason}', vars: { no: j.no, reason: { th: r.reason } } } })
  }
  return (
    <>
      <NoticeLine notice={notice} />
      <Card>
        <CardHeader icon={IconFlag} title={<Tr inline th="เลือกงานที่มีปัญหา" />} sub={t('งานที่สถานี{stations} · แจ้งแล้วงานจะพักจนฝ่ายผลิตกดแก้แล้ว', { stations: stations.map(s => ({ th: STATION_NAME[s] })) })} />
        <div className="px-4 pb-4">
          {list.length === 0 ? <p className="text-muted"><Tr th="ไม่มีงานที่สถานีของคุณตอนนี้" /></p> : (
            <ul className="grid gap-2">
              {list.map(j => (
                <JobRow key={j.id} job={j} now={now} onOpen={onOpen}>
                  {open === j.id ? (
                    <div className="grid gap-2 rounded-xl bg-danger-soft p-3">
                      <label className="grid gap-1 font-semibold text-danger"><Tr th="ปัญหาคืออะไร (ต้องกรอก)" />
                        <input value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} placeholder={t('เช่น ผ้าไม่พอ เครื่องเสีย สีเพี้ยน')} />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" disabled={busy || !reason.trim()} className={dangerBtn} onClick={() => void send(j)}>
                          <Tr th={busy ? 'กำลังบันทึก…' : reason.trim() ? 'แจ้งปัญหา' : 'กรอกปัญหาก่อน'} />
                        </button>
                        <button type="button" disabled={busy} className={secondaryBtn} onClick={() => { setOpen(null); setReason('') }}><Tr th="ยกเลิก" /></button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className={dangerBtn} disabled={open !== null} onClick={() => { setOpen(j.id); setReason('') }}><IconFlag className="size-5 shrink-0" /><Tr th="แจ้งปัญหา" /></button>
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
  const t = useT()
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
      {rows.map(r => {
        const total = r.doing.length + r.waiting.length + r.hold.length + r.out.length
        return (
          <Card key={r.station}>
            <CardHeader icon={IconLayers} title={<Tr inline th={r.name} />}
              sub={total ? [t('ทำอยู่ {n}', { n: r.doing.length }), t('รอคิว {n}', { n: r.waiting.length }), r.hold.length && t('ติดปัญหา {n}', { n: r.hold.length }), r.out.length && t('ข้างนอก {n}', { n: r.out.length })].filter(Boolean).join(' · ') : t('ว่าง')}
              right={<a href={`#/board?station=${r.station}`} className="inline-flex min-h-12 items-center text-sm font-semibold text-brand">{t('เปิดคิว')}</a>} />
            {total > 0 && (
              <ol className="grid grid-cols-[minmax(0,1fr)] gap-1 px-4 pb-4">
                {[...r.doing, ...r.hold, ...r.waiting, ...r.out].map(j => {
                  const pos = r.waiting.indexOf(j)
                  return (
                    <li key={j.id}>
                      <button type="button" onClick={() => onOpen(j.id)} className="flex min-h-12 w-full items-center gap-2 rounded-xl px-2 text-left hover:bg-paper">
                        <span className="w-8 shrink-0 text-center font-bold text-muted tabular-nums">{pos >= 0 ? pos + 1 : ''}</span>
                        <b className="shrink-0">{j.no}</b>
                        <span className="min-w-0 flex-1 truncate text-muted">{j.customer}</span>
                        {j.status && j.status !== 'queued' && <Pill tone={j.status === 'hold' ? 'danger' : 'info'}>{t(STATUS_NAME[j.status])}</Pill>}
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
  const t = useT()
  const lang = useLang()
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

  if (state.status === 'loading') return <Card className="p-5"><p role="status" className="text-muted"><Tr th="กำลังโหลดประวัติ…" /></p></Card>
  if (state.status === 'error') {
    return (
      <Card className="grid gap-3 p-5">
        <p role="alert" className="text-danger"><Tr th="โหลดประวัติไม่สำเร็จ · {reason}" vars={{ reason: { th: state.message } }} /></p>
        <button type="button" className={secondaryBtn} onClick={() => { setState({ status: 'loading' }); setAttempt(n => n + 1) }}><Tr th="ลองอีกครั้ง" /></button>
      </Card>
    )
  }
  const names = { station: (code: string) => STATION_NAME[code as StationCode] ?? code, step: (_station: string, key: string) => key }
  const byDay = new Map<string, MyEvent[]>()
  for (const e of state.rows) {
    const day = new Date(e.at).toLocaleDateString(lang === 'my' ? 'en-GB' : 'th-TH', { timeZone: 'Asia/Bangkok', weekday: lang === 'my' ? undefined : 'long', day: 'numeric', month: lang === 'my' ? 'numeric' : 'short' })
    byDay.set(day, [...(byDay.get(day) ?? []), e])
  }
  if (!state.rows.length) return <Card className="p-5"><p className="text-muted"><Tr th="ยังไม่มีงานที่คุณกดใน {n} วันที่ผ่านมา" vars={{ n: HISTORY_DAYS }} /></p></Card>
  return (
    <>
      {[...byDay].map(([day, rows]) => (
        <Card key={day}>
          <CardHeader icon={IconClock} title={day} sub={t('{n} รายการ', { n: rows.length })} />
          <ul className="grid gap-1 px-4 pb-4">
            {rows.map(e => {
              const job = jobs.find(j => j.id === e.job_id)
              const line = eventWords(e, names, job?.unit)
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpen(e.job_id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-paper">
                    <span className="w-14 shrink-0 text-sm text-muted tabular-nums">
                      {new Date(e.at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <b className="shrink-0">{job?.no ?? t('งาน')}</b>
                    <span className="min-w-0 flex-1"><Tr th={line.title.th} vars={line.title.vars} />{line.detail && <span className="block text-sm text-muted">{t(line.detail.th, line.detail.vars)}</span>}</span>
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
    setNotice(r.ok ? { ok: true, text: { th: `รับทราบ ${label} แล้ว` } } : { ok: false, text: { th: r.reason } })
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
