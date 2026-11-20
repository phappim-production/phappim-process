import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_UPLOAD_BYTES, filesUrl, signFiles, uploadFile } from './files'
import { uploadMockup } from './mockups'

const mocks = vi.hoisted(() => ({
  storage: { upload: vi.fn(), createSignedUrls: vi.fn() },
  bucket: vi.fn(),
  getSession: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: mocks.getSession }, storage: { from: (b: string) => { mocks.bucket(b); return mocks.storage } } },
}))

const noWait = () => Promise.resolve()
const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })
const jpeg = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' })

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

describe('ที่เก็บไฟล์ R2 ผ่าน Worker', () => {
  beforeEach(() => { vi.stubEnv('VITE_FILES_URL', 'https://files.test/ ') })

  it('ตัด / ท้ายที่อยู่ Worker', () => {
    expect(filesUrl()).toBe('https://files.test')
  })

  it('อัปโหลดด้วยโทเคนของผู้ใช้ ชนิดไฟล์ตรง path', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { path: 'SC-1/ab.jpg' }))
    await expect(uploadFile('mockups', 'SC-1/ab.jpg', jpeg(10), 'image/jpeg', { fetcher })).resolves.toEqual({ ok: true })
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://files.test/upload/mockups/SC-1/ab.jpg')
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'image/jpeg' })
  })

  it('20 MiB พอดีส่งได้ · เกิน 1 ไบต์ไม่ส่ง และบอก 20 MB', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(200, {}))
    await expect(uploadFile('mockups', 'SC-1/ab.jpg', jpeg(MAX_UPLOAD_BYTES), 'image/jpeg', { fetcher })).resolves.toEqual({ ok: true })
    const over = await uploadFile('mockups', 'SC-1/ab.jpg', jpeg(MAX_UPLOAD_BYTES + 1), 'image/jpeg', { fetcher })
    expect(over).toEqual({ ok: false, reason: expect.stringContaining('เกิน 20 MB') })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('เน็ตหลุดระหว่างส่ง ลองซ้ำเองด้วย path เดิม แล้วสำเร็จ', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(reply(200, { existed: true }))
    const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined)
    await expect(uploadFile('confirmations', 'SC-1/ab.pdf', new Blob(['%PDF-1.7']), 'application/pdf', { fetcher, wait })).resolves.toEqual({ ok: true })
    expect(fetcher.mock.calls.map(c => c[0])).toEqual(Array(3).fill('https://files.test/upload/confirmations/SC-1/ab.pdf'))
    expect(wait.mock.calls.map(c => c[0])).toEqual([1_000, 3_000])
  })

  it('เน็ตหลุดตลอด บอกให้ตรวจอินเทอร์เน็ต', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    const r = await uploadFile('confirmations', 'SC-1/ab.pdf', new Blob(['%PDF']), 'application/pdf', { fetcher, wait: noWait })
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('ตรวจอินเทอร์เน็ต') })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('Worker ปฏิเสธ (บัญชีปิด / ไม่มีสิทธิ์) ไม่ลองซ้ำ ใช้ข้อความจาก Worker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(403, { error: 'บัญชีนี้ถูกปิดหรือยังไม่ได้ล็อกอิน' }))
    await expect(uploadFile('mockups', 'SC-1/ab.jpg', jpeg(10), 'image/jpeg', { fetcher, wait: noWait }))
      .resolves.toEqual({ ok: false, reason: 'บัญชีนี้ถูกปิดหรือยังไม่ได้ล็อกอิน' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('Worker ขัดข้องชั่วคราว ลองซ้ำ', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(503, { error: 'x' })).mockResolvedValueOnce(reply(200, {}))
    await expect(uploadFile('mockups', 'SC-1/ab.jpg', jpeg(10), 'image/jpeg', { fetcher, wait: noWait })).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('ไม่มีโทเคน (หลุดล็อกอิน) ไม่ส่งไฟล์ และบอกให้ล็อกอินใหม่', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    const fetcher = vi.fn<typeof fetch>()
    await expect(uploadFile('mockups', 'SC-1/ab.jpg', jpeg(10), 'image/jpeg', { fetcher })).resolves.toEqual({ ok: false, reason: expect.stringContaining('ล็อกอินใหม่') })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('ขอลิงก์เปิดไฟล์: ได้เฉพาะ path ที่ขอ · ไม่ใช้ Supabase Storage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { urls: { 'SC-1/a.pdf': 'https://files.test/f/a', 'x/other.pdf': 'https://evil' } }))
    const r = await signFiles('confirmations', ['SC-1/a.pdf', 'SC-1/a.pdf', 'SC-1/b.pdf'], 300, { fetcher })
    expect(r).toEqual({ ok: true, urls: new Map([['SC-1/a.pdf', 'https://files.test/f/a']]) })
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({ kind: 'confirmations', paths: ['SC-1/a.pdf', 'SC-1/b.pdf'], seconds: 300 })
    expect(mocks.storage.createSignedUrls).not.toHaveBeenCalled()
  })

  it('ขอลิงก์ไม่ได้ บอกเหตุผลจาก Worker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(403, { error: 'บัญชีนี้ถูกปิด' }))
    await expect(signFiles('mockups', ['SC-1/a.jpg'], 60, { fetcher })).resolves.toEqual({ ok: false, reason: 'บัญชีนี้ถูกปิด' })
  })

  it('อัปโหลดรูปม็อคอัพเดิมซ้ำ ได้ path เดิม (ไม่สร้างไฟล์ใหม่)', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return reply(200, {}) }))
    try {
      const blob = new Blob(['same picture'], { type: 'image/png' })
      const first = await uploadMockup('SC-1', blob)
      const second = await uploadMockup('SC-1', blob)
      expect(first).toEqual({ ok: true, path: expect.stringMatching(/^SC-1\/[a-f0-9]{16}\.png$/) })
      expect(second).toEqual(first)
      expect(new Set(calls).size).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('ยังไม่เปิดใช้ R2 = Supabase Storage แบบเดิม', () => {
  it('อัปโหลดเข้า bucket ตามประเภทไฟล์ · ไฟล์มีอยู่แล้ว = สำเร็จ', async () => {
    mocks.storage.upload.mockResolvedValueOnce({ error: { message: 'The resource already exists' } })
    await expect(uploadFile('confirmations', 'SC-1/ab.pdf', new Blob(['%PDF']), 'application/pdf')).resolves.toEqual({ ok: true })
    expect(mocks.bucket).toHaveBeenCalledWith('confirmations')
    expect(mocks.storage.upload).toHaveBeenCalledWith('SC-1/ab.pdf', expect.any(Blob), { contentType: 'application/pdf', upsert: false })
  })

  it('ขอลิงก์จาก Storage', async () => {
    mocks.storage.createSignedUrls.mockResolvedValueOnce({ data: [{ path: 'SC-1/ab.pdf', signedUrl: 'https://s/1', error: null }], error: null })
    await expect(signFiles('confirmations', ['SC-1/ab.pdf'], 300)).resolves.toEqual({ ok: true, urls: new Map([['SC-1/ab.pdf', 'https://s/1']]) })
  })
})
