import { useEffect, useMemo, useState } from 'react'
import { seedFromConfirmation } from '../data/mockupSheets'
import { supabase } from '../lib/supabase'
import { rpc } from '../data/useFactoryData'
import { thaiError } from '../data/live'
import { uploadFile } from '../data/files'
import { contentKey, signedUrls } from '../data/mockups'
import { confirmationPath, draftFromConfirmation, pdfProblem, sewRecipeProblem, syncConfirmationSpec, type ReceiveDraft } from '../data/confirmation'
import { draftLabel, formDataFromDraft, INBOX_KEY, type DraftRow } from '../data/confirmationDrafts'
import { specMockups } from '../data/jobMockups'
import { ROUTES, STATION_NAME, type Job, type RouteCode } from '../proto/model'
import { receiveForecast, type SewFloor } from '../proto/capacity'
import { dueDateWarning } from '../proto/format'
import { Dialog, fieldClass, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconInbox } from '../components/icons'
import { FilePick } from '../components/FilePick'

type Product = { code: string; name: string; unit: string }
// vite.config.ts คัดลอกฟอร์มขึ้นเว็บนี้ · Cloudflare เสิร์ฟโดยไม่มี .html
const CONFIRMATION_FORM = '/confirmation'

const EMPTY: ReceiveDraft = { no: '', rev: 0, customer: '', jobName: '', product: '', qty: 0, spare: 0, due: '', route: null, needsSample: null, spec: {} }

