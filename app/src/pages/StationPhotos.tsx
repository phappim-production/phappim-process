import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Job, PhotoGate } from '../proto/model'
import { MAX_PHOTOS, minutesWaiting, photoStep, uploadStationPhotos } from '../data/stationPhotos'
import { fieldClass, okBtn, primaryBtn, secondaryBtn } from '../components/Dialog'
import { IconCamera, IconCheck, IconClock, IconX } from '../components/icons'
import { TONE } from '../components/tone'
import { Tr } from '../i18n/Tr'
import { useT } from '../i18n/lang'

export type PhotoSend = (name: 'submit_first_piece' | 'add_finish_photos', args: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; reason: string }>

export function StationPhotoPanel({ job, gate, canSend, now, send }: { job: Job; gate: PhotoGate; canSend: boolean; now: Date; send: PhotoSend }) {
  const step = photoStep(gate)
  const fp = gate.firstPiece
  if (step === 'wait' && fp) {
    const waited = minutesWaiting(fp.at, now)
    const late = waited >= gate.remindMinutes
    const toReminder = Math.min(100, Math.round((waited / Math.max(1, gate.remindMinutes)) * 100))
    return (
      <div className={`grid gap-1.5 rounded-xl px-3 py-2.5 ${late ? TONE.danger.soft : TONE.warn.soft}`} role="status">
        <p className="flex items-center gap-2 font-semibold"><IconClock className="size-5 shrink-0" /><Tr th="ชิ้นแรกรออนุมัติ {n} นาที" vars={{ n: waited }} /></p>
        <p className="text-base"><Tr th="อย่าเพิ่งทำทั้งล็อต รอแอดมินกดผ่านก่อน" /></p>
        <span aria-hidden className="h-1 overflow-hidden rounded-full bg-white/70"><span className={`block h-full rounded-full ${late ? 'bg-danger' : 'bg-warn'}`} style={{ width: `${toReminder}%` }} /></span>
      </div>
    )
  }
  if (step === 'ready') {
    return (
      <div className={`grid gap-2 rounded-xl px-3 py-2 ${TONE.ok.soft}`}>
        <p className="flex items-center gap-2 font-semibold"><IconCheck className="size-5 shrink-0" /><Tr th="ส่งรูปงานเสร็จแล้ว {n} รูป · กดเสร็จได้" vars={{ n: gate.finishPhotos }} /></p>
        {canSend && (
          <details>
            <summary className="min-h-12 cursor-pointer content-center font-medium"><Tr th="ส่งรูปงานเสร็จเพิ่ม" /></summary>
            <PhotoPicker kind="finish" jobNo={job.no}
              onSend={async files => {
                const up = await uploadStationPhotos(gate, files)
                return up.ok ? send('add_finish_photos', { p_station: gate.station, p_photos: up.paths }) : up
              }} />
          </details>
        )}
      </div>
    )
  }
  const first = step === 'first_piece' || step === 'rejected'
  const approved = !first && gate.needsFirstPiece
  return (
    <div className={`grid gap-2 rounded-xl p-3 ${step === 'rejected' ? 'bg-danger-soft' : approved ? 'bg-gold-soft ring-1 ring-gold/40' : 'bg-info-soft'}`}>
      {approved && (
        <span aria-hidden className="grid size-10 place-items-center rounded-full border-2 border-gold bg-ok-soft text-ok"><IconCheck className="size-5" /></span>
      )}
      {step === 'rejected' && fp?.reason && (
        <p className="font-semibold text-danger"><Tr th="ชิ้นแรกไม่ผ่าน: {reason}" vars={{ reason: fp.reason.split(' · ').map(th => ({ th })) }} /></p>
      )}
      <p className={`font-semibold ${step === 'rejected' ? 'text-danger' : approved ? 'text-ok' : 'text-info'}`}>
        <Tr th={first
          ? (step === 'rejected' ? 'แก้แล้วทำชิ้นแรกใหม่ 1 ชิ้น ถ่ายรูปส่งให้แอดมินตรวจ' : 'ทำชิ้นแรก 1 ชิ้น แล้วถ่ายรูปส่งให้แอดมินตรวจ · อย่าเพิ่งทำทั้งล็อต')
          : gate.needsFirstPiece ? 'ชิ้นแรกผ่านแล้ว ทำทั้งล็อตได้ · ทำเสร็จแล้วถ่ายรูปงานเสร็จ' : 'ทำเสร็จแล้วถ่ายรูปงานเสร็จ อย่างน้อย 1 รูป'} />
      </p>
      {canSend
        ? <PhotoPicker key={`${step}-${fp?.id ?? 0}`} kind={first ? 'first' : 'finish'} jobNo={job.no}
            onSend={async (files, note) => {
              const up = await uploadStationPhotos(gate, files)
              if (!up.ok) return up
              return send(first ? 'submit_first_piece' : 'add_finish_photos',
                first ? { p_station: gate.station, p_photos: up.paths, p_note: note || null } : { p_station: gate.station, p_photos: up.paths })
            }} />
        : <p className="text-base text-muted"><Tr th="หัวหน้าสถานีเป็นคนถ่ายรูปส่ง" /></p>}
    </div>
  )
}

