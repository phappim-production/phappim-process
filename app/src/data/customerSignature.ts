import { rpc } from './useFactoryData'
import { contentKey, mockupPath, signedUrls } from './mockups'
import { uploadFile } from './files'

export type CustomerSignature = { path: string; signedOn: string; rev: number; currentRev: number }
export type CropBox = { x: number; y: number; w: number; h: number }

export const SIGNATURE_MAX_WIDTH = 600
export const MIN_CROP_PX = 12

export function parseSignature(raw: unknown): CustomerSignature | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.path !== 'string' || typeof r.signed_on !== 'string') return null
  return { path: r.path, signedOn: r.signed_on.slice(0, 10), rev: Number(r.rev ?? 0), currentRev: Number(r.current_rev ?? 0) }
}

export const signatureIsCurrent = (s: CustomerSignature) => s.rev === s.currentRev

// กรอบที่ลากบนรูปที่ย่อให้พอดีจอ → กรอบบนรูปจริง (ปัดเข้าในรูป)
export function cropOnImage(box: CropBox, shown: { w: number; h: number }, natural: { w: number; h: number }): CropBox | null {
  if (!(shown.w > 0 && shown.h > 0 && natural.w > 0 && natural.h > 0)) return null
  const left = Math.max(0, Math.min(box.x, box.x + box.w)), top = Math.max(0, Math.min(box.y, box.y + box.h))
  const right = Math.min(shown.w, Math.max(box.x, box.x + box.w)), bottom = Math.min(shown.h, Math.max(box.y, box.y + box.h))
  if (right - left < MIN_CROP_PX || bottom - top < MIN_CROP_PX) return null
  const sx = natural.w / shown.w, sy = natural.h / shown.h
  return {
    x: Math.round(left * sx), y: Math.round(top * sy),
    w: Math.max(1, Math.round((right - left) * sx)), h: Math.max(1, Math.round((bottom - top) * sy)),
  }
}

export function outputSize(crop: CropBox, maxWidth = SIGNATURE_MAX_WIDTH): { w: number; h: number } {
  const scale = Math.min(1, maxWidth / crop.w)
  return { w: Math.max(1, Math.round(crop.w * scale)), h: Math.max(1, Math.round(crop.h * scale)) }
}

export async function cropToPng(img: HTMLImageElement, crop: CropBox): Promise<Blob | null> {
  const size = outputSize(crop)
  const canvas = document.createElement('canvas')
  canvas.width = size.w
  canvas.height = size.h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size.w, size.h)
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, size.w, size.h)
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'))
}

export const signaturePath = (no: string, key: string) => mockupPath(no, `sig${key}`, 'png')

export const currentRevOf = (raw: unknown): number => {
  const n = raw && typeof raw === 'object' ? Number((raw as Record<string, unknown>).current_rev) : NaN
  return Number.isFinite(n) ? n : 0
}

export async function loadSignature(jobId: string): Promise<{ ok: true; sig: CustomerSignature | null; url: string | null; currentRev: number } | { ok: false; reason: string }> {
  const r = await rpc('job_customer_signature', { p_job: jobId }, { read: true })
  if (!r.ok) return { ok: false, reason: r.reason }
  const sig = parseSignature(r.data)
  const currentRev = currentRevOf(r.data)
  if (!sig) return { ok: true, sig: null, url: null, currentRev }
  return { ok: true, sig, url: (await signedUrls([sig.path])).get(sig.path) ?? null, currentRev }
}

export async function saveSignature(job: { id: string; no: string }, png: Blob, signedOn: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const path = signaturePath(job.no, await contentKey(png))
  const up = await uploadFile('mockups', path, png, 'image/png')
  if (!up.ok) return up
  const r = await rpc('set_customer_signature', { p_job: job.id, p_path: path, p_signed_on: signedOn })
  return r.ok ? { ok: true } : { ok: false, reason: r.reason }
}

export async function removeSignature(jobId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await rpc('set_customer_signature', { p_job: jobId, p_path: null, p_signed_on: null })
  return r.ok ? { ok: true } : { ok: false, reason: r.reason }
}

// ส่งให้ฟอร์มเฉพาะตอนเปิดดูฉบับโรงงาน (ลิงก์ 1 ชั่วโมง ไม่เก็บลงสเปกของงาน)
export async function signatureForForm(jobId: string): Promise<{ src: string; signed_on: string; rev: number; current_rev: number; at: number } | null> {
  const r = await loadSignature(jobId)
  if (!r.ok || !r.sig || !r.url) return null
  return { src: r.url, signed_on: r.sig.signedOn, rev: r.sig.rev, current_rev: r.sig.currentRev, at: Date.now() }
}
