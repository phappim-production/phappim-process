import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Card, CardHeader, Pill, StatTile, ViewSwitch } from '../components/ui'
import type { Tone } from '../components/tone'
import { IconAlert, IconCalendar, IconCheck, IconClock, IconPrinter, IconTruck } from '../components/icons'
import { deliverySchedule, type DeliveryDay, type DeliveryItem, type DeliveryState } from '../proto/deliveries'
import { thaiDayDiff, type Job } from '../proto/model'
import { shortDate, stageText } from '../proto/format'

type Ship = { delivery?: string; address?: string }
type Filter = 'all' | 'notDone' | 'ready'

const longDay = (d: Date) => d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'short' })
const clock = (d: Date) => d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })

function stateLabel(item: DeliveryItem): { tone: Tone; text: string } {
  const j = item.job
  const s: Record<DeliveryState, () => { tone: Tone; text: string }> = {
    late: () => ({ tone: 'danger', text: `ยังไม่เสร็จ · ${stageText(j)}` }),
    risk: () => ({ tone: 'danger', text: `คาดว่าเสร็จ ${shortDate(item.finish!)} · ไม่ทัน ${thaiDayDiff(item.finish!, j.due)} วัน` }),
    hold: () => ({ tone: 'danger', text: stageText(j) }),
    sample: () => ({ tone: 'warn', text: stageText(j) }),
    waiting: () => ({ tone: 'warn', text: stageText(j) }),
    doing: () => ({ tone: 'info', text: stageText(j) }),
    out: () => ({ tone: 'info', text: stageText(j) }),
    ready: () => ({ tone: 'ok', text: 'เสร็จแล้ว · รอส่ง' }),
    delivered: () => ({ tone: 'ok', text: `ส่งแล้ว ${j.delivered ? clock(j.delivered.at) : ''} น.` }),
  }
  return s[item.state]()
}

function dayTitle(d: DeliveryDay): string {
  if (d.kind === 'overdue') return 'เลยกำหนดส่ง · ยังไม่ได้ส่ง'
  if (d.kind === 'later') return 'หลังจากนั้น'
  const name = longDay(d.date!)
  return d.kind === 'today' ? `วันนี้ · ${name}` : d.kind === 'tomorrow' ? `พรุ่งนี้ · ${name}` : name
}

const dayTone = (d: DeliveryDay): Tone => (d.kind === 'overdue' ? 'danger' : d.kind === 'today' ? 'warn' : 'brand')

function useShipping(ids: string[]): Map<string, Ship> {
  const [ship, setShip] = useState<Map<string, Ship>>(new Map())
  const key = ids.join(',')
  useEffect(() => {
    const db = supabase
    if (!db || !key) return
    let alive = true
    const list = key.split(',')
    void (async () => {
      const out = new Map<string, Ship>()
      for (let i = 0; i < list.length; i += 100) {
        const { data, error } = await db.from('jobs').select('id, spec').in('id', list.slice(i, i + 100))
        if (error) return
        for (const row of (data ?? []) as { id: string; spec: unknown }[]) {
          const h = row.spec && typeof row.spec === 'object' ? (row.spec as { h?: Record<string, unknown> }).h : undefined
          const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
          out.set(row.id, { delivery: text(h?.delivery), address: text(h?.address) })
        }
      }
      if (alive) setShip(out)
    })()
    return () => { alive = false }
  }, [key])
  return ship
}

function Row({ item, ship, now, onOpen }: { item: DeliveryItem; ship?: Ship; now: Date; onOpen: (id: string) => void }) {
  const j = item.job
  const label = stateLabel(item)
  const late = item.state !== 'delivered' && thaiDayDiff(j.due, now) < 0
  return (
    <li>
      <button type="button" onClick={() => onOpen(j.id)}
        className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)] gap-1 rounded-xl px-3 py-2 text-left hover:bg-paper sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3 print:grid-cols-[8rem_minmax(0,1fr)_auto] print:py-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <b className="text-base">{j.no}</b>
          {late && <span className="text-sm font-semibold whitespace-nowrap text-danger">ส่ง {shortDate(j.due)}</span>}
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate font-medium">{j.customer}</span>
          <span className="truncate text-sm text-muted">{j.product} · {j.qty.toLocaleString('th-TH')} {j.unit}</span>
          {ship?.delivery && (
            <span className="flex min-w-0 items-center gap-1 text-sm text-muted">
              <IconTruck className="size-4 shrink-0" />
              <span className="truncate">{ship.delivery}{ship.address ? ` · ${ship.address.replace(/\s+/g, ' ')}` : ''}</span>
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1 sm:justify-end">
          <Pill tone={label.tone} wrap>{label.text}</Pill>
          {item.finish && (item.state === 'waiting' || item.state === 'doing' || item.state === 'hold' || item.state === 'out') && (
            <span className="text-xs text-muted">คาดว่าเสร็จ {shortDate(item.finish)}</span>
          )}
        </span>
      </button>
    </li>
  )
}

