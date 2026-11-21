import { useEffect, useRef, useState, type ReactNode } from 'react'
import { OUTSIDE_START_BLOCK, SLA_LABEL, STATION_NAME, byQueue, filmLabel, isOutLate, isOverdue, waitingAt, type Job, type StationCode } from '../proto/model'
import { spaced } from '../proto/format'
import { DueLabel, MockupThumb, Pill } from '../components/ui'
import { dangerBtn, fieldClass, okBtn, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconAlert, IconCheck, IconChevronRight } from '../components/icons'
import { scrollToDelayReport } from './delayReport'
import { canCloseIssue, type EmployeeRole } from '../auth/access'
import { TONE } from '../components/tone'
import { Tr } from '../i18n/Tr'
import { useT, type Vars, type Word } from '../i18n/lang'

export type QueueCall = (name: string, args: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; reason: string }>

// เริ่มคิวหลังได้แต่ต้องใส่เหตุผล · start_in_queue ตรวจคิว + บันทึกเหตุผล + เริ่ม ในธุรกรรมเดียว
export function StationQueue({ station, jobs, role, myStations = [], machines, onSewStart, now, call, onOpen }: {
  station: StationCode; jobs: Job[]; role: EmployeeRole; myStations?: StationCode[]; onSewStart?: (jobId: string, noted?: boolean) => void; machines?: { used: Job[]; total: number; full: boolean } | null; now: Date; call: QueueCall; onOpen: (id: string) => void
}) {
  const floor = role === 'production' || role === 'supervisor' || role === 'owner'
  const canPress = floor || (role === 'qc' && station === 'qc_pack') || (role === 'staff' && myStations.includes(station))
  const canInsert = floor || role === 'manager'
  const working = jobs.filter(j => (j.phase === 'sample' || j.phase === 'production') && j.station === station && (j.status === 'doing' || j.status === 'hold')).sort(byQueue)
  const queue = waitingAt(jobs, station)
  // งานที่บริษัทภายนอกกำลังทำสถานีนี้ (รวมงานที่ส่งออกหลายสถานีในรอบเดียว)
  const outside = jobs.filter(j => j.status === 'out' && j.out?.stations.includes(station)).sort((a, b) => a.out!.backAt.getTime() - b.out!.backAt.getTime())
  const [notice, setNotice] = useState<{ ok: boolean; text: Word; jobId?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const running = useRef(false)

  // กดรัวในเฟรมเดียวกันก่อนปุ่มถูกปิด ต้องกันด้วย ref ไม่ใช่ state
  async function run(job: Job, steps: [string, Record<string, unknown>][], ok: Word) {
    if (running.current) return false
    running.current = true
    try { return await runSteps(job, steps, ok) } finally { running.current = false }
  }
  async function runSteps(job: Job, steps: [string, Record<string, unknown>][], ok: Word) {
    setBusy(job.id)
    setNotice(null)
    for (const [name, args] of steps) {
      const r = await call(name, { p_job: job.id, ...args })
      if (!r.ok) { setBusy(null); setNotice({ ok: false, text: { th: '{no}: {reason}', vars: { no: job.no, reason: { th: r.reason } } }, jobId: job.id }); return false }
    }
    setBusy(null)
    setNotice({ ok: true, text: ok })
    return true
  }
  const name = STATION_NAME[station]
  const t = useT()
  // ผลสำเร็จหายเองใน 4 วินาที · ผิดพลาดค้างไว้จนกดปิด (คนหน้างานต้องเห็น)
  useEffect(() => {
    if (!notice?.ok) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  return (
    <div className="grid w-full gap-4">
      {/* มือถือ: ลอยเหนือเมนูล่างใกล้ปุ่มที่เพิ่งกด · ข้อความสำเร็จกดทะลุได้ ไม่บังปุ่มงานถัดไป */}
      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} className={`fixed inset-x-4 bottom-24 z-30 grid gap-2 rounded-xl px-4 py-3 font-medium shadow-lift lg:static lg:shadow-none ${notice.ok ? 'pointer-events-none bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          <p><Tr th={notice.text.th} vars={notice.text.vars} /></p>
          <div className="flex flex-wrap gap-2">
            {!notice.ok && notice.jobId && (
              <button type="button" className={secondaryBtn} onClick={() => onOpen(notice.jobId!)}><Tr th="เปิดรายละเอียดงาน" /></button>
            )}
            {!notice.ok && <button type="button" className={secondaryBtn} onClick={() => setNotice(null)}><Tr th="ปิด" /></button>}
          </div>
        </div>
      )}

      <div className={`grid items-start gap-4 ${outside.length ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        <section aria-labelledby="q-working" className="grid gap-2">
          <SectionHead id="q-working" title="กำลังทำ" count={[t('{n} งาน', { n: working.filter(j => j.status === 'doing').length }), working.some(j => j.status === 'hold') ? t('พักงาน {n} งาน', { n: working.filter(j => j.status === 'hold').length }) : ''].filter(Boolean).join(' · ')} />
          {working.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-3 text-muted">{t(station === 'outside' ? 'สถานีนี้ไม่มีงานทำในโรงงาน · แอดมินส่งออกจากรายละเอียดงาน' : 'ยังไม่มีงานที่กำลังทำ · กดเริ่มงานคิว 1 ในคิวรอเริ่ม')}</p>}
          {working.map(j => (
            <QueueCard key={j.id} job={j} now={now} station={station} onOpen={() => onOpen(j.id)} badge={j.status === 'hold' ? <Pill tone="danger" dot>{t('พักงาน')}</Pill>
              : j.sla ? <Pill tone={SLA_LABEL[j.sla].tone} dot>{t(SLA_LABEL[j.sla].text)}</Pill> : <Pill tone="info" dot>{t('กำลังทำ')}</Pill>}>
              {j.status === 'hold'
                ? <HoldActions job={j} station={station} canResume={canCloseIssue(role, station)} busy={busy === j.id} run={run} />
                : canPress && <WorkingActions job={j} station={station} busy={busy === j.id} run={run} onOpen={() => onOpen(j.id)} />}
            </QueueCard>
          ))}
        </section>

        <section aria-labelledby="q-waiting" className="grid gap-2">
          <SectionHead id="q-waiting" title="คิวรอเริ่ม" count={t('{n} งาน · เรียงตามคิว', { n: queue.length })} />
          {queue.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-3 text-muted">{t('ไม่มีงานรอที่{station}', { station: { th: spaced(name).trimEnd() } })}</p>}
          {queue.map((j, i) => (
            <QueueCard key={j.id} job={j} now={now} station={station} onOpen={() => onOpen(j.id)} first={i === 0}
              badge={<span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${i === 0 ? 'bg-brand text-white' : 'bg-paper text-ink'}`}>{t('คิว {n}', { n: i + 1 })}</span>}>
              <WaitingActions job={j} first={queue[0]} station={station} canPress={canPress}
              onSewStart={onSewStart}
              full={machines?.full ? { th: 'เครื่องเต็ม {used}/{total} ({jobs}) · รอให้งานเสร็จ หรือพักงานที่ติดปัญหาก่อน', vars: { used: machines.used.length, total: machines.total, jobs: machines.used.map(u => u.no).join(', ') } } : undefined} canInsert={canInsert && i > 0}
                busy={busy === j.id} run={run} />
            </QueueCard>
          ))}
        </section>
        {outside.length > 0 && (
          <section aria-labelledby="q-outside" className="grid gap-2">
            <SectionHead id="q-outside" title="ส่งออกข้างนอก" count={t('{n} งาน · แอดมินรับของกลับแล้วจะเข้าคิว', { n: outside.length })} />
            {outside.map(j => {
              const late = isOutLate(j, now)
              return (
                <QueueCard key={j.id} job={j} now={now} station={station} onOpen={() => onOpen(j.id)} badge={<Pill tone={late ? 'danger' : 'info'} dot>{t('ข้างนอก')}</Pill>}>
                  <p className={`rounded-xl px-3 py-2 ${late ? 'bg-danger-soft font-semibold text-danger' : 'bg-info-soft text-info'}`}>
                    <Tr th="{vendor} · {stations} · คาดว่าของถึง {at} น." vars={{ vendor: j.out!.vendor, stations: j.out!.stations.map(s => t(STATION_NAME[s])).join(' → '), at: j.out!.backAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }} />{late ? t(' · เลยกำหนด') : ''}
                  </p>
                </QueueCard>
              )
            })}
          </section>
        )}

      </div>
    </div>
  )
}

function SectionHead({ id, title, count }: { id: string; title: string; count: string }) {
  return (
    <div className="grid">
      <h2 id={id} className="text-lg font-bold"><Tr inline th={title} /></h2>
      <p className="text-sm text-muted">{count}</p>
    </div>
  )
}

function QueueCard({ job: j, now, badge, first, onOpen, children, station }: {
  job: Job; now: Date; badge: ReactNode; first?: boolean; onOpen: () => void; children?: ReactNode; station?: StationCode
}) {
  const spec = j.specSheet && station && !j.specSheet.acked.includes(station) ? j.specSheet : null
  const late = isOverdue(j, now)
  const t = useT()
  return (
    <article className={`grid gap-3 rounded-2xl border-2 bg-card p-4 shadow-card ${first ? 'border-brand'
      : late || j.status === 'hold' || j.sla === 'over' || j.sla === 'report' ? 'border-danger/40' : j.sla === 'warn' ? 'border-warn/50' : 'border-line'}`}>
      <button type="button" onClick={onOpen} className="flex min-w-0 items-start gap-3 text-left" aria-label={t('ดูรายละเอียดงาน {no}', { no: j.no })}>
        <MockupThumb job={j} size="md" />
        <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex flex-wrap items-center gap-2">
          {badge}
          <b className="text-xl">{j.no}</b>
          {j.phase === 'sample' && <Pill tone="info">{t('ตัวอย่าง')}</Pill>}
          {j.rework && <Pill tone="danger">{t('งานแก้ {qty} {unit}', { qty: j.rework.qty, unit: { th: j.unit } })}</Pill>}
          {spec && <Pill tone={spec.rev > 1 ? 'danger' : 'warn'}>{spec.rev > 1 ? t('สเปกเปลี่ยน ฉบับ {rev} · ยังไม่รับทราบ', { rev: spec.rev }) : t('มีสเปกกำกับ · ยังไม่รับทราบ')}</Pill>}
          <IconChevronRight className="ml-auto size-5 text-muted" />
        </span>
        <span className="truncate text-base">{j.customer}</span>
        <span className="flex flex-wrap items-baseline gap-x-3 text-base text-muted">
          <span>{j.product} · <span className="whitespace-nowrap"><b className="text-ink">{j.qty.toLocaleString('th-TH')}</b> {t(j.unit)}</span></span>
          <span className="ml-auto"><DueLabel job={j} now={now} /></span>
        </span>
        {j.holdReason && <span className="text-base font-medium text-danger"><Tr inline th="สาเหตุ: {reason}" vars={{ reason: j.holdReason }} /></span>}
        </span>
      </button>
      {children}
    </article>
  )
}

type Run = (job: Job, steps: [string, Record<string, unknown>][], ok: Word) => Promise<boolean>
const w = (th: string, vars?: Vars): Word => ({ th, vars })

// ปิดปัญหาได้เฉพาะฝ่ายผลิต / ผู้บริหาร · บทบาทอื่นเห็นว่าต้องรอใคร
function HoldActions({ job: j, station, canResume, busy, run }: { job: Job; station: StationCode; canResume: boolean; busy: boolean; run: Run }) {
  if (!canResume) {
    return <p className={`rounded-xl px-3 py-2 font-medium ${TONE.warn.soft}`}>
      <Tr th={station === 'sew' ? 'รอฝ่ายผลิตกด "แก้แล้ว เย็บต่อ" (ต้องจ่ายจักร)' : 'รอผู้บริหารหรือฝ่ายผลิตกด "แก้แล้ว ทำต่อ"'} />
    </p>
  }
  return station === 'sew'
    ? <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run(j, [['resume_sewing', {}]], w('{no} เย็บต่อแล้ว', { no: j.no }))}><Tr th="แก้แล้ว เย็บต่อ" /></button>
    : <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run(j, [['close_issue', { p_note: null }]], w('{no} แก้แล้ว · ถ้าเครื่องเต็ม งานกลับเข้าคิวรอเริ่ม', { no: j.no }))}><Tr th="แก้แล้ว ทำต่อ" /></button>
}

function WorkingActions({ job: j, station, busy, run, onOpen }: { job: Job; station: StationCode; busy: boolean; run: Run; onOpen: () => void }) {
  const [mode, setMode] = useState<'finish' | 'hold' | null>(null)
  const [reason, setReason] = useState('')
  const t = useT()
  // ชื่อสถานีที่ลงท้ายอังกฤษ (QC + Packing) ต้องเว้นวรรคก่อนคำไทย
  const name = spaced(STATION_NAME[station]).trimStart()
  if (mode === 'hold') {
    // เย็บพักผ่านรายงานปัญหาเย็บ (บันทึกที่สถานีเย็บ) · สถานีอื่นเปิดปัญหาตามปกติ
    const steps: [string, Record<string, unknown>][] = station === 'sew'
      ? [['report_sewing_issue', { p_reason: reason.trim(), p_pause: true }]]
      : [['open_issue', { p_reason: reason.trim() }]]
    return (
      <div className="grid gap-2 rounded-xl bg-danger-soft p-3">
        <label className="grid gap-1 font-semibold text-danger"><Tr th="สาเหตุที่พัก (ต้องกรอก)" />
          <input value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} placeholder={t('เช่น ผ้าไม่พอ ใบมีดทื่อ')} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || !reason.trim()} className={dangerBtn}
            onClick={async () => { if (await run(j, steps, w('{no} พักงานแล้ว · เวลาที่พักไม่นับเป็นเวลาทำงาน', { no: j.no }))) { setMode(null); setReason('') } }}>
            <Tr th={reason.trim() ? 'บันทึกพักงาน' : 'กรอกสาเหตุก่อน'} />
          </button>
          <button type="button" disabled={busy} className={secondaryBtn} onClick={() => { setMode(null); setReason('') }}><Tr th="ยกเลิก" /></button>
        </div>
      </div>
    )
  }
  // QC ต้องบันทึกจำนวนผ่าน/ส่งแก้ก่อน → ทำในรายละเอียดงาน
  if (station === 'qc_pack' && j.phase !== 'sample') {
    return (
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <button type="button" className={primaryBtn} onClick={onOpen}><Tr th="บันทึกผล QC / Packing" /></button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode('hold')}><Tr th="พักงาน" /></button>
      </div>
    )
  }
  const finishFn = station === 'sew' ? 'finish_sewing' : 'finish_station'
  return mode === 'finish' ? (
    <div className="grid gap-2 rounded-xl bg-paper p-3">
      <p className="font-semibold"><Tr th="ยืนยัน {no} {station}เสร็จทั้งก้อน? งานจะส่งต่อสถานีถัดไป" vars={{ no: j.no, station: { th: name } }} /></p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} className={okBtn}
          onClick={async () => { if (await run(j, [[finishFn, finishFn === 'finish_station' ? { p_station: station } : {}]], w('{no} {station}เสร็จ · ส่งต่อแล้ว', { no: j.no, station: { th: name } }))) setMode(null) }}><Tr th={busy ? 'กำลังบันทึก…' : 'ยืนยัน'} /></button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode(null)}><Tr th="ยกเลิก" /></button>
      </div>
    </div>
  ) : (
    <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
      {j.sla === 'report'
        ? <button type="button" disabled={busy} className={dangerBtn} onClick={() => { onOpen(); scrollToDelayReport() }}><IconAlert className="size-5" /><Tr th="เกินเวลา · ส่งรายงานปัญหาก่อนกดเสร็จ" /></button>
        : <button type="button" disabled={busy} className={okBtn} onClick={() => setMode('finish')}><IconCheck className="size-5" /><Tr th="{station}เสร็จ" vars={{ station: { th: name } }} /></button>}
      <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode('hold')}><Tr th="พักงาน" /></button>
    </div>
  )
}

function WaitingActions({ job: j, first, station, canPress, canInsert, busy, run, full, onSewStart }: {
  job: Job; first: Job; station: StationCode; canPress: boolean; canInsert: boolean; busy: boolean; run: Run; full?: Word
  onSewStart?: (jobId: string, noted?: boolean) => void
}) {
  const [mode, setMode] = useState<'skip' | 'insert' | null>(null)
  const [reason, setReason] = useState('')
  const isFirst = first.id === j.id
  const t = useT()
  const st: Word = { th: spaced(STATION_NAME[station]).trimEnd() }
  const noFilm = station === 'dtf_press' && !j.film?.received
  const startLabel = j.phase === 'sample' ? w('เริ่ม{station} (ตัวอย่าง)', { station: st }) : w('เริ่ม{station}', { station: st })
  const sew = station === 'sew'
  const canStart = canPress && (!sew || !!onSewStart)

  if (mode) {
    const skip = mode === 'skip'
    return (
      <div className="grid gap-2 rounded-xl bg-warn-soft p-3">
        <p className="flex items-start gap-2 font-semibold text-warn">
          <IconAlert className="mt-0.5 size-5 shrink-0" />
          {skip ? <Tr th="งานนี้ยังไม่ถึงคิว (คิวแรกคือ {first}) · ใส่เหตุผลที่ต้องเริ่มก่อน" vars={{ first: first.no }} /> : <Tr th="แทรก {no} เป็นคิวแรก ก่อน {first} · ใส่เหตุผล" vars={{ no: j.no, first: first.no }} />}
        </p>
        <input value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} aria-label={t('เหตุผล')}
          placeholder={t(skip ? 'เช่น ผ้างานคิวแรกยังไม่มา' : 'เช่น ลูกค้าเลื่อนวันส่งเร็วขึ้น')} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || !reason.trim()} className={skip ? dangerBtn : primaryBtn}
            onClick={async () => {
              const ok = skip && sew
                ? await run(j, [['note_queue_skip', { p_reason: reason.trim() }]], w('บันทึกเหตุผลเริ่ม {no} ก่อนคิวแล้ว · เลือกจักรต่อ', { no: j.no }))
                : skip
                ? await run(j, [['start_in_queue', { p_reason: reason.trim() }]], w('เริ่ม {no} ก่อนคิวแล้ว · บันทึกเหตุผลในประวัติงาน', { no: j.no }))
                : await run(j, [['move_job_ahead', { p_before: first.id, p_reason: reason.trim() }]], w('แทรก {no} เป็นคิวแรกแล้ว', { no: j.no }))
              if (ok) { setMode(null); setReason(''); if (skip && sew) onSewStart?.(j.id, true) }
            }}>
            <Tr th={!reason.trim() ? 'ใส่เหตุผลก่อน' : skip ? (sew ? 'บันทึกแล้วเลือกจักร' : 'บันทึกและเริ่ม') : 'แทรกเป็นคิวแรก'} />
          </button>
          <button type="button" disabled={busy} className={secondaryBtn} onClick={() => { setMode(null); setReason('') }}><Tr th="ยกเลิก" /></button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {canStart && (station === 'outside'
        ? <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn sm:col-span-2"><Tr th={OUTSIDE_START_BLOCK} /></p>
        : full
        ? <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn sm:col-span-2"><Tr th="เริ่มไม่ได้ · {why}" vars={{ why: full }} /></p>
        : noFilm
        ? <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn sm:col-span-2"><Tr th="เริ่มไม่ได้ · ยังไม่ได้รับ{film} (แอดมินบันทึกเมื่อได้รับ)" vars={{ film: { th: filmLabel(j.route) } }} /></p>
        : isFirst
          ? sew
            ? <button type="button" disabled={busy} className={`${primaryBtn} min-h-14 text-lg sm:col-span-2`} onClick={() => onSewStart?.(j.id)}><Tr th="เลือกจักรแล้วเริ่มเย็บ" /></button>
            : <button type="button" disabled={busy} className={`${primaryBtn} min-h-14 text-lg sm:col-span-2`}
              onClick={() => void run(j, [['start_in_queue', { p_reason: null }]], w('เริ่ม {no} แล้ว', { no: j.no }))}>{busy ? <Tr th="กำลังเริ่ม…" /> : <Tr th={startLabel.th} vars={startLabel.vars} />}</button>
          : <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode('skip')}><Tr th="เริ่มก่อนคิว" /></button>
      )}
      {canInsert && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setMode('insert')}><Tr th="แทรกเป็นคิวแรก (งานด่วน)" /></button>}
    </div>
  )
}
