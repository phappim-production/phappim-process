import { useId, useState, type ReactNode } from 'react'
import { Card, CardHeader, DueLabel, Pill, RouteBadge, ViewSwitch } from '../components/ui'
import { TONE } from '../components/tone'
import { IconClipboard, IconClock, IconSewing } from '../components/icons'
import type { Job } from '../proto/model'
import { todoList } from '../proto/actions'
import {
  bookedByOther, checkStartSewing, floorSummary, repairEtaProblem, repairStatus, MACHINE_PREFIX, MACHINE_STATE_NAME, MACHINE_TYPE_NAME, MACHINE_TYPES, machineState, sewQueue, type Need,
  type Booking, type Machine, type MachineState, type MachineStatus,
} from '../proto/sewing'

// ต้องทำตอนนี้: 1 แถว = 1 งาน = 1 สิ่งที่ต้องทำ เรียงด่วนสุดก่อน
export function TodoPanel({ jobs, now, onOpen }: { jobs: Job[]; now: Date; onOpen: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
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
          {(expanded ? list : list.slice(0, 6)).map(a => (
            <li key={a.job.id}>
              <button onClick={() => onOpen(a.job.id)} className="flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-paper">
                <span className={`h-9 w-1 shrink-0 rounded-full ${TONE[a.tone].dot}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block font-semibold ${a.tone === 'danger' ? 'text-danger' : 'text-ink'}`}>{a.text}</span>
                  <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted">
                    <span className="font-medium text-ink">{a.job.no}</span><RouteBadge route={a.job.route} />
                    {a.job.rework && <Pill tone="danger">งานแก้ {a.job.rework.qty.toLocaleString('th-TH')}</Pill>}
                    <span className="min-w-0 truncate">{a.job.customer}</span>
                  </span>
                </span>
                <span className="text-sm"><DueLabel job={a.job} now={now} /></span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {list.length > 6 && (
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}
          className="min-h-12 w-full border-t border-line px-5 font-semibold text-brand hover:bg-paper">
          {expanded ? 'แสดงน้อยลง' : `ดูอีก ${list.length - 6} งาน`}
        </button>
      )}
    </Card>
  )
}

const SEWING_VIEWS = [
  ['work', 'งานเย็บ'],
  ['booking', 'ตารางจอง'],
  ['machines', 'สถานะจักร'],
] as const

// จักรเย็บ (S14): งานที่ถึงเฟส 2 แล้ว = รอเย็บ · กดเริ่มเย็บได้เมื่อจักรครบทุกชนิดว่างจริง (ฐานข้อมูลบังคับกฎเดียวกัน)
export type SewingView = (typeof SEWING_VIEWS)[number][0]

export function SewingFloor({ jobs, machines, bookings = [], needs, now, onOpen, onStart, onStatus, onEta, booking, sewing, initialView }: {
  jobs: Job[]; machines: Machine[]; bookings?: Booking[]; needs: Record<string, Need[]>; now: Date; onOpen: (id: string) => void
  booking?: ReactNode  // แผงจองจักร (วางระหว่างคิวรอเย็บกับผังจักร)
  sewing?: ReactNode   // แผงกำลังเย็บ (ต่อจากคิวรอเย็บ: รอเย็บ → กำลังเย็บ → เย็บเสร็จ)
  onStart?: (jobId: string) => Promise<{ ok: true; picked: string[] } | { ok: false; reason: string }>  // ไม่ส่ง = ดูอย่างเดียว
  onStatus?: OnStatus
  onEta?: OnEta
  initialView?: SewingView  // มาจากการกดตัวเลขสรุป เช่น จักรเสีย → สถานะจักร
}) {
  const [view, setView] = useState<SewingView>(
    () => initialView ?? (onStart ? 'work' : onEta && booking ? 'booking' : 'machines'),
  )
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const queue = sewQueue(jobs, machines)
    .map(q => ({ job: q.job, check: checkStartSewing(q.job, machines, needs, bookings, now) }))
    .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || a.job.due.getTime() - b.job.due.getTime())
  const startable = queue.filter(q => q.check.ok).length
  const byJob = new Map(jobs.map(j => [j.id, j]))

  const [starting, setStarting] = useState<string | null>(null)
  async function start(job: Job) {
    if (!onStart || starting) return
    setStarting(job.id)
    const r = await onStart(job.id)
    setStarting(null)
    setNotice(r.ok
      ? { ok: true, text: `เริ่มเย็บ ${job.no} แล้ว · ใช้จักร ${r.picked.join(', ')}` }
      : { ok: false, text: `${job.no}: ${r.reason}` })
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <ViewSwitch variant="sub" label="มุมมองจักรเย็บ" value={view} onChange={setView} options={SEWING_VIEWS} />
      <section hidden={view !== 'work'}>
        <div className="grid gap-4">
          {sewing}
          <Card>
            <CardHeader icon={IconSewing} tone={startable ? 'ok' : queue.length ? 'warn' : 'brand'}
              title={queue.length === 0 ? 'ยังไม่มีงานรอเย็บ' : `รอเย็บ ${queue.length} งาน · เริ่มได้ตอนนี้ ${startable} งาน`}
              sub={startable ? 'เลือกงานที่จักรพร้อมเพื่อเริ่มเย็บ' : undefined} />
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
                        {job.rework && <Pill tone="danger">งานแก้ {job.rework.qty.toLocaleString('th-TH')}</Pill>}
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
                      <button onClick={() => void start(job)} disabled={!check.ok || starting !== null}
                        title={check.ok ? undefined : check.reason}
                        className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted ">
                        <IconSewing className="size-5" />{check.ok ? 'เริ่มเย็บ' : 'จักรไม่ว่าง'}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </section>
      <section hidden={view !== 'booking'}>{booking}</section>
      <section hidden={view !== 'machines'}>
        <MachineBoard jobs={jobs} machines={machines} bookings={bookings} now={now} onOpen={onOpen} onStatus={onStatus} onEta={onEta} />
      </section>
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
type OnStatus = (code: string, status: MachineStatus, note: string, repairEta?: Date) => Promise<StatusResult>
type OnEta = (code: string, eta: Date) => Promise<StatusResult>

function MachineBoard({ jobs, machines, bookings = [], now, onOpen, onStatus, onEta }: {
  jobs: Job[]; machines: Machine[]; bookings?: Booking[]; now: Date; onOpen: (id: string) => void
  onStatus?: OnStatus  // ไม่ส่ง = ดูอย่างเดียว (บทบาทที่แจ้งเสียไม่ได้)
  onEta?: OnEta        // ส่งเฉพาะฝ่ายผลิต / owner = กำหนดกรอบเวลาซ่อมได้
}) {
  const [filter, setFilter] = useState<StateFilter>('all')
  const [machineQuery, setMachineQuery] = useState('')
  const [reporting, setReporting] = useState<Machine | null>(null)
  const [etaFor, setEtaFor] = useState<Machine | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const sum = floorSummary(machines)
  const byJob = new Map(jobs.map(j => [j.id, j]))
  const counts: Record<MachineState, number> = { free: sum.freeTotal, busy: sum.inUse, broken: sum.broken, off: sum.off }
  const term = machineQuery.trim().toLowerCase()
  const shown = machines.filter(m => (filter === 'all' || machineState(m) === filter)
    && (!term || `${m.code} ${MACHINE_TYPE_NAME[m.type]}`.toLowerCase().includes(term)))

  async function change(m: Machine, status: MachineStatus, note = '', eta?: Date) {
    if (!onStatus) return false
    const r = await onStatus(m.code, status, note, eta)
    if (!r.ok) {
      setNotice({ ok: false, text: r.reason })
      return false
    }
    const what = status === 'ready' ? (m.status === 'broken' ? 'ซ่อมเสร็จ พร้อมใช้' : 'เปิดใช้งานแล้ว') : status === 'broken' ? 'แจ้งเสียแล้ว' : 'ปิดใช้งานแล้ว'
    setNotice({ ok: true, text: `จักร ${m.code} ${what}${eta ? ` · คาดว่าซ่อมเสร็จ ${when(eta)}` : ''}${r.heldJob ? ` · พักงาน ${r.heldJob} อัตโนมัติ (เย็บต่อได้เมื่อจักรครบ)` : ''}` })
    return true
  }
  async function setEta(m: Machine, eta: Date) {
    if (!onEta) return false
    const r = await onEta(m.code, eta)
    setNotice(r.ok ? { ok: true, text: `จักร ${m.code} คาดว่าซ่อมเสร็จ ${when(eta)}` } : { ok: false, text: r.reason })
    return r.ok
  }

  return (
    <Card>
      <CardHeader icon={IconSewing} title="สถานะจักรเย็บ" />
      <div className="px-5 pb-3">
        <input type="search" aria-label="ค้นหาจักร" placeholder="รหัสจักรหรือชนิดจักร" value={machineQuery}
          onChange={e => setMachineQuery(e.target.value)} className="min-h-12 w-full rounded-xl border border-line px-3 sm:w-80" />
      </div>
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
                <MachineTile key={m.id} machine={m} job={m.jobId ? byJob.get(m.jobId) : undefined} now={now} onOpen={onOpen}
                  reservedFor={(() => { const b = bookedByOther(m.id, now, new Date(now.getTime() + 60_000), bookings); return b ? { no: byJob.get(b.jobId)?.no ?? 'งานอื่น', until: b.ends } : undefined })()}
                  onReport={onStatus ? () => { setNotice(null); setReporting(m) } : undefined}
                  onReady={onStatus ? () => void change(m, 'ready') : undefined}
                  onEta={onEta ? () => { setNotice(null); setEtaFor(m) } : undefined} />
              ))}
            </ul>
          </section>
        ))}
        {shown.length === 0 && <p className="text-muted">{term ? 'ไม่พบจักรตามที่ค้นหา' : `ไม่มีจักรที่${filter === 'all' ? 'บันทึกไว้' : MACHINE_STATE_NAME[filter]}`}</p>}
      </div>

      {reporting && (
        <ReportDialog machine={reporting} job={reporting.jobId ? byJob.get(reporting.jobId) : undefined} now={now} etaRequired={!!onEta}
          onCancel={() => setReporting(null)}
          onSubmit={async (status, note, eta) => { if (await change(reporting, status, note, eta)) setReporting(null) }} />
      )}
      {etaFor && (
        <Modal title={`กำหนดเวลาซ่อม ${etaFor.code}`} tone="warn" onClose={() => setEtaFor(null)}>
          <EtaForm now={now} initial={etaFor.repairEta} submitLabel={etaFor.repairEta ? 'บันทึกเวลาใหม่' : 'บันทึกเวลาซ่อม'}
            onCancel={() => setEtaFor(null)} onSubmit={async eta => { if (await setEta(etaFor, eta)) setEtaFor(null) }} />
        </Modal>
      )}
    </Card>
  )
}

