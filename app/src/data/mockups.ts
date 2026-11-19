// bucket ไม่เปิดสาธารณะ (งานลูกค้า) → ขอลิงก์ชั่วคราวทีละชุด แล้วจำไว้ใช้ซ้ำจนใกล้หมดอายุ
import { supabase } from '../lib/supabase'
import type { Job } from '../proto/model'
import { withTimeout } from './live'

export const MOCKUP_BUCKET = 'mockups'
export const MAX_MOCKUP_BYTES = 5 * 1024 * 1024
const SIGN_SECONDS = 12 * 60 * 60
const RENEW_BEFORE_MS = 60 * 60 * 1000
// ขอลิงก์รูปช้า ต้องไม่ทำให้ข้อมูลงานทั้งหน้าโหลดไม่ขึ้น (หน้าโหลดตัดที่ 30 วิ) → ตัดที่ 8 วิ แสดงกรอบว่างไปก่อน
const SIGN_TIMEOUT_MS = 8_000

// Storage รับแค่อังกฤษ/ตัวเลข · ตัวอื่นเป็นรหัสอักษร 6 หลักให้เลขที่ใบไม่ชนโฟลเดอร์ (ตรงกับ private.mockup_folder) · ชื่อไฟล์ = ลายนิ้วมือเนื้อรูป
export function mockupFolder(no: string): string {
  return no.trim().replace(/[^A-Za-z0-9-]/gu, c => `_${(c.codePointAt(0) ?? 0).toString(16).padStart(6, '0')}`) || 'job'
}
export function mockupPath(no: string, key: string | Date, ext: 'jpg' | 'png' | 'webp' = 'jpg'): string {
  return `${mockupFolder(no)}/${typeof key === 'string' ? key : key.getTime()}.${ext}`
}

// เครื่องที่ไม่มี crypto.subtle ใช้เวลาแทน (ได้ไฟล์ใหม่ทุกครั้ง แต่ยังใช้ได้)
export async function contentKey(blob: Blob): Promise<string> {
  try {
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return [...new Uint8Array(hash)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return String(Date.now())
  }
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

// ขอลิงก์ไม่ได้ = ไม่มีรูป ไม่ทำให้หน้าเสีย
export function attachMockupUrls(jobs: Job[], urls: ReadonlyMap<string, string>): Job[] {
  return jobs.map(j => {
    const url = j.mockup ? urls.get(j.mockup) : undefined
    return url ? { ...j, mockupUrl: url } : j
  })
}

const cache = new Map<string, { url: string; until: number }>()

export async function signMockups(paths: readonly string[], now = Date.now()): Promise<Map<string, string>> {
  // ลิงก์หมดอายุแล้วใช้ไม่ได้อยู่ดี → ทิ้ง (แท็บที่เปิดทิ้งไว้ทั้งสัปดาห์ไม่สะสมลิงก์ของงานเก่า)
  for (const [p, hit] of cache) if (hit.until <= now) cache.delete(p)
  const need = [...new Set(paths)].filter(p => (cache.get(p)?.until ?? 0) - now < RENEW_BEFORE_MS)
  const client = supabase
  if (need.length && client) {
    try {
      const reply = await withTimeout(() => client.storage.from(MOCKUP_BUCKET).createSignedUrls(need, SIGN_SECONDS), SIGN_TIMEOUT_MS)
      const data = reply.timedOut ? [] : reply.value.data
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

// รูปจากกล้องมือถือใหญ่หลาย MB → ย่อก่อนอัปโหลด · ย่อไม่ได้ = ใช้ไฟล์เดิม
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

// รูปเดิมของใบเดิมมีอยู่แล้ว = ใช้ไฟล์เดิม
export async function uploadMockup(no: string, blob: Blob): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (!supabase) return { ok: false, reason: 'ยังไม่ได้ตั้งค่าระบบ' }
  const problem = mockupProblem(blob)
  if (problem) return { ok: false, reason: problem }
  const path = mockupPath(no, await contentKey(blob), mockupExt(blob.type) ?? 'jpg')
  try {
    const up = await supabase.storage.from(MOCKUP_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false })
    if (up.error && /exists|duplicate/i.test(up.error.message)) return { ok: true, path }
    if (up.error) return { ok: false, reason: /bucket not found/i.test(up.error.message) ? 'ระบบยังไม่พร้อมรับรูป แจ้งเจ้าของระบบ' : 'อัปโหลดรูปไม่สำเร็จ ลองอีกครั้ง' }
    return { ok: true, path }
  } catch {
    return { ok: false, reason: 'เชื่อมต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง' }
  }
}
