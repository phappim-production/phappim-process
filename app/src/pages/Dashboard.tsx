import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { decideBoardJob, fetchBoardJob, rpc, useFactoryData, type FactoryData } from '../data/useFactoryData'
import {
  COLUMNS, DEPT_NAME, ROUTES, SLA_LABEL, byQueue, isOutLate, STATION_NAME, STATUS_NAME, stationNo,
  filmLabel, savedStation, startStation, isDoneToday, isFilmLate, isFilmNotOrdered, isOverdue, isWaitingFilm, missingDepts, queueHead,
  type ColumnKey, type Job, type RouteCode, type StationCode,
} from '../proto/model'
import { lateDays, sewFloorOf, simulate, workdayToDate } from '../proto/capacity'
import { durationWord, relDayWord } from '../proto/format'
import { Card, DueLabel, MockupThumb, Pill, RouteBadge, StatTile, ViewSwitch, pillGroup, pillItem, pillOff, pillOn } from '../components/ui'
import { thaiError } from '../data/live'
import { jobKey, jobVersion } from '../data/jobKey'
import { Tr } from '../i18n/Tr'
import { useLang, useT, type Word } from '../i18n/lang'
import type { Tone } from '../components/tone'
import { IconAlert, IconCheck, IconClipboard, IconClock, IconFactory, IconFilm, IconImage, IconPackage, IconPause, IconPlay, IconSearch, IconSewing, IconUsers, IconX } from '../components/icons'
import { roleSummary, type SewingView, type SummaryIcon } from '../proto/summary'
import Overview, { StationNow } from './Overview'
import { DASH_TAB_NAME, FACTORY_SCOPE, boardColumnOf, jobInScope, type BoardScope, type DashTab } from '../auth/scope'
import { SewingFloor, TodoPanel } from './WorkPanels'
import { FirstPieceQueue } from './FirstPieceReview'
import { RevisionPill } from './Revision'
import { pausesJob, type MachineStatus } from '../proto/sewing'
import { BookingPanel } from './BookingPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { StationHeader, StationRail } from '../components/StationNav'
import { machineUse } from '../proto/machines'
import { SewingNow, type SewActions } from './SewingNow'
import { JobActions } from './JobActions'
import { JobVariants } from './JobVariants'
import { StationQueue } from './StationQueue'
import { ReceiveJob } from './ReceiveJob'
import { ConfirmationOutbox } from './ConfirmationOutbox'
import { JobHistory } from './JobHistory'
import { isStationCode } from '../proto/model'
import type { EmployeeRole, FactoryView } from '../auth/access'
import { IssuesView, MyHistoryView, QueueAllView, ReportIssueView, ReviewsView } from './RolePages'
import { myStationsOf } from '../proto/rolePages'
import type { OverviewView } from '../auth/menus'
import { IconInbox } from '../components/icons'

type Filter = 'all' | 'overdue' | 'hold' | 'film' | 'doneToday'
type View = FactoryView
const STATUS_FILTERS: [Filter, string][] = [
  ['all', 'ทุกสถานะ'], ['overdue', 'เลยกำหนดส่ง'], ['hold', 'ติดปัญหา / พักงาน'],
  ['film', 'รอฟิล์ม'], ['doneToday', 'เสร็จวันนี้'],
]
const filterField = 'min-h-12 w-full min-w-0 rounded-xl border border-line bg-card px-3 focus-visible:outline-2 focus-visible:outline-brand'

export default function Dashboard({ view, routeKey, tab, overviewView, today, role, scope = FACTORY_SCOPE }: {
  view: View; routeKey?: string; tab?: DashTab; overviewView?: OverviewView; today: string; role: EmployeeRole; scope?: BoardScope
}) {
  const { state, live, refresh, settle } = useFactoryData()
  if (state.status === 'loading') {
    return <main className="flex-1 p-5"><p role="status" className="text-muted"><Tr th="กำลังโหลดข้อมูลงาน…" /></p></main>
  }
  if (state.status === 'error') {
    return (
      <main className="flex-1 p-4 sm:p-6">
        <Card className="mx-auto grid max-w-lg gap-3 p-5">
          <p role="alert" className="font-semibold text-danger"><Tr th="โหลดข้อมูลงานไม่สำเร็จ" /></p>
          <p>{state.message}</p>
          <button type="button" onClick={() => void refresh()} className="min-h-12 rounded-xl bg-brand px-5 font-semibold text-white"><Tr th="ลองอีกครั้ง" /></button>
        </Card>
      </main>
    )
  }
  return (
    <>
      {!live && (
        <p role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-1.5 text-sm font-medium text-danger sm:px-6">
          <OfflineText at={state.loadedAt.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} />
        </p>
      )}
      <DashboardView key={routeKey} view={view} startTab={tab} overviewView={overviewView} today={today} role={role} myScope={scope} data={state.data} loadedAt={state.loadedAt} refresh={settle} />
    </>
  )
}

