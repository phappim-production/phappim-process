import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../data/useFactoryData'
import { thaiError } from '../data/live'
import { confirmationPath, draftFromConfirmation, pdfProblem, type ReceiveDraft } from '../data/confirmation'
import { ROUTES, type RouteCode } from '../proto/model'
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
const EMPTY: ReceiveDraft = { no: '', rev: 0, customer: '', jobName: '', product: '', qty: 0, spare: 0, due: '', route: 'normal', spec: {} }

/** รับงานเข้าโรงงาน (S2): แนบ PDF ที่ลูกค้าเซ็นครบ + ไฟล์ .json จากฟอร์มใบยืนยัน (ถ้ามี) เพื่อดึงข้อมูลหัวใบ */
export function ReceiveJob({ onClose, onDone }: { onClose: () => void; onDone: (no: string) => void }) {
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
  const pdfIssue = pdfProblem(pdf)
  const missing = [
    !draft.no.trim() && 'เลขที่ใบยืนยัน', !draft.customer.trim() && 'ชื่อลูกค้า', !product && 'ประเภทสินค้า',
    draft.qty <= 0 && 'จำนวน', !draft.due && 'กำหนดส่ง', pdfIssue && 'PDF ใบยืนยัน',
  ].filter(Boolean) as string[]

  async function readJson(file: File | undefined) {
    if (!file) return
    try {
      const d = draftFromConfirmation(JSON.parse(await file.text()))
      if (!d) throw new Error()
      setDraft(d)
      setJsonNote({ ok: true, text: `ดึงข้อมูลจาก ${file.name} แล้ว · ตรวจอีกครั้งก่อนรับงาน` })
    } catch {
      setJsonNote({ ok: false, text: 'ไฟล์นี้ไม่ใช่ไฟล์จากฟอร์มใบยืนยันการผลิต (.json) กรอกเองได้' })
    }
  }

  async function submit() {
    if (missing.length || !pdf || !product || !supabase) return
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
    })
    setSaving(null)
    if (!r.ok) setError(r.reason)
    else onDone(draft.no.trim())
  }

  const label = 'grid gap-1 font-medium'
  return (
    <Dialog title="รับงานเข้าโรงงาน" icon={IconInbox} onClose={onClose} wide>
      <div className="mt-3 grid gap-4">
        <label className={label}>ไฟล์ใบงานจากฟอร์ม (.json) · ไม่บังคับ
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
        <p className="text-sm text-muted">ลำดับสถานี: {ROUTES[draft.route].stations.length} สถานี · ไฟล์ .json เลือกเส้นทางตามเทคนิคพิมพ์ให้แล้ว</p>

        <label className={label}>PDF ใบยืนยันที่ลูกค้าเซ็นครบ (ไม่เกิน 20 MB)
          <FilePick accept="application/pdf,.pdf" chosen={pdf?.name ?? ''} onPick={f => { setPdf(f ?? null); setError('') }} />
          {pdf && pdfIssue && <span role="alert" className="text-sm text-danger">{pdfIssue}</span>}
        </label>

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
