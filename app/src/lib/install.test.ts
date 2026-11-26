import { describe, expect, it } from 'vitest'
import { ANDROID_STEPS, IOS_STEPS, installMode, isIos, type InstallEnv } from './install'
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
