import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Pill } from '../../components/ui'
import { FilePick } from '../../components/FilePick'
import { dangerBtn, fieldClass, okBtn, primaryBtn, secondaryBtn } from '../../components/Dialog'
import { IconAlert, IconCheck, IconImage, IconPrinter } from '../../components/icons'
import { canAckMockup, canApproveMockup, canEditMockup, canOpenPage, canSeeMockupDraft, type EmployeeRole } from '../../auth/access'
import { STATION_NAME, type StationCode } from '../../proto/model'
import {
  SHEET_STATUS, VIEW_NAME, VIEW_ORDER, calloutLines, forStation, historyEdit, historyOf, redo, saveProblems, submitProblems,
  toPayload, undo, type Callout, type Draft, type Edit, type History, type ViewKey,
} from '../../proto/annotation'
import {
  ackSheet, approveSheet, discardDraft, loadMockupJob, loadSheet, newKey, parseUnsaved, pickSheets, returnSheet, saveDraft, startSheet,
  submitSheet, unsavedKey, uploadOriginal, type MockupData, type SheetRow,
} from '../../data/mockupSheets'
import { mockupProblem, signMockups } from '../../data/mockups'
import { isJobId } from '../../data/useFactoryData'
import { thaiError } from '../../data/live'
import { AnnotationCanvas } from './AnnotationCanvas'
import { SpecPanel } from './SpecPanel'

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—'
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3]
type Msg = { ok: boolean; text: string } | null

