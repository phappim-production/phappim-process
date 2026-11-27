import { useSyncExternalStore } from 'react'

export type InstallMode = 'installed' | 'done' | 'prompt' | 'inapp' | 'ios' | 'android' | 'none'

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

export type InAppBrowser = 'line' | 'other'

// ลิงก์ที่กดในแชตเปิดในเบราว์เซอร์ของแอปแชตเอง ซึ่งติดตั้งแอปไม่ได้ และเก็บการล็อกอินแยกจาก Chrome/Safari
export function inAppBrowser(userAgent: string): InAppBrowser | null {
  if (/\bLine\/\d/i.test(userAgent)) return 'line'
  if (/FBAN|FBAV|FB_IAB|Instagram|MessengerForiOS|; wv\)/.test(userAgent)) return 'other'
  return null
}

// LINE เปิดลิงก์ที่มีพารามิเตอร์นี้ในเบราว์เซอร์ของเครื่อง (Chrome / Safari) แทนเบราว์เซอร์ใน LINE
export const LINE_EXTERNAL_PARAM = 'openExternalBrowser'

export function externalBrowserUrl(href: string): string {
  const url = new URL(href)
  url.searchParams.set(LINE_EXTERNAL_PARAM, '1')
  return url.toString()
}

export function withoutExternalParam(href: string): string | null {
  const url = new URL(href)
  if (!url.searchParams.has(LINE_EXTERNAL_PARAM)) return null
  url.searchParams.delete(LINE_EXTERNAL_PARAM)
  return url.toString()
}

export function installMode(env: InstallEnv): InstallMode {
  if (env.standalone) return 'installed'
  if (env.installedNow) return 'done'
  if (env.hasPrompt) return 'prompt'
  if (inAppBrowser(env.userAgent)) return 'inapp'
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
  'เปิดหน้านี้ด้วย Chrome (ถ้าเปิดจาก LINE ให้กด ⋮ แล้วเลือกเปิดในเบราว์เซอร์)',
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

const iosHomeScreen = () => (navigator as Navigator & { standalone?: boolean }).standalone === true

export function runsAsApp(): boolean {
  return iosHomeScreen() || matchMedia('(display-mode: standalone)').matches
}

// แอปบนหน้าจอโฮมของ iPhone/iPad เก็บข้อมูลแยกจาก Safari · เปิดฟอร์มหน้าต่างใหม่ = ฟอร์มไม่เห็นใบที่ระบบส่งให้ จึงเปิดในหน้าเดิม
// Android / คอมใช้ที่เก็บร่วมกับเบราว์เซอร์ เปิดหน้าต่างใหม่ได้ตามเดิม (หน้าระบบไม่หาย)
export const formInSameWindow = iosHomeScreen

export function openFormWindow(): Window | null {
  return formInSameWindow() ? null : window.open('', '_blank')
}

// Chrome ส่ง beforeinstallprompt ครั้งเดียวตอนโหลดหน้า ก่อนผู้ใช้เปิดหน้าบัญชี · ต้องดักตั้งแต่เริ่มแอป
export function listenForInstall() {
  const clean = withoutExternalParam(location.href)
  if (clean) history.replaceState(history.state, '', clean)
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
  // Safari ก่อน iOS 14 ไม่มี addEventListener บน MediaQueryList · โยน error ตอนเริ่มแอป = จอขาว
  const standalone = matchMedia('(display-mode: standalone)')
  if (typeof standalone.addEventListener === 'function') standalone.addEventListener('change', changed)
  else standalone.addListener?.(changed)
}

function currentMode(): InstallMode {
  return installMode({
    standalone: runsAsApp(),
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
