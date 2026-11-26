import { useEffect, useRef, type ComponentType } from 'react'
import { STATION_NAME, STATION_ORDER, type ColumnKey, type Job, type StationCode } from '../proto/model'
import { IconAlert, IconCheck, IconFactory, IconFilm, IconScissors, IconStEmb, IconStPress, IconStPrint, IconStQc, IconStSew, IconTruck } from './icons'
import { Tr } from '../i18n/Tr'
import { useT } from '../i18n/lang'
import { STATION_THEME } from './stationTheme'
import { StationPattern } from './StationPattern'

// สั่งผลิตข้างนอกไม่มีคนในโรงงานทำ จึงไม่นับเลขสถานี 1–7 ที่คนหน้างานจำ
const STATION_PHASE: Record<StationCode, 1 | 2> = { outside: 1, print: 1, press: 1, cut: 1, dtf_press: 1, emb: 1, sew: 2, qc_pack: 2 }

const STATION_ICON: Record<StationCode, ComponentType<{ className?: string }>> = {
  outside: IconTruck, print: IconStPrint, press: IconStPress, cut: IconScissors, dtf_press: IconFilm, emb: IconStEmb, sew: IconStSew, qc_pack: IconStQc,
}

const isStation = (key: ColumnKey | 'all'): key is StationCode => key !== 'all' && key in STATION_NAME
const numbered = (key: ColumnKey | 'all'): key is StationCode => isStation(key) && STATION_ORDER.includes(key)

export function StationIcon({ station, className }: { station: StationCode; className?: string }) {
  const Icon = STATION_ICON[station]
  return <Icon className={className} />
}