function useWide() {
  const query = '(min-width: 768px)'
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null
  return <p role={msg.ok ? 'status' : 'alert'} className={`rounded-xl px-3 py-2 font-medium ${msg.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>{msg.text}</p>
}

type PageState = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; data: MockupData }

async function fetchPage(jobId: string): Promise<PageState> {
  try {
    const data = await loadMockupJob(jobId.toLowerCase())
    return data ? { status: 'ready', data } : { status: 'missing' }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : thaiError(undefined) }
  }
}

export default function MockupPage({ jobId, role, myStations }: { jobId: string; role: EmployeeRole; myStations: StationCode[] }) {
  const [state, setState] = useState<PageState>(
    () => (isJobId(jobId) ? { status: 'loading' } : { status: 'missing' }))
  const [tab, setTab] = useState<'view' | 'work' | null>(null)
  const reload = useCallback(async () => { if (isJobId(jobId)) setState(await fetchPage(jobId)) }, [jobId])
  useEffect(() => {
    if (!isJobId(jobId)) return
    let live = true
    void fetchPage(jobId).then(s => { if (live) setState(s) })
    return () => { live = false }
  }, [jobId])

  if (state.status !== 'ready') {
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <Card className="grid grid-cols-[minmax(0,1fr)] gap-2 p-5">
          <h1 className="text-xl font-bold">ม็อคอัพกำกับสเปก</h1>
          {state.status === 'loading' && <p role="status" className="text-muted">กำลังโหลด…</p>}
          {state.status === 'missing' && <p role="alert" className="text-danger">ไม่พบงานนี้ · เปิดจากรายละเอียดงานอีกครั้ง</p>}
          {state.status === 'error' && <>
            <p role="alert" className="text-danger">โหลดไม่สำเร็จ · {state.message}</p>
            <button type="button" className={secondaryBtn} onClick={() => void reload()}>ลองอีกครั้ง</button>
          </>}
        </Card>
      </div>
    )
  }

  const { data } = state
  const { approved, open } = pickSheets(data.sheets)
  const seeOpen = !!open && canSeeMockupDraft(role)
  const auto = seeOpen && (canEditMockup(role) || (open?.status === 'pending' && canApproveMockup(role))) ? 'work' : approved ? 'view' : seeOpen ? 'work' : 'view'
  const current = tab === 'work' && seeOpen ? 'work' : tab === 'view' && approved ? 'view' : auto
  const history = data.sheets.filter(s => s.status === 'approved' || s.status === 'superseded')

  return (
    <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-4 p-3 sm:p-5">
      <Card className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><IconImage className="size-6" /></span>
          <div className="min-w-[12rem] flex-1">
            <p className="text-sm text-muted">ม็อคอัพกำกับสเปก</p>
            <h1 className="text-2xl font-bold [overflow-wrap:anywhere]">{data.job.no} <span className="font-medium text-muted">· {data.job.customer}</span></h1>
            <p className="text-muted">{data.job.jobName} · {data.job.qty.toLocaleString('th-TH')} {data.job.unit}</p>
          </div>
          <a href={`#/board?job=${encodeURIComponent(data.job.id)}`} className={secondaryBtn}>กลับไปที่งาน</a>
        </div>
        <div className="flex flex-wrap gap-2">
          {approved
            ? <Pill tone="ok" dot>ใช้ผลิต: ฉบับ {approved.rev} · อนุมัติ {when(approved.approved_at)} โดย {data.names.get(approved.approved_by ?? '') ?? '—'}</Pill>
            : <Pill tone="neutral">ยังไม่มีฉบับที่อนุมัติ</Pill>}
          {open && <Pill tone={SHEET_STATUS[open.status].tone} dot>ฉบับ {open.rev}: {SHEET_STATUS[open.status].text}</Pill>}
        </div>
        {approved && open && (
          <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn">
            <IconAlert className="mt-0.5 size-5 shrink-0" />มีฉบับแก้ไข {open.rev} {SHEET_STATUS[open.status].text} · ยังผลิตตามฉบับ {approved.rev} จนกว่าจะอนุมัติ
          </p>
        )}
        {(approved && seeOpen) && (
          <div role="tablist" className="flex gap-1 rounded-xl border border-line bg-card p-1">
            {([['view', `ดูสเปก (ฉบับ ${approved.rev} ใช้ผลิต)`], ['work', `${canEditMockup(role) && open?.status === 'draft' ? 'แก้ไข' : 'ตรวจ'} ฉบับ ${open?.rev}`]] as const).map(([k, n]) => (
              <button key={k} type="button" role="tab" aria-selected={current === k} onClick={() => setTab(k)}
                className={`min-h-12 flex-1 rounded-lg px-3 font-semibold ${current === k ? 'bg-brand text-white' : 'hover:bg-paper'}`}>{n}</button>
            ))}
          </div>
        )}
      </Card>

      {!approved && !open && <StartSheet data={data} role={role} reload={reload} />}
      {approved && !open && canEditMockup(role) && <StartSheet data={data} role={role} reload={reload} revision={approved.rev} />}
      {current === 'work' && open && seeOpen && <SheetWork key={`${open.id}:${open.version}`} data={data} sheet={open} approved={approved} role={role} reload={reload} />}
      {current === 'view' && approved && <SheetViewer key={approved.id} data={data} sheet={approved} role={role} myStations={myStations} reload={reload} />}
      {!approved && open && !seeOpen && (
        <Card className="p-5"><p className="text-muted">ม็อคอัพของงานนี้ยังไม่อนุมัติ · รอฝ่ายผลิตหรือผู้บริหารอนุมัติก่อนจึงจะใช้ผลิตได้</p></Card>
      )}

      {history.length > 0 && (
        <Card className="grid grid-cols-[minmax(0,1fr)] gap-2 p-4">
          <h2 className="font-bold">ประวัติฉบับ</h2>
          <ul className="grid gap-1">
            {history.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Pill tone={SHEET_STATUS[s.status].tone}>ฉบับ {s.rev} · {SHEET_STATUS[s.status].text}</Pill>
                <span>อนุมัติ {when(s.approved_at)} โดย {data.names.get(s.approved_by ?? '') ?? '—'}</span>
                {s.change_reason && <span className="text-muted">· แก้เพราะ {s.change_reason}</span>}
                {canOpenPage(role, 'artwork') && <a className="font-semibold text-brand underline" href={`#/artwork?id=${data.job.id}&sheet=${s.id}`}>พิมพ์ฉบับนี้</a>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function StartSheet({ data, role, reload, revision }: { data: MockupData; role: EmployeeRole; reload: () => Promise<void>; revision?: number }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  if (!canEditMockup(role)) {
    return <Card className="p-5"><p className="text-muted">งานนี้ยังไม่มีม็อคอัพกำกับสเปก · แอดมินเป็นคนทำ</p></Card>
  }
  const start = async () => {
    setBusy(true)
    const r = await startSheet(data.job.id, revision ? reason.trim() : undefined)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.reason }); return }
    await reload()
  }
  return (
    <Card className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
      {revision ? <>
        <h2 className="font-bold">แก้ไขม็อคอัพ (สร้างฉบับ {Math.max(...data.sheets.map(s => s.rev)) + 1} จากฉบับ {revision})</h2>
        <p className="text-muted">ฉบับ {revision} ยังใช้ผลิตต่อจนกว่าฉบับใหม่จะอนุมัติ{data.job.started && ' · งานนี้เริ่มผลิตแล้ว ฉบับใหม่ต้องให้ผู้บริหารหรือเจ้าของอนุมัติ'}</p>
        <label className="grid gap-1 font-semibold">เหตุผลที่แก้
          <input value={reason} onChange={e => setReason(e.target.value)} className={`${fieldClass} font-normal`} placeholder="เช่น ลูกค้าขอขยายโลโก้" />
        </label>
        <button type="button" className={secondaryBtn} disabled={busy || !reason.trim()} onClick={() => void start()}>
          {!reason.trim() ? 'ใส่เหตุผลก่อน' : busy ? 'กำลังสร้าง…' : 'สร้างฉบับแก้ไข'}
        </button>
      </> : <>
        <h2 className="font-bold">ยังไม่มีม็อคอัพกำกับสเปก</h2>
        <p className="text-muted">อัปโหลดภาพม็อคอัพ (ภาพเดียวที่มีทั้งด้านหน้าและหลังก็ได้) แล้วกดบนภาพเพื่อชี้จุดและผูกสเปก · ข้อมูลในใบยืนยันเลือกใช้ได้เลยไม่ต้องกรอกซ้ำ</p>
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => void start()}>{busy ? 'กำลังสร้าง…' : 'เริ่มทำม็อคอัพกำกับสเปก'}</button>
      </>}
      <Note msg={msg} />
    </Card>
  )
}

function ViewTabs({ views, value, onChange, counts }: { views: ViewKey[]; value: ViewKey; onChange: (v: ViewKey) => void; counts: (v: ViewKey) => number }) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="มุมภาพ">
      {views.map(v => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={`min-h-12 rounded-xl border px-4 font-semibold ${value === v ? 'border-brand bg-brand text-white' : 'border-line bg-card hover:border-brand'}`}>
          {VIEW_NAME[v]} <span className="opacity-80">({counts(v)})</span>
        </button>
      ))}
    </div>
  )
}

