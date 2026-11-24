import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachMockupUrls, contentKey, dataUrlBlob, forgetMockupUrls, mockupDataUrl, mockupExt, mockupFolder, mockupPath, mockupProblem, mockupThumbPath, mockupThumbUrl, parseStoredUrls, signMockups, uploadMockupThumb } from './mockups'
import type { SignResult, uploadFile } from './files'
import { toJobs, type JobRow } from './live'
import type { Job } from '../proto/model'

const row: JobRow = {
  id: 'j1', confirmation_no: 'SC-1', customer_name: 'ลูกค้า', job_name: null, product_type_code: 'tshirt', qty: 10, unit: 'ตัว',
  due_date: '2026-11-30', route_code: 'plain', phase: 'production', current_station: 'cut', station_status: 'queued',
  stage_entered_at: '2026-11-19T02:00:00Z', sample_round: 1, materials_waiting_depts: null, dtf_film_eta: null,
  dtf_film_received_at: null, sew_count: 0, is_rework: false, rework_qty: null, hold_reason: null, finished_at: null,
}

describe('รูปม็อคอัพ: ชื่อไฟล์และชนิดไฟล์', () => {
  it('ชื่อไฟล์ใช้อังกฤษ/ตัวเลข (ชื่อไทยอัปโหลดไม่ผ่าน) และมีเวลากันซ้ำ', () => {
    const at = new Date('2026-11-19T03:00:00Z')
    expect(mockupPath('SC-6911/001', at)).toBe(`SC-6911_00002f001/${at.getTime()}.jpg`)
    expect(mockupPath('ใบไทย', at, 'png')).toMatch(/^(_[0-9a-f]{6})+\/\d+\.png$/)
    expect(mockupPath('  ', at)).toBe(`job/${at.getTime()}.jpg`)
  })
  it('ชื่อไฟล์จากเนื้อรูป: รูปเดิมได้ชื่อเดิม (บันทึกซ้ำไม่สะสมไฟล์) · รูปต่างได้ชื่อต่าง', async () => {
    const a = await contentKey(new Blob(['AAA'], { type: 'image/jpeg' }))
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(await contentKey(new Blob(['AAA'], { type: 'image/jpeg' }))).toBe(a)
    expect(await contentKey(new Blob(['AAB'], { type: 'image/jpeg' }))).not.toBe(a)
    expect(mockupPath('SC-1', a)).toBe(`SC-1/${a}.jpg`)
    expect(mockupFolder(' ใบ 1 ')).toBe('_000e43_000e1a_0000201')
    expect(mockupFolder('SC/ก')).not.toBe(mockupFolder('SC/ข'))
    expect(mockupFolder('   ')).toBe('job')
  })
  it('รับเฉพาะ JPG / PNG / WEBP', () => {
    expect(mockupExt('image/jpeg')).toBe('jpg')
    expect(mockupExt('image/webp')).toBe('webp')
    expect(mockupExt('image/gif')).toBeNull()
    expect(mockupProblem({ size: 1000, type: 'application/pdf' })).toMatch(/JPG/)
    expect(mockupProblem({ size: 20 * 1024 * 1024 + 1, type: 'image/png' })).toBe('รูปใหญ่ 20.1 MB เกิน 20 MB ให้ย่อรูปก่อน')
    expect(mockupProblem({ size: 20 * 1024 * 1024, type: 'image/png' })).toBeNull()
    expect(mockupProblem({ size: 6 * 1024 * 1024, type: 'image/png' })).toBeNull()
  })
})

describe('รูปย่อที่ฟอร์มส่งมา', () => {
  it('อ่าน data URL ของรูป · อย่างอื่น = ไม่มีรูป', () => {
    expect(mockupDataUrl('data:image/jpeg;base64,QUJD')).toEqual({ type: 'image/jpeg', base64: 'QUJD' })
    expect(mockupDataUrl('data:text/html;base64,QUJD')).toBeNull()
    expect(mockupDataUrl('data:image/jpeg;base64,<script>')).toBeNull()
    expect(mockupDataUrl(undefined)).toBeNull()
    expect(mockupDataUrl({ src: 'x' })).toBeNull()
  })
  it('แปลงเป็นไฟล์ชนิดเดียวกันก่อนอัปโหลด', async () => {
    const blob = dataUrlBlob({ type: 'image/jpeg', base64: 'QUJD' })
    expect(blob.type).toBe('image/jpeg')
    expect(await blob.text()).toBe('ABC')
  })
})

