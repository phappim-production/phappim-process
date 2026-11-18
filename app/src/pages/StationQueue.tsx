import { useEffect, useState, type ReactNode } from 'react'
import { STATION_NAME, byQueue, filmLabel, isOverdue, waitingAt, type Job, type StationCode } from '../proto/model'
import { spaced } from '../proto/format'
import { DueLabel, Pill } from '../components/ui'
import { dangerBtn, fieldClass, okBtn, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconAlert, IconCheck, IconChevronRight } from '../components/icons'
import type { EmployeeRole } from '../auth/access'

export type QueueCall = (name: string, args: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; reason: string }>

/**
 * คิวของสถานีเดียว สำหรับคนหน้างานบนมือถือ: เห็นเฉพาะงานของสถานีตัวเอง เรียงตามคิว · กดเริ่ม/เสร็จบนการ์ดได้เลย
 * คิวแรกได้ปุ่มใหญ่ · เริ่มคิวหลังได้แต่ต้องใส่เหตุผล (เจ้าของเลือก "แค่เรียง + เตือน") · หัวหน้า/ผู้บริหารแทรกงานด่วนเป็นคิวแรกได้
 * กฎทุกข้อตรวจซ้ำที่ฐานข้อมูล · เริ่มงานใช้ start_in_queue (ตรวจคิวล่าสุด + บันทึกเหตุผล + เริ่ม ในธุรกรรมเดียว · เย็บจ่ายจักรให้)
 */
export function StationQueue({ station, jobs, role, now, call, onOpen }: {
  station: StationCode; jobs: Job[]; role: EmployeeRole; now: Date; call: QueueCall; onOpen: (id: string) => void
}) {
  const floor = role === 'production' || role === 'supervisor' || role === 'owner'
  const canPress = floor || (role === 'qc' && station === 'qc_pack')
  const canInsert = floor || role === 'manager'
  const working = jobs.filter(j => (j.phase === 'sample' || j.phase === 'production') && j.station === station && (j.status === 'doing' || j.status === 'hold')).sort(byQueue)
  const queue = waitingAt(jobs, station)
  const [notice, setNotice] = useState<{ ok: boolean; text: string; jobId?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function run(job: Job, steps: [string, Record<string, unknown>][], ok: string) {
    setBusy(job.id)
    setNotice(null)
    for (const [name, args] of steps) {
      const r = await call(name, { p_job: job.id, ...args })
      if (!r.ok) { setBusy(null); setNotice({ ok: false, text: `${job.no}: ${r.reason}`, jobId: job.id }); return false }
    }
    setBusy(null)
    setNotice({ ok: true, text: ok })
    return true
  }
  const name = STATION_NAME[station]
  // ผลสำเร็จหายเองใน 4 วินาที · ผิดพลาดค้างไว้จนกดปิด (คนหน้างานต้องเห็น)
  useEffect(() => {
    if (!notice?.ok) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  return (
    <div className="grid w-full max-w-3xl gap-4">
      {/* มือถือ: ลอยเหนือเมนูล่าง ใกล้ปุ่มที่เพิ่งกด (เลื่อนจออยู่ล่างก็เห็น · QA รอบ 4) · จอใหญ่: อยู่บนสุดตามปกติ */}
      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} className={`fixed inset-x-4 bottom-24 z-30 grid gap-2 rounded-xl px-4 py-3 font-medium shadow-lift lg:static lg:shadow-none ${notice.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          <p>{notice.text}</p>
          <div className="flex flex-wrap gap-2">
            {!notice.ok && notice.jobId && (
              <button type="button" className={secondaryBtn} onClick={() => onOpen(notice.jobId!)}>เปิดรายละเอียดงาน</button>
            )}
            {!notice.ok && <button type="button" className={secondaryBtn} onClick={() => setNotice(null)}>ปิด</button>}
          </div>
        </div>
      )}

      <section aria-labelledby="q-working" className="grid gap-2">
        <h2 id="q-working" className="text-lg font-bold">กำลังทำ <span className="font-medium text-muted">{working.length} งาน</span></h2>
        {working.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-3 text-muted">ยังไม่มีงานที่กำลังทำ · กดเริ่มงานคิวแรกด้านล่าง</p>}
        {working.map(j => (
          <QueueCard key={j.id} job={j} now={now} onOpen={() => onOpen(j.id)} badge={j.status === 'hold' ? <Pill tone="danger" dot>พักงาน</Pill> : <Pill tone="info" dot>กำลังทำ</Pill>}>
            {canPress && <WorkingActions job={j} station={station} busy={busy === j.id} run={run} onOpen={() => onOpen(j.id)} />}
          </QueueCard>
        ))}
      </section>

      <section aria-labelledby="q-waiting" className="grid gap-2">
        <h2 id="q-waiting" className="text-lg font-bold">คิวรอเริ่ม <span className="font-medium text-muted">{queue.length} งาน · เรียงตามคิว</span></h2>
        {queue.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-3 text-muted">ไม่มีงานรอที่{spaced(name).trimEnd()}</p>}
        {queue.map((j, i) => (
          <QueueCard key={j.id} job={j} now={now} onOpen={() => onOpen(j.id)} first={i === 0}
            badge={<span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${i === 0 ? 'bg-brand text-white' : 'bg-paper text-ink'}`}>คิว {i + 1}</span>}>
            <WaitingActions job={j} first={queue[0]} station={station} canPress={canPress} canInsert={canInsert && i > 0}
              busy={busy === j.id} run={run} />
          </QueueCard>
        ))}
      </section>
    </div>
  )
}