function Zoom({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const i = ZOOMS.indexOf(zoom)
  return (
    <div className="flex items-center gap-1" aria-label="ซูม">
      <button type="button" className={`${secondaryBtn} px-4`} disabled={i <= 0} onClick={() => setZoom(ZOOMS[i - 1]!)} aria-label="ย่อ">−</button>
      <button type="button" className="min-h-12 min-w-16 rounded-xl px-2 font-semibold tabular-nums hover:bg-paper" onClick={() => setZoom(1)} aria-label="พอดีจอ">{Math.round(zoom * 100)}%</button>
      <button type="button" className={`${secondaryBtn} px-4`} disabled={i >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[i + 1]!)} aria-label="ขยาย">+</button>
    </div>
  )
}

function CalloutList({ draft, selected, onSelect, edit, jobSpec }: {
  draft: Draft; selected: string | null; onSelect: (c: Callout) => void; edit?: (e: Edit) => void; jobSpec: unknown
}) {
  const list = [...draft.callouts].sort((a, b) => a.no - b.no)
  if (!list.length) return <p className="text-muted">ยังไม่มี Callout</p>
  return (
    <ol className="grid gap-1">
      {list.map(c => {
        const ok = !!(c.specRef || c.specKey || c.body.trim()) && !!c.title.trim()
        return (
          <li key={c.key} className={`flex items-center gap-1 rounded-xl border ${c.key === selected ? 'border-brand bg-brand-soft' : 'border-line bg-card'}`}>
            <button type="button" onClick={() => onSelect(c)} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-2 text-left">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white">{c.no}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.title || '(ยังไม่ตั้งชื่อ)'}</span>
                <span className={`block truncate text-sm ${ok ? 'text-muted' : 'text-warn'}`}>
                  {ok ? `${VIEW_NAME[c.view]} · ${calloutLines(c, draft, jobSpec)[0] ?? ''}` : `${VIEW_NAME[c.view]} · ยังไม่มีสเปก`}
                </span>
              </span>
              {ok ? <IconCheck className="size-5 shrink-0 text-ok" /> : <IconAlert className="size-5 shrink-0 text-warn" />}
            </button>
            {edit && <span className="flex shrink-0 flex-col">
              <button type="button" className="h-6 w-10 rounded-t-lg text-muted hover:bg-paper" aria-label={`เลื่อน ${c.no} ขึ้น`} onClick={() => edit({ type: 'reorder_callout', key: c.key, dir: -1 })}>▲</button>
              <button type="button" className="h-6 w-10 rounded-b-lg text-muted hover:bg-paper" aria-label={`เลื่อน ${c.no} ลง`} onClick={() => edit({ type: 'reorder_callout', key: c.key, dir: 1 })}>▼</button>
            </span>}
          </li>
        )
      })}
    </ol>
  )
}

