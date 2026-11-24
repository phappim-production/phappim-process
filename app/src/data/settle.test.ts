import { describe, expect, it } from 'vitest'
import { createSettler } from './settle'

const flush = () => new Promise(r => setTimeout(r, 0))

describe('รอรอบโหลดหลังบันทึก', () => {
  it('รอบที่เริ่มก่อนกดบันทึกไม่นับ · รอบแรกที่เริ่มหลังบันทึกปลดการรอ', async () => {
    const s = createSettler()
    const before = s.loadStarted()
    const w = s.wait()
    let done = false
    void w.done.then(() => { done = true })
    s.loadFinished(before)
    await flush()
    expect(done).toBe(false)
    const after = s.loadStarted()
    s.loadFinished(after)
    await flush()
    expect(done).toBe(true)
    expect(s.waiting()).toBe(0)
  })

  it('หลายปุ่มรอพร้อมกัน ปลดด้วยรอบเดียวกัน', async () => {
    const s = createSettler()
    const a = s.wait(), b = s.wait()
    const idx = s.loadStarted()
    s.loadFinished(idx)
    await Promise.all([a.done, b.done])
    expect(s.waiting()).toBe(0)
  })
})
