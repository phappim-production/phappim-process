import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../data/useFactoryData'
import { thaiError } from '../data/live'
import { confirmationPath, draftFromConfirmation, pdfProblem, type ReceiveDraft } from '../data/confirmation'
import { ROUTES, STATION_NAME, type Job, type RouteCode } from '../proto/model'
import { receiveForecast, type SewFloor } from '../proto/capacity'
import { Dialog, fieldClass, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconInbox } from '../components/icons'

type Product = { code: string; name: string; unit: string }

// ปุ่มเลือกไฟล์ของเบราว์เซอร์แสดงภาษาของเครื่อง (มักเป็นอังกฤษ) จึงซ่อนแล้วใช้ปุ่มภาษาไทยแทน
function FilePick({ accept, chosen, onPick }: { accept: string; chosen: string; onPick: (f: File | undefined) => void }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className={`${secondaryBtn} relative cursor-pointer focus-within:outline-2 focus-within:outline-brand`}>
        {chosen ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}
        <input type="file" accept={accept} className="absolute inset-0 cursor-pointer opacity-0" onChange={e => onPick(e.target.files?.[0])} />
      </span>
      <span className={`min-w-0 break-all text-sm ${chosen ? 'text-ink' : 'text-muted'}`}>{chosen || 'ยังไม่ได้เลือกไฟล์'}</span>
    </span>
  )
}
const EMPTY: ReceiveDraft = { no: '', rev: 0, customer: '', jobName: '', product: '', qty: 0, spare: 0, due: '', route: 'normal', needsSample: null, spec: {} }

/** รับงานเข้าโรงงาน (S2): แนบ PDF ที่ลูกค้าเซ็นครบ + ไฟล์ .json จากฟอร์มใบยืนยัน (ถ้ามี) เพื่อดึงข้อมูลหัวใบ */
export function ReceiveJob({ onClose, onDone, jobs, now, floor }: {
  onClose: () => void; onDone: (no: string) => void
  jobs: Job[]; now: Date; floor: SewFloor   // งานทั้งโรงงาน + จักรจริง ใช้คาดวันเสร็จก่อนส่งงานเข้า
}) {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [draft, setDraft] = useState<ReceiveDraft>(EMPTY)
  const [pdf, setPdf] = useState<File | null>(null)
  const [jsonNote, setJsonNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [jsonName, setJsonName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void supabase?.from('product_types').select('code, name, unit').eq('active', true).order('sort').then(({ data, error: e }) => {
      if (!alive) return
      if (e) setError(thaiError(e.message))
      else setProducts((data ?? []) as Product[])
    })
    return () => { alive = false }
  }, [])

  const set = <K extends keyof ReceiveDraft>(k: K, v: ReceiveDraft[K]) => { setDraft(d => ({ ...d, [k]: v })); setError('') }
  const product = products?.find(p => p.code === draft.product)
  // คาดวันเสร็จจากคิวงานและจักรจริง · เตือนอย่างเดียว ไม่บล็อกการส่งงานเข้า
  const forecast = useMemo(() => product && draft.qty > 0 && draft.needsSample !== null
    ? receiveForecast(jobs, now, floor, { route: draft.route, qty: draft.qty, productCode: product.code, needsSample: draft.needsSample, due: draft.due })
    : null, [jobs, now, floor, product, draft.route, draft.qty, draft.needsSample, draft.due])
  const pdfIssue = pdfProblem(pdf)
  const missing = [
    !draft.no.trim() && 'เลขที่ใบยืนยัน', !draft.customer.trim() && 'ชื่อลูกค้า', !product && 'ประเภทสินค้า',
    draft.qty <= 0 && 'จำนวน', !draft.due && 'กำหนดส่ง', draft.needsSample === null && 'ขึ้นตัวอย่างหรือไม่', pdfIssue && 'PDF ใบยืนยัน',
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
    if (missing.length || !pdf || !product || !supabase || draft.needsSample === null) return
    setError('')
    setSaving('กำลังอัปโหลด PDF…')
    const path = confirmationPath(draft.no, new Date())
    const up = await supabase.storage.from('confirmations').upload(path, pdf, { contentType: 'application/pdf', upsert: false })
    if (up.error) {
      setSaving(null)
      setError(thaiError(up.error.message))
      return
    }
    setSaving('กำลังรับงาน…')
    const r = await rpc<string>('receive_job', {
      p_confirmation_no: draft.no.trim(), p_customer_name: draft.customer.trim(), p_job_name: draft.jobName.trim() || product.name,
      p_product_type_code: product.code, p_qty: draft.qty, p_unit: product.unit, p_due_date: draft.due, p_route_code: draft.route,
      p_confirmation_pdf_path: path, p_spare_qty: draft.spare, p_confirmation_rev: draft.rev, p_spec: draft.spec,
      p_needs_sample: draft.needsSample,
    })
    setSaving(null)
    if (!r.ok) setError(r.reason)
    else onDone(draft.no.trim())
  }

  const label = 'grid gap-1 font-medium'
  return (
    <Dialog title="รับงานเข้าโรงงาน" icon={IconInbox} onClose={onClose} wide>
      <div className="mt-3 grid gap-4">
        <label className={label}>ไฟล์ที่บันทึกจากฟอร์มใบยืนยัน (ปุ่ม "บันทึกไฟล์") · ไม่บังคับ
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
            <input type="date" value={draft.due} onChange={e => set('due', e.target.value)} className={fieldClass} />
          </label>
          <label className={label}>เส้นทางผลิต
            <select value={draft.route} onChange={e => set('route', e.target.value as RouteCode)} className={fieldClass}>
              {(Object.keys(ROUTES) as RouteCode[]).map(r => <option key={r} value={r}>{ROUTES[r].name}</option>)}
            </select>
          </label>
        </div>
        <p className="text-sm text-muted">ลำดับสถานี: {ROUTES[draft.route].stations.map(s => STATION_NAME[s]).join(' → ')} · แนบไฟล์จากฟอร์มแล้ว ระบบเลือกเส้นทางตามเทคนิคพิมพ์ให้</p>

        {/* ขึ้นตัวอย่างเฉพาะงานที่ลูกค้าจ่ายค่าตัวอย่าง (ตกลงกันแล้วในใบยืนยัน) · ไม่มีค่าตั้งต้น ต้องเลือกเอง */}
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium">ขึ้นตัวอย่าง (ตามที่ตกลงกับลูกค้าในใบยืนยัน)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([[true, 'ขึ้นตัวอย่าง', 'ลูกค้าจ่ายค่าตัวอย่าง · วัตถุดิบครบแล้วขึ้นตัวอย่างก่อน'], [false, 'ไม่ขึ้นตัวอย่าง', 'วัตถุดิบครบแล้วเข้าผลิตจริงเลย']] as const).map(([v, title, hint]) => (
              <label key={title} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 ${draft.needsSample === v ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                <input type="radio" name="needs-sample" className="mt-1 size-5 shrink-0" checked={draft.needsSample === v} onChange={() => set('needsSample', v)} />
                <span className="grid"><span className="font-medium">{title}</span><span className="text-sm text-muted">{hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className={label}>PDF ใบยืนยันที่ลูกค้าเซ็นครบ (ไม่เกิน 20 MB)
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
