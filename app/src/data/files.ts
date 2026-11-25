import { supabase } from '../lib/supabase'
import { thaiError } from './live'

export type FileKind = 'confirmations' | 'mockups' | 'station_photos'
export type UploadResult = { ok: true } | { ok: false; reason: string }
export type SignResult = { ok: true; urls: Map<string, string> } | { ok: false; reason: string }
type Deps = { fetcher?: typeof fetch; wait?: (ms: number) => Promise<void>; once?: boolean }

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const OFFLINE = 'เชื่อมต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง'
const LOGIN_AGAIN = 'หมดเวลาล็อกอิน ให้ออกจากระบบแล้วล็อกอินใหม่'
// เน็ตมือถือหน้างานหลุดบ่อย ลองซ้ำเองก่อนบอกผู้ใช้ · ชื่อไฟล์มาจากเนื้อไฟล์ Worker จึงไม่สร้างไฟล์ซ้ำ
const RETRY_MS = [1_000, 3_000]

// ว่าง = ใช้ Supabase Storage แบบเดิม · ตั้งค่าใน Cloudflare Pages ตอนเปิดใช้ R2
export function filesUrl(): string {
  const value: unknown = import.meta.env.VITE_FILES_URL
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

async function workerError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
    if (typeof error === 'string' && error) return error
  } catch { /* คำตอบไม่ใช่ JSON: ใช้ข้อความกลาง */ }
  return res.status >= 500 ? 'ที่เก็บไฟล์ขัดข้อง ลองอีกครั้ง' : 'ส่งไฟล์ไม่สำเร็จ ลองอีกครั้ง'
}

async function uploadToStorage(kind: FileKind, path: string, blob: Blob, type: string): Promise<UploadResult> {
  if (!supabase) return { ok: false, reason: 'ยังไม่ได้ตั้งค่าระบบ' }
  try {
    const up = await supabase.storage.from(kind).upload(path, blob, { contentType: type, upsert: false })
    if (!up.error || /exists|duplicate/i.test(up.error.message)) return { ok: true }
    if (/bucket not found/i.test(up.error.message)) return { ok: false, reason: 'ระบบยังไม่พร้อมรับไฟล์ แจ้งเจ้าของระบบ' }
    return { ok: false, reason: kind === 'mockups' ? 'อัปโหลดรูปไม่สำเร็จ ลองอีกครั้ง' : thaiError(up.error.message) }
  } catch {
    return { ok: false, reason: OFFLINE }
  }
}

export async function uploadFile(kind: FileKind, path: string, blob: Blob, type: string, deps: Deps = {}): Promise<UploadResult> {
  if (blob.size > MAX_UPLOAD_BYTES) return { ok: false, reason: `ไฟล์ใหญ่ ${(Math.ceil(blob.size / 104857.6) / 10).toFixed(1)} MB เกิน 20 MB ให้ย่อไฟล์ก่อน` }
  const base = filesUrl()
  if (!base) return uploadToStorage(kind, path, blob, type)
  const token = await accessToken()
  if (!token) return { ok: false, reason: LOGIN_AGAIN }
  const fetcher = deps.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const wait = deps.wait ?? pause
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetcher(`${base}/upload/${kind}/${path}`, {
        method: 'PUT', body: blob, headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
      })
      if (res.ok) return { ok: true }
      if (res.status < 500 || deps.once || attempt >= RETRY_MS.length) return { ok: false, reason: await workerError(res) }
    } catch {
      if (deps.once || attempt >= RETRY_MS.length) return { ok: false, reason: OFFLINE }
    }
    await wait(RETRY_MS[attempt] ?? 0)
  }
}

export async function signFiles(kind: FileKind, paths: readonly string[], seconds: number, deps: Deps = {}): Promise<SignResult> {
  if (!supabase) return { ok: false, reason: 'ยังไม่ได้ตั้งค่าระบบ' }
  const unique = [...new Set(paths)]
  if (!unique.length) return { ok: true, urls: new Map() }
  const base = filesUrl()
  try {
    if (!base) {
      const reply = await supabase.storage.from(kind).createSignedUrls(unique, seconds)
      if (reply.error) return { ok: false, reason: thaiError(reply.error.message) }
      const urls = new Map<string, string>()
      for (const row of reply.data ?? []) if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl)
      return { ok: true, urls }
    }
    const token = await accessToken()
    if (!token) return { ok: false, reason: LOGIN_AGAIN }
    const fetcher = deps.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
    const res = await fetcher(`${base}/sign`, {
      method: 'POST', body: JSON.stringify({ kind, paths: unique, seconds }),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    if (!res.ok) return { ok: false, reason: await workerError(res) }
    const body: unknown = await res.json()
    const raw = typeof body === 'object' && body !== null ? (body as { urls?: unknown }).urls : null
    const urls = new Map<string, string>()
    if (typeof raw === 'object' && raw !== null) {
      for (const [p, u] of Object.entries(raw)) if (typeof u === 'string' && unique.includes(p)) urls.set(p, u)
    }
    return { ok: true, urls }
  } catch {
    return { ok: false, reason: OFFLINE }
  }
}
