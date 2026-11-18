import { useMemo, useState } from 'react'
import { DEFAULT_SEW_PRODUCT, LEAD, QUEUE_FULL_DAYS, QUEUE_OK_DAYS, hasSewMinutes, lateDays, lineRate, linesFor, machineSets, simulate, verdict, workdayToDate, type Forecast, type SewFloor } from '../proto/capacity'
import { MACHINE_TYPE_NAME } from '../proto/sewing'
import { ROUTES, STATION_NAME, WORK_END, byQueue, isOutLate, stationCounts, isDueSoon, isFilmLate, isDoneToday, isOverdue, type Job, type RouteCode, type StationCode } from '../proto/model'
import { duration, shortDate, stageSteps, stageText } from '../proto/format'
import { Card, CardHeader, DueLabel, Pill, RouteBadge, StageDots, StatTile, ViewSwitch } from '../components/ui'
import { TONE, type Tone } from '../components/tone'
import JobFinder from '../components/JobFinder'
import { ContactLinks } from './OutsourcePanel'
import { IconAlert, IconCalculator, IconCheck, IconChevronRight, IconClipboard, IconFactory, IconLayers, IconPause, IconTrendingUp, IconPackage } from '../components/icons'

type Product = { code: string; name: string }
type Props = { jobs: Job[]; now: Date; forecast: Forecast; floor: SewFloor; products: Product[]; onOpen: (id: string) => void }
type Row = { job: Job; finish: Date; late: number }

const OVERVIEW_VIEWS = [
  // ป้ายสั้นให้ครบ 3 แท็บบนจอ 375 px (QA รอบ 4)
  ['follow', 'ต้องตาม'],
  ['find', 'ค้นหางาน'],
  ['plan', 'วางแผนรับ'],
] as const

// เฟส 1: ภาพรวมสำหรับแอดมิน — งานแต่ละงานอยู่ขั้นไหน และรับงานใหม่เพิ่มได้หรือยัง
export default function Overview({ jobs, now, forecast, floor, products, onOpen }: Props) {
  const [view, setView] = useState<(typeof OVERVIEW_VIEWS)[number][0]>('follow')
  const rows: Row[] = useMemo(() => jobs.filter(j => j.phase !== 'done').map(j => {
    const finish = workdayToDate(forecast.finishDay.get(j.id) ?? 0, now)
    return { job: j, finish, late: lateDays(finish, j.due) }
  }).sort((a, b) => b.late - a.late || a.job.due.getTime() - b.job.due.getTime()), [jobs, forecast, now])

  const atRisk = rows.filter(r => r.late > 0)

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <KpiRow jobs={jobs} now={now} atRisk={atRisk.length} />
      <ViewSwitch variant="sub" label="มุมมองภาพรวม" value={view} onChange={setView} options={OVERVIEW_VIEWS} />
      {/* มุมมองแรกมีอย่างเดียว: งานที่ต้องตาม · ข้อมูลวางแผน (กราฟ) อยู่ในมุมมองวางแผน ไม่ปนกัน */}
      <section hidden={view !== 'follow'} className="grid gap-4">
        <StationNow jobs={jobs} now={now} />
        <OutsideCard jobs={jobs} now={now} onOpen={onOpen} />
        <AdminTodo jobs={jobs} now={now} atRisk={atRisk} onOpen={onOpen} />
      </section>
      <section hidden={view !== 'find'}>
        <JobFinder jobs={jobs} now={now} forecast={forecast} onOpen={onOpen} />
        <details className="mt-4">
          <summary className="min-h-12 cursor-pointer rounded-xl border border-line bg-card p-3 font-semibold">
            ดูงานในโรงงานทั้งหมด ({rows.length})
          </summary>
          <div className="mt-3">
            <JobTable rows={rows} jobs={jobs} now={now} onOpen={onOpen} />
            <p className="mt-3 text-sm text-muted">
              วันที่คาดว่าเสร็จอิงกำลังผลิตต่อวันที่รอยืนยันกับหน้างาน คำนวณวันทำงานจันทร์–เสาร์และเผื่อเพิ่ม {LEAD.hold} วันสำหรับงานที่ติดปัญหา
            </p>
          </div>
        </details>
      </section>
      <section hidden={view !== 'plan'}>
        <div className="grid gap-4">
          <VerdictHero forecast={forecast} atRisk={atRisk.length} />
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <NewJobCheck jobs={jobs} now={now} floor={floor} products={products} />
            <StationLoadCard forecast={forecast} />
          </div>
        </div>
      </section>
    </div>
  )
}

