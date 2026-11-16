import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { makeMockBookings, makeMockJobs, makeMockMachines } from '../proto/mockJobs'
import {
  COLUMNS, DEPT_NAME, ROUTES, STATION_NAME, STATUS_NAME,
  columnOf, isDoneToday, isFilmLate, isOverdue, isWaitingFilm, missingDepts,
  type ColumnKey, type Job, type RouteCode,
} from '../proto/model'
import { lateDays, simulate, workdayToDate } from '../proto/capacity'
import { duration, relDay, shortDate } from '../proto/format'
import { DueLabel, Pill, RouteBadge, StatTile } from '../components/ui'
import { TONE, type Tone } from '../components/tone'
import { IconAlert, IconCalendar, IconCheck, IconClock, IconFactory, IconFilm, IconPause, IconSearch, IconX } from '../components/icons'
import Overview from './Overview'
import { DASH_TAB_NAME, FACTORY_SCOPE, jobInScope, type BoardScope, type DashTab } from '../auth/scope'
import { SewingFloor, TodoPanel } from './WorkPanels'
import { applyBooking, applyMachineStatus, applyStartSewing, cancelBookings, SEW_NEEDS, type MachineStatus } from '../proto/sewing'
import { BookingPanel } from './BookingPanel'

type Filter = 'all' | 'overdue' | 'hold' | 'film' | 'doneToday'
type View = 'overview' | 'board'

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
  const setMachineStatus = (code: string, status: MachineStatus, note: string) => {
    const r = applyMachineStatus(allJobs, machines, code, status, note, new Date())
    if (!r.ok) return { ok: false as const, reason: r.reason }
    setData({ allJobs: r.jobs, machines: r.machines, bookings })
    return { ok: true as const, heldJob: r.heldJob }
  }
  // คนหน้างานเห็นเฉพาะงานของตัวเองก่อน · กดดูทั้งโรงงานได้เมื่ออยากรู้ว่างานกำลังจะมาถึง
  const [wholeFactory, setWholeFactory] = useState(false)
  const scoped = myScope.columns !== null
  const scope = useMemo<BoardScope>(() => view !== 'board' ? FACTORY_SCOPE
    : scoped && wholeFactory ? { ...FACTORY_SCOPE, title: myScope.title, sub: 'ดูทั้งโรงงาน', tabs: myScope.tabs } : myScope,
  [view, scoped, wholeFactory, myScope])
  const [tab, setTab] = useState<DashTab>(myScope.tabs[0])
  const jobs = useMemo(() => allJobs.filter(j => jobInScope(j, scope)), [allJobs, scope])
  const columns = scope.columns ? COLUMNS.filter(c => scope.columns!.includes(c.key)) : COLUMNS
  const [filter, setFilter] = useState<Filter>('all')
  const [route, setRoute] = useState<RouteCode | 'all'>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<{ id: string; view: View } | null>(null)
  const setOpenId = (id: string | null) => setOpen(id ? { id, view } : null)
  const forecast = useMemo(() => simulate(jobs, now), [jobs, now])

  const counts = useMemo(() => ({
    active: jobs.filter(j => j.phase !== 'done').length,
    overdue: jobs.filter(j => isOverdue(j, now)).length,
    hold: jobs.filter(j => j.status === 'hold').length,
    film: jobs.filter(isWaitingFilm).length,
    filmLate: jobs.filter(j => isFilmLate(j, now)).length,
    doneToday: jobs.filter(j => isDoneToday(j, now)),
  }), [jobs, now])

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
  const doneQty = counts.doneToday.reduce((s, j) => s + j.qty, 0)
  const openFinish = openJob && openJob.phase !== 'done' ? workdayToDate(forecast.finishDay.get(openJob.id) ?? 0, now) : undefined
  const drawer = openJob && <JobDrawer job={openJob} now={now} finish={openFinish} onClose={() => setOpenId(null)} />

  const tiles = (
    <div className="scroll-thin -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-5 [&>*]:w-44 [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-auto">
      <StatTile icon={IconFactory} label={scope.columns ? 'งานของฉัน' : 'งานในโรงงาน'} value={counts.active} tone="brand" active={view === 'board' && filter === 'all'} onClick={() => go('all')} />
      <StatTile icon={IconCalendar} label="เลยกำหนดส่ง" value={counts.overdue} tone="danger" active={filter === 'overdue'} onClick={() => go('overdue')} />
      <StatTile icon={IconPause} label="ติดปัญหา / พักงาน" value={counts.hold} tone="danger" active={filter === 'hold'} onClick={() => go('hold')} />
      {scope.showFilm && <StatTile icon={IconFilm} label="รอฟิล์ม DTF" value={counts.film} tone="warn" note={counts.filmLate ? `เลย ETA ${counts.filmLate}` : undefined} active={filter === 'film'} onClick={() => go('film')} />}
      <StatTile icon={IconCheck} label="เสร็จวันนี้" value={counts.doneToday.length} tone="ok" note={doneQty ? `${doneQty.toLocaleString('th-TH')} ชิ้น` : undefined} active={filter === 'doneToday'} onClick={() => go('doneToday')} />
    </div>
  )

  if (view === 'overview') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 p-4 sm:p-6">
          <PageHeader title="ภาพรวมแอดมิน" sub="งานแต่ละงานอยู่ขั้นไหน และรับงานใหม่เพิ่มได้หรือยัง" today={today} now={now} />
          {tiles}
          <Overview jobs={jobs} now={now} forecast={forecast} onOpen={setOpenId} />
        </div>
        {drawer}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={scope.title} sub={scope.sub} today={today} now={now} />
      {scope.tabs.length > 1 && (
        <div role="tablist" aria-label="มุมมอง" className="flex gap-1 rounded-2xl border border-line bg-white p-1 shadow-card sm:self-start">
          {scope.tabs.map(t => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`min-h-12 flex-1 rounded-xl px-2 font-semibold whitespace-nowrap transition sm:flex-none sm:px-4 ${tab === t ? 'bg-brand text-white shadow-card' : 'text-muted hover:text-ink'}`}>
              {DASH_TAB_NAME[t]}
            </button>
          ))}
        </div>
      )}
      {tab === 'sewing' && scope.tabs.includes('sewing') ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SewingFloor jobs={allJobs} machines={machines} bookings={bookings} now={now} onOpen={setOpenId}
            onStart={myScope.canSew ? startSewing : undefined} onStatus={myScope.canReportMachines ? setMachineStatus : undefined}
            booking={<BookingPanel jobs={allJobs} machines={machines} bookings={bookings} now={now} onOpen={setOpenId}
              onBook={myScope.canSew ? book : undefined} onCancel={myScope.canSew ? cancelBook : undefined} />} />
        </div>
      ) : tab === 'todo' && scope.tabs.includes('todo') ? (
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto">
          {tiles}
          <TodoPanel jobs={jobs} now={now} onOpen={setOpenId} />
        </div>
      ) : (<>
      {tiles}

      {/* ตัวกรอง */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-80">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหาเลขที่ใบ / ลูกค้า / สินค้า"
            className="w-full rounded-xl border border-line bg-white py-2 pr-3 pl-9 text-sm shadow-card outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15" />
        </label>
        {scoped && myScope.allowFactory && (
          <Segmented value={wholeFactory ? 'all' : 'mine'} onChange={v => { setWholeFactory(v === 'all'); setFilter('all') }}
            options={[['mine', 'งานของฉัน'], ['all', 'ทั้งโรงงาน']]} />
        )}
        <Segmented value={route} onChange={setRoute} options={[['all', 'ทุกเส้นทาง'], ['normal', ROUTES.normal.short], ['dtf', ROUTES.dtf.short], ['plain', ROUTES.plain.short]]} />
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand">
            ล้างตัวกรอง <IconX className="size-3.5" />
          </button>
        )}
      </div>

      {/* บอร์ด */}
      <div className="scroll-thin -mx-4 flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
        {columns.map(c => {
          const list = byColumn.get(c.key)!
          const accent = c.key === 'done' ? 'bg-ok' : ['materials', 'sample', 'sample_review'].includes(c.key) ? 'bg-gold' : 'bg-brand'
          return (
            <section key={c.key} className="flex w-[80vw] max-w-72 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-line/70 bg-[#eaeeec] sm:w-64">
              <span className={`h-1 ${accent}`} />
              <h2 className="flex items-center gap-2 px-3 pt-2.5 pb-2 text-sm font-semibold">
                {c.name}
                <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-white px-1.5 text-[11px] font-semibold text-muted shadow-card">{list.length}</span>
              </h2>
              <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {list.map(j => <JobCard key={j.id} job={j} now={now} onOpen={() => setOpenId(j.id)} />)}
                {list.length === 0 && <p className="rounded-xl border border-dashed border-[#cfd7d3] px-2 py-6 text-center text-xs text-muted">ไม่มีงาน</p>}
              </div>
            </section>
          )
        })}
      </div>
      </>)}

      {drawer}
    </div>
  )

  function go(f: Filter) {
    setFilter(cur => (cur === f && f !== 'all' ? 'all' : f))
    if (view !== 'board') window.location.hash = '#/board'
  }
}