function QueueCard({ job: j, now, badge, first, onOpen, children }: {
  job: Job; now: Date; badge: ReactNode; first?: boolean; onOpen: () => void; children?: ReactNode
}) {
  const late = isOverdue(j, now)
  return (
    <article className={`grid gap-3 rounded-2xl border-2 bg-card p-4 shadow-card ${first ? 'border-brand' : late || j.status === 'hold' ? 'border-danger/40' : 'border-line'}`}>
      <button type="button" onClick={onOpen} className="grid gap-1 text-left" aria-label={`ดูรายละเอียดงาน ${j.no}`}>
        <span className="flex flex-wrap items-center gap-2">
          {badge}
          <b className="text-xl">{j.no}</b>
          {j.phase === 'sample' && <Pill tone="info">ตัวอย่าง</Pill>}
          {j.rework && <Pill tone="danger">งานแก้ {j.rework.qty} {j.unit}</Pill>}
          <IconChevronRight className="ml-auto size-5 text-muted" />
        </span>
        <span className="truncate text-base">{j.customer}</span>
        <span className="flex flex-wrap items-baseline gap-x-3 text-base text-muted">
          <span>{j.product} · <b className="text-ink">{j.qty.toLocaleString('th-TH')}</b> {j.unit}</span>
          <span className="ml-auto"><DueLabel job={j} now={now} /></span>
        </span>
        {j.holdReason && <span className="text-base font-medium text-danger">สาเหตุ: {j.holdReason}</span>}
      </button>
      {children}
    </article>
  )
}

type Run = (job: Job, steps: [string, Record<string, unknown>][], ok: string) => Promise<boolean>

function WorkingActions({ job: j, station, busy, run, onOpen }: { job: Job; station: StationCode; busy: boolean; run: Run; onOpen: () => void }) {
  const [mode, setMode] = useState<'finish' | 'hold' | null>(null)
  const [reason, setReason] = useState('')
  // ชื่อสถานีที่ลงท้ายอังกฤษ (QC + Packing) ต้องเว้นวรรคก่อนคำไทย
  const name = spaced(STATION_NAME[station]).trimStart()
  if (j.status === 'hold') {
    return station === 'sew'
      ? <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run(j, [['resume_sewing', {}]], `${j.no} เย็บต่อแล้ว`)}>แก้แล้ว เย็บต่อ</button>
      : <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run(j, [['close_issue', { p_note: null }]], `${j.no} แก้แล้ว · ทำต่อได้`)}>แก้แล้ว ทำต่อ</button>
  }
  if (mode === 'hold') {
    // เย็บพักผ่านรายงานปัญหาเย็บ (บันทึกที่สถานีเย็บ) · สถานีอื่นเปิดปัญหาตามปกติ
    const steps: [string, Record<string, unknown>][] = station === 'sew'
      ? [['report_sewing_issue', { p_reason: reason.trim(), p_pause: true }]]
      : [['open_issue', { p_reason: reason.trim() }]]
    return (
      <div className="grid gap-2 rounded-xl bg-danger-soft p-3">
        <label className="grid gap-1 font-semibold text-danger">สาเหตุที่พัก (ต้องกรอก)
          <input value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} placeholder="เช่น ผ้าไม่พอ ใบมีดทื่อ" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || !reason.trim()} className={dangerBtn}
            onClick={async () => { if (await run(j, steps, `${j.no} พักงานแล้ว · เวลาที่พักไม่นับเป็นเวลาทำงาน`)) { setMode(null); setReason('') } }}>
            {reason.trim() ? 'บันทึกพักงาน' : 'กรอกสาเหตุก่อน'}
          </button>
          <button type="button" disabled={busy} className={secondaryBtn} onClick={() => { setMode(null); setReason('') }}>ยกเลิก</button>
        </div>
      </div>
    )
  }
  // QC ต้องบันทึกจำนวนผ่าน/ส่งแก้ก่อน → ทำในรายละเอียดงาน
  if (station === 'qc_pack' && j.phase !== 'sample') {
    return (
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <button type="button" className={primaryBtn} onClick={onOpen}>บันทึกผล QC / Packing</button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode('hold')}>พักงาน</button>
      </div>
    )
  }
  const finishFn = station === 'sew' ? 'finish_sewing' : 'finish_station'
  return mode === 'finish' ? (
    <div className="grid gap-2 rounded-xl bg-paper p-3">
      <p className="font-semibold">ยืนยัน {j.no} {name}เสร็จทั้งก้อน? งานจะส่งต่อสถานีถัดไป</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} className={okBtn}
          onClick={async () => { if (await run(j, [[finishFn, {}]], `${j.no} ${name}เสร็จ · ส่งต่อแล้ว`)) setMode(null) }}>{busy ? 'กำลังบันทึก…' : 'ยืนยัน'}</button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode(null)}>ยกเลิก</button>
      </div>
    </div>
  ) : (
    <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
      <button type="button" disabled={busy} className={okBtn} onClick={() => setMode('finish')}><IconCheck className="size-5" />{name}เสร็จ</button>
      <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode('hold')}>พักงาน</button>
    </div>
  )
}

