import { useEffect, useState } from 'react'
import { rpc } from '../data/useFactoryData'
import { SAVE_HASH, recentlyTaken, takeOutbox } from '../data/confirmationDrafts'
import { dataUrlBlob, mockupDataUrl, uploadMockup } from '../data/mockups'

type Result = { ok: true; no: string; id: string; warning?: string | undefined } | { ok: false; text: string } | { ok: 'elsewhere'; no: string }

/**
 * รับใบยืนยันที่ฟอร์มกด "บันทึกเข้าระบบ" (#/board?confirmation=save) แล้วบันทึกเข้าฐานข้อมูลด้วยบัญชีที่ล็อกอินอยู่
 * แสดงเฉพาะแอดมิน / เจ้าของระบบ (ฐานข้อมูลตรวจสิทธิ์ซ้ำ) · onReceive = เปิดหน้ารับงานพร้อมเลือกใบนี้
 */
export function ConfirmationOutbox({ onReceive }: { onReceive: (draftId: string) => void }) {
  const [result, setResult] = useState<Result | null>(null)

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
      // รูปม็อคอัพย่อจากฟอร์ม → Storage · ใบร่างเก็บแค่ path · อัปโหลดไม่ได้ = บันทึกใบต่อ (รูปเดิมยังอยู่) แล้วบอกให้รู้
      const { mockup, ...data } = item.data
      const pic = mockupDataUrl(mockup)
      let warning: string | undefined
      if (pic) {
        const up = await uploadMockup(item.no, dataUrlBlob(pic))
        if (up.ok) data.mockup_path = up.path
        else warning = `รูปม็อคอัพยังไม่เข้าระบบ (${up.reason}) · เพิ่มรูปได้ที่รายละเอียดงานหลังส่งงานเข้า`
      }
      const r = await rpc<string>('save_confirmation_draft', { p_data: data })
      if (!alive) return
      setResult(r.ok ? { ok: true, no: item.no, id: r.data, warning } : { ok: false, text: `บันทึกใบ ${item.no} ไม่สำเร็จ: ${r.reason}` })
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
  if (!result.ok) return <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger">{result.text}</p>
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl bg-ok-soft px-3 py-2 font-medium text-ok">
      <span>บันทึกใบยืนยัน {result.no} เข้าระบบแล้ว</span>
      {result.warning && <span className="basis-full text-warn">{result.warning}</span>}
      <button type="button" onClick={() => { setResult(null); onReceive(result.id) }}
        className="min-h-12 rounded-xl border border-ok/40 bg-card px-4 font-semibold text-ok">
        ส่งงานเข้าโรงงานเลย
      </button>
    </div>
  )
}
