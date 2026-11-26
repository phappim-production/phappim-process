import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { OUTSOURCEABLE, ROUTES, STATION_NAME, type Job } from '../proto/model'
import { MAX_MATERIAL_NAME, MAX_MATERIAL_PHOTOS, addProblem, cleanName, arrival, fromBangkokInput, materialsOutlook, releaseBlocker, toBangkokInput, toLine, withoutItem, type Arrival, type MaterialItem, type MaterialPhoto } from '../data/materialsCheck'
import { yearOutOfRange } from '../proto/format'
import { mockupProblem, mockupThumbUrl, shrinkImage, signMockups, uploadMockup } from '../data/mockups'
import { leadTimeFor } from '../proto/leadTime'
import { fieldClass, okBtn, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconCamera, IconCheck, IconClock, IconX } from '../components/icons'
import { Tr } from '../i18n/Tr'
import { useT, type Word } from '../i18n/lang'

type Act = (name: string, args: Record<string, unknown>, ok: Word | string, withJob?: boolean) => Promise<boolean>

export function MaterialsCheck({ job, items, photos, admin, busy, now, act }: {
  job: Job; items: MaterialItem[]; photos: MaterialPhoto[]; admin: boolean; busy: boolean; now: Date; act: Act
}) {
  const urls = usePhotoUrls(photos)
  const done = items.filter(m => m.checked_at).length
  const outlook = materialsOutlook(items.map(toLine), now)
  const blocker = releaseBlocker(items, photos.length)
  return (
    <section className="grid gap-3 rounded-2xl border border-warn/40 bg-card p-4 shadow-card">
      <div className="grid gap-1">
        <h3 className="flex items-center gap-2 font-semibold"><IconClock className="size-5 text-warn" /><Tr inline th="รอผลิต · เช็ควัตถุดิบ" /></h3>
        <p className="text-muted">
          <Tr th="งานยังไม่เข้าคิวสถานี · แอดมินเช็ควัตถุดิบครบ + ถ่ายรูป แล้วกดปล่อยเข้าไลน์การผลิต" />
        </p>
        {admin && OUTSOURCEABLE.includes(ROUTES[job.route].stations[0]) && <p className="text-sm text-muted">ส่งออกบริษัทภายนอก (บริษัทจัดหาวัตถุดิบเอง) ไม่ต้องเช็ค · กด "ส่งออกบริษัทภายนอก" ด้านบน</p>}
        <p className="font-medium"><Tr th="ติ๊กแล้ว {done}/{n} รายการ · รูป {m} รูป" vars={{ done, n: items.length, m: photos.length }} /></p>
        {outlook.unset > 0 && (
          <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn"><Tr th={'ยังไม่ใส่วันคาดว่าได้รับ {n} รายการ · กด "ใส่วันที่คาดว่าได้รับ" ใต้รายการ'} vars={{ n: outlook.unset }} /></p>
        )}
        {outlook.late.length > 0 && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-semibold text-danger">
            <Tr th="วัตถุดิบเลยกำหนดรับ {n} รายการ: {names} · ตามของ แล้วติ๊กเมื่อได้รับ หรือเลื่อนวันที่" vars={{ n: outlook.late.length, names: outlook.late.map(l => l.name).join(', ') }} />
          </p>
        )}
      </div>
      <Checklist items={items} admin={admin} busy={busy} now={now} act={act} />
      <Photos job={job} photos={photos} urls={urls} admin={admin} busy={busy} act={act} />
      {admin && <Release key={blocker ?? 'ready'} job={job} blocker={blocker} busy={busy} now={now} act={act} />}
    </section>
  )
}

const ARRIVAL_STYLE: Record<Arrival, string> = {
  received: 'text-ok', late: 'font-semibold text-danger', today: 'font-semibold text-warn', later: 'text-muted', unset: 'font-medium text-warn',
}

function ArrivalNote({ item, now }: { item: MaterialItem; now: Date }) {
  const line = toLine(item)
  const state = arrival(line, now)
  const at = { at: line.eta ? { at: line.eta, time: true } : '' }
  return (
    <span className={`text-sm ${ARRIVAL_STYLE[state]}`}>
      {state === 'received' && item.checked_at && <Tr inline th="ได้รับแล้ว {at} น." vars={{ at: { at: new Date(item.checked_at), time: true } }} />}
      {state === 'late' && <Tr inline th="เลยกำหนดรับ {at} น." vars={at} />}
      {state === 'today' && <Tr inline th="ถึงวันนี้ {at} น." vars={at} />}
      {state === 'later' && <Tr inline th="คาดว่าได้รับ {at} น." vars={at} />}
      {state === 'unset' && <Tr inline th="ยังไม่ใส่วันคาดว่าได้รับ" />}
    </span>
  )
}

