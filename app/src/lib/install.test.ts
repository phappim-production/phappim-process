import { describe, expect, it } from 'vitest'
import { ANDROID_STEPS, IOS_STEPS, externalBrowserUrl, inAppBrowser, installMode, isIos, withoutExternalParam, type InstallEnv } from './install'
import { MY } from '../i18n/my'
import { keepScreenOn } from './wakeLock'

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

const env = (patch: Partial<InstallEnv>): InstallEnv => ({
  standalone: false, installedNow: false, hasPrompt: false, userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 0, ...patch,
})

describe('ปุ่มติดตั้งแอป', () => {
  it('เปิดจากไอคอนแอปอยู่แล้ว = ไม่แสดงปุ่ม แม้เบราว์เซอร์ยังมีคำขอติดตั้ง', () => {
    expect(installMode(env({ standalone: true, hasPrompt: true, userAgent: ANDROID }))).toBe('installed')
  })

  it('Chrome ให้ติดตั้งได้ = กดปุ่มเดียว', () => {
    expect(installMode(env({ hasPrompt: true, userAgent: ANDROID }))).toBe('prompt')
    expect(installMode(env({ hasPrompt: true }))).toBe('prompt')
  })

  it('เพิ่งติดตั้งในแท็บนี้ = บอกให้เปิดจากไอคอน', () => {
    expect(installMode(env({ installedNow: true, userAgent: ANDROID }))).toBe('done')
  })

  it('iPhone / iPad ไม่มีปุ่มติดตั้ง = แสดงขั้นตอน แชร์ → เพิ่มไปยังหน้าจอโฮม', () => {
    expect(installMode(env({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 }))).toBe('ios')
    expect(installMode(env({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 }))).toBe('ios')
  })

  it('Android ที่เบราว์เซอร์ไม่ส่งคำขอติดตั้ง (กดปฏิเสธไปแล้ว / เบราว์เซอร์อื่น) = แสดงวิธีติดตั้งจากเมนู', () => {
    expect(installMode(env({ userAgent: ANDROID }))).toBe('android')
  })

  it('คอมพิวเตอร์ที่ติดตั้งไม่ได้ = ไม่แสดง', () => {
    expect(installMode(env({}))).toBe('none')
    expect(isIos(IPAD_DESKTOP_UA, 'MacIntel', 0)).toBe(false)
  })
})

function fakeDoc(initial: DocumentVisibilityState) {
  let handler: (() => void) | null = null
  const doc = {
    visibilityState: initial,
    addEventListener: (_: string, fn: () => void) => { handler = fn },
    removeEventListener: () => { handler = null },
  }
  return {
    doc: doc as unknown as Parameters<typeof keepScreenOn>[1],
    show(state: DocumentVisibilityState) { doc.visibilityState = state; handler?.() },
    listening: () => handler !== null,
  }
}

function fakeWakeLock(fail = false) {
  const log: string[] = []
  return {
    log,
    api: {
      request: async () => {
        if (fail) throw new Error('NotAllowedError')
        log.push('lock')
        return { release: async () => { log.push('release') } }
      },
    },
  }
}

const flush = () => new Promise(r => setTimeout(r, 0))

describe('กันจอดับที่หน้าสถานี', () => {
  it('ขอล็อกจอเมื่อหน้าเปิดอยู่ และปล่อยเมื่อออกจากหน้า', async () => {
    const lock = fakeWakeLock()
    const page = fakeDoc('visible')
    const stop = keepScreenOn(lock.api, page.doc)
    await flush()
    expect(lock.log).toEqual(['lock'])
    stop()
    await flush()
    expect(lock.log).toEqual(['lock', 'release'])
    expect(page.listening()).toBe(false)
  })

  it('สลับแอปแล้วกลับมา = ขอล็อกใหม่ · ซ่อนอยู่ไม่ขอ', async () => {
    const lock = fakeWakeLock()
    const page = fakeDoc('hidden')
    const stop = keepScreenOn(lock.api, page.doc)
    await flush()
    expect(lock.log).toEqual([])
    page.show('visible')
    await flush()
    expect(lock.log).toEqual(['lock'])
    stop()
  })

  it('เบราว์เซอร์ไม่รองรับหรือไม่อนุญาต = ไม่ error', async () => {
    const page = fakeDoc('visible')
    expect(() => keepScreenOn(undefined, page.doc)()).not.toThrow()
    const denied = fakeWakeLock(true)
    const stop = keepScreenOn(denied.api, page.doc)
    await flush()
    expect(denied.log).toEqual([])
    stop()
  })
})