// PDF ที่ลูกค้าเซ็นไม่บังคับ แนบทีหลังได้ที่รายละเอียดงาน
export function ReceiveJob({ onClose, onDone, jobs, now, floor, draftId }: {
  onClose: () => void; onDone: (no: string) => void
  jobs: Job[]; now: Date; floor: SewFloor
  draftId?: string                          // เปิดมาจาก "ส่งงานเข้าโรงงานเลย" หลังบันทึกใบจากฟอร์ม
}) {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [draft, setDraft] = useState<ReceiveDraft>(EMPTY)
  const [pdf, setPdf] = useState<File | null>(null)
  const [jsonNote, setJsonNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [jsonName, setJsonName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null)
  const [picked, setPicked] = useState('')
  const [openingForm, setOpeningForm] = useState(false)

  useEffect(() => {
    let alive = true
    void supabase?.from('product_types').select('code, name, unit').eq('active', true).order('sort').then(({ data, error: e }) => {
      if (!alive) return
      if (e) setError(thaiError(e.message))
      else setProducts((data ?? []) as Product[])
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    void supabase?.from('confirmation_drafts').select('id, confirmation_no, customer_name, data, updated_at')
      .eq('status', 'draft').order('updated_at', { ascending: false }).limit(100)
      .then(({ data, error: e }) => {
        if (!alive) return
        if (e) { setDrafts([]); return }
        const rows = (data ?? []) as DraftRow[]
        setDrafts(rows)
        const first = draftId ? rows.find(r => r.id === draftId) : undefined
        if (first) pickDraft(first)
      })
    return () => { alive = false }
  }, [draftId])   // หน้าต่างเปิดใหม่ทุกครั้ง draftId จึงไม่เปลี่ยนระหว่างเปิด

  function pickDraft(row: DraftRow | undefined) {
    setPicked(row?.id ?? '')
    if (!row) return
    const d = draftFromConfirmation(row.data)
    if (!d) { setJsonNote({ ok: false, text: `อ่านใบ ${row.confirmation_no} ไม่ได้ ให้เปิดในฟอร์มแล้วบันทึกเข้าระบบอีกครั้ง` }); return }
    setDraft(d)
    setJsonName('')
    setJsonNote({ ok: true, text: `ดึงข้อมูลจากใบ ${row.confirmation_no} แล้ว · ตรวจอีกครั้งก่อนรับงาน` })
  }

  // แก้ใบที่บันทึกไว้: ส่งข้อมูลให้ฟอร์มผ่าน localStorage แล้วเปิดฟอร์มแท็บใหม่
  async function openInForm() {
    const row = drafts?.find(r => r.id === picked)
    if (!row || openingForm) return
    // เปิดหน้าต่างก่อนรอลิงก์รูป ไม่อย่างนั้นเบราว์เซอร์บนมือถือจะบล็อกป๊อปอัป
    const win = window.open('', '_blank')
    setOpeningForm(true)
    const path = typeof (row.data as { mockup_path?: unknown } | null)?.mockup_path === 'string' ? (row.data as { mockup_path: string }).mockup_path : null
    const data = formDataFromDraft(row.data, await signedUrls(specMockups(row.data, path).map(m => m.path)))
    setOpeningForm(false)
    try { window.localStorage.setItem(INBOX_KEY, JSON.stringify(data ?? row.data)) } catch { win?.close(); setError('เปิดในฟอร์มไม่ได้ (พื้นที่เบราว์เซอร์เต็ม)'); return }
    if (win) win.location.href = CONFIRMATION_FORM
    else window.location.href = CONFIRMATION_FORM
  }

  const set = <K extends keyof ReceiveDraft>(k: K, v: ReceiveDraft[K]) => { setDraft(d => ({ ...d, [k]: v })); setError('') }
  const product = products?.find(p => p.code === draft.product)
  // เตือนอย่างเดียว ไม่บล็อกการส่งงานเข้า
  const forecast = useMemo(() => product && draft.route && draft.qty > 0 && draft.needsSample !== null
    ? receiveForecast(jobs, now, floor, { route: draft.route, qty: draft.qty, productCode: product.code, needsSample: draft.needsSample, due: draft.due })
    : null, [jobs, now, floor, product, draft.route, draft.qty, draft.needsSample, draft.due])
  const pdfIssue = pdfProblem(pdf)
  const dueWarning = dueDateWarning(draft.due, now)
  const recipeIssue = product ? sewRecipeProblem(draft.route, floor.needsOf(product.code)) : null
  const missing = [
    !draft.no.trim() && 'เลขที่ใบยืนยัน', !draft.customer.trim() && 'ชื่อลูกค้า', !product && 'ประเภทสินค้า',
    draft.qty <= 0 && 'จำนวน', !draft.due && 'กำหนดส่ง', !draft.route && 'เส้นทางผลิต', draft.needsSample === null && 'ขึ้นตัวอย่างหรือไม่', pdf && pdfIssue && 'PDF ใบยืนยัน',
  ].filter(Boolean) as string[]

  async function readJson(file: File | undefined) {
    if (!file) return
    try {
      const d = draftFromConfirmation(JSON.parse(await file.text()))
      if (!d) throw new Error()
      setDraft(d)
      setJsonNote({ ok: true, text: `ดึงข้อมูลจาก ${file.name} แล้ว · ตรวจอีกครั้งก่อนรับงาน` })
    } catch {
      setJsonNote({ ok: false, text: 'ไฟล์นี้ไม่ใช่ไฟล์ที่บันทึกจากฟอร์มใบยืนยันการผลิต กรอกเองได้' })
    }
  }

  async function submit() {
    if (missing.length || !product || !supabase || !draft.route || draft.needsSample === null) return
    if (dueWarning && !window.confirm(`${dueWarning}

กำหนดส่ง ${draft.due} ถูกต้อง รับงานต่อ?`)) return
    setError('')
    let path: string | null = null
    if (pdf) {
      setSaving('กำลังอัปโหลด PDF…')
      path = confirmationPath(draft.no, await contentKey(pdf))
      const up = await uploadFile('confirmations', path, pdf, 'application/pdf')
      if (!up.ok) {
        setSaving(null)
        setError(up.reason)
        return
      }
    }
    setSaving('กำลังรับงาน…')
    const r = await rpc<string>('receive_job', {
      p_confirmation_no: draft.no.trim(), p_customer_name: draft.customer.trim(), p_job_name: draft.jobName.trim() || product.name,
      p_product_type_code: product.code, p_qty: draft.qty, p_unit: product.unit, p_due_date: draft.due, p_route_code: draft.route,
      p_confirmation_pdf_path: path, p_spare_qty: draft.spare, p_confirmation_rev: draft.rev, p_spec: syncConfirmationSpec(draft, product.name),
      p_needs_sample: draft.needsSample,
    })
    if (!r.ok) { setSaving(null); setError(r.reason); return }
    setSaving('กำลังสร้างร่างม็อคอัพจากจุดในใบยืนยัน…')
    await seedFromConfirmation(r.data)
    setSaving(null)
    onDone(draft.no.trim())
  }

  const label = 'grid gap-1 font-medium'
  return (
    <Dialog title="รับงานเข้าโรงงาน" icon={IconInbox} onClose={onClose} wide>
      <div className="mt-3 grid gap-4">
        <div className="grid gap-2 rounded-xl border border-line bg-paper p-3">
          <label className={label}>ใบยืนยันที่บันทึกเข้าระบบแล้ว
            <select value={picked} onChange={e => pickDraft(drafts?.find(r => r.id === e.target.value))} className={fieldClass} disabled={!drafts}>
              <option value="">{!drafts ? 'กำลังโหลดใบยืนยัน…' : drafts.length ? 'เลือกใบยืนยัน' : 'ยังไม่มีใบที่บันทึกเข้าระบบ'}</option>
              {drafts?.map(d => <option key={d.id} value={d.id}>{draftLabel(d)}</option>)}
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <a href={CONFIRMATION_FORM} target="_blank" rel="noopener" className={`${secondaryBtn} text-center`}>เปิดฟอร์มใบยืนยัน (ใบใหม่)</a>
            <button type="button" className={secondaryBtn} disabled={!picked || openingForm} onClick={() => void openInForm()}
              title={picked ? undefined : 'เลือกใบยืนยันก่อน'}>{openingForm ? 'กำลังเปิดใบยืนยัน…' : picked ? 'แก้ใบนี้ในฟอร์ม' : 'แก้ใบในฟอร์ม (เลือกใบก่อน)'}</button>
          </div>
          <p className="text-sm text-muted">กรอกฟอร์ม → กด &quot;บันทึกเข้าระบบ&quot; → ใบขึ้นในรายการนี้ · ส่งออก PDF ให้ลูกค้าเซ็นจากฟอร์มได้ตามเดิม</p>
        </div>
        <label className={label}>หรือแนบไฟล์ .json ที่บันทึกจากฟอร์ม (ปุ่ม &quot;บันทึกไฟล์&quot;) · ไม่บังคับ
          <FilePick accept=".json,application/json" chosen={jsonName} onPick={f => { setJsonName(f?.name ?? ''); void readJson(f) }} />
          {jsonNote && <span role={jsonNote.ok ? 'status' : 'alert'} className={`text-sm ${jsonNote.ok ? 'text-ok' : 'text-warn'}`}>{jsonNote.text}</span>}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>เลขที่ใบยืนยัน
            <input value={draft.no} onChange={e => set('no', e.target.value)} placeholder="เช่น SC691451" className={fieldClass} />
          </label>
          <label className={label}>แก้ไขครั้งที่
            <input type="number" min={0} inputMode="numeric" value={draft.rev || ''} placeholder="ใบแรกเว้นว่าง" onChange={e => set('rev', Math.max(0, Number(e.target.value) || 0))} className={fieldClass} />
          </label>
          <label className={`${label} sm:col-span-2`}>ชื่อลูกค้า / บริษัท
            <input value={draft.customer} onChange={e => set('customer', e.target.value)} className={fieldClass} />
          </label>
          <label className={`${label} sm:col-span-2`}>ชื่องาน
            <input value={draft.jobName} onChange={e => set('jobName', e.target.value)} placeholder="ไม่ใส่ = ใช้ชื่อสินค้า" className={fieldClass} />
          </label>
          <label className={`${label} sm:col-span-2`}>ประเภทสินค้า
            <select value={draft.product} onChange={e => set('product', e.target.value)} className={fieldClass} disabled={!products}>
              <option value="">{products ? 'เลือกสินค้า' : 'กำลังโหลดรายการสินค้า…'}</option>
              {products?.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
            </select>
          </label>
          <label className={label}>จำนวน{product ? ` (${product.unit})` : ''}
            <input type="number" min={1} inputMode="numeric" value={draft.qty || ''} onChange={e => set('qty', Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={fieldClass} />
          </label>
          <label className={label}>ผลิตเผื่อเสีย
            <input type="number" min={0} inputMode="numeric" value={draft.spare || ''} placeholder="0" onChange={e => set('spare', Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={fieldClass} />
          </label>
          <label className={label}>กำหนดส่ง
            <input type="date" value={draft.due} onChange={e => set('due', e.target.value)} className={fieldClass} aria-describedby={dueWarning ? 'due-warning' : undefined} />
            {dueWarning && <span id="due-warning" role="alert" className="text-sm font-medium text-warn">{dueWarning}</span>}
          </label>
          <label className={label}>เส้นทางผลิต
            <select value={draft.route ?? ''} onChange={e => set('route', (e.target.value || null) as RouteCode | null)} className={fieldClass}>
              <option value="">เลือกเส้นทางผลิตของงานนี้</option>
              {(Object.keys(ROUTES) as RouteCode[]).map(r => <option key={r} value={r}>{ROUTES[r].name}</option>)}
            </select>
          </label>
        </div>
        <p className="text-sm text-muted">{draft.route
          ? `ลำดับสถานี: ${ROUTES[draft.route].stations.map(s => STATION_NAME[s]).join(' → ')}`
          : 'แอดมินเลือกเส้นทางเองทุกงาน (ระบบไม่เลือกให้ตามเทคนิคพิมพ์) · เลือกแล้วจะเห็นลำดับสถานี'}</p>
        {recipeIssue && <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn">{recipeIssue}</p>}

        {/* ขึ้นตัวอย่างเฉพาะงานที่ลูกค้าจ่ายค่าตัวอย่าง · ไม่มีค่าตั้งต้น ต้องเลือกเอง */}
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium">ขึ้นตัวอย่าง (ตามที่ตกลงกับลูกค้าในใบยืนยัน)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([[true, 'ขึ้นตัวอย่าง', 'ลูกค้าจ่ายค่าตัวอย่าง · ขึ้นตัวอย่างก่อนผลิตจริง'], [false, 'ไม่ขึ้นตัวอย่าง', 'เข้าสถานีแรกผลิตจริงทันที']] as const).map(([v, title, hint]) => (
              <label key={title} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 ${draft.needsSample === v ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                <input type="radio" name="needs-sample" className="mt-1 size-5 shrink-0" checked={draft.needsSample === v} onChange={() => set('needsSample', v)} />
                <span className="grid"><span className="font-medium">{title}</span><span className="text-sm text-muted">{hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className={label}>PDF ใบยืนยันที่ลูกค้าเซ็นครบ · ไม่บังคับ (ลูกค้ายังไม่เซ็น แนบทีหลังได้ที่รายละเอียดงาน · ไม่เกิน 20 MB)
          <FilePick accept="application/pdf,.pdf" chosen={pdf?.name ?? ''} onPick={f => { setPdf(f ?? null); setError('') }} />
          {pdf && pdfIssue && <span role="alert" className="text-sm text-danger">{pdfIssue}</span>}
        </label>

        {forecast && (
          <p role="status" className={`rounded-xl px-3 py-2 font-medium ${forecast.late === null ? 'bg-brand-soft text-ink' : forecast.late > 0 ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>
            คาดว่าเสร็จ {forecast.finish.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}
            {forecast.late === null ? '' : forecast.late > 0
              ? ` · ช้ากว่ากำหนดส่ง ${forecast.late} วัน · แจ้งลูกค้าหรือตกลงวันส่งใหม่ก่อน (ยังส่งงานเข้าได้)`
              : ' · ทันกำหนดส่ง'}
          </p>
        )}
        {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger">{error}</p>}
        <div className="grid gap-2">
          <button type="button" className={primaryBtn} disabled={missing.length > 0 || !!saving} onClick={() => void submit()}>
            {saving ?? (missing.length ? `ยังขาด: ${missing.join(' · ')}` : 'รับงาน')}
          </button>
          <button type="button" className={secondaryBtn} onClick={onClose}>ยกเลิก</button>
        </div>
      </div>
    </Dialog>
  )
}
