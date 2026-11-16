import { useId, useMemo, useState } from 'react'
import { Card, CardHeader, Pill, RouteBadge } from '../components/ui'
import { IconCalendar } from '../components/icons'
import { STATION_NAME, type Job } from '../proto/model'
import { checkBooking, MACHINE_PREFIX, MACHINE_TYPES, SEW_NEEDS, type Booking, type Machine } from '../proto/sewing'

// จองจักรเป็นวัน-เวลา (S14) · ตารางรายวันต่อจักร + ฟอร์มจอง · กฎเดียวกับ public.book_machines
type Result = { ok: true; picked?: string[] } | { ok: false; reason: string }

const DAY_START = 7   // แสดงช่วง 07:00–20:00 (เวลาทำงานของโรงงาน)
const DAY_END = 20
const pad = (n: number) => String(n).padStart(2, '0')
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromInputs = (date: string, time: string) => new Date(`${date}T${time}`)
const hm = (d: Date) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
const dayLabel = (d: Date) => d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })
const range = (b: { starts: Date; ends: Date }) =>
  b.starts.toDateString() === b.ends.toDateString()
    ? `${dayLabel(b.starts)} ${hm(b.starts)}–${hm(b.ends)}`
    : `${dayLabel(b.starts)} ${hm(b.starts)} – ${dayLabel(b.ends)} ${hm(b.ends)}`

// วันทำงานถัดไป (จันทร์–เสาร์) สำหรับค่าเริ่มของฟอร์ม
function nextWorkday(now: Date) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return d
}

