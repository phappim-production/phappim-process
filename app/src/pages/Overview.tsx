import { useMemo, useState } from 'react'
import { CAPACITY, LEAD, QUEUE_FULL_DAYS, QUEUE_OK_DAYS, lateDays, simulate, verdict, workdayToDate, type Forecast } from '../proto/capacity'
import { ROUTES, STATION_NAME, isFilmLate, isDoneToday, type Job, type RouteCode, type StationCode } from '../proto/model'
import { duration, shortDate, stageSteps, stageText } from '../proto/format'
import { Card, CardHeader, DueLabel, Pill, RouteBadge, StageDots } from '../components/ui'
import { TONE, type Tone } from '../components/tone'
import JobFinder from '../components/JobFinder'
import { IconAlert, IconCalculator, IconCheck, IconChevronRight, IconClipboard, IconLayers, IconTrendingUp } from '../components/icons'

type Props = { jobs: Job[]; now: Date; forecast: Forecast; onOpen: (id: string) => void }
type Row = { job: Job; finish: Date; late: number }

// เฟส 1: ภาพรวมสำหรับแอดมิน — งานแต่ละงานอยู่ขั้นไหน และรับงานใหม่เพิ่มได้หรือยัง
export default function Overview({ jobs, now, forecast, onOpen }: Props) {
  const rows: Row[] = useMemo(() => jobs.filter(j => j.phase !== 'done').map(j => {
    const finish = workdayToDate(forecast.finishDay.get(j.id) ?? 0, now)
    return { job: j, finish, late: lateDays(finish, j.due) }
  }).sort((a, b) => b.late - a.late || a.job.due.getTime() - b.job.due.getTime()), [jobs, forecast, now])

  const atRisk = rows.filter(r => r.late > 0)

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="xl:col-span-2"><JobFinder jobs={jobs} now={now} forecast={forecast} onOpen={onOpen} /></div>

      <div className="grid min-w-0 grid-cols-1 content-start gap-5">
        <VerdictHero forecast={forecast} atRisk={atRisk.length} />
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <NewJobCheck jobs={jobs} now={now} />
          <StationLoadCard forecast={forecast} />
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 content-start gap-5">
        <Pipeline jobs={jobs} now={now} />
        <AdminTodo jobs={jobs} now={now} onOpen={onOpen} />
      </div>

      <JobTable rows={rows} now={now} onOpen={onOpen} />

      <p className="text-xs text-muted xl:col-span-2">
        * "คาดว่าเสร็จ" ประมาณจากกำลังผลิตต่อวันของแต่ละสถานี (ตัวเลขร่าง รอยืนยันกับหน้างาน) · ทำงานจันทร์–เสาร์ ·
        ก่อนเข้าผลิตจริงเผื่อเวลาวัตถุดิบ + ตัวอย่าง + ลูกค้ายืนยัน · งานที่ติดปัญหาเผื่อเพิ่ม {LEAD.hold} วัน
      </p>
    </div>
  )
}

