import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MARGIN_X, MARGIN_Y, clampBox, fromStage, onStage, stageSize, type Callout, type MockView } from '../../proto/annotation'

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

  const at = (e: { clientX: number; clientY: number }, part: Drag['part']) => {
    const rect = stage.current?.getBoundingClientRect()
    const p = rect ? fromStage(e.clientX, e.clientY, rect) : { x: 0, y: 0 }
    if (part === 'point') return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }
    const b = clampBox(p.x, p.y)
    return { x: b.boxX, y: b.boxY }
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
    setDrag({ ...drag, ...at(e, drag.part), moved })
  }
  const up = () => {
    if (drag?.moved) onMove?.(drag.key, drag.part === 'point' ? { x: drag.x, y: drag.y } : { boxX: drag.x, boxY: drag.y })
    setDrag(null)
  }

  const w = view.width, h = view.height
  const full = stageSize(w, h)
  const img = onStage(0, 0)
  const at100 = (x: number, y: number) => { const s = onStage(x, y); return { left: `${s.left * 100}%`, top: `${s.top * 100}%` } }
  return (
    <div ref={stage} className="relative mx-auto select-none" data-testid={`canvas-${view.view}`}
      style={{ width: fitHeight ? `min(100%, calc(${fitHeight} * ${full.width / full.height}))` : `${zoom * 100}%`, aspectRatio: `${full.width} / ${full.height}` }}
      onClick={e => { if (editable && onAdd && e.target === e.currentTarget.querySelector('img')) { const p = at(e, 'point'); onAdd(p.x, p.y) } }}>
      {url
        ? <img src={url} alt="" draggable={false} className={`absolute object-contain ${editable ? 'cursor-crosshair' : ''}`}
          style={{ left: `${img.left * 100}%`, top: `${img.top * 100}%`, width: `${100 / (1 + 2 * MARGIN_X)}%`, height: `${100 / (1 + 2 * MARGIN_Y)}%` }} />
        : <div className="absolute inset-0 grid place-items-center rounded-xl bg-card-2 text-muted">กำลังโหลดภาพ…</div>}
      <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`${-MARGIN_X * w} ${-MARGIN_Y * h} ${full.width} ${full.height}`} preserveAspectRatio="none" aria-hidden>
        {callouts.map(c => {
          const p = pos(c)
          return <line key={c.key} x1={p.x * w} y1={p.y * h} x2={p.boxX * w} y2={p.boxY * h}
            stroke={c.key === selected ? 'var(--color-brand)' : 'var(--color-gold)'} strokeWidth={print ? 1 : 1.75} vectorEffect="non-scaling-stroke" />
        })}
      </svg>
      {callouts.map(c => {
        const p = pos(c)
        const on = c.key === selected
        const lines = labels(c)
        return (
          <div key={c.key} className="contents">
            {/* ปลายเส้นไม่มีตัวเลข ไม่บังลายลูกค้า · หน้าแก้ไขมีวงแหวนบางไว้จับลาก */}
            {!print && <button type="button" aria-label={`Callout ${c.no} ${c.title}`} aria-pressed={on}
              onPointerDown={down(c, 'point')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
              className={`absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent ${editable ? `cursor-grab touch-none border-2 ${on ? 'z-30 border-brand' : 'z-20 border-gold'}` : 'z-20'}`}
              style={at100(p.x, p.y)} />}
            <div role="button" tabIndex={0} aria-label={`กล่องข้อความ Callout ${c.no}`}
              onPointerDown={down(c, 'box')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(c.key) }}
              className={`absolute w-max -translate-x-1/2 -translate-y-1/2 rounded-md border bg-card px-1.5 py-0.5 leading-snug text-ink shadow-card ${print ? 'max-w-[22%] text-[7.5pt]' : 'max-w-[24%] text-xs'} ${on ? 'z-30 border-brand ring-1 ring-brand' : 'z-10 border-gold'} ${editable ? 'cursor-move touch-none' : 'cursor-pointer'}`}
              style={at100(p.boxX, p.boxY)}>
              <p className="font-bold"><span className="text-brand">{c.no}</span> {c.title || <span className="text-muted">(ยังไม่ตั้งชื่อ)</span>}</p>
              {lines.map((l, i) => <p key={i} className="break-words">{l}</p>)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
