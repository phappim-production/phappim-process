import { useEffect, useId, useState, type FormEvent } from 'react'
import { OUTSOURCEABLE, ROUTES, STATION_NAME, type Job } from '../proto/model'
import { MAX_MATERIAL_NAME, MAX_MATERIAL_PHOTOS, releaseBlocker, withItem, withoutItem, type MaterialItem, type MaterialPhoto } from '../data/materialsCheck'
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
      </div>
      <Checklist items={items} admin={admin} busy={busy} act={act} />
      <Photos job={job} photos={photos} urls={urls} admin={admin} busy={busy} act={act} />
      {admin && <Release key={blocker ?? 'ready'} job={job} blocker={blocker} busy={busy} now={now} act={act} />}
    </section>
  )
}

function Checklist({ items, admin, busy, act }: { items: MaterialItem[]; admin: boolean; busy: boolean; act: Act }) {
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState('')
  const inputId = useId()
  const [saved, setSaved] = useState<{ from: string; names: string[] } | null>(null)
  const loaded = items.map(m => m.name)
  const loadedKey = loaded.join('\n')
  // บันทึกแล้วแต่รายการยังโหลดไม่ทัน → แก้ครั้งถัดไปต้องอิงรายการที่เพิ่งบันทึก ไม่งั้นฐานข้อมูลเข้าใจว่าเครื่องอื่นแก้
  const names = saved && saved.from === loadedKey ? saved.names : loaded

  async function save(next: string[], ok: string) {
    const done = await act('set_job_materials', { p_items: next, p_base: names }, ok)
    if (done) setSaved({ from: loadedKey, names: next })
    return done
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const next = withItem(names, typed)
    if (!next.ok) { setProblem(next.reason); return }
    setProblem('')
    if (await save(next.names, `เพิ่ม "${next.names[next.names.length - 1]}" แล้ว`)) setTyped('')
  }

  return (
    <div className="grid gap-2">
      {items.length === 0 && (
        <p className="rounded-xl bg-warn-soft px-3 py-2 font-medium text-warn">
          <Tr th={admin ? 'ยังไม่มีรายการ · พิมพ์วัตถุดิบที่ต้องเช็คของงานนี้ทีละรายการ (เช่น ผ้า สี ด้าย ป้ายคอ)' : 'แอดมินยังไม่ได้ใส่รายการวัตถุดิบ'} />
        </p>
      )}
      {items.length > 0 && (
        <ul className="grid gap-2">
          {items.map(m => {
            const checked = !!m.checked_at
            return (
              <li key={m.id} className="flex items-center gap-2">
                {admin ? (
                  <button type="button" role="checkbox" aria-checked={checked} disabled={busy}
                    onClick={() => void act('check_material', { p_material_id: m.id, p_checked: !checked }, checked ? `ยกเลิกติ๊ก "${m.name}" แล้ว` : `ติ๊ก "${m.name}" แล้ว`, false)}
                    className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2 text-left disabled:opacity-60 ${checked ? 'border-ok/40 bg-ok-soft' : 'border-line bg-card hover:bg-brand-soft'}`}>
                    <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-md border-2 ${checked ? 'border-ok bg-ok text-white' : 'border-line'}`}>
                      {checked && <IconCheck className="size-5" />}
                    </span>
                    <span className="min-w-0 flex-1 break-words">{m.name}</span>
                  </button>
                ) : (
                  <p className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-line px-3 py-2">
                    {checked ? <IconCheck className="size-5 shrink-0 text-ok" /> : <IconClock className="size-5 shrink-0 text-warn" />}
                    <span className="min-w-0 flex-1 break-words">{m.name}</span>
                  </p>
                )}
                {admin && (
                  <button type="button" disabled={busy} aria-label={`ลบ "${m.name}" ออกจากรายการ`}
                    onClick={() => void save(withoutItem(names, m.name), `ลบ "${m.name}" ออกจากรายการแล้ว`)}
                    className="grid size-12 shrink-0 place-items-center rounded-xl border border-line text-danger hover:bg-danger-soft disabled:opacity-60">
                    <IconX className="size-5" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {admin && (
        <form onSubmit={e => void add(e)} className="grid gap-1">
          <label htmlFor={inputId} className="font-medium">เพิ่มรายการวัตถุดิบ</label>
          <div className="flex gap-2">
            <input id={inputId} value={typed} maxLength={MAX_MATERIAL_NAME} onChange={e => { setTyped(e.target.value); setProblem('') }}
              placeholder="เช่น ผ้าคอตตอน 32 สีขาว 150 หลา" className={fieldClass} enterKeyHint="done" />
            <button type="submit" disabled={busy || !typed.trim()} className={`${secondaryBtn} shrink-0`}>เพิ่ม</button>
          </div>
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