describe('รูปบนการ์ดงาน', () => {
  it('งานจากฐานข้อมูลเก็บ path รูป · ไม่มีรูป = ไม่มี field', () => {
    const [withPic, noPic] = toJobs([{ ...row, mockup_path: 'SC-1/1.jpg' }, { ...row, id: 'j2', mockup_path: null }], [], [], [])
    expect(withPic?.mockup).toBe('SC-1/1.jpg')
    expect(noPic && 'mockup' in noPic).toBe(false)
  })
  it('ใส่ลิงก์เฉพาะงานที่ขอลิงก์ได้ · ขอไม่ได้ = การ์ดแสดงกรอบว่าง', () => {
    const jobs = toJobs([{ ...row, mockup_path: 'a.jpg' }, { ...row, id: 'j2', mockup_path: 'b.jpg' }, { ...row, id: 'j3' }], [], [], [])
    const out: Job[] = attachMockupUrls(jobs, new Map([['a.jpg', 'https://x/a']]))
    expect(out.map(j => j.mockupUrl)).toEqual(['https://x/a', undefined, undefined])
    expect(out[2]).toBe(jobs[2])  // งานที่ไม่เปลี่ยน ใช้ object เดิม
  })
  it('ไม่มีการเชื่อมต่อระบบ = ไม่มีลิงก์ ไม่ทำให้หน้าเสีย', async () => {
    expect((await signMockups(['a.jpg'])).size).toBe(0)
  })
})

describe('ลิงก์รูปม็อคอัพที่จำไว้', () => {
  const HOUR = 60 * 60 * 1000
  function memoryStore(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial))
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v) },
      removeItem: (k: string) => { data.delete(k) },
    }
  }
  function signer(have: string[]) {
    const asked: string[][] = []
    const sign = (_kind: string, paths: readonly string[]): Promise<SignResult> => {
      asked.push([...paths])
      return Promise.resolve({ ok: true, urls: new Map(paths.filter(p => have.includes(p)).map(p => [p, `https://x/${p}?${asked.length}`])) })
    }
    return { asked, sign }
  }

  it('อ่านเฉพาะลิงก์ที่ยังไม่หมดอายุ · ข้อมูลเสียไม่ทำให้พัง', () => {
    const text = JSON.stringify({ 'a.jpg': { url: 'https://x/a', until: 2000 }, 'b.jpg': { url: 'https://x/b', until: 500 }, 'c.jpg': { url: 5 }, 'd.jpg': null })
    expect([...parseStoredUrls(text, 1000)]).toEqual([['a.jpg', { url: 'https://x/a', until: 2000 }]])
    expect(parseStoredUrls('{เสีย', 0).size).toBe(0)
    expect(parseStoredUrls('[1]', 0).size).toBe(0)
    expect(parseStoredUrls(null, 0).size).toBe(0)
  })

  it('ลิงก์ที่ขอแล้วเก็บข้ามการรีเฟรชหน้า ไม่ขอซ้ำจนใกล้หมดอายุ', async () => {
    forgetMockupUrls(null)
    const store = memoryStore()
    const first = signer(['a.jpg'])
    expect((await signMockups(['a.jpg'], 0, { sign: first.sign, store })).get('a.jpg')).toBe('https://x/a.jpg?1')
    forgetMockupUrls(null)
    const afterReload = signer(['a.jpg'])
    expect((await signMockups(['a.jpg'], 0.4 * HOUR, { sign: afterReload.sign, store })).get('a.jpg')).toBe('https://x/a.jpg?1')
    expect(afterReload.asked).toEqual([])
    expect((await signMockups(['a.jpg'], 0.6 * HOUR, { sign: afterReload.sign, store })).get('a.jpg')).toBe('https://x/a.jpg?1')
    expect(afterReload.asked).toEqual([['a.jpg']])
  })

  it('path ที่ขอลิงก์ไม่ได้ไม่ถูกขอซ้ำทุกรอบ · ครบ 5 นาทีลองใหม่', async () => {
    forgetMockupUrls(null)
    const s = signer(['a.jpg'])
    const store = memoryStore()
    await signMockups(['a.jpg', 'gone.jpg'], 0, { sign: s.sign, store })
    await signMockups(['a.jpg', 'gone.jpg'], 60_000, { sign: s.sign, store })
    expect(s.asked).toEqual([['a.jpg', 'gone.jpg']])
    await signMockups(['gone.jpg'], 5 * 60_000, { sign: s.sign, store })
    expect(s.asked).toEqual([['a.jpg', 'gone.jpg'], ['gone.jpg']])
  })

  it('ขอลิงก์ไม่สำเร็จทั้งคำขอ (เน็ตหลุด) ไม่นับว่า path หาย · รอบถัดไปขอใหม่', async () => {
    forgetMockupUrls(null)
    let calls = 0
    const down = (): Promise<SignResult> => { calls++; return Promise.resolve({ ok: false, reason: 'x' }) }
    await signMockups(['a.jpg'], 0, { sign: down, store: null })
    await signMockups(['a.jpg'], 1000, { sign: down, store: null })
    expect(calls).toBe(2)
  })

  it('ออกจากระบบ = ลบลิงก์ที่จำไว้ทั้งในแท็บและที่เก็บ · เก็บไม่ได้ก็ยังใช้งานได้', async () => {
    forgetMockupUrls(null)
    const store = memoryStore()
    const s = signer(['a.jpg'])
    await signMockups(['a.jpg'], 0, { sign: s.sign, store })
    expect(store.data.size).toBe(1)
    forgetMockupUrls(store)
    expect(store.data.size).toBe(0)
    const broken = { getItem: () => { throw new Error('ปิดการเก็บข้อมูล') }, setItem: () => { throw new Error('เต็ม') }, removeItem: () => { throw new Error('x') } }
    expect((await signMockups(['a.jpg'], 0, { sign: s.sign, store: broken })).get('a.jpg')).toBeDefined()
    expect(() => forgetMockupUrls(broken)).not.toThrow()
  })
})

