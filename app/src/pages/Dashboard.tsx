import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { decideBoardJob, fetchBoardJob, rpc, useFactoryData, type FactoryData } from '../data/useFactoryData'
import {
  COLUMNS, DEPT_NAME, ROUTES, STATION_NAME, STATUS_NAME,
  columnOf, filmLabel, isDoneToday, isFilmLate, isOverdue, isWaitingFilm, missingDepts,
  type ColumnKey, type Job, type RouteCode,
} from '../proto/model'
import { lateDays, simulate, workdayToDate } from '../proto/capacity'
import { duration, relDay, shortDate } from '../proto/format'
import { Card, DueLabel, Pill, StatTile, ViewSwitch, pillGroup, pillItem, pillOff, pillOn } from '../components/ui'
import { thaiError } from '../data/live'
import type { Tone } from '../components/tone'
import { IconAlert, IconCheck, IconClipboard, IconClock, IconFactory, IconFilm, IconPackage, IconSearch, IconSewing, IconX } from '../components/icons'
import { roleSummary, type SewingView, type SummaryIcon } from '../proto/summary'
import Overview from './Overview'
import { DASH_TAB_NAME, FACTORY_SCOPE, jobInScope, type BoardScope, type DashTab } from '../auth/scope'
import { SewingFloor, TodoPanel } from './WorkPanels'
import type { MachineStatus } from '../proto/sewing'
import { BookingPanel } from './BookingPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { SewingNow, type SewActions } from './SewingNow'
import { JobActions } from './JobActions'
import { ReceiveJob } from './ReceiveJob'
import { JobHistory } from './JobHistory'
import type { EmployeeRole } from '../auth/access'
import { IconInbox } from '../components/icons'

type Filter = 'all' | 'overdue' | 'hold' | 'film' | 'doneToday'
type View = 'overview' | 'board'
const STATUS_FILTERS: [Filter, string][] = [
  ['all', 'ทุกสถานะ'], ['overdue', 'เลยกำหนดส่ง'], ['hold', 'ติดปัญหา / พักงาน'],
  ['film', 'รอฟิล์ม'], ['doneToday', 'เสร็จวันนี้'],
]
const filterField = 'min-h-12 w-full min-w-0 rounded-xl border border-line bg-card px-3 focus-visible:outline-2 focus-visible:outline-brand'

// ภาพรวมแอดมิน + บอร์ดสถานี + จักรเย็บ · ข้อมูลจริงจากฐานข้อมูล อัปเดตสดผ่าน Realtime (A5) · DEVELOPMENT.md หัวข้อ 8
export default function Dashboard({ view, today, role, scope = FACTORY_SCOPE }: { view: View; today: string; role: EmployeeRole; scope?: BoardScope }) {
  const { state, live, refresh } = useFactoryData()
  if (state.status === 'loading') {
    return <main className="flex-1 p-5"><p role="status" className="text-muted">กำลังโหลดข้อมูลงาน…</p></main>
  }
  if (state.status === 'error') {
    return (
      <main className="flex-1 p-4 sm:p-6">
        <Card className="mx-auto grid max-w-lg gap-3 p-5">
          <p role="alert" className="font-semibold text-danger">โหลดข้อมูลงานไม่สำเร็จ</p>
          <p>{state.message}</p>
          <button type="button" onClick={() => void refresh()} className="min-h-12 rounded-xl bg-brand px-5 font-semibold text-white">ลองอีกครั้ง</button>
        </Card>
      </main>
    )
  }
  return (
    <>
      {!live && (
        <p role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-1.5 text-sm font-medium text-danger sm:px-6">
          ขาดการเชื่อมต่อ · ข้อมูลอาจไม่ใช่ล่าสุด (อัปเดตล่าสุด {state.loadedAt.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} น.) · ระบบจะโหลดใหม่เองเมื่อเน็ตกลับมา
        </p>
      )}
      <DashboardView view={view} today={today} role={role} myScope={scope} data={state.data} loadedAt={state.loadedAt} refresh={refresh} />
    </>
  )
}

