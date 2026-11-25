import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATION_NAME, type Job } from '../proto/model'
import { REJECT_REASONS, minutesWaiting, pendingFirstPieces, rejectText, signStationPhotos, type PendingFirstPiece as Pending } from '../data/stationPhotos'
import { Card, CardHeader, MockupThumb, Pill } from '../components/ui'
import { Dialog, dangerBtn, fieldClass, okBtn, secondaryBtn } from '../components/Dialog'
import { IconCamera, IconChevronRight, IconImage } from '../components/icons'
import { PhotoViewer } from '../components/PhotoViewer'
import { approveBlock } from '../data/photoViewer'

type Call = (name: string, args: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; reason: string }>

// แอดมิน/ผู้จัดการเห็นทุกหน้า: หน้างานหยุดรออยู่ ต้องตอบเร็ว
export function FirstPieceQueue({ jobs, now, call, onOpen }: { jobs: Job[]; now: Date; call: Call; onOpen: (id: string) => void }) {
  const [reviewing, setReviewing] = useState<Pending | null>(null)
  const pending = pendingFirstPieces(jobs)
  if (!pending.length) return null
  return (
    <Card>
      <CardHeader icon={IconCamera} tone="warn" title={`รออนุมัติชิ้นแรก ${pending.length} งาน`} sub="หน้างานหยุดรอ · ตรวจรูปเทียบม็อคอัพแล้วกดผ่าน / ไม่ผ่าน" />
      <ul className="divide-y divide-line border-t border-line">
        {pending.map(p => {
          const waited = minutesWaiting(p.at, now)
          return (
            <li key={p.checkId}>
              <button type="button" onClick={() => setReviewing(p)} className="flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-paper">
                <MockupThumb job={p.job} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><b>{p.job.no}</b>
                    <Pill tone={waited >= (p.job.photos?.remindMinutes ?? 15) ? 'danger' : 'warn'}>รอ {waited} นาที</Pill>
                    {p.job.station && <Pill tone="neutral">{STATION_NAME[p.job.station]}</Pill>}
                    {p.job.status === 'hold' && <Pill tone="danger">พักงานอยู่</Pill>}
                  </span>
                  <span className="block truncate text-sm text-muted">{p.job.customer} · {p.job.product} {p.job.qty.toLocaleString('th-TH')} {p.job.unit}</span>
                </span>
                <span className="font-semibold text-brand">ตรวจ</span>
                <IconChevronRight className="size-4 shrink-0 text-muted" />
              </button>
            </li>
          )
        })}
      </ul>
      {reviewing && <ReviewDialog item={reviewing} call={call} onOpen={onOpen} onClose={() => setReviewing(null)} />}
    </Card>
  )
}

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; urls: string[]; note: string | null }