it('ขั้นตอนติดตั้งทุกข้อมีคำแปลพม่า', () => {
  expect([...IOS_STEPS, ...ANDROID_STEPS].filter(th => !(th in MY))).toEqual([])
})

const LINE_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A155F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 Line/14.19.1/IAB'
const LINE_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.0'
const FACEBOOK = 'Mozilla/5.0 (Linux; Android 14; SM-A155F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]'

describe('เปิดลิงก์จากแอปแชต', () => {
  it('LINE ทั้ง Android และ iPhone = บอกให้เปิดในเบราว์เซอร์ก่อนแสดงขั้นตอนติดตั้ง', () => {
    expect(inAppBrowser(LINE_ANDROID)).toBe('line')
    expect(inAppBrowser(LINE_IPHONE)).toBe('line')
    expect(installMode(env({ userAgent: LINE_ANDROID }))).toBe('inapp')
    expect(installMode(env({ userAgent: LINE_IPHONE, platform: 'iPhone', maxTouchPoints: 5 }))).toBe('inapp')
  })

  it('Facebook / Messenger = แอปแชตอื่น (ไม่มีลิงก์เปิดเบราว์เซอร์อัตโนมัติ)', () => {
    expect(inAppBrowser(FACEBOOK)).toBe('other')
  })

  it('Chrome / Safari ปกติ และคอม = ไม่ใช่แอปแชต', () => {
    for (const ua of [ANDROID, IPHONE, IPAD_DESKTOP_UA, WINDOWS]) expect(inAppBrowser(ua)).toBeNull()
  })

  it('Samsung Internet และ Chrome Custom Tab = เบราว์เซอร์จริง ไม่ใช่แอปแชต', () => {
    const samsung = 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36'
    const customTab = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
    expect(inAppBrowser(samsung)).toBeNull()
    expect(inAppBrowser(customTab)).toBeNull()
  })

  it('TikTok และ WeChat = แอปแชตอื่น', () => {
    expect(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_32.5.0 BytedanceWebview/d8a21c6')).toBe('other')
    expect(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47')).toBe('other')
  })

  it('แอปที่ติดตั้งแล้ว หรือ Chrome เสนอติดตั้งได้ ยังใช้ตามเดิม', () => {
    expect(installMode(env({ userAgent: LINE_ANDROID, standalone: true }))).toBe('installed')
    expect(installMode(env({ userAgent: LINE_ANDROID, hasPrompt: true }))).toBe('prompt')
  })

  it('ลิงก์เปิดนอก LINE เก็บหน้าเดิม (hash) ไว้ และเอาพารามิเตอร์ออกได้หลังเปิด', () => {
    const out = externalBrowserUrl('https://pp142.pages.dev/#/system')
    expect(out).toBe('https://pp142.pages.dev/?openExternalBrowser=1#/system')
    expect(withoutExternalParam(out)).toBe('https://pp142.pages.dev/#/system')
    expect(withoutExternalParam('https://pp142.pages.dev/?x=1#/board')).toBeNull()
    expect(externalBrowserUrl('https://pp142.pages.dev/?openExternalBrowser=1')).toBe('https://pp142.pages.dev/?openExternalBrowser=1')
  })

  it('ข้อความเปิดในเบราว์เซอร์มีคำแปลพม่า', () => {
    for (const th of ['เปิดอยู่ใน LINE · ติดตั้งแอปไม่ได้ ให้เปิดในเบราว์เซอร์ก่อน', 'เปิดอยู่ในแอปแชต · ติดตั้งแอปไม่ได้ ให้เปิดในเบราว์เซอร์ก่อน', 'เปิดในเบราว์เซอร์', 'เปิดใน Safari', 'กด ⋮ หรือ ⋯ มุมขวาบน แล้วเลือก เปิดในเบราว์เซอร์']) {
      expect(MY[th]).toBeTruthy()
    }
  })
})
