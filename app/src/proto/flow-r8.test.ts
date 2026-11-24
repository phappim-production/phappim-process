import { afterEach, describe, expect, it, vi } from 'vitest'
import { RPC_TIMEOUT_MS, withTimeout } from '../data/live'
import { attachMockupUrls, MAX_MOCKUP_BYTES, signMockups, uploadMockup } from '../data/mockups'
import { isOverdue, thaiDay, thaiWorkEnd, type Job } from './model'
import { bookingDay, bookingTime, isBookingSunday, machineCounts, moveBookingDay, pausesJob, type Booking, type Machine, type Need } from './sewing'

const storage = vi.hoisted(() => ({ createSignedUrls: vi.fn(), upload: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { storage: { from: () => storage } } }))

const now = new Date('2026-11-21T10:59:00Z')
const job: Job = {
  id: 'r8', no: 'TEST-R8', customer: 'ลูกค้าจำลอง', product: 'เสื้อ', productCode: 'tshirt',
  unit: 'ตัว', qty: 10, due: thaiWorkEnd('2026-11-21'), route: 'plain', phase: 'production',
  station: 'sew', status: 'doing', since: now, sampleRound: 1, materials: { admin: true, qc: true, production: true },
}
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('R8 Storage จำลอง', () => {
  it('ปฏิเสธรูปใหญ่เกิน 20 MB ก่อนส่งคำขอ', async () => {
    const blob = new Blob([new Uint8Array(MAX_MOCKUP_BYTES + 1)], { type: 'image/jpeg' })
    await expect(uploadMockup(job.no, blob)).resolves.toEqual({ ok: false, reason: expect.stringContaining('เกิน 20 MB') })
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('อัปโหลดรูปเดิมแล้วพบไฟล์ซ้ำ คืน path เดิม และแปลข้อผิดพลาดอื่น', async () => {
    storage.upload.mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'Resource already exists' } })
      .mockResolvedValueOnce({ error: { message: 'Bucket not found' } })
    const blob = new Blob(['fixture'], { type: 'image/png' })
    const first = await uploadMockup(job.no, blob)
    expect(first).toEqual({ ok: true, path: expect.stringMatching(/^TEST-R8\/[a-f0-9]{16}\.png$/) })
    await expect(uploadMockup(job.no, blob)).resolves.toEqual(first)
    await expect(uploadMockup(job.no, blob)).resolves.toEqual({ ok: false, reason: expect.stringContaining('แจ้งเจ้าของระบบ') })
  })

  it('Storage ช้าเกิน 8 วินาที เลิกคอยและปล่อยการ์ดแบบไม่มีลิงก์', async () => {
    vi.useFakeTimers()
    storage.createSignedUrls.mockImplementation(() => new Promise(() => {}))
    const path = 'TEST-R8-SLOW/file.jpg'
    const result = signMockups([path])
    await vi.advanceTimersByTimeAsync(8_000)
    const links = await result
    expect(links.size).toBe(0)
    expect(attachMockupUrls([{ ...job, mockup: path }], links)[0]?.mockupUrl).toBeUndefined()
  })

  it('ขอลิงก์รูปใหม่เมื่อหมดอายุและขอครั้งเดียวเมื่อ path ซ้ำ', async () => {
    const path = 'TEST-R8-EXPIRE/file.jpg'
    storage.createSignedUrls.mockResolvedValueOnce({ data: [{ path, signedUrl: '/local/old' }] })
      .mockResolvedValueOnce({ data: [{ path, signedUrl: '/local/new' }] })
    expect((await signMockups([path, path], now.getTime())).get(path)).toBe('/local/old')
    expect(storage.createSignedUrls).toHaveBeenNthCalledWith(1, [path], 3_600)
    expect((await signMockups([path], now.getTime() + 3_600_000)).get(path)).toBe('/local/new')
  })
})

describe('R8 จักรเย็บและเส้นเวลา', () => {
  const needs: Need[] = [{ type: 'single', qty: 1 }]
  const assigned: Machine = { id: '1', code: 'SN-01', type: 'single', status: 'ready', jobId: job.id }
  const spare: Machine = { id: '2', code: 'SN-02', type: 'single', status: 'ready' }
  const shared: Machine = { id: '3', code: 'CV-01', type: 'cover', status: 'ready' }

  it('ไม่นับจักรใช้ร่วมและจักรที่งานอื่นจอง พร้อมเหตุผลขึ้นลง', () => {
    const bookings: Booking[] = [{ id: '3', jobId: 'another', machineId: spare.id,
      starts: new Date(now.getTime() - 1), ends: new Date(now.getTime() + 3_600_000) }]
    const counts = machineCounts(job, [assigned, spare, shared], needs, ['cover'], bookings, now)
    expect(counts).toEqual([expect.objectContaining({
      type: 'single', have: 1, need: 1, free: 0,
      plusBlocked: expect.stringContaining('จองไว้ 1'), minusBlocked: expect.stringContaining('พักงานก่อน'),
    })])
  })

  it('พักอัตโนมัติเฉพาะเมื่อจักรที่เหลือต่ำกว่าขั้นต่ำ', () => {
    const map = { tshirt: needs }
    expect(pausesJob(assigned, [assigned, { ...spare, jobId: job.id }], job, map)).toBe(false)
    expect(pausesJob(assigned, [assigned, spare], job, map)).toBe(true)
    expect(pausesJob(assigned, [assigned], { ...job, status: 'hold' }, map)).toBe(false)
  })

  it.each([
    ['17:59', false], ['18:00', false], ['18:01', true],
  ] as const)('เวลาไทย %s ตรวจเวลาปิดงาน', (time, overdue) => {
    const at = bookingTime('2026-11-21', time)
    expect(at > job.due).toBe(overdue)
  })

  it('ข้ามเที่ยงคืนและปีใหม่ตามวันไทย รวมวันอาทิตย์', () => {
    expect(bookingDay(new Date('2026-12-31T16:59:00Z'))).toBe('2026-12-31')
    const newYear = new Date('2026-12-31T17:01:00Z')
    expect(bookingDay(newYear)).toBe('2027-01-01')
    expect(thaiDay(newYear)).toBe('2027-01-01')
    expect(isBookingSunday(moveBookingDay('2026-11-21', 1))).toBe(true)
    expect(isOverdue(job, new Date('2026-11-21T17:01:00Z'))).toBe(true)
  })

  it('คำขอ 31 วินาทีถูกยกเลิกฝั่งไคลเอนต์ที่ 30 วินาที แม้ปลายทางยังไม่ตอบ', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const result = withTimeout(s => {
      signal = s
      return new Promise(resolve => setTimeout(() => resolve('สำเร็จภายหลัง'), 31_000))
    }, RPC_TIMEOUT_MS)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual({ timedOut: true })
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
  })
})