/** ตัวเลขสรุปบนสุด อ่านจบในครั้งเดียวว่าโรงงานเป็นอย่างไร */
function KpiRow({ jobs, now, atRisk }: { jobs: Job[]; now: Date; atRisk: number }) {
  const active = jobs.filter(j => j.phase !== 'done')
  const overdue = active.filter(j => isOverdue(j, now)).length
  const soon = active.filter(j => !isOverdue(j, now) && isDueSoon(j, now)).length
  const hold = active.filter(j => j.status === 'hold').length
  const done = jobs.filter(j => isDoneToday(j, now)).length
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile icon={IconFactory} tone="brand" label="งานในโรงงาน" value={active.length} note={`${active.reduce((s, j) => s + j.qty, 0).toLocaleString('th-TH')} ชิ้น`} />
      <StatTile icon={IconAlert} tone="danger" label="เลยกำหนดส่ง" value={overdue} note={soon ? `ใกล้ส่งอีก ${soon} งาน` : 'ไม่มีงานใกล้ส่ง'} />
      <StatTile icon={IconPause} tone="danger" label="ติดปัญหา / พักงาน" value={hold} note={atRisk ? `เสี่ยงไม่ทัน ${atRisk} งาน` : 'ทุกงานคาดว่าทัน'} />
      <StatTile icon={IconCheck} tone="ok" label="เสร็จวันนี้" value={done} note="พร้อมส่ง" />
    </div>
  )
}

function VerdictHero({ forecast, atRisk }: { forecast: Forecast; atRisk: number }) {
  const v = verdict(forecast, atRisk)
  const b = forecast.load[forecast.bottleneck]
  const theme = {
    ok: { bg: 'border-l-ok', tone: 'ok' as Tone, label: 'รับได้' },
    tight: { bg: 'border-l-warn', tone: 'warn' as Tone, label: 'ระวัง' },
    full: { bg: 'border-l-danger', tone: 'danger' as Tone, label: 'คิวเต็ม' },
  }[v.level]
  const Icon = v.level === 'ok' ? IconCheck : IconAlert

  return (
    <section className={`rounded-2xl border border-line border-l-8 bg-card p-4 shadow-card sm:p-5 ${theme.bg}`}>
      {/* จอใหญ่: คำตอบซ้าย ตัวเลขประกอบขวา ในแถวเดียว */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] xl:items-center">
        <div className="flex items-start gap-4">
          <span className={`grid size-12 shrink-0 place-items-center rounded-full ${TONE[theme.tone].soft}`}><Icon className="size-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm text-muted">รับงานใหม่ได้ไหม? <Pill tone={theme.tone} dot>{theme.label}</Pill></p>
            <h2 className="mt-1 text-xl leading-snug font-bold">{v.title}</h2>
            <p className="mt-2 text-sm text-muted">เกณฑ์: คิวไม่เกิน {QUEUE_OK_DAYS} วัน = รับได้ · {QUEUE_OK_DAYS}–{QUEUE_FULL_DAYS} วัน = ดูกำหนดส่ง · เกิน {QUEUE_FULL_DAYS} วัน = คิวเต็ม</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat label="คอขวดตอนนี้" value={STATION_NAME[forecast.bottleneck]} note={`งานค้าง ~${days(b.days)} วันทำงาน`} />
          <HeroStat label="งานเสี่ยงไม่ทันกำหนด" value={`${atRisk} งาน`} note={atRisk ? 'ควรเคลียร์ก่อนรับงานด่วน' : 'ทุกงานคาดว่าทัน'} />
          <HeroStat label="ชิ้นงานที่ต้องผ่านคอขวด" value={`${Math.round(b.qty).toLocaleString('th-TH')} ชิ้น`} note={`${b.jobs} งาน · ทำได้ ~${Math.round(b.rate)}/วัน`} />
        </div>
      </div>
    </section>
  )
}