function EtaEditor({ item, busy, act, onDone }: { item: MaterialItem; busy: boolean; act: Act; onDone: () => void }) {
  const [value, setValue] = useState(item.eta ? toBangkokInput(new Date(item.eta)) : '')
  const [problem, setProblem] = useState('')
  const inputId = useId()
  async function save(e: FormEvent) {
    e.preventDefault()
    const eta = fromBangkokInput(value)
    if (!eta) { setProblem(`เลือกวันเวลาที่คาดว่าจะได้รับ "${item.name}"`); return }
    if (yearOutOfRange(value)) { setProblem('ปีไม่ถูกต้อง · ระบบใช้ปี ค.ศ. (พ.ศ. 2569 = ค.ศ. 2026) เลือกจากปฏิทินใหม่'); return }
    if (await act('set_material_eta', { p_material_id: item.id, p_eta: eta.toISOString() }, `บันทึกวันที่คาดว่าได้รับ "${item.name}" แล้ว`, false)) onDone()
  }
  return (
    <form onSubmit={e => void save(e)} className="grid gap-2 rounded-xl bg-paper p-2">
      <label htmlFor={inputId} className="text-sm font-medium">วันเวลาที่คาดว่าจะได้รับ "{item.name}" (เวลาไทย)</label>
      <input id={inputId} type="datetime-local" value={value} onChange={e => { setValue(e.target.value); setProblem('') }} className={fieldClass} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !value} className={primaryBtn}>บันทึกวันที่</button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={onDone}>ยกเลิก</button>
      </div>
      {problem && <p role="alert" className="text-danger">{problem}</p>}
    </form>
  )
}

