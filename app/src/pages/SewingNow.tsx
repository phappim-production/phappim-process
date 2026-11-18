import { useId, useState, type ReactNode } from 'react'
import { Card, CardHeader, DueLabel, Pill } from '../components/ui'
import { requiredThai } from '../components/forms'
import { IconCheck, IconSewing } from '../components/icons'
import { type Job } from '../proto/model'
import { type Machine } from '../proto/sewing'

type Result = { ok: true; text: string } | { ok: false; reason: string }
export type SewActions = {
  report: (jobId: string, reason: string, pause: boolean) => Promise<Result>
  resume: (jobId: string) => Promise<Result>
  finish: (jobId: string) => Promise<Result>
}

const secondaryButton = 'min-h-12 rounded-xl border border-line px-4 font-semibold text-brand hover:bg-brand-soft'
const finishButton = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ok px-4 font-semibold text-white hover:opacity-90'
// งานที่พักอยู่มีปุ่มเดียวคือเย็บต่อ จึงต้องเด่นเป็นปุ่มหลัก
const resumeButton = 'min-h-12 rounded-xl bg-info px-5 font-semibold text-white hover:opacity-90'

export function SewingNow({ jobs, machines, now, onOpen, actions }: {
  jobs: Job[]; machines: Machine[]; now: Date; onOpen: (id: string) => void
  actions?: SewActions
}) {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [dialog, setDialog] = useState<{ type: 'report' | 'finish'; job: Job } | null>(null)
  const [error, setError] = useState('')
  // รอคำตอบจากฐานข้อมูล = ปิดปุ่มไว้ กันกดซ้ำตอนเน็ตช้า
  const [busy, setBusy] = useState(false)
  const list = jobs
    .filter(j => j.station === 'sew' && (j.status === 'doing' || j.status === 'hold'))
    .sort((a, b) => Number(b.status === 'hold') - Number(a.status === 'hold') || a.due.getTime() - b.due.getTime())

  function show(type: 'report' | 'finish', job: Job) {
    setError('')
    setDialog({ type, job })
  }

  async function submit(pending: Promise<Result>) {
    setBusy(true)
    const result = await pending
    setBusy(false)
    if (result.ok) {
      setNotice({ ok: true, text: result.text })
      setDialog(null)
    } else {
      setError(result.reason)
    }
  }

  return (
    <Card>
      <CardHeader icon={IconSewing} title={list.length ? `งานระหว่างเย็บ ${list.length} งาน` : 'ยังไม่มีงานระหว่างเย็บ'} />
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={`mx-5 mb-3 rounded-xl px-3 py-2 font-medium ${notice.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          {notice.text}
        </p>
      )}
      {list.length > 0 && (
        <ol className="divide-y divide-line border-t border-line">
          {list.map(job => {
            const codes = machines.filter(m => m.jobId === job.id).map(m => m.code).sort()
            const held = job.status === 'hold'
            const report = job.sewingReports?.at(-1)
            return (
              <li key={job.id} className="grid grid-cols-[minmax(0,1fr)] gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <button type="button" onClick={() => onOpen(job.id)} className="min-h-12 min-w-0 text-left">
                  <span className="flex flex-wrap items-center gap-2">
                    <b>{job.no}</b>
                    <Pill tone={held ? 'danger' : 'info'} dot>{held ? 'พักงาน' : 'กำลังเย็บ'}</Pill>
                    {job.phase === 'sample' && <Pill tone="neutral">ตัวอย่าง</Pill>}
                    {job.rework && <Pill tone="danger">งานแก้</Pill>}
                    <span className="text-sm"><DueLabel job={job} now={now} /></span>
                  </span>
                  <span className="block text-sm text-muted">{job.customer} · {job.product} {job.qty.toLocaleString('th-TH')} {job.unit}</span>
                  {codes.length > 0 && <span className="block text-sm text-muted">จักร {codes.join(' · ')}</span>}
                  {held && job.holdReason
                    ? <span className="block break-words font-medium text-danger">{job.holdReason}</span>
                    : report && <span className="block break-words text-sm text-muted">รายงานล่าสุด: {report.reason}</span>}
                </button>
                {actions && (
                  <div className="flex flex-wrap gap-2">
                    {held ? (
                      <button type="button" className={resumeButton} disabled={busy} onClick={async () => {
                        setBusy(true)
                        const result = await actions.resume(job.id)
                        setBusy(false)
                        setNotice(result.ok ? { ok: true, text: result.text } : { ok: false, text: result.reason })
                      }}>{busy ? 'กำลังบันทึก…' : 'เย็บต่อ'}</button>
                    ) : (
                      <>
                        <button type="button" className={secondaryButton} onClick={() => show('report', job)}>รายงานปัญหา</button>
                        <button type="button" className={finishButton} onClick={() => show('finish', job)}>
                          <IconCheck className="size-5" />เย็บเสร็จ
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {dialog && actions && (
        <Dialog title={`${dialog.type === 'finish' ? 'ยืนยันเย็บเสร็จ' : 'รายงานปัญหา'} ${dialog.job.no}`} onClose={() => setDialog(null)}>
          {dialog.type === 'report' ? (
            <ReportForm error={error} busy={busy} onCancel={() => setDialog(null)}
              onSave={(reason, pause) => void submit(actions.report(dialog.job.id, reason, pause))} />
          ) : (
            <>
              <p className="mt-3">ยืนยันว่าเย็บงานครบแล้ว ระบบจะส่งงานให้ QC + Packing และคืนจักรให้งานถัดไป</p>
              {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
              <div className="mt-4 grid gap-2">
                <button type="button" className={finishButton} disabled={busy} onClick={() => void submit(actions.finish(dialog.job.id))}>
                  {busy ? 'กำลังบันทึก…' : 'ยืนยันเย็บเสร็จ'}
                </button>
                <button type="button" className={secondaryButton} onClick={() => setDialog(null)}>ยกเลิก</button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </Card>
  )
}

function ReportForm({ error, busy, onCancel, onSave }: {
  error: string; busy: boolean; onCancel: () => void; onSave: (reason: string, pause: boolean) => void
}) {
  const [reason, setReason] = useState('')
  const [pause, setPause] = useState(false)
  return (
    <form className="mt-3 grid gap-3" onSubmit={event => { event.preventDefault(); onSave(reason, pause) }}>
      <label className="grid gap-1 font-medium">ปัญหาที่พบ
        <textarea autoFocus {...requiredThai('กรุณาพิมพ์ปัญหาที่พบก่อนบันทึก')} rows={3} value={reason} onChange={event => setReason(event.target.value)}
          placeholder="เช่น ตะเข็บข้าม ต้องตรวจการตั้งจักร" className="w-full rounded-xl border border-line px-3 py-2" />
      </label>
      <label className="flex min-h-12 items-center gap-2">
        <input type="checkbox" checked={pause} onChange={event => setPause(event.target.checked)} className="size-5 accent-brand" />
        พักงานไว้ก่อน
      </label>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="min-h-12 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-60">
        {busy ? 'กำลังบันทึก…' : pause ? 'บันทึกและพักงาน' : 'บันทึกรายงาน'}
      </button>
      <button type="button" className={secondaryButton} onClick={onCancel}>ยกเลิก</button>
    </form>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId()
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5 shadow-lift">
        <h3 id={id} className="flex items-center gap-2 text-xl font-bold text-brand"><IconSewing className="size-6 shrink-0" />{title}</h3>
        {children}
      </div>
    </div>
  )
}
