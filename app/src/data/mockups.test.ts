import { describe, expect, it } from 'vitest'
import { attachMockupUrls, contentKey, dataUrlBlob, mockupDataUrl, mockupExt, mockupFolder, mockupPath, mockupProblem, signMockups } from './mockups'
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
    expect(mockupProblem({ size: 6 * 1024 * 1024, type: 'image/png' })).toMatch(/เกิน 5 MB/)
    expect(mockupProblem({ size: 1000, type: 'image/png' })).toBeNull()
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