function Checklist({ items, admin, busy, now, act }: { items: MaterialItem[]; admin: boolean; busy: boolean; now: Date; act: Act }) {
  const [typed, setTyped] = useState('')
  const [eta, setEta] = useState('')
  const [have, setHave] = useState(false)
  const [problem, setProblem] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const inputId = useId()
  const etaId = useId()
  const [saved, setSaved] = useState<{ from: string; names: string[] } | null>(null)
  // busy จากหน้าแม่ยังไม่ทันเปลี่ยนตอนกด Enter รัว จึงกันด้วย ref ในตัวเอง
  const adding = useRef(false)
  const loaded = items.map(m => m.name)
  const loadedKey = loaded.join('\n')
  // บันทึกแล้วแต่รายการยังโหลดไม่ทัน → แก้ครั้งถัดไปต้องอิงรายการที่เพิ่งบันทึก ไม่งั้นฐานข้อมูลเข้าใจว่าเครื่องอื่นแก้
  const names = saved && saved.from === loadedKey ? saved.names : loaded

  async function remove(name: string) {
    const next = withoutItem(names, name)
    if (await act('set_job_materials', { p_items: next, p_base: names }, `ลบ "${name}" ออกจากรายการแล้ว`)) setSaved({ from: loadedKey, names: next })
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (busy || adding.current) return
    const bad = addProblem(names, typed, have ? '' : eta, have)
    if (bad) { setProblem(bad); return }
    setProblem('')
    const name = cleanName(typed)
    const when = have ? null : fromBangkokInput(eta)
    adding.current = true
    try {
      if (await act('add_job_material', { p_name: name, p_eta: when?.toISOString() ?? null, p_have: have }, have ? `เพิ่ม "${name}" (มีของแล้ว) แล้ว` : `เพิ่ม "${name}" แล้ว`)) {
        setSaved({ from: loadedKey, names: [...names, name] })
        setTyped(''); setEta(''); setHave(false)
      }
    } finally {
      adding.current = false
    }
  }

  return (
    <div className="grid gap-2">
      {items.length === 0 && (
        <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn">
          <Tr th={admin ? 'ยังไม่มีรายการ · เพิ่มวัตถุดิบที่ต้องเช็คของงานนี้ทีละรายการ พร้อมวันเวลาที่คาดว่าจะได้รับ' : 'แอดมินยังไม่ได้ใส่รายการวัตถุดิบ'} />
        </p>
      )}
      {items.length > 0 && (
        <ul className="grid gap-2">
          {items.map(m => {
            const checked = !!m.checked_at
            return (
              <li key={m.id} className="grid gap-1">
                <div className="flex items-center gap-2">
                  {admin ? (
                    <button type="button" role="checkbox" aria-checked={checked} disabled={busy}
                      onClick={() => void act('check_material', { p_material_id: m.id, p_checked: !checked }, checked ? `ยกเลิกติ๊ก "${m.name}" แล้ว${m.eta ? '' : ' · กด "เลื่อนวันที่คาดว่าได้รับ" ใส่วันที่ของจะมา'}` : `ติ๊ก "${m.name}" แล้ว (ได้รับของแล้ว)`, false)}
                      className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2 text-left disabled:opacity-60 ${checked ? 'border-ok/40 bg-ok-soft' : 'border-line bg-card hover:bg-brand-soft'}`}>
                      <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-md border-2 ${checked ? 'border-ok bg-ok text-white' : 'border-line'}`}>
                        {checked && <IconCheck className="size-5" />}
                      </span>
                      <span className="grid min-w-0 flex-1">
                        <span className="break-words">{m.name}</span>
                        <ArrivalNote item={m} now={now} />
                      </span>
                    </button>
                  ) : (
                    <p className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-line px-3 py-2">
                      {checked ? <IconCheck className="size-5 shrink-0 text-ok" /> : <IconClock className="size-5 shrink-0 text-warn" />}
                      <span className="grid min-w-0 flex-1">
                        <span className="break-words">{m.name}</span>
                        <ArrivalNote item={m} now={now} />
                      </span>
                    </p>
                  )}
                  {admin && (
                    <button type="button" disabled={busy} aria-label={`ลบ "${m.name}" ออกจากรายการ`}
                      onClick={() => void remove(m.name)}
                      className="grid size-12 shrink-0 place-items-center rounded-xl border border-line text-danger hover:bg-danger-soft disabled:opacity-60">
                      <IconX className="size-5" />
                    </button>
                  )}
                </div>
                {admin && !checked && editing !== m.id && (
                  <button type="button" disabled={busy} className={`${secondaryBtn} justify-self-start`} onClick={() => setEditing(m.id)}>
                    <IconClock className="size-5" />{m.eta ? 'เลื่อนวันที่คาดว่าได้รับ' : 'ใส่วันที่คาดว่าได้รับ'}
                  </button>
                )}
                {admin && !checked && editing === m.id && <EtaEditor item={m} busy={busy} act={act} onDone={() => setEditing(null)} />}
              </li>
            )
          })}
        </ul>
      )}
      {admin && (
        <form onSubmit={e => void add(e)} className="grid gap-2 rounded-xl border border-line p-3">
          <label htmlFor={inputId} className="font-medium">เพิ่มรายการวัตถุดิบ</label>
          <input id={inputId} value={typed} maxLength={MAX_MATERIAL_NAME} onChange={e => { setTyped(e.target.value); setProblem('') }}
            placeholder="เช่น ผ้าคอตตอน 32 สีขาว 150 หลา" className={fieldClass} enterKeyHint="next" />
          <label htmlFor={etaId} className={`font-medium ${have ? 'text-muted' : ''}`}>วันเวลาที่คาดว่าจะได้รับ (เวลาไทย)</label>
          <input id={etaId} type="datetime-local" value={have ? '' : eta} disabled={have} onChange={e => { setEta(e.target.value); setProblem('') }} className={fieldClass} />
          <label className="flex min-h-12 items-center gap-3 font-medium">
            <input type="checkbox" checked={have} onChange={e => { setHave(e.target.checked); setProblem('') }} className="size-6 accent-ok" />
            มีของแล้ว (ติ๊กว่าได้รับเลย ไม่ต้องใส่วันที่)
          </label>
          <button type="submit" disabled={busy || !typed.trim()} className={secondaryBtn}>เพิ่ม</button>
          {problem && <p role="alert" className="text-danger">{problem}</p>}
        </form>
      )}
    </div>
  )
}

function usePhotoUrls(photos: MaterialPhoto[]) {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())
  const key = photos.map(p => p.path).join('|')
  useEffect(() => {
    let alive = true
    const paths = key ? key.split('|') : []
    if (paths.length) void signMockups(paths).then(u => { if (alive) setUrls(u) })
    return () => { alive = false }
  }, [key])
  return urls
}

