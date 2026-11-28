import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Dialog, dangerBtn, fieldClass, primaryBtn, secondaryBtn } from '../components/Dialog'
import { FilePick } from '../components/FilePick'
import { IconCheck } from '../components/icons'
import {
  cropOnImage, cropToPng, fetchAttached, loadSignature, removeSignature, saveSignature, signatureIsCurrent,
  type CropBox, type CustomerSignature,
} from '../data/customerSignature'
import { mockupProblem } from '../data/mockups'
import { SIGNED_ACCEPT, withSignedType } from '../data/confirmation'
import { openPdf, type PdfDoc } from '../data/pdfPages'
import { thaiDay, type Job } from '../proto/model'
import { thaiFullDate } from '../proto/format'

type Loaded = { sig: CustomerSignature | null; url: string | null; currentRev: number }

export function CustomerSignaturePanel({ job, attached }: { job: Job; attached: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cropping, setCropping] = useState(false)
  const [busy, setBusy] = useState(false)

  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion(v => v + 1), [])
  useEffect(() => {
    let alive = true
    void loadSignature(job.id).then(r => {
      if (!alive) return
      if (!r.ok) { setError(r.reason); return }
      setError('')
      setLoaded({ sig: r.sig, url: r.url, currentRev: r.currentRev })
    })
    return () => { alive = false }
  }, [job.id, version])

  async function remove() {
    if (!window.confirm('ลบลายเซ็นลูกค้าออกจากใบฉบับโรงงาน?')) return
    setBusy(true)
    const r = await removeSignature(job.id)
    setBusy(false)
    if (!r.ok) { setError(r.reason); return }
    setNotice('ลบลายเซ็นลูกค้าแล้ว')
    reload()
  }

  const sig = loaded?.sig ?? null
  const stale = sig && !signatureIsCurrent(sig)
  return (
    <div className={`grid gap-2 rounded-xl border p-3 ${sig && !stale ? 'border-line' : 'border-warn/30 bg-warn-soft'}`}>
      <p className={`font-medium ${sig && !stale ? '' : 'text-warn'}`}>
        {!loaded ? (error ? 'โหลดลายเซ็นลูกค้าไม่ได้' : 'กำลังโหลดลายเซ็นลูกค้า…')
          : !sig ? 'ยังไม่มีลายเซ็นลูกค้าในใบฉบับโรงงาน · ตัดลายเซ็นจากใบที่ลูกค้าเซ็นแล้ว ฝ่ายผลิตไม่ต้องให้ลูกค้าเซ็นซ้ำ'
          : stale ? `ลายเซ็นนี้เป็นของใบครั้งที่ ${sig.rev} · ใบปัจจุบันครั้งที่ ${sig.currentRev} ยังไม่มีลายเซ็น ให้ตัดลายเซ็นจากใบแก้ที่ลูกค้าเซ็น`
          : `ลายเซ็นลูกค้า · เซ็นวันที่ ${thaiFullDate(sig.signedOn)}`}
      </p>
      {sig && (loaded?.url
        ? <img src={loaded.url} alt="ลายเซ็นลูกค้า" className="max-h-28 w-auto max-w-full self-start rounded-lg border border-line bg-white object-contain p-1" />
        : <p className="text-sm text-muted">เปิดรูปลายเซ็นไม่ได้ตอนนี้ (ลองโหลดหน้าใหม่)</p>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={sig && !stale ? secondaryBtn : primaryBtn} disabled={busy || !loaded} onClick={() => { setNotice(''); setCropping(true) }}>
          {sig ? 'เปลี่ยนลายเซ็นลูกค้า' : 'ตัดลายเซ็นลูกค้า'}
        </button>
        {sig && <button type="button" className={dangerBtn} disabled={busy} onClick={() => void remove()}>ลบลายเซ็น</button>}
      </div>
      {notice && <p role="status" className="flex items-center gap-2 font-medium text-ok"><IconCheck className="size-5" />{notice}</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {error && !loaded && <button type="button" className={secondaryBtn} onClick={reload}>ลองโหลดลายเซ็นอีกครั้ง</button>}
      {cropping && loaded && (
        <CropDialog job={job} rev={loaded.currentRev} attached={attached} onClose={() => setCropping(false)}
          onSaved={async () => { setCropping(false); setNotice('บันทึกลายเซ็นลูกค้าแล้ว · ใบฉบับโรงงานแสดงลายเซ็นในช่องลูกค้า'); reload() }} />
      )}
    </div>
  )
}

function CropDialog({ job, rev, attached, onClose, onSaved }: { job: Job; rev: number; attached: string | null; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [src, setSrc] = useState('')
  const [box, setBox] = useState<CropBox | null>(null)
  const [today] = useState(() => thaiDay(new Date()))
  const [signedOn, setSignedOn] = useState(today)
  const [dims, setDims] = useState<{ shown: { w: number; h: number }; natural: { w: number; h: number } } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [broken, setBroken] = useState(false)
  const [fetching, setFetching] = useState('')
  const [pdf, setPdf] = useState<{ doc: PdfDoc; page: number; name: string } | null>(null)
  const img = useRef<HTMLImageElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const openDoc = useRef<PdfDoc | null>(null)
  const latestPick = useRef(0)

  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])
  useEffect(() => () => openDoc.current?.close(), [])
  const pick = (f: File | null) => {
    setFile(f)
    setSrc(f ? URL.createObjectURL(f) : '')
    setBox(null)
    setDims(null)
    setBroken(false)
    setError('')
  }

  const closePdf = () => {
    openDoc.current?.close()
    openDoc.current = null
    setPdf(null)
  }

  async function showPage(doc: PdfDoc, page: number, name: string, pickId = latestPick.current) {
    setFetching(`กำลังแสดงหน้า ${page}…`)
    const png = await doc.render(page).catch(() => null)
    if (pickId !== latestPick.current) return
    setFetching('')
    if (!png) { setError('แสดงหน้านี้ไม่ได้ · ลองหน้าอื่น หรือแคปหน้าจอหน้าที่มีลายเซ็นแทน'); return }
    setPdf({ doc, page, name })
    pick(new File([png], `${name.replace(/\.pdf$/i, '')}-p${page}.png`, { type: 'image/png' }))
  }

  // ช่องเซ็นของลูกค้าอยู่ท้ายใบ จึงเปิดหน้าสุดท้ายก่อน
  // เปิด PDF ใช้เวลา ระหว่างนั้นผู้ใช้อาจเลือกไฟล์อื่นแล้ว ผลที่มาทีหลังต้องไม่ทับไฟล์ใหม่
  async function choose(picked: File | null) {
    const pickId = ++latestPick.current
    setError('')
    const f = picked && withSignedType(picked)
    if (!f || f.type !== 'application/pdf') { setFetching(''); closePdf(); pick(f); return }
    setFetching('กำลังเปิด PDF…')
    const r = await openPdf(await f.arrayBuffer())
    if (pickId !== latestPick.current) { if (r.ok) r.doc.close(); return }
    if (!r.ok) { setFetching(''); setError(r.reason); return }
    closePdf()
    openDoc.current = r.doc
    await showPage(r.doc, r.doc.pages, f.name, pickId)
  }

  async function openAttached() {
    if (!attached) return
    const pickId = ++latestPick.current
    setFetching('กำลังเปิดใบที่แนบไว้…')
    setError('')
    const r = await fetchAttached(attached)
    if (pickId !== latestPick.current) return
    setFetching('')
    if (!r.ok) { setError(r.reason); return }
    await choose(r.file)
  }

  const point = (e: PointerEvent) => {
    const r = img.current?.getBoundingClientRect()
    return r ? { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) } : null
  }
  const measure = () => {
    const el = img.current
    if (el) setDims({ shown: { w: el.clientWidth, h: el.clientHeight }, natural: { w: el.naturalWidth, h: el.naturalHeight } })
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const p = point(e)
    if (!p) return
    measure()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = p
    setBox({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current, p = point(e)
    if (s && p) setBox({ x: s.x, y: s.y, w: p.x - s.x, h: p.y - s.y })
  }
  const up = () => { start.current = null }

  const crop = box && dims ? cropOnImage(box, dims.shown, dims.natural) : null
  const problem = file ? mockupProblem(file) : null
  const dateProblem = !/^\d{4}-\d{2}-\d{2}$/.test(signedOn) ? 'ใส่วันที่ลูกค้าเซ็น' : signedOn > today ? 'วันที่ลูกค้าเซ็นอยู่ในอนาคต' : ''
  const why = !file ? 'เลือกรูปใบที่ลูกค้าเซ็นก่อน' : problem ?? (broken ? 'เปิดรูปนี้ไม่ได้ เลือกรูปอื่น' : !crop ? 'ลากกรอบรอบลายเซ็นบนรูปก่อน' : dateProblem)

  async function save() {
    if (why || !img.current || !crop) return
    setBusy(true)
    setError('')
    const png = await cropToPng(img.current, crop)
    if (!png) { setBusy(false); setError('ตัดรูปไม่ได้ ลองเลือกรูปใหม่'); return }
    const r = await saveSignature(job, png, signedOn)
    setBusy(false)
    if (!r.ok) { setError(r.reason); return }
    onSaved()
  }

  const close = () => { if (!busy) onClose() }
  const norm = box && { left: Math.min(box.x, box.x + box.w), top: Math.min(box.y, box.y + box.h), width: Math.abs(box.w), height: Math.abs(box.h) }
  return (
    <Dialog title="ตัดลายเซ็นลูกค้า" onClose={close} wide>
      <div className="mt-3 grid gap-3">
        <p className="text-muted">ใช้ใบที่ลูกค้าเซ็น (รูปถ่าย / สแกน / PDF) แล้วลากกรอบรอบลายเซ็น</p>
        <p className="rounded-lg bg-warn-soft p-2 text-sm font-medium text-warn">ลายเซ็นนี้จะนับเป็นของใบยืนยันครั้งที่ {rev} (ใบล่าสุด) · ตัดจากใบครั้งที่ {rev} ที่ลูกค้าเซ็นเท่านั้น</p>
        {attached && (
          <button type="button" className={file ? secondaryBtn : primaryBtn} disabled={!!fetching || busy} onClick={() => void openAttached()}>
            ใช้ใบที่ลูกค้าเซ็นที่แนบไว้ในงาน
          </button>
        )}
        <FilePick accept={SIGNED_ACCEPT} label={file ? 'เลือกไฟล์อื่น' : 'เลือกรูปหรือ PDF ใบที่ลูกค้าเซ็น'}
          chosen={pdf ? `${pdf.name} · หน้า ${pdf.page}/${pdf.doc.pages}` : file?.name ?? ''} onPick={f => void choose(f ?? null)} />
        {fetching && <p role="status" className="text-muted">{fetching}</p>}
        {pdf && pdf.doc.pages > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={secondaryBtn} disabled={!!fetching || pdf.page <= 1} title={pdf.page <= 1 ? 'อยู่หน้าแรกแล้ว' : undefined}
              onClick={() => void showPage(pdf.doc, pdf.page - 1, pdf.name)}>หน้าก่อน</button>
            <span className="font-medium">หน้า {pdf.page} / {pdf.doc.pages}</span>
            <button type="button" className={secondaryBtn} disabled={!!fetching || pdf.page >= pdf.doc.pages} title={pdf.page >= pdf.doc.pages ? 'อยู่หน้าสุดท้ายแล้ว' : undefined}
              onClick={() => void showPage(pdf.doc, pdf.page + 1, pdf.name)}>หน้าถัดไป</button>
          </div>
        )}
        {problem && <p role="alert" className="text-danger">{problem}</p>}
        {broken && <p role="alert" className="text-danger">เปิดรูปนี้ไม่ได้ (ไฟล์อาจเสีย) · เลือกรูปอื่น หรือแคปหน้าจอใหม่</p>}
        {src && !problem && !broken && (
          <div className="relative w-fit max-w-full touch-none select-none self-start overflow-hidden rounded-lg border border-line"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-crop-area>
            <img ref={img} src={src} alt="ใบที่ลูกค้าเซ็น" draggable={false} className="block max-h-[60vh] w-auto max-w-full"
              onLoad={measure} onError={() => setBroken(true)} />
            {norm && <div aria-hidden className="pointer-events-none absolute border-2 border-brand bg-brand/10" style={norm} />}
          </div>
        )}
        <label className="grid gap-1 font-medium">วันที่ลูกค้าเซ็น (วันที่เขียนข้างลายเซ็นในใบ)
          <input type="date" className={fieldClass} value={signedOn} max={today} onChange={e => setSignedOn(e.target.value)} />
        </label>
        {why && file && !problem && <p className="text-sm text-muted">{why}</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={secondaryBtn} disabled={busy} title={busy ? 'รอบันทึกลายเซ็นให้เสร็จก่อน' : undefined} onClick={close}>ยกเลิก</button>
          <button type="button" className={primaryBtn} disabled={!!why || busy} title={why || undefined} onClick={() => void save()}>
            {busy ? 'กำลังบันทึกลายเซ็น…' : why ? `บันทึกลายเซ็น (${why})` : 'บันทึกลายเซ็น'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
