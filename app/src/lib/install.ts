import { useSyncExternalStore } from 'react'

export type InstallMode = 'installed' | 'done' | 'prompt' | 'ios' | 'android' | 'none'

export type InstallEnv = {
  standalone: boolean
  installedNow: boolean
  hasPrompt: boolean
  userAgent: string
  platform: string
  maxTouchPoints: number
}

// iPadOS 13 ขึ้นไปบอกตัวเองว่าเป็น Mac · แยกด้วยจอสัมผัส
export function isIos(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
}

export function installMode(env: InstallEnv): InstallMode {
  if (env.standalone) return 'installed'
  if (env.installedNow) return 'done'
  if (env.hasPrompt) return 'prompt'
  if (isIos(env.userAgent, env.platform, env.maxTouchPoints)) return 'ios'
  if (/Android/i.test(env.userAgent)) return 'android'
  return 'none'
}

export const IOS_STEPS = [
  'เปิดหน้านี้ด้วย Safari',
  'กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) · ถ้าไม่เห็น ให้กด ⋯ ก่อน',
  'เลื่อนลงแล้วกด เพิ่มไปยังหน้าจอโฮม',
  'กด เพิ่ม มุมขวาบน · แอปจะอยู่บนหน้าจอโฮม',
]

export const ANDROID_STEPS = [
  'กดเมนู ⋮ มุมขวาบนของ Chrome',
  'กด ติดตั้งแอป (บางเครื่องเขียนว่า เพิ่มลงในหน้าจอหลัก)',
  'กด ติดตั้ง · แอปจะอยู่บนหน้าจอหลัก',
]

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
let installedNow = false
let version = 0
const listeners = new Set<() => void>()

function changed() {
  version += 1
  listeners.forEach(fn => fn())
}

function isStandalone(): boolean {
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches
}

// Chrome ส่ง beforeinstallprompt ครั้งเดียวตอนโหลดหน้า ก่อนผู้ใช้เปิดหน้าบัญชี · ต้องดักตั้งแต่เริ่มแอป
export function listenForInstall() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    changed()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installedNow = true
    changed()
  })
  matchMedia('(display-mode: standalone)').addEventListener('change', changed)
}

function currentMode(): InstallMode {
  return installMode({
    standalone: isStandalone(),
    installedNow,
    hasPrompt: deferred !== null,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  })
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  deferred = null
  await event.prompt()
  const { outcome } = await event.userChoice
  changed()
  return outcome
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export function useInstallMode(): InstallMode {
  useSyncExternalStore(subscribe, () => version, () => version)
  return currentMode()
}