function DashboardView({ view, today, role, myScope, data, loadedAt, refresh }: {
  view: View; today: string; role: EmployeeRole; myScope: BoardScope; data: FactoryData; loadedAt: Date; refresh: () => Promise<void>
}) {
  // รับงานเข้าโรงงาน = ฝ่ายผลิต (คุมหน้างานทั้งหมด) · owner ทำแทนได้ · ฐานข้อมูลตรวจซ้ำ
  const canReceive = role === 'production' || role === 'supervisor' || role === 'owner'
  const [receiving, setReceiving] = useState(false)
  const [received, setReceived] = useState<string | null>(null)
  const now = useNow(30_000)
  const { jobs: allJobs, machines, bookings, needs } = data
  const noOf = (jobId: string) => allJobs.find(j => j.id === jobId)?.no ?? ''
  // ทุกปุ่มเรียกฟังก์ชันในฐานข้อมูล (กฎตรวจที่นั่น) แล้วโหลดใหม่ทันที ไม่รอ Realtime
  async function call<T>(name: string, args: Record<string, unknown>) {
    const r = await rpc<T>(name, args)
    if (r.ok) await refresh()
    return r
  }
  const startSewing = async (jobId: string) => {
    const r = await call<string[]>('start_sewing', { p_job: jobId })
    return r.ok ? { ok: true as const, picked: r.data ?? [] } : r
  }
  const book = async (jobId: string, starts: Date, ends: Date) => {
    const r = await call<string[]>('book_machines', { p_job: jobId, p_starts: starts.toISOString(), p_ends: ends.toISOString() })
    return r.ok ? { ok: true as const, picked: r.data ?? [] } : r
  }
  const cancelBook = async (jobId: string) => {
    const r = await call('cancel_booking', { p_job: jobId })
    return r.ok ? { ok: true as const } : r
  }
  const setMachineStatus = async (code: string, status: MachineStatus, note: string, repairEta?: Date) => {
    // งานที่จะถูกพักอัตโนมัติ (จักรเสียระหว่างเย็บ) · รู้ก่อนกดจากข้อมูลบนจอ
    const m = machines.find(x => x.code === code)
    const held = status !== 'ready' && m?.jobId ? allJobs.find(j => j.id === m.jobId && j.status === 'doing')?.no : undefined
    const r = await call('set_machine_status', {
      p_machine_code: code, p_status: status, p_note: note.trim() || null, p_repair_eta: repairEta?.toISOString() ?? null,
    })
    return r.ok ? { ok: true as const, heldJob: held } : r
  }
  const setRepairEta = async (code: string, eta: Date) => {
    const r = await call('set_repair_eta', { p_machine_code: code, p_repair_eta: eta.toISOString(), p_note: null })
    return r.ok ? { ok: true as const } : r
  }
  const sewActions: SewActions = {
    report: async (jobId, reason, pause) => {
      const r = await call('report_sewing_issue', { p_job: jobId, p_reason: reason, p_pause: pause })
      return r.ok ? { ok: true, text: pause ? 'บันทึกรายงานและพักงานแล้ว' : 'บันทึกรายงานแล้ว' } : r
    },
    resume: async jobId => {
      const r = await call('resume_sewing', { p_job: jobId })
      return r.ok ? { ok: true, text: 'เย็บต่อแล้ว · ระบบจ่ายจักรที่ขาดให้ครบ' } : r
    },
    finish: async jobId => {
      const released = machines.filter(m => m.jobId === jobId).map(m => m.code).sort()
      const r = await call('finish_sewing', { p_job: jobId })
      if (!r.ok) return r
      return { ok: true, text: `${noOf(jobId)} เย็บเสร็จ ส่งต่อ QC + Packing แล้ว · คืนจักร ${released.length} ตัว${released.length ? `: ${released.join(', ')}` : ''}` }
    },
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
  const [lookup, setLookup] = useState<{ id: string; job: Job | null; error?: string } | null>(null)
  const [open, setOpen] = useState<{ id: string; source: View | 'link' } | null>(() => {
    const id = jobFromHash()
    return id !== null ? { id, source: 'link' } : null
  })
  // ลิงก์ #/board?job=<id> จากกล่องจดหมายและ QR ใบปะงาน เปิดรายละเอียดงานทันที (กดลิงก์ขณะเปิดหน้านี้อยู่ด้วย)
  useEffect(() => {
    const on = () => {
      const id = jobFromHash()
      setLookup(null)
      setOpen(current => id !== null ? { id, source: 'link' } : current?.source === 'link' ? null : current)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const setOpenId = (id: string | null) => {
    setLookup(null)
    setOpen(id ? { id, source: view } : null)
    // ปิดแล้วเอา ?job= ออก ไม่อย่างนั้นรีเฟรชหน้าจะเปิดงานเดิมซ้ำ
    if (!id && jobFromHash() !== null) window.location.replace(window.location.hash.split('?')[0])
  }
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

  const fromLink = open?.source === 'link' ? decideBoardJob(open.id, allJobs) : null
  const fetchId = fromLink?.status === 'fetch' ? fromLink.id : undefined
  useEffect(() => {
    if (!fetchId) return
    const controller = new AbortController()
    void fetchBoardJob(fetchId, controller.signal).then(job => {
      if (!controller.signal.aborted) setLookup({ id: fetchId, job })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setLookup({ id: fetchId, job: null, error: thaiError(error instanceof Error ? error.message : undefined) })
      }
    })
    return () => controller.abort()
  }, [fetchId, open])

  const fetched = lookup?.id === fetchId ? lookup : null
  const openJob = fromLink?.status === 'found' ? fromLink.job
    : fromLink ? fetched?.job
    : open?.source === view ? allJobs.find(j => j.id === open.id) : undefined
  const linkLoading = fetchId !== undefined && !fetched
  const linkMissing = fromLink?.status === 'missing' || (fetched && !fetched.job && !fetched.error)
  const linkNotice = (linkLoading || linkMissing || fetched?.error) && (
    <p role={linkLoading ? 'status' : 'alert'} className={linkLoading ? 'px-5 py-3 text-muted' : 'border-b border-danger/30 bg-danger-soft px-5 py-3 font-medium text-danger'}>
      {linkLoading ? 'กำลังโหลดรายละเอียดงาน…' : fetched?.error ?? 'ไม่พบงานนี้'}
    </p>
  )
  const matchingColumns = columns.filter(c => station === 'all' ? (byColumn.get(c.key)?.length ?? 0) > 0 : c.key === station)
  const visibleCount = matchingColumns.reduce((sum, c) => sum + (byColumn.get(c.key)?.length ?? 0), 0)
  const hasFilters = filter !== 'all' || route !== 'all' || wholeFactory
  const openFinish = openJob && openJob.phase !== 'done' ? workdayToDate(forecast.finishDay.get(openJob.id) ?? 0, now) : undefined
  const drawer = openJob && (
    <JobDrawer job={openJob} now={now} finish={openFinish} onClose={() => setOpenId(null)}
      actions={<JobActions job={openJob} role={role} version={loadedAt.getTime()} now={now} refresh={refresh} />}
      history={<JobHistory key={openJob.id} jobId={openJob.id} role={role} version={loadedAt.getTime()} now={now} onChanged={refresh} />} />
  )
  const receive = receiving && (
    <ReceiveJob onClose={() => setReceiving(false)} onDone={async no => {
      setReceiving(false)
      setReceived(no)
      await refresh()
    }} />
  )
  const receiveBar = canReceive && (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => { setReceived(null); setReceiving(true) }}
        className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-700">
        <IconInbox className="size-5" />รับงานใหม่
      </button>
      {received && <p role="status" className="rounded-xl bg-ok-soft px-3 py-2 font-medium text-ok">รับงาน {received} แล้ว · รอทุกฝ่ายติ๊กวัตถุดิบ</p>}
    </div>
  )

  if (view === 'overview') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 p-4 sm:p-6">
          <PageHeader title="ภาพรวมการผลิต" today={today} updated={loadedAt} />
          {linkNotice}
          <Overview jobs={jobs} now={now} forecast={forecast} onOpen={setOpenId} />
        </div>
        {drawer}
        {receive}
      </div>
    )
  }

  return (
    // ทั้งหน้าเลื่อนทีเดียว (ไม่ซ้อนกล่องเลื่อน) · แท็บหลักติดด้านบนให้สลับได้ทุกเมื่อ
    <div className="min-h-0 flex-1 overflow-y-auto">
     <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={myScope.title} today={today} updated={loadedAt} />
      {linkNotice}
      {receiveBar}
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
          <SewingFloor key={sewFocus.n} initialView={sewFocus.view} jobs={allJobs} machines={machines} bookings={bookings} needs={needs} now={now} onOpen={setOpenId}
            onStart={myScope.canSew ? startSewing : undefined} onStatus={myScope.canReportMachines ? setMachineStatus : undefined}
            onEta={myScope.canSetRepairEta ? setRepairEta : undefined}
            sewing={<SewingNow jobs={allJobs} machines={machines} now={now} onOpen={setOpenId} actions={myScope.canSew ? sewActions : undefined} />}
            booking={<BookingPanel jobs={allJobs} machines={machines} bookings={bookings} needs={needs} now={now} onOpen={setOpenId}
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
      {receive}
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

// เวลาอัปเดต = ตอนที่โหลดข้อมูลล่าสุดจากฐานข้อมูล (ไม่ใช่นาฬิกาเครื่อง) คนหน้างานจึงรู้ว่าข้อมูลสดแค่ไหน
function PageHeader({ title, today, updated }: { title: string; today: string; updated: Date }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h1 className="min-w-0 text-2xl font-bold">{title}</h1>
      <div className="text-sm text-muted">
        <span className="hidden md:inline">{today} · </span>
        <span>อัปเดต {updated.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' })} น.</span>
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

function JobDrawer({ job: j, now, finish, onClose, actions, history }: { job: Job; now: Date; finish?: Date; onClose: () => void; actions?: ReactNode; history?: ReactNode }) {
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
    ...(j.needsSample === false ? [] : [
      { label: `ขึ้นตัวอย่าง${j.sampleRound > 1 ? ` (รอบ ${j.sampleRound})` : ''}`, state: (j.phase === 'materials' ? 'todo' : j.phase === 'sample' ? 'current' : 'done') as StepState },
      { label: 'ลูกค้ายืนยันตัวอย่าง', state: (['materials', 'sample'].includes(j.phase) ? 'todo' : j.phase === 'sample_review' ? 'current' : 'done') as StepState },
    ]),
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
          <a href={'#/label?id=' + encodeURIComponent(j.id)}
            className="mt-2 inline-flex min-h-12 items-center gap-2 rounded-xl border border-line px-3 font-semibold text-brand hover:bg-brand-soft">
            <IconClipboard className="size-5" /> พิมพ์ใบปะงาน
          </a>
          {finish && (
            <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${late > 0 ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>
              {late > 0 ? <IconAlert className="size-4" /> : <IconCheck className="size-4" />}
              คาดว่าเสร็จ <b>{shortDate(finish)}</b>
              <span className="ml-auto text-xs opacity-90">{late > 0 ? `ไม่ทันกำหนด ${late} วัน` : 'ทันกำหนดส่ง'}</span>
            </div>
          )}
        </header>

        <div className="grid gap-4 p-4 text-sm">
          {actions}
          <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Info label="สินค้า">{j.product}</Info>
              <Info label="จำนวน">{j.qty.toLocaleString('th-TH')} {j.unit}</Info>
              <Info label="กำหนดส่ง"><DueLabel job={j} now={now} long /></Info>
              <Info label="เส้นทาง">{ROUTES[j.route].name}</Info>
              <Info label="ตัวอย่าง">{j.needsSample === false ? 'ไม่ขึ้นตัวอย่าง' : `รอบที่ ${j.sampleRound}${j.phase === 'production' || j.phase === 'done' ? ' · ผ่านแล้ว' : ''}`}</Info>
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
                  <span className="flex-1">{filmLabel(j.route)}</span>
                  <Pill tone={j.film.received ? 'ok' : isFilmLate(j, now) ? 'danger' : 'warn'}>{j.film.received ? 'ได้รับแล้ว' : `ETA ${shortDate(j.film.eta)}`}</Pill>
                </li>
              )}
            </ul>
          </div>

          {history}
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

/** id งานจากลิงก์ #/board?job=<id> · ไม่มี = null */
function jobFromHash(): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('job')
}
