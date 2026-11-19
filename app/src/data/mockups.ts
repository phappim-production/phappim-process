// รูปม็อคอัพของงาน (Storage 'mockups' · 20261120110000) · คนหน้างานจำงานจากรูปมากกว่ารหัสงาน
// bucket ไม่เปิดสาธารณะ (งานลูกค้า) → ขอลิงก์ชั่วคราวทีละชุด แล้วจำไว้ใช้ซ้ำจนใกล้หมดอายุ
import { supabase } from '../lib/supabase'
import type { Job } from '../proto/model'

export const MOCKUP_BUCKET = 'mockups'
export const MAX_MOCKUP_BYTES = 5 * 1024 * 1024
const SIGN_SECONDS = 12 * 60 * 60
const RENEW_BEFORE_MS = 60 * 60 * 1000

// ชื่อไฟล์ใน Storage ใช้อังกฤษ/ตัวเลขเท่านั้น (ชื่อไทยอัปโหลดไม่ผ่าน) · ใส่เวลากันชื่อซ้ำ
export function mockupPath(no: string, at: Date, ext: 'jpg' | 'png' | 'webp' = 'jpg'): string {
  const safe = no.trim().replace(/[^A-Za-z0-9-]/g, '_') || 'job'
  return `${safe}/${at.getTime()}.${ext}`
}

export function mockupExt(type: string): 'jpg' | 'png' | 'webp' | null {
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  return null
}

export function mockupProblem(file: { size: number; type: string }): string | null {
  if (!mockupExt(file.type)) return 'รูปต้องเป็น JPG / PNG / WEBP'
  if (file.size > MAX_MOCKUP_BYTES) return `รูปใหญ่ ${(file.size / 1024 / 1024).toFixed(1)} MB เกิน 5 MB ให้ย่อรูปก่อน`
  return null
}

/** รูปย่อที่ฟอร์มส่งมา (data URL JPEG/PNG/WEBP) · ไม่ใช่รูป = null */
export function mockupDataUrl(value: unknown): { type: string; base64: string } | null {
  if (typeof value !== 'string') return null
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value)
  return m ? { type: m[1]!, base64: m[2]! } : null
}

export function dataUrlBlob(d: { type: string; base64: string }): Blob {
  const bin = atob(d.base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: d.type })
}

/** ใส่ลิงก์รูปให้งานที่มีรูป · งานที่ขอลิงก์ไม่ได้ = ไม่มีรูป (แสดงกรอบว่าง ไม่ทำให้หน้าเสีย) */
export function attachMockupUrls(jobs: Job[], urls: ReadonlyMap<string, string>): Job[] {
  return jobs.map(j => {
    const url = j.mockup ? urls.get(j.mockup) : undefined
    return url ? { ...j, mockupUrl: url } : j
  })
}

const cache = new Map<string, { url: string; until: number }>()

/** ลิงก์ชั่วคราวของรูปทุกงาน (ขอเฉพาะที่ยังไม่มีหรือใกล้หมดอายุ) · ขอไม่ได้ = คืนเท่าที่มี */
export async function signMockups(paths: readonly string[], now = Date.now()): Promise<Map<string, string>> {
  const need = [...new Set(paths)].filter(p => (cache.get(p)?.until ?? 0) - now < RENEW_BEFORE_MS)
  if (need.length && supabase) {
    try {
      const { data } = await supabase.storage.from(MOCKUP_BUCKET).createSignedUrls(need, SIGN_SECONDS)
      for (const row of data ?? []) {
        if (row.path && row.signedUrl && !row.error) cache.set(row.path, { url: row.signedUrl, until: now + SIGN_SECONDS * 1000 })
      }
    } catch { /* เน็ตสะดุด: แสดงกรอบว่างไปก่อน รอบโหลดถัดไปขอใหม่ */ }
  }
  const out = new Map<string, string>()
  for (const p of paths) {
    const hit = cache.get(p)
    if (hit) out.set(p, hit.url)
  }
  return out
}

export async function withMockups(jobs: Job[]): Promise<Job[]> {
  const paths = jobs.flatMap(j => (j.mockup ? [j.mockup] : []))
  if (!paths.length) return jobs
  return attachMockupUrls(jobs, await signMockups(paths))
}

/** รูปจากกล้องมือถือมักใหญ่หลาย MB → ย่อด้านยาวไม่เกิน 1200px เป็น JPEG ก่อนอัปโหลด · ย่อไม่ได้ = ใช้ไฟล์เดิม */
export async function shrinkImage(file: Blob, max = 1200): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * k)
    canvas.height = Math.round(bmp.height * k)
    const g = canvas.getContext('2d')
    if (!g) return file
    g.fillStyle = '#fff'  // พื้นขาวแทนส่วนโปร่งใสของ PNG (JPEG ไม่มีโปร่งใส)
    g.fillRect(0, 0, canvas.width, canvas.height)
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const out = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return out ?? file
  } catch {
    return file
  }
}

/** อัปโหลดรูปเข้า Storage แล้วคืน path · ไม่สำเร็จ = ข้อความภาษาไทย */
export async function uploadMockup(no: string, blob: Blob, now = new Date()): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (!supabase) return { ok: false, reason: 'ยังไม่ได้ตั้งค่าระบบ' }
  const ext = mockupExt(blob.type)
  if (!ext) return { ok: false, reason: 'รูปต้องเป็น JPG / PNG / WEBP' }
  const path = mockupPath(no, now, ext)
  try {
    const up = await supabase.storage.from(MOCKUP_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false })
    if (up.error) return { ok: false, reason: /bucket not found/i.test(up.error.message) ? 'ระบบยังไม่พร้อมรับรูป แจ้งเจ้าของระบบ' : 'อัปโหลดรูปไม่สำเร็จ ลองอีกครั้ง' }
    return { ok: true, path }
  } catch {
    return { ok: false, reason: 'เชื่อมต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง' }
  }
}