function VerdictHero({ forecast, atRisk }: { forecast: Forecast; atRisk: number }) {
  const v = verdict(forecast, atRisk)
  const b = forecast.load[forecast.bottleneck]
  const theme = {
    ok: { bg: 'from-[#0f4a42] to-[#1b6b5f]', chip: 'bg-white/15', label: 'รับได้' },
    tight: { bg: 'from-[#8a5300] to-[#b06a00]', chip: 'bg-white/15', label: 'ระวัง' },
    full: { bg: 'from-[#8f241c] to-[#c0362c]', chip: 'bg-white/15', label: 'คิวเต็ม' },
  }[v.level]
  const Icon = v.level === 'ok' ? IconCheck : IconAlert

  return (
    <section className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${theme.bg} p-5 text-white shadow-lift sm:p-6`}>
      <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -right-24 -bottom-24 size-64 rounded-full bg-white/5" />
      <div className="relative flex flex-wrap items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/15"><Icon className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white/75">รับงานใหม่ได้ไหม?</p>
          <h2 className="mt-0.5 text-xl leading-snug font-bold sm:text-[28px]">{v.title}</h2>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-ink">{theme.label}</span>
      </div>
      <div className="relative mt-5 grid gap-3 sm:grid-cols-3">
        <HeroStat label="คอขวดตอนนี้" value={STATION_NAME[forecast.bottleneck]} note={`งานค้าง ~${days(b.days)} วันทำงาน`} />
        <HeroStat label="งานเสี่ยงไม่ทันกำหนด" value={`${atRisk} งาน`} note={atRisk ? 'ควรเคลียร์ก่อนรับงานด่วน' : 'ทุกงานคาดว่าทัน'} />
        <HeroStat label="ชิ้นงานที่ยังต้องผ่านคอขวด" value={`${Math.round(b.qty).toLocaleString('th-TH')} ชิ้น`} note={`${b.jobs} งาน · ทำได้ ~${CAPACITY[forecast.bottleneck]}/วัน`} />
      </div>
      <p className="relative mt-4 text-xs text-white/65">เกณฑ์: คิวไม่เกิน {QUEUE_OK_DAYS} วัน = รับได้ · {QUEUE_OK_DAYS}–{QUEUE_FULL_DAYS} วัน = ดูกำหนดส่ง · เกิน {QUEUE_FULL_DAYS} วัน = คิวเต็ม</p>
    </section>
  )
}

function HeroStat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl bg-white/12 p-3 ring-1 ring-white/15 backdrop-blur-sm">
      <div className="text-xs text-white/70">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-white/70">{note}</div>
    </div>
  )
}

function NewJobCheck({ jobs, now }: { jobs: Job[]; now: Date }) {
  const [route, setRoute] = useState<RouteCode>('normal')
  const [qty, setQty] = useState(300)
  const [due, setDue] = useState('')

  const qtyOk = Number.isFinite(qty) && qty >= 1
  const r = useMemo(() => simulate(jobs, now, { route, qty: Math.max(1, qty || 0) }), [jobs, now, route, qty])
  const finish = workdayToDate(r.extraFinishDay ?? 0, now)
  const dueDate = due ? new Date(`${due}T17:00`) : null
  const late = dueDate ? lateDays(finish, dueDate) : null
  const input = 'w-full rounded-xl border border-line bg-paper/60 px-3 py-2 outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15'

  return (
    <Card>
      <CardHeader icon={IconCalculator} title="ถ้ารับงานใหม่วันนี้ จะเสร็จเมื่อไร" sub="ใช้ตอบลูกค้าหรือต่อรองวันส่ง" />
      <div className="grid gap-3 px-5 text-sm sm:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted">เส้นทาง</span>
          <select value={route} onChange={e => setRoute(e.target.value as RouteCode)} className={input}>
            {(Object.keys(ROUTES) as RouteCode[]).map(k => <option key={k} value={k}>{ROUTES[k].name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted">จำนวน (ชิ้น)</span>
          <input type="number" min={1} inputMode="numeric" value={Number.isNaN(qty) ? '' : qty} onChange={e => setQty(e.target.value === '' ? NaN : Number(e.target.value))}
            aria-invalid={!qtyOk} className={`${input} ${qtyOk ? '' : 'border-danger'}`} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-medium text-muted">ลูกค้าต้องการวันที่</span>
          <input type="date" value={due} onChange={e => setDue(e.target.value)} className={input} />
        </label>
      </div>
      {!qtyOk ? (
        <p className="m-5 mt-4 rounded-2xl bg-warn-soft p-4 text-sm font-semibold text-warn">ใส่จำนวนชิ้นอย่างน้อย 1 ชิ้น เพื่อคำนวณวันเสร็จ</p>
      ) : (
      <div className={`m-5 mt-4 flex items-center gap-4 rounded-2xl p-4 ${late === null ? 'bg-brand-soft' : late > 0 ? 'bg-danger-soft' : 'bg-ok-soft'}`}>
        <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-white text-center leading-none shadow-card">
          <span className="text-[10px] text-muted">{finish.toLocaleDateString('th-TH', { month: 'short' })}</span>
          <span className="text-xl font-bold">{finish.getDate()}</span>
        </div>
        <div className="min-w-0 text-sm">
          <p className="text-muted">คาดว่าเสร็จ</p>
          <p className="text-lg font-bold">{finish.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          {late !== null && (
            <p className={`font-semibold ${late > 0 ? 'text-danger' : 'text-ok'}`}>
              {late > 0 ? `ไม่ทันวันที่ลูกค้าต้องการ (ช้าไป ${late} วัน)` : 'ทันวันที่ลูกค้าต้องการ'}
            </p>
          )}
          {r.extraWaitAt && <p className="text-xs text-muted">รอคิวนานที่สุดที่ {STATION_NAME[r.extraWaitAt]}</p>}
        </div>
      </div>
      )}
    </Card>
  )
}

function StationLoadCard({ forecast }: { forecast: Forecast }) {
  const max = Math.max(QUEUE_FULL_DAYS + 2, ...Object.values(forecast.load).map(l => l.days))
  const order: StationCode[] = ['print', 'press', 'cut', 'dtf_press', 'sew', 'qc_pack']
  return (
    <Card>
      <CardHeader icon={IconTrendingUp} title="งานค้างแต่ละสถานี" sub="ต้องใช้กี่วันทำงานจึงเคลียร์งานที่มีอยู่ (รวมงานที่ยังมาไม่ถึง)" />
      <ul className="grid gap-3.5 px-5 pb-5">
        {order.map(s => {
          const l = forecast.load[s]
          const tone: Tone = l.days > QUEUE_FULL_DAYS ? 'danger' : l.days > QUEUE_OK_DAYS ? 'warn' : 'ok'
          return (
            <li key={s} className="text-sm">
              <div className="mb-1 flex items-baseline gap-2">
                <span className={s === forecast.bottleneck ? 'font-semibold' : 'font-medium'}>{STATION_NAME[s]}</span>
                {s === forecast.bottleneck && <Pill tone="danger">คอขวด</Pill>}
                <span className={`ml-auto font-semibold tabular-nums ${TONE[tone].text}`}>{days(l.days)} วัน</span>
              </div>
              <div className="relative h-2.5 rounded-full bg-paper">
                <div className={`absolute inset-y-0 left-0 rounded-full ${TONE[tone].dot}`} style={{ width: `${Math.max(2, (l.days / max) * 100)}%` }} />
                <div className="absolute -inset-y-0.5 w-px bg-ink/20" style={{ left: `${(QUEUE_OK_DAYS / max) * 100}%` }} />
                <div className="absolute -inset-y-0.5 w-px bg-ink/20" style={{ left: `${(QUEUE_FULL_DAYS / max) * 100}%` }} />
              </div>
              <div className="mt-1 text-xs text-muted">{l.jobs} งาน · {Math.round(l.qty).toLocaleString('th-TH')} ชิ้น · ทำได้ ~{CAPACITY[s]}/วัน</div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Pipeline({ jobs, now }: { jobs: Job[]; now: Date }) {
  const stages: { name: string; n: number; color: string }[] = [
    { name: 'รอวัตถุดิบ', n: jobs.filter(j => j.phase === 'materials').length, color: 'bg-gold' },
    { name: 'ขึ้นตัวอย่าง', n: jobs.filter(j => j.phase === 'sample').length, color: 'bg-info' },
    { name: 'รอลูกค้ายืนยัน', n: jobs.filter(j => j.phase === 'sample_review').length, color: 'bg-dtf' },
    { name: 'กำลังผลิต', n: jobs.filter(j => j.phase === 'production').length, color: 'bg-brand' },
    { name: 'เสร็จวันนี้', n: jobs.filter(j => isDoneToday(j, now)).length, color: 'bg-ok' },
  ]
  const total = stages.reduce((s, x) => s + x.n, 0) || 1
  return (
    <Card>
      <CardHeader icon={IconLayers} title="งานทั้งหมดอยู่ช่วงไหน" sub={`${total} งาน`} />
      <div className="px-5 pb-5">
        <div className="flex h-3 overflow-hidden rounded-full bg-paper">
          {stages.map(s => s.n > 0 && <span key={s.name} className={`${s.color} border-r-2 border-white last:border-0`} style={{ width: `${(s.n / total) * 100}%` }} title={`${s.name} ${s.n}`} />)}
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
          {stages.map(s => (
            <li key={s.name} className="flex items-center gap-2 text-sm">
              <span className={`size-2.5 rounded-full ${s.color}`} />
              <span className="text-muted">{s.name}</span>
              <span className="ml-auto font-bold tabular-nums">{s.n}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function AdminTodo({ jobs, now, onOpen }: { jobs: Job[]; now: Date; onOpen: (id: string) => void }) {
  const items: { id: string; tone: Tone; tag: string; text: string; job: Job }[] = []
  for (const j of jobs) {
    if (j.phase === 'done') continue
    if (j.status === 'hold') items.push({ id: j.id + 'h', tone: 'danger', tag: 'ติดปัญหา', text: j.holdReason ?? '', job: j })
    if (j.film && !j.film.received) {
      const late = isFilmLate(j, now)
      items.push({ id: j.id + 'f', tone: late ? 'danger' : 'warn', tag: late ? 'ฟิล์มเลย ETA' : 'รอฟิล์ม', text: late ? `ETA ${shortDate(j.film.eta)} · ตามร้านฟิล์ม` : `ETA ${shortDate(j.film.eta)}`, job: j })
    }
    if (j.phase === 'materials' && !j.materials.admin) items.push({ id: j.id + 'm', tone: 'warn', tag: 'วัตถุดิบ', text: 'ฝ่ายแอดมินยังไม่ติ๊ก', job: j })
    if (j.phase === 'sample_review') items.push({ id: j.id + 's', tone: 'info', tag: 'ตามลูกค้า', text: `ยืนยันตัวอย่าง · รอมา ${duration(now.getTime() - j.since.getTime())}`, job: j })
  }
  const rank: Partial<Record<Tone, number>> = { danger: 0, warn: 1, info: 2 }
  items.sort((a, b) => (rank[a.tone] ?? 9) - (rank[b.tone] ?? 9))

  return (
    <Card>
      <CardHeader icon={IconClipboard} tone="warn" title="แอดมินต้องตาม" sub="เรียงจากเรื่องเร่งที่สุด" right={<span className="grid size-7 place-items-center rounded-full bg-warn text-xs font-bold text-white">{items.length}</span>} />
      <ul className="px-2 pb-3">
        {items.map(it => (
          <li key={it.id}>
            <button onClick={() => onOpen(it.job.id)} className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-paper">
              <span className={`h-9 w-1 shrink-0 rounded-full ${TONE[it.tone].dot}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><b>{it.job.no}</b><Pill tone={it.tone}>{it.tag}</Pill></span>
                <span className="block truncate text-xs text-muted">{it.job.customer} · {it.text}</span>
              </span>
              <IconChevronRight className="size-4 text-muted opacity-0 transition group-hover:opacity-100" />
            </button>
          </li>
        ))}
        {!items.length && <li className="px-3 py-4 text-sm text-muted">ไม่มีเรื่องค้าง</li>}
      </ul>
    </Card>
  )
}

