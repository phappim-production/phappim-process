import { DELAY_REPORT_ID } from './delayReport'
import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../data/useFactoryData'
import { thaiError } from '../data/live'
import { confirmationPath, pdfProblem } from '../data/confirmation'
import { contentKey, mockupProblem, shrinkImage, uploadMockup } from '../data/mockups'
import { signFiles, uploadFile } from '../data/files'
import { etaFromDay, missingSteps, type Substep } from '../data/stationSteps'
import { DEPT_NAME, OUTSIDE_START_BLOCK, ROUTES, STATION_NAME, filmLabel, usesFilm, type Dept, type Job, type StationCode, type Vendor } from '../proto/model'
import { OutsourcePanel } from './OutsourcePanel'
import { FilePick } from '../components/FilePick'
import { relDay, slaAmount, spaced } from '../proto/format'
import { newRequestId } from '../data/requestId'
import { bookingDay } from '../proto/sewing'
import { canCancelJob, canCloseIssue, type EmployeeRole } from '../auth/access'
import { Pill } from '../components/ui'
import { dangerBtn, fieldClass, okBtn, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconAlert, IconCheck, IconClock, IconFilm, IconPackage, IconPause } from '../components/icons'

type Material = { id: number; name: string; dept: Dept; key: string | null; checked_at: string | null }
type Reason = { code: string; grp: string; name: string }
type Sla = {
  station_sla_days?: number; station_days?: number; station_warn?: boolean; station_over?: boolean; station_reported?: boolean
  segment_name?: string; segment_sla_days?: number; segment_days?: number; segment_warn?: boolean; segment_over?: boolean; segment_reported?: boolean
}
type Detail = {
  qcPassed: number; sla: Sla; filmOrdered: boolean; pdfPath: string | null
  materials: Material[]; steps: Substep[]; done: Map<string, unknown>; reasons: Reason[]
}
type Notice = { ok: boolean; text: string } | null

async function loadDetail(job: Job): Promise<Detail> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const [live, materials, station, reasons] = await Promise.all([
    supabase.from('job_live').select('visit, qc_passed, sla, dtf_film_ordered_at, confirmation_pdf_path').eq('id', job.id).single(),
    supabase.from('job_materials').select('id, name, dept, key, checked_at').eq('job_id', job.id).order('id'),
    job.station ? supabase.from('stations').select('substeps').eq('code', job.station).single() : Promise.resolve({ data: null, error: null }),
    supabase.from('reason_codes').select('code, grp, name').eq('active', true).order('sort'),
  ])
  const failed = [live, materials, station, reasons].find(r => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const row = live.data as { visit: number; qc_passed: number; sla: Sla | null; dtf_film_ordered_at: string | null; confirmation_pdf_path: string | null }
  const subs = await supabase.from('job_substeps').select('substep_key, value').eq('job_id', job.id).eq('visit', row.visit)
  if (subs.error) throw new Error(subs.error.message)
  return {
    qcPassed: row.qc_passed, sla: row.sla ?? {}, filmOrdered: !!row.dtf_film_ordered_at, pdfPath: row.confirmation_pdf_path,
    materials: materials.data as Material[],
    steps: ((station.data as { substeps: Substep[] } | null)?.substeps) ?? [],
    done: new Map((subs.data as { substep_key: string; value: unknown }[]).map(s => [s.substep_key, s.value])),
    reasons: reasons.data as Reason[],
  }
}