export function StationRail({ columns, counts, urgent, station, onPick }: {
  columns: { key: ColumnKey; name: string }[]; counts: (key: ColumnKey | 'all') => number; urgent: (key: ColumnKey) => number
  station: ColumnKey | 'all'; onPick: (key: ColumnKey | 'all') => void
}) {
  const rail = useRef<HTMLElement>(null)
  const t = useT()
  useEffect(() => {
    rail.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [station])
  const stations = STATION_ORDER.filter(s => columns.some(c => c.key === s))
  // งานทุกงานผ่านขั้นรอผลิตก่อนเข้าสถานีแรก
  const waiting = columns.filter(c => c.key === 'materials')
  const others = columns.filter(c => !numbered(c.key) && c.key !== 'materials')
  const chip = (key: ColumnKey | 'all', name: string) => {
    const on = station === key
    const Icon = isStation(key) ? STATION_ICON[key] : key === 'done' ? IconCheck : IconFactory
    const theme = isStation(key) ? STATION_THEME[key] : null
    const n = counts(key)
    const hot = key === 'all' ? 0 : urgent(key)
    return (
      <li key={key} className="shrink-0">
        <button type="button" onClick={() => onPick(key)} aria-pressed={on}
          className={`flex min-h-12 items-center gap-1.5 rounded-xl border-2 px-2.5 py-1 text-center sm:min-h-16 sm:min-w-20 sm:flex-col sm:justify-center sm:gap-0.5 sm:py-1.5 ${on ? `border-transparent ${theme?.solid ?? 'bg-brand'} text-white` : 'border-line bg-card hover:border-brand'}`}>
          <span className="flex items-center gap-1 text-sm font-semibold">
            {numbered(key) && <span className={`grid size-5 place-items-center rounded-full text-xs ${on ? `bg-white ${theme?.text ?? 'text-brand'}` : `${theme?.soft ?? 'bg-brand-soft'} ${theme?.text ?? 'text-brand'}`}`}>{STATION_ORDER.indexOf(key) + 1}</span>}
            <Icon className={`size-4 ${on ? '' : theme?.text ?? ''}`} />
          </span>
          <span className="text-sm font-semibold whitespace-nowrap">{t(name)}</span>
          <span className="flex items-baseline gap-1 text-sm">
            <b className="text-lg tabular-nums">{n}</b>
            {hot > 0 && <span className={`inline-flex items-center gap-0.5 font-bold ${on ? 'text-white' : 'text-danger'}`} title={t('เลยกำหนด / ติดปัญหา {n}', { n: hot })}><IconAlert className="size-4" /><span className="sr-only">{t('เลยกำหนด / ติดปัญหา {n}', { n: hot })}</span><span aria-hidden>{hot}</span></span>}
          </span>
        </button>
      </li>
    )
  }
  return (
    <nav ref={rail} aria-label={t('เลือกสถานี')} className="relative -mx-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
      <ol className="flex gap-2 md:flex-wrap">
        {chip('all', 'ทุกสถานี')}
        {waiting.map(c => chip(c.key, c.name))}
        {stations.map(s => chip(s, columns.find(c => c.key === s)!.name))}
        {others.map(c => chip(c.key, c.name))}
      </ol>
    </nav>
  )
}

export function StationHeader({ station, jobs, stations, machines, onPick }: {
  station: StationCode; jobs: Job[]; stations: StationCode[]; machines?: { used: Job[]; total: number; full: boolean } | null
  onPick: (key: StationCode) => void
}) {
  const Icon = STATION_ICON[station]
  const t = useT()
  const here = jobs.filter(j => (j.phase === 'sample' || j.phase === 'production') && j.station === station)
  const count = (status: Job['status']) => here.filter(j => j.status === status).length
  const order = STATION_ORDER.filter(s => stations.includes(s))
  const i = order.indexOf(station)
  const prev = i > 0 ? order[i - 1] : undefined
  const next = i >= 0 && i < order.length - 1 ? order[i + 1] : undefined
  const stats: [string, number, string][] = [
    ['กำลังทำ', count('doing'), 'text-info'], ['รอคิว', count('queued'), 'text-ink'],
    ['ติดปัญหา', count('hold'), count('hold') ? 'text-danger' : 'text-ink'], ['ข้างนอก', count('out'), 'text-ink'],
  ]
  const theme = STATION_THEME[station]
  const step = (s: StationCode | undefined, dir: 'prev' | 'next') => s ? (
    <button type="button" onClick={() => onPick(s)} className="min-h-12 rounded-xl bg-white/12 px-3 font-semibold text-white ring-1 ring-white/30 hover:bg-white/20">
      {dir === 'prev' ? `‹ ${STATION_ORDER.indexOf(s) + 1} ${t(STATION_NAME[s])}` : `${STATION_ORDER.indexOf(s) + 1} ${t(STATION_NAME[s])} ›`}
    </button>
  ) : <span />
  return (
    <section aria-label={t('สถานี{station}', { station: { th: STATION_NAME[station] } })} className={`relative grid gap-2 overflow-hidden rounded-2xl p-3 text-white shadow-card sm:gap-3 sm:p-4 ${theme.solid}`}>
      <StationPattern kind={theme.pattern} />
      <div className="relative flex items-center gap-3">
        <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25 sm:grid"><Icon className="size-8" /></span>
        <div className="min-w-0">
          <p className={`text-sm text-white/85 ${numbered(station) ? 'hidden sm:block' : ''}`}>{numbered(station) ? t('สถานีที่ {n} จาก {total} · เฟส {phase}', { n: STATION_ORDER.indexOf(station) + 1, total: STATION_ORDER.length, phase: STATION_PHASE[station] }) : t('โรงงานนอกทำ · แอดมินส่งออกและรับเข้า')}</p>
          <h2 className="flex items-center gap-2 truncate font-display text-xl font-semibold sm:text-2xl">
            {numbered(station) && <span className={`grid size-8 shrink-0 place-items-center rounded-full bg-white text-lg sm:size-9 ${theme.text}`}>{STATION_ORDER.indexOf(station) + 1}</span>}
            <Icon className="size-6 shrink-0 sm:hidden" />
            <Tr th={STATION_NAME[station]} />
          </h2>
        </div>
        {machines && (
          <span className={`ml-auto shrink-0 rounded-xl px-2.5 py-1 text-center font-semibold sm:px-3 sm:py-1.5 ${machines.full ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
            {t('เครื่อง {used}/{total}', { used: machines.used.length, total: machines.total })}
            <span className="block text-sm font-medium">{machines.full ? t('เต็ม') : t('ว่าง {n}', { n: machines.total - machines.used.length })}</span>
          </span>
        )}
      </div>
      <dl className="relative hidden grid-cols-4 gap-2 sm:grid">
        {stats.map(([label, n, tone]) => (
          <div key={label} className="flex flex-col-reverse rounded-xl bg-card px-1 py-1 text-center sm:py-2">
            <dt className="text-sm text-muted">{t(label)}</dt>
            <dd className={`font-display text-xl font-medium tabular-nums sm:text-2xl ${tone}`}>{n}</dd>
          </div>
        ))}
      </dl>
      {(prev || next) && <div className="relative flex items-center justify-between gap-2">{step(prev, 'prev')}{step(next, 'next')}</div>}
    </section>
  )
}