function PageHeader({ title, sub, today, now }: { title: string; sub: string; today: string; now: Date }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted">{sub}</p>
      </div>
      <div className="ml-auto flex items-center gap-2 text-xs text-muted">
        <span className="hidden rounded-full border border-line bg-white px-3 py-1.5 sm:inline">{today}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5">
          <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-ok" /></span>
          อัปเดต {now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
        </span>
      </div>
    </div>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-white p-1 text-sm shadow-card" role="group">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} aria-pressed={value === k}
          className={`rounded-lg px-3 py-1 transition ${value === k ? 'bg-brand font-semibold text-white shadow-card' : 'text-muted hover:text-ink'}`}>{label}</button>
      ))}
    </div>
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
  return (
    <button onClick={onOpen}
      className="group relative w-full shrink-0 overflow-hidden rounded-xl border border-line/80 bg-white p-3 pl-3.5 text-left text-sm shadow-card transition hover:-translate-y-px hover:shadow-lift">
      <span className={`absolute inset-y-0 left-0 w-1 ${TONE[stripe(j, now)].dot}`} />
      <div className="flex items-center gap-1.5">
        <span className="font-semibold tracking-tight">{j.no}</span>
        <RouteBadge route={j.route} />
        {j.rework && <Pill tone="danger">งานแก้</Pill>}
        {j.phase !== 'done' && j.sampleRound > 1 && <Pill tone="info">ตัวอย่างรอบ {j.sampleRound}</Pill>}
      </div>
      <div className="mt-1 truncate font-medium text-ink">{j.customer}</div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{j.product} · {j.qty.toLocaleString('th-TH')} {j.unit}</span>
        <DueLabel job={j} now={now} />
      </div>

      <CardStatus job={j} now={now} />

      {j.phase !== 'done' && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted"><IconClock className="size-3.5" />อยู่ในขั้นนี้ {duration(now.getTime() - j.since.getTime())}</div>
      )}
    </button>
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

  if (j.phase === 'production' && j.station === 'sew') {
    if (!j.firstPieceOk) rows.push(<Pill key="f" tone="warn" dot>รออนุมัติตัวแรก</Pill>)
    else rows.push(<Progress key="p" value={j.sewCount ?? 0} max={j.qty} />)
  }

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
    <div className="fixed inset-0 z-30 flex animate-fade justify-end bg-ink/35 backdrop-blur-[2px]" onClick={onClose}>
      <aside onClick={e => e.stopPropagation()} role="dialog" aria-label={`รายละเอียดงาน ${j.no}`}
        className="flex h-full w-full max-w-md animate-drawer flex-col overflow-y-auto bg-paper shadow-lift">
        <header className="sticky top-0 z-10 bg-brand px-5 pt-5 pb-4 text-white">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{j.no}</h2>
                <span className="rounded-md bg-white/15 px-1.5 py-px text-[10.5px] font-bold">{ROUTES[j.route].short}</span>
              </div>
              <p className="truncate text-white/75">{j.customer}</p>
            </div>
            <button onClick={onClose} className="ml-auto grid size-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20" aria-label="ปิด"><IconX className="size-4" /></button>
          </div>
          {finish && (
            <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${late > 0 ? 'bg-danger text-white' : 'bg-white/12 text-white'}`}>
              {late > 0 ? <IconAlert className="size-4" /> : <IconCheck className="size-4" />}
              คาดว่าเสร็จ <b>{shortDate(finish)}</b>
              <span className="ml-auto text-xs opacity-90">{late > 0 ? `ไม่ทันกำหนด ${late} วัน` : 'ทันกำหนดส่ง'}</span>
            </div>
          )}
        </header>

        <div className="grid gap-4 p-4 text-sm">
          <div className="rounded-2xl bg-white p-4 shadow-card">
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

          <div className="rounded-2xl bg-white p-4 shadow-card">
            <h3 className="mb-3 font-semibold">ความคืบหน้า</h3>
            <ol>{steps.map((s, i) => <Step key={i} label={s.label} state={s.state} last={i === steps.length - 1} />)}</ol>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-card">
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
  const dot = { done: 'bg-brand text-white', current: 'bg-info text-white ring-4 ring-info/15', hold: 'bg-danger text-white ring-4 ring-danger/15', todo: 'border-2 border-line bg-white' }[state]
  const text = { done: 'text-muted', current: 'font-semibold', hold: 'font-semibold text-danger', todo: 'text-muted/70' }[state]
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!last && <span className={`absolute top-6 left-[11px] h-[calc(100%-18px)] w-0.5 ${state === 'done' ? 'bg-brand' : 'bg-line'}`} />}
      <span className={`relative grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${dot}`}>{state === 'done' ? '✓' : state === 'hold' ? '!' : ''}</span>
      <span className={`pt-0.5 ${text}`}>{label}
        {state === 'current' && <span className="ml-2"><Pill tone="info">ตอนนี้</Pill></span>}
        {state === 'hold' && <span className="ml-2"><Pill tone="danger">ติดปัญหา</Pill></span>}
      </span>
    </li>
  )
}

function Progress({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <span className="flex w-full items-center gap-2">
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper"><span className="block h-full rounded-full bg-gradient-to-r from-brand-500 to-brand" style={{ width: `${pct}%` }} /></span>
      <span className="tabular-nums text-muted">{value.toLocaleString('th-TH')}/{max.toLocaleString('th-TH')}</span>
    </span>
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
