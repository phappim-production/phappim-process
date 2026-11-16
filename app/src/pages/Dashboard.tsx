import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { makeMockBookings, makeMockJobs, makeMockMachines } from '../proto/mockJobs'
import {
  COLUMNS, DEPT_NAME, ROUTES, STATION_NAME, STATUS_NAME,
  columnOf, isDoneToday, isFilmLate, isOverdue, isWaitingFilm, missingDepts,
  type ColumnKey, type Job, type RouteCode,
} from '../proto/model'
import { lateDays, simulate, workdayToDate } from '../proto/capacity'
import { duration, relDay, shortDate } from '../proto/format'
import { Card, DueLabel, Pill, StatTile, ViewSwitch, pillGroup, pillItem, pillOff, pillOn } from '../components/ui'
import type { Tone } from '../components/tone'
import { IconAlert, IconCheck, IconClipboard, IconClock, IconFactory, IconFilm, IconPackage, IconSearch, IconSewing, IconX } from '../components/icons'
import { roleSummary, type SewingView, type SummaryIcon } from '../proto/summary'
import Overview from './Overview'
import { DASH_TAB_NAME, FACTORY_SCOPE, jobInScope, type BoardScope, type DashTab } from '../auth/scope'
import { SewingFloor, TodoPanel } from './WorkPanels'
import { applyBooking, applyFinishSewing, applyMachineStatus, applyRepairEta, applyReportSewingIssue, applyStartSewing, cancelBookings, SEW_NEEDS, type MachineStatus } from '../proto/sewing'
import { BookingPanel } from './BookingPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { SewingNow, type SewActions } from './SewingNow'

type Filter = 'all' | 'overdue' | 'hold' | 'film' | 'doneToday'
type View = 'overview' | 'board'
const STATUS_FILTERS: [Filter, string][] = [
  ['all', 'ทุกสถานะ'], ['overdue', 'เลยกำหนดส่ง'], ['hold', 'ติดปัญหา / พักงาน'],
  ['film', 'รอฟิล์ม DTF'], ['doneToday', 'เสร็จวันนี้'],
]
const filterField = 'min-h-12 w-full min-w-0 rounded-xl border border-line bg-card px-3 focus-visible:outline-2 focus-visible:outline-brand'

