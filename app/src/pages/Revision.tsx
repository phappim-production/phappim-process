import { useState } from 'react'
import { STATION_NAME, type Job } from '../proto/model'
import { signaturesForForm } from '../data/customerSignature'
import { loadFormData } from '../data/jobForm'
import { INBOX_KEY } from '../data/confirmationDrafts'
import { openFormWindow } from '../lib/install'
import { needsRevisionAck, revisionShort, revisionWhen } from '../data/revisions'
import { Pill } from '../components/ui'
import { primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconAlert, IconCheck } from '../components/icons'
import { TONE } from '../components/tone'
import { Tr } from '../i18n/Tr'
import { useT, type Word } from '../i18n/lang'

const CONFIRMATION_FORM = '/confirmation'

async function openConfirmationView(job: Job, extra: { line?: true }): Promise<string | null> {
  // เปิดหน้าต่างก่อนรอข้อมูล ไม่อย่างนั้นเบราว์เซอร์บนมือถือจะบล็อกป๊อปอัป
  const win = openFormWindow()
  const [r, sigs] = await Promise.all([loadFormData(job.id), signaturesForForm(job.id)])
  if (!r.ok) { win?.close(); return r.reason }
  const rv = job.revision
  const payload = { ...r.data, view: true, ...extra, ...sigs, ...(rv ? { revision: { rev: rv.rev, at: revisionWhen(rv.at), by: rv.by, fields: rv.fields } } : {}) }
  try { window.localStorage.setItem(INBOX_KEY, JSON.stringify(payload)) } catch { win?.close(); return 'เปิดใบยืนยันไม่ได้ (พื้นที่เบราว์เซอร์เต็ม)' }
  if (win) win.location.href = CONFIRMATION_FORM
  else window.location.href = CONFIRMATION_FORM
  return null
}

export function ViewConfirmation({ job, wide }: { job: Job; wide?: boolean }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function open() {
    setError('')
    setBusy(true)
    const problem = await openConfirmationView(job, {})
    setBusy(false)
    if (problem) setError(problem)
  }
  return (
    <div className="grid gap-1">
      <button type="button" className={`${secondaryBtn} ${wide ? 'w-full' : ''}`} disabled={busy} onClick={() => void open()}>
        <Tr th={busy ? 'กำลังเปิดใบยืนยัน…' : 'ดูใบยืนยัน (ฉบับล่าสุดในระบบ)'} />
      </button>
      {error && <p role="alert" className="text-danger"><Tr th={error} /></p>}
    </div>
  )
}

export function LineSummaryButton({ job }: { job: Job }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function open() {
    setError('')
    setBusy(true)
    const problem = await openConfirmationView(job, { line: true })
    setBusy(false)
    if (problem) setError(problem)
  }
  return (
    <div className="grid gap-1">
      <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void open()}>
        {busy ? 'กำลังเตรียมสรุปงาน…' : 'สรุปงานส่งไลน์'}
      </button>
      <p className="text-sm text-muted">ข้อความจากใบยืนยัน (เลขที่ใบ ลูกค้า วันส่ง สเปก จำนวน) แก้ก่อนส่งได้ · กดส่งเข้าไลน์หรือคัดลอกไปวาง</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  )
}

type Act = (name: string, args: Record<string, unknown>, ok: Word | string) => Promise<boolean>

export function RevisionBanner({ job, canAck, busy, act }: { job: Job; canAck: boolean; busy: boolean; act: Act }) {
  const t = useT()
  const r = job.revision
  if (!r) return null
  const need = needsRevisionAck(job)
  return (
    <section aria-label={t('ใบยืนยันฉบับแก้')} className={`grid gap-2 rounded-xl p-3 ${need ? TONE.warn.soft : 'bg-paper'}`}>
      <p className="flex items-start gap-2 font-semibold">
        <IconAlert className="mt-0.5 size-5 shrink-0" />
        <Tr th="แอดมินแก้ใบยืนยันครั้งที่ {n} · {at} น." vars={{ n: r.rev, at: revisionWhen(r.at) }} />
      </p>
      {r.by && <p className="text-base">{t('โดย {name}', { name: r.by })}</p>}
      {r.summary.length > 0 && <p className="text-base break-words">{r.summary.join(' · ')}</p>}
      {r.fields.length > 0 && <p className="text-base break-words">{t('ช่องที่แก้: {fields}', { fields: r.fields.join(', ') })}</p>}
      <p className="text-sm text-muted">
        {r.acked.length ? t('รับทราบแล้ว: {list}', { list: r.acked.map(s => t(STATION_NAME[s])).join(', ') }) : t('ยังไม่มีสถานีกดรับทราบ')}
      </p>
      <ViewConfirmation job={job} wide />
      {need && (canAck
        ? <button type="button" disabled={busy} className={primaryBtn}
            onClick={() => void act('ack_confirmation_revision', { p_station: job.station }, { th: 'รับทราบใบแก้ครั้งที่ {n} แล้ว · ผลิตตามใบล่าสุด', vars: { n: r.rev } })}>
            <IconCheck className="size-5 shrink-0" /><Tr th="รับทราบใบแก้ครั้งที่ {n}" vars={{ n: r.rev }} />
          </button>
        : <p className="font-medium"><Tr th="รอสถานี{station}กดรับทราบใบแก้" vars={{ station: { th: job.station ? STATION_NAME[job.station] : '' } }} /></p>)}
    </section>
  )
}

export function RevisionPill({ job }: { job: Job }) {
  const t = useT()
  if (!job.revision) return null
  return <Pill tone={needsRevisionAck(job) ? 'warn' : 'neutral'}>{t('ใบแก้ครั้งที่ {n} · {at}', { n: job.revision.rev, at: revisionShort(job.revision.at) })}</Pill>
}
