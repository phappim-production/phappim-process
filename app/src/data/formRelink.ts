import { useEffect } from 'react'
import { signedUrls } from './mockups'

// ชื่อ key ต้องตรงกับ production-confirmation.html
export const RELINK_REQ = 'pp142.confirmation.relink'
export const RELINK_RES = 'pp142.confirmation.relinked'

export type RelinkRequest = { id: string; paths: string[] }

export function parseRelink(raw: string | null): RelinkRequest | null {
  if (!raw) return null
  try {
    const d: unknown = JSON.parse(raw)
    if (!d || typeof d !== 'object') return null
    const { id, paths } = d as { id?: unknown; paths?: unknown }
    if (typeof id !== 'string' || !id || id.length > 80 || !Array.isArray(paths)) return null
    const clean = paths.filter((p): p is string => typeof p === 'string' && p.length <= 300 && /^[A-Za-z0-9_./-]+$/.test(p) && !p.includes('..'))
    if (!clean.length || clean.length !== paths.length || clean.length > 40) return null
    return { id, paths: [...new Set(clean)] }
  } catch {
    return null
  }
}

// ฟอร์มใบยืนยันไม่ได้เข้าสู่ระบบ · แท็บระบบที่เปิดอยู่ออกลิงก์รูปใหม่ให้เมื่อลิงก์เดิมใกล้หมดอายุ
export function useFormRelink() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== RELINK_REQ) return
      const req = parseRelink(e.newValue)
      if (!req) return
      void signedUrls(req.paths).then(urls => {
        if (!urls.size) return
        try { window.localStorage.setItem(RELINK_RES, JSON.stringify({ id: req.id, urls: Object.fromEntries(urls) })) } catch { /* ที่เก็บเต็ม ฟอร์มจะบอกให้เปิดใบใหม่ */ }
      })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
}
