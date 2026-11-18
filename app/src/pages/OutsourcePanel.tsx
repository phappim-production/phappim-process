import { useState } from 'react'
import { rpc } from '../data/useFactoryData'
import { OUTSOURCEABLE, ROUTES, STATION_NAME, isOutLate, telHref, type Job, type StationCode, type Vendor } from '../proto/model'
import { defaultBack, outSpan } from '../proto/outsource'
import { dangerBtn, fieldClass, okBtn, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconAlert, IconCheck, IconPackage } from '../components/icons'

// ส่งงานออกบริษัทภายนอก / ส่งต่อ / รับของกลับ / แบ่งงาน · แอดมินบันทึก (เจ้าของสั่ง 18 พ.ย.) · กฎทั้งหมดตรวจซ้ำที่ฐานข้อมูล
// ฟอร์มถาม 3 อย่างตามที่หน้างานใช้จริง: ของถึงบริษัทเมื่อไร · บริษัทใช้กี่วัน · ของถึงที่ต่อไปเมื่อไร

const pad = (n: number) => String(n).padStart(2, '0')
/** ค่า input datetime-local ตามเวลาเครื่อง */
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const fromLocal = (s: string) => (s ? new Date(s) : null)
const when = (d: Date) => d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.'
const stationList = (s: StationCode[]) => s.map(x => STATION_NAME[x]).join(' → ')

