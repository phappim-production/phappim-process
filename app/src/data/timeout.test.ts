import { afterEach, describe, expect, it, vi } from 'vitest'
import { SLOW_REPLY, thaiError, withTimeout } from './live'

afterEach(() => { vi.useRealTimers() })

describe('withTimeout (คำขอค้างต้องไม่ทำให้ปุ่มหมุนตลอดไป)', () => {
  it('ตอบทันเวลา = ได้ผลจริง', async () => {
    const r = await withTimeout(() => Promise.resolve(42), 1000)
    expect(r).toEqual({ timedOut: false, value: 42 })
  })

  it('ค้างเกินเวลา = คืนว่าหมดเวลา และสั่งยกเลิกคำขอ', async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    const pending = withTimeout(signal => { seen = signal; return new Promise<number>(() => {}) }, 30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await pending).toEqual({ timedOut: true })
    expect(seen?.aborted).toBe(true)
  })

  it('คำขอล้มหลังหมดเวลา ไม่ทำให้เกิด error ค้าง', async () => {
    vi.useFakeTimers()
    let fail: (e: Error) => void = () => {}
    const pending = withTimeout(() => new Promise<number>((_, reject) => { fail = reject }), 100)
    await vi.advanceTimersByTimeAsync(100)
    fail(new Error('AbortError'))
    expect(await pending).toEqual({ timedOut: true })
  })

  it('error ระหว่างรอ ส่งต่อให้ผู้เรียกจัดการ', async () => {
    await expect(withTimeout(() => Promise.reject(new Error('x')), 1000)).rejects.toThrow('x')
  })

  it('ข้อความหมดเวลาเป็นภาษาไทย และไม่บอกให้กดซ้ำทันที', () => {
    expect(thaiError(SLOW_REPLY)).toBe(SLOW_REPLY)
    expect(SLOW_REPLY).toContain('ดูสถานะงาน')
  })
})