function PhotoPicker({ kind, jobNo, onSend }: {
  kind: 'first' | 'finish'; jobNo: string
  onSend: (files: Blob[], note: string) => Promise<{ ok: true } | { ok: false; reason: string }>
}) {
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)
  const inputId = useId()
  const t = useT()
  const previews = usePreviews(files)
  const full = files.length >= MAX_PHOTOS

  async function submit() {
    if (sending.current || !files.length) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await onSend(files, note.trim())
      if (r.ok) { setFiles([]); setNote('') } else if (r.reason) setError(r.reason)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2">
      {previews.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('รูปที่เลือก')}>
          {previews.map((url, i) => (
            <li key={url} className="relative">
              <img src={url} alt={t('รูปที่ {n}', { n: i + 1 })} className="size-20 rounded-lg border border-line object-cover" />
              <button type="button" disabled={busy} onClick={() => setFiles(f => f.filter((_, k) => k !== i))}
                className="absolute -top-2 -right-2 grid size-8 place-items-center rounded-full border border-line bg-card text-danger" aria-label={t('ลบรูปที่ {n}', { n: i + 1 })}>
                <IconX className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* capture เปิดกล้องหลังทันทีบนมือถือ · คอมพิวเตอร์เลือกไฟล์ได้ */}
      <input id={inputId} type="file" accept="image/*" capture="environment" multiple className="sr-only" disabled={busy || full}
        onChange={e => { const picked = [...(e.target.files ?? [])]; e.target.value = ''; setError(null); setFiles(f => [...f, ...picked].slice(0, MAX_PHOTOS)) }} />
      <label htmlFor={inputId} aria-disabled={busy || full}
        className={`${files.length ? secondaryBtn : primaryBtn} ${busy || full ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
        <IconCamera className="size-5 shrink-0" />
        <Tr th={full ? 'ครบ {n} รูปแล้ว' : files.length ? 'ถ่ายเพิ่ม' : kind === 'first' ? 'ถ่ายรูปชิ้นแรก' : 'ถ่ายรูปงานเสร็จ'} vars={{ n: MAX_PHOTOS }} />
      </label>
      {kind === 'first' && files.length > 0 && (
        <label className="grid gap-1 text-base"><Tr th="บอกแอดมิน (ไม่ต้องกรอกก็ได้)" />
          <input value={note} maxLength={300} onChange={e => setNote(e.target.value)} className={fieldClass} placeholder={t('เช่น สีเข้มกว่าม็อคอัพนิดหน่อย')} />
        </label>
      )}
      {files.length > 0 && (
        <button type="button" disabled={busy} className={okBtn} onClick={() => void submit()}>
          <Tr th={busy ? 'กำลังส่งรูป…' : kind === 'first' ? 'ส่งรูปชิ้นแรก {n} รูป ({no})' : 'ส่งรูปงานเสร็จ {n} รูป ({no})'} vars={{ n: files.length, no: jobNo }} />
        </button>
      )}
      {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 font-medium text-danger"><Tr th="{no}: {reason}" vars={{ no: jobNo, reason: { th: error } }} /></p>}
    </div>
  )
}

function usePreviews(files: readonly File[]): string[] {
  const urls = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => { for (const u of urls) URL.revokeObjectURL(u) }, [urls])
  return urls
}
