import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Dialog, dangerBtn, fieldClass, primaryBtn, secondaryBtn } from '../components/Dialog'
import { FilePick } from '../components/FilePick'
import { IconCheck } from '../components/icons'
import {
  cropOnImage, cropToPng, loadSignature, removeSignature, saveSignature, signatureIsCurrent,
  type CropBox, type CustomerSignature,
} from '../data/customerSignature'
import { mockupProblem } from '../data/mockups'
import { thaiDay, type Job } from '../proto/model'
import { thaiFullDate } from '../proto/format'

type Loaded = { sig: CustomerSignature | null; url: string | null }

export function CustomerSignaturePanel({ job }: { job: Job }) {
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
      setLoaded({ sig: r.sig, url: r.url })
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
        {!loaded ? 'กำลังโหลดลายเซ็นลูกค้า…'
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
      {cropping && (
        <CropDialog job={job} onClose={() => setCropping(false)}
          onSaved={async () => { setCropping(false); setNotice('บันทึกลายเซ็นลูกค้าแล้ว · ใบฉบับโรงงานแสดงลายเซ็นในช่องลูกค้า'); reload() }} />
      )}
    </div>
  )
}

function CropDialog({ job, onClose, onSaved }: { job: Job; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [src, setSrc] = useState('')
  const [box, setBox] = useState<CropBox | null>(null)
  const [today] = useState(() => thaiDay(new Date()))
  const [signedOn, setSignedOn] = useState(today)
  const [dims, setDims] = useState<{ shown: { w: number; h: number }; natural: { w: number; h: number } } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const img = useRef<HTMLImageElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])
  const pick = (f: File | null) => {
    setFile(f)
    setSrc(f ? URL.createObjectURL(f) : '')
    setBox(null)
    setDims(null)
    setError('')
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
  const why = !file ? 'เลือกรูปใบที่ลูกค้าเซ็นก่อน' : problem ?? (!crop ? 'ลากกรอบรอบลายเซ็นบนรูปก่อน' : dateProblem)

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

  const norm = box && { left: Math.min(box.x, box.x + box.w), top: Math.min(box.y, box.y + box.h), width: Math.abs(box.w), height: Math.abs(box.h) }
  return (
    <Dialog title="ตัดลายเซ็นลูกค้า" onClose={onClose} wide>
      <div className="mt-3 grid gap-3">
        <p className="text-muted">ถ่ายรูปหรือแคปหน้าจอใบที่ลูกค้าเซ็น (ถ้าได้เป็น PDF ให้แคปหน้าที่มีลายเซ็น) แล้วลากกรอบรอบลายเซ็น</p>
        <FilePick accept="image/jpeg,image/png,image/webp" label={file ? 'เลือกรูปอื่น' : 'เลือกรูปใบที่ลูกค้าเซ็น'} chosen={file?.name ?? ''}
          onPick={f => pick(f ?? null)} />
        {problem && <p role="alert" className="text-danger">{problem}</p>}
        {src && !problem && (
          <div className="relative touch-none select-none self-start overflow-hidden rounded-lg border border-line"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-crop-area>
            <img ref={img} src={src} alt="ใบที่ลูกค้าเซ็น" draggable={false} className="block max-h-[60vh] w-auto max-w-full"
              onLoad={measure} />
            {norm && <div aria-hidden className="pointer-events-none absolute border-2 border-brand bg-brand/10" style={norm} />}
          </div>
        )}
        <label className="grid gap-1 font-medium">วันที่ลูกค้าเซ็น
          <input type="date" className={fieldClass} value={signedOn} max={today} onChange={e => setSignedOn(e.target.value)} />
        </label>
        {why && file && !problem && <p className="text-sm text-muted">{why}</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={secondaryBtn} onClick={onClose}>ยกเลิก</button>
          <button type="button" className={primaryBtn} disabled={!!why || busy} title={why || undefined} onClick={() => void save()}>
            {busy ? 'กำลังบันทึกลายเซ็น…' : why ? `บันทึกลายเซ็น (${why})` : 'บันทึกลายเซ็น'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