export function OutsourcePanel({ job: j, vendors, admin, now, refresh }: {
  job: Job; vendors: Vendor[]; admin: boolean; now: Date; refresh: () => Promise<void>
}) {
  const [mode, setMode] = useState<'send' | 'forward' | 'plan' | 'receive' | 'split' | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  async function act(name: string, args: Record<string, unknown>, ok: string) {
    setBusy(true); setNotice(null)
    const r = await rpc(name, args)
    if (r.ok) await refresh()
    setBusy(false)
    setNotice(r.ok ? { ok: true, text: ok } : { ok: false, text: r.reason })
    if (r.ok) setMode(null)
    return r.ok
  }

  const st = j.station
  const inStation = (j.phase === 'sample' || j.phase === 'production') && !!st
  const canSend = admin && inStation && j.status === 'queued' && !!st && OUTSOURCEABLE.includes(st)
  const canSplit = admin && j.phase === 'production' && j.status === 'queued' && !j.rework && st !== 'qc_pack' && j.qty > 1
  if (!j.out && !canSend && !canSplit) return null

  const out = j.out
  const late = isOutLate(j, now)
  const route = ROUTES[j.route].stations
  const nextAfterOut = out ? route[route.indexOf(out.stations[out.stations.length - 1]) + 1] : undefined
  const canForward = !!out && !out.rework && !!nextAfterOut && OUTSOURCEABLE.includes(nextAfterOut)

  return (
    <section className={`rounded-2xl border bg-card p-4 shadow-card ${late ? 'border-danger/50' : 'border-line'}`}>
      <h3 className="mb-3 flex items-center gap-2 font-semibold"><IconPackage className="size-5" />{out ? 'อยู่ที่บริษัทภายนอก' : 'ส่งออกบริษัทภายนอก / แบ่งงาน'}</h3>
      {notice && <p role={notice.ok ? 'status' : 'alert'} className={`mb-3 rounded-xl px-3 py-2 font-medium ${notice.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>{notice.text}</p>}

      {out && (
        <div className="grid gap-3">
          <dl className={`grid gap-1 rounded-xl px-3 py-2 ${late ? 'bg-danger-soft' : 'bg-info-soft'}`}>
            <div className="flex flex-wrap gap-x-2"><dt className="text-muted">บริษัท</dt><dd className="font-bold">{out.vendor}</dd></div>
            <div className="flex flex-wrap gap-x-2"><dt className="text-muted">ทำ</dt><dd className="font-semibold">{stationList(out.stations)}{out.rework ? ' (งานแก้)' : ''} · {out.qty.toLocaleString('th-TH')} {j.unit}</dd></div>
            <div className="flex flex-wrap gap-x-2"><dt className="text-muted">ของถึงบริษัท</dt><dd>{when(out.arriveAt)} · ใช้ {out.leadDays} วัน</dd></div>
            <div className="flex flex-wrap gap-x-2"><dt className="text-muted">คาดว่าของถึง{canForward ? 'ที่ต่อไป' : 'โรงงาน'}</dt>
              <dd className={late ? 'font-bold text-danger' : 'font-semibold'}>{when(out.backAt)}{late ? ' · เลยกำหนดแล้ว ตามบริษัท' : ''}</dd></div>
            {out.note && <div className="flex flex-wrap gap-x-2"><dt className="text-muted">หมายเหตุ</dt><dd>{out.note}</dd></div>}
          </dl>
          <ContactLinks phone={out.phone} mapUrl={out.mapUrl} />
          {!admin && <p className="text-muted">แอดมินเป็นคนบันทึกรับของกลับ · ระหว่างนี้กดเริ่มงานที่โรงงานไม่ได้</p>}
          {admin && mode === null && (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={`${okBtn} sm:col-span-2`} onClick={() => setMode('receive')}><IconCheck className="size-5" />ของถึงโรงงานแล้ว · รับเข้า</button>
              {canForward && <button type="button" className={secondaryBtn} onClick={() => setMode('forward')}>ส่งต่อบริษัทอื่น ({STATION_NAME[nextAfterOut!]})</button>}
              <button type="button" className={secondaryBtn} onClick={() => setMode('plan')}>แก้กำหนด</button>
            </div>
          )}
          {admin && mode === 'receive' && (
            <ReceiveForm busy={busy} next={out.rework ? 'QC + Packing (ตรวจงานแก้)' : nextAfterOut ? STATION_NAME[nextAfterOut] : '-'}
              onCancel={() => setMode(null)}
              onSave={note => act('receive_back', { p_run: out.id, p_note: note || null }, `รับ ${j.no} เข้าโรงงานแล้ว · ไปรอที่${out.rework ? ' QC + Packing' : nextAfterOut ? STATION_NAME[nextAfterOut] : ''}`)} />
          )}
          {admin && mode === 'forward' && nextAfterOut && (
            <PlanForm job={j} vendors={vendors.filter(v => v.id !== out.vendorId)} from={nextAfterOut} busy={busy} now={now} refresh={refresh}
              title={`ส่งต่อจาก ${out.vendor} ไปบริษัทอื่น (ไม่ผ่านโรงงาน)`} saveLabel="บันทึกส่งต่อ" onCancel={() => setMode(null)}
              onSave={p => act('forward_out', { p_run: out.id, p_vendor: p.vendor, p_last_station: p.last, p_arrive_at: p.arrive, p_lead_days: p.days, p_back_at: p.back, p_note: p.note || null },
                `ส่งต่อ ${j.no} แล้ว`)} />
          )}
          {admin && mode === 'plan' && (
            <PlanForm job={j} vendors={[]} from={out.stations[0]} busy={busy} now={now} refresh={refresh} planOnly initial={out}
              title="แก้กำหนด (บริษัทเลื่อน / ของถึงไม่ตรงที่คาด)" saveLabel="บันทึกกำหนดใหม่" onCancel={() => setMode(null)}
              onSave={p => act('update_out_plan', { p_run: out.id, p_arrive_at: p.arrive, p_lead_days: p.days, p_back_at: p.back }, 'บันทึกกำหนดใหม่แล้ว')} />
          )}
        </div>
      )}

      {!out && mode === null && (
        <div className="grid gap-2 sm:grid-cols-2">
          {canSend && <button type="button" className={primaryBtn} onClick={() => setMode('send')}>ส่งออกบริษัทภายนอก</button>}
          {canSplit && <button type="button" className={secondaryBtn} onClick={() => setMode('split')}>แบ่งจำนวน (ส่งออกบางส่วน)</button>}
          <p className="text-sm text-muted sm:col-span-2">ส่งออกได้ตอนงานยังไม่เริ่มสถานีนี้ · ส่งบางส่วน ให้กด "แบ่งจำนวน" ก่อน แล้วส่งออกงานที่แบ่ง</p>
        </div>
      )}
      {!out && mode === 'send' && st && (
        <PlanForm job={j} vendors={vendors} from={st} busy={busy} now={now} refresh={refresh}
          title={`ส่ง ${j.no} ออกบริษัทภายนอก`} saveLabel="บันทึกส่งออก" onCancel={() => setMode(null)}
          onSave={p => act('send_out', { p_job: j.id, p_vendor: p.vendor, p_last_station: p.last, p_arrive_at: p.arrive, p_lead_days: p.days, p_back_at: p.back, p_note: p.note || null },
            `ส่ง ${j.no} ออกแล้ว · ปุ่มเริ่มงานที่โรงงานจะกดไม่ได้จนกว่ารับของกลับ`)} />
      )}
      {!out && mode === 'split' && (
        <SplitForm job={j} busy={busy} onCancel={() => setMode(null)}
          onSave={qty => act('split_job', { p_job: j.id, p_qty: qty }, `แบ่ง ${qty.toLocaleString('th-TH')} ${j.unit} เป็นงานใหม่ ${j.no}-… แล้ว · เปิดงานใหม่เพื่อส่งออก`)} />
      )}
    </section>
  )
}

type Plan = { vendor: number; last: StationCode; arrive: string; days: number; back: string; note: string }

function PlanForm({ job: j, vendors, from, busy, now, refresh, title, saveLabel, planOnly, initial, onSave, onCancel }: {
  job: Job; vendors: Vendor[]; from: StationCode; busy: boolean; now: Date; refresh: () => Promise<void>
  title: string; saveLabel: string; planOnly?: boolean; initial?: { arriveAt: Date; leadDays: number; backAt: Date }
  onSave: (p: Plan) => Promise<boolean>; onCancel: () => void
}) {
  // งานแก้ทำเฉพาะสถานีต้นเหตุ
  const span = j.rework ? [from] : outSpan(j, from)
  // รายการส่งออกมีเฉพาะบริษัทที่รับงานไปทำ (ร้านขายวัตถุดิบไม่ขึ้น) · ที่รับงานสถานีนี้ขึ้นก่อน
  const outsourcers = vendors.filter(v => v.kind === 'outsource')
  const matching = outsourcers.filter(v => v.stations.includes(from))
  const others = outsourcers.filter(v => !v.stations.includes(from))
  const [vendor, setVendor] = useState<number | ''>(matching.length === 1 ? matching[0].id : '')
  const chosen = outsourcers.find(v => v.id === vendor)
  const [last, setLast] = useState<StationCode>(span[0])
  const start = initial?.arriveAt ?? new Date(Math.ceil(now.getTime() / 1_800_000) * 1_800_000)
  const [arrive, setArrive] = useState(toLocal(start))
  const [days, setDays] = useState(String(initial?.leadDays ?? 1))
  const [back, setBack] = useState(toLocal(initial?.backAt ?? defaultBack(start, 1)))
  const [backTouched, setBackTouched] = useState(!!initial)
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState('')

  const syncBack = (a: string, d: string) => {
    const ad = fromLocal(a)
    if (!backTouched && ad && Number.isFinite(Number(d))) setBack(toLocal(defaultBack(ad, Number(d))))
  }
  const a = fromLocal(arrive), b = fromLocal(back), n = Number(days)
  const problem = !planOnly && vendor === '' ? 'เลือกบริษัท'
    : !a ? 'ใส่วันเวลาที่ของถึงบริษัท'
    : !(n >= 0 && n <= 60) ? 'จำนวนวันที่บริษัทใช้ 0–60 วัน'
    : !b ? 'ใส่วันเวลาที่คาดว่าของถึงที่ต่อไป'
    : b < a ? 'วันของถึงที่ต่อไป ต้องไม่ก่อนวันของถึงบริษัท' : null

  async function addVendor() {
    const r = await rpc<number>('add_vendor', { p_name: newName.trim(), p_stations: span, p_contact: null })
    if (!r.ok) { setAddError(r.reason); return }
    await refresh()
    setVendor(Number(r.data)); setAdding(false); setNewName(''); setAddError('')
  }

  return (
    <div className="grid gap-3 rounded-xl bg-paper p-3">
      <p className="font-semibold">{title}</p>
      {!planOnly && (
        <>
          <label className="grid gap-1 font-medium">บริษัท
            <select value={vendor} onChange={e => setVendor(e.target.value ? Number(e.target.value) : '')} className={fieldClass}>
              <option value="">— เลือกบริษัท —</option>
              {matching.length > 0 && (
                <optgroup label={`บริษัทที่รับ: ${STATION_NAME[from]}`}>
                  {matching.map(v => <option key={v.id} value={v.id}>{v.name}{v.specialty ? ` · ${v.specialty}` : ''}</option>)}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="บริษัทอื่น">
                  {others.map(v => <option key={v.id} value={v.id}>{v.name}{v.specialty ? ` · ${v.specialty}` : ''}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          {chosen && (
            <div className="grid gap-1 rounded-xl border border-line bg-card px-3 py-2 text-sm">
              {chosen.specialty && <p><span className="text-muted">รับงาน </span>{chosen.specialty}</p>}
              {chosen.address && <p className="text-muted">{chosen.address}</p>}
              {chosen.contact && <p><span className="text-muted">ติดต่อ </span>{chosen.contact}</p>}
              <ContactLinks phone={chosen.phone} mapUrl={chosen.mapUrl} />
            </div>
          )}
          {adding ? (
            <div className="grid gap-2">
              <div className="flex gap-2">
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ชื่อบริษัทใหม่" aria-label="ชื่อบริษัทใหม่" className={fieldClass} />
                <button type="button" disabled={!newName.trim()} className={secondaryBtn} onClick={() => void addVendor()}>เพิ่ม</button>
              </div>
              {addError && <p role="alert" className="text-danger">{addError}</p>}
            </div>
          ) : <button type="button" className="min-h-11 justify-self-start font-semibold text-brand underline" onClick={() => setAdding(true)}>+ เพิ่มบริษัทใหม่</button>}
          <label className="grid gap-1 font-medium">บริษัททำถึงสถานี
            <select value={last} onChange={e => setLast(e.target.value as StationCode)} className={fieldClass} disabled={span.length < 2}>
              {span.map((s, i) => <option key={s} value={s}>{span.slice(0, i + 1).map(x => STATION_NAME[x]).join(' → ')}</option>)}
            </select>
          </label>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 font-medium">ของถึงบริษัท (วัน เวลา)
          <input type="datetime-local" value={arrive} onChange={e => { setArrive(e.target.value); syncBack(e.target.value, days) }} className={fieldClass} />
        </label>
        <label className="grid gap-1 font-medium">บริษัทใช้เวลาทำ (วัน)
          <input type="number" min={0} max={60} step={0.5} inputMode="decimal" value={days} onChange={e => { setDays(e.target.value); syncBack(arrive, e.target.value) }} className={fieldClass} />
        </label>
      </div>
      <label className="grid gap-1 font-medium">คาดว่าของถึง{planOnly ? 'ที่ต่อไป' : ' โรงงาน / บริษัทถัดไป'} (วัน เวลา)
        <input type="datetime-local" value={back} onChange={e => { setBack(e.target.value); setBackTouched(true) }} className={fieldClass} />
      </label>
      {!planOnly && (
        <label className="grid gap-1 font-medium">หมายเหตุ (ไม่บังคับ)
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น ส่งรถบริษัท · คนรับของ" className={fieldClass} />
        </label>
      )}
      {problem && <p className="flex items-center gap-2 text-sm font-medium text-warn"><IconAlert className="size-4" />{problem}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || !!problem} className={primaryBtn}
          onClick={() => a && b && void onSave({ vendor: Number(vendor), last, arrive: a.toISOString(), days: n, back: b.toISOString(), note: note.trim() })}>
          {busy ? 'กำลังบันทึก…' : problem ? 'กรอกให้ครบก่อน' : saveLabel}
        </button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  )
}

function ReceiveForm({ busy, next, onSave, onCancel }: { busy: boolean; next: string; onSave: (note: string) => Promise<boolean>; onCancel: () => void }) {
  const [note, setNote] = useState('')
  return (
    <div className="grid gap-2 rounded-xl bg-ok-soft p-3">
      <p className="font-semibold">ยืนยันของถึงโรงงานแล้ว? งานจะไปรอที่ {next}</p>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="หมายเหตุ เช่น ได้ครบ / ขาด 2 ตัว (ไม่บังคับ)" aria-label="หมายเหตุรับของ" className={fieldClass} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} className={okBtn} onClick={() => void onSave(note.trim())}>{busy ? 'กำลังบันทึก…' : 'ยืนยันรับของ'}</button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  )
}

function SplitForm({ job: j, busy, onSave, onCancel }: { job: Job; busy: boolean; onSave: (qty: number) => Promise<boolean>; onCancel: () => void }) {
  const [qty, setQty] = useState('')
  const n = Math.floor(Number(qty))
  const valid = n >= 1 && n < j.qty
  return (
    <div className="grid gap-2 rounded-xl bg-paper p-3">
      <p className="font-semibold">แบ่ง {j.no} ({j.qty.toLocaleString('th-TH')} {j.unit}) เป็น 2 งาน</p>
      <label className="grid gap-1 font-medium">จำนวนที่แยกเป็นงานใหม่ ({j.unit})
        <input type="number" min={1} max={j.qty - 1} inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} className={fieldClass} />
      </label>
      {valid && <p className="text-sm text-muted">งานเดิมเหลือ {(j.qty - n).toLocaleString('th-TH')} · งานใหม่ {n.toLocaleString('th-TH')} {j.unit} อยู่สถานีเดียวกัน คิวถัดจากงานเดิม</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || !valid} className={valid ? primaryBtn : dangerBtn} onClick={() => void onSave(n)}>
          {busy ? 'กำลังบันทึก…' : valid ? 'บันทึกแบ่งงาน' : `ใส่ 1–${(j.qty - 1).toLocaleString('th-TH')}`}
        </button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  )
}

/** ปุ่มโทร / เปิดแผนที่ของบริษัท (ข้อมูลจากชีต Supplier) · ไม่มีข้อมูล = ไม่แสดง */
export function ContactLinks({ phone, mapUrl }: { phone?: string; mapUrl?: string }) {
  const tel = telHref(phone)
  if (!tel && !mapUrl) return null
  return (
    <div className="flex flex-wrap gap-2">
      {tel && <a href={tel} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-line bg-card px-3 font-semibold text-brand hover:bg-brand-soft">โทร {phone}</a>}
      {mapUrl && <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-line bg-card px-3 font-semibold text-brand hover:bg-brand-soft">เปิดแผนที่</a>}
    </div>
  )
}
