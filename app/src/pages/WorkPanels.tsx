import { useId, useState, type ReactNode } from 'react'
import { Card, CardHeader, DueLabel, Pill, RouteBadge } from '../components/ui'
import { TONE } from '../components/tone'
import { IconClipboard, IconSewing } from '../components/icons'
import type { Job } from '../proto/model'
import { todoList } from '../proto/actions'
import {
  checkStartSewing, floorSummary, MACHINE_PREFIX, MACHINE_STATE_NAME, MACHINE_TYPE_NAME, MACHINE_TYPES, machineState, sewQueue, SEW_NEEDS,
  type Booking, type Machine, type MachineState, type MachineStatus,
} from '../proto/sewing'

// ต้องทำตอนนี้: 1 แถว = 1 งาน = 1 สิ่งที่ต้องทำ เรียงด่วนสุดก่อน
export function TodoPanel({ jobs, now, onOpen }: { jobs: Job[]; now: Date; onOpen: (id: string) => void }) {
  const list = todoList(jobs, now)
  const urgent = list.filter(a => a.tone === 'danger').length
  return (
    <Card>
      <CardHeader icon={IconClipboard} title="ต้องทำตอนนี้" tone={urgent ? 'danger' : 'brand'}
        sub={list.length ? `${list.length} งาน${urgent ? ` · ด่วน ${urgent} งาน` : ''} · เรียงด่วนสุดก่อน` : undefined} />
      {list.length === 0 ? (
        <p className="px-5 pb-5 text-muted">ไม่มีงานค้างในส่วนของคุณ</p>
      ) : (
        <ol className="divide-y divide-line border-t border-line">
          {list.map(a => (
            <li key={a.job.id}>
              <button onClick={() => onOpen(a.job.id)} className="flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-paper">
                <span className={`h-9 w-1 shrink-0 rounded-full ${TONE[a.tone].dot}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block font-semibold ${a.tone === 'danger' ? 'text-danger' : 'text-ink'}`}>{a.text}</span>
                  <span className="flex items-center gap-1.5 text-sm text-muted">
                    <span className="font-medium text-ink">{a.job.no}</span><RouteBadge route={a.job.route} />
                    <span className="truncate">{a.job.customer} · {a.job.qty.toLocaleString('th-TH')} {a.job.unit}</span>
                  </span>
                </span>
                <span className="text-sm"><DueLabel job={a.job} now={now} /></span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

// จักรเย็บ (S14): งานที่ถึงเฟส 2 แล้ว = รอเย็บ · กดเริ่มเย็บได้เมื่อจักรครบทุกชนิดว่างจริง (ฐานข้อมูลบังคับกฎเดียวกัน)
export function SewingFloor({ jobs, machines, bookings = [], now, onOpen, onStart, onStatus, booking }: {
  jobs: Job[]; machines: Machine[]; bookings?: Booking[]; now: Date; onOpen: (id: string) => void
  booking?: ReactNode  // แผงจองจักร (วางระหว่างคิวรอเย็บกับผังจักร)
  onStart?: (jobId: string) => { ok: true; picked: string[] } | { ok: false; reason: string }  // ไม่ส่ง = ดูอย่างเดียว
  onStatus?: OnStatus
}) {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const queue = sewQueue(jobs, machines)
    .map(q => ({ job: q.job, check: checkStartSewing(q.job, machines, SEW_NEEDS, bookings, now) }))
    .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || a.job.due.getTime() - b.job.due.getTime())
  const startable = queue.filter(q => q.check.ok).length
  const byJob = new Map(jobs.map(j => [j.id, j]))

  function start(job: Job) {
    if (!onStart) return
    const r = onStart(job.id)
    setNotice(r.ok
      ? { ok: true, text: `เริ่มเย็บ ${job.no} แล้ว · ใช้จักร ${r.picked.join(', ')}` }
      : { ok: false, text: `${job.no}: ${r.reason}` })
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Card>
        <CardHeader icon={IconSewing} tone={startable ? 'ok' : queue.length ? 'warn' : 'brand'}
          title={queue.length === 0 ? 'ยังไม่มีงานรอเย็บ' : `รอเย็บ ${queue.length} งาน · เริ่มได้ตอนนี้ ${startable} งาน`}
          sub="งานที่ส่งถึงสถานีเย็บแล้ว · กดเริ่มเย็บ ระบบเลือกจักรว่างให้ตามสินค้า · จักรไม่ว่างหรือเสีย = เริ่มไม่ได้" />
        {notice && (
          <p role={notice.ok ? 'status' : 'alert'} className={`mx-5 mb-3 rounded-xl px-3 py-2 font-medium ${notice.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
            {notice.text}
          </p>
        )}
        {queue.length > 0 && (
          <ol className="divide-y divide-line border-t border-line">
            {queue.map(({ job, check }) => (
              <li key={job.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <button onClick={() => onOpen(job.id)} className="min-w-0 flex-1 text-left">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Pill tone="warn" dot>รอเย็บ</Pill>
                    <span className="font-semibold">{job.no}</span><RouteBadge route={job.route} />
                    {job.phase === 'sample' && <Pill tone="info">ตัวอย่าง</Pill>}
                    <span className="text-sm"><DueLabel job={job} now={now} /></span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted">{job.customer} · {job.product} {job.qty.toLocaleString('th-TH')} {job.unit}</span>
                  {check.ok ? (
                    <span className="mt-1 block text-sm text-ok">จักรว่างพร้อม: {check.picked.map(m => m.code).join(' · ')}</span>
                  ) : (
                    <span className="mt-1 block text-sm text-danger">
                      <span className="font-semibold">{check.reason}</span>
                      {check.blockers.length > 0 && (
                        <span className="block text-muted">
                          {check.blockers.map(b => `${b.code} ${b.state === 'busy' ? `ใช้กับ ${(b.jobId && byJob.get(b.jobId)?.no) || 'งานอื่น'}`
                            : b.state === 'booked' ? `จองให้ ${(b.jobId && byJob.get(b.jobId)?.no) || 'งานอื่น'}${b.until ? ` ถึง ${b.until.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : ''}`
                            : b.state === 'broken' ? 'เสีย' : 'ปิด'}`).join(' · ')}
                        </span>
                      )}
                    </span>
                  )}
                </button>
                {onStart && (
                  <button onClick={() => start(job)} disabled={!check.ok}
                    title={check.ok ? undefined : check.reason}
                    className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
                    <IconSewing className="size-5" />{check.ok ? 'เริ่มเย็บ' : 'จักรไม่ว่าง'}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      {booking}
      <MachineBoard jobs={jobs} machines={machines} onOpen={onOpen} onStatus={onStatus} />
    </div>
  )
}

// สีตายตัวของสถานะจักร: เขียว = ว่าง · ฟ้า = ใช้อยู่ · แดง = เสีย · เทา = ปิดใช้งาน
const STATE_STYLE: Record<MachineState, { tile: string; badge: string; tone: 'ok' | 'info' | 'danger' | 'neutral' }> = {
  free: { tile: 'border-ok bg-ok-soft', badge: 'bg-ok text-white', tone: 'ok' },
  busy: { tile: 'border-info bg-info-soft', badge: 'bg-info text-white', tone: 'info' },
  broken: { tile: 'border-danger bg-danger-soft', badge: 'bg-danger text-white', tone: 'danger' },
  off: { tile: 'border-line bg-paper', badge: 'bg-muted text-white', tone: 'neutral' },
}
type StateFilter = 'all' | MachineState

// ผังจักรรายเครื่อง: 1 ช่อง = จักร 1 ตัว · มองแวบเดียวเห็นว่าตัวไหนว่าง ตัวไหนใช้กับงานอะไร
export type StatusResult = { ok: true; heldJob?: string } | { ok: false; reason: string }
type OnStatus = (code: string, status: MachineStatus, note: string) => StatusResult

function MachineBoard({ jobs, machines, onOpen, onStatus }: {
  jobs: Job[]; machines: Machine[]; onOpen: (id: string) => void
  onStatus?: OnStatus  // ไม่ส่ง = ดูอย่างเดียว (บทบาทที่แจ้งเสียไม่ได้)
}) {
  const [filter, setFilter] = useState<StateFilter>('all')
  const [reporting, setReporting] = useState<Machine | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const sum = floorSummary(machines)
  const byJob = new Map(jobs.map(j => [j.id, j]))
  const counts: Record<MachineState, number> = { free: sum.freeTotal, busy: sum.inUse, broken: sum.broken, off: sum.off }
  const shown = machines.filter(m => filter === 'all' || machineState(m) === filter)

  function change(m: Machine, status: MachineStatus, note = '') {
    if (!onStatus) return false
    const r = onStatus(m.code, status, note)
    if (!r.ok) {
      setNotice({ ok: false, text: r.reason })
      return false
    }
    const what = status === 'ready' ? (m.status === 'broken' ? 'ซ่อมเสร็จ พร้อมใช้' : 'เปิดใช้งานแล้ว') : status === 'broken' ? 'แจ้งเสียแล้ว' : 'ปิดใช้งานแล้ว'
    setNotice({ ok: true, text: `จักร ${m.code} ${what}${r.heldJob ? ` · พักงาน ${r.heldJob} อัตโนมัติ (เย็บต่อได้เมื่อจักรครบ)` : ''}` })
    return true
  }

  return (
    <Card>
      <CardHeader icon={IconSewing} title="จักรเย็บทุกตัว" sub={`ทั้งหมด ${sum.count} ตัว · กดตัวเลขเพื่อดูเฉพาะสถานะนั้น`} />
      <div className="grid grid-cols-3 gap-2 px-5 sm:grid-cols-5">
        <FilterCount label="ทั้งหมด" value={sum.count} tone="brand" active={filter === 'all'} onClick={() => setFilter('all')} />
        {/* ไม่มีจักรปิดใช้งาน = ไม่ต้องกินที่บนมือถือ */}
        {(['free', 'busy', 'broken', 'off'] as const).filter(st => st !== 'off' || sum.off > 0).map(st => (
          <FilterCount key={st} label={MACHINE_STATE_NAME[st]} value={counts[st]} tone={STATE_STYLE[st].tone}
            active={filter === st} onClick={() => setFilter(cur => (cur === st ? 'all' : st))} />
        ))}
      </div>
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={`mx-5 mt-3 rounded-xl px-3 py-2 font-medium ${notice.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          {notice.text}
        </p>
      )}

      <div className="mt-4 grid gap-5 px-5 pb-5">
        {MACHINE_TYPES.filter(t => shown.some(m => m.type === t)).map(t => (
          <section key={t}>
            <h4 className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
              <span className="rounded-md bg-brand px-1.5 py-0.5 font-mono text-sm text-white">{MACHINE_PREFIX[t]}</span>
              {MACHINE_TYPE_NAME[t]}
              <span className={`text-sm ${sum.free[t] === 0 ? 'text-danger' : 'text-ok'}`}>
                {sum.free[t] === 0 ? 'ไม่มีตัวว่าง' : `ว่าง ${sum.free[t]}`} จาก {sum.total[t]} ตัว
              </span>
            </h4>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {shown.filter(m => m.type === t).map(m => (
                <MachineTile key={m.id} machine={m} job={m.jobId ? byJob.get(m.jobId) : undefined} onOpen={onOpen}
                  onReport={onStatus ? () => { setNotice(null); setReporting(m) } : undefined}
                  onReady={onStatus ? () => change(m, 'ready') : undefined} />
              ))}
            </ul>
          </section>
        ))}
        {shown.length === 0 && <p className="text-muted">ไม่มีจักรที่{filter === 'all' ? 'บันทึกไว้' : MACHINE_STATE_NAME[filter]}</p>}
      </div>

      {reporting && (
        <ReportDialog machine={reporting} job={reporting.jobId ? byJob.get(reporting.jobId) : undefined}
          onCancel={() => setReporting(null)}
          onSubmit={(status, note) => { if (change(reporting, status, note)) setReporting(null) }} />
      )}
    </Card>
  )
}

function MachineTile({ machine: m, job, onOpen, onReport, onReady }: {
  machine: Machine; job?: Job; onOpen: (id: string) => void; onReport?: () => void; onReady?: () => void
}) {
  const state = machineState(m)
  const st = STATE_STYLE[state]
  const head = (
    <span className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-lg font-bold tracking-tight text-ink">
        <IconSewing className="size-5 shrink-0 text-muted" />{m.code}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${st.badge}`}>{MACHINE_STATE_NAME[state]}</span>
    </span>
  )
  return (
    <li className={`flex min-h-20 min-w-0 flex-col rounded-xl border-2 p-2.5 ${st.tile}`}>
      {state === 'busy' && job ? (
        <button onClick={() => onOpen(job.id)} className="min-w-0 text-left" aria-label={`จักร ${m.code} ใช้อยู่กับงาน ${job.no} กดเพื่อดูงาน`}>
          {head}
          <span className="mt-1 block min-w-0 text-sm leading-snug">
            <span className="font-semibold text-info">{job.no}</span>
            <span className="block truncate text-muted">{job.customer}</span>
          </span>
        </button>
      ) : (
        <div className="min-w-0">
          {head}
          <span className={`mt-1 block text-sm ${state === 'broken' ? 'font-medium text-danger' : 'text-muted'}`}>
            {state === 'free' ? 'พร้อมรับงาน' : state === 'broken' ? (m.note ? `อาการ: ${m.note}` : 'รอซ่อม') : 'ไม่ได้ใช้'}
          </span>
        </div>
      )}
      {(state === 'free' || state === 'busy') && onReport && (
        <button onClick={onReport} className="mt-2 min-h-11 rounded-lg border border-danger/40 bg-white px-2 text-sm font-semibold text-danger hover:bg-danger-soft">
          แจ้งเสีย
        </button>
      )}
      {(state === 'broken' || state === 'off') && onReady && (
        <button onClick={onReady} className="mt-2 min-h-11 rounded-lg bg-ok px-2 text-sm font-semibold text-white hover:opacity-90">
          {state === 'broken' ? 'ซ่อมเสร็จ' : 'เปิดใช้งาน'}
        </button>
      )}
    </li>
  )
}

// อาการที่เจอบ่อย กดเลือกได้เลยบนแท็บเล็ต (พิมพ์เพิ่มเองได้)
const COMMON_FAULTS = ['ด้ายพัน', 'เข็มหัก', 'ฝีเข็มกระโดด', 'มอเตอร์ไม่หมุน', 'น้ำมันรั่ว', 'ตีนผีเสีย']

function ReportDialog({ machine: m, job, onCancel, onSubmit }: {
  machine: Machine; job?: Job; onCancel: () => void; onSubmit: (status: MachineStatus, note: string) => void
}) {
  const [note, setNote] = useState('')
  const id = useId()
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/35 p-4 backdrop-blur-[2px] sm:items-center" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lift">
        <h3 id={`${id}-t`} className="flex items-center gap-2 text-xl font-bold text-danger">
          <IconSewing className="size-6" />แจ้งจักร {m.code} เสีย
        </h3>
        <p className="mt-1 text-sm text-muted">{MACHINE_TYPE_NAME[m.type]}</p>
        {job && (
          <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-warn">
            จักรนี้ใช้กับงาน <b>{job.no}</b> อยู่ · งานจะถูก<b>พักอัตโนมัติ</b> และเย็บต่อได้เมื่อมีจักรครบ
          </p>
        )}
        <label htmlFor={`${id}-n`} className="mt-4 block font-medium">อาการ (ต้องกรอก)</label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {COMMON_FAULTS.map(f => (
            <button key={f} type="button" onClick={() => setNote(f)} aria-pressed={note === f}
              className={`min-h-10 rounded-full border px-3 text-sm ${note === f ? 'border-danger bg-danger-soft font-semibold text-danger' : 'border-line text-ink hover:bg-paper'}`}>
              {f}
            </button>
          ))}
        </div>
        <textarea id={`${id}-n`} value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="หรือพิมพ์อาการเอง"
          className="mt-2 w-full rounded-xl border border-line px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-brand" />
        <div className="mt-4 grid gap-2">
          <button type="button" disabled={!note.trim()} onClick={() => onSubmit('broken', note)}
            className="min-h-12 rounded-xl bg-danger px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
            {note.trim() ? 'ยืนยันแจ้งเสีย' : 'เลือกหรือพิมพ์อาการก่อน'}
          </button>
          <button type="button" onClick={() => onSubmit('off', note)}
            className="min-h-12 rounded-xl border border-line px-4 font-semibold text-ink hover:bg-paper">
            ไม่ได้เสีย แค่ปิดใช้งาน
          </button>
          <button type="button" onClick={onCancel} className="min-h-12 rounded-xl px-4 font-semibold text-muted hover:bg-paper">ยกเลิก</button>
        </div>
      </div>
    </div>
  )
}

function FilterCount({ label, value, tone, active, onClick }: {
  label: string; value: number; tone: 'ok' | 'info' | 'danger' | 'neutral' | 'brand'; active: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`min-h-14 rounded-xl px-3 py-2 text-left transition ${TONE[value === 0 && tone !== 'brand' ? 'neutral' : tone].soft} ${active ? 'ring-2 ring-brand ring-offset-1' : ''}`}>
      <span className="block text-sm">{label}</span>
      <span className="block text-2xl leading-tight font-bold tabular-nums">{value}</span>
    </button>
  )
}
