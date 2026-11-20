import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { toNormalized, type Callout, type MockView } from '../../proto/annotation'

type Drag = { key: string; part: 'point' | 'box'; x: number; y: number; moved: boolean; startX: number; startY: number }

export function AnnotationCanvas({ view, url, callouts, labels, selected, editable, zoom = 1, print, fitHeight, onAdd, onMove, onSelect }: {
  view: MockView; url: string | undefined; callouts: Callout[]; labels: (c: Callout) => string[]
  selected?: string | null; editable?: boolean; zoom?: number; print?: boolean; fitHeight?: string
  onAdd?: (x: number, y: number) => void
  onMove?: (key: string, patch: { x: number; y: number } | { boxX: number; boxY: number }) => void
  onSelect?: (key: string) => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const at = (e: { clientX: number; clientY: number }) => {
    const rect = stage.current?.getBoundingClientRect()
    return rect ? toNormalized(e.clientX, e.clientY, rect) : { x: 0, y: 0 }
  }
  const pos = (c: Callout) => {
    const live = drag?.key === c.key ? drag : null
    return {
      x: live?.part === 'point' ? live.x : c.x, y: live?.part === 'point' ? live.y : c.y,
      boxX: live?.part === 'box' ? live.x : c.boxX, boxY: live?.part === 'box' ? live.y : c.boxY,
    }
  }
  const down = (c: Callout, part: Drag['part']) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation()
    onSelect?.(c.key)
    if (!editable) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pos(c)
    setDrag({ key: c.key, part, x: part === 'point' ? p.x : p.boxX, y: part === 'point' ? p.y : p.boxY, moved: false, startX: e.clientX, startY: e.clientY })
  }
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4
    if (!moved) return
    setDrag({ ...drag, ...at(e), moved })
  }
  const up = () => {
    if (drag?.moved) onMove?.(drag.key, drag.part === 'point' ? { x: drag.x, y: drag.y } : { boxX: drag.x, boxY: drag.y })
    setDrag(null)
  }

  const w = view.width, h = view.height
  const marker = print ? 'size-7 text-sm' : 'size-9 text-base'
  return (
    <div ref={stage} className="relative mx-auto select-none" data-testid={`canvas-${view.view}`}
      style={{ width: fitHeight ? `min(100%, calc(${fitHeight} * ${w / h}))` : `${zoom * 100}%`, aspectRatio: `${w} / ${h}` }}
      onClick={e => { if (editable && onAdd && e.target === e.currentTarget.querySelector('img')) { const p = at(e); onAdd(p.x, p.y) } }}>
      {url
        ? <img src={url} alt="" draggable={false} className={`absolute inset-0 size-full object-contain ${editable ? 'cursor-crosshair' : ''}`} />
        : <div className="absolute inset-0 grid place-items-center rounded-xl bg-card-2 text-muted">กำลังโหลดภาพ…</div>}
      <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        {callouts.map(c => {
          const p = pos(c)
          return <line key={c.key} x1={p.x * w} y1={p.y * h} x2={p.boxX * w} y2={p.boxY * h}
            stroke={c.key === selected ? 'var(--color-brand)' : 'var(--color-gold)'} strokeWidth={print ? 1.5 : 2.5} vectorEffect="non-scaling-stroke" />
        })}
      </svg>
      {callouts.map(c => {
        const p = pos(c)
        const on = c.key === selected
        const lines = labels(c)
        return (
          <div key={c.key} className="contents">
            <button type="button" aria-label={`Callout ${c.no} ${c.title}`} aria-pressed={on}
              onPointerDown={down(c, 'point')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
              className={`absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white font-bold text-white shadow-card ${marker} ${on ? 'z-30 bg-gold text-brand-700 ring-4 ring-brand' : 'z-20 bg-brand'} ${editable ? 'cursor-grab touch-none' : ''}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>
              {c.no}
            </button>
            <div role="button" tabIndex={0} aria-label={`กล่องข้อความ Callout ${c.no}`}
              onPointerDown={down(c, 'box')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(c.key) }}
              className={`absolute w-max -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 bg-card px-2 py-1 leading-snug text-ink shadow-card ${print ? 'max-w-[34%] text-[9pt]' : 'max-w-[42%] text-sm'} ${on ? 'z-30 border-brand' : 'z-10 border-gold'} ${editable ? 'cursor-move touch-none' : 'cursor-pointer'}`}
              style={{ left: `${p.boxX * 100}%`, top: `${p.boxY * 100}%` }}>
              <p className="font-bold"><span className="text-brand">{c.no}</span> {c.title || <span className="text-muted">(ยังไม่ตั้งชื่อ)</span>}</p>
              {lines.map((l, i) => <p key={i} className="break-words">{l}</p>)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