export function DeliveriesView({ jobs, now, finishOf, onOpen }: { jobs: Job[]; now: Date; finishOf: (j: Job) => Date | undefined; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const plan = useMemo(() => deliverySchedule(jobs, now, finishOf), [jobs, now, finishOf])
  const ids = useMemo(() => [...plan.days.flatMap(d => d.items), ...plan.deliveredToday].map(i => i.job.id).sort(), [plan])
  const ship = useShipping(ids)
  const keep = (i: DeliveryItem) => filter === 'all' || (filter === 'ready' ? i.state === 'ready' : i.state !== 'ready')
  const days = plan.days.map(d => ({ ...d, items: d.items.filter(keep) })).filter(d => d.items.length > 0)
  const { summary: s } = plan

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted print:hidden">เรียงตามกำหนดส่งลูกค้า · กดงานเพื่อดูรายละเอียดหรือบันทึกจัดส่ง</p>
        <p className="hidden font-semibold print:block">พิมพ์เมื่อ {now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full', timeStyle: 'short' })} น. · ภาพพิมพ์ 142</p>
        <button type="button" onClick={() => window.print()}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line bg-card px-4 font-semibold text-brand hover:border-brand print:hidden">
          <IconPrinter className="size-5" />พิมพ์รายการ
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 print:hidden">
        <StatTile icon={IconAlert} label="เลยกำหนด ยังไม่ส่ง" value={s.overdue} tone="danger" note="ต้องตามด่วน" noteOnPhone />
        <StatTile icon={IconTruck} label="ต้องส่งวันนี้" value={s.today} tone="warn" note={`พร้อมส่ง ${s.todayReady} งาน`} noteOnPhone />
        <StatTile icon={IconCalendar} label="ส่งพรุ่งนี้" value={s.tomorrow} tone="brand" note={`7 วันข้างหน้า ${s.week} งาน`} noteOnPhone />
        <StatTile icon={IconClock} label="คาดว่าเสร็จไม่ทันส่ง" value={s.risk} tone="danger" note="จากคิวและกำลังผลิตตอนนี้" noteOnPhone />
      </div>

      <div className="print:hidden">
        <ViewSwitch label="แสดงงาน" value={filter} onChange={setFilter}
          options={[['all', 'ทั้งหมด'], ['notDone', 'ยังไม่เสร็จ'], ['ready', 'พร้อมส่ง']]} />
      </div>

      {days.length === 0 && plan.deliveredToday.length === 0 && (
        <Card className="p-5"><p className="text-muted">{filter === 'all' ? 'ไม่มีงานรอส่งลูกค้า' : 'ไม่มีงานตามที่เลือก'}</p></Card>
      )}

      {days.map(d => (
        <Card key={d.key} className="print:break-inside-avoid print:shadow-none">
          <CardHeader icon={d.kind === 'overdue' ? IconAlert : IconCalendar} tone={dayTone(d)} title={dayTitle(d)}
            sub={`${d.items.length} งาน${d.items.some(i => i.state === 'ready') ? ` · พร้อมส่ง ${d.items.filter(i => i.state === 'ready').length}` : ''}${d.items.some(i => i.state !== 'ready') ? ` · ยังไม่เสร็จ ${d.items.filter(i => i.state !== 'ready').length}` : ''}`} />
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 px-2 pb-3 sm:px-3">
            {d.items.map(i => <Row key={i.job.id} item={i} ship={ship.get(i.job.id)} now={now} onOpen={onOpen} />)}
          </ul>
        </Card>
      ))}

      {filter !== 'notDone' && plan.deliveredToday.length > 0 && (
        <Card className="print:hidden">
          <CardHeader icon={IconCheck} tone="ok" title="ส่งแล้ววันนี้" sub={`${plan.deliveredToday.length} งาน`} />
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 px-2 pb-3 sm:px-3">
            {plan.deliveredToday.map(i => <Row key={i.job.id} item={i} ship={ship.get(i.job.id)} now={now} onOpen={onOpen} />)}
          </ul>
        </Card>
      )}
    </div>
  )
}