// เฟส 1: ภาพรวมแอดมิน + บอร์ดสถานี (ข้อมูลจำลอง) · DEVELOPMENT.md หัวข้อ 8
export default function Dashboard({ view, today, scope: myScope = FACTORY_SCOPE }: { view: View; today: string; scope?: BoardScope }) {
  const now = useNow(30_000)
  // ข้อมูลจำลองเปลี่ยนได้ เพื่อให้กดเริ่มเย็บแล้วเห็นผลจริงบนจอ (A4 เปลี่ยนเป็นเรียก public.start_sewing)
  const [{ allJobs, machines, bookings }, setData] = useState(() => {
    const list = makeMockJobs(new Date())
    const ms = makeMockMachines(list)
    return { allJobs: list, machines: ms, bookings: makeMockBookings(list, ms, new Date()) }
  })
  const startSewing = (jobId: string) => {
    const r = applyStartSewing(allJobs, machines, jobId, SEW_NEEDS, new Date(), bookings)
    if (!r.ok) return { ok: false as const, reason: r.reason }
    setData({ allJobs: r.jobs, machines: r.machines, bookings })
    return { ok: true as const, picked: r.picked }
  }
  const book = (jobId: string, starts: Date, ends: Date) => {
    const job = allJobs.find(j => j.id === jobId)
    if (!job) return { ok: false as const, reason: 'ไม่พบงานนี้' }
    const r = applyBooking(job, machines, bookings, starts, ends, SEW_NEEDS, new Date())
    if (!r.ok) return { ok: false as const, reason: r.reason }
    setData({ allJobs, machines, bookings: r.bookings })
    return { ok: true as const, picked: r.picked }
  }
  const cancelBook = (jobId: string) => {
    const r = cancelBookings(bookings, jobId, new Date())
    if (!r.ok) return { ok: false as const, reason: r.reason }
    setData({ allJobs, machines, bookings: r.bookings })
    return { ok: true as const }
  }
  const setMachineStatus = (code: string, status: MachineStatus, note: string, repairEta?: Date) => {
    const r = applyMachineStatus(allJobs, machines, code, status, note, new Date(),
      { repairEta, byProduction: myScope.canSetRepairEta, canSetEta: myScope.canSetRepairEta })
    if (!r.ok) return { ok: false as const, reason: r.reason }
    setData({ allJobs: r.jobs, machines: r.machines, bookings })
    return { ok: true as const, heldJob: r.heldJob }
  }
  // A4 ต่อ RPC report_sewing_issue / resume_sewing / finish_sewing เมื่อใช้ข้อมูลจริง
  const sewActions: SewActions = {
    report: (jobId, reason, pause) => {
      const r = applyReportSewingIssue(allJobs, jobId, reason, pause, new Date())
      if (!r.ok) return { ok: false, reason: r.reason }
      setData({ allJobs: r.jobs, machines, bookings })
      return { ok: true, text: pause ? 'บันทึกรายงานและพักงานแล้ว' : 'บันทึกรายงานแล้ว' }
    },
    resume: jobId => {
      const r = applyStartSewing(allJobs, machines, jobId, SEW_NEEDS, new Date(), bookings, true)
      if (!r.ok) return { ok: false, reason: r.reason }
      setData({ allJobs: r.jobs, machines: r.machines, bookings })
      return { ok: true, text: r.picked.length ? `เย็บต่อแล้ว · จ่ายจักรเพิ่ม ${r.picked.join(', ')}` : 'เย็บต่อแล้ว' }
    },
    finish: jobId => {
      const r = applyFinishSewing(allJobs, machines, bookings, jobId, new Date())
      if (!r.ok) return { ok: false, reason: r.reason }
      setData({ allJobs: r.jobs, machines: r.machines, bookings: r.bookings })
      const no = allJobs.find(j => j.id === jobId)?.no ?? ''
      return { ok: true, text: `${no} เย็บเสร็จ ส่งต่อ QC + Packing แล้ว · คืนจักร ${r.released.length} ตัว${r.released.length ? `: ${r.released.join(', ')}` : ''}` }
    },
  }
  const setRepairEta = (code: string, eta: Date) => {
    const r = applyRepairEta(machines, code, eta, new Date())
    if (!r.ok) return { ok: false as const, reason: r.reason }
    setData({ allJobs, machines: r.machines, bookings })
    return { ok: true as const }
  }
  // คนหน้างานเห็นเฉพาะงานของตัวเองก่อน · กดดูทั้งโรงงานได้เมื่ออยากรู้ว่างานกำลังจะมาถึง
  const [wholeFactory, setWholeFactory] = useState(false)
  const [tab, setTab] = useState<DashTab>(myScope.tabs[0])
  const [sewFocus, setSewFocus] = useState<{ view?: SewingView; n: number }>({ n: 0 })
  const activeTab = myScope.tabs.includes(tab) ? tab : myScope.tabs[0]
  const scoped = myScope.columns !== null
  const showFactoryBoard = activeTab === 'board' && scoped && myScope.allowFactory && wholeFactory
  const scope = useMemo<BoardScope>(() => view !== 'board' ? FACTORY_SCOPE
    : showFactoryBoard ? { ...myScope, columns: null, showFilm: true } : myScope,
  [view, showFactoryBoard, myScope])
  const jobs = useMemo(() => allJobs.filter(j => jobInScope(j, scope)), [allJobs, scope])
  const columns = scope.columns ? COLUMNS.filter(c => scope.columns!.includes(c.key)) : COLUMNS
  const [filter, setFilter] = useState<Filter>('all')
  const [station, setStation] = useState<ColumnKey | 'all'>('all')
  const [route, setRoute] = useState<RouteCode | 'all'>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<{ id: string; view: View } | null>(null)
  const setOpenId = (id: string | null) => setOpen(id ? { id, view } : null)
  const forecast = useMemo(() => simulate(jobs, now), [jobs, now])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return jobs.filter(j => {
      if (route !== 'all' && j.route !== route) return false
      if (q && !`${j.no} ${j.customer} ${j.product}`.toLowerCase().includes(q)) return false
      if (j.phase === 'done' && j.doneAt && now.getTime() - j.doneAt.getTime() > 3 * 86_400_000) return false
      switch (filter) {
        case 'overdue': return isOverdue(j, now)
        case 'hold': return j.status === 'hold'
        case 'film': return isWaitingFilm(j)
        case 'doneToday': return isDoneToday(j, now)
        default: return true
      }
    })
  }, [jobs, filter, route, query, now])

  const byColumn = useMemo(() => {
    const map = new Map<ColumnKey, Job[]>(COLUMNS.map(c => [c.key, []]))
    for (const j of visible) map.get(columnOf(j))!.push(j)
    for (const list of map.values()) list.sort((a, b) => priority(a, now) - priority(b, now) || a.due.getTime() - b.due.getTime())
    return map
  }, [visible, now])

  const openJob = (open?.view === view && jobs.find(j => j.id === open.id)) || null
  const matchingColumns = columns.filter(c => station === 'all' ? (byColumn.get(c.key)?.length ?? 0) > 0 : c.key === station)
  const visibleCount = matchingColumns.reduce((sum, c) => sum + (byColumn.get(c.key)?.length ?? 0), 0)
  const hasFilters = filter !== 'all' || route !== 'all' || wholeFactory
  const openFinish = openJob && openJob.phase !== 'done' ? workdayToDate(forecast.finishDay.get(openJob.id) ?? 0, now) : undefined
  const drawer = openJob && <JobDrawer job={openJob} now={now} finish={openFinish} onClose={() => setOpenId(null)} />

  if (view === 'overview') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 p-4 sm:p-6">
          <PageHeader title="ภาพรวมการผลิต" today={today} now={now} />
          <Overview jobs={jobs} now={now} forecast={forecast} onOpen={setOpenId} />
        </div>
        {drawer}
      </div>
    )
  }

  return (
    // ทั้งหน้าเลื่อนทีเดียว (ไม่ซ้อนกล่องเลื่อน) · แท็บหลักติดด้านบนให้สลับได้ทุกเมื่อ
    <div className="min-h-0 flex-1 overflow-y-auto">
     <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={myScope.title} today={today} now={now} />
      <RoleSummary scope={myScope} jobs={allJobs} machines={machines} now={now}
        onPick={(t, v) => {
          if (!myScope.tabs.includes(t)) return
          setTab(t)
          // เปิดแท็บย่อยของจักรเย็บใหม่ทุกครั้งที่กด แม้อยู่แท็บนั้นแล้ว
          if (v) setSewFocus(f => ({ view: v, n: f.n + 1 }))
        }} />
      {scope.tabs.length > 1 && (
        <div className="sticky top-0 z-20 -mx-4 bg-paper px-4 py-2 sm:-mx-6 sm:px-6">
        <div role="tablist" aria-label="มุมมอง" className={`${pillGroup} flex-nowrap sm:inline-flex`}>
          {scope.tabs.map(t => (
            <button key={t} role="tab" aria-selected={activeTab === t} onClick={() => setTab(t)}
              className={`${pillItem} px-2 ${activeTab === t ? pillOn : pillOff}`}>
              {DASH_TAB_NAME[t]}
            </button>
          ))}
        </div>
        </div>
      )}
      {activeTab === 'sewing' ? (
        <ErrorBoundary key="sewing">
          <SewingFloor key={sewFocus.n} initialView={sewFocus.view} jobs={allJobs} machines={machines} bookings={bookings} now={now} onOpen={setOpenId}
            onStart={myScope.canSew ? startSewing : undefined} onStatus={myScope.canReportMachines ? setMachineStatus : undefined}
            onEta={myScope.canSetRepairEta ? setRepairEta : undefined}
            sewing={<SewingNow jobs={allJobs} machines={machines} now={now} onOpen={setOpenId} actions={myScope.canSew ? sewActions : undefined} />}
            booking={<BookingPanel jobs={allJobs} machines={machines} bookings={bookings} now={now} onOpen={setOpenId}
              onBook={myScope.canBook ? book : undefined} onCancel={myScope.canBook ? cancelBook : undefined} />} />
        </ErrorBoundary>
      ) : activeTab === 'todo' ? (
        <div className="grid content-start gap-4">
          <ErrorBoundary key="todo"><TodoPanel jobs={jobs} now={now} onOpen={setOpenId} /></ErrorBoundary>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
          <StationStrip columns={columns} byColumn={byColumn} now={now} station={station} onPick={setStation} />
          <Card className="grid gap-2 p-3 sm:p-4">
            <label className="relative min-w-0">
              <span className="sr-only">ค้นหางาน</span>
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted" />
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหาเลขที่ใบยืนยัน ลูกค้า หรือสินค้า"
                className={`${filterField} pl-10`} />
            </label>
            <details>
              <summary className="min-h-12 cursor-pointer rounded-xl px-3 py-3 font-medium text-brand hover:bg-paper">
                {hasFilters ? 'ตัวกรองเพิ่มเติม · กำลังใช้ตัวกรอง' : 'ตัวกรองเพิ่มเติม'}
              </summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {scoped && myScope.allowFactory && (
                  <div className="sm:col-span-2">
                    <ViewSwitch label="ขอบเขตงาน" value={wholeFactory ? 'all' : 'mine'} onChange={v => {
                      setWholeFactory(v === 'all')
                      setStation('all')
                      setFilter('all')
                    }} options={[['mine', 'งานของฉัน'], ['all', 'ทั้งโรงงาน']]} />
                  </div>
                )}
                <label className="grid gap-1 font-medium">สถานะ
                  <select value={filter} onChange={e => setFilter(e.target.value as Filter)} className={filterField}>
                    {STATUS_FILTERS.filter(([key]) => key !== 'film' || scope.showFilm).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 font-medium">เส้นทาง
                  <select value={route} onChange={e => setRoute(e.target.value as RouteCode | 'all')} className={filterField}>
                    <option value="all">ทุกเส้นทาง</option>
                    {Object.entries(ROUTES).map(([key, item]) => <option key={key} value={key}>{item.short}</option>)}
                  </select>
                </label>
              </div>
            </details>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold" role="status">
              {station === 'all' ? 'ทุกสถานี' : COLUMNS.find(c => c.key === station)?.name} · {visibleCount} งาน
            </p>
            {(hasFilters || query || station !== 'all') && (
              <button type="button" onClick={() => { setQuery(''); setStation('all'); setRoute('all'); setFilter('all'); setWholeFactory(false) }}
                className="min-h-12 rounded-xl border border-line bg-card px-5 font-semibold text-brand hover:border-brand/50">
                ล้างตัวกรอง
              </button>
            )}
          </div>
          {visibleCount === 0 ? (
            <Card className="p-5 text-muted">ไม่พบงานตามที่เลือก</Card>
          ) : (
            // สถานีเรียงบนลงล่างตามลำดับกระบวนการ อ่านต่อกันได้ ไม่กระโดดซ้าย-ขวาเหมือนตารางหลายคอลัมน์
            <div className="grid min-w-0 gap-5">
              {matchingColumns.map(c => (
                <section key={c.key} className="min-w-0" aria-labelledby={`col-${c.key}`}>
                  <h2 id={`col-${c.key}`} className="mb-2 flex items-center gap-2 text-lg font-bold">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm text-white">{COLUMNS.findIndex(x => x.key === c.key) + 1}</span>
                    {c.name}
                    <span className="text-base font-medium text-muted">{byColumn.get(c.key)?.length ?? 0} งาน</span>
                  </h2>
                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {byColumn.get(c.key)?.map(j => <li key={j.id} className="min-w-0"><JobCard job={j} now={now} onOpen={() => setOpenId(j.id)} /></li>)}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

     </div>
      {drawer}
    </div>
  )
}

const SUMMARY_ICON: Record<SummaryIcon, typeof IconFactory> = {
  factory: IconFactory, alert: IconAlert, clock: IconClock, film: IconFilm,
  sewing: IconSewing, check: IconCheck, package: IconPackage, clipboard: IconClipboard,
}

/** ตัวเลข 4 ช่องของตำแหน่งนั้น · กดแล้วไปแท็บที่ใช้จัดการเรื่องนั้น */
function RoleSummary({ scope, jobs, machines, now, onPick }: {
  scope: BoardScope; jobs: Job[]; machines: Parameters<typeof roleSummary>[3]; now: Date; onPick: (tab: DashTab, view?: SewingView) => void
}) {
  const tiles = useMemo(() => roleSummary(scope.summary, jobs.filter(j => jobInScope(j, scope)), jobs, machines, now),
    [scope, jobs, machines, now])
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {tiles.map(t => (
        <StatTile key={t.key} icon={SUMMARY_ICON[t.icon]} label={t.label} value={t.value} note={t.note} tone={t.tone}
          onClick={t.tab && scope.tabs.includes(t.tab) ? () => onPick(t.tab!, t.sewingView) : undefined} />
      ))}
    </div>
  )
}

function PageHeader({ title, today, now }: { title: string; today: string; now: Date }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h1 className="min-w-0 text-2xl font-bold">{title}</h1>
      <div className="text-sm text-muted">
        <span className="hidden md:inline">{today} · </span>
        <span>อัปเดต {now.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} น.</span>
      </div>
    </header>
  )
}

function priority(j: Job, now: Date) {
  if (j.status === 'hold') return 0
  if (isOverdue(j, now)) return 1
  if (isFilmLate(j, now)) return 2
  return 3
}

function stripe(j: Job, now: Date): Tone {
  if (j.phase === 'done') return 'ok'
  if (j.status === 'hold' || isOverdue(j, now)) return 'danger'
  if (isFilmLate(j, now) || j.phase === 'materials') return 'warn'
  if (j.status === 'doing') return 'info'
  return 'neutral'
}

function JobCard({ job: j, now, onOpen }: { job: Job; now: Date; onOpen: () => void }) {
  const label = j.status === 'hold' ? 'พักงาน'
    : isWaitingFilm(j) ? 'รอฟิล์ม'
    : j.phase === 'done' ? 'เสร็จ'
    : j.phase === 'sample' && j.station ? STATION_NAME[j.station]
    : j.status ? STATUS_NAME[j.status] : null
  const tone = stripe(j, now)
  return (
    <button type="button" onClick={onOpen}
      className={`flex h-full w-full min-w-0 flex-col gap-1 rounded-xl border border-line border-l-[6px] bg-card px-3 py-2.5 text-left shadow-card hover:border-brand ${STRIPE[tone]}`}>
      <span className="flex items-baseline gap-2">
        <b className="text-lg">{j.no}</b>
        <span className="ml-auto text-sm"><DueLabel job={j} now={now} /></span>
      </span>
      <span className="truncate">{j.customer}</span>
      <span className="truncate text-sm text-muted">{j.product} · {j.qty.toLocaleString('th-TH')} {j.unit}</span>
      {(label || j.rework) && (
        <span className="mt-0.5 flex flex-wrap gap-1">
          {label && <Pill tone={tone} dot>{label}</Pill>}
          {j.rework && <Pill tone="danger">งานแก้</Pill>}
        </span>
      )}
    </button>
  )
}

// แถบซ้ายของการ์ด (คลาสเต็มเพื่อให้ Tailwind สร้างได้)
const STRIPE: Record<Tone, string> = {
  danger: 'border-l-danger', warn: 'border-l-warn', info: 'border-l-info', ok: 'border-l-ok',
  brand: 'border-l-brand', neutral: 'border-l-line', dtf: 'border-l-dtf',
}

/** แถบสถานีตามลำดับกระบวนการ: เห็นทันทีว่างานกองอยู่ที่ไหน และกดเพื่อดูเฉพาะสถานีนั้น */
function StationStrip({ columns, byColumn, now, station, onPick }: {
  columns: { key: ColumnKey; name: string }[]; byColumn: Map<ColumnKey, Job[]>; now: Date
  station: ColumnKey | 'all'; onPick: (key: ColumnKey | 'all') => void
}) {
  const total = columns.reduce((n, c) => n + (byColumn.get(c.key)?.length ?? 0), 0)
  const item = (key: ColumnKey | 'all', name: string, count: number, urgent: number) => {
    const on = station === key
    return (
      <li key={key} className="min-w-0">
        <button type="button" onClick={() => onPick(on && key !== 'all' ? 'all' : key)} aria-pressed={on}
          className={`flex h-full min-h-14 w-full flex-col items-start justify-between rounded-xl border px-2.5 py-1.5 text-left ${on ? 'border-brand bg-brand text-white' : count ? 'border-line bg-card hover:border-brand' : 'border-line bg-card/60 text-muted'}`}>
          <span className="text-sm leading-tight font-semibold">{name}</span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-xl leading-tight font-bold tabular-nums">{count}</span>
            {urgent > 0 && <span className={`text-sm font-bold ${on ? 'text-white' : 'text-danger'}`}>ด่วน {urgent}</span>}
          </span>
        </button>
      </li>
    )
  }
  return (
    <nav aria-label="เลือกสถานี">
      <ol className="scroll-thin -mx-4 grid auto-cols-[minmax(5.5rem,1fr)] grid-flow-col gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {item('all', 'ทุกสถานี', total, 0)}
        {columns.map(c => {
          const list = byColumn.get(c.key) ?? []
          return item(c.key, c.name, list.length, list.filter(j => stripe(j, now) === 'danger').length)
        })}
      </ol>
    </nav>
  )
}

function CardStatus({ job: j, now }: { job: Job; now: Date }) {
  const rows: ReactNode[] = []

  if (j.phase === 'materials') rows.push(<Pill key="m" tone="warn" dot>รอ {missingDepts(j).map(d => DEPT_NAME[d]).join(', ')}</Pill>)
  if ((j.phase === 'sample' || j.phase === 'production') && j.station && j.status) {
    const tone: Tone = j.status === 'doing' ? 'info' : j.status === 'hold' ? 'danger' : 'neutral'
    rows.push(<Pill key="s" tone={tone} dot>{j.phase === 'sample' ? `${STATION_NAME[j.station]} · ` : ''}{STATUS_NAME[j.status]}</Pill>)
  }
  if (j.holdReason) rows.push(<span key="h" className="text-danger">สาเหตุ: {j.holdReason}</span>)
  if (j.phase === 'sample_review') rows.push(<Pill key="r" tone="info" dot>รอลูกค้ายืนยัน (รอบ {j.sampleRound})</Pill>)
  if (j.rework) rows.push(<span key="w" className="text-danger">แก้ {j.rework.qty} {j.unit} · {j.rework.reason}</span>)

  if (isWaitingFilm(j)) {
    const late = isFilmLate(j, now)
    rows.push(<Pill key="film" tone={late ? 'danger' : 'warn'}><IconFilm className="size-3" />รอฟิล์ม · ETA {shortDate(j.film!.eta)}{late && ' (เลยแล้ว)'}</Pill>)
  }
  if (j.phase === 'done' && j.doneAt) rows.push(<Pill key="d" tone="ok"><IconCheck className="size-3" />เสร็จ{relDay(j.doneAt, now)} {j.doneAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</Pill>)

  if (!rows.length) return null
  return <div className="mt-2.5 flex flex-col items-start gap-1.5 border-t border-dashed border-line pt-2.5 text-xs">{rows}</div>
}

function JobDrawer({ job: j, now, finish, onClose }: { job: Job; now: Date; finish?: Date; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stations = ROUTES[j.route].stations
  const curIdx = j.station ? stations.indexOf(j.station) : -1
  const late = finish ? lateDays(finish, j.due) : 0
  const steps: { label: string; state: StepState }[] = [
    { label: 'วัตถุดิบครบ', state: j.phase === 'materials' ? 'current' : 'done' },
    { label: `ขึ้นตัวอย่าง${j.sampleRound > 1 ? ` (รอบ ${j.sampleRound})` : ''}`, state: j.phase === 'materials' ? 'todo' : j.phase === 'sample' ? 'current' : 'done' },
    { label: 'ลูกค้ายืนยันตัวอย่าง', state: ['materials', 'sample'].includes(j.phase) ? 'todo' : j.phase === 'sample_review' ? 'current' : 'done' },
    ...stations.map((s, i) => ({
      label: STATION_NAME[s],
      state: (j.phase === 'done' ? 'done' : j.phase !== 'production' ? 'todo' : i < curIdx ? 'done' : i === curIdx ? (j.status === 'hold' ? 'hold' : 'current') : 'todo') as StepState,
    })),
    { label: 'เสร็จ / พร้อมส่ง', state: j.phase === 'done' ? 'done' : 'todo' },
  ]

  return (
    <div className="fixed inset-0 z-30 flex animate-fade justify-end bg-ink/40" onClick={onClose}>
      <aside onClick={e => e.stopPropagation()} role="dialog" aria-label={`รายละเอียดงาน ${j.no}`}
        className="flex h-full w-full max-w-md animate-drawer flex-col overflow-y-auto border-l border-line bg-paper shadow-lift">
        <header className="sticky top-0 z-10 border-b border-line bg-card px-5 pt-5 pb-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{j.no}</h2>
                <span className="rounded-full bg-brand-soft px-2 py-px text-xs font-bold text-brand">{ROUTES[j.route].short}</span>
              </div>
              <p className="truncate text-muted">{j.customer}</p>
            </div>
            <button onClick={onClose} className="ml-auto grid size-12 place-items-center rounded-full bg-paper transition hover:bg-line" aria-label="ปิด"><IconX className="size-4" /></button>
          </div>
          {finish && (
            <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${late > 0 ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>
              {late > 0 ? <IconAlert className="size-4" /> : <IconCheck className="size-4" />}
              คาดว่าเสร็จ <b>{shortDate(finish)}</b>
              <span className="ml-auto text-xs opacity-90">{late > 0 ? `ไม่ทันกำหนด ${late} วัน` : 'ทันกำหนดส่ง'}</span>
            </div>
          )}
        </header>

        <div className="grid gap-4 p-4 text-sm">
          <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Info label="สินค้า">{j.product}</Info>
              <Info label="จำนวน">{j.qty.toLocaleString('th-TH')} {j.unit}</Info>
              <Info label="กำหนดส่ง"><DueLabel job={j} now={now} long /></Info>
              <Info label="เส้นทาง">{ROUTES[j.route].name}</Info>
              <Info label="ตัวอย่าง">รอบที่ {j.sampleRound}{j.phase === 'production' || j.phase === 'done' ? ' · ผ่านแล้ว' : ''}</Info>
              <Info label="อยู่ในขั้นนี้">{j.phase === 'done' ? '—' : duration(now.getTime() - j.since.getTime())}</Info>
            </dl>
            <CardStatus job={j} now={now} />
          </div>

          {!!j.sewingReports?.length && (
            <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
              <h3 className="mb-2 font-semibold">รายงานปัญหาระหว่างเย็บ</h3>
              <ul className="divide-y divide-line">
                {j.sewingReports.map((report, index) => (
                  <li key={index} className="py-2">
                    <p className="break-words">{report.reason}</p>
                    <p className="text-sm text-muted">
                      {report.at.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}{report.paused ? ' · พักงาน' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <h3 className="mb-3 font-semibold">ความคืบหน้า</h3>
            <ol>{steps.map((s, i) => <Step key={i} label={s.label} state={s.state} last={i === steps.length - 1} />)}</ol>
          </div>

          <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <h3 className="mb-2 font-semibold">วัตถุดิบ</h3>
            <ul className="grid gap-2">
              {(['admin', 'qc', 'production'] as const).map(d => (
                <li key={d} className="flex items-center gap-2">
                  {j.materials[d] ? <IconCheck className="size-4 text-ok" /> : <IconClock className="size-4 text-warn" />}
                  <span className="flex-1">{DEPT_NAME[d]}</span>
                  <Pill tone={j.materials[d] ? 'ok' : 'warn'}>{j.materials[d] ? 'ติ๊กครบ' : 'ยังไม่ติ๊ก'}</Pill>
                </li>
              ))}
              {j.film && (
                <li className="flex items-center gap-2">
                  <IconFilm className={`size-4 ${j.film.received ? 'text-ok' : isFilmLate(j, now) ? 'text-danger' : 'text-warn'}`} />
                  <span className="flex-1">ฟิล์ม DTF</span>
                  <Pill tone={j.film.received ? 'ok' : isFilmLate(j, now) ? 'danger' : 'warn'}>{j.film.received ? 'ได้รับแล้ว' : `ETA ${shortDate(j.film.eta)}`}</Pill>
                </li>
              )}
            </ul>
          </div>

          <p className="rounded-xl border border-dashed border-line p-3 text-xs text-muted">
            ต้นแบบเฟส 1 · ข้อมูลจำลอง · ไทม์ไลน์ทุกการกด ภาพ PDF ใบยืนยัน และเวลาต่อสถานีจะมาในเฟส 2
          </p>
        </div>
      </aside>
    </div>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className="font-medium">{children}</dd></div>
}

type StepState = 'done' | 'current' | 'hold' | 'todo'
function Step({ label, state, last }: { label: string; state: StepState; last: boolean }) {
  const dot = { done: 'bg-brand-700 text-white', current: 'bg-info text-white ring-4 ring-info/15', hold: 'bg-danger text-white ring-4 ring-danger/15', todo: 'border-2 border-line bg-card' }[state]
  const text = { done: 'text-muted', current: 'font-semibold', hold: 'font-semibold text-danger', todo: 'text-muted/70' }[state]
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!last && <span className={`absolute top-6 left-[11px] h-[calc(100%-18px)] w-0.5 ${state === 'done' ? 'bg-brand' : 'bg-line'}`} />}
      <span className={`relative grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${dot}`}>{state === 'done' ? '✓' : state === 'hold' ? '!' : ''}</span>
      <span className={`pt-0.5 ${text}`}>{label}
        {state === 'current' && <span className="ml-2"><Pill tone="info">ตอนนี้</Pill></span>}
        {state === 'hold' && <span className="ml-2"><Pill tone="danger">ติดปัญหา</Pill></span>}
      </span>
    </li>
  )
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