function DashboardView({ view, startTab, overviewView, today, role, myScope, data, loadedAt, refresh }: {
  view: View; startTab?: DashTab; overviewView?: OverviewView; today: string; role: EmployeeRole; myScope: BoardScope; data: FactoryData; loadedAt: Date; refresh: () => Promise<void>
}) {
  // แอดมินส่งงานเข้าโรงงาน · owner ทำแทนได้ · ฐานข้อมูลตรวจซ้ำ
  const canReceive = role === 'admin' || role === 'owner'
  const [receiving, setReceiving] = useState(false)
  const [received, setReceived] = useState<string | null>(null)
  const [draftId, setDraftId] = useState<string | undefined>(undefined)
  const now = useNow(30_000)
  const { jobs: allJobs, machines, bookings, needs, products, shared } = data
  const noOf = (jobId: string) => allJobs.find(j => j.id === jobId)?.no ?? ''
  async function call<T>(name: string, args: Record<string, unknown>, reload = true) {
    const r = await rpc<T>(name, args)
    if (r.ok && reload) await refresh()
    return r
  }
  // เริ่มเย็บเป็น 2 คำสั่ง (ชุดตามสินค้า แล้วเพิ่มจำนวน) · เพิ่มไม่ได้ = งานเริ่มแล้ว ให้กด + ในจัดการจักร
  const startSewing = async (jobId: string, codes: string[]) => {
    const r = await call<string[]>('start_sewing', { p_job: jobId, p_codes: codes })
    return r.ok ? { ok: true as const, picked: [...(r.data ?? [])].sort() } : r
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
    const m = machines.find(x => x.code === code)
    const job = m?.jobId ? allJobs.find(j => j.id === m.jobId) : undefined
    const held = status !== 'ready' && m && pausesJob(m, machines, job, needs) ? job?.no : undefined
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
    assign: async (jobId, code) => {
      const r = await call('assign_machines', { p_job: jobId, p_machine_codes: [code] })
      return r.ok ? { ok: true, text: `เพิ่มจักร ${code} ให้ ${noOf(jobId)} แล้ว` } : r
    },
    release: async (jobId, code) => {
      const r = await call('release_machines', { p_job: jobId, p_machine_codes: [code] })
      return r.ok ? { ok: true, text: `คืนจักร ${code} แล้ว · งานอื่นใช้ได้` } : r
    },
    ackRevision: async jobId => {
      const r = await call('ack_confirmation_revision', { p_job: jobId, p_station: 'sew' })
      return r.ok ? { ok: true, text: `${noOf(jobId)} รับทราบใบแก้แล้ว · เย็บตามใบล่าสุด` } : r
    },
    photo: async (jobId, fn, args) => {
      const r = await call(fn, { p_job: jobId, ...args })
      return r.ok ? { ok: true, text: `${noOf(jobId)} ${fn === 'submit_first_piece' ? 'ส่งรูปชิ้นแรกแล้ว · รอแอดมินอนุมัติ' : 'ส่งรูปงานเสร็จแล้ว · กดเย็บเสร็จได้'}` } : r
    },
  }
  // คนหน้างานเห็นเฉพาะงานของตัวเองก่อน · กดดูทั้งโรงงานได้เมื่ออยากรู้ว่างานกำลังจะมาถึง
  const [wholeFactory, setWholeFactory] = useState(false)
  // ลิงก์ #/board?station=… ตอนเปิดหน้าครั้งแรก → เปิดแท็บบอร์ด ไม่ใช่แท็บแรกของบทบาท
  const [tab, setTab] = useState<DashTab>(() => stationFromHash() && myScope.tabs.includes('board') ? 'board'
    : startTab && myScope.tabs.includes(startTab) ? startTab : myScope.tabs[0])
  const [sewFocus, setSewFocus] = useState<{ view?: SewingView; pick?: string; noted?: boolean; n: number }>({ n: 0 })
  const activeTab = myScope.tabs.includes(tab) ? tab : myScope.tabs[0]
  const scoped = myScope.columns !== null
  const showFactoryBoard = activeTab === 'board' && scoped && myScope.allowFactory && wholeFactory
  const scope = useMemo<BoardScope>(() => view !== 'board' ? FACTORY_SCOPE
    : showFactoryBoard ? { ...myScope, columns: null, showFilm: true } : myScope,
  [view, showFactoryBoard, myScope])
  const jobs = useMemo(() => allJobs.filter(j => jobInScope(j, scope)), [allJobs, scope])
  const columns = scope.columns ? COLUMNS.filter(c => scope.columns!.includes(c.key)) : COLUMNS
  const [filter, setFilter] = useState<Filter>('all')
  // แท็บเล็ตประจำสถานีเปิดมาเจอสถานีที่เลือกไว้ครั้งก่อน
  const [station, setStationState] = useState<ColumnKey | 'all'>(() => {
    const fromLink = stationFromHash()
    if (fromLink) {
      clearStationLink()
      try { localStorage.setItem(STATION_KEY, fromLink) } catch { /* ไม่จำก็ใช้ได้ */ }
      return savedStation(fromLink, columns)
    }
    try { return startStation(localStorage.getItem(STATION_KEY), columns, role === 'staff' || role === 'qc') } catch { return 'all' }
  })
  const setStation = (key: ColumnKey | 'all') => {
    setStationState(key)
    try { localStorage.setItem(STATION_KEY, key) } catch { /* โหมดส่วนตัว / ปิดการเก็บข้อมูล: ไม่จำก็ใช้ได้ */ }
  }
  const focusStation = activeTab === 'board' && station !== 'all' && station in STATION_NAME ? station as StationCode : null
  const [route, setRoute] = useState<RouteCode | 'all'>('all')
  const [query, setQuery] = useState('')
  const [lookup, setLookup] = useState<{ id: string; job: Job | null; error?: string } | null>(null)
  const [open, setOpen] = useState<{ id: string; source: View | 'link' } | null>(() => {
    const id = jobFromHash()
    return id !== null ? { id, source: 'link' } : null
  })
  // รวมกรณีกดลิงก์ ?job= ขณะเปิดหน้านี้อยู่
  useEffect(() => {
    const on = () => {
      const st = stationFromHash()
      if (st) {
        clearStationLink(); setStation(savedStation(st, COLUMNS)); setTab('board')
        // กล่องเลื่อนเดียวกับหน้าภาพรวม → กลับไปบนสุด ไม่ค้างตำแหน่งเดิม
        requestAnimationFrame(() => document.querySelector('[data-scroll="dashboard"]')?.scrollTo(0, 0))
      }
      const id = jobFromHash()
      setLookup(null)
      setOpen(current => id !== null ? { id, source: 'link' } : current?.source === 'link' ? null : current)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const [closedNotice, setClosedNotice] = useState<string | null>(null)
  const tx = useT()
  const setOpenId = (id: string | null) => {
    setLookup(null)
    setOpen(id ? { id, source: view } : null)
    // ปิดแล้วเอา ?job= ออก ไม่อย่างนั้นรีเฟรชหน้าจะเปิดงานเดิมซ้ำ
    if (!id && jobFromHash() !== null) window.location.replace(window.location.hash.split('?')[0])
  }
  const floor = useMemo(() => sewFloorOf(machines, needs, shared), [machines, needs, shared])
  // คิดจากงานทั้งโรงงาน งานนอกขอบเขตของบทบาทก็แย่งกำลังผลิตเหมือนกัน
  const forecast = useMemo(() => simulate(allJobs, now, undefined, floor), [allJobs, now, floor])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return jobs.filter(j => {
      if (route !== 'all' && j.route !== route) return false
      if (q && !`${j.no} ${j.customer} ${j.product}`.toLowerCase().includes(q)) return false
      if (j.phase === 'done' && j.delivered && now.getTime() - j.delivered.at.getTime() > 3 * 86_400_000) return false
      switch (filter) {
        case 'overdue': return isOverdue(j, now)
        case 'hold': return j.status === 'hold'
        case 'film': return isWaitingFilm(j) || isFilmNotOrdered(j)
        case 'doneToday': return isDoneToday(j, now)
        default: return true
      }
    })
  }, [jobs, filter, route, query, now])

  const byColumn = useMemo(() => {
    const map = new Map<ColumnKey, Job[]>(COLUMNS.map(c => [c.key, []]))
    for (const j of visible) map.get(boardColumnOf(j, scope))?.push(j)
    for (const list of map.values()) list.sort(byQueue)  // ตามคิวเสมอ · ด่วนดูจากสี
    return map
  }, [visible, scope])

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
  const doneNotice = closedNotice && (
    <p role="status" className="flex items-center justify-between gap-3 rounded-xl bg-ok-soft px-4 py-3 font-medium text-ok">
      <span>{closedNotice}</span>
      <button type="button" className="min-h-12 shrink-0 px-2 font-semibold" onClick={() => setClosedNotice(null)}>ปิด</button>
    </p>
  )
  const matchingColumns = columns.filter(c => station === 'all' ? (byColumn.get(c.key)?.length ?? 0) > 0 : c.key === station)
  const visibleCount = matchingColumns.reduce((sum, c) => sum + (byColumn.get(c.key)?.length ?? 0), 0)
  const hasFilters = filter !== 'all' || route !== 'all' || wholeFactory
  const openDay = openJob && openJob.phase !== 'done' ? forecast.finishDay.get(openJob.id) : undefined
  const openFinish = openDay === undefined ? undefined : workdayToDate(openDay, now)
  const openVersion = openJob ? `${jobKey(openJob)}#${jobVersion(openJob.id)}` : ''
  const drawer = openJob && (
    <JobDrawer job={openJob} now={now} finish={openFinish} onClose={() => setOpenId(null)}
      actions={<JobActions job={openJob} queueHead={queueHead(openJob, allJobs)} role={role} myStations={myScope.pressStations} version={openVersion} now={now} refresh={refresh} vendors={data.vendors} onCancelled={setClosedNotice} />}
      history={<JobHistory key={openJob.id} jobId={openJob.id} unit={openJob.unit} role={role} version={openVersion} now={now} onChanged={refresh} />} />
  )
  const approvals = (role === 'admin' || role === 'manager' || role === 'owner') && (
    <FirstPieceQueue jobs={allJobs} now={now} call={call} onOpen={setOpenId} />
  )
  const receive = receiving && (
    <ReceiveJob jobs={allJobs} now={now} floor={floor} draftId={draftId} onClose={() => setReceiving(false)} onDone={async no => {
      setReceiving(false)
      setReceived(no)
      await refresh()
    }} />
  )
  const receiveBar = canReceive && (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => { setReceived(null); setDraftId(undefined); setReceiving(true) }}
        className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-700">
        <IconInbox className="size-5" />รับงานใหม่
      </button>
      {received && <p role="status" className="rounded-xl bg-ok-soft px-3 py-2 font-medium text-ok">ส่งงาน {received} เข้าโรงงานแล้ว · ขึ้นบอร์ดสถานีแรกทันที</p>}
      <ConfirmationOutbox onReceive={id => { setReceived(null); setDraftId(id); setReceiving(true) }} onRevised={refresh} />
    </div>
  )

  const VIEW_TITLE: Partial<Record<View, string>> = {
    issues: 'ปัญหา / งานแก้', reviews: 'รายการรออนุมัติ', report: 'รายงานปัญหา', history: 'ประวัติการทำงาน', queueAll: 'คิวการผลิต', dept: 'ภาพรวมแผนก',
  }
  const title = VIEW_TITLE[view]
  if (title) {
    const deptStations = myScope.columns ? myScope.columns.filter(isStationCode) : null
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 p-4 sm:p-6">
          <PageHeader title={title} today={today} updated={loadedAt} />
          {linkNotice}{doneNotice}{approvals}
          {view === 'issues' && <IssuesView jobs={allJobs} now={now} role={role} stations={deptStations} call={call} onOpen={setOpenId} />}
          {view === 'report' && <ReportIssueView jobs={allJobs} now={now} stations={myStationsOf(role, myScope.pressStations)} call={call} onOpen={setOpenId} />}
          {view === 'reviews' && <ReviewsView jobs={allJobs} now={now} role={role} call={call} onOpen={setOpenId} />}
          {view === 'history' && <MyHistoryView jobs={allJobs} onOpen={setOpenId} />}
          {view === 'queueAll' && <QueueAllView jobs={allJobs} now={now} onOpen={setOpenId} />}
          {view === 'dept' && <>
            <RoleSummary scope={myScope} jobs={allJobs} machines={machines} now={now}
              onPick={t => { window.location.hash = t === 'todo' ? '#/queue' : t === 'sewing' ? '#/sewing' : '#/board' }} />
            <StationNow jobs={allJobs} now={now} stations={deptStations ?? undefined} />
            <a href="#/issues" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-card px-5 font-semibold text-brand hover:bg-brand-soft">ดูปัญหา / งานแก้ทั้งหมด</a>
          </>}
        </div>
        {drawer}
      </div>
    )
  }

  if (view === 'overview') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 p-4 sm:p-6">
          <PageHeader title="ภาพรวมการผลิต" today={today} updated={loadedAt} />
          {linkNotice}{doneNotice}{approvals}
          {receiveBar}
          <Overview initialView={overviewView} jobs={jobs} now={now} forecast={forecast} floor={floor} products={products} onOpen={setOpenId} />
        </div>
        {drawer}
        {receive}
      </div>
    )
  }

  if (role === 'staff' && myScope.columns?.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 p-4 sm:p-6">
          <PageHeader title={myScope.titleT ?? myScope.title} today={today} updated={loadedAt} />
          <Card className="grid gap-2 border-warn/40 bg-warn-soft p-5">
            <p className="text-lg font-semibold text-warn"><Tr th="ยังไม่ได้จับคู่สถานี" /></p>
            <p><Tr th="ให้เจ้าของระบบจับคู่สถานีให้ที่เมนู จับคู่สถานี" /></p>
          </Card>
        </div>
      </div>
    )
  }

  return (
    // ทั้งหน้าเลื่อนทีเดียว (ไม่ซ้อนกล่องเลื่อน) · แท็บหลักติดด้านบนให้สลับได้ทุกเมื่อ
    <div data-scroll="dashboard" className="min-h-0 flex-1 overflow-y-auto">
     <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={myScope.titleT ?? myScope.title} today={today} updated={loadedAt} />
      {linkNotice}{doneNotice}{approvals}
      {receiveBar}
      {!focusStation && <RoleSummary scope={myScope} jobs={allJobs} machines={machines} now={now}
        onPick={(t, v) => {
          if (!myScope.tabs.includes(t)) return
          setTab(t)
          // เปิดแท็บย่อยของจักรเย็บใหม่ทุกครั้งที่กด แม้อยู่แท็บนั้นแล้ว
          if (v) setSewFocus(f => ({ view: v, n: f.n + 1 }))
        }} />}
      {scope.tabs.length > 1 && (
        <div className="sticky top-0 z-20 -mx-4 bg-paper px-4 py-2 sm:-mx-6 sm:px-6">
        <div role="tablist" aria-label={tx('มุมมอง')} className={`${pillGroup} flex-nowrap sm:inline-flex`}>
          {scope.tabs.map(t => (
            <button key={t} role="tab" aria-selected={activeTab === t} onClick={() => setTab(t)}
              className={`${pillItem} px-2 ${activeTab === t ? pillOn : pillOff}`}>
              <Tr th={DASH_TAB_NAME[t]} />
            </button>
          ))}
        </div>
        </div>
      )}
      {activeTab === 'sewing' ? (
        <ErrorBoundary key="sewing">
          <SewingFloor key={sewFocus.n} initialView={sewFocus.view} initialPick={sewFocus.pick} initialPickNoted={sewFocus.noted}
            onSkip={myScope.canSew ? (jobId, reason) => rpc('note_queue_skip', { p_job: jobId, p_reason: reason }) : undefined} jobs={allJobs} machines={machines} bookings={bookings} needs={needs} shared={shared} now={now} onOpen={setOpenId}
            onStart={myScope.canSew ? startSewing : undefined} onStatus={myScope.canReportMachines ? setMachineStatus : undefined}
            onEta={myScope.canSetRepairEta ? setRepairEta : undefined}
            sewing={<SewingNow jobs={allJobs} machines={machines} now={now} onOpen={setOpenId} actions={myScope.canSew ? sewActions : undefined}
              needs={needs} shared={shared} bookings={bookings} />}
            booking={<BookingPanel jobs={allJobs} machines={machines} bookings={bookings} needs={needs} now={now} onOpen={setOpenId}
              onBook={myScope.canBook ? book : undefined} onCancel={myScope.canBook ? cancelBook : undefined} />} />
        </ErrorBoundary>
      ) : activeTab === 'todo' ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
          <ErrorBoundary key="todo"><TodoPanel jobs={jobs} now={now} onOpen={setOpenId} /></ErrorBoundary>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
          <StationRail columns={columns} station={station}
            counts={key => key === 'all' ? columns.reduce((n, c) => n + (byColumn.get(c.key)?.length ?? 0), 0) : (byColumn.get(key)?.length ?? 0)}
            urgent={key => (byColumn.get(key) ?? []).filter(j => stripe(j, now) === 'danger').length}
            onPick={key => {
              setStation(key)
              requestAnimationFrame(() => document.querySelector('[data-scroll="dashboard"]')?.scrollTo(0, 0))
            }} />
          {focusStation && (
            <StationHeader station={focusStation} jobs={allJobs} stations={columns.map(c => c.key).filter(isStationCode)}
              machines={machineUse(allJobs, data.stationMachines, focusStation)}
              onPick={key => setStation(key)} />
          )}
          {focusStation ? (
            <ErrorBoundary key={`q-${focusStation}`}>
              <StationQueue station={focusStation} jobs={allJobs} role={role}
                onSewStart={myScope.canSew && myScope.tabs.includes('sewing') ? (id, noted) => { setTab('sewing'); setSewFocus(f => ({ view: 'work', pick: id, noted, n: f.n + 1 })) } : undefined} machines={machineUse(allJobs, data.stationMachines, focusStation)} myStations={myScope.pressStations} now={now} call={call} reload={refresh} onOpen={setOpenId} />
            </ErrorBoundary>
          ) : (<>
          <Card className="grid gap-2 p-3 sm:p-4">
            <label className="relative min-w-0">
              <span className="sr-only">{tx('ค้นหางาน')}</span>
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted" />
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={tx('ค้นหาเลขที่ใบยืนยัน ลูกค้า หรือสินค้า')}
                className={`${filterField} pl-10`} />
            </label>
            <details>
              <summary className="min-h-12 cursor-pointer rounded-xl px-3 py-3 font-medium text-brand hover:bg-paper">
                <Tr th={hasFilters ? 'ตัวกรองเพิ่มเติม · กำลังใช้ตัวกรอง' : 'ตัวกรองเพิ่มเติม'} />
              </summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {scoped && myScope.allowFactory && (
                  <div className="sm:col-span-2">
                    <ViewSwitch label={tx('ขอบเขตงาน')} value={wholeFactory ? 'all' : 'mine'} onChange={v => {
                      setWholeFactory(v === 'all')
                      setStation('all')
                      setFilter('all')
                    }} options={[['mine', tx('งานของฉัน')], ['all', tx('ทั้งโรงงาน')]]} />
                  </div>
                )}
                <label className="grid gap-1 font-medium"><Tr th="สถานะ" />
                  <select value={filter} onChange={e => setFilter(e.target.value as Filter)} className={filterField}>
                    {STATUS_FILTERS.filter(([key]) => key !== 'film' || scope.showFilm).map(([key, label]) => (
                      <option key={key} value={key}>{tx(label)}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 font-medium"><Tr th="เส้นทาง" />
                  <select value={route} onChange={e => setRoute(e.target.value as RouteCode | 'all')} className={filterField}>
                    <option value="all">{tx('ทุกเส้นทาง')}</option>
                    {Object.entries(ROUTES).map(([key, item]) => <option key={key} value={key}>{item.short}</option>)}
                  </select>
                </label>
              </div>
            </details>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold" role="status">
              {tx('{where} · {n} งาน', { where: { th: station === 'all' ? 'ทุกสถานี' : COLUMNS.find(c => c.key === station)?.name ?? '' }, n: visibleCount })}
            </p>
            {(hasFilters || query || station !== 'all') && (
              <button type="button" onClick={() => { setQuery(''); setStation('all'); setRoute('all'); setFilter('all'); setWholeFactory(false) }}
                className="min-h-12 rounded-xl border border-line bg-card px-5 font-semibold text-brand hover:border-brand/50">
                <Tr th="ล้างตัวกรอง" />
              </button>
            )}
          </div>
          {visibleCount === 0 ? (
            <Card className="p-5 text-muted"><Tr th="ไม่พบงานตามที่เลือก" /></Card>
          ) : (
            // สถานีเรียงบนลงล่างตามลำดับกระบวนการ อ่านต่อกันได้ ไม่กระโดดซ้าย-ขวาเหมือนตารางหลายคอลัมน์
            <div className="grid min-w-0 gap-5">
              {matchingColumns.map(c => (
                <section key={c.key} className="min-w-0" aria-labelledby={`col-${c.key}`}>
                  <h2 id={`col-${c.key}`} className="mb-2 flex items-center gap-2 text-lg font-bold">
                    {stationNo(c.key) && <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm text-white">{stationNo(c.key)}</span>}
                    <Tr inline th={c.name} />
                    <span className="text-base font-medium text-muted">{tx('{n} งาน', { n: byColumn.get(c.key)?.length ?? 0 })}</span>
                  </h2>
                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {byColumn.get(c.key)?.map(j => <li key={j.id} className="min-w-0"><JobCard job={j} now={now} sampleTag={c.key !== 'sample'} onOpen={() => setOpenId(j.id)} /></li>)}
                  </ul>
                </section>
              ))}
            </div>
          )}
          </>)}
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

function RoleSummary({ scope, jobs, machines, now, onPick }: {
  scope: BoardScope; jobs: Job[]; machines: Parameters<typeof roleSummary>[3]; now: Date; onPick: (tab: DashTab, view?: SewingView) => void
}) {
  const tiles = useMemo(() => roleSummary(scope.summary, jobs.filter(j => jobInScope(j, scope)), jobs, machines, now),
    [scope, jobs, machines, now])
  const dense = scope.summary === 'staff' || scope.summary === 'qc'
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {tiles.map(t => (
        <StatTile key={t.key} icon={SUMMARY_ICON[t.icon]} label={t.label} value={t.value} note={t.note} tone={t.tone} dense={dense}
          onClick={t.tab && scope.tabs.includes(t.tab) ? () => onPick(t.tab!, t.sewingView) : undefined} />
      ))}
    </div>
  )
}

// เวลาอัปเดต = ตอนที่โหลดข้อมูลล่าสุดจากฐานข้อมูล (ไม่ใช่นาฬิกาเครื่อง) คนหน้างานจึงรู้ว่าข้อมูลสดแค่ไหน
function OfflineText({ at }: { at: string }) {
  const t = useT()
  return <>{t('ขาดการเชื่อมต่อ · ข้อมูลอาจไม่ใช่ล่าสุด (อัปเดตล่าสุด {at} น.) · ระบบจะโหลดใหม่เองเมื่อเน็ตกลับมา', { at })}</>
}

function PageHeader({ title, today, updated }: { title: string | Word; today: string; updated: Date }) {
  const tx = useT()
  const head = typeof title === 'string' ? { th: title } : title
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h1 className="min-w-0 text-2xl font-bold"><Tr inline th={head.th} vars={head.vars} /></h1>
      <div className="text-sm text-muted">
        {/* วันที่ยาวแบบไทย (วันเสาร์ที่ … พ.ศ.) คนพม่าอ่านไม่ออก แสดงเฉพาะเวลาอัปเดต */}
        {useLang() === 'th' && <span className="hidden md:inline">{today} · </span>}
        <span>{tx('อัปเดต {at} น.', { at: updated.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}</span>
      </div>
    </header>
  )
}

function stripe(j: Job, now: Date): Tone {
  if (j.phase === 'done') return 'ok'
  if (j.status === 'hold' || isOverdue(j, now) || isOutLate(j, now) || j.sla === 'over' || j.sla === 'report') return 'danger'
  if (isFilmLate(j, now) || j.phase === 'materials' || j.sla === 'warn' || blockedByFilmOrder(j)) return 'warn'
  if (j.status === 'doing') return 'info'
  return 'neutral'
}

const blockedByFilmOrder = (j: Job) => j.station === 'dtf_press' && j.status === 'queued' && isFilmNotOrdered(j)

function JobCard({ job: j, now, sampleTag, onOpen }: { job: Job; now: Date; sampleTag?: boolean; onOpen: () => void }) {
  const tx = useT()
  const label = j.status === 'out' && j.out ? `${tx('ข้างนอก')} · ${j.out.vendor}`
    : j.status === 'hold' ? tx('พักงาน')
    : j.sla ? tx(SLA_LABEL[j.sla].text)
    : isWaitingFilm(j) ? tx('รอฟิล์ม')
    : blockedByFilmOrder(j) ? tx('ยังไม่ได้สั่งฟิล์ม')
    : j.phase === 'done' ? tx(j.delivered ? 'จัดส่งแล้ว' : 'เสร็จ · รอส่ง')
    : j.phase === 'sample' && j.station ? tx(STATION_NAME[j.station])
    : j.status ? tx(STATUS_NAME[j.status]) : null
  const tone = stripe(j, now)
  const StatusIcon = j.status === 'hold' ? IconPause : j.sla ? IconAlert : j.status === 'doing' ? IconPlay : j.status === 'out' ? IconUsers : j.phase === 'done' ? IconCheck : IconClock
  return (
    <button type="button" onClick={onOpen}
      className={`flex h-full w-full min-w-0 items-start gap-3 rounded-xl border border-line border-l-[6px] bg-card px-3 py-2.5 text-left shadow-card hover:border-brand ${STRIPE[tone]}`}>
      <MockupThumb job={j} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-baseline gap-2">
        <b className="text-lg">{j.no}</b>
        <span className="ml-auto text-sm"><DueLabel job={j} now={now} /></span>
      </span>
      <span className="truncate">{j.customer}</span>
      <span className="truncate text-sm text-muted">{j.product} · {j.qty.toLocaleString('th-TH')} {tx(j.unit)}</span>
      {(label || j.rework) && (
        <span className="mt-0.5 flex flex-wrap gap-1">
          {/* ป้ายเวลามาตรฐานใช้สีของตัวเอง (ส้ม/แดง) ไม่ใช้สีแถบ ซึ่งอาจแดงเพราะเลยกำหนดส่ง */}
          {label && <Pill tone={j.sla && label === tx(SLA_LABEL[j.sla].text) ? SLA_LABEL[j.sla].tone : tone}><StatusIcon className="size-4" />{label}</Pill>}
          {j.rework && <Pill tone="danger">{tx('งานแก้')}</Pill>}
          <RevisionPill job={j} />
        </span>
      )}
      {sampleTag && j.phase === 'sample' && <span className="mt-0.5 flex"><Pill tone="info">{tx(j.develop ? 'ตัวอย่าง · Develop' : 'ตัวอย่าง')}</Pill></span>}
      </span>
    </button>
  )
}

// แถบซ้ายของการ์ด (คลาสเต็มเพื่อให้ Tailwind สร้างได้)
const STRIPE: Record<Tone, string> = {
  danger: 'border-l-danger', warn: 'border-l-warn', info: 'border-l-info', ok: 'border-l-ok',
  brand: 'border-l-brand', neutral: 'border-l-line', dtf: 'border-l-dtf',
}

const STATION_KEY = 'pp142.station'

function CardStatus({ job: j, now }: { job: Job; now: Date }) {
  const t = useT()
  const rows: ReactNode[] = []
  const day = (at: Date) => ({ at })

  if (j.phase === 'materials') rows.push(<Pill key="m" tone="warn" dot>รอ {missingDepts(j).map(d => DEPT_NAME[d]).join(', ')}</Pill>)
  if ((j.phase === 'sample' || j.phase === 'production') && j.station && j.status) {
    const tone: Tone = j.status === 'doing' ? 'info' : j.status === 'hold' ? 'danger' : 'neutral'
    rows.push(<Pill key="s" tone={tone} dot>{j.phase === 'sample' ? `${t(STATION_NAME[j.station])} · ` : ''}{t(STATUS_NAME[j.status])}</Pill>)
  }
  if (j.holdReason) rows.push(<span key="h" className="text-danger">{t('สาเหตุ: {reason}', { reason: j.holdReason })}</span>)
  if (j.out) {
    const late = isOutLate(j, now)
    rows.push(<span key="o" className={late ? 'font-semibold text-danger' : 'text-info'}>{t(late ? 'ที่ {vendor} · คาดว่าของถึง {at} (เลยกำหนด)' : 'ที่ {vendor} · คาดว่าของถึง {at}', { vendor: j.out.vendor, at: day(j.out.backAt) })}</span>)
  }
  if (j.phase === 'sample_review') rows.push(<Pill key="r" tone="info" dot>{t('รอลูกค้ายืนยัน (รอบ {n})', { n: j.sampleRound })}</Pill>)
  if (j.rework) rows.push(<span key="w" className="text-danger">{t('แก้ {qty} {unit} · {reason}', { qty: j.rework.qty, unit: { th: j.unit }, reason: j.rework.reason })}</span>)

  if (isWaitingFilm(j)) {
    const late = isFilmLate(j, now)
    rows.push(<Pill key="film" tone={late ? 'danger' : 'warn'}><IconFilm className="size-3" />{t(late ? 'รอฟิล์ม · ETA {at} (เลยแล้ว)' : 'รอฟิล์ม · ETA {at}', { at: day(j.film!.eta) })}</Pill>)
  }
  if (j.phase === 'done' && j.doneAt) rows.push(<Pill key="d" tone="ok"><IconCheck className="size-3" />{t('เสร็จ{day} {time} น.', { day: relDayWord(j.doneAt, now), time: j.doneAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) })}</Pill>)
  if (j.phase === 'done') rows.push(j.delivered
    ? <Pill key="dl" tone="ok" dot>{t('จัดส่งแล้ว{day}', { day: relDayWord(j.delivered.at, now) })}{j.delivered.note && ` · ${j.delivered.note}`}</Pill>
    : <Pill key="dl" tone="warn" dot>{t('รอจัดส่ง')}</Pill>)

  if (!rows.length) return null
  return <div className="mt-2.5 flex flex-col items-start gap-1.5 border-t border-dashed border-line pt-2.5 text-xs">{rows}</div>
}

export function JobDrawer({ job: j, now, finish, onClose, actions, history }: { job: Job; now: Date; finish?: Date; onClose: () => void; actions?: ReactNode; history?: ReactNode }) {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stations = ROUTES[j.route].stations
  const curIdx = j.station ? stations.indexOf(j.station) : -1
  const late = finish ? lateDays(finish, j.due) : 0
  const since = durationWord(now.getTime() - j.since.getTime())
  const steps: { label: Word; state: StepState }[] = [
    { label: { th: 'รับงานเข้า' }, state: 'done' },
    ...(j.needsSample === false ? [] : [
      { label: j.sampleRound > 1 ? { th: 'ขึ้นตัวอย่าง (รอบ {n})', vars: { n: j.sampleRound } } : { th: 'ขึ้นตัวอย่าง' }, state: (j.phase === 'materials' ? 'todo' : j.phase === 'sample' ? 'current' : 'done') as StepState },
      { label: { th: 'ลูกค้ายืนยันตัวอย่าง' }, state: (['materials', 'sample'].includes(j.phase) ? 'todo' : j.phase === 'sample_review' ? 'current' : 'done') as StepState },
    ]),
    ...(j.develop ? [] : stations).map((s, i) => ({
      label: { th: STATION_NAME[s] },
      state: (j.phase === 'done' ? 'done' : j.phase !== 'production' ? 'todo' : i < curIdx ? 'done' : i === curIdx ? (j.status === 'hold' ? 'hold' : 'current') : 'todo') as StepState,
    })),
    { label: { th: 'เสร็จ / พร้อมส่ง' }, state: j.phase === 'done' ? 'done' : 'todo' },
    { label: { th: 'จัดส่งแล้ว' }, state: j.delivered ? 'done' : j.phase === 'done' ? 'current' : 'todo' },
  ]

  return (
    <div className="fixed inset-0 z-30 flex animate-fade justify-end bg-ink/40" onClick={onClose}>
      <aside onClick={e => e.stopPropagation()} role="dialog" aria-label={t('รายละเอียดงาน {no}', { no: j.no })}
        className="flex h-full w-full max-w-md animate-drawer flex-col overflow-y-auto border-l border-line bg-paper shadow-lift">
        <header className="sticky top-0 z-10 border-b border-line bg-card px-5 pt-5 pb-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{j.no}</h2>
                <RouteBadge route={j.route} />
              </div>
              <p className="truncate text-muted">{j.customer}</p>
            </div>
            <button onClick={onClose} className="ml-auto grid size-12 place-items-center rounded-full bg-paper transition hover:bg-line" aria-label={t('ปิด')}><IconX className="size-4" /></button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <a href={'#/label?id=' + encodeURIComponent(j.id)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line px-3 font-semibold text-brand hover:bg-brand-soft">
              <IconClipboard className="size-5 shrink-0" /><Tr th="พิมพ์ใบปะงาน" />
            </a>
            <a href={'#/mockup?id=' + encodeURIComponent(j.id)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line px-3 font-semibold text-brand hover:bg-brand-soft">
              <IconImage className="size-5 shrink-0" /><Tr th="ม็อคอัพกำกับสเปก" />
            </a>
          </div>
          {finish && (
            <div className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-sm ${late > 0 ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>
              {late > 0 ? <IconAlert className="size-4" /> : <IconCheck className="size-4" />}
              <span>{t('คาดว่าเสร็จ {at}', { at: { at: finish } })}</span>
              <span className="ml-auto text-xs opacity-90">{late > 0 ? t('ไม่ทันกำหนด {n} วัน', { n: late }) : t('ทันกำหนดส่ง')}</span>
            </div>
          )}
        </header>

        <div className="grid gap-4 p-4 text-sm">
          {actions}
          {j.mockupUrl ? (
            <div className="grid justify-items-center gap-1 rounded-2xl border border-line bg-card p-3 shadow-card">
              {j.specSheet
                ? <a href={'#/mockup?id=' + encodeURIComponent(j.id)} className="w-full max-w-72" aria-label={t('เปิดม็อคอัพกำกับสเปก')}><MockupThumb job={j} size="lg" /></a>
                : <a href={j.mockupUrl} target="_blank" rel="noreferrer" className="w-full max-w-72" aria-label={t('เปิดรูปม็อคอัพเต็มจอ')}><MockupThumb job={j} size="lg" /></a>}
              <span className={`text-center ${j.specSheet ? 'font-semibold text-brand' : 'text-muted'}`}>
                {j.specSheet ? <Tr th="กดที่รูปเพื่อดูม็อคอัพกำกับสเปก ฉบับ {rev}" vars={{ rev: j.specSheet.rev }} /> : <Tr th="กดที่รูปเพื่อดูเต็มจอ" />}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3 text-muted shadow-card">
              <MockupThumb job={j} />
              {j.specSheet
                ? <a href={'#/mockup?id=' + encodeURIComponent(j.id)} className="inline-flex min-h-12 items-center font-semibold text-brand"><Tr th="เปิดม็อคอัพกำกับสเปก" /></a>
                : <Tr th="ยังไม่มีรูปม็อคอัพ" />}
            </div>
          )}
          <JobVariants job={j} />
          <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Info label="สินค้า">{j.product}</Info>
              <Info label="จำนวน">{j.qty.toLocaleString('th-TH')} {t(j.unit)}</Info>
              <Info label="กำหนดส่ง"><DueLabel job={j} now={now} long /></Info>
              <Info label="เส้นทาง">{t(ROUTES[j.route].name)}</Info>
              <Info label="ตัวอย่าง">{j.needsSample === false ? t('ไม่ขึ้นตัวอย่าง')
                : j.develop ? t(j.phase === 'done' ? 'งาน Develop · ผ่านแล้ว (รอบ {n}) · ไม่ผลิตจริง' : 'งาน Develop · รอบที่ {n} · ผ่านแล้วจบงาน ไม่ผลิตจริง', { n: j.sampleRound })
                : t(j.phase === 'production' || j.phase === 'done' ? 'รอบที่ {n} · ผ่านแล้ว' : 'รอบที่ {n}', { n: j.sampleRound })}</Info>
              <Info label="อยู่ในขั้นนี้">{j.phase === 'done' ? '—' : t(since.th, since.vars)}</Info>
            </dl>
            <CardStatus job={j} now={now} />
          </div>

          {!!j.sewingReports?.length && (
            <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
              <h3 className="mb-2 font-semibold"><Tr inline th="รายงานปัญหาระหว่างเย็บ" /></h3>
              <ul className="divide-y divide-line">
                {j.sewingReports.map((report, index) => (
                  <li key={index} className="py-2">
                    <p className="break-words">{report.reason}</p>
                    <p className="text-sm text-muted">
                      {report.at.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}{report.paused ? ` · ${t('พักงาน')}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <h3 className="mb-3 font-semibold"><Tr inline th="ความคืบหน้า" /></h3>
            <ol>{steps.map((s, i) => <Step key={i} label={s.label} state={s.state} last={i === steps.length - 1} />)}</ol>
          </div>

          {/* แสดงเฉพาะงานเก่าที่ยังค้างขั้นวัตถุดิบ (ยกเลิกขั้นนี้แล้ว) และสถานะฟิล์ม */}
          {(j.phase === 'materials' || j.film) && (
          <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <h3 className="mb-2 font-semibold">{j.phase === 'materials' ? 'วัตถุดิบ' : <Tr inline th={filmLabel(j.route)} />}</h3>
            <ul className="grid gap-2">
              {j.phase === 'materials' && (['admin', 'qc', 'production'] as const).map(d => (
                <li key={d} className="flex items-center gap-2">
                  {j.materials[d] ? <IconCheck className="size-4 text-ok" /> : <IconClock className="size-4 text-warn" />}
                  <span className="flex-1">{DEPT_NAME[d]}</span>
                  <Pill tone={j.materials[d] ? 'ok' : 'warn'}>{j.materials[d] ? 'ติ๊กครบ' : 'ยังไม่ติ๊ก'}</Pill>
                </li>
              ))}
              {j.film && (
                <li className="flex items-center gap-2">
                  <IconFilm className={`size-4 ${j.film.received ? 'text-ok' : isFilmLate(j, now) ? 'text-danger' : 'text-warn'}`} />
                  <span className="flex-1">{t(filmLabel(j.route))}</span>
                  <Pill tone={j.film.received ? 'ok' : isFilmLate(j, now) ? 'danger' : 'warn'}>{j.film.received ? t('ได้รับแล้ว') : t('ETA {at}', { at: { at: j.film.eta } })}</Pill>
                </li>
              )}
            </ul>
          </div>
          )}

          {history}
        </div>
      </aside>
    </div>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-muted"><Tr th={label} /></dt><dd className="font-medium">{children}</dd></div>
}

type StepState = 'done' | 'current' | 'hold' | 'todo'
function Step({ label, state, last }: { label: Word; state: StepState; last: boolean }) {
  const dot = { done: 'bg-brand-700 text-white', current: 'bg-info text-white ring-4 ring-info/15', hold: 'bg-danger text-white ring-4 ring-danger/15', todo: 'border-2 border-line bg-card' }[state]
  const text = { done: 'text-muted', current: 'font-semibold', hold: 'font-semibold text-danger', todo: 'text-muted/70' }[state]
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!last && <span className={`absolute top-6 left-[11px] h-[calc(100%-18px)] w-0.5 ${state === 'done' ? 'bg-brand' : 'bg-line'}`} />}
      <span className={`relative grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${dot}`}>{state === 'done' ? '✓' : state === 'hold' ? '!' : ''}</span>
      <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 ${text}`}><Tr th={label.th} vars={label.vars} />
        {state === 'current' && <Pill tone="info"><Tr th="ตอนนี้" /></Pill>}
        {state === 'hold' && <Pill tone="danger"><Tr th="ติดปัญหา" /></Pill>}
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

function stationFromHash(): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('station')
}

// อ่านแล้วเอา ?station= ออก ไม่อย่างนั้นรีเฟรชจะทับสถานีที่คนหน้างานเลือกเองทีหลัง
function clearStationLink() {
  window.history.replaceState(null, '', window.location.hash.split('?')[0])
}

function jobFromHash(): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('job')
}
