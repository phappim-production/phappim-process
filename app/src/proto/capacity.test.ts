import { describe, expect, it } from 'vitest'
import { CAPACITY, LEAD, lateDays, piecesPerDay, simulate, verdict, workdaysUntil, workdayToDate } from './capacity'
import type { Job } from './model'

const day = (date: number) => new Date(2026, 10, date)
const friday = day(20)
const saturday = day(21)
const sunday = day(22)
const monday = day(23)

const job: Job = {
  id: 'j1', no: 'SC-1', customer: 'ลูกค้าทดสอบ', product: 'เสื้อยืด',
  unit: 'ตัว', qty: 80, due: monday, since: friday,
  route: 'plain', phase: 'production', station: 'cut', status: 'queued',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}

describe('วันทำงานและวันส่ง', () => {
  it.each([
    [saturday, 0.3, saturday],
    [saturday, 1, saturday],
    [saturday, 1.2, monday],
    [sunday, 0.5, monday],
    [friday, 3, monday],
    [friday, -2, friday],
  ])('วันเริ่ม %s + %s วันทำงาน ได้ %s', (start, duration, expected) => {
    expect(workdayToDate(duration, start)).toEqual(expected)
  })

  it.each([
    [monday, saturday, 1],
    [sunday, saturday, 0],
    [friday, saturday, 0],
  ])('นับวันทำงานถึง %s จาก %s ได้ %s วัน', (end, start, expected) => {
    expect(workdaysUntil(end, start)).toBe(expected)
  })

  it.each([
    [monday, saturday, 2],
    [friday, saturday, -1],
    [saturday, saturday, 0],
  ])('ส่ง %s เทียบกำหนด %s ต่าง %s วันปฏิทิน', (finish, due, expected) => {
    expect(lateDays(finish, due)).toBe(expected)
  })
})

describe('คาดการณ์คิวโรงงาน', () => {
  it('โรงงานว่าง งานใหม่ใช้วันเผื่อและกำลังผลิตทุกสถานีในเส้นทาง', () => {
    const result = simulate([], friday, { qty: 600, route: 'normal' })
    const stationDays = 600 / CAPACITY.print + 600 / CAPACITY.press + 600 / CAPACITY.cut
      + 600 / CAPACITY.sew + 600 / CAPACITY.qc_pack

    expect(result.extraFinishDay).toBeCloseTo(LEAD.newJob + stationDays)
    expect(result.extraWaitAt).toBeUndefined()
    expect(result.finishDay.size).toBe(0)
    expect(Object.values(result.load).every(s => s.jobs === 0)).toBe(true)
  })

  it('งานเสร็จทั้งหมดไม่สร้างวันคาดการณ์หรือกินกำลังผลิต', () => {
    const result = simulate([{ ...job, phase: 'done' }], friday)

    expect(result.finishDay.size).toBe(0)
    expect(result.extraFinishDay).toBeUndefined()
    expect(Object.values(result.load).every(s => s.qty === 0 && s.days === 0)).toBe(true)
  })

  it('งานเสร็จไม่ทำให้ผลของงานที่ยังอยู่ในคิวเปลี่ยน', () => {
    const result = simulate([job, { ...job, id: 'done', phase: 'done' }], friday)

    expect(result.finishDay.has(job.id)).toBe(true)
    expect(result).toEqual(simulate([job], friday))
  })

  it('งาน DTF รอฟิล์มจนถึง ETA ก่อนคำนวณเวลารีดและสถานีถัดไป', () => {
    const waiting: Job = { ...job, route: 'dtf', station: 'dtf_press', film: { eta: monday, received: false } }
    const result = simulate([waiting], friday)
    const stationDays = 80 / CAPACITY.dtf_press + 80 / CAPACITY.sew + 80 / CAPACITY.qc_pack

    expect(result.finishDay.get(job.id)).toBeCloseTo(2 + stationDays)
    // ฟิล์มถึงจันทร์ · เย็บ 80 ตัวใช้เกิน 1 วัน (71 ตัว/วัน) → เสร็จอังคาร
    expect(workdayToDate(result.finishDay.get(job.id)!, friday)).toEqual(day(24))
  })

  it('คาดการณ์ล้านชิ้นได้เป็นจำนวนวันจำกัด', () => {
    const result = simulate([{ ...job, qty: 1_000_000 }], friday)

    expect(Number.isFinite(result.finishDay.get(job.id))).toBe(true)
    expect(result.finishDay.get(job.id)).toBeCloseTo(1_000_000 / CAPACITY.cut + 1_000_000 / CAPACITY.sew + 1_000_000 / CAPACITY.qc_pack)
  })

  it('กำลังเย็บคำนวณจากช่าง 3 คน · 20.17 นาทีต่อตัว · 480 นาทีต่อวัน = 71 ตัว', () => {
    expect(piecesPerDay(3, 20.17, 480)).toBe(71)
    expect(piecesPerDay(3, 20, 480)).toBe(72)   // ป้ายผ้า 60x60
    expect(CAPACITY.sew).toBe(71)
  })

  it('งานผลิตที่ไม่มีสถานีเริ่มคำนวณจากสถานีแรกของเส้นทาง', () => {
    expect(simulate([{ ...job, station: undefined }], friday)).toEqual(simulate([job], friday))
  })

  it('สถานีเย็บนับเฉพาะยอดคงเหลือ ส่วน QC นับเต็มจำนวน', () => {
    const result = simulate([{ ...job, station: 'sew', status: 'doing', sewCount: 30 }], friday)

    expect(result.load.cut.qty).toBe(0)
    expect(result.load.sew.qty).toBe(50)
    expect(result.load.qc_pack.qty).toBe(80)
  })

  it('เมื่อสองงานพร้อมในเวลาเดียวกัน สถานีให้คิวงานที่กำหนดส่งก่อน', () => {
    const earlier = { ...job, id: 'early', due: saturday }
    const result = simulate([job, earlier], friday)

    expect(result.finishDay.get(earlier.id)).toBeLessThan(result.finishDay.get(job.id)!)
  })

  it.each([
    [3, 0, 'ok'],
    [3.01, 0, 'tight'],
    [6, 0, 'tight'],
    [6.01, 0, 'full'],
    [1, 1, 'tight'],
    [7, 1, 'full'],
  ])('คิว %s วันและงานเสี่ยง %s งาน ระดับ %s', (days, atRisk, level) => {
    const result = simulate([{ ...job, station: 'sew', qty: days * CAPACITY.sew }], friday)

    expect(result.bottleneck).toBe('sew')
    expect(verdict(result, atRisk).level).toBe(level)
  })
})
