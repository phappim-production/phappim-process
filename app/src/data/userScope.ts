import { supabase } from '../lib/supabase'

const clearers = new Set<() => void>()
let user: string | null | undefined

// ข้อมูลที่จำไว้ในแท็บต้องไม่ข้ามไปถึงบัญชีถัดไปบนแท็บเล็ตที่ใช้ร่วมกัน
export function onUserChange(clear: () => void) {
  clearers.add(clear)
}

export function userChanged(next: string | null) {
  const switched = next === null || (user != null && user !== next)
  user = next
  if (switched) for (const clear of clearers) clear()
  return switched
}

supabase?.auth?.onAuthStateChange?.((_event, session) => { userChanged(session?.user.id ?? null) })
