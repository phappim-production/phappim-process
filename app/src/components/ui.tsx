import type { ComponentType, ReactNode } from 'react'
import { ROUTES, isDueSoon, isOverdue, type Job, type RouteCode } from '../proto/model'
import { dayDiff, shortDate } from '../proto/format'
import { TONE, type Tone } from './tone'
export type { Tone }

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line/80 bg-white shadow-card ${className}`}>{children}</section>
}

export function CardHeader({ icon: Icon, title, sub, right, tone = 'brand' }: {
  icon?: ComponentType<{ className?: string }>; title: ReactNode; sub?: ReactNode; right?: ReactNode; tone?: Tone
}) {
  return (
    <header className="flex items-start gap-3 px-5 pt-4 pb-3">
      {Icon && <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${TONE[tone].soft}`}><Icon className="size-[18px]" /></span>}
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-tight">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right}
    </header>
  )
}

export function Pill({ tone, children, dot }: { tone: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE[tone].soft}`}>
      {dot && <span className={`size-1.5 rounded-full ${TONE[tone].dot}`} />}
      {children}
    </span>
  )
}

/** ใช้ชื่อเดิมกับโค้ดที่มีอยู่ */
export const Tag = ({ tone, children }: { tone: Tone; children: ReactNode }) => <Pill tone={tone}>{children}</Pill>

export function RouteBadge({ route }: { route: RouteCode }) {
  const tone: Tone = route === 'dtf' ? 'dtf' : route === 'plain' ? 'neutral' : 'brand'
  return <span className={`rounded-md px-1.5 py-px text-[10.5px] font-bold tracking-wide ${TONE[tone].soft}`}>{ROUTES[route].short}</span>
}

export function DueLabel({ job: j, now, long }: { job: Job; now: Date; long?: boolean }) {
  if (j.phase === 'done') return <span className="shrink-0">ส่ง {shortDate(j.due)}</span>
  const days = dayDiff(j.due, now)
  const cls = isOverdue(j, now) ? 'font-semibold text-danger' : isDueSoon(j, now) ? 'font-semibold text-warn' : ''
  const rel = days < 0 ? `เลย ${-days} วัน` : days === 0 ? 'วันนี้' : days === 1 ? 'พรุ่งนี้' : `อีก ${days} วัน`
  return <span className={`shrink-0 ${cls}`}>{long ? `${shortDate(j.due)} (${rel})` : days <= 1 ? `ส่ง${rel}` : `ส่ง ${shortDate(j.due)}`}</span>
}

/** แถบขั้นตอน: ผ่านแล้ว / ตอนนี้ / ยังไม่ถึง */
export function StageDots({ steps, current, hold }: { steps: string[]; current: number; hold?: boolean }) {
  return (
    <span className="flex items-center gap-[3px]" aria-label={`ขั้นที่ ${Math.min(current + 1, steps.length)} จาก ${steps.length}`}>
      {steps.map((s, i) => (
        <span key={i} title={s}
          className={`h-1.5 rounded-full ${i === current ? 'w-5' : 'w-2.5'} ${i < current ? 'bg-brand' : i === current ? (hold ? 'bg-danger' : 'bg-info') : 'bg-line'}`} />
      ))}
    </span>
  )
}

export function StatTile({ icon: Icon, label, value, note, tone, active, onClick }: {
  icon: ComponentType<{ className?: string }>; label: string; value: number; note?: string; tone: Tone; active?: boolean; onClick?: () => void
}) {
  const t = TONE[value === 0 && tone !== 'brand' ? 'neutral' : tone]
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`group flex items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-card transition hover:-translate-y-px hover:shadow-lift ${active ? 'border-brand ring-2 ring-brand/15' : 'border-line/80'}`}>
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${t.soft}`}><Icon className="size-5" /></span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className={`text-2xl leading-tight font-bold tabular-nums ${value === 0 ? 'text-ink' : t.text}`}>{value}</span>
          {note && <span className="truncate text-[11px] text-muted">{note}</span>}
        </span>
      </span>
    </button>
  )
}
