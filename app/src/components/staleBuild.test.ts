import { describe, expect, it, vi } from 'vitest'
import { STALE_RELOAD_GUARD_MS, canReloadForStaleBuild, isStaleBuildError, reloadForStaleBuild } from './staleBuild'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

describe('ไฟล์หน้าจอรุ่นเก่าหายหลังขึ้นเว็บใหม่', () => {
  it('รู้จักข้อความของ Chrome Safari Firefox และ CSS', () => {
    expect(isStaleBuildError(new TypeError('Failed to fetch dynamically imported module: https://pp142.pages.dev/assets/Dashboard-abc.js'))).toBe(true)
    expect(isStaleBuildError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleBuildError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true)
    expect(isStaleBuildError(new Error('Unable to preload CSS for /assets/index-1.css'))).toBe(true)
  })

  it('error อื่นไม่ถือว่าเป็นรุ่นเก่า', () => {
    expect(isStaleBuildError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false)
    expect(isStaleBuildError(new Error('Failed to fetch'))).toBe(false)
    expect(isStaleBuildError(null)).toBe(false)
    expect(isStaleBuildError({ message: 'Importing a module script failed.' })).toBe(false)
  })

  it('โหลดซ้ำได้ครั้งเดียวต่อนาที', () => {
    expect(canReloadForStaleBuild(null, 1000)).toBe(true)
    expect(canReloadForStaleBuild(1000, 1000 + STALE_RELOAD_GUARD_MS - 1)).toBe(false)
    expect(canReloadForStaleBuild(1000, 1000 + STALE_RELOAD_GUARD_MS)).toBe(true)
    expect(canReloadForStaleBuild(Number.NaN, 1000)).toBe(true)
  })

  it('ครั้งแรกโหลดใหม่และจดเวลา · ครั้งที่สองภายในนาทีไม่โหลด (ให้กล่องแดงขึ้นแทน)', () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    expect(reloadForStaleBuild({ storage, now: 5000, reload })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reloadForStaleBuild({ storage, now: 5000 + 10_000, reload })).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reloadForStaleBuild({ storage, now: 5000 + STALE_RELOAD_GUARD_MS, reload })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('เบราว์เซอร์ที่ใช้ storage ไม่ได้ ไม่โหลดเอง (กันวนไม่จบ)', () => {
    const reload = vi.fn()
    expect(reloadForStaleBuild({ storage: null, now: 1, reload })).toBe(false)
    const throwing = { getItem: () => { throw new Error('SecurityError') }, setItem: () => {} }
    expect(reloadForStaleBuild({ storage: throwing, now: 1, reload })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
