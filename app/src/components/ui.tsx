import type { ComponentType, HTMLAttributes, ReactNode } from 'react'
import { ROUTES, isDueSoon, isOverdue, usesFilm, type Job, type RouteCode } from '../proto/model'
import { dayDiff, shortDate } from '../proto/format'
import { TONE, type Tone } from './tone'
import { IconImage } from './icons'
import { useLang, useT } from '../i18n/lang'
import { Tr } from '../i18n/Tr'
export type { Tone }

export function ViewSwitch<T extends string>({ label, value, onChange, options, variant = 'main' }: {
  label: string; value: T; onChange: (value: T) => void; options: ReadonlyArray<readonly [T, string]>
  /** sub = แท็บย่อย ใช้เส้นใต้ ไม่ให้ผู้ใช้สับสนว่าอยู่ชั้นไหน */
  variant?: 'main' | 'sub'
}) {
  if (variant === 'sub') {
    return (
      <div role="group" aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b-2 border-line">
        {options.map(([key, text]) => (
          <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={key === value}
            className={`-mb-0.5 min-h-12 shrink-0 border-b-[3px] px-4 text-base font-semibold whitespace-nowrap ${key === value ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}>
            {text}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div role="group" aria-label={label} className={pillGroup}>
      {options.map(([key, text]) => (
        <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={key === value}
          className={`${pillItem} ${key === value ? pillOn : pillOff}`}>
          {text}
        </button>
      ))}
    </div>
  )
}

export const pillGroup = 'flex gap-1 rounded-xl border border-line bg-card p-1'
export const pillItem = 'min-h-12 flex-1 rounded-lg px-3 text-base font-semibold whitespace-nowrap sm:flex-none sm:px-6'
export const pillOn = 'bg-brand text-white'
export const pillOff = 'text-ink hover:bg-paper'

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  return <section {...rest} className={`rounded-2xl border border-line bg-card shadow-card ${className}`}>{children}</section>
}

export function CardHeader({ icon: Icon, title, sub, right, tone = 'brand' }: {
  icon?: ComponentType<{ className?: string }>; title: ReactNode; sub?: ReactNode; right?: ReactNode; tone?: Tone
}) {
  return (
    <header className="flex items-start gap-3 px-4 pt-4 pb-3 sm:px-5">
      {Icon && <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${TONE[tone].soft}`}><Icon className="size-5" /></span>}
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold leading-tight">{title}</h3>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </header>
  )
}

export function Pill({ tone, children, dot, wrap }: { tone: Tone; children: ReactNode; dot?: boolean; wrap?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${wrap ? 'max-w-full [overflow-wrap:anywhere]' : 'whitespace-nowrap'} ${TONE[tone].soft}`}>
      {dot && <span className={`size-1.5 rounded-full ${TONE[tone].dot}`} />}
      {children}
    </span>
  )
}

/** ใช้ชื่อเดิมกับโค้ดที่มีอยู่ */
export const Tag = ({ tone, children }: { tone: Tone; children: ReactNode }) => <Pill tone={tone}>{children}</Pill>

export function RouteBadge({ route }: { route: RouteCode }) {
  const tone: Tone = usesFilm(route) ? 'dtf' : route === 'plain' || route === 'cut_only' ? 'neutral' : 'brand'
  return <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${TONE[tone].soft}`}>{ROUTES[route].short}</span>
}

export function DueLabel({ job: j, now, long }: { job: Job; now: Date; long?: boolean }) {
  const t = useT()
  // ชื่อเดือนย่อภาษาไทยคนพม่าอ่านไม่ออก ใช้วัน/เดือนเป็นตัวเลขแทน
  const day = useLang() === 'my' ? (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'numeric' }) : shortDate
  if (j.phase === 'done') return <span className="shrink-0">{t('ส่ง {date}', { date: day(j.due) })}</span>
  const days = dayDiff(j.due, now)
  const cls = isOverdue(j, now) ? 'font-semibold text-danger' : isDueSoon(j, now) ? 'font-semibold text-warn' : ''
  const rel = days < 0 ? t('เลย {n} วัน', { n: -days }) : days === 0 ? t('วันนี้') : days === 1 ? t('พรุ่งนี้') : t('อีก {n} วัน', { n: days })
  const short = days < 0 ? t('ส่งเลย {n} วัน', { n: -days }) : days === 0 ? t('ส่งวันนี้') : days === 1 ? t('ส่งพรุ่งนี้') : t('ส่ง {date}', { date: day(j.due) })
  return <span className={`shrink-0 ${cls}`}>{long ? `${day(j.due)} (${rel})` : short}</span>
}

export function StageDots({ steps, current, hold }: { steps: string[]; current: number; hold?: boolean }) {
  return (
    <span className="flex items-center gap-[3px]" aria-label={`ขั้นที่ ${Math.min(current + 1, steps.length)} จาก ${steps.length}`}>
      {steps.map((s, i) => (
        <span key={i} title={s}
          className={`h-2 rounded-full ${i === current ? 'w-6' : 'w-3'} ${i < current ? 'bg-brand' : i === current ? (hold ? 'bg-danger' : 'bg-info') : 'bg-line'}`} />
      ))}
    </span>
  )
}

export function StatTile({ icon: Icon, label, value, note, noteOnPhone, tone, active, onClick }: {
  icon: ComponentType<{ className?: string }>; label: string; value: number; note?: string; noteOnPhone?: boolean; tone: Tone; active?: boolean; onClick?: () => void
}) {
  const t = TONE[value === 0 && tone !== 'brand' ? 'neutral' : tone]
  // มือถือ: ไอคอน + ชื่อบรรทัดเดียว ตัวเลขใหญ่ด้านล่าง ไม่ให้ 4 ช่องกินครึ่งจอ
  const body = (
    <>
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${t.soft}`}><Icon className="size-5" /></span>
        <span className="min-w-0 text-sm leading-tight font-semibold text-muted"><Tr th={label} /></span>
      </span>
      <span className={`mt-1.5 block text-3xl leading-none font-bold tabular-nums ${value === 0 ? 'text-ink' : t.text}`}>{value}</span>
      {note && <span className={`mt-1 text-sm leading-snug text-muted ${noteOnPhone ? 'block' : 'hidden sm:block'}`}><Tr th={note} /></span>}
    </>
  )
  const cls = `flex min-w-0 flex-col items-start rounded-2xl border bg-card p-3 text-left shadow-card sm:p-4 ${active ? 'border-brand ring-2 ring-brand/20' : 'border-line'}`
  // การ์ดตัวเลขที่ไม่ได้ใช้กรอง ไม่ควรเป็นปุ่ม (ผู้ใช้จะคิดว่ากดได้)
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={`${cls} hover:border-brand`}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

const THUMB_SIZE = { sm: 'size-14', md: 'size-20', lg: 'aspect-square w-full max-w-72' } as const

// ไม่มีรูป = กรอบว่างขนาดเท่ากัน การ์ดจึงเรียงตรงกัน
export function MockupThumb({ job, size = 'sm' }: { job: Pick<Job, 'no' | 'mockupUrl'>; size?: keyof typeof THUMB_SIZE }) {
  const box = `${THUMB_SIZE[size]} shrink-0 overflow-hidden rounded-xl border border-line bg-paper`
  if (!job.mockupUrl) {
    return (
      <span className={`${box} grid place-items-center text-muted`} title="ยังไม่มีรูปม็อคอัพ">
        <IconImage className={size === 'lg' ? 'size-10' : 'size-6'} />
      </span>
    )
  }
  return <img src={job.mockupUrl} alt={`รูปม็อคอัพงาน ${job.no}`} loading="lazy" decoding="async" className={`${box} object-contain`} />
}

