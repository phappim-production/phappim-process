import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { rpc } from '../../data/useFactoryData'
import { invalidateStatic } from '../../data/staticCache'
import { Card, CardHeader, Pill } from '../../components/ui'
import { okBtn, secondaryBtn } from '../../components/Dialog'
import { IconCamera } from '../../components/icons'

type PhotoSettings = { enabledAt: string | null; remindMinutes: number; stations: { code: string; name: string; firstPiece: boolean }[] }
type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: PhotoSettings }

async function loadPhotoSettings(): Promise<PhotoSettings> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่าระบบ')
  const [settings, stations] = await Promise.all([
    supabase.from('station_photo_settings').select('enabled_at, remind_minutes').maybeSingle(),
    supabase.from('stations').select('code, name, first_piece_check').neq('code', 'outside').order('sort').order('code'),
  ])
  if (settings.error || stations.error) throw new Error('ฐานข้อมูลยังไม่มีระบบรูปยืนยันงาน แจ้งผู้พัฒนาให้ลง migration')
  const s = settings.data as { enabled_at: string | null; remind_minutes: number } | null
  return {
    enabledAt: s?.enabled_at ?? null,
    remindMinutes: s?.remind_minutes ?? 15,
    stations: (stations.data as { code: string; name: string; first_piece_check: boolean }[]).map(r => ({ code: r.code, name: r.name, firstPiece: r.first_piece_check })),
  }
}

// เจ้าของระบบเปิด/ปิดเอง · เปิดแล้วกฎใช้กับรอบสถานีที่กดเริ่มหลังจากนี้เท่านั้น
export function StationPhotoSettings({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    loadPhotoSettings().then(data => setState({ status: 'ready', data }), (e: unknown) => setState({ status: 'error', message: e instanceof Error ? e.message : 'โหลดไม่สำเร็จ' }))
  }, [])
  useEffect(reload, [reload])

  async function run(task: () => Promise<string | null>) {
    setBusy(true)
    setError(null)
    const problem = await task()
    setBusy(false)
    if (problem) setError(problem)
    invalidateStatic()
    reload()
  }
  const toggle = (on: boolean) => run(async () => { const r = await rpc('set_station_photos_enabled', { p_on: on }); return r.ok ? null : r.reason })
  const setFirstPiece = (code: string, on: boolean) => run(async () => {
    if (!supabase) return 'ยังไม่ได้ตั้งค่าระบบ'
    const r = await supabase.from('stations').update({ first_piece_check: on }).eq('code', code).select('code')
    return r.error || !r.data?.length ? 'บันทึกไม่สำเร็จ ไม่มีสิทธิ์หรือข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่' : null
  })

  return (
    <Card className="min-w-0">
      <CardHeader icon={IconCamera} title="รูปยืนยันงานที่สถานี" sub="ชิ้นแรกต้องให้แอดมิน/ผู้บริหารอนุมัติก่อนทำทั้งล็อต · ทุกสถานีต้องถ่ายรูปงานเสร็จก่อนกดเสร็จ" />
      <div className="grid gap-3 border-t border-line px-4 py-4 sm:px-5">
        {state.status === 'loading' && <p role="status" className="text-muted">กำลังโหลด…</p>}
        {state.status === 'error' && <p role="alert" className="text-danger">{state.message}</p>}
        {state.status === 'ready' && (() => {
          const d = state.data
          const on = d.enabledAt !== null
          return (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Pill tone={on ? 'ok' : 'neutral'}>{on ? 'เปิดใช้อยู่' : 'ปิดอยู่'}</Pill>
                {on && <span className="text-muted">ตั้งแต่ {new Date(d.enabledAt!).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })} · รอนานเกิน {d.remindMinutes} นาที เตือนผู้บริหาร + ฝ่ายผลิต</span>}
                {canEdit && (on
                  ? <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void toggle(false)}>ปิดใช้</button>
                  : <button type="button" disabled={busy} className={okBtn} onClick={() => void toggle(true)}>เปิดใช้</button>)}
              </div>
              {canEdit && (
                <label className="flex flex-wrap items-center gap-2">เตือนเมื่อรออนุมัติเกิน
                  <select className="min-h-12 rounded-xl border border-line bg-card px-3" value={d.remindMinutes} disabled={busy}
                    onChange={e => void run(async () => { const r = await rpc('set_station_photos_enabled', { p_on: on, p_remind_minutes: Number(e.target.value) }); return r.ok ? null : r.reason })}>
                    {[...new Set([5, 10, 15, 20, 30, 60, d.remindMinutes])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{m} นาที</option>)}
                  </select>
                </label>
              )}
              {!on && <p className="text-muted">เปิดแล้ว งานที่กำลังทำอยู่ไม่ต้องส่งรูป · เริ่มบังคับกับงานที่กดเริ่มสถานีหลังเปิด</p>}
              <fieldset className="grid gap-2">
                <legend className="mb-1 font-semibold">สถานีที่ต้องรออนุมัติชิ้นแรก</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {d.stations.map(s => (
                    <label key={s.code} className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3">
                      <input type="checkbox" className="size-5" checked={s.firstPiece} disabled={!canEdit || busy}
                        onChange={e => void setFirstPiece(s.code, e.target.checked)} />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-sm text-muted">สถานีที่ไม่ติ๊ก ถ่ายรูปงานเสร็จอย่างเดียว ไม่ต้องรออนุมัติ · เปลี่ยนแล้วมีผลกับงานที่กำลังทำที่สถานีนั้นทันที ควรเปลี่ยนตอนไม่มีงานค้างรออนุมัติ</p>
              </fieldset>
              {!canEdit && <p className="text-sm text-muted">เจ้าของระบบเป็นคนเปลี่ยนค่านี้</p>}
              {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger">{error}</p>}
            </>
          )
        })()}
      </div>
    </Card>
  )
}