function SheetWork({ data, sheet, approved, role, reload }: {
  data: MockupData; sheet: SheetRow; approved: SheetRow | null; role: EmployeeRole; reload: () => Promise<void>
}) {
  const wide = useWide()
  const [loaded, setLoaded] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; saved: Draft }>({ status: 'loading' })
  const [hist, setHist] = useState<History>(() => historyOf({ views: [], specs: [], callouts: [] }))
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [view, setView] = useState<ViewKey>('front')
  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [conflict, setConflict] = useState(false)
  const [upload, setUpload] = useState<{ view: ViewKey; file: File | null; preview: string }>({ view: 'front', file: null, preview: '' })
  useEffect(() => () => { if (upload.preview) URL.revokeObjectURL(upload.preview) }, [upload.preview])
  const [decision, setDecision] = useState({ note: '', reason: '' })
  const [recover, setRecover] = useState<Draft | null>(null)
  const storeKey = unsavedKey(sheet.id, sheet.version)

  useEffect(() => {
    let live = true
    loadSheet(sheet.id).then(r => {
      if (!live) return
      setHist(historyOf(r.draft))
      setUrls(r.urls)
      setLoaded({ status: 'ready', saved: r.draft })
      setView(r.draft.views[0]?.view ?? 'front')
      setUpload(u => ({ ...u, view: VIEW_ORDER.find(v => !r.draft.views.some(x => x.view === v)) ?? 'front' }))
      try { setRecover(parseUnsaved(localStorage.getItem(storeKey))) } catch { /* เครื่องที่ปิดการเก็บข้อมูล: ไม่มีงานค้างให้กู้ */ }
    }).catch((e: unknown) => { if (live) setLoaded({ status: 'error', message: e instanceof Error ? e.message : thaiError(undefined) }) })
    return () => { live = false }
  }, [sheet.id, storeKey])

  const draft = hist.present
  const editable = sheet.status === 'draft' && canEditMockup(role) && wide
  const dirty = loaded.status === 'ready' && draft !== loaded.saved
  // เปลี่ยนหน้าในแอป / แท็บเล็ตปิดแท็บเอง ไม่มีกล่องเตือน → เก็บงานที่ยังไม่บันทึกไว้ในเครื่องให้กู้คืน
  useEffect(() => {
    if (loaded.status !== 'ready' || !editable) return
    try {
      if (dirty) localStorage.setItem(storeKey, JSON.stringify(draft))
      else if (!recover) localStorage.removeItem(storeKey)
    } catch { /* เก็บไม่ได้ก็ยังแก้ต่อได้ */ }
  }, [draft, dirty, editable, loaded.status, recover, storeKey])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const edit = useCallback((e: Edit, tag?: string) => setHist(h => historyEdit(h, e, tag)), [])
  useEffect(() => {
    if (!editable) return
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))) return
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); setHist(h => (e.shiftKey ? redo(h) : undo(h))) }
      if (e.key.toLowerCase() === 'y') { e.preventDefault(); setHist(redo) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [editable])

  if (loaded.status === 'loading') return <Card className="p-5"><p role="status" className="text-muted">กำลังโหลดฉบับ {sheet.rev}…</p></Card>
  if (loaded.status === 'error') return <Card className="p-5"><p role="alert" className="text-danger">โหลดฉบับ {sheet.rev} ไม่สำเร็จ · {loaded.message}</p></Card>

  const views = draft.views.map(v => v.view)
  const shown = draft.views.find(v => v.view === view) ?? draft.views[0]
  const callout = draft.callouts.find(c => c.key === selected) ?? null
  const onView = shown ? draft.callouts.filter(c => c.view === shown.view) : []
  const fail = (text: string) => { setMsg({ ok: false, text }); setConflict(/มีคนบันทึก/.test(text)) }

  const doUpload = async () => {
    if (!upload.file) return
    setBusy('upload'); setMsg(null)
    const r = await uploadOriginal(data.job.no, upload.file, upload.view)
    setBusy('')
    if (!r.ok) { fail(r.reason); return }
    setUrls(m => new Map(m).set(r.data.path, r.data.url))
    edit({ type: 'set_view', view: { view: r.data.view, path: r.data.path, width: r.data.width, height: r.data.height } })
    setView(r.data.view)
    setUpload({ view: VIEW_ORDER.find(v => v !== r.data.view && !views.includes(v)) ?? 'detail', file: null, preview: '' })
    setMsg({ ok: true, text: `เพิ่มภาพ${VIEW_NAME[r.data.view]}แล้ว · กดบันทึกร่างเพื่อเก็บ` })
  }
  const save = async (): Promise<number | null> => {
    const problems = saveProblems(draft)
    if (problems.length) { fail(problems.join(' · ')); return null }
    setBusy('save'); setMsg(null)
    const r = await saveDraft(sheet.id, sheet.version, toPayload(draft))
    setBusy('')
    if (!r.ok) { fail(r.reason); return null }
    return r.data
  }
  const forget = () => { try { localStorage.removeItem(storeKey) } catch { /* ไม่มีอะไรให้ลบ */ } }
  const saveAndReload = async () => { if (await save() !== null) { forget(); await reload() } }
  const restore = async () => {
    if (!recover) return
    const missing = recover.views.map(v => v.path).filter(p => !urls.has(p))
    if (missing.length) { const signed = await signMockups(missing); setUrls(m => new Map([...m, ...signed])) }
    setHist(h => ({ past: [...h.past, h.present], present: recover, future: [] }))
    setView(recover.views[0]?.view ?? 'front')
    setRecover(null)
  }
  const submit = async () => {
    const problems = submitProblems(draft)
    if (problems.length) { fail(problems.join(' · ')); return }
    const version = dirty ? await save() : sheet.version
    if (version === null) return
    setBusy('submit')
    const r = await submitSheet(sheet.id, version)
    setBusy('')
    if (!r.ok) { fail(r.reason); if (dirty) await reload(); return }
    forget()
    await reload()
  }
  const discard = async () => {
    if (!window.confirm(`ทิ้งฉบับร่าง ${sheet.rev} ทั้งหมด? ภาพที่อัปโหลดยังอยู่ แต่จุดและสเปกในร่างนี้จะหาย`)) return
    setBusy('discard')
    const r = await discardDraft(sheet.id)
    setBusy('')
    if (!r.ok) { fail(r.reason); return }
    forget()
    await reload()
  }
  const decide = async (kind: 'approve' | 'return') => {
    setBusy(kind); setMsg(null)
    const r = kind === 'approve' ? await approveSheet(sheet.id, decision.note) : await returnSheet(sheet.id, decision.reason)
    setBusy('')
    if (!r.ok) { fail(r.reason); return }
    await reload()
  }

  const approverBlocked = sheet.status === 'pending' && role === 'production' && !!approved && data.job.started
    ? 'งานนี้เริ่มผลิตแล้ว ฉบับแก้ไขต้องให้ผู้บริหารหรือเจ้าของอนุมัติ' : ''
  const submitIssues = submitProblems(draft)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Pill tone={SHEET_STATUS[sheet.status].tone} dot>ฉบับ {sheet.rev} · {SHEET_STATUS[sheet.status].text}</Pill>
        {dirty && <Pill tone="warn">ยังไม่ได้บันทึก</Pill>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Zoom zoom={zoom} setZoom={setZoom} />
          {editable && <>
            <button type="button" className={`${secondaryBtn} px-4`} disabled={!hist.past.length} onClick={() => setHist(undo)} aria-label="ย้อนกลับ (Undo)">↶ ย้อน</button>
            <button type="button" className={`${secondaryBtn} px-4`} disabled={!hist.future.length} onClick={() => setHist(redo)} aria-label="ทำซ้ำ (Redo)">↷ ทำซ้ำ</button>
            <button type="button" className={secondaryBtn} disabled={!!busy || !dirty} onClick={() => void saveAndReload()}>{busy === 'save' ? 'กำลังบันทึก…' : 'บันทึกร่าง'}</button>
            <button type="button" className={primaryBtn} disabled={!!busy || submitIssues.length > 0}
              title={submitIssues.join(' · ')} onClick={() => void submit()}>{busy === 'submit' ? 'กำลังส่ง…' : 'ส่งอนุมัติ'}</button>
          </>}
        </span>
        {editable && submitIssues.length > 0 && <p className="w-full text-sm text-warn">ส่งอนุมัติไม่ได้: {submitIssues.join(' · ')}</p>}
      </Card>

      {sheet.status === 'draft' && sheet.return_reason && (
        <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger"><IconAlert className="mt-0.5 size-5 shrink-0" />ถูกส่งกลับให้แก้: {sheet.return_reason}</p>
      )}
      {sheet.change_reason && <p className="text-muted">ฉบับนี้แก้จากฉบับ {approved?.rev ?? '—'} เพราะ {sheet.change_reason}</p>}
      {sheet.status === 'draft' && canEditMockup(role) && !wide && (
        <p className="rounded-xl bg-info-soft px-3 py-2 text-info">แก้ไขม็อคอัพต้องใช้จอกว้าง 768 px ขึ้นไป (แท็บเล็ตแนวนอน / คอมพิวเตอร์) · มือถือดูได้อย่างเดียว</p>
      )}
      {recover && editable && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn">
          <IconAlert className="size-5 shrink-0" />มีงานที่ยังไม่ได้บันทึกจากครั้งก่อนในเครื่องนี้ ({recover.callouts.length} จุด · {recover.views.length} ภาพ)
          <span className="ml-auto flex gap-2">
            <button type="button" className={primaryBtn} onClick={() => void restore()}>กู้คืน</button>
            <button type="button" className={secondaryBtn} onClick={() => { forget(); setRecover(null) }}>ทิ้ง</button>
          </span>
        </div>
      )}
      <Note msg={msg} />
      {conflict && <button type="button" className={secondaryBtn} onClick={() => void reload()}>โหลดใหม่ (งานที่ยังไม่บันทึกจะหาย)</button>}

      {sheet.status === 'pending' && (
        <Card className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
          <h2 className="font-bold">รออนุมัติ · ส่งโดย {data.names.get(sheet.submitted_by ?? '') ?? '—'} {when(sheet.submitted_at)}</h2>
          {canApproveMockup(role) ? <>
            <label className="grid gap-1 font-semibold">หมายเหตุการอนุมัติ (ถ้ามี)
              <input value={decision.note} onChange={e => setDecision(d => ({ ...d, note: e.target.value }))} className={`${fieldClass} font-normal`} />
            </label>
            {approverBlocked && <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn">{approverBlocked}</p>}
            <button type="button" className={okBtn} disabled={!!busy || !!approverBlocked} onClick={() => void decide('approve')}>
              <IconCheck className="size-5" />{busy === 'approve' ? 'กำลังอนุมัติ…' : approverBlocked ? 'อนุมัติไม่ได้' : `อนุมัติฉบับ ${sheet.rev} ใช้ผลิต`}
            </button>
            <label className="grid gap-1 font-semibold">เหตุผลที่ส่งกลับให้แก้
              <input value={decision.reason} onChange={e => setDecision(d => ({ ...d, reason: e.target.value }))} className={`${fieldClass} font-normal`} placeholder="เช่น ขนาดโลโก้ไม่ตรงใบยืนยัน" />
            </label>
            <button type="button" className={dangerBtn} disabled={!!busy || !decision.reason.trim()} onClick={() => void decide('return')}>
              {decision.reason.trim() ? (busy === 'return' ? 'กำลังส่งกลับ…' : 'ส่งกลับให้แอดมินแก้') : 'ใส่เหตุผลก่อนส่งกลับ'}
            </button>
          </> : <p className="text-muted">{role === 'admin' ? 'แอดมินอนุมัติเองไม่ได้ · รอฝ่ายผลิต ผู้บริหาร หรือเจ้าของ' : 'รอฝ่ายผลิต ผู้บริหาร หรือเจ้าของอนุมัติ'}</p>}
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[260px_minmax(0,1fr)_360px]">
        <Card className="grid grid-cols-[minmax(0,1fr)] content-start gap-3 p-3 md:col-span-2 2xl:col-span-1">
          <h2 className="font-bold">ภาพ</h2>
          {views.length > 0 && <ViewTabs views={views} value={shown?.view ?? 'front'} onChange={setView} counts={v => draft.callouts.filter(c => c.view === v).length} />}
          {editable && (
            <div className="grid gap-2 rounded-xl border border-dashed border-line p-2">
              <select value={upload.view} onChange={e => setUpload(u => ({ ...u, view: e.target.value as ViewKey }))} className={fieldClass} aria-label="มุมภาพที่จะอัปโหลด">
                {VIEW_ORDER.map(v => <option key={v} value={v}>{v === 'front' ? 'ภาพหลัก (หน้า หรือ หน้า + หลังในภาพเดียว)' : `ภาพเพิ่ม: ${VIEW_NAME[v]}`}{views.includes(v) ? ' (แทนภาพเดิม)' : ''}</option>)}
              </select>
              <FilePick accept="image/png,image/jpeg,image/webp" label="เลือกภาพม็อคอัพ" chosen={upload.file?.name ?? ''} onPick={f => { setUpload(u => ({ ...u, file: f ?? null, preview: f && !mockupProblem(f) ? URL.createObjectURL(f) : '' })); setMsg(null) }} />
              {upload.file && mockupProblem(upload.file) && <p role="alert" className="text-danger">{mockupProblem(upload.file)}</p>}
              {upload.preview && <img src={upload.preview} alt="ตัวอย่างภาพก่อนบันทึก" className="max-h-40 w-full rounded-lg bg-card-2 object-contain" />}
              <button type="button" className={primaryBtn} disabled={!upload.file || !!mockupProblem(upload.file) || !!busy} onClick={() => void doUpload()}>
                {busy === 'upload' ? 'กำลังอัปโหลด…' : `ใช้เป็นภาพ${VIEW_NAME[upload.view]}`}
              </button>
              <p className="text-sm text-muted">PNG / JPG / WEBP ไม่เกิน 5 MB · เก็บไฟล์ต้นฉบับไม่ย่อ · ม็อคอัพที่มีหน้า + หลังในภาพเดียว อัปโหลดเป็นภาพหลักภาพเดียวพอ แล้ววางจุดได้ทั้งสองตัว</p>
              {shown && <button type="button" className={dangerBtn} onClick={() => edit({ type: 'remove_view', view: shown.view })}>ลบภาพ{VIEW_NAME[shown.view]}</button>}
            </div>
          )}
          <h2 className="font-bold">Callout ({draft.callouts.length})</h2>
          <CalloutList draft={draft} selected={selected} jobSpec={data.job.spec} edit={editable ? edit : undefined}
            onSelect={c => { setSelected(c.key); setView(c.view) }} />
          {editable && draft.specs.length > 0 && <p className="text-sm text-muted">สเปกเพิ่มเติม {draft.specs.length} รายการ: {draft.specs.map(s => s.code).join(', ')}</p>}
        </Card>

        <Card className="min-w-0 p-2">
          {shown ? (
            <div className="max-h-[78vh] overflow-auto rounded-xl bg-card-2 p-2" onWheel={e => {
              if (!e.ctrlKey) return
              e.preventDefault()
              const i = ZOOMS.indexOf(zoom)
              setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + (e.deltaY < 0 ? 1 : -1)))]!)
            }}>
              <AnnotationCanvas view={shown} url={urls.get(shown.path)} callouts={onView} zoom={zoom} editable={editable} selected={selected}
                labels={c => calloutLines(c, draft, data.job.spec).slice(0, 2)}
                onSelect={setSelected}
                onAdd={(x, y) => { const key = newKey(); edit({ type: 'add_callout', key, view: shown.view, x, y }); setSelected(key) }}
                onMove={(key, patch) => edit({ type: 'update_callout', key, patch })} />
            </div>
          ) : <p className="grid min-h-60 place-items-center p-6 text-center text-muted">{editable ? 'อัปโหลดภาพหลักก่อน (ภาพม็อคอัพที่มีทั้งด้านหน้าและหลังในภาพเดียว ใช้เป็นภาพหลักได้เลย)' : 'ฉบับนี้ยังไม่มีภาพ'}</p>}
          {editable && shown && <p className="px-2 pt-2 text-sm text-muted">กดบนภาพ = เพิ่มจุด · ลากจุด/กล่อง = ย้าย · Ctrl + ล้อเมาส์ = ซูม · Ctrl+Z / Ctrl+Y = ย้อน / ทำซ้ำ</p>}
        </Card>

        <Card className="grid grid-cols-[minmax(0,1fr)] content-start gap-3 p-3">
          <SpecPanel draft={draft} callout={callout} jobSpec={data.job.spec} stations={data.job.stations} edit={edit} editable={editable} />
        </Card>
      </div>

      {editable && <button type="button" className={`${dangerBtn} justify-self-start`} disabled={!!busy} onClick={() => void discard()}>ทิ้งฉบับร่าง {sheet.rev}</button>}
    </div>
  )
}