export function JobActions({ job: j, role, myStations = [], version, now, refresh, vendors = [] }: {
  job: Job; role: EmployeeRole; myStations?: StationCode[]; version: number; now: Date; refresh: () => Promise<void>; vendors?: Vendor[]
}) {
  const [detail, setDetail] = useState<{ shape: string; data?: Detail; error?: string } | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  // ย้ายขั้น/สถานี/สถานะ = ขั้นย่อยเดิมใช้ไม่ได้ ต้องรอโหลดใหม่ · แค่ version เปลี่ยน = แสดงของเดิมไปก่อน ไม่กระพริบ
  const shape = `${j.id}/${j.phase}/${j.station ?? ''}/${j.status ?? ''}/${j.rework ? 'r' : ''}/${j.sampleRound}`

  useEffect(() => {
    let alive = true
    loadDetail(j).then(
      data => { if (alive) setDetail({ shape, data }) },
      (e: unknown) => { if (alive) setDetail({ shape, error: thaiError(e instanceof Error ? e.message : undefined) }) },
    )
    return () => { alive = false }
  }, [shape, version, j])

  // ฟังก์ชันส่วนใหญ่รับ p_job · check_material รับ id ของรายการวัตถุดิบแทน
  async function act(name: string, args: Record<string, unknown>, ok: string, withJob = true) {
    setBusy(true)
    setNotice(null)
    const r = await rpc(name, withJob ? { p_job: j.id, ...args } : args)
    if (r.ok) await refresh()
    setBusy(false)
    setNotice(r.ok ? { ok: true, text: ok } : { ok: false, text: r.reason })
    return r.ok
  }

  const current = detail?.shape === shape ? detail : null
  const d = current?.data
  if (current?.error && !d) return <Section title="สิ่งที่ต้องทำ"><p role="alert" className="text-danger">{current.error}</p></Section>
  if (!d) return <Section title="สิ่งที่ต้องทำ"><p role="status" className="text-muted">กำลังโหลด…</p></Section>

  const owner = role === 'owner'
  const floor = role === 'production' || role === 'supervisor' || owner
  const admin = role === 'admin' || owner
  const st = j.station
  const canStation = !!st && (floor || (role === 'qc' && st === 'qc_pack') || (role === 'staff' && myStations.includes(st)))
  const inStation = (j.phase === 'sample' || j.phase === 'production') && !!st && j.status !== 'out'

  return (
    // แผงนี้อยู่ในรายละเอียดงานที่ตั้งตัวอักษรเล็ก แต่ข้อความหลักต้อง ≥ 16 px
    <div className="grid gap-4 text-base">
      {d.pdfPath ? <OpenPdf path={d.pdfPath} />
        : admin ? <AttachPdf job={j} refresh={refresh} />
        : <p className="text-muted">ยังไม่มี PDF ใบยืนยันที่ลูกค้าเซ็น (แอดมินแนบทีหลัง)</p>}
      {admin && <SetMockup job={j} refresh={refresh} />}
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={`rounded-xl px-3 py-2 font-medium ${notice.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>{notice.text}</p>
      )}
      <OutsourcePanel job={j} vendors={vendors} admin={admin} now={now} refresh={refresh} />
      {j.phase === 'done' && <Delivery job={j} admin={admin} busy={busy} now={now} act={act} />}
      {j.phase === 'materials' && <Materials materials={d.materials} role={role} busy={busy} sample={j.needsSample !== false}
        onCheck={(m, on) => act('check_material', { p_material_id: m.id, p_checked: on }, on ? `ติ๊ก "${m.name}" แล้ว` : `ยกเลิกติ๊ก "${m.name}" แล้ว`, false)} />}
      {usesFilm(j.route) && !j.film?.received && j.phase !== 'done' && (
        <Film job={j} ordered={d.filmOrdered} admin={admin} busy={busy} now={now}
          onOrder={eta => act('order_film', { p_eta: eta }, `บันทึกสั่ง${filmLabel(j.route)} · คาดว่าได้รับ ${eta}`)}
          onReceive={() => act('receive_film', {}, `บันทึกได้รับ${spaced(filmLabel(j.route))}แล้ว · เริ่มรีดฟิล์มได้`)} />
      )}
      {j.phase === 'sample_review' && (
        <SampleResult job={j} admin={admin} busy={busy}
          onSave={(pass, note, day) => act('record_sample_result', { p_pass: pass, p_note: note || null, p_customer_confirmed_at: day || null },
            pass ? 'ตัวอย่างผ่าน · งานไปผลิตจริงที่สถานีแรก' : `ตัวอย่างไม่ผ่าน · ขึ้นตัวอย่างรอบ ${j.sampleRound + 1}`)} />
      )}
      {inStation && st === 'sew' && (<>
        {(d.sla.station_over || d.sla.segment_over || d.sla.station_warn || d.sla.segment_warn) && <SlaBanner sla={d.sla} />}
        <Section title="เย็บงาน"><p className="text-muted">เริ่มเย็บ จัดการจักร และเย็บเสร็จ กดที่แท็บ <b>จักรเย็บ</b> · เกินเวลามาตรฐานให้ส่งรายงานปัญหาด้านล่างก่อนกดเย็บเสร็จ</p></Section>
        {j.phase === 'production' && canStation && <SlaReport sla={d.sla} reasons={d.reasons} busy={busy} now={now} act={act} />}
      </>)}
      {inStation && st !== 'sew' && (
        <Station job={j} detail={d} canPress={canStation} canResume={canCloseIssue(role, st)} role={role} busy={busy} now={now} act={act} />
      )}
      {canCancelJob(role) && j.phase !== 'done' && <CancelJob job={j} busy={busy} act={act} />}
    </div>
  )
}

// ส่งงานเข้าได้ก่อนลูกค้าเซ็น แล้วแนบ PDF ทีหลัง
function AttachPdf({ job, refresh }: { job: Job; refresh: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problem = pdfProblem(file)
  async function attach() {
    if (!file || problem) return
    setBusy(true)
    setError('')
    const path = confirmationPath(job.no, await contentKey(file))
    const up = await uploadFile('confirmations', path, file, 'application/pdf')
    if (!up.ok) { setBusy(false); setError(up.reason); return }
    const r = await rpc('attach_confirmation_pdf', { p_job: job.id, p_path: path })
    setBusy(false)
    if (!r.ok) { setError(r.reason); return }
    setFile(null)
    await refresh()
  }
  return (
    <div className="grid gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3">
      <p className="font-medium text-warn">ยังไม่มี PDF ใบยืนยันที่ลูกค้าเซ็น</p>
      <FilePick accept="application/pdf,.pdf" label="เลือก PDF ใบยืนยันที่ลูกค้าเซ็น" chosen={file?.name ?? ''}
        onPick={f => { setFile(f ?? null); setError('') }} />
      {file && problem && <p role="alert" className="text-danger">{problem}</p>}
      <button type="button" className={primaryBtn} disabled={!file || !!problem || busy} onClick={() => void attach()}>
        {busy ? 'กำลังแนบ PDF…' : file ? 'แนบ PDF ใบยืนยัน' : 'แนบ PDF ใบยืนยัน (เลือกไฟล์ก่อน)'}
      </button>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  )
}

function SetMockup({ job, refresh }: { job: Job; refresh: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const problem = file ? mockupProblem(file) : null
  const has = !!job.mockup
  async function save() {
    if (!file || problem) return
    setBusy(true)
    setMsg(null)
    const up = await uploadMockup(job.no, await shrinkImage(file))
    if (!up.ok) { setBusy(false); setMsg({ ok: false, text: up.reason }); return }
    const r = await rpc('set_job_mockup', { p_job: job.id, p_path: up.path })
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.reason }); return }
    setFile(null)
    setMsg({ ok: true, text: has ? 'เปลี่ยนรูปม็อคอัพแล้ว' : 'เพิ่มรูปม็อคอัพแล้ว' })
    await refresh()
  }
  return (
    <div className={`grid gap-2 rounded-xl border p-3 ${has ? 'border-line' : 'border-warn/30 bg-warn-soft'}`}>
      {!has && <p className="font-medium text-warn">งานนี้ยังไม่มีรูปม็อคอัพ · คนหน้างานจำงานจากรูป ให้เพิ่มรูป</p>}
      <FilePick accept="image/jpeg,image/png,image/webp" label={has ? 'เลือกรูปม็อคอัพใหม่' : 'เลือกรูปม็อคอัพ'} chosen={file?.name ?? ''}
        onPick={f => { setFile(f ?? null); setMsg(null) }} />
      {problem && <p role="alert" className="text-danger">{problem}</p>}
      {file && !problem && (
        <button type="button" className={has ? secondaryBtn : primaryBtn} disabled={busy} onClick={() => void save()}>
          {busy ? 'กำลังบันทึกรูป…' : has ? 'เปลี่ยนเป็นรูปนี้' : 'บันทึกรูปม็อคอัพ'}
        </button>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'font-medium text-ok' : 'text-danger'}>{msg.text}</p>}
    </div>
  )
}

// ลิงก์มีอายุ 5 นาที เพราะไฟล์ไม่เปิดสาธารณะ
function OpenPdf({ path }: { path: string }) {
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  async function open() {
    setError('')
    setLink('')
    // เปิดหน้าต่างก่อนรอลิงก์ ไม่อย่างนั้นเบราว์เซอร์บนมือถือจะบล็อกป๊อปอัป
    const win = window.open('', '_blank')
    const r = await signFiles('confirmations', [path], 300)
    const url = r.ok ? r.urls.get(path) : undefined
    if (!url) {
      win?.close()
      setError(r.ok ? 'เปิด PDF นี้ไม่ได้ (ไม่มีสิทธิ์ หรือไฟล์หาย) แจ้งแอดมินให้แนบใหม่' : r.reason)
      return
    }
    if (win) win.location.href = url
    // บางเครื่อง (แอปที่ติดตั้ง / เบราว์เซอร์ในแอปอื่น) เปิดแท็บใหม่ไม่ขึ้นเงียบๆ จึงแสดงลิงก์ให้กดเองเสมอ
    setLink(url)
  }
  return (
    <div className="grid gap-1">
      <button type="button" className={secondaryBtn} onClick={() => void open()}>เปิด PDF ใบยืนยัน</button>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center font-medium text-brand underline">
          ถ้าไฟล์ไม่เปิดขึ้นมา กดที่นี่ (ลิงก์ใช้ได้ 5 นาที)
        </a>
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  )
}

function Section({ title, icon, children, tone, id }: { title: string; icon?: ReactNode; children: ReactNode; tone?: 'danger' | 'warn'; id?: string }) {
  const border = tone === 'danger' ? 'border-danger/40' : tone === 'warn' ? 'border-warn/40' : 'border-line'
  return (
    <section id={id} className={`scroll-mt-52 rounded-2xl border bg-card p-4 shadow-card ${border}`}>
      <h3 className="mb-3 flex items-center gap-2 font-semibold">{icon}{title}</h3>
      {children}
    </section>
  )
}

function Materials({ materials, role, busy, sample, onCheck }: {
  materials: Material[]; role: EmployeeRole; busy: boolean; sample: boolean; onCheck: (m: Material, on: boolean) => void
}) {
  return (
    <Section title="เช็ควัตถุดิบ">
      <ul className="grid gap-2">
        {materials.map(m => {
          const mine = role === m.dept || role === 'owner'
          const auto = !!m.key?.endsWith('_film')
          const checked = !!m.checked_at
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
              {checked ? <IconCheck className="size-5 text-ok" /> : <IconClock className="size-5 text-warn" />}
              <span className="min-w-0 flex-1">
                <span className="block break-words">{m.name}</span>
                <span className="text-sm text-muted">{DEPT_NAME[m.dept]}{auto ? ' · ติ๊กให้เองเมื่อแอดมินบันทึกสั่งฟิล์ม' : ''}</span>
              </span>
              {!auto && mine && (
                checked
                  ? <button type="button" disabled={busy} className={secondaryBtn} onClick={() => onCheck(m, false)}>ยกเลิกติ๊ก</button>
                  : <button type="button" disabled={busy} className={okBtn} onClick={() => onCheck(m, true)}><IconCheck className="size-5" />ครบแล้ว</button>
              )}
              {!auto && !mine && !checked && <Pill tone="warn">รอ {DEPT_NAME[m.dept]}</Pill>}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-sm text-muted">ทุกฝ่ายติ๊กครบ → {sample ? 'งานไปขึ้นตัวอย่างอัตโนมัติ' : 'งานเข้าผลิตจริงอัตโนมัติ (งานนี้ไม่ขึ้นตัวอย่าง)'}</p>
    </Section>
  )
}

function Film({ job: j, ordered, admin, busy, now, onOrder, onReceive }: {
  job: Job; ordered: boolean; admin: boolean; busy: boolean; now: Date
  onOrder: (eta: string) => Promise<boolean>; onReceive: () => Promise<boolean>
}) {
  const [eta, setEta] = useState(j.film ? bookingDay(j.film.eta) : '')
  const late = j.film && bookingDay(j.film.eta) < bookingDay(now)
  const label = filmLabel(j.route)
  return (
    <Section title={label} icon={<IconFilm className="size-5" />} tone={late ? 'danger' : 'warn'}>
      <p className={late ? 'font-medium text-danger' : 'text-muted'}>
        {!ordered ? `ยังไม่ได้สั่ง${label}` : `สั่งแล้ว · คาดว่าได้รับ ${j.film ? j.film.eta.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '-'}${late ? ' (เลยกำหนดแล้ว)' : ''}`}
        {' · '}สถานีรีดฟิล์มเริ่มไม่ได้จนกว่าจะได้รับ{label}
      </p>
      {admin ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="grid gap-1 font-medium">วันคาดว่าได้รับ
            <input type="date" value={eta} onChange={e => setEta(e.target.value)} className={fieldClass} />
          </label>
          <button type="button" disabled={busy || !eta} className={`${secondaryBtn} self-end`} onClick={() => void onOrder(eta)}>
            {ordered ? 'เลื่อนวันได้รับ' : `บันทึกสั่ง${label}`}
          </button>
          {ordered && (
            <button type="button" disabled={busy} className={`${okBtn} sm:col-span-2`} onClick={() => void onReceive()}>
              <IconCheck className="size-5" />ได้รับ{spaced(label)}แล้ว
            </button>
          )}
        </div>
      ) : <p className="mt-2 text-sm text-muted">แอดมินเป็นคนบันทึกสั่งและรับ{label}</p>}
    </Section>
  )
}

function Delivery({ job: j, admin, busy, now, act }: { job: Job; admin: boolean; busy: boolean; now: Date; act: Act }) {
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState<'send' | 'undo' | null>(null)
  if (j.delivered) {
    const at = `${relDay(j.delivered.at, now)} ${j.delivered.at.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} น.`
    return (
      <Section title="จัดส่งให้ลูกค้าแล้ว" icon={<IconPackage className="size-5" />}>
        <p className="font-medium text-ok">จัดส่งแล้ว {at}{j.delivered.note && ` · ${j.delivered.note}`}</p>
        {admin && (confirm === 'undo' ? (
          <div className="mt-3 grid gap-2">
            <label className="grid gap-1 font-medium">เหตุผลที่ยกเลิก
              <input value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} placeholder="เช่น กดผิดงาน ลูกค้ายังไม่ได้รับ" />
            </label>
            <Confirm text="ยกเลิกการบันทึกจัดส่ง? งานจะกลับเป็นรอจัดส่ง" busy={busy} danger
              onYes={async () => { if (!reason.trim()) return; if (await act('undo_delivery', { p_reason: reason.trim() }, 'ยกเลิกการบันทึกจัดส่งแล้ว · งานกลับเป็นรอจัดส่ง')) { setConfirm(null); setReason('') } }}
              onNo={() => setConfirm(null)} />
            {!reason.trim() && <p className="text-sm text-warn">ใส่เหตุผลก่อนกดยืนยัน</p>}
          </div>
        ) : <button type="button" disabled={busy} className={`${secondaryBtn} mt-3`} onClick={() => setConfirm('undo')}>บันทึกผิด · ยกเลิกการจัดส่ง</button>)}
      </Section>
    )
  }
  if (!admin) return <Section title="รอจัดส่ง" icon={<IconPackage className="size-5" />}><p className="text-muted">งานเสร็จแล้ว · แอดมินเป็นคนบันทึกเมื่อส่งให้ลูกค้า</p></Section>
  return (
    <Section title="จัดส่งให้ลูกค้า" icon={<IconPackage className="size-5" />} tone="warn">
      <div className="grid gap-3">
        <label className="grid gap-1 font-medium">เลขพัสดุ / ผู้รับ / วิธีส่ง (ถ้ามี)
          <input value={note} onChange={e => setNote(e.target.value)} className={fieldClass} placeholder="เช่น Kerry KEX123456 · ลูกค้ามารับเอง" />
        </label>
        {confirm === 'send'
          ? <Confirm text={`ยืนยันว่า ${j.no} ส่งให้ลูกค้าแล้ว?`} busy={busy}
              onYes={async () => { if (await act('mark_delivered', { p_note: note.trim() || null }, `บันทึกจัดส่ง ${j.no} แล้ว`)) { setConfirm(null); setNote('') } }}
              onNo={() => setConfirm(null)} />
          : <button type="button" disabled={busy} className={okBtn} onClick={() => setConfirm('send')}><IconCheck className="size-5" />จัดส่งให้ลูกค้าแล้ว</button>}
      </div>
    </Section>
  )
}

function CancelJob({ job: j, busy, act }: { job: Job; busy: boolean; act: Act }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  if (j.status === 'out') {
    return (
      <Section title="ยกเลิกงาน">
        <button type="button" disabled className={secondaryBtn}>ยกเลิกงานนี้</button>
        <p className="mt-2 text-sm text-muted">งานอยู่ที่บริษัทภายนอก ให้แอดมินกด "รับของกลับ" ก่อน แล้วค่อยยกเลิก</p>
      </Section>
    )
  }
  return (
    <Section title="ยกเลิกงาน" tone={open ? 'danger' : undefined}>
      {open ? (
        <div className="grid gap-2">
          <label className="grid gap-1 font-medium">เหตุผลที่ยกเลิก
            <input value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} placeholder="เช่น ลูกค้ายกเลิกออเดอร์ ไม่จ่ายมัดจำ" />
          </label>
          <Confirm text={`ยกเลิกงาน ${j.no} (${j.customer})? ทุกสถานีจะหยุดทำ งานหายจากบอร์ด และย้อนกลับไม่ได้`} busy={busy} danger
            yesLabel="ยืนยันยกเลิกงาน" noLabel="ไม่ยกเลิก กลับ"
            onYes={async () => { if (!reason.trim()) return; if (await act('cancel_job', { p_reason: reason.trim() }, `ยกเลิกงาน ${j.no} แล้ว · แจ้งทุกฝ่ายในกล่องจดหมาย`)) { setOpen(false); setReason('') } }}
            onNo={() => { setOpen(false); setReason('') }} />
          {!reason.trim() && <p className="text-sm text-warn">ใส่เหตุผลก่อนกดยืนยัน</p>}
        </div>
      ) : (<>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setOpen(true)}>ยกเลิกงานนี้</button>
        <p className="mt-2 text-sm text-muted">ใช้เมื่อลูกค้ายกเลิกออเดอร์ · เฉพาะผู้บริหาร · คืนจักรและปิดปัญหาที่ค้างให้อัตโนมัติ</p>
      </>)}
    </Section>
  )
}

function SampleResult({ job: j, admin, busy, onSave }: {
  job: Job; admin: boolean; busy: boolean; onSave: (pass: boolean, note: string, day: string) => Promise<boolean>
}) {
  const [note, setNote] = useState('')
  const [day, setDay] = useState('')
  const [confirm, setConfirm] = useState<boolean | null>(null)
  if (!admin) return <Section title={`รอผลตัวอย่าง (รอบ ${j.sampleRound})`}><p className="text-muted">แอดมินบันทึกผลหลังลูกค้ายืนยัน</p></Section>
  return (
    <Section title={`บันทึกผลตัวอย่าง (รอบ ${j.sampleRound})`}>
      <div className="grid gap-3">
        <label className="grid gap-1 font-medium">วันที่ลูกค้ายืนยัน
          <input type="date" value={day} onChange={e => setDay(e.target.value)} className={fieldClass} />
        </label>
        <label className="grid gap-1 font-medium">หมายเหตุ / สิ่งที่ต้องแก้ (ไม่ผ่านต้องกรอก)
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-xl border border-line px-3 py-2" />
        </label>
        {confirm === null ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={busy} className={okBtn} onClick={() => setConfirm(true)}><IconCheck className="size-5" />ตัวอย่างผ่าน</button>
            <button type="button" disabled={busy || !note.trim()} title={note.trim() ? undefined : 'กรอกสิ่งที่ต้องแก้ก่อน'} className={dangerBtn} onClick={() => setConfirm(false)}>
              {note.trim() ? 'ไม่ผ่าน · ขึ้นตัวอย่างใหม่' : 'ไม่ผ่าน (กรอกสิ่งที่ต้องแก้ก่อน)'}
            </button>
          </div>
        ) : (
          <Confirm text={confirm ? 'ยืนยันตัวอย่างผ่าน? งานจะไปผลิตจริงทั้งก้อน' : `ยืนยันไม่ผ่าน? งานจะกลับไปขึ้นตัวอย่างรอบ ${j.sampleRound + 1}`}
            busy={busy} danger={!confirm} onYes={async () => { if (await onSave(confirm, note.trim(), day)) setConfirm(null) }} onNo={() => setConfirm(null)} />
        )}
      </div>
    </Section>
  )
}

function Confirm({ text, busy, danger, yesLabel = 'ยืนยัน', noLabel = 'ยกเลิก', onYes, onNo }: {
  text: string; busy: boolean; danger?: boolean; yesLabel?: string; noLabel?: string; onYes: () => void; onNo: () => void
}) {
  return (
    <div className="grid gap-2 rounded-xl bg-paper p-3">
      <p className="font-semibold">{text}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={busy} className={danger ? dangerBtn : okBtn} onClick={onYes}>{busy ? 'กำลังบันทึก…' : yesLabel}</button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={onNo}>{noLabel}</button>
      </div>
    </div>
  )
}

type Act = (name: string, args: Record<string, unknown>, ok: string) => Promise<boolean>

function Station({ job: j, detail: d, canPress, canResume, role, busy, now, act }: {
  job: Job; detail: Detail; canPress: boolean; canResume: boolean; role: EmployeeRole; busy: boolean; now: Date; act: Act
}) {
  const st = j.station!
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [holdText, setHoldText] = useState<string | null>(null)
  const ctx = {
    station: st, phase: j.phase, rework: !!j.rework, done: new Set(d.done.keys()),
    filmReceived: !!j.film?.received, qcPassed: d.qcPassed, qty: j.qty,
  }
  const missing = missingSteps(d.steps, ctx)
  const s = d.sla
  const needReport = (s.station_over && !s.station_reported) || (s.segment_over && !s.segment_reported)
  const name = STATION_NAME[st]
  // ข้อความเดียวกับฐานข้อมูล (finish_station) · บอกสิ่งที่ต้องทำจริง ไม่ใช่ชื่อขั้นย่อย
  const missingText = (m: Substep) => m.kind === 'lock' ? `รอแอดมินบันทึก "${m.name}"`
    : m.key === 'inspect' ? `QC ตรวจผ่าน ${d.qcPassed}/${j.qty} ชิ้น ยังไม่ครบ (ชิ้นไม่ผ่านให้กด "ส่งแก้")` : m.name
  const finishBlock = missing.length ? `ยังกดเสร็จไม่ได้: ${missing.map(missingText).join(' · ')}` : needReport ? 'เกินเวลามาตรฐาน ต้องส่งรายงานปัญหาก่อน' : null
  const sample = j.phase === 'sample'

  return (
    <>
      {(s.station_over || s.segment_over || s.station_warn || s.segment_warn) && (
        <SlaBanner sla={s} />
      )}
      <Section title={`${sample ? 'ขึ้นตัวอย่าง · ' : ''}${name}${j.rework ? ' · งานแก้' : ''}`}>
        {!canPress && !(canResume && j.status === 'hold') && <p className="mb-3 text-sm text-muted">{role === 'qc' ? 'ฝ่าย QC กดได้เฉพาะสถานี QC + Packing' : role === 'staff' ? 'งานนี้ไม่ได้อยู่สถานีของคุณ กดได้เฉพาะสถานีที่จับคู่ไว้' : 'บทบาทนี้ดูได้อย่างเดียว'}</p>}

        {j.status === 'queued' && canPress && st === 'outside' && <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn">{OUTSIDE_START_BLOCK}</p>}
        {j.status === 'queued' && canPress && st !== 'outside' && (
          <button type="button" disabled={busy || (st === 'dtf_press' && !j.film?.received)} className={`${primaryBtn} w-full`}
            title={st === 'dtf_press' && !j.film?.received ? `ยังไม่ได้รับ${filmLabel(j.route)}` : undefined}
            onClick={() => void act('start_station', {}, `เริ่ม${spaced(name)}แล้ว`)}>
            {st === 'dtf_press' && !j.film?.received ? `เริ่มไม่ได้ · ยังไม่ได้รับ${filmLabel(j.route)}` : `เริ่ม${spaced(name).trimEnd()}`}
          </button>
        )}

        {j.status === 'hold' && (
          <div className="grid gap-2">
            <p className="font-medium text-danger">พักงาน · {j.holdReason}</p>
            {canResume
              ? <button type="button" disabled={busy} className={primaryBtn} onClick={() => void act('close_issue', { p_note: null }, 'แก้แล้ว · กลับมาทำต่อได้')}>แก้แล้ว ทำต่อ</button>
              : <p className="text-muted">รอผู้บริหารหรือฝ่ายผลิตกด "แก้แล้ว ทำต่อ"</p>}
          </div>
        )}

        {j.status === 'doing' && (
          <div className="grid gap-3">
            {/* ไม่มีเช็คลิสต์ขั้นย่อย: คนหน้างานรู้ขั้นตอนเอง */}
            {j.rework && st !== 'qc_pack' && <p className="text-muted">งานแก้ · แก้เสร็จกดเสร็จ งานกลับไป QC</p>}
            {st === 'qc_pack' && !sample && canPress && <QcPanel job={j} passed={d.qcPassed} busy={busy} act={act} />}
            {canPress && (confirmFinish
              ? <Confirm text={`ยืนยัน${spaced(name)}เสร็จทั้งก้อน? งานจะส่งต่ออัตโนมัติ`} busy={busy}
                  onYes={async () => { if (await act('finish_station', { p_station: st }, `${spaced(name).trimStart()}เสร็จ · ส่งต่อแล้ว`)) setConfirmFinish(false) }} onNo={() => setConfirmFinish(false)} />
              : <button type="button" disabled={busy || !!finishBlock} className={okBtn} onClick={() => setConfirmFinish(true)}>
                  <IconCheck className="size-5" />{finishBlock ? 'ยังกดเสร็จไม่ได้' : `${spaced(name).trimStart()}เสร็จ`}
                </button>)}
            {canPress && finishBlock && <p className="text-sm font-medium text-warn">{finishBlock}</p>}
          </div>
        )}

        {canPress && (j.status === 'queued' || j.status === 'doing') && (
          holdText === null
            ? <button type="button" disabled={busy} className={`${secondaryBtn} mt-3 w-full`} onClick={() => setHoldText('')}><IconPause className="size-5" />พักงาน / ติดปัญหา</button>
            : (
              <div className="mt-3 grid gap-2 rounded-xl bg-paper p-3">
                <label className="grid gap-1 font-medium">สาเหตุที่พัก (ต้องกรอก)
                  <input value={holdText} onChange={e => setHoldText(e.target.value)} placeholder="เช่น ผ้าไม่พอ รอของ" className={fieldClass} />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" disabled={busy || !holdText.trim()} className={dangerBtn}
                    onClick={async () => { if (await act('open_issue', { p_reason: holdText.trim() }, 'พักงานแล้ว · เวลาที่พักไม่นับเป็นเวลาทำงาน')) setHoldText(null) }}>
                    {holdText.trim() ? 'บันทึกพักงาน' : 'กรอกสาเหตุก่อน'}
                  </button>
                  <button type="button" className={secondaryBtn} onClick={() => setHoldText(null)}>ยกเลิก</button>
                </div>
              </div>
            )
        )}
      </Section>
      {j.phase === 'production' && canPress && <SlaReport sla={s} reasons={d.reasons} busy={busy} now={now} act={act} />}
    </>
  )
}

function SlaReport({ sla: s, reasons, busy, now, act }: { sla: Sla; reasons: Reason[]; busy: boolean; now: Date; act: Act }) {
  const [reportRequest, setReportRequest] = useState(newRequestId)
  const needReport = (s.station_over && !s.station_reported) || (s.segment_over && !s.segment_reported)
  if (!needReport && !s.station_warn && !s.segment_warn) return null
  return (
    <DelayReport reasons={reasons} busy={busy} now={now} required={!!needReport}
      onSend={async (codes, detail, eta, help) => {
        const ok = await act('submit_delay_report', {
          p_reasons: codes, p_detail: detail, p_new_eta: eta.toISOString(), p_need_help: help || null, p_request: reportRequest,
        }, 'ส่งรายงานปัญหาแล้ว')
        if (ok) setReportRequest(newRequestId())
        return ok
      }} />
  )
}

function SlaBanner({ sla: s }: { sla: Sla }) {
  const over = s.station_over || s.segment_over
  const lines = [
    s.segment_name && s.segment_sla_days ? `ช่วง${s.segment_name}: ใช้ไป ${slaAmount(Number(s.segment_days ?? 0))} จาก ${slaAmount(Number(s.segment_sla_days))}` : '',
    s.station_sla_days ? `สถานีนี้: ใช้ไป ${slaAmount(Number(s.station_days ?? 0))} จาก ${slaAmount(Number(s.station_sla_days))}` : '',
  ].filter(Boolean)
  return (
    <p role={over ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl px-3 py-2 font-medium ${over ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}>
      <IconAlert className="mt-0.5 size-5 shrink-0" />
      <span>{over ? 'เกินเวลามาตรฐาน' : 'ใกล้ครบเวลามาตรฐาน'} · {lines.join(' · ')}</span>
    </p>
  )
}

function QcPanel({ job: j, passed, busy, act }: { job: Job; passed: number; busy: boolean; act: Act }) {
  const [pass, setPass] = useState('')
  const [request, setRequest] = useState(newRequestId)
  const [rework, setRework] = useState<{ qty: string; reason: string; source: string } | null>(null)
  const sources = ROUTES[j.route].stations.filter(s => s !== 'qc_pack')
  return (
    <div className="grid gap-3 rounded-xl bg-paper p-3">
      <p className="font-semibold">ผล QC · ผ่านแล้ว {passed.toLocaleString('th-TH')} จาก {j.qty.toLocaleString('th-TH')} {j.unit}</p>
      <div className="flex flex-wrap gap-2">
        <input type="number" min={1} inputMode="numeric" value={pass} onChange={e => setPass(e.target.value)} aria-label="จำนวนที่ผ่าน" placeholder="จำนวนที่ผ่าน" className={`${fieldClass} w-36 flex-1`} />
        <button type="button" disabled={busy || !(Number(pass) > 0)} className={okBtn}
          onClick={async () => { if (await act('record_qc', { p_passed: Math.floor(Number(pass)), p_request: request }, `บันทึกผ่าน QC ${pass} ${j.unit}`)) { setPass(''); setRequest(newRequestId()) } }}>บันทึกผ่าน</button>
      </div>
      {rework === null
        ? <button type="button" disabled={busy} className={dangerBtn} onClick={() => setRework({ qty: '', reason: '', source: sources.includes('sew') ? 'sew' : sources[0] })}>ส่งกลับแก้</button>
        : (
          <div className="grid gap-2">
            <p className="font-semibold text-danger">ส่งกลับแก้ (ต้องมีจำนวน + สาเหตุ + สถานีต้นเหตุ)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input type="number" min={1} inputMode="numeric" value={rework.qty} onChange={e => setRework({ ...rework, qty: e.target.value })} placeholder="จำนวนที่ไม่ผ่าน" aria-label="จำนวนที่ไม่ผ่าน" className={fieldClass} />
              <select value={rework.source} onChange={e => setRework({ ...rework, source: e.target.value })} aria-label="สถานีต้นเหตุ" className={fieldClass}>
                {sources.map(s => <option key={s} value={s}>{STATION_NAME[s]}</option>)}
              </select>
            </div>
            <input value={rework.reason} onChange={e => setRework({ ...rework, reason: e.target.value })} placeholder="สาเหตุ เช่น ตะเข็บหลุด" aria-label="สาเหตุ" className={fieldClass} />
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" disabled={busy || !(Number(rework.qty) > 0) || !rework.reason.trim()} className={dangerBtn}
                onClick={async () => {
                  const ok = await act('send_rework', { p_qty: Math.floor(Number(rework.qty)), p_reason: rework.reason.trim(), p_source_station: rework.source },
                    `ส่งกลับแก้ ${rework.qty} ${j.unit} ที่${STATION_NAME[rework.source as keyof typeof STATION_NAME]}แล้ว`)
                  if (ok) setRework(null)
                }}>
                {Number(rework.qty) > 0 && rework.reason.trim() ? 'ยืนยันส่งกลับแก้' : 'กรอกจำนวนและสาเหตุก่อน'}
              </button>
              <button type="button" className={secondaryBtn} onClick={() => setRework(null)}>ยกเลิก</button>
            </div>
          </div>
        )}
    </div>
  )
}

function DelayReport({ reasons, busy, now, required, onSend }: {
  reasons: Reason[]; busy: boolean; now: Date; required: boolean
  onSend: (codes: string[], detail: string, eta: Date, help: string) => Promise<boolean>
}) {
  const [codes, setCodes] = useState<string[]>([])
  const [detail, setDetail] = useState('')
  const [day, setDay] = useState('')
  const [help, setHelp] = useState('')
  const eta = etaFromDay(day, now)
  const block = !codes.length ? 'เลือกรหัสสาเหตุอย่างน้อย 1 ข้อ' : !detail.trim() ? 'อธิบายว่าเกิดอะไรขึ้น' : !eta ? 'เลือกวันที่คาดว่าเสร็จ (วันนี้หรือหลังจากนี้)' : null
  const groups = [...new Set(reasons.map(r => r.grp))]
  return (
    <Section id={DELAY_REPORT_ID} title={required ? 'ต้องส่งรายงานปัญหาก่อนกดเสร็จ' : 'รายงานปัญหาล่วงหน้า'} icon={<IconAlert className="size-5" />} tone={required ? 'danger' : 'warn'}>
      <div className="grid gap-3">
        {groups.map(g => (
          <fieldset key={g}>
            <legend className="mb-1 text-sm font-semibold text-muted">{g}</legend>
            <div className="flex flex-wrap gap-1.5">
              {reasons.filter(r => r.grp === g).map(r => {
                const on = codes.includes(r.code)
                return (
                  <button key={r.code} type="button" aria-pressed={on} onClick={() => setCodes(on ? codes.filter(c => c !== r.code) : [...codes, r.code])}
                    className={`min-h-11 rounded-xl border px-3 text-sm ${on ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line hover:bg-paper'}`}>
                    {r.code} {r.name}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ))}
        <label className="grid gap-1 font-medium">อธิบายเพิ่ม (เกิดอะไรขึ้น กระทบกี่ชิ้น)
          <textarea rows={2} value={detail} onChange={e => setDetail(e.target.value)} className="w-full rounded-xl border border-line px-3 py-2" />
        </label>
        <label className="grid gap-1 font-medium">คาดว่าเสร็จใหม่ (วันที่)
          <input type="date" value={day} min={bookingDay(now)} onChange={e => setDay(e.target.value)} className={fieldClass} />
        </label>
        <label className="grid gap-1 font-medium">ต้องการความช่วยเหลือจากใคร (ถ้ามี)
          <input value={help} onChange={e => setHelp(e.target.value)} placeholder="เช่น ช่างซ่อม แอดมินตามของ" className={fieldClass} />
        </label>
        <button type="button" disabled={busy || !!block} className={primaryBtn}
          onClick={async () => { if (eta && await onSend(codes, detail.trim(), eta, help.trim())) { setCodes([]); setDetail(''); setDay(''); setHelp('') } }}>
          {block ?? 'ส่งรายงานปัญหา'}
        </button>
      </div>
    </Section>
  )
}