export function BookingPanel({ jobs, machines, bookings, now, onOpen, onBook, onCancel }: {
  jobs: Job[]; machines: Machine[]; bookings: Booking[]; now: Date; onOpen: (id: string) => void
  onBook?: (jobId: string, starts: Date, ends: Date) => Result   // ไม่ส่ง = ดูอย่างเดียว
  onCancel?: (jobId: string) => Result
}) {
  const [day, setDay] = useState(() => toDateInput(now))
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const byJob = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs])
  const byMachine = useMemo(() => new Map(machines.map(m => [m.id, m])), [machines])
  const sewing = useMemo(() => [...machines].sort((a, b) =>
    MACHINE_TYPES.indexOf(a.type) - MACHINE_TYPES.indexOf(b.type) || a.code.localeCompare(b.code)), [machines])

  const dayStart = fromInputs(day, `${pad(DAY_START)}:00`)
  const dayEnd = fromInputs(day, `${pad(DAY_END)}:00`)
  const span = dayEnd.getTime() - dayStart.getTime()
  const live = bookings.filter(b => b.ends > now)
  // รวมการจองทีละงาน (1 งานจองหลายจักรในช่วงเดียวกัน)
  const groups = [...new Map(live.map(b => [b.jobId, live.filter(x => x.jobId === b.jobId)])).values()]
    .sort((a, b) => a[0].starts.getTime() - b[0].starts.getTime())
  const nowPct = now >= dayStart && now <= dayEnd ? ((now.getTime() - dayStart.getTime()) / span) * 100 : null

  function cancel(jobId: string) {
    if (!onCancel) return
    const r = onCancel(jobId)
    setNotice(r.ok ? { ok: true, text: `ยกเลิกการจองของ ${byJob.get(jobId)?.no ?? ''} แล้ว` } : { ok: false, text: r.reason })
  }

  return (
    <Card>
      <CardHeader icon={IconCalendar} title="จองจักรล่วงหน้า"
        sub="เลือกงานและวันเวลา ระบบจองจักรครบตามสินค้า · ช่วงที่จองแล้ว งานอื่นใช้จักรนั้นไม่ได้" />
      {onBook && (
        <div className="px-5 pb-3">
          <button onClick={() => { setNotice(null); setOpen(true) }}
            className="inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-700 sm:w-auto">
            <IconCalendar className="size-5" />จองจักร
          </button>
        </div>
      )}
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={`mx-5 mb-3 rounded-xl px-3 py-2 font-medium ${notice.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          {notice.text}
        </p>
      )}

      {/* รายการจอง */}
      <div className="border-t border-line">
        {groups.length === 0 ? (
          <p className="px-5 py-4 text-muted">ยังไม่มีการจองจักร</p>
        ) : (
          <ol className="divide-y divide-line">
            {groups.map(g => {
              const job = byJob.get(g[0].jobId)
              const running = g[0].starts <= now
              return (
                <li key={g[0].jobId} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                  <button onClick={() => job && onOpen(job.id)} className="min-w-0 flex-1 text-left">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={running ? 'info' : 'warn'} dot>{running ? 'อยู่ในช่วงจอง' : 'จองแล้ว'}</Pill>
                      <span className="font-semibold">{job?.no ?? 'งานที่ไม่พบ'}</span>
                      {job && <RouteBadge route={job.route} />}
                      <span className="font-medium">{range(g[0])}</span>
                    </span>
                    {job && (
                      <span className="mt-0.5 block truncate text-sm text-muted">
                        {job.customer} · {job.product} {job.qty.toLocaleString('th-TH')} {job.unit}
                        {job.station ? ` · ตอนนี้อยู่${STATION_NAME[job.station]}` : ''}
                      </span>
                    )}
                    <span className="mt-0.5 block text-sm">จักร: {g.map(b => byMachine.get(b.machineId)?.code).filter(Boolean).sort().join(' · ')}</span>
                  </button>
                  {onCancel && (
                    <button onClick={() => cancel(g[0].jobId)}
                      className="min-h-12 shrink-0 rounded-xl border border-line px-4 font-semibold text-danger hover:bg-danger-soft">
                      ยกเลิกการจอง
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {/* ตารางรายวัน: 1 แถว = จักร 1 ตัว · แถบส้ม = ช่วงที่จอง */}
      <div className="border-t border-line px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h4 className="font-semibold">ตารางจองรายวัน</h4>
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} aria-label="เลือกวัน"
            className="min-h-11 rounded-xl border border-line px-3 text-base" />
          {day !== toDateInput(now) && (
            <button onClick={() => setDay(toDateInput(now))} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-brand-soft">วันนี้</button>
          )}
          {fromInputs(day, '12:00').getDay() === 0 && <Pill tone="neutral">วันอาทิตย์ โรงงานหยุด</Pill>}
        </div>
        <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
          <span />
          <div className="relative h-5 text-xs text-muted">
            {Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i).filter(h => h % 2 === 1).map(h => (
              <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h - DAY_START) / (DAY_END - DAY_START)) * 100}%` }}>{pad(h)}</span>
            ))}
          </div>
          {sewing.map(m => {
            const mine = bookings.filter(b => b.machineId === m.id && b.starts < dayEnd && b.ends > dayStart)
            return (
              <div key={m.id} className="contents">
                <span className="self-center font-mono font-semibold">{m.code}</span>
                <div className={`relative h-8 overflow-hidden rounded-md ${m.status === 'ready' ? 'bg-paper' : 'bg-danger-soft'}`}>
                  {m.status !== 'ready' && <span className="absolute inset-y-0 left-2 flex items-center text-xs text-danger">{m.status === 'broken' ? 'เสีย' : 'ปิดใช้งาน'}</span>}
                  {mine.map(b => {
                    const from = Math.max(b.starts.getTime(), dayStart.getTime())
                    const to = Math.min(b.ends.getTime(), dayEnd.getTime())
                    const job = byJob.get(b.jobId)
                    return (
                      <button key={b.id} onClick={() => job && onOpen(job.id)} title={`${job?.no ?? ''} ${range(b)}`}
                        className="absolute inset-y-0.5 overflow-hidden rounded border border-warn bg-warn-soft px-1 text-left text-xs font-semibold whitespace-nowrap text-warn"
                        style={{ left: `${((from - dayStart.getTime()) / span) * 100}%`, width: `${Math.max(((to - from) / span) * 100, 2)}%` }}>
                        {job?.no.slice(-3)}
                      </button>
                    )
                  })}
                  {nowPct !== null && <span className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: `${nowPct}%` }} aria-hidden />}
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-muted">แถบส้ม = ช่วงที่จอง (เลข 3 ตัวท้ายของเลขที่ใบ) · เส้นแดง = ตอนนี้ · กดแถบเพื่อดูงาน</p>
      </div>

      {open && onBook && (
        <BookDialog jobs={jobs} machines={machines} bookings={bookings} now={now} defaultDay={toDateInput(nextWorkday(now))}
          onClose={() => setOpen(false)}
          onSubmit={(jobId, starts, ends) => {
            const r = onBook(jobId, starts, ends)
            if (r.ok) {
              setOpen(false)
              setDay(toDateInput(starts))
              setNotice({ ok: true, text: `จองจักรให้ ${byJob.get(jobId)?.no ?? ''} แล้ว · ${range({ starts, ends })} · ${r.picked?.join(', ') ?? ''}` })
            }
            return r
          }} />
      )}
    </Card>
  )
}