function Photos({ job, photos, urls, admin, busy, act }: {
  job: Job; photos: MaterialPhoto[]; urls: ReadonlyMap<string, string>; admin: boolean; busy: boolean; act: Act
}) {
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState('')
  const inputId = useId()
  const t = useT()
  const room = MAX_MATERIAL_PHOTOS - photos.length

  async function upload(files: File[]) {
    setProblem('')
    const picked = files.slice(0, Math.max(0, room))
    if (!picked.length) { setProblem(`รูปวัตถุดิบไม่เกิน ${MAX_MATERIAL_PHOTOS} รูปต่องาน · ลบรูปที่ซ้ำออกก่อน`); return }
    setUploading(true)
    const paths: string[] = []
    for (const [i, file] of picked.entries()) {
      const bad = mockupProblem(file)
      if (bad) { setUploading(false); setProblem(`รูปที่ ${i + 1}: ${bad}`); return }
      const up = await uploadMockup(job.no, await shrinkImage(file))
      if (!up.ok) { setUploading(false); setProblem(`รูปที่ ${i + 1}: ${up.reason}`); return }
      paths.push(up.path)
    }
    setUploading(false)
    await act('add_material_photos', { p_paths: paths },
      files.length > picked.length ? `เพิ่มรูปวัตถุดิบ ${paths.length} รูป · ไม่ได้ใส่อีก ${files.length - picked.length} รูปที่เกิน ${MAX_MATERIAL_PHOTOS} รูป` : `เพิ่มรูปวัตถุดิบ ${paths.length} รูปแล้ว`)
  }

  return (
    <div className="grid gap-2">
      <h4 className="font-semibold"><Tr inline th="รูปวัตถุดิบ" /></h4>
      {photos.length === 0 && !admin && <p className="text-muted"><Tr th="ยังไม่มีรูปวัตถุดิบ" /></p>}
      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-5 pt-2">
          {photos.map((p, i) => {
            const url = urls.get(p.path)
            return (
              <li key={p.id} className="relative">
                {url
                  ? <a href={url} target="_blank" rel="noreferrer"><img src={mockupThumbUrl(url)} alt={t('รูปที่ {n}', { n: i + 1 })} className="size-24 rounded-lg border border-line object-cover" /></a>
                  : <span className="grid size-24 place-items-center rounded-lg border border-line bg-paper text-sm text-muted"><Tr th="รูปที่ {n}" vars={{ n: i + 1 }} /></span>}
                {admin && (
                  <button type="button" disabled={busy || uploading} aria-label={`ลบรูปที่ ${i + 1}`}
                    onClick={() => void act('remove_material_photo', { p_id: p.id }, `ลบรูปที่ ${i + 1} แล้ว`, false)}
                    className="absolute -top-4 -right-4 grid size-12 place-items-center text-danger disabled:opacity-60">
                    <span className="grid size-8 place-items-center rounded-full border border-line bg-card"><IconX className="size-4" /></span>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {admin && (<>
        {/* ไม่ใส่ capture: มือถือให้เลือกถ่ายใหม่หรือเลือกจากคลังรูปได้ */}
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={busy || uploading || room <= 0}
          onChange={e => { const picked = [...(e.target.files ?? [])]; e.target.value = ''; if (picked.length) void upload(picked) }} />
        <label htmlFor={inputId} aria-disabled={busy || uploading || room <= 0}
          className={`${photos.length ? secondaryBtn : primaryBtn} ${busy || uploading || room <= 0 ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
          <IconCamera className="size-5 shrink-0" />
          {uploading ? 'กำลังอัปโหลดรูป…' : room <= 0 ? `ครบ ${MAX_MATERIAL_PHOTOS} รูปแล้ว` : photos.length ? 'ถ่าย / เลือกรูปเพิ่ม' : 'ถ่าย / เลือกรูปวัตถุดิบ'}
        </label>
        {problem && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger">{problem}</p>}
      </>)}
    </div>
  )
}

function Release({ job, blocker, busy, now, act }: { job: Job; blocker: string | null; busy: boolean; now: Date; act: Act }) {
  const [confirm, setConfirm] = useState(false)
  const first = STATION_NAME[ROUTES[job.route].stations[0]]
  const where = job.needsSample === false ? `เข้าคิวสถานี${first}` : 'ไปขึ้นตัวอย่างที่สถานีแรก'
  const lead = leadTimeFor(now, job.qty)

  if (blocker) {
    return (
      <div className="grid gap-1">
        <button type="button" disabled className={okBtn}>ปล่อยเข้าไลน์การผลิต</button>
        <p className="text-warn">{blocker}</p>
      </div>
    )
  }
  if (!confirm) return <button type="button" disabled={busy} className={okBtn} onClick={() => setConfirm(true)}><IconCheck className="size-5" />ปล่อยเข้าไลน์การผลิต</button>
  return (
    <div className="grid gap-2 rounded-xl bg-ok-soft p-3">
      <p className="font-medium">ปล่อย {job.no} เข้าไลน์การผลิต: {where}</p>
      <p className="text-muted">งานต่อท้ายคิว · เวลาผลิต {lead.days} วันทำงานเริ่มนับวันนี้ · ปล่อยแล้วแก้รายการวัตถุดิบและรูปไม่ได้</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={okBtn}
          onClick={() => void act('release_job', {}, `ปล่อย ${job.no} เข้าไลน์การผลิตแล้ว · ${where}`).then(ok => { if (!ok) setConfirm(false) })}>
          <IconCheck className="size-5" />ยืนยันปล่อยเข้าไลน์
        </button>
        <button type="button" disabled={busy} className={secondaryBtn} onClick={() => setConfirm(false)}>ยังไม่ปล่อย</button>
      </div>
    </div>
  )
}
