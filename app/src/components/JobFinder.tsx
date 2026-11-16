import { useEffect, useMemo, useRef, useState } from 'react'
import { ROUTES, STATION_NAME, STATUS_NAME, isFilmLate, isWaitingFilm, missingDepts, DEPT_NAME, type Job } from '../proto/model'
import { lateDays, workdayToDate, type Forecast } from '../proto/capacity'
import { duration, shortDate, stageSteps, stageText } from '../proto/format'
import { DueLabel, Pill, RouteBadge } from './ui'
import { IconAlert, IconCheck, IconChevronRight, IconClock, IconFilm, IconSearch, IconX } from './icons'

type Props = { jobs: Job[]; now: Date; forecast: Forecast; onOpen: (id: string) => void }

// ตามหางาน: พิมพ์เลขที่ใบ (SC…) หรือชื่อลูกค้า แล้วเห็นทันทีว่างานอยู่ขั้นไหน
export default function JobFinder({ jobs, now, forecast, onOpen }: Props) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [focus, setFocus] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, '')
    if (!s) return []
    return jobs.filter(j => `${j.no}${j.customer}${j.product}`.toLowerCase().replace(/\s+/g, '').includes(s)).slice(0, 6)
  }, [jobs, q])

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setFocus(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const job = jobs.find(j => j.id === picked) ?? null
  const pick = (j: Job) => { setPicked(j.id); setQ(j.no); setFocus(false) }
  // ทางลัด: งานที่ควรดูก่อน (ติดปัญหา / เลยกำหนด / เสี่ยงไม่ทัน)
  const quick = useMemo(() => jobs.filter(j => j.phase !== 'done')
    .map(j => ({ j, late: lateDays(workdayToDate(forecast.finishDay.get(j.id) ?? 0, now), j.due) }))
    .sort((a, b) => Number(b.j.status === 'hold') - Number(a.j.status === 'hold') || b.late - a.late)
    .slice(0, 5).map(x => x.j), [jobs, forecast, now])

  return (
    <section className="rounded-2xl border border-line/80 bg-white shadow-card">
      <div ref={box} className="relative p-4 sm:p-5">
        <label className="sr-only">ตามหางาน · งานนี้อยู่ขั้นไหน?</label>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setFocus(true); setPicked(null) }}
            onFocus={e => { setFocus(true); e.currentTarget.select() }}
            onKeyDown={e => { if (e.key === 'Enter' && matches[0]) pick(matches[0]); if (e.key === 'Escape') setFocus(false) }}
            placeholder="พิมพ์เลขที่ใบยืนยัน เช่น SC691520 หรือชื่อลูกค้า"
            className="w-full rounded-2xl border-2 border-line bg-paper/50 py-3.5 pr-12 pl-12 text-base outline-none transition placeholder:text-muted/70 focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
            aria-label="ค้นหางาน" autoComplete="off" inputMode="search"
          />
          {q && (
            <button onClick={() => { setQ(''); setPicked(null) }} className="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-paper" aria-label="ล้าง">
              <IconX className="size-4" />
            </button>
          )}
        </div>

        {/* รายการแนะนำ */}
        {focus && q && !job && (
          <ul className="absolute inset-x-4 top-full z-20 -mt-2 overflow-hidden rounded-2xl border border-line bg-white shadow-lift sm:inset-x-5">
            {matches.map(j => (
              <li key={j.id}>
                <button onMouseDown={e => e.preventDefault()} onClick={() => pick(j)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-brand-soft/50">
                  <span className="w-24 shrink-0 font-semibold">{j.no}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{j.customer} · {j.product}</span>
                  <span className="hidden truncate text-xs sm:block">{stageText(j)}</span>
                </button>
              </li>
            ))}
            {!matches.length && <li className="px-4 py-3 text-sm text-muted">ไม่พบงานที่ตรงกับ "{q}"</li>}
          </ul>
        )}

        {!job && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">ดูด่วน:</span>
            {quick.map(j => (
              <button key={j.id} onClick={() => pick(j)} className="rounded-full border border-line bg-white px-3 py-1 font-semibold transition hover:border-brand hover:text-brand">{j.no}</button>
            ))}
          </div>
        )}
      </div>

      {job && <JobStatus job={job} now={now} forecast={forecast} onOpen={() => onOpen(job.id)} />}
    </section>
  )
}

