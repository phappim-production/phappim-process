import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { clampIndex, dragOffset, splitFromPointer, swipeTarget, zoomOrigin } from '../data/photoViewer'
import { IconAlert, IconChevronLeft, IconChevronRight, IconCompare, IconImage, IconZoom } from './icons'

type Mode = 'single' | 'compare'

// ปัดซ้าย-ขวาเปลี่ยนรูป · เทียบม็อคอัพด้วยเส้นแบ่ง · ดับเบิลคลิก/ปุ่มขยาย · ลูกศรซ้ายขวา
export function PhotoViewer({ photos, mockupUrl, label, onBrokenChange }: {
  photos: string[]; mockupUrl?: string | null; label: string; onBrokenChange?: (broken: number) => void
}) {
  const count = photos.length
  const [index, setIndex] = useState(0)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<Mode>('single')
  const [split, setSplit] = useState(50)
  const [zoom, setZoom] = useState<string | null>(null)
  const [broken, setBroken] = useState<ReadonlySet<number>>(() => new Set(photos.flatMap((url, i) => url ? [] : [i])))
  const start = useRef<number | null>(null)
  const cur = clampIndex(index, count)
  const comparing = mode === 'compare' && !!mockupUrl

  useEffect(() => { onBrokenChange?.(broken.size) }, [broken, onBrokenChange])

  const go = (i: number) => { setIndex(clampIndex(i, count)); setZoom(null); setDrag(0) }
  const markBroken = (i: number) => setBroken(prev => prev.has(i) ? prev : new Set(prev).add(i))

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    start.current = e.clientX
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ลากต่อได้แม้จับ pointer ไม่ได้ */ }
    if (comparing) { const r = e.currentTarget.getBoundingClientRect(); setSplit(splitFromPointer(e.clientX, r.left, r.width)) }
    else if (!zoom) setDragging(true)
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (start.current === null) return
    if (comparing) { const r = e.currentTarget.getBoundingClientRect(); setSplit(splitFromPointer(e.clientX, r.left, r.width)); return }
    if (!zoom) setDrag(dragOffset(cur, count, e.clientX - start.current))
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (start.current === null) return
    const dx = e.clientX - start.current
    start.current = null
    setDragging(false)
    if (comparing || zoom) return
    go(swipeTarget(cur, count, dx))
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1) }
  }

  if (!count) return <p className="grid aspect-[4/5] max-h-[48vh] place-items-center rounded-2xl bg-paper text-muted">ไม่พบรูป</p>

  const modeBtn = (on: boolean) => `min-h-11 rounded-full px-3 text-sm font-semibold ${on ? 'bg-card text-ink' : 'text-white/80 hover:text-white'}`
  return (
    <div className="grid gap-2 rounded-2xl bg-ink p-2 text-white">
      <div aria-hidden className="flex gap-1 px-1 pt-1">
        {photos.map((_, i) => <span key={i} className={`h-[3px] flex-1 rounded-full ${i <= cur ? 'bg-white' : 'bg-white/30'}`} />)}
      </div>

      <div tabIndex={0} role="group" aria-roledescription="ตัวดูรูป" aria-label={`${label} รูปที่ ${cur + 1} จาก ${count} · ใช้ลูกศรซ้ายขวาเปลี่ยนรูป`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        onDoubleClick={e => { if (comparing) return; setZoom(z => z ? null : zoomOrigin(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())) }}
        className={`relative aspect-[4/5] max-h-[48vh] w-full touch-pan-y overflow-hidden rounded-xl bg-black select-none ${zoom ? 'cursor-zoom-out' : comparing ? 'cursor-ew-resize' : 'cursor-grab'}`}>
        {comparing ? (
          <>
            <img src={mockupUrl!} alt="ม็อคอัพที่ลูกค้ายืนยัน" draggable={false} className="absolute inset-0 size-full bg-paper object-contain" />
            <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
              <Slide url={photos[cur]} alt={`${label} รูปที่ ${cur + 1}`} broken={broken.has(cur)} onError={() => markBroken(cur)} />
            </div>
            <span aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow" style={{ left: `${split}%` }}>
              <span className="absolute top-1/2 left-1/2 grid size-11 -translate-1/2 place-items-center rounded-full bg-white text-ink shadow-lift"><IconCompare className="size-5" /></span>
            </span>
            <span className="absolute top-2 left-2 rounded-full bg-card/90 px-2.5 py-0.5 text-sm font-semibold text-ink">ม็อคอัพ</span>
            <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2.5 py-0.5 text-sm font-semibold">รูปจากหน้างาน</span>
          </>
        ) : (
          <div className="absolute inset-0 flex" style={{ transform: `translateX(calc(${-cur * 100}% + ${drag}px))`, transition: dragging ? 'none' : 'transform .3s cubic-bezier(.2,.8,.2,1)' }}>
            {photos.map((url, i) => (
              <div key={`${i}-${url}`} className="relative h-full flex-[0_0_100%] overflow-hidden" aria-hidden={i !== cur}>
                <div className="absolute inset-0 transition-transform duration-200" style={{ transform: zoom && i === cur ? 'scale(2.2)' : 'none', transformOrigin: zoom ?? '50% 50%' }}>
                  <Slide url={url} alt={`${label} รูปที่ ${i + 1}`} broken={broken.has(i)} onError={() => markBroken(i)} />
                </div>
              </div>
            ))}
          </div>
        )}
        {!comparing && cur > 0 && <button type="button" onClick={() => go(cur - 1)} aria-label="รูปก่อนหน้า" className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 hover:bg-black/70"><IconChevronLeft className="size-6" /></button>}
        {!comparing && cur < count - 1 && <button type="button" onClick={() => go(cur + 1)} aria-label="รูปถัดไป" className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 hover:bg-black/70"><IconChevronRight className="size-6" /></button>}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="min-w-12 text-sm tabular-nums text-white/80">{cur + 1} / {count}</span>
        <span role="group" aria-label="โหมดดูรูป" className="flex rounded-full bg-white/10 p-0.5">
          <button type="button" aria-pressed={!comparing} onClick={() => setMode('single')} className={modeBtn(!comparing)}>ทีละรูป</button>
          <button type="button" aria-pressed={comparing} disabled={!mockupUrl} title={mockupUrl ? undefined : 'งานนี้ยังไม่มีม็อคอัพ'}
            onClick={() => { setMode('compare'); setZoom(null); setSplit(50) }} className={`${modeBtn(comparing)} inline-flex items-center gap-1.5 disabled:opacity-50`}>
            <IconCompare className="size-4" />เทียบม็อคอัพ
          </button>
        </span>
        <button type="button" onClick={() => { setMode('single'); setZoom(z => z ? null : '50% 40%') }} aria-pressed={!!zoom}
          className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ring-1 ring-white/30 hover:bg-white/10">
          <IconZoom className="size-4" />{zoom ? 'ย่อกลับ' : 'ขยาย'}
        </button>
      </div>
      {comparing && (
        <label className="flex items-center gap-2 px-1 text-sm text-white/80">เลื่อนเทียบ
          <input type="range" min={4} max={96} value={split} onChange={e => setSplit(Number(e.target.value))} className="flex-1 accent-gold" />
        </label>
      )}

      {count > 1 && (
        <div className="flex gap-2 overflow-x-auto px-1 pb-1">
          {photos.map((url, i) => (
            <button key={`${i}-${url}`} type="button" onClick={() => go(i)} aria-label={`ดูรูปที่ ${i + 1}`} aria-current={i === cur}
              className={`relative size-14 shrink-0 overflow-hidden rounded-lg ${i === cur ? 'ring-2 ring-white ring-offset-2 ring-offset-ink' : 'opacity-60 hover:opacity-100'}`}>
              <Slide url={url} alt="" broken={broken.has(i)} onError={() => markBroken(i)} small />
            </button>
          ))}
        </div>
      )}
      {broken.size > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          <IconAlert className="size-5 shrink-0" />มีรูปที่เปิดไม่ได้ {broken.size} รูป · กดผ่านไม่ได้จนกว่าจะเห็นครบ ให้หน้างานส่งใหม่ด้วยปุ่มไม่ผ่าน
        </p>
      )}
    </div>
  )
}

function Slide({ url, alt, broken, onError, small }: { url: string; alt: string; broken: boolean; onError: () => void; small?: boolean }) {
  if (broken || !url) {
    return (
      <span role="img" aria-label={`${alt} เปิดไม่ได้`} className="absolute inset-0 grid place-items-center bg-ink text-white/70">
        <span className="grid justify-items-center gap-1"><IconImage className={small ? 'size-5' : 'size-10'} />{!small && <span className="text-sm font-semibold">เปิดรูปไม่ได้</span>}</span>
      </span>
    )
  }
  return <img src={url} alt={alt} draggable={false} onError={onError} className="absolute inset-0 size-full object-contain" />
}
