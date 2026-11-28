import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../data/useFactoryData'
import { thaiError } from '../data/live'
import { reviseArgs } from '../data/confirmation'
import { SAVE_HASH, asNewDraft, recentlyTaken, takeOutbox } from '../data/confirmationDrafts'
import { dataUrlBlob, mockupDataUrl, mockupFolder, uploadFormMockups, uploadMockup } from '../data/mockups'
import { cardPath, formMockups, type JobMockup } from '../data/jobMockups'
import { formInSameWindow } from '../lib/install'

type Revised = { ok: 'revised'; no: string; rev: number; changed: boolean; picSaved: boolean; mockupRev: number | null; stale: number; parts: string[]; warning?: string | undefined }
type Result = { ok: true; no: string; id: string; warning?: string | undefined; reused?: boolean } | { ok: false; text: string } | { ok: 'elsewhere'; no: string } | Revised
type ReviseReply = { changed: boolean; rev?: number; mockup_rev?: number | null; mockup_stale?: number; parts?: string[] | null }

async function saveRevision(no: string, sent: Record<string, unknown>): Promise<Revised | { ok: false; text: string } | { ok: 'cancelled' }> {
  const fail = (why: string) => ({ ok: false as const, text: `บันทึกการแก้ใบ ${no} ไม่สำเร็จ: ${why}` })
  if (!supabase) return fail('ยังไม่ได้ตั้งค่า Supabase')
  const { data: job, error } = await supabase.from('jobs').select('id, mockup_path, phase').eq('confirmation_no', no).maybeSingle()
  if (error) return fail(thaiError(error.message))
  if (!job) return fail(`ไม่พบงาน ${no} ในระบบ (งานอาจถูกแบ่ง หรือเลขที่ใบในฟอร์มถูกเปลี่ยน)`)
  const { id, mockup_path: current, phase } = job as { id: string; mockup_path: string | null; phase: string }
  if (phase === 'cancelled') return { ok: 'cancelled' }
  // รูปต้องเข้าที่เก็บก่อน สเปกจึงอ้างรูปได้ครบ · รูปไม่ผ่าน = ยังไม่แก้อะไรในงาน
  const { mockups: _m, ...data } = sent
  const items = formMockups(sent.mockups)
  let list: JobMockup[] | null = null
  if (items) {
    const up = items.length ? await uploadFormMockups(no, items) : { ok: true as const, list: [] }
    if (!up.ok) return fail(`รูปม็อคอัพยังเข้าระบบไม่ได้ (${up.reason}) · ลองกด "บันทึกการแก้เข้างาน" ในฟอร์มอีกครั้ง`)
    list = up.list
    data.mockups = list
  }
  const args = reviseArgs(data)
  if (!args) return fail('ข้อมูลจากฟอร์มไม่ใช่ใบยืนยันการผลิต')
  const r = await rpc<ReviseReply>('revise_job_spec', { p_job: id, ...args })
  if (!r.ok) return fail(r.reason)
  let warning: string | undefined
  let picSaved = false
  const card = list ? cardPath(list, mockupFolder(no)) : null
  if (card && card !== current) {
    const set = await rpc('set_job_mockup', { p_job: id, p_path: card })
    if (set.ok) picSaved = true
    else warning = `รูปบนการ์ดงานยังเป็นรูปเดิม (${set.reason}) · เปลี่ยนรูปได้ที่รายละเอียดงาน`
  }
  // ฟอร์มรุ่นก่อนส่งรูปแรกรูปเดียว · เปลี่ยนรูปหลังสเปกผ่านการตรวจแล้ว
  const pic = items ? null : mockupDataUrl(data.mockup)
  if (pic) {
    const up = await uploadMockup(no, dataUrlBlob(pic))
    const set = up.ok ? await rpc('set_job_mockup', { p_job: id, p_path: up.path }) : up
    if (set.ok) picSaved = true
    else warning = `รูปม็อคอัพใหม่ยังไม่เข้างาน (${set.reason}) · เปลี่ยนรูปได้ที่รายละเอียดงาน`
  }
  return {
    ok: 'revised', no, rev: r.data.rev ?? args.p_rev, changed: r.data.changed, picSaved,
    mockupRev: r.data.mockup_rev ?? null, stale: r.data.mockup_stale ?? 0, parts: r.data.parts ?? [], warning,
  }
}