describe('รูปย่อบนการ์ด', () => {
  const BASE = 'https://files.test'
  const signed = `${BASE}/f/mockups/SC-1/aabbccddeeff0011.jpg?exp=1764000000&sig=abc`
  afterEach(() => { vi.unstubAllEnvs() })

  it('path รูปย่ออยู่ข้างรูปต้นฉบับ ได้จากต้นฉบับเสมอ', () => {
    expect(mockupThumbPath('SC-1/aabbccddeeff0011.png')).toBe('SC-1/aabbccddeeff0011.png.thumb.jpg')
    expect(mockupThumbPath('SC-1/sheet/ab12.webp')).toBe('SC-1/sheet/ab12.webp.thumb.jpg')
  })

  it('ลิงก์ Worker ได้ v=thumb ต่อท้าย (ลายเซ็นเดิม) · ลิงก์ Storage / blob / Worker อื่น ใช้ลิงก์เดิม', () => {
    expect(mockupThumbUrl(signed, BASE)).toBe(`${signed}&v=thumb`)
    expect(mockupThumbUrl(mockupThumbUrl(signed, BASE), BASE)).toBe(`${signed}&v=thumb`)
    expect(mockupThumbUrl(`${BASE}/f/confirmations/SC-1/a.pdf?exp=1&sig=x`, BASE)).toBe(`${BASE}/f/confirmations/SC-1/a.pdf?exp=1&sig=x`)
    expect(mockupThumbUrl('https://db.supabase.co/storage/v1/object/sign/mockups/SC-1/a.jpg?token=t', BASE)).toBe('https://db.supabase.co/storage/v1/object/sign/mockups/SC-1/a.jpg?token=t')
    expect(mockupThumbUrl('blob:https://app/123', BASE)).toBe('blob:https://app/123')
    expect(mockupThumbUrl('https://evil.test/f/mockups/a.jpg?sig=x', BASE)).toBe('https://evil.test/f/mockups/a.jpg?sig=x')
    expect(mockupThumbUrl(signed, '')).toBe(signed)
  })

  it('ลิงก์ที่จำไว้เก็บแค่ลิงก์ต้นฉบับ รูปย่อกับรูปเต็มจึงไม่ชนกัน', async () => {
    forgetMockupUrls(null)
    vi.stubEnv('VITE_FILES_URL', BASE)
    const sign = (_kind: string, paths: readonly string[]): Promise<SignResult> => Promise.resolve({ ok: true, urls: new Map(paths.map(p => [p, `${BASE}/f/mockups/${p}?exp=1&sig=s`])) })
    const full = (await signMockups(['SC-1/a.jpg'], 0, { sign, store: null })).get('SC-1/a.jpg')
    expect(full).toBe(`${BASE}/f/mockups/SC-1/a.jpg?exp=1&sig=s`)
    expect(mockupThumbUrl(full!)).toBe(`${BASE}/f/mockups/SC-1/a.jpg?exp=1&sig=s&v=thumb`)
    expect((await signMockups(['SC-1/a.jpg'], 0, { sign, store: null })).get('SC-1/a.jpg')).toBe(full)
  })

  const picture = new Blob(['original picture'], { type: 'image/png' })
  const small = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' })

  it('ย่อรูปแล้วส่งไปที่ path รูปย่อ เป็น JPEG ส่งครั้งเดียวไม่ลองซ้ำ', async () => {
    vi.stubEnv('VITE_FILES_URL', BASE)
    const upload = vi.fn<typeof uploadFile>().mockResolvedValue({ ok: true })
    const shrink = vi.fn((_b: Blob) => Promise.resolve(small))
    await expect(uploadMockupThumb('SC-1/ab.png', picture, { shrink, upload })).resolves.toBe(true)
    expect(shrink).toHaveBeenCalledWith(picture)
    expect(upload).toHaveBeenCalledWith('mockups', 'SC-1/ab.png.thumb.jpg', small, 'image/jpeg', { once: true })
  })

  it('ย่อไม่ได้ / ส่งไม่ผ่าน / เน็ตหลุด / ยังไม่เปิดใช้ R2 = ไม่มีรูปย่อ ไม่ throw', async () => {
    vi.stubEnv('VITE_FILES_URL', BASE)
    const upload = vi.fn<typeof uploadFile>().mockResolvedValue({ ok: true })
    await expect(uploadMockupThumb('SC-1/ab.png', picture, { shrink: b => Promise.resolve(b), upload })).resolves.toBe(false)
    await expect(uploadMockupThumb('SC-1/ab.png', picture, { shrink: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })), upload })).resolves.toBe(false)
    await expect(uploadMockupThumb('SC-1/ab.png', picture, { shrink: () => Promise.reject(new Error('decode')), upload })).resolves.toBe(false)
    expect(upload).not.toHaveBeenCalled()
    const refused = vi.fn<typeof uploadFile>().mockResolvedValue({ ok: false, reason: 'ไม่มีสิทธิ์' })
    await expect(uploadMockupThumb('SC-1/ab.png', picture, { shrink: () => Promise.resolve(small), upload: refused })).resolves.toBe(false)
    const thrown = vi.fn<typeof uploadFile>().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(uploadMockupThumb('SC-1/ab.png', picture, { shrink: () => Promise.resolve(small), upload: thrown })).resolves.toBe(false)
    vi.stubEnv('VITE_FILES_URL', '')
    await expect(uploadMockupThumb('SC-1/ab.png', picture, { shrink: () => Promise.resolve(small), upload })).resolves.toBe(false)
    expect(upload).not.toHaveBeenCalled()
  })

  it('ส่งรูปย่อค้างเกิน 10 วินาที เลิกรอ ไม่ค้างปุ่มบันทึก', async () => {
    vi.useFakeTimers()
    try {
      vi.stubEnv('VITE_FILES_URL', BASE)
      const hang = vi.fn<typeof uploadFile>().mockReturnValue(new Promise(() => {}))
      const result = uploadMockupThumb('SC-1/ab.png', picture, { shrink: () => Promise.resolve(small), upload: hang })
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(result).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