function ReviewDialog({ item, call, onOpen, onClose }: { item: Pending; call: Call; onOpen: (id: string) => void; onClose: () => void }) {
  const { job: j } = item
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [rejecting, setRejecting] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [broken, setBroken] = useState(0)
  const sending = useRef(false)
  const block = approveBlock({ loading: loaded.status === 'loading', count: loaded.status === 'ready' ? loaded.urls.length : 0, broken })

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!supabase) { setLoaded({ status: 'error', message: 'ยังไม่ได้ตั้งค่าระบบ' }); return }
      const r = await supabase.from('station_checks').select('photos, note').eq('id', item.checkId).maybeSingle()
      if (!alive) return
      if (r.error || !r.data) { setLoaded({ status: 'error', message: 'โหลดรูปไม่สำเร็จ ปิดแล้วเปิดใหม่' }); return }
      const row = r.data as { photos: string[]; note: string | null }
      const signed = await signStationPhotos(row.photos)
      // รูปที่ขอลิงก์ไม่ได้ต้องนับเป็นรูปเปิดไม่ได้ ไม่ใช่ตัดทิ้ง ไม่งั้นแอดมินกดผ่านโดยไม่เห็นครบ
      if (alive) setLoaded({ status: 'ready', urls: row.photos.map(p => signed.get(p) ?? ''), note: row.note })
    })()
    return () => { alive = false }
  }, [item.checkId])

  async function decide(approve: boolean) {
    if (sending.current || (approve && block)) return
    const reason = rejectText(picked, detail)
    if (!approve && !reason) { setError('เลือกหรือพิมพ์เหตุผลที่ไม่ผ่าน ให้หน้างานรู้ว่าต้องแก้อะไร'); return }
    sending.current = true
    setBusy(true)
    setError(null)
    const r = await call('decide_first_piece', { p_check: item.checkId, p_approve: approve, p_reason: approve ? null : reason })
    sending.current = false
    setBusy(false)
    if (r.ok) onClose()
    else setError(r.reason)
  }

  return (
    <Dialog title={`ชิ้นแรก ${j.no}`} icon={IconCamera} onClose={onClose} wide>
      <p className="mt-1 text-muted">{j.customer} · {j.station ? STATION_NAME[j.station] : ''} · {j.product} {j.qty.toLocaleString('th-TH')} {j.unit}</p>
      <div className="mt-3">
        {loaded.status === 'loading' && <p role="status" className="grid aspect-[4/5] max-h-[48vh] place-items-center rounded-2xl bg-paper text-muted">กำลังโหลดรูป…</p>}
        {loaded.status === 'error' && <p role="alert" className="grid aspect-[4/5] max-h-[48vh] place-items-center rounded-2xl bg-danger-soft p-4 text-center text-danger">{loaded.message}</p>}
        {loaded.status === 'ready' && <PhotoViewer key={item.checkId} photos={loaded.urls} mockupUrl={j.mockupUrl} label={`ชิ้นแรก ${j.no}`} onBrokenChange={setBroken} />}
        {!j.mockupUrl && <p className="mt-2 flex items-center gap-2 text-sm text-muted"><IconImage className="size-4" />งานนี้ยังไม่มีม็อคอัพ · เทียบกับสเปกในรายละเอียดงานแทน</p>}
      </div>
      {loaded.status === 'ready' && loaded.note && <p className="mt-3 rounded-xl bg-paper px-3 py-2">หน้างานบอก: {loaded.note}</p>}
      <button type="button" className="mt-2 min-h-12 font-semibold text-brand" onClick={() => { onOpen(j.id); onClose() }}>ดูสเปกและรายละเอียดงาน</button>

      {rejecting ? (
        <div className="mt-2 grid gap-2 rounded-xl bg-danger-soft p-3">
          <p className="font-semibold text-danger">ไม่ผ่านเพราะ (เลือกได้หลายข้อ)</p>
          <div className="flex flex-wrap gap-2">
            {REJECT_REASONS.map(r => {
              const on = picked.includes(r)
              return (
                <button key={r} type="button" aria-pressed={on} onClick={() => setPicked(p => on ? p.filter(x => x !== r) : [...p, r])}
                  className={`min-h-12 rounded-xl border px-3 font-medium ${on ? 'border-danger bg-danger text-white' : 'border-line bg-card text-ink'}`}>{r}</button>
              )
            })}
          </div>
          <input value={detail} maxLength={200} onChange={e => setDetail(e.target.value)} className={fieldClass} placeholder="บอกเพิ่ม เช่น โลโก้ต่ำไป 2 ซม." />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} className={dangerBtn} onClick={() => void decide(false)}>{busy ? 'กำลังบันทึก…' : 'ยืนยันไม่ผ่าน'}</button>
            <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setRejecting(false)}>ยกเลิก</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} className={dangerBtn} onClick={() => setRejecting(true)}>ไม่ผ่าน…</button>
          <button type="button" disabled={busy || !!block} className={okBtn} onClick={() => void decide(true)}>
            {busy ? 'กำลังบันทึก…' : block === 'loading' ? 'รอรูปโหลด' : block === 'broken' ? 'มีรูปเปิดไม่ได้ · กดผ่านไม่ได้' : block ? 'ยังไม่เห็นรูป กดผ่านไม่ได้' : 'ผ่าน ทำทั้งล็อตได้'}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger">{error}</p>}
    </Dialog>
  )
}