function JobTable({ rows, now, onOpen }: { rows: Row[]; now: Date; onOpen: (id: string) => void }) {
  const cols = 'md:grid-cols-[8.5rem_minmax(0,1.3fr)_minmax(0,1.6fr)_8.5rem_6.5rem_7rem]'
  return (
    <Card className="overflow-hidden xl:col-span-2">
      <CardHeader icon={IconLayers} title="ทุกงานอยู่ขั้นไหน" sub="เรียงจากงานเสี่ยงไม่ทันก่อน · กดแถวเพื่อดูรายละเอียด" right={<span className="text-sm text-muted">{rows.length} งาน</span>} />
      <div className={`hidden gap-3 border-y border-line bg-paper/70 px-5 py-2 text-xs font-medium text-muted md:grid ${cols}`}>
        <span>เลขที่</span><span>ลูกค้า / สินค้า</span><span>ขั้นตอนตอนนี้</span><span>กำหนดส่ง</span><span>คาดเสร็จ</span><span>ทันไหม</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map(({ job: j, finish, late }) => {
          const st = stageSteps(j)
          return (
            <li key={j.id}>
              <button onClick={() => onOpen(j.id)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-5 py-3 text-left text-sm transition hover:bg-brand-soft/40 md:items-center ${cols}`}>
                <span className="flex items-center gap-1.5 font-semibold">{j.no}<RouteBadge route={j.route} /></span>
                <span className="justify-self-end md:hidden"><Risk late={late} /></span>
                <span className="col-span-2 min-w-0 md:col-span-1">
                  <span className="block truncate font-medium">{j.customer}</span>
                  <span className="block truncate text-xs text-muted">{j.product} · {j.qty.toLocaleString('th-TH')} {j.unit}</span>
                </span>
                <span className="col-span-2 grid gap-1.5 md:col-span-1">
                  <span className={j.status === 'hold' ? 'font-semibold text-danger' : ''}>{stageText(j)}</span>
                  <StageDots steps={st.steps} current={st.current} hold={j.status === 'hold'} />
                </span>
                <span className="text-xs md:text-sm"><span className="text-muted md:hidden">กำหนดส่ง </span><DueLabel job={j} now={now} long /></span>
                <span className="justify-self-end text-xs tabular-nums md:justify-self-auto md:text-sm"><span className="text-muted md:hidden">คาดเสร็จ </span>{shortDate(finish)}</span>
                <span className="hidden md:block"><Risk late={late} /></span>
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Risk({ late }: { late: number }) {
  if (late > 0) return <Pill tone="danger" dot>ไม่ทัน {late} วัน</Pill>
  if (late === 0) return <Pill tone="warn" dot>พอดีกำหนด</Pill>
  return <Pill tone="ok" dot>ทัน</Pill>
}

function days(n: number) {
  return n < 0.95 ? '<1' : n.toLocaleString('th-TH', { maximumFractionDigits: 1 })
}