function JobStatus({ job: j, now, forecast, onOpen }: { job: Job; now: Date; forecast: Forecast; onOpen: () => void }) {
  const { steps, current } = stageSteps(j)
  const all = [...steps, 'พร้อมส่ง']
  const cur = j.phase === 'done' ? all.length - 1 : current
  const hold = j.status === 'hold'
  const finish = j.phase !== 'done' ? workdayToDate(forecast.finishDay.get(j.id) ?? 0, now) : null
  const late = finish ? lateDays(finish, j.due) : 0
  const next = j.phase !== 'done' ? all[cur + 1] : null
  const where = (j.phase === 'production' || j.phase === 'sample') && j.station ? STATION_NAME[j.station]
    : j.phase === 'materials' ? 'รอวัตถุดิบ' : j.phase === 'sample_review' ? 'รอลูกค้ายืนยันตัวอย่าง' : j.phase === 'done' ? 'พร้อมส่ง' : all[cur]
  const status = j.phase === 'done' ? 'เสร็จแล้ว'
    : j.status ? STATUS_NAME[j.status]
    : j.phase === 'materials' ? `รอ ${missingDepts(j).map(d => DEPT_NAME[d]).join(', ')}`
    : j.phase === 'sample_review' ? `ตัวอย่างรอบ ${j.sampleRound}` : 'รอคิว'
  const stepsRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    stepsRef.current?.querySelector('[data-current]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [j.id])

  return (
    <div className="animate-fade border-t border-line">
      {/* หัว: งานไหน + อยู่ตรงไหน */}
      <div className="flex flex-wrap items-start gap-4 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">{j.no}</span>
            <RouteBadge route={j.route} />
            {j.sampleRound > 1 && j.phase !== 'done' && <Pill tone="info">ตัวอย่างรอบ {j.sampleRound}</Pill>}
            {j.rework && <Pill tone="danger">งานแก้</Pill>}
          </div>
          <p className="truncate text-sm text-muted">{j.customer} · {j.product} {j.qty.toLocaleString('th-TH')} {j.unit} · เส้นทาง{ROUTES[j.route].short}</p>
        </div>
        <button onClick={onOpen} className="inline-flex items-center gap-1 rounded-xl border border-line px-3 py-2 text-sm font-semibold text-brand transition hover:border-brand hover:bg-brand-soft/40">
          รายละเอียดเต็ม <IconChevronRight className="size-4" />
        </button>
      </div>

      <div className={`mx-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl p-4 sm:mx-5 ${hold ? 'bg-danger-soft' : j.phase === 'done' ? 'bg-ok-soft' : 'bg-info-soft'}`}>
        <div>
          <p className="text-xs text-muted">ตอนนี้อยู่ที่</p>
          <p className={`text-2xl font-bold ${hold ? 'text-danger' : j.phase === 'done' ? 'text-ok' : 'text-info'}`}>
            {j.phase === 'sample' ? `ขึ้นตัวอย่าง · ${where}` : where}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold">
            {hold ? <IconAlert className="size-4 text-danger" /> : j.phase === 'done' ? <IconCheck className="size-4 text-ok" /> : <IconClock className="size-4 text-info" />}
            {status}
            {j.phase !== 'done' && <span className="font-normal text-muted">· อยู่มา {duration(now.getTime() - j.since.getTime())}</span>}
          </p>
        </div>
        <div className="ml-auto grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <Fact label="กำหนดส่ง"><DueLabel job={j} now={now} long /></Fact>
          {finish && <Fact label="คาดว่าเสร็จ"><span className={late > 0 ? 'font-semibold text-danger' : 'font-semibold text-ok'}>{shortDate(finish)} {late > 0 ? `(ช้า ${late} วัน)` : '(ทัน)'}</span></Fact>}
          {next && <Fact label="ขั้นต่อไป">{next}</Fact>}
        </div>
      </div>

      {/* แถบขั้นตอนเต็ม */}
      <ol ref={stepsRef} className="scroll-thin flex overflow-x-auto px-4 pt-5 pb-4 sm:px-5" aria-label="ขั้นตอนของงาน">
        {all.map((s, i) => {
          const state = i < cur || j.phase === 'done' ? 'done' : i === cur ? (hold ? 'hold' : 'current') : 'todo'
          return (
            <li key={i} data-current={i === cur || undefined} className="relative flex min-w-[88px] flex-1 flex-col items-center text-center">
              {i > 0 && <span className={`absolute top-[15px] right-1/2 left-[-50%] h-1 rounded-full ${i <= cur ? 'bg-brand' : 'bg-line'}`} />}
              <span className={`relative z-10 grid size-8 place-items-center rounded-full text-xs font-bold ${
                state === 'done' ? 'bg-brand text-white' : state === 'current' ? 'bg-info text-white ring-4 ring-info/20' : state === 'hold' ? 'bg-danger text-white ring-4 ring-danger/20' : 'border-2 border-line bg-white text-muted'}`}>
                {state === 'done' ? '✓' : state === 'hold' ? '!' : i + 1}
              </span>
              <span className={`mt-2 px-1 text-xs leading-tight ${state === 'current' ? 'font-bold text-info' : state === 'hold' ? 'font-bold text-danger' : state === 'done' ? 'text-ink' : 'text-muted'}`}>{s}</span>
              {(state === 'current' || state === 'hold') && <span className={`mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${state === 'hold' ? 'bg-danger' : 'bg-info'}`}>ตอนนี้</span>}
            </li>
          )
        })}
      </ol>

      {/* เรื่องที่ต้องรู้ */}
      <Notes job={j} now={now} />
    </div>
  )
}

function Notes({ job: j, now }: { job: Job; now: Date }) {
  const notes: { tone: 'danger' | 'warn' | 'info'; icon: typeof IconAlert; text: string }[] = []
  if (j.holdReason) notes.push({ tone: 'danger', icon: IconAlert, text: `ติดปัญหา: ${j.holdReason}` })
  if (j.phase === 'materials') notes.push({ tone: 'warn', icon: IconClock, text: `รอวัตถุดิบจาก ${missingDepts(j).map(d => DEPT_NAME[d]).join(', ')}` })
  if (isWaitingFilm(j)) notes.push({ tone: isFilmLate(j, now) ? 'danger' : 'warn', icon: IconFilm, text: `รอฟิล์ม DTF · ETA ${shortDate(j.film!.eta)}${isFilmLate(j, now) ? ' (เลยแล้ว ต้องตามร้าน)' : ''}` })
  if (j.phase === 'sample_review') notes.push({ tone: 'info', icon: IconClock, text: 'รอลูกค้ายืนยันตัวอย่าง · แอดมินควรตามลูกค้า' })
  if (j.station === 'sew' && j.phase === 'production') {
    notes.push(j.firstPieceOk
      ? { tone: 'info', icon: IconCheck, text: `เย็บแล้ว ${(j.sewCount ?? 0).toLocaleString('th-TH')} จาก ${j.qty.toLocaleString('th-TH')} ${j.unit}` }
      : { tone: 'warn', icon: IconClock, text: 'รอหัวหน้าอนุมัติตัวแรกก่อนเย็บทั้งก้อน' })
  }
  if (j.rework) notes.push({ tone: 'danger', icon: IconAlert, text: `งานแก้ ${j.rework.qty} ${j.unit} · ${j.rework.reason}` })
  if (!notes.length) return null
  const cls = { danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn', info: 'bg-info-soft text-info' }
  return (
    <ul className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">
      {notes.map((n, i) => <li key={i} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium ${cls[n.tone]}`}><n.icon className="size-4" />{n.text}</li>)}
    </ul>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-xs text-muted">{label}</div><div>{children}</div></div>
}
