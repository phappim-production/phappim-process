import { useEffect, useState, type ReactNode } from 'react'
import { STATION_NAME } from '../../proto/model'
import { VIEW_NAME, calloutLines } from '../../proto/annotation'
import { loadSheet, type LoadedSheet } from '../../data/mockupSheets'
import { thaiError } from '../../data/live'
import { IconImage } from '../../components/icons'
import { AnnotationCanvas } from './AnnotationCanvas'

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; sheet: LoadedSheet }

export function SpecPreview({ jobId, sheetId, rev, fallback }: { jobId: string; sheetId: string; rev: number; fallback: ReactNode }) {
  const key = `${sheetId}:${rev}`
  const [loaded, setLoaded] = useState<State & { key: string } | null>(null)
  useEffect(() => {
    let live = true
    loadSheet(sheetId)
      .then(sheet => { if (live) setLoaded({ key, status: 'ready', sheet }) })
      .catch((e: unknown) => { if (live) setLoaded({ key, status: 'error', message: e instanceof Error ? e.message : thaiError(undefined) }) })
    return () => { live = false }
  }, [sheetId, key])
  const state: State = loaded?.key === key ? loaded : { status: 'loading' }

  const open = (
    <a href={'#/mockup?id=' + encodeURIComponent(jobId)}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line px-3 font-semibold text-brand hover:bg-brand-soft">
      <IconImage className="size-5" /> เปิดเต็มจอ · รับทราบสเปก
    </a>
  )
  if (state.status !== 'ready') {
    return (
      <div className="grid justify-items-center gap-1">
        {fallback}
        <span role={state.status === 'error' ? 'alert' : 'status'} className={state.status === 'error' ? 'text-danger' : 'text-muted'}>
          {state.status === 'loading' ? 'กำลังโหลดม็อคอัพกำกับสเปก…' : `โหลดม็อคอัพกำกับสเปกไม่สำเร็จ · ${state.message}`}
        </span>
        {open}
      </div>
    )
  }

  return <SpecSheetView rev={rev} sheet={state.sheet} open={open} />
}

export function SpecSheetView({ rev, sheet, open }: { rev: number; sheet: LoadedSheet; open: ReactNode }) {
  const { draft, urls } = sheet
  const callouts = [...draft.callouts].sort((a, b) => a.no - b.no)
  return (
    <section aria-label="ม็อคอัพกำกับสเปก" className="grid w-full gap-3">
      <p className="font-semibold">ม็อคอัพกำกับสเปก · ฉบับ {rev} <span className="font-normal text-ok">อนุมัติใช้ผลิต</span></p>
      {draft.views.map(v => (
        <figure key={v.view} className="grid gap-1 overflow-hidden">
          {draft.views.length > 1 && <figcaption className="text-muted">{VIEW_NAME[v.view]}</figcaption>}
          {/* ลิ้นชักแคบ: บนภาพแสดงแค่เลข+ชื่อจุด รายละเอียดอยู่ในรายการด้านล่าง */}
          <AnnotationCanvas view={v} url={urls.get(v.path)} callouts={draft.callouts.filter(c => c.view === v.view)} labels={() => []} />
        </figure>
      ))}
      {callouts.length > 0 && (
        <ol className="grid gap-2">
          {callouts.map(c => (
            <li key={c.key} className="rounded-xl bg-paper px-3 py-2">
              <p className="font-semibold"><span className="text-brand">{c.no}</span> {c.title}</p>
              {calloutLines(c, draft).map((l, i) => <p key={i} className="break-words">{l}</p>)}
              <p className="text-muted">{c.stations.length ? c.stations.map(s => STATION_NAME[s]).join(', ') : 'ทุกสถานี'}</p>
            </li>
          ))}
        </ol>
      )}
      {open}
    </section>
  )
}