function HeroStat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl bg-paper p-3">
      <div className="text-sm text-muted">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-sm text-muted">{note}</div>
    </div>
  )
}

function NewJobCheck({ jobs, now, floor, products }: { jobs: Job[]; now: Date; floor: SewFloor; products: Product[] }) {
  const [route, setRoute] = useState<RouteCode>('normal')
  const [product, setProduct] = useState(DEFAULT_SEW_PRODUCT)
  const [qty, setQty] = useState(300)
  const [due, setDue] = useState('')

  const qtyOk = Number.isFinite(qty) && qty >= 1
  const r = useMemo(() => simulate(jobs, now, { route, qty: Math.max(1, qty || 0), productCode: product }, floor), [jobs, now, route, qty, product, floor])
  // ตารางเทียบวันเสร็จตามจำนวน (เส้นทางเดียวกัน) ไว้ตอบลูกค้าได้ทันที
  const quotes = useMemo(() => [100, 500, 1000, 2000].map(q => ({ q, d: workdayToDate(simulate(jobs, now, { route, qty: q, productCode: product }, floor).extraFinishDay ?? 0, now) })), [jobs, now, route, product, floor])
  const finish = workdayToDate(r.extraFinishDay ?? 0, now)
  const dueDate = due ? new Date(`${due}T${WORK_END}`) : null
  const late = dueDate ? lateDays(finish, dueDate) : null
  const input = 'w-full min-w-0 rounded-xl border border-line bg-card px-3 py-2.5 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15'

  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon={IconCalculator} title="ถ้ารับงานใหม่วันนี้ จะเสร็จเมื่อไร" sub="ใช้ตอบลูกค้าหรือต่อรองวันส่ง" />
      <div className="grid grid-cols-2 gap-3 px-5 text-sm">
        <label className="col-span-2 grid gap-1">
          <span className="text-xs font-medium text-muted">เส้นทาง</span>
          <select value={route} onChange={e => setRoute(e.target.value as RouteCode)} className={input}>
            {(Object.keys(ROUTES) as RouteCode[]).map(k => <option key={k} value={k}>{ROUTES[k].name}</option>)}
          </select>
        </label>
        <label className="col-span-2 grid gap-1">
          <span className="text-xs font-medium text-muted">สินค้า (ใช้จักรเย็บต่างกัน)</span>
          <select value={product} onChange={e => setProduct(e.target.value)} className={input}>
            {products.length === 0 && <option value={DEFAULT_SEW_PRODUCT}>เสื้อยืด</option>}
            {products.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </label>
        {ROUTES[route].stations.includes('sew') && <SewLineNote product={product} floor={floor} />}
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
        <p className="mx-5 mt-4 rounded-2xl bg-warn-soft p-4 text-sm font-semibold text-warn">ใส่จำนวนชิ้นอย่างน้อย 1 ชิ้น เพื่อคำนวณวันเสร็จ</p>
      ) : (
      <div className={`mx-5 mt-4 flex items-center gap-4 rounded-2xl p-4 ${late === null ? 'bg-brand-soft' : late > 0 ? 'bg-danger-soft' : 'bg-ok-soft'}`}>
        <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-card text-center leading-tight shadow-card">
          <span className="text-xs text-muted">{finish.toLocaleDateString('th-TH', { month: 'short' })}</span>
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
      <div className="mx-5 mt-auto pt-5 pb-5">
        <p className="mb-2 text-xs font-medium text-muted">เทียบวันเสร็จตามจำนวน · {ROUTES[route].short}</p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {quotes.map(({ q, d }) => (
            <li key={q}>
              <button onClick={() => setQty(q)} aria-pressed={qty === q}
                className={`w-full rounded-xl border px-3 py-2 text-left transition hover:border-brand ${qty === q ? 'border-brand bg-brand-soft' : 'border-line bg-card'}`}>
                <span className="block text-xs text-muted">{q.toLocaleString('th-TH')} ชิ้น</span>
                <span className="block font-semibold tabular-nums">{shortDate(d)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

// สินค้านี้ใช้จักรอะไร เปิดไลน์เย็บพร้อมกันได้กี่ไลน์ · บอกเมื่อจักรไม่ครบชุดหรือยังไม่มีเวลาเย็บจริง
function SewLineNote({ product, floor }: { product: string; floor: SewFloor }) {
  const needs = floor.needsOf(product)
  const sets = machineSets(needs, floor.ready)
  const missing = needs.filter(n => (floor.ready[n.type] ?? 0) < n.qty)
  return (
    <div className="col-span-2 grid gap-1 rounded-xl bg-paper p-3">
      {needs.length === 0
        ? <p className="font-semibold text-warn">ยังไม่ได้ตั้งจักรที่สินค้านี้ใช้ (หน้าตั้งค่า) · คิดเฉพาะจำนวนช่าง</p>
        : <p>ใช้จักร {needs.map(n => `${MACHINE_TYPE_NAME[n.type]} ×${n.qty}`).join(' · ')}</p>}
      {sets === 0
        ? <p className="font-semibold text-danger">จักรไม่ครบชุด: ขาด {missing.map(n => `${MACHINE_TYPE_NAME[n.type]} ${n.qty - (floor.ready[n.type] ?? 0)} ตัว`).join(' · ')} · เย็บได้เมื่อซ่อม/เพิ่มจักร</p>
        : <p className="text-muted">เย็บพร้อมกันได้ {linesFor(needs, floor.ready)} ไลน์ (ถ้าไม่มีงานอื่นใช้จักรเดียวกัน) · ไลน์ละช่าง 3 คน ~{lineRate(product)} ชิ้น/วัน</p>}
      {!!floor.shared?.length && <p className="text-muted">ใช้ร่วมได้ทุกไลน์ (ไม่นับในชุดจักร): {floor.shared.map(t => MACHINE_TYPE_NAME[t]).join(' · ')}</p>}
      {!hasSewMinutes(product) && <p className="font-semibold text-warn">ยังไม่มีเวลาเย็บจริงของสินค้านี้ · คิดเวลาเท่าเสื้อยืดไปก่อน</p>}
    </div>
  )
}

function StationLoadCard({ forecast }: { forecast: Forecast }) {
  const max = Math.max(QUEUE_FULL_DAYS + 2, ...Object.values(forecast.load).map(l => l.days))
  const order: StationCode[] = ['print', 'press', 'cut', 'dtf_press', 'emb', 'sew', 'qc_pack']
  return (
    <Card className="h-full">
      <CardHeader icon={IconTrendingUp} title="งานค้างแต่ละสถานี" sub={`ต้องใช้กี่วันทำงานจึงเคลียร์งานที่มีอยู่ · เกิน ${QUEUE_OK_DAYS} วัน = ระวัง · เกิน ${QUEUE_FULL_DAYS} วัน = คิวเต็ม`} />
      <ul className="grid gap-4 px-4 pb-5 sm:px-5">
        {order.map(s => {
          const l = forecast.load[s]
          const tone: Tone = l.days > QUEUE_FULL_DAYS ? 'danger' : l.days > QUEUE_OK_DAYS ? 'warn' : 'ok'
          return (
            <li key={s}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="font-semibold">{STATION_NAME[s]}</span>
                {s === forecast.bottleneck && <Pill tone="danger">คอขวด</Pill>}
                <span className={`ml-auto font-bold tabular-nums ${TONE[tone].text}`}>{days(l.days)} วัน</span>
              </div>
              <div className="relative h-3 rounded-full bg-paper">
                <div className={`absolute inset-y-0 left-0 rounded-full ${TONE[tone].dot}`} style={{ width: `${Math.max(2, (l.days / max) * 100)}%` }} />
                <div className="absolute -inset-y-1 w-0.5 bg-ink/25" style={{ left: `${(QUEUE_OK_DAYS / max) * 100}%` }} />
                <div className="absolute -inset-y-1 w-0.5 bg-ink/25" style={{ left: `${(QUEUE_FULL_DAYS / max) * 100}%` }} />
              </div>
              <div className="mt-1 text-sm text-muted">{l.jobs} งาน · {Math.round(l.qty).toLocaleString('th-TH')} ชิ้น · ทำได้ ~{Math.round(l.rate)}/วัน</div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** แถบสัดส่วนงานแต่ละช่วง + คำอธิบายสี (อยู่หัวตารางทุกงาน) */
function Pipeline({ jobs, now }: { jobs: Job[]; now: Date }) {
  const stages: { name: string; n: number; color: string }[] = [
    { name: 'ขึ้นตัวอย่าง', n: jobs.filter(j => j.phase === 'sample').length, color: 'bg-info' },
    { name: 'รอลูกค้ายืนยัน', n: jobs.filter(j => j.phase === 'sample_review').length, color: 'bg-dtf' },
    { name: 'กำลังผลิต', n: jobs.filter(j => j.phase === 'production').length, color: 'bg-brand' },
    { name: 'เสร็จวันนี้', n: jobs.filter(j => isDoneToday(j, now)).length, color: 'bg-ok' },
  ]
  const total = stages.reduce((s, x) => s + x.n, 0) || 1
  return (
    <div className="px-5 pb-4">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-paper" aria-hidden>
        {stages.map(s => s.n > 0 && <span key={s.name} className={`${s.color} border-r-2 border-card last:border-0`} style={{ width: `${(s.n / total) * 100}%` }} />)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {stages.map(s => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${s.color}`} />
            <span className="text-muted">{s.name}</span>
            <b className="tabular-nums">{s.n}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

// สถานีตอนนี้: ผู้บริหาร/แอดมินเห็นทั้งโรงงานในจอเดียว · กดแล้วไปคิวของสถานีนั้นบนหน้างาน (#/board?station=…)
function StationNow({ jobs, now }: { jobs: Job[]; now: Date }) {
  const rows = stationCounts(jobs, now)
  return (
    <Card>
      <CardHeader icon={IconFactory} title="สถานีตอนนี้" sub="กดสถานีเพื่อดูคิวงาน · แดง = มีงานติดปัญหาหรือเลยกำหนด" />
      <ul className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4">
        {rows.map(r => {
          const bad = r.hold > 0 || r.late > 0
          return (
            <li key={r.key} className="min-w-0">
              <a href={`#/board?station=${r.key}`}
                className={`flex h-full min-h-24 flex-col gap-1 rounded-xl border-2 px-3 py-2.5 hover:border-brand ${bad ? 'border-danger/50 bg-danger-soft/40' : 'border-line bg-card'}`}>
                <span className="font-semibold">{r.name}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums">{r.waiting + r.doing + r.hold + r.out}</span>
                  <span className="text-sm text-muted">งาน</span>
                </span>
                <span className="flex flex-wrap gap-x-2 text-sm">
                  {r.doing > 0 && <span className="text-info">ทำอยู่ {r.doing}</span>}
                  {r.waiting > 0 && <span className="text-muted">รอ {r.waiting}</span>}
                  {r.hold > 0 && <span className="font-semibold text-danger">ติดปัญหา {r.hold}</span>}
                  {r.out > 0 && <span className="text-info">ข้างนอก {r.out}</span>}
                  {r.late > 0 && <span className="font-semibold text-danger">เลยกำหนด {r.late}</span>}
                  {r.waiting + r.doing + r.hold + r.out === 0 && <span className="text-muted">ว่าง</span>}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// งานที่อยู่บริษัทภายนอก: แอดมินตามของ · เรียงตามวันที่ของจะถึง · เลยกำหนดเป็นแดง
function OutsideCard({ jobs, now, onOpen }: { jobs: Job[]; now: Date; onOpen: (id: string) => void }) {
  const list = jobs.filter(j => j.status === 'out' && j.out).sort((a, b) => a.out!.backAt.getTime() - b.out!.backAt.getTime())
  if (!list.length) return null
  const late = list.filter(j => isOutLate(j, now)).length
  const when = (d: Date) => d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.'
  return (
    <Card>
      <CardHeader icon={IconPackage} tone={late ? 'danger' : 'info'} title={`งานที่ส่งออกข้างนอก ${list.length} งาน`}
        sub={late ? `เลยกำหนดของถึง ${late} งาน · โทรตามบริษัท` : 'เรียงตามวันที่ของจะถึง · ของถึงแล้วเปิดงานกด "รับเข้า"'} />
      <ul className="divide-y divide-line border-t border-line">
        {list.map(j => {
          const o = j.out!
          const bad = isOutLate(j, now)
          return (
            <li key={j.id}>
              <button onClick={() => onOpen(j.id)} className="flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-paper">
                <span className={`h-9 w-1 shrink-0 rounded-full ${bad ? TONE.danger.dot : TONE.info.dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><b>{j.no}</b><Pill tone={bad ? 'danger' : 'info'}>{o.vendor}</Pill>{o.rework && <Pill tone="danger">งานแก้</Pill>}</span>
                  <span className="block text-sm text-muted">{o.stations.map(s => STATION_NAME[s]).join(' → ')} · {o.qty.toLocaleString('th-TH')} {j.unit}</span>
                  <span className={`block text-sm ${bad ? 'font-semibold text-danger' : ''}`}>คาดว่าของถึง {when(o.backAt)}{bad ? ' · เลยกำหนด' : ''}</span>
                </span>
                <IconChevronRight className="size-4 shrink-0 text-muted" />
              </button>
              {bad && (o.phone || o.mapUrl) && <div className="px-5 pb-3"><ContactLinks phone={o.phone} mapUrl={o.mapUrl} /></div>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function AdminTodo({ jobs, now, atRisk, onOpen }: { jobs: Job[]; now: Date; atRisk: Row[]; onOpen: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const items: { id: string; tone: Tone; tag: string; text: string; job: Job }[] = []
  const lateBy = new Map(atRisk.map(r => [r.job.id, r]))
  for (const j of jobs) {
    if (j.phase === 'done') continue
    if (isOutLate(j, now)) items.push({ id: j.id + 'o', tone: 'danger', tag: 'ของข้างนอกเลยกำหนด', text: `${j.out!.vendor} · คาดว่าถึง ${shortDate(j.out!.backAt)}`, job: j })
    // แอดมินไม่ได้แก้ปัญหาของสถานี (เจ้าของ 18 พ.ย.) · เห็นไว้แจ้งลูกค้า · ผู้บริหารหรือฝ่ายผลิตเป็นคนกดแก้แล้ว
    else if (j.status === 'hold') items.push({ id: j.id + 'h', tone: 'danger', tag: 'ติดปัญหา · รอผู้บริหารแก้', text: j.holdReason ?? '', job: j })
    // เกินเวลามาตรฐาน: ผู้บริหารต้องเห็นจากภาพรวม ไม่ต้องรอสถานีแจ้ง (ตรวจหลัง QA รอบ 5)
    else if (j.sla === 'report' || j.sla === 'over') items.push({ id: j.id + 't', tone: 'danger', tag: 'เกินเวลามาตรฐาน',
      text: `${j.station ? STATION_NAME[j.station] : ''} · ${j.sla === 'report' ? 'ยังไม่ส่งรายงานปัญหา' : 'รายงานปัญหาแล้ว'}`, job: j })
    else if (isOverdue(j, now)) items.push({ id: j.id + 'd', tone: 'danger', tag: 'เลยกำหนดส่ง', text: `กำหนดส่ง ${shortDate(j.due)}`, job: j })
    else if (j.film && !j.film.received) {
      const late = isFilmLate(j, now)
      items.push({ id: j.id + 'f', tone: late ? 'danger' : 'warn', tag: late ? 'ฟิล์มเลย ETA' : 'รอฟิล์ม', text: late ? `ETA ${shortDate(j.film.eta)} · ตามร้านฟิล์ม` : `ETA ${shortDate(j.film.eta)}`, job: j })
    }
    else if (j.phase === 'materials' && !j.materials.admin) items.push({ id: j.id + 'm', tone: 'warn', tag: 'วัตถุดิบ', text: 'ฝ่ายแอดมินยังไม่ติ๊ก', job: j })
    else if (j.phase === 'sample_review') items.push({ id: j.id + 's', tone: 'info', tag: 'ตามลูกค้า', text: `ยืนยันตัวอย่าง · รอมา ${duration(now.getTime() - j.since.getTime())}`, job: j })
    // ยังไม่เลยกำหนดแต่คาดว่าไม่ทัน → แจ้งลูกค้าล่วงหน้า หรือให้หัวหน้าพิจารณาแทรกคิว
    else if (lateBy.has(j.id)) {
      const r = lateBy.get(j.id)!
      items.push({ id: j.id + 'r', tone: 'warn', tag: `คาดไม่ทัน ${r.late} วัน`, text: `คาดเสร็จ ${shortDate(r.finish)} · ส่ง ${shortDate(j.due)} · แจ้งลูกค้าหรือขอแทรกคิว`, job: j })
    }
  }
  const rank: Partial<Record<Tone, number>> = { danger: 0, warn: 1, info: 2 }
  items.sort((a, b) => (rank[a.tone] ?? 9) - (rank[b.tone] ?? 9) || byQueue(a.job, b.job))

  return (
    <Card>
      <CardHeader icon={IconClipboard} tone="warn" title={`งานที่ต้องตาม ${items.length} งาน`} />
      <ul className="divide-y divide-line border-t border-line">
        {(expanded ? items : items.slice(0, 6)).map(it => (
          <li key={it.id} className="min-w-0">
            <button onClick={() => onOpen(it.job.id)} className="flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-paper">
              <span className={`h-9 w-1 shrink-0 rounded-full ${TONE[it.tone].dot}`} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><b>{it.job.no}</b><Pill tone={it.tone}>{it.tag}</Pill></span>
                <span className="block text-sm text-muted">{it.job.customer}{it.text && ` · ${it.text}`}</span>
              </span>
              <IconChevronRight className="size-4 shrink-0 text-muted" />
            </button>
          </li>
        ))}
        {!items.length && <li className="px-5 py-4 text-muted">ไม่มีงานที่ต้องตาม</li>}
      </ul>
      {items.length > 6 && (
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}
          className="min-h-12 w-full border-t border-line px-5 font-semibold text-brand hover:bg-paper">
          {expanded ? 'แสดงน้อยลง' : `ดูอีก ${items.length - 6} งาน`}
        </button>
      )}
    </Card>
  )
}

function JobTable({ rows, jobs, now, onOpen }: { rows: Row[]; jobs: Job[]; now: Date; onOpen: (id: string) => void }) {
  const cols = 'md:grid-cols-[8.5rem_minmax(0,1.3fr)_minmax(0,1.6fr)_8.5rem_6.5rem_7rem]'
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={IconLayers} title={`งานในโรงงาน ${rows.length} งาน`} sub="สัดส่วนงานแต่ละช่วง" />
      <Pipeline jobs={jobs} now={now} />
      <div className={`hidden gap-3 border-y border-line bg-paper/70 px-5 py-2 text-xs font-medium text-muted md:grid ${cols}`}>
        <span>เลขที่</span><span>ลูกค้า / สินค้า</span><span>ขั้นตอนตอนนี้</span><span>กำหนดส่ง</span><span>คาดเสร็จ</span><span>ทันไหม</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map(({ job: j, finish, late }) => {
          const st = stageSteps(j)
          return (
            <li key={j.id}>
              <button onClick={() => onOpen(j.id)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-5 py-3 text-left text-sm transition hover:bg-paper md:items-center ${cols}`}>
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