// บันทึกด้วยบัญชีที่ล็อกอินในหน้าระบบ เพราะฟอร์มไม่มีการล็อกอิน
export function ConfirmationOutbox({ onReceive, onRevised }: { onReceive: (draftId: string) => void; onRevised: () => Promise<void> }) {
  const [result, setResult] = useState<Result | null>(null)
  // ตรวจกล่องส่งครั้งเดียวตอนเปิดหน้า ไม่ผูกกับฟังก์ชันโหลดข้อมูลที่เปลี่ยนทุกครั้งที่หน้าวาดใหม่
  const revised = useRef(onRevised)
  useEffect(() => { revised.current = onRevised }, [onRevised])

  useEffect(() => {
    let alive = true
    async function check() {
      if (!window.location.hash.includes(SAVE_HASH)) return
      // เอา ?confirmation=save ออก ไม่อย่างนั้นรีเฟรชแล้วจะพยายามบันทึกซ้ำ
      window.history.replaceState(null, '', window.location.hash.split('?')[0])
      const item = takeOutbox(window.localStorage)
      if (!item) {
        const other = recentlyTaken(window.localStorage)
        if (alive && other) { setResult({ ok: 'elsewhere', no: other }); return }
        if (alive) setResult({ ok: false, text: 'ไม่พบใบยืนยันที่ส่งมาจากฟอร์ม ให้กด "บันทึกเข้าระบบ" ในฟอร์มอีกครั้ง' })
        return
      }
      let sent = item.data
      if (sent.revise_job === true) {
        const done = await saveRevision(item.no, sent)
        if (done.ok !== 'cancelled') {
          if (done.ok === 'revised' && (done.changed || done.picSaved)) await revised.current()
          if (alive) setResult(done)
          return
        }
        sent = asNewDraft(sent)
      }
      const reused = sent !== item.data
      // รูปม็อคอัพย่อจากฟอร์ม → ที่เก็บไฟล์ · ใบร่างเก็บแค่ path · อัปโหลดไม่ได้ = บันทึกใบต่อ (รูปเดิมยังอยู่) แล้วบอกให้รู้
      const { mockup, mockups, ...data } = sent
      const items = formMockups(mockups)
      const pic = items ? null : mockupDataUrl(mockup)
      let warning: string | undefined
      if (items) {
        const up = items.length ? await uploadFormMockups(item.no, items) : { ok: true as const, list: [] }
        if (up.ok) {
          data.mockups = up.list
          const card = cardPath(up.list, mockupFolder(item.no))
          if (card) data.mockup_path = card
          else delete data.mockup_path
        } else warning = `รูปม็อคอัพยังไม่เข้าระบบ (${up.reason}) · กด "บันทึกเข้าระบบ" ในฟอร์มอีกครั้ง`
      }
      if (pic) {
        const up = await uploadMockup(item.no, dataUrlBlob(pic))
        if (up.ok) data.mockup_path = up.path
        else warning = `รูปม็อคอัพยังไม่เข้าระบบ (${up.reason}) · เพิ่มรูปได้ที่รายละเอียดงานหลังส่งงานเข้า`
      }
      const r = await rpc<string>('save_confirmation_draft', { p_data: data })
      if (!alive) return
      setResult(r.ok ? { ok: true, no: item.no, id: r.data, warning, reused } : { ok: false, text: `บันทึกใบ ${item.no} ไม่สำเร็จ: ${r.reason}` })
    }
    void check()
    window.addEventListener('hashchange', check)
    return () => {
      alive = false
      window.removeEventListener('hashchange', check)
    }
  }, [])

  if (!result) return null
  if (result.ok === 'elsewhere') {
    return <p role="status" className="rounded-xl bg-info-soft px-3 py-2 font-medium text-info">ใบ {result.no} ส่งไปบันทึกในอีกแท็บแล้ว · ดูผลที่แท็บนั้น แท็บนี้ปิดได้</p>
  }
  if (result.ok === 'revised') {
    if (!result.changed) {
      if (result.warning) return <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger">{result.warning}</p>
      return (
        <p role="status" className={`rounded-xl px-3 py-2 font-medium ${result.picSaved ? 'bg-ok-soft text-ok' : 'bg-info-soft text-info'}`}>
          {result.picSaved ? `เปลี่ยนรูปม็อคอัพของงาน ${result.no} แล้ว · ข้อมูลอื่นในใบเหมือนเดิม` : `ใบ ${result.no} ตรงกับข้อมูลในงานอยู่แล้ว ไม่มีอะไรเปลี่ยน`}
        </p>
      )
    }
    return (
      <div role="status" className="grid gap-1 rounded-xl bg-ok-soft px-3 py-2 font-medium text-ok">
        <span>บันทึกการแก้ใบ {result.no} (แก้ไขครั้งที่ {result.rev}) เข้างานแล้ว · แจ้งทุกฝ่ายในกล่องจดหมายแล้ว</span>
        {result.parts.length > 1 && <span>งานนี้แบ่งแล้ว · สเปกใหม่ใช้กับทุกส่วน: {result.parts.join(', ')}</span>}
        {result.stale > 0 && <span className="text-warn">ม็อคอัพกำกับสเปกฉบับ {result.mockupRev} ยังเป็นค่าเก่า {result.stale} จุด · เปิดหน้าม็อคอัพของงานแล้วทำฉบับใหม่</span>}
        {result.warning && <span className="text-warn">{result.warning}</span>}
        <span className="text-sm font-normal text-ink">ลูกค้าเซ็นใบใหม่แล้ว แนบที่รายละเอียดงาน → "เปลี่ยนเป็นใบใหม่" (PDF หรือรูป)</span>
        {formInSameWindow() && <a href="/confirmation" className="mt-1 inline-flex min-h-12 items-center justify-self-start rounded-xl border border-ok/40 bg-card px-4 font-semibold text-ok">เปิดฟอร์มเพื่อส่งออก PDF ใบแก้ไข</a>}
      </div>
    )
  }
  if (!result.ok) return <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger">{result.text}</p>
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl bg-ok-soft px-3 py-2 font-medium text-ok">
      <span>บันทึกใบยืนยัน {result.no} เข้าระบบแล้ว</span>
      {result.reused && <span className="basis-full text-ink">งานเดิมเลขนี้ถูกยกเลิกแล้ว จึงบันทึกเป็นใบใหม่เลขเดิม (ไม่ใช่ใบแก้) · ส่งงานเข้าโรงงานแล้ว งานเก่าเปลี่ยนเลขเป็น "{result.no} (ยกเลิก)" ให้เอง</span>}
      {result.warning && <span className="basis-full text-warn">{result.warning}</span>}
      <button type="button" onClick={() => { setResult(null); onReceive(result.id) }}
        className="min-h-12 rounded-xl border border-ok/40 bg-card px-4 font-semibold text-ok">
        ส่งงานเข้าโรงงานเลย
      </button>
      {formInSameWindow() && <a href="/confirmation?next=1" className="inline-flex min-h-12 items-center rounded-xl border border-ok/40 bg-card px-4 font-semibold text-ok">ทำสินค้าถัดไป (ใช้ข้อมูลลูกค้าเดิม)</a>}
    </div>
  )
}
