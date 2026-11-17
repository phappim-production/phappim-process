import { useId, useMemo, useState, type ReactNode } from 'react'
import { Card, CardHeader, Pill, RouteBadge } from '../components/ui'
import { IconCalendar } from '../components/icons'
import { STATION_NAME, type Job } from '../proto/model'
import { BOOKING_TIME_ZONE, bookingDay, bookingTime, checkBooking, freeDuring, groupBookings, isBookingSunday, jobsBookedDuring, moveBookingDay, MACHINE_PREFIX, MACHINE_TYPE_NAME, MACHINE_TYPES, type Booking, type Machine, type Need } from '../proto/sewing'

// จองจักรเป็นวัน-เวลา (S14) · ตารางรายวันต่อจักร + ฟอร์มจอง · กฎเดียวกับ public.book_machines
type Result = { ok: true; picked?: string[] } | { ok: false; reason: string }

const DAY_START = 7   // แสดงช่วง 07:00–20:00 (เวลาทำงานของโรงงาน)
const DAY_END = 20
const pad = (n: number) => String(n).padStart(2, '0')

const hm = (d: Date) => d.toLocaleTimeString('th-TH', { timeZone: BOOKING_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayLabel = (d: Date) => d.toLocaleDateString('th-TH', { timeZone: BOOKING_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' })
const range = (b: { starts: Date; ends: Date }) =>
  bookingDay(b.starts) === bookingDay(b.ends)
    ? `${dayLabel(b.starts)} ${hm(b.starts)}–${hm(b.ends)}`
    : `${dayLabel(b.starts)} ${hm(b.starts)} – ${dayLabel(b.ends)} ${hm(b.ends)}`

// วันทำงานถัดไป (จันทร์–เสาร์) สำหรับค่าเริ่มของฟอร์ม
function nextWorkday(day: string) {
  const next = moveBookingDay(day, 1)
  return isBookingSunday(next) ? moveBookingDay(next, 1) : next
}

export function BookingPanel({ jobs, machines, bookings, needs, now, onOpen, onBook, onCancel }: {
  jobs: Job[]; machines: Machine[]; bookings: Booking[]; now: Date; onOpen: (id: string) => void
  needs: Record<string, Need[]>
  onBook?: (jobId: string, starts: Date, ends: Date) => Promise<Result>   // ไม่ส่ง = ดูอย่างเดียว
  onCancel?: (jobId: string) => Promise<Result>
}) {
  const [day, setDay] = useState(() => bookingDay(now))
  const [view, setView] = useState<'job' | 'machine'>('job')
  const [allMachines, setAllMachines] = useState(false)
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const byJob = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs])
  const byMachine = useMemo(() => new Map(machines.map(m => [m.id, m])), [machines])
  const sewing = useMemo(() => [...machines].sort((a, b) =>
    MACHINE_TYPES.indexOf(a.type) - MACHINE_TYPES.indexOf(b.type) || a.code.localeCompare(b.code)), [machines])

  const today = bookingDay(now)
  const midnight = bookingTime(day, '00:00')
  const nextMidnight = bookingTime(moveBookingDay(day, 1), '00:00')
  const onDay = bookings.filter(b => b.starts < nextMidnight && b.ends > midnight)
  const dayGroups = groupBookings(onDay)
  const groups = groupBookings(bookings.filter(b => b.ends > now))
  const usualStart = bookingTime(day, `${pad(DAY_START)}:00`)
  const usualEnd = bookingTime(day, `${pad(DAY_END)}:00`)
  const startHour = onDay.some(b => b.starts < usualStart) ? 0 : DAY_START
  const endHour = onDay.some(b => b.ends > usualEnd) ? 24 : DAY_END
  const win = {
    start: midnight.getTime() + startHour * 3_600_000,
    end: midnight.getTime() + endHour * 3_600_000,
  }
  const axis = { startHour, endHour }
  const nowMs = now.getTime()
  const nowPct = nowMs >= win.start && nowMs <= win.end ? ((nowMs - win.start) / (win.end - win.start)) * 100 : null
  const isSunday = isBookingSunday(day)
  const diff = Math.round((midnight.getTime() - bookingTime(today, '00:00').getTime()) / 86_400_000)
  const relDay = diff === 0 ? 'วันนี้' : diff === 1 ? 'พรุ่งนี้' : diff === -1 ? 'เมื่อวาน' : diff > 0 ? `อีก ${diff} วัน` : `${-diff} วันก่อน`
  const nextQuarter = new Date(Math.ceil(nowMs / 900_000) * 900_000)
  const defaultDay = day >= today && !isSunday && bookingTime(day, '17:00') > nextQuarter ? day : nextWorkday(today)
  const startOfShift = bookingTime(defaultDay, '08:00')
  const defaultStart = hm(defaultDay === today && nextQuarter > startOfShift ? nextQuarter : startOfShift)
  const bookedToday = new Set(onDay.map(b => b.machineId))
  const visibleMachines = allMachines ? sewing : sewing.filter(m => bookedToday.has(m.id) || m.status !== 'ready')

  async function cancel(jobId: string) {
    if (!onCancel) return
    const label = byJob.get(jobId)?.no ?? 'งานนี้'
    if (!window.confirm(`ยกเลิกการจองจักรของ ${label} ใช่ไหม?`)) return
    const r = await onCancel(jobId)
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
                <li key={g[0].id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
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
                    <span className="mt-0.5 block break-words text-sm">จักร: {g.map(b => byMachine.get(b.machineId)?.code).filter(Boolean).sort().join(' · ')}</span>
                    {(() => {
                      const bad = g.map(b => byMachine.get(b.machineId)).filter(m => m && m.status !== 'ready').map(m => m!.code)
                      return bad.length ? (
                        <span role="alert" className="mt-0.5 block text-sm font-semibold text-danger">
                          จักร {bad.join(', ')} เสีย/ปิดอยู่ · ถึงเวลาจะเริ่มเย็บไม่ได้ ให้ยกเลิกแล้วจองใหม่
                        </span>
                      ) : null
                    })()}
                  </button>
                  {onCancel && (
                    <button onClick={() => void cancel(g[0].jobId)}
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

      {/* ตารางรายวัน: ค่าเริ่มดูทีละงาน (แถวน้อย อ่านง่าย) · สลับดูรายจักรได้ */}
      <div className="border-t border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="mr-auto font-semibold">ตารางจองรายวัน</h4>
          <div role="tablist" aria-label="มุมมองตาราง" className="flex rounded-xl border border-line p-0.5">
            {([['job', 'ทีละงาน'], ['machine', 'ทีละจักร']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${view === k ? 'bg-brand-700 text-white' : 'text-muted hover:text-ink'}`}>{label}</button>
            ))}
          </div>
        </div>

        {/* เลือกวัน: ปุ่มก่อนหน้า / ถัดไป ใหญ่พอสำหรับแท็บเล็ต */}
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setDay(moveBookingDay(day, -1))} aria-label="วันก่อนหน้า" className="grid size-12 shrink-0 place-items-center rounded-full border border-line text-xl hover:bg-paper">‹</button>
          <label className="relative min-w-0 flex-1 cursor-pointer rounded-xl border border-line px-3 py-1.5 text-center hover:bg-paper">
            <span className="block truncate font-semibold">{midnight.toLocaleDateString('th-TH', { timeZone: BOOKING_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' })}</span>
            <span className="block text-xs text-muted">{relDay}</span>
            <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} aria-label="เลือกวัน"
              className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
          <button onClick={() => setDay(moveBookingDay(day, 1))} aria-label="วันถัดไป" className="grid size-12 shrink-0 place-items-center rounded-full border border-line text-xl hover:bg-paper">›</button>
        </div>

        {isSunday && !onDay.length ? (
          <p className="mt-3 rounded-xl bg-paper px-3 py-3 text-center text-muted">วันอาทิตย์ โรงงานหยุด</p>
        ) : (
          <>
            <p className="mt-3 text-sm">
              {dayGroups.length === 0
                ? <span className="text-muted">วันที่เลือกยังไม่มีการจอง</span>
                : <>จอง <b>{dayGroups.length}</b> งาน · ใช้จักร <b>{bookedToday.size}</b> จาก {machines.length} ตัว · พร้อมใช้และไม่มีจอง <b className="text-ok">{machines.filter(m => m.status === 'ready' && !m.jobId && !bookedToday.has(m.id)).length}</b> ตัว</>}
            </p>

            {(view === 'job' ? dayGroups.length > 0 : true) && (
              <div className="mt-3 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm">
                <span />
                <HourAxis {...axis} />
                {view === 'job' ? dayGroups.map(g => {
                  const job = byJob.get(g[0].jobId)
                  const codes = g.map(b => byMachine.get(b.machineId)?.code).filter(Boolean).sort().join(' · ')
                  return (
                    <div key={g[0].id} className="contents">
                      <button onClick={() => job && onOpen(job.id)} className="self-start pt-1 text-left font-semibold leading-tight">
                        {job?.no ?? '—'}
                      </button>
                      <div>
                        <Track {...axis} nowPct={nowPct}>
                          <Bar win={win} b={g[0]} label={`${hm(g[0].starts)}–${hm(g[0].ends)} · ${job?.customer ?? ''}`} onClick={() => job && onOpen(job.id)} />
                        </Track>
                        <span className="mt-0.5 block truncate text-xs text-muted">{job ? `${job.product} ${job.qty.toLocaleString('th-TH')} ${job.unit} · ` : ''}จักร {codes}</span>
                      </div>
                    </div>
                  )
                }) : visibleMachines.map(m => {
                  const mine = onDay.filter(b => b.machineId === m.id)
                  return (
                    <div key={m.id} className="contents">
                      <span className="self-center font-mono font-semibold">{m.code}</span>
                      <Track {...axis} nowPct={nowPct} off={m.status !== 'ready' ? (m.status === 'broken' ? 'เสีย' : 'ปิดใช้งาน') : undefined}>
                        {mine.map(b => {
                          const job = byJob.get(b.jobId)
                          return <Bar key={b.id} win={win} b={b} label={job?.no ?? ''} onClick={() => job && onOpen(job.id)} />
                        })}
                      </Track>
                    </div>
                  )
                })}
              </div>
            )}
            {view === 'machine' && (
              <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={allMachines} onChange={e => setAllMachines(e.target.checked)} className="size-5 accent-brand" />
                แสดงจักรทั้งหมด {machines.length} ตัว (แสดงเฉพาะจักรที่จองหรือไม่พร้อมใช้)
              </label>
            )}
            <p className="mt-2 text-xs text-muted">แถบส้ม = ช่วงที่จอง · พื้นขาว = เวลางาน 08:00–17:00 · เส้นแดง = ตอนนี้ · กดแถบเพื่อดูงาน</p>
          </>
        )}
      </div>

      {open && onBook && (
        <BookDialog jobs={jobs} machines={machines} bookings={bookings} needs={needs} now={now} defaultDay={defaultDay} defaultStart={defaultStart}
          onClose={() => setOpen(false)}
          onSubmit={async (jobId, starts, ends) => {
            const r = await onBook(jobId, starts, ends)
            if (r.ok) {
              setOpen(false)
              setDay(bookingDay(starts))
              setNotice({ ok: true, text: `จองจักรให้ ${byJob.get(jobId)?.no ?? ''} แล้ว · ${range({ starts, ends })} · ${r.picked?.join(', ') ?? ''}` })
            }
            return r
          }} />
      )}
    </Card>
  )
}

function BookDialog({ jobs, machines, bookings, needs, now, defaultDay, defaultStart, onClose, onSubmit }: {
  jobs: Job[]; machines: Machine[]; bookings: Booking[]; now: Date; defaultDay: string; defaultStart: string
  needs: Record<string, Need[]>
  onClose: () => void; onSubmit: (jobId: string, starts: Date, ends: Date) => Promise<Result>
}) {
  const id = useId()
  // งานที่จองได้: ยังไม่ผ่านเย็บ · รู้ว่าใช้จักรอะไร · ยังไม่มีการจอง · กำหนดส่งใกล้ก่อน
  const candidates = jobs
    .filter(j => j.phase !== 'done' && !(j.phase === 'production' && j.station === 'qc_pack') && j.productCode && needs[j.productCode] && !bookings.some(b => b.jobId === j.id && b.ends > now))
    .sort((a, b) => a.due.getTime() - b.due.getTime())
  const [jobId, setJobId] = useState('')
  const [query, setQuery] = useState('')
  const matching = candidates.filter(j => `${j.no} ${j.customer} ${j.product}`.toLowerCase().includes(query.trim().toLowerCase()) || j.id === jobId)
  const [startDay, setStartDay] = useState(defaultDay)
  const [startTime, setStartTime] = useState(defaultStart)
  const [endDay, setEndDay] = useState(defaultDay)
  const [endTime, setEndTime] = useState('17:00')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const job = candidates.find(j => j.id === jobId)
  const starts = bookingTime(startDay, startTime)
  const ends = bookingTime(endDay, endTime)
  const check = job ? checkBooking(job, machines, bookings, starts, ends, needs, now) : null
  const field = 'min-h-12 min-w-0 w-full rounded-xl border border-line bg-card px-3 text-base'

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-5 shadow-lift">
        <h3 id={`${id}-t`} className="flex items-center gap-2 text-xl font-bold text-brand"><IconCalendar className="size-6" />จองจักร</h3>
        {candidates.length === 0 ? (
          <p className="mt-3 text-muted">ยังไม่มีงานให้จอง ตรวจว่ามีงานที่ยังไม่ผ่านเย็บ มีสูตรจักร และยังไม่มีการจอง</p>
        ) : (
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 font-medium">
              ค้นหางาน
              <input autoFocus className={field} type="search" placeholder="เลขที่ใบยืนยัน ลูกค้า หรือสินค้า" value={query} onChange={e => setQuery(e.target.value)} />
            </label>
            <label className="grid min-w-0 gap-1 font-medium">
              งาน
              <select value={jobId} onChange={e => { setJobId(e.target.value); setError('') }} className={field}>
                <option value="">{matching.length ? 'เลือกงานที่ต้องการจอง' : 'ไม่พบงานที่ตรงกับการค้นหา'}</option>
                {matching.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.no} · {j.product} {j.qty.toLocaleString('th-TH')} {j.unit} · ส่ง {j.due.toLocaleDateString('th-TH', { timeZone: BOOKING_TIME_ZONE, day: 'numeric', month: 'short' })}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-muted">วันและเวลาของโรงงาน (เวลาไทย)</p>
            <div className="grid grid-cols-2 gap-2 [&>label]:min-w-0">
              <label className="grid gap-1 font-medium">เริ่มวันที่<input type="date" value={startDay} className={field}
                onChange={e => { setStartDay(e.target.value); if (endDay < e.target.value) setEndDay(e.target.value); setError('') }} /></label>
              <label className="grid gap-1 font-medium">เวลาเริ่ม<input type="time" value={startTime} className={field} onChange={e => { setStartTime(e.target.value); setError('') }} /></label>
              <label className="grid gap-1 font-medium">ถึงวันที่<input type="date" value={endDay} min={startDay} className={field} onChange={e => { setEndDay(e.target.value); setError('') }} /></label>
              <label className="grid gap-1 font-medium">เวลาจบ<input type="time" value={endTime} className={field} onChange={e => { setEndTime(e.target.value); setError('') }} /></label>
            </div>
            {/* หลายงานเย็บวันเดียวกันได้: บอกว่าช่วงนี้มีใครจองแล้ว และงานนี้ยังได้จักรครบทุกชนิดไหม */}
            {job && !Number.isNaN(starts.getTime()) && !Number.isNaN(ends.getTime()) && ends > starts && (() => {
              const others = jobsBookedDuring(bookings, starts, ends).map(id => jobs.find(j => j.id === id)?.no).filter(Boolean)
              const free = freeDuring(machines, bookings, starts, ends, now, job.id)
              const jobNeeds = (job.productCode && needs[job.productCode]) || []
              return (
                <div className="rounded-xl border border-line px-3 py-2 text-sm">
                  <p className="text-muted">
                    {others.length ? `ช่วงนี้มีงานจองแล้ว ${others.length} งาน (${others.join(', ')}) · จักรที่เหลือรับงานนี้ได้ถ้าครบชุด` : 'ช่วงนี้ยังไม่มีงานอื่นจอง'}
                  </p>
                  <p className="mt-1 font-medium">{job.product} ต้องใช้จักรครบชุด:</p>
                  <ul className="mt-1 grid gap-0.5">
                    {jobNeeds.map(n => {
                      const enough = free[n.type] >= n.qty
                      return (
                        <li key={n.type} className={`flex items-center gap-2 ${enough ? 'text-ok' : 'font-semibold text-danger'}`}>
                          <span aria-hidden>{enough ? '✓' : '✗'}</span>
                          <span className="font-mono text-xs">{MACHINE_PREFIX[n.type]}</span>
                          {MACHINE_TYPE_NAME[n.type]} {n.qty} ตัว
                          <span className="ml-auto text-muted">ว่าง {free[n.type]}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })()}
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
            <button type="button" disabled={!check?.ok || saving}
              onClick={async () => {
                setSaving(true)
                const r = await onSubmit(jobId, starts, ends)
                setSaving(false)
                if (!r.ok) setError(r.reason)
              }}
              className="min-h-12 rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted ">
              {saving ? 'กำลังจอง…' : check?.ok ? 'ยืนยันจอง' : job ? 'ช่วงเวลานี้จองไม่ได้' : 'เลือกงานก่อนจอง'}
            </button>
          )}
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-semibold text-muted hover:bg-paper">ปิด</button>
        </div>
      </div>
    </div>
  )
}

// ---------- ส่วนประกอบของตารางรายวัน ----------
const WORK_START = 8   // พื้นขาว = เวลางาน
const WORK_END = 17
type Axis = { startHour: number; endHour: number }
const ticks = [4, 8, 10, 12, 14, 16, 18, 22]
const pctOf = (h: number, { startHour, endHour }: Axis) => ((h - startHour) / (endHour - startHour)) * 100

function HourAxis(axis: Axis) {
  const { startHour: start, endHour: end } = axis
  return (
    <div className="relative h-5 text-xs text-muted">
      {ticks.filter(h => h > start && h < end).map(h => (
        <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pctOf(h, axis)}%` }}>{pad(h)}<span className="hidden sm:inline">:00</span></span>
      ))}
    </div>
  )
}

function Track({ startHour: start, endHour: end, nowPct, off, children }: Axis & { nowPct: number | null; off?: string; children?: ReactNode }) {
  const axis = { startHour: start, endHour: end }
  return (
    <div className={`relative h-9 overflow-hidden rounded-lg border border-line ${off ? 'bg-danger-soft' : 'bg-paper'}`}>
      {!off && <span className="absolute inset-y-0 bg-card" style={{ left: `${pctOf(WORK_START, axis)}%`, width: `${pctOf(WORK_END, axis) - pctOf(WORK_START, axis)}%` }} aria-hidden />}
      {ticks.filter(h => h > start && h < end).map(h => <span key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: `${pctOf(h, axis)}%` }} aria-hidden />)}
      {off && <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold text-danger">{off}</span>}
      {children}
      {nowPct !== null && <span className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: `${nowPct}%` }} aria-hidden />}
    </div>
  )
}

function Bar({ win, b, label, onClick }: { win: { start: number; end: number }; b: Booking; label: string; onClick: () => void }) {
  const from = Math.max(b.starts.getTime(), win.start)
  const to = Math.min(b.ends.getTime(), win.end)
  const span = win.end - win.start
  return (
    <button onClick={onClick} title={`${label} · ${range(b)}`}
      className="absolute inset-y-1 overflow-hidden rounded-md border border-warn bg-warn-soft px-1.5 text-left text-xs font-semibold whitespace-nowrap text-warn hover:brightness-95"
      style={{ left: `${((from - win.start) / span) * 100}%`, width: `${((to - from) / span) * 100}%` }}>
      {label}
    </button>
  )
}