function WaitingActions({ job: j, first, station, canPress, canInsert, busy, run }: {
  job: Job; first: Job; station: StationCode; canPress: boolean; canInsert: boolean; busy: boolean; run: Run
}) {
  const [mode, setMode] = useState<'skip' | 'insert' | null>(null)
  const [reason, setReason] = useState('')
  const isFirst = first.id === j.id
  const name = spaced(STATION_NAME[station]).trimEnd()
  const noFilm = station === 'dtf_press' && !j.film?.received
  const startLabel = j.phase === 'sample' ? `เริ่ม${name} (ตัวอย่าง)` : `เริ่ม${name}`

  if (mode) {
    const skip = mode === 'skip'
    return (
      <div className="grid gap-2 rounded-xl bg-warn-soft p-3">
        <p className="flex items-start gap-2 font-semibold text-warn">
          <IconAlert className="mt-0.5 size-5 shrink-0" />
          {skip ? `งานนี้ยังไม่ถึงคิว (คิวแรกคือ ${first.no}) · ใส่เหตุผลที่ต้องเริ่มก่อน` : `แทรก ${j.no} เป็นคิวแรก ก่อน ${first.no} · ใส่เหตุผล`}
        </p>
        <input value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} aria-label="เหตุผล"
          placeholder={skip ? 'เช่น ผ้างานคิวแรกยังไม่มา' : 'เช่น ลูกค้าเลื่อนวันส่งเร็วขึ้น'} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || !reason.trim()} className={skip ? dangerBtn : primaryBtn}
            onClick={async () => {
              const ok = skip
                ? await run(j, [['start_in_queue', { p_reason: reason.trim() }]], `เริ่ม ${j.no} ก่อนคิวแล้ว · บันทึกเหตุผลในประวัติงาน`)
                : await run(j, [['move_job_ahead', { p_before: first.id, p_reason: reason.trim() }]], `แทรก ${j.no} เป็นคิวแรกแล้ว`)
              if (ok) { setMode(null); setReason('') }
            }}>
            {!reason.trim() ? 'ใส่เหตุผลก่อน' : skip ? 'บันทึกและเริ่ม' : 'แทรกเป็นคิวแรก'}
          </button>
          <button type="button" disabled={busy} className={secondaryBtn} onClick={() => { setMode(null); setReason('') }}>ยกเลิก</button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {canPress && (noFilm
        ? <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn sm:col-span-2">เริ่มไม่ได้ · ยังไม่ได้รับ{filmLabel(j.route)} (แอดมินบันทึกเมื่อได้รับ)</p>
        : isFirst
          ? <button type="button" disabled={busy} className={`${primaryBtn} min-h-14 text-lg sm:col-span-2`}
              onClick={() => void run(j, [['start_in_queue', { p_reason: null }]], `เริ่ม ${j.no} แล้ว`)}>{busy ? 'กำลังเริ่ม…' : startLabel}</button>
          : <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode('skip')}>เริ่มก่อนคิว</button>
      )}
      {canInsert && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode('insert')}>แทรกเป็นคิวแรก (งานด่วน)</button>}
    </div>
  )
}