const when = (d: Date) => d.toLocaleString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function MachineTile({ machine: m, job, now, onOpen, onReport, onReady, onEta, reservedFor }: {
  machine: Machine; job?: Job; now: Date; reservedFor?: { no: string; until: Date }; onOpen: (id: string) => void; onReport?: () => void; onReady?: () => void; onEta?: () => void
}) {
  const state = machineState(m)
  const st = STATE_STYLE[state]
  const repair = repairStatus(m, now)
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
          {state === 'free' && reservedFor && (
            <span className="mt-1 block text-sm font-semibold text-warn">
              จองให้ {reservedFor.no} ถึง {reservedFor.until.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {repair && (
            <span className={`mt-1 flex items-center gap-1 text-sm font-semibold ${repair.tone === 'danger' ? 'text-danger' : 'text-warn'}`}>
              <IconClock className="size-4 shrink-0" />{repair.text}
            </span>
          )}
        </div>
      )}
      {(state === 'free' || state === 'busy') && onReport && (
        <button onClick={onReport} className="mt-2 min-h-11 rounded-lg border border-danger/40 bg-card px-2 text-sm font-semibold text-danger hover:bg-danger-soft">
          แจ้งเสีย
        </button>
      )}
      {state === 'broken' && onEta && (
        <button onClick={onEta} className="mt-2 min-h-11 rounded-lg border border-warn/50 bg-card px-2 text-sm font-semibold text-warn hover:bg-warn-soft">
          {m.repairEta ? 'เลื่อนเวลาซ่อม' : 'กำหนดเวลาซ่อม'}
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

function Modal({ title, tone, onClose, children }: { title: string; tone: 'danger' | 'warn'; onClose: () => void; children: ReactNode }) {
  const id = useId()
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} onClick={e => e.stopPropagation()}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5 shadow-lift">
        <h3 id={id} className={`flex items-center gap-2 text-xl font-bold ${tone === 'danger' ? 'text-danger' : 'text-warn'}`}>
          <IconSewing className="size-6" />{title}
        </h3>
        {children}
      </div>
    </div>
  )
}

// เลือกเวลาซ่อมเสร็จ: ปุ่มลัดสำหรับแท็บเล็ต + เลือกวันเวลาเองได้
function EtaPicker({ value, onChange, now }: { value?: Date; onChange: (d?: Date) => void; now: Date }) {
  const id = useId()
  const pad = (n: number) => String(n).padStart(2, '0')
  const tomorrow8 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getDay() === 6 ? 2 : 1), 8)
  const quick: [string, Date][] = [
    ['1 ชั่วโมง', new Date(now.getTime() + 3_600_000)],
    ['3 ชั่วโมง', new Date(now.getTime() + 3 * 3_600_000)],
    ['เย็นนี้ 17:00', new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17)],
    ['พรุ่งนี้ 08:00', tomorrow8],
  ].filter(([, d]) => (d as Date) > now) as [string, Date][]
  const date = value ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : ''
  const time = value ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : ''
  const set = (d: string, t: string) => onChange(d && t ? new Date(`${d}T${t}`) : undefined)
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">
        {quick.map(([label, d]) => (
          <button key={label} type="button" onClick={() => onChange(d)} aria-pressed={value?.getTime() === d.getTime()}
            className={`min-h-10 rounded-xl border px-3 text-sm ${value?.getTime() === d.getTime() ? 'border-warn bg-warn-soft font-semibold text-warn' : 'border-line text-ink hover:bg-paper'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input id={`${id}-d`} type="date" aria-label="วันที่ซ่อมเสร็จ" value={date} onChange={e => set(e.target.value, time || '17:00')}
          className="min-h-12 w-full rounded-xl border border-line px-3 text-base" />
        <input type="time" aria-label="เวลาซ่อมเสร็จ" value={time} onChange={e => set(date || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, e.target.value)}
          className="min-h-12 w-full rounded-xl border border-line px-3 text-base" />
      </div>
    </div>
  )
}

function EtaForm({ now, initial, submitLabel, onCancel, onSubmit }: {
  now: Date; initial?: Date; submitLabel: string; onCancel: () => void; onSubmit: (eta: Date) => void
}) {
  const [eta, setEta] = useState<Date | undefined>(initial)
  const problem = repairEtaProblem(eta, now)
  return (
    <>
      <p className="mt-3 font-medium">คาดว่าซ่อมเสร็จเมื่อไร</p>
      <EtaPicker value={eta} onChange={setEta} now={now} />
      {eta && problem && <p role="alert" className="mt-2 text-danger">{problem}</p>}
      <div className="mt-4 grid gap-2">
        <button type="button" disabled={!!problem} onClick={() => eta && onSubmit(eta)}
          className="min-h-12 rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted ">
          {problem && !eta ? 'เลือกเวลาซ่อมเสร็จก่อน' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="min-h-12 rounded-xl px-4 font-semibold text-muted hover:bg-paper">ยกเลิก</button>
      </div>
    </>
  )
}

// อาการที่เจอบ่อย กดเลือกได้เลยบนแท็บเล็ต (พิมพ์เพิ่มเองได้)
const COMMON_FAULTS = ['ด้ายพัน', 'เข็มหัก', 'ฝีเข็มกระโดด', 'มอเตอร์ไม่หมุน', 'น้ำมันรั่ว', 'ตีนผีเสีย']

function ReportDialog({ machine: m, job, now, etaRequired, onCancel, onSubmit }: {
  machine: Machine; job?: Job; now: Date; etaRequired: boolean; onCancel: () => void
  onSubmit: (status: MachineStatus, note: string, eta?: Date) => void
}) {
  const [note, setNote] = useState('')
  const [eta, setEta] = useState<Date | undefined>()
  const id = useId()
  const etaProblem = etaRequired ? repairEtaProblem(eta, now) : null
  const blocked = !note.trim() ? 'เลือกหรือพิมพ์อาการก่อน' : etaProblem && !eta ? 'กำหนดเวลาซ่อมเสร็จก่อน' : etaProblem
  return (
    <Modal title={`แจ้งจักร ${m.code} เสีย`} tone="danger" onClose={onCancel}>
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
            className={`min-h-10 rounded-xl border px-3 text-sm ${note === f ? 'border-danger bg-danger-soft font-semibold text-danger' : 'border-line text-ink hover:bg-paper'}`}>
            {f}
          </button>
        ))}
      </div>
      <textarea id={`${id}-n`} value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="หรือพิมพ์อาการเอง"
        className="mt-2 w-full rounded-xl border border-line px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-brand" />
      {etaRequired ? (
        <>
          <p className="mt-4 font-medium">คาดว่าซ่อมเสร็จเมื่อไร (ต้องกรอก)</p>
          <EtaPicker value={eta} onChange={setEta} now={now} />
          {eta && etaProblem && <p role="alert" className="mt-2 text-danger">{etaProblem}</p>}
        </>
      ) : (
        <p className="mt-4 rounded-xl bg-paper px-3 py-2 text-sm text-muted">ฝ่ายผลิตจะเป็นผู้กำหนดเวลาซ่อมเสร็จ</p>
      )}
      <div className="mt-4 grid gap-2">
        <button type="button" disabled={!!blocked} onClick={() => onSubmit('broken', note, etaRequired ? eta : undefined)}
          className="min-h-12 rounded-xl bg-danger px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-muted ">
          {blocked || 'ยืนยันแจ้งเสีย'}
        </button>
        <button type="button" onClick={() => onSubmit('off', note)}
          className="min-h-12 rounded-xl border border-line px-4 font-semibold text-ink hover:bg-paper">
          ไม่ได้เสีย แค่ปิดใช้งาน
        </button>
        <button type="button" onClick={onCancel} className="min-h-12 rounded-xl px-4 font-semibold text-muted hover:bg-paper">ยกเลิก</button>
      </div>
    </Modal>
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