function BookDialog({ jobs, machines, bookings, now, defaultDay, onClose, onSubmit }: {
  jobs: Job[]; machines: Machine[]; bookings: Booking[]; now: Date; defaultDay: string
  onClose: () => void; onSubmit: (jobId: string, starts: Date, ends: Date) => Result
}) {
  const id = useId()
  // งานที่จองได้: ยังไม่ผ่านเย็บ · รู้ว่าใช้จักรอะไร · ยังไม่มีการจอง · กำหนดส่งใกล้ก่อน
  const candidates = jobs
    .filter(j => j.phase !== 'done' && !(j.phase === 'production' && j.station === 'qc_pack') && j.productCode && SEW_NEEDS[j.productCode] && !bookings.some(b => b.jobId === j.id && b.ends > now))
    .sort((a, b) => a.due.getTime() - b.due.getTime())
  const [jobId, setJobId] = useState(candidates[0]?.id ?? '')
  const [startDay, setStartDay] = useState(defaultDay)
  const [startTime, setStartTime] = useState('08:00')
  const [endDay, setEndDay] = useState(defaultDay)
  const [endTime, setEndTime] = useState('17:00')
  const [error, setError] = useState('')
  const job = candidates.find(j => j.id === jobId)
  const starts = fromInputs(startDay, startTime)
  const ends = fromInputs(endDay, endTime)
  const check = job ? checkBooking(job, machines, bookings, starts, ends, SEW_NEEDS, now) : null
  const field = 'min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base'

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/35 p-4 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onClick={e => e.stopPropagation()}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-lift">
        <h3 id={`${id}-t`} className="flex items-center gap-2 text-xl font-bold text-brand"><IconCalendar className="size-6" />จองจักร</h3>
        {candidates.length === 0 ? (
          <p className="mt-3 text-muted">ไม่มีงานที่จองได้ (งานที่ยังไม่เสร็จและรู้ว่าใช้จักรอะไร ถูกจองครบแล้ว)</p>
        ) : (
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 font-medium">
              งาน
              <select value={jobId} onChange={e => { setJobId(e.target.value); setError('') }} className={field}>
                {candidates.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.no} · {j.product} {j.qty.toLocaleString('th-TH')} {j.unit} · ส่ง {j.due.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 font-medium">เริ่มวันที่<input type="date" value={startDay} className={field}
                onChange={e => { setStartDay(e.target.value); if (endDay < e.target.value) setEndDay(e.target.value); setError('') }} /></label>
              <label className="grid gap-1 font-medium">เวลา<input type="time" value={startTime} className={field} onChange={e => { setStartTime(e.target.value); setError('') }} /></label>
              <label className="grid gap-1 font-medium">ถึงวันที่<input type="date" value={endDay} min={startDay} className={field} onChange={e => { setEndDay(e.target.value); setError('') }} /></label>
              <label className="grid gap-1 font-medium">เวลา<input type="time" value={endTime} className={field} onChange={e => { setEndTime(e.target.value); setError('') }} /></label>
            </div>
            {check && (check.ok ? (
              <p className="rounded-xl bg-ok-soft px-3 py-2 text-ok">
                จะจอง: {check.picked.map(m => m.code).join(' · ')}
                <span className="block text-sm">{[...new Set(check.picked.map(m => MACHINE_PREFIX[m.type]))].length} ประเภท ครบตามที่{job?.product}ต้องใช้</span>
              </p>
            ) : (
              <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger">{check.reason}</p>
            ))}
            {error && <p role="alert" className="text-danger">{error}</p>}
          </div>
        )}
        <div className="mt-4 grid gap-2">
          {candidates.length > 0 && (
            <button type="button" disabled={!check?.ok}
              onClick={() => { const r = onSubmit(jobId, starts, ends); if (!r.ok) setError(r.reason) }}
              className="min-h-12 rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted">
              {check?.ok ? 'ยืนยันจอง' : 'ช่วงเวลานี้จองไม่ได้'}
            </button>
          )}
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-semibold text-muted hover:bg-paper">ปิด</button>
        </div>
      </div>
    </div>
  )
}
