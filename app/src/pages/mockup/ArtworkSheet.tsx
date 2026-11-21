import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Card } from '../../components/ui'
import { primaryBtn, secondaryBtn } from '../../components/Dialog'
import { IconPrinter } from '../../components/icons'
import { canSeeMockupDraft, type EmployeeRole } from '../../auth/access'
import { STATION_NAME } from '../../proto/model'
import { SHEET_STATUS, SPEC_KIND_NAME, VIEW_NAME, calloutLines, specSize, type Draft } from '../../proto/annotation'
import { loadMockupJob, loadSheet, pickSheets, type MockupData, type SheetRow } from '../../data/mockupSheets'
import { isJobId } from '../../data/useFactoryData'
import { thaiError } from '../../data/live'
import { AnnotationCanvas } from './AnnotationCanvas'
import { printWhenFontsReady } from '../../lib/printFonts'
import './artwork.css'

type Paper = 'A4' | 'A3'
export type Ready = { data: MockupData; sheet: SheetRow; draft: Draft; urls: Map<string, string> }
const date = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—'

function hashParam(name: string): string {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get(name) ?? ''
}

export function ArtworkPaper({ r, paper, printedOn }: { r: Ready; paper: Paper; printedOn: string }) {
  const { data, sheet, draft, urls } = r
  const approved = sheet.status === 'approved' || sheet.status === 'superseded'
  const tall = paper === 'A3' ? '205mm' : '128mm'
  return (
    <article className={`artwork-sheet paper-${paper}`} aria-label="ใบกำกับงานพิมพ์">
      {!approved && <p className="artwork-watermark" aria-hidden>ร่าง · ห้ามใช้ผลิต</p>}
      <header className="artwork-head">
        <div>
          <p className="artwork-brand">ภาพพิมพ์ 142 · ใบกำกับงานพิมพ์ (Production Artwork Sheet)</p>
          <h1>{data.job.no} · {data.job.customer}</h1>
          <p>{data.job.jobName}</p>
        </div>
        <dl className="artwork-meta">
          <div><dt>จำนวน</dt><dd>{data.job.qty.toLocaleString('th-TH')} {data.job.unit}</dd></div>
          <div><dt>กำหนดส่ง</dt><dd>{new Date(`${data.job.due}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
          <div><dt>ฉบับ</dt><dd>{sheet.rev} · {SHEET_STATUS[sheet.status].text}</dd></div>
          <div><dt>อนุมัติ</dt><dd>{date(sheet.approved_at)}</dd></div>
          <div><dt>ผู้อนุมัติ</dt><dd>{data.names.get(sheet.approved_by ?? '') ?? '—'}</dd></div>
          <div><dt>ใบยืนยันฉบับ</dt><dd>{sheet.confirmation_rev ?? data.job.confirmationRev}</dd></div>
        </dl>
      </header>
      <section className={`artwork-views count-${Math.min(draft.views.length, 2)}`}>
        {draft.views.map(v => (
          <figure key={v.view}>
            <figcaption>{VIEW_NAME[v.view]}</figcaption>
            <AnnotationCanvas view={v} url={urls.get(v.path)} print fitHeight={tall}
              callouts={draft.callouts.filter(c => c.view === v.view)} labels={() => []} />
          </figure>
        ))}
      </section>
      <table className="artwork-table">
        <thead><tr><th>#</th><th>จุด</th><th>มุม</th><th>สเปก</th><th>สถานี</th></tr></thead>
        <tbody>
          {[...draft.callouts].sort((a, b) => a.no - b.no).map(c => (
            <tr key={c.key}>
              <td className="no">{c.no}</td><td>{c.title}</td><td>{VIEW_NAME[c.view]}</td>
              <td>{calloutLines(c, draft, approved ? undefined : data.job.spec).map((l, i) => <p key={i}>{l}</p>)}</td>
              <td>{c.stations.length ? c.stations.map(s => STATION_NAME[s]).join(', ') : 'ทุกสถานี'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft.specs.length > 0 && (
        <table className="artwork-table">
          <thead><tr><th>รหัส</th><th>สเปก</th><th>ประเภท</th><th>ตำแหน่ง</th><th>ขนาด</th><th>สี</th><th>วัสดุ / วิธีผลิต</th><th>Artwork / หมายเหตุ</th></tr></thead>
          <tbody>
            {draft.specs.map(s => (
              <tr key={s.key}>
                <td className="no">{s.code}</td><td>{s.name}{s.detail && <p>{s.detail}</p>}</td><td>{SPEC_KIND_NAME[s.kind]}</td><td>{s.position}</td>
                <td>{specSize(s)}</td><td>{s.color}{s.colorCode && <p>{s.colorCode}</p>}</td>
                <td>{[s.material, s.method].filter(Boolean).join(' · ')}</td><td className="wrap">{[s.artworkRef, s.note].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <footer className="artwork-foot">
        <span>พิมพ์ {date(printedOn)}</span>
        <span>ผู้อนุมัติ ______________________</span>
        <span>ผู้รับงาน ______________________</span>
      </footer>
    </article>
  )
}

export default function ArtworkSheet({ jobId, role }: { jobId: string; role: EmployeeRole }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'missing'; text: string } | { status: 'error'; message: string } | { status: 'ready'; r: Ready }>(
    () => (isJobId(jobId) ? { status: 'loading' } : { status: 'missing', text: 'ไม่พบงานนี้' }))
  const [paper, setPaper] = useState<Paper>(() => (hashParam('paper').toUpperCase() === 'A3' ? 'A3' : 'A4'))
  const [printedOn, setPrintedOn] = useState(() => new Date().toISOString())
  useEffect(() => {
    if (!isJobId(jobId)) return
    let live = true
    void (async () => {
      try {
        const data = await loadMockupJob(jobId.toLowerCase())
        if (!data) { if (live) setState({ status: 'missing', text: 'ไม่พบงานนี้' }); return }
        const wanted = hashParam('sheet')
        const { approved, open } = pickSheets(data.sheets)
        const sheet = data.sheets.find(s => s.id === wanted) ?? approved ?? (canSeeMockupDraft(role) ? open : null)
        if (!sheet) { if (live) setState({ status: 'missing', text: 'งานนี้ยังไม่มีม็อคอัพกำกับสเปกที่อนุมัติ' }); return }
        const loaded = await loadSheet(sheet.id)
        if (live) setState({ status: 'ready', r: { data, sheet, ...loaded } })
      } catch (e) {
        if (live) setState({ status: 'error', message: e instanceof Error ? e.message : thaiError(undefined) })
      }
    })()
    return () => { live = false }
  }, [jobId, role])

  if (state.status !== 'ready') {
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <Card className="grid grid-cols-[minmax(0,1fr)] gap-2 p-5">
          <h1 className="text-xl font-bold">ใบกำกับงานพิมพ์</h1>
          {state.status === 'loading' && <p role="status" className="text-muted">กำลังโหลด…</p>}
          {state.status === 'missing' && <p role="alert" className="text-danger">{state.text}</p>}
          {state.status === 'error' && <p role="alert" className="text-danger">โหลดไม่สำเร็จ · {state.message}</p>}
        </Card>
      </div>
    )
  }
  const sheet = <ArtworkPaper r={state.r} paper={paper} printedOn={printedOn} />
  return (
    <div className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-3 p-3 sm:p-5">
      <style>{`@page { size: ${paper} landscape; margin: 8mm; }`}</style>
      <div className="flex flex-wrap items-center gap-2">
        <a href={`#/mockup?id=${state.r.data.job.id}`} className={secondaryBtn}>กลับไปม็อคอัพ</a>
        <span className="ml-auto flex gap-1 rounded-xl border border-line bg-card p-1" role="radiogroup" aria-label="ขนาดกระดาษ">
          {(['A4', 'A3'] as const).map(p => (
            <button key={p} type="button" role="radio" aria-checked={paper === p} onClick={() => setPaper(p)}
              className={`min-h-12 rounded-lg px-5 font-semibold ${paper === p ? 'bg-brand text-white' : 'hover:bg-paper'}`}>{p} แนวนอน</button>
          ))}
        </span>
        <button type="button" className={primaryBtn} onClick={() => { setPrintedOn(new Date().toISOString()); requestAnimationFrame(() => void printWhenFontsReady()) }}><IconPrinter className="size-5" />พิมพ์ / บันทึก PDF</button>
      </div>
      <p className="text-sm text-muted">ในหน้าพิมพ์เลือก "บันทึกเป็น PDF" เพื่อได้ไฟล์ PDF · ตำแหน่งจุดตรงกับหน้าแก้ไขเพราะใช้สัดส่วนบนภาพชุดเดียวกัน</p>
      <div className="artwork-screen overflow-x-auto rounded-2xl border border-line bg-white shadow-card">{sheet}</div>
      {createPortal(<div className="artwork-print">{sheet}</div>, document.body)}
    </div>
  )
}