function SheetViewer({ data, sheet, role, myStations, reload }: {
  data: MockupData; sheet: SheetRow; role: EmployeeRole; myStations: StationCode[]; reload: () => Promise<void>
}) {
  const [loaded, setLoaded] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; draft: Draft; urls: Map<string, string> }>({ status: 'loading' })
  const ackStations = useMemo(() => {
    if (role === 'staff') return data.job.stations.filter(s => myStations.includes(s))
    if (role === 'qc') return data.job.stations.filter(s => s === 'qc_pack')
    return data.job.stations
  }, [role, myStations, data.job.stations])
  const [station, setStation] = useState<StationCode | null>(() => (role === 'staff' || role === 'qc') ? ackStations[0] ?? null : null)
  const [view, setView] = useState<ViewKey>('front')
  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  useEffect(() => {
    let live = true
    loadSheet(sheet.id).then(r => {
      if (!live) return
      setLoaded({ status: 'ready', ...r })
      setView(r.draft.views[0]?.view ?? 'front')
    }).catch((e: unknown) => { if (live) setLoaded({ status: 'error', message: e instanceof Error ? e.message : thaiError(undefined) }) })
    return () => { live = false }
  }, [sheet.id])

  if (loaded.status === 'loading') return <Card className="p-5"><p role="status" className="text-muted">กำลังโหลดฉบับ {sheet.rev}…</p></Card>
  if (loaded.status === 'error') return <Card className="p-5"><p role="alert" className="text-danger">โหลดสเปกไม่สำเร็จ · {loaded.message}</p></Card>

  const { draft, urls } = loaded
  const callouts = forStation(draft.callouts, station)
  const shown = draft.views.find(v => v.view === view) ?? draft.views[0]
  const callout = callouts.find(c => c.key === selected) ?? null
  const acks = data.acks.filter(a => a.sheet_id === sheet.id)
  const ackedHere = station ? acks.some(a => a.station_code === station) : false
  const ack = async () => {
    if (!station) return
    setBusy(true); setMsg(null)
    const r = await ackSheet(sheet.id, station)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.reason }); return }
    await reload()
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <Card className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 font-semibold">ดูเฉพาะสถานี
            <select value={station ?? ''} onChange={e => setStation((e.target.value || null) as StationCode | null)} className={`${fieldClass} w-auto font-normal`}
              disabled={role === 'staff' && ackStations.length <= 1}>
              {role !== 'staff' && <option value="">ทุกสถานี</option>}
              {(role === 'staff' ? ackStations : data.job.stations).map(s => <option key={s} value={s}>{STATION_NAME[s]}</option>)}
            </select>
          </label>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Zoom zoom={zoom} setZoom={setZoom} />
            {canOpenPage(role, 'artwork') && <a href={`#/artwork?id=${data.job.id}&sheet=${sheet.id}`} className={secondaryBtn}><IconPrinter className="size-5" />พิมพ์ / PDF</a>}
          </span>
        </div>
        {sheet.approve_note && <p className="text-muted">หมายเหตุผู้อนุมัติ: {sheet.approve_note}</p>}
        {sheet.confirmation_rev !== null && sheet.confirmation_rev !== data.job.confirmationRev && (
          <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn">ใบยืนยันถูกแก้ (ฉบับ {data.job.confirmationRev}) หลังอนุมัติม็อคอัพนี้ (ใช้ใบฉบับ {sheet.confirmation_rev}) · แจ้งแอดมินตรวจ</p>
        )}
        {canAckMockup(role) && station && ackStations.includes(station) && (
          ackedHere
            ? <p className="flex items-center gap-2 rounded-xl bg-ok-soft px-3 py-2 font-medium text-ok"><IconCheck className="size-5" />สถานี{STATION_NAME[station]}รับทราบสเปกฉบับ {sheet.rev} แล้ว</p>
            : <button type="button" className={okBtn} disabled={busy} onClick={() => void ack()}>
              <IconCheck className="size-5" />{busy ? 'กำลังบันทึก…' : `รับทราบสเปกฉบับ ${sheet.rev} · สถานี${STATION_NAME[station]}`}
            </button>
        )}
        {canAckMockup(role) && !station && <p className="text-sm text-muted">เลือกสถานีเพื่อกดรับทราบสเปก</p>}
        <Note msg={msg} />
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-2 p-2">
          {draft.views.length > 1 && <ViewTabs views={draft.views.map(v => v.view)} value={shown?.view ?? 'front'} onChange={setView} counts={v => callouts.filter(c => c.view === v).length} />}
          {shown
            ? <div className="max-h-[78vh] overflow-auto rounded-xl bg-card-2 p-2">
              <AnnotationCanvas view={shown} url={urls.get(shown.path)} callouts={callouts.filter(c => c.view === shown.view)} zoom={zoom} selected={selected}
                labels={c => calloutLines(c, draft).slice(0, 1)} onSelect={setSelected} />
            </div>
            : <p className="p-6 text-muted">ฉบับนี้ไม่มีภาพ</p>}
        </Card>
        <Card className="grid grid-cols-[minmax(0,1fr)] content-start gap-3 p-3">
          <SpecPanel draft={draft} callout={callout} jobSpec={data.job.spec} stations={data.job.stations} edit={() => undefined} editable={false} />
          <h2 className="font-bold">ทุกจุด{station ? `ของ${STATION_NAME[station]}` : ''} ({callouts.length})</h2>
          <CalloutList draft={{ ...draft, callouts }} selected={selected} jobSpec={data.job.spec} onSelect={c => { setSelected(c.key); setView(c.view) }} />
          <h2 className="font-bold">รับทราบแล้ว</h2>
          {acks.length
            ? <ul className="grid gap-1 text-sm">{acks.map(a => <li key={`${a.station_code}:${a.user_id}`}>{STATION_NAME[a.station_code]} · {data.names.get(a.user_id ?? '') ?? '—'} · {when(a.at)}</li>)}</ul>
            : <p className="text-sm text-muted">ยังไม่มีสถานีกดรับทราบ</p>}
        </Card>
      </div>
    </div>
  )
}
