import { rpc } from './useFactoryData'
import { contentKey, mockupPath, signedUrls } from './mockups'
import { signFiles, uploadFile } from './files'

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

export type SignatureWho = 'customer' | 'approver'
export const SIGNER_NAME: Record<SignatureWho, string> = { customer: 'ลูกค้า', approver: 'ผู้อนุมัติ' }
export type Signatures = Record<SignatureWho, CustomerSignature | null> & { currentRev: number }

export function parseSignatures(raw: unknown): Signatures {
  const currentRev = currentRevOf(raw)
  const approver = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).approver : null
  return {
    customer: parseSignature(raw),
    approver: approver && typeof approver === 'object' ? parseSignature({ ...approver, current_rev: currentRev }) : null,
    currentRev,
  }
}

export type LoadedSignatures = Signatures & { urls: Record<SignatureWho, string | null> }

export async function loadSignatures(jobId: string): Promise<({ ok: true } & LoadedSignatures) | { ok: false; reason: string }> {
  const r = await rpc('job_customer_signature', { p_job: jobId }, { read: true })
  if (!r.ok) return { ok: false, reason: r.reason }
  const sigs = parseSignatures(r.data)
  const paths = [sigs.customer?.path, sigs.approver?.path].filter((p): p is string => !!p)
  const links = paths.length ? await signedUrls(paths) : new Map<string, string>()
  const url = (s: CustomerSignature | null) => (s && links.get(s.path)) ?? null
  return { ok: true, ...sigs, urls: { customer: url(sigs.customer), approver: url(sigs.approver) } }
}

const SET_RPC: Record<SignatureWho, string> = { customer: 'set_customer_signature', approver: 'set_approver_signature' }

export async function saveSignature(job: { id: string; no: string }, png: Blob, signedOn: string, who: SignatureWho = 'customer'): Promise<{ ok: true } | { ok: false; reason: string }> {
  const path = signaturePath(job.no, await contentKey(png))
  const up = await uploadFile('mockups', path, png, 'image/png')
  if (!up.ok) return up
  const r = await rpc(SET_RPC[who], { p_job: job.id, p_path: path, p_signed_on: signedOn })
  return r.ok ? { ok: true } : { ok: false, reason: r.reason }
}

export async function removeSignature(jobId: string, who: SignatureWho = 'customer'): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await rpc(SET_RPC[who], { p_job: jobId, p_path: null, p_signed_on: null })
  return r.ok ? { ok: true } : { ok: false, reason: r.reason }
}

export async function fetchAttached(path: string, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<{ ok: true; file: File } | { ok: false; reason: string }> {
  const r = await signFiles('confirmations', [path], 300)
  if (!r.ok) return r
  const url = r.urls.get(path)
  if (!url) return { ok: false, reason: 'เปิดใบที่แนบไว้ไม่ได้ (ไม่มีสิทธิ์ หรือไฟล์หาย) เลือกรูปจากเครื่องแทน' }
  try {
    const res = await fetcher(url)
    if (!res.ok) return { ok: false, reason: 'เปิดใบที่แนบไว้ไม่ได้ ลองอีกครั้ง หรือเลือกรูปจากเครื่องแทน' }
    const blob = await res.blob()
    return { ok: true, file: new File([blob], path.slice(path.lastIndexOf('/') + 1), { type: blob.type }) }
  } catch {
    return { ok: false, reason: 'โหลดใบที่แนบไว้ไม่ได้ (เน็ตหลุด) ลองอีกครั้ง หรือเลือกรูปจากเครื่องแทน' }
  }
}

export type FormSignature = { src: string; signed_on: string; rev: number; current_rev: number; at: number }

// ส่งให้ฟอร์มเฉพาะตอนเปิดดูฉบับโรงงาน (ลิงก์ 1 ชั่วโมง ไม่เก็บลงสเปกของงาน)
export async function signaturesForForm(jobId: string): Promise<{ customer_sig?: FormSignature; approver_sig?: FormSignature }> {
  const r = await loadSignatures(jobId)
  if (!r.ok) return {}
  const form = (who: SignatureWho): FormSignature | undefined => {
    const s = r[who], src = r.urls[who]
    return s && src ? { src, signed_on: s.signedOn, rev: s.rev, current_rev: s.currentRev, at: Date.now() } : undefined
  }
  const customer = form('customer'), approver = form('approver')
  return { ...(customer ? { customer_sig: customer } : {}), ...(approver ? { approver_sig: approver } : {}) }
}
