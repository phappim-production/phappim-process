import { describe, expect, it } from 'vitest'
import type { Job, PhotoGate } from '../proto/model'
import { MY } from '../i18n/my'
import { REJECT_REASONS, attachPhotoGates, minutesWaiting, pendingFirstPieces, photoBlock, photoStep, rejectText, stationPhotoPath, toPhotoGate, type PhotoFlagRow } from './stationPhotos'

const job: Job = {
  id: 'a', no: 'SC-A', customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 10,
  due: new Date('2026-11-30T18:00:00+07:00'), since: new Date('2026-11-18T09:00:00+07:00'),
  route: 'normal', phase: 'production', station: 'print', status: 'doing',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}
const row: PhotoFlagRow = {
  job_id: 'a', station_code: 'print', needs_first_piece: true, first_piece: null, first_piece_id: null,
  reject_reason: null, first_piece_at: null, finish_photos: 0, visit: 3, folder: 'SC-A',
}
const gate = (patch: Partial<PhotoFlagRow>): PhotoGate => toPhotoGate({ ...row, ...patch })!

describe('ขั้นรูปที่สถานี', () => {
  it('ไม่มีข้อมูลรูป = กดเสร็จได้ (ยังไม่เปิดใช้หรือเริ่มก่อนเปิดใช้)', () => {
    expect(photoStep(undefined)).toBe('ready')
    expect(photoBlock(undefined)).toBeNull()
  })
  it('สถานีล็อกชิ้นแรก: ถ่ายชิ้นแรก → รออนุมัติ → ไม่ผ่าน → ผ่านแล้วถ่ายรูปงานเสร็จ', () => {
    expect(photoStep(gate({}))).toBe('first_piece')
    expect(photoStep(gate({ first_piece: 'pending', first_piece_id: 1, first_piece_at: '2026-11-24T02:00:00Z' }))).toBe('wait')
    const rejected = gate({ first_piece: 'rejected', first_piece_id: '2', first_piece_at: '2026-11-24T02:00:00Z', reject_reason: 'สีเพี้ยน' })
    expect(photoStep(rejected)).toBe('rejected')
    expect(rejected.firstPiece).toMatchObject({ id: 2, reason: 'สีเพี้ยน' })
    expect(photoStep(gate({ first_piece: 'approved', first_piece_id: 3, first_piece_at: '2026-11-24T02:00:00Z' }))).toBe('finish')
    expect(photoStep(gate({ first_piece: 'approved', first_piece_id: 3, first_piece_at: '2026-11-24T02:00:00Z', finish_photos: 1 }))).toBe('ready')
  })
  it('สถานีไม่ล็อกชิ้นแรก: ต้องมีรูปงานเสร็จอย่างเดียว', () => {
    expect(photoBlock(gate({ needs_first_piece: false }))).toBe('ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป')
    expect(photoBlock(gate({ needs_first_piece: false, finish_photos: 2 }))).toBeNull()
  })
  it('ข้อความตรงกับที่ฐานข้อมูลปฏิเสธ', () => {
    expect(photoBlock(gate({}))).toBe('ถ่ายรูปชิ้นแรกส่งให้แอดมินอนุมัติก่อน')
    expect(photoBlock(gate({ first_piece: 'pending', first_piece_id: 1, first_piece_at: '2026-11-24T02:00:00Z' }))).toBe('รูปชิ้นแรกรอแอดมินอนุมัติ')
  })
})

describe('ข้อมูลรูปบนการ์ดงาน', () => {
  it('ติดเฉพาะงานที่สถานีตรงกัน · สถานีไม่ตรง (ข้อมูลเก่า) เอาออก', () => {
    expect(attachPhotoGates([job], [row])[0]?.photos?.station).toBe('print')
    expect(attachPhotoGates([{ ...job, station: 'press' }], [row])[0]?.photos).toBeUndefined()
    expect(attachPhotoGates([{ ...job, photos: gate({}) }], [])[0]?.photos).toBeUndefined()
  })
  it('รหัสสถานีที่ไม่รู้จักไม่ติด', () => {
    expect(toPhotoGate({ ...row, station_code: 'nope' })).toBeNull()
  })
})

describe('ที่เก็บรูป', () => {
  it('path = งาน/สถานี/รอบ/ลายนิ้วมือ.jpg ตรงกับที่ฐานข้อมูลและ Worker รับ', () => {
    expect(stationPhotoPath(gate({}), 'a1b2c3d4')).toBe('SC-A/print/3/a1b2c3d4.jpg')
    expect(stationPhotoPath(gate({}), '17-32')).toBe('SC-A/print/3/1732.jpg')
    expect(stationPhotoPath(gate({}), '..')).toBe('SC-A/print/3/photo.jpg')
  })
  it('นาทีที่รอ ไม่ติดลบ', () => {
    const at = new Date('2026-11-24T02:00:00Z')
    expect(minutesWaiting(at, new Date('2026-11-24T02:16:30Z'))).toBe(16)
    expect(minutesWaiting(at, new Date('2026-11-24T01:00:00Z'))).toBe(0)
  })
})

describe('คิวอนุมัติชิ้นแรก', () => {
  it('งานที่รออนุมัติ (รวมงานที่พักระหว่างรอ) · รอนานสุดขึ้นก่อน', () => {
    const wait = (id: string, at: string, status: 'doing' | 'hold' = 'doing'): Job =>
      ({ ...job, id, status, photos: gate({ first_piece: 'pending', first_piece_id: id.charCodeAt(0), first_piece_at: at }) })
    const list = pendingFirstPieces([
      wait('b', '2026-11-24T03:00:00Z'), wait('a', '2026-11-24T02:00:00Z'), wait('h', '2026-11-24T01:00:00Z', 'hold'),
      { ...job, id: 'c', photos: gate({ first_piece: 'approved', first_piece_id: 9, first_piece_at: '2026-11-24T01:00:00Z' }) }, job,
    ])
    expect(list.map(p => p.job.id)).toEqual(['h', 'a', 'b'])
  })
  it('งานที่กลับเข้าคิวระหว่างรอยังอยู่ในรายการ · งานต้นทางกับส่วนที่แบ่งรอรูปเดียวกันขึ้นแถวเดียว', () => {
    const pending = gate({ first_piece: 'pending', first_piece_id: 7, first_piece_at: '2026-11-24T02:00:00Z' })
    const list = pendingFirstPieces([
      { ...job, id: 'parent', status: 'queued', photos: pending },
      { ...job, id: 'child', no: 'SC-A-2', status: 'doing', photos: pending },
    ])
    expect(list.map(p => [p.job.id, p.checkId])).toEqual([['parent', 7]])
  })
  it('เหตุผลไม่ผ่าน = ที่เลือก + ที่พิมพ์เพิ่ม', () => {
    expect(rejectText(['สีเพี้ยน', 'ขนาดผิด'], '  โลโก้ต่ำไป ')).toBe('สีเพี้ยน · ขนาดผิด · โลโก้ต่ำไป')
    expect(rejectText([], '   ')).toBe('')
  })
})

it('เหตุผลไม่ผ่านแบบเลือกได้ มีคำแปลพม่าให้พนักงานสถานี', () => {
  for (const r of REJECT_REASONS) expect(MY[r], r).toBeTruthy()
})
