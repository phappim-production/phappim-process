import { createContext, useContext, useSyncExternalStore } from 'react'
import { hasBurmese, translate, type Lang, type Vars } from './word.ts'

export { hasBurmese, translate, word, type Lang, type Vars, type When, type Word } from './word.ts'

const STORE_KEY = 'pp142-lang'
const listeners = new Set<() => void>()

function stored(): Lang {
  try { return localStorage.getItem(STORE_KEY) === 'my' ? 'my' : 'th' } catch { return 'th' }
}

let current: Lang = typeof window === 'undefined' ? 'th' : stored()

export function setLang(lang: Lang) {
  current = lang
  try { localStorage.setItem(STORE_KEY, lang) } catch { /* โหมดส่วนตัวของ Safari เก็บไม่ได้ ใช้ได้แค่รอบนี้ */ }
  listeners.forEach(fn => fn())
}

// แท็บเล็ตใช้ร่วมกัน: เครื่องจำภาษาพม่าไว้ แต่บทบาทที่ไม่ได้แปลยังเห็นไทยเสมอ
export const LangAllowed = createContext(true)

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const snapshot = () => current

export function useLang(): Lang {
  const allowed = useContext(LangAllowed)
  const chosen = useSyncExternalStore(subscribe, snapshot, snapshot)
  return allowed ? chosen : 'th'
}

export function useT() {
  const lang = useLang()
  return (th: string, vars?: Vars) => translate(lang, th, vars)
}

// ข้อความสองภาษาใน confirm / alert ที่แสดง JSX ไม่ได้
export function useBoth() {
  const lang = useLang()
  return (th: string, vars?: Vars) => lang === 'my' && hasBurmese(th) ? `${translate('my', th, vars)}\n${translate('th', th, vars)}` : translate('th', th, vars)
}
