import { useEffect, useRef, type ComponentType } from 'react'
import { STATION_NAME, type ColumnKey, type Job, type StationCode } from '../proto/model'
import { IconCheck, IconFactory, IconFilm, IconFlame, IconPackage, IconPrinter, IconScissors, IconSewing, IconSparkles } from './icons'

const STATION_ORDER: StationCode[] = ['print', 'press', 'cut', 'dtf_press', 'emb', 'sew', 'qc_pack']
const STATION_PHASE: Record<StationCode, 1 | 2> = { print: 1, press: 1, cut: 1, dtf_press: 1, emb: 1, sew: 2, qc_pack: 2 }

const STATION_ICON: Record<StationCode, ComponentType<{ className?: string }>> = {
  print: IconPrinter, press: IconFlame, cut: IconScissors, dtf_press: IconFilm, emb: IconSparkles, sew: IconSewing, qc_pack: IconPackage,
}

const isStation = (key: ColumnKey | 'all'): key is StationCode => key !== 'all' && key in STATION_NAME

export function StationRail({ columns, counts, urgent, station, onPick }: {
  columns: { key: ColumnKey; name: string }[]; counts: (key: ColumnKey | 'all') => number; urgent: (key: ColumnKey) => number
  station: ColumnKey | 'all'; onPick: (key: ColumnKey | 'all') => void
}) {
  const rail = useRef<HTMLElement>(null)
  useEffect(() => {
    rail.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [station])
  const stations = STATION_ORDER.filter(s => columns.some(c => c.key === s))
  const others = columns.filter(c => !isStation(c.key))
  const chip = (key: ColumnKey | 'all', name: string) => {
    const on = station === key
    const Icon = isStation(key) ? STATION_ICON[key] : key === 'done' ? IconCheck : IconFactory
    const n = counts(key)
    const hot = key === 'all' ? 0 : urgent(key)
    return (
      <li key={key} className="shrink-0">
        <button type="button" onClick={() => onPick(key)} aria-pressed={on}
          className={`flex min-h-16 min-w-20 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-2.5 py-1.5 text-center ${on ? 'border-brand bg-brand text-white' : 'border-line bg-card hover:border-brand'}`}>
          <span className="flex items-center gap-1 text-sm font-semibold">
            {isStation(key) && <span className={`grid size-5 place-items-center rounded-full text-xs ${on ? 'bg-white text-brand' : 'bg-brand-soft text-brand'}`}>{STATION_ORDER.indexOf(key) + 1}</span>}
            <Icon className="size-4" />
          </span>
          <span className="text-sm font-semibold whitespace-nowrap">{name}</span>
          <span className="flex items-baseline gap-1 text-sm">
            <b className="text-lg tabular-nums">{n}</b>
            {hot > 0 && <span className={`font-bold ${on ? 'text-white' : 'text-danger'}`}>ด่วน {hot}</span>}
          </span>
        </button>
      </li>
    )
  }
  return (
    <nav ref={rail} aria-label="เลือกสถานี" className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
      <ol className="flex gap-2">
        {chip('all', 'ทุกสถานี')}
        {stations.map(s => chip(s, columns.find(c => c.key === s)!.name))}
        {others.map(c => chip(c.key, c.name))}
      </ol>
    </nav>
  )
}

export function StationHeader({ station, jobs, stations, onPick }: {
  station: StationCode; jobs: Job[]; stations: StationCode[]; onPick: (key: StationCode) => void
}) {
  const Icon = STATION_ICON[station]
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
  const step = (s: StationCode | undefined, dir: 'prev' | 'next') => s ? (
    <button type="button" onClick={() => onPick(s)} className="min-h-12 rounded-xl border border-line px-3 font-semibold text-brand hover:border-brand">
      {dir === 'prev' ? `‹ ${STATION_ORDER.indexOf(s) + 1} ${STATION_NAME[s]}` : `${STATION_ORDER.indexOf(s) + 1} ${STATION_NAME[s]} ›`}
    </button>
  ) : <span />
  return (
    <section aria-label={`สถานี${STATION_NAME[station]}`} className="grid gap-3 rounded-2xl border border-line bg-card p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon className="size-8" /></span>
        <div className="min-w-0">
          <p className="text-sm text-muted">สถานีที่ {STATION_ORDER.indexOf(station) + 1} จาก {STATION_ORDER.length} · เฟส {STATION_PHASE[station]}</p>
          <h2 className="truncate text-2xl font-bold">{STATION_NAME[station]}</h2>
        </div>
      </div>
      <dl className="grid grid-cols-4 gap-2">
        {stats.map(([label, n, tone]) => (
          <div key={label} className="flex flex-col-reverse rounded-xl bg-paper px-1 py-2 text-center">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className={`text-2xl font-bold tabular-nums ${tone}`}>{n}</dd>
          </div>
        ))}
      </dl>
      {(prev || next) && <div className="flex items-center justify-between gap-2">{step(prev, 'prev')}{step(next, 'next')}</div>}
    </section>
  )
}
