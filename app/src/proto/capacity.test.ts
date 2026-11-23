import { describe, expect, it } from 'vitest'
import { CAPACITY, LEAD, SEW_LINE_RATE, receiveForecast, hasSewMinutes, lineRate, SEW_MAX_LINES, canOpenLine, lateDays, linesFor, machineSets, piecesPerDay, sewFloorOf, simulate, verdict, workdaysUntil, workdayToDate } from './capacity'
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
    [sunday, saturday, 1],
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
      + 600 / SEW_LINE_RATE + 600 / CAPACITY.qc_pack

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
    const stationDays = 80 / CAPACITY.dtf_press + 80 / SEW_LINE_RATE + 80 / CAPACITY.qc_pack

    expect(result.finishDay.get(job.id)).toBeCloseTo(2 + stationDays)
    // ฟิล์มถึงจันทร์ · 1 ไลน์เย็บ 80 ตัวใช้เกิน 1 วัน (71 ตัว/วัน) → เสร็จอังคาร
    expect(workdayToDate(result.finishDay.get(job.id)!, friday)).toEqual(day(24))
  })

  it('คาดการณ์ล้านชิ้นได้เป็นจำนวนวันจำกัด', () => {
    const result = simulate([{ ...job, qty: 1_000_000 }], friday)

    expect(Number.isFinite(result.finishDay.get(job.id))).toBe(true)
    expect(result.finishDay.get(job.id)).toBeCloseTo(1_000_000 / CAPACITY.cut + 1_000_000 / SEW_LINE_RATE + 1_000_000 / CAPACITY.qc_pack)
  })

  it('กำลังเย็บ: ไลน์ละช่าง 3 คน · 20.17 นาทีต่อตัว · 480 นาทีต่อวัน · ช่าง 15 คน = 5 ไลน์', () => {
    expect(piecesPerDay(3, 20.17, 480)).toBe(71)
    expect(piecesPerDay(3, 20, 480)).toBe(72)
    expect(SEW_LINE_RATE).toBe(71)
    expect(SEW_MAX_LINES).toBe(5)
    expect(CAPACITY.sew).toBe(355)
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

describe('ไลน์เย็บตามจักรที่มี', () => {
  const ready = { single: 14, ovl4: 4, cover: 1, button: 1, buttonhole: 1 }
  const tee = [{ type: 'ovl4' as const, qty: 2 }, { type: 'cover' as const, qty: 1 }, { type: 'single' as const, qty: 1 }]
  const banner = [{ type: 'single' as const, qty: 1 }]
  const floor = { ready, needsOf: (code?: string) => (code === 'banner' ? banner : tee) }
  const sewJob = (id: string, productCode: string, qty: number): Job => ({ ...job, id, productCode, qty, route: 'normal', station: 'sew', status: 'queued', phase: 'production', sewCount: 0 })

  it('นับชุดจักรครบได้กี่ชุด · จักรลา 1 ตัว = เสื้อยืดได้ 1 ไลน์', () => {
    expect(machineSets(tee, ready)).toBe(1)
    expect(machineSets(banner, ready)).toBe(14)
    expect(machineSets([], ready)).toBe(Infinity)
    expect(linesFor(tee, ready)).toBe(1)
    expect(linesFor(banner, ready)).toBe(5)              // ช่างพอแค่ 5 ไลน์
    expect(linesFor(tee, { ...ready, cover: 0 })).toBe(1) // จักรลาเสีย → ถือว่าซ่อมได้ ไม่เป็นอนันต์
  })

  it('เปิดไลน์ใหม่ไม่ได้ถ้าจักรที่ต้องใช้ถูกไลน์อื่นใช้อยู่ หรือไลน์เต็ม', () => {
    const teeLine = { start: 0, end: 2, needs: tee }
    expect(canOpenLine(0, 1, tee, [teeLine], ready)).toBe(false)
    expect(canOpenLine(2, 1, tee, [teeLine], ready)).toBe(true)
    expect(canOpenLine(0, 1, banner, [teeLine], ready)).toBe(true)
    const full = Array.from({ length: 5 }, () => ({ start: 0, end: 3, needs: banner }))
    expect(canOpenLine(1, 1, banner, full, ready)).toBe(false)
    // ไลน์อื่นที่จะเริ่มกลางช่วงก็กันจักรด้วย
    expect(canOpenLine(0, 3, tee, [{ start: 1, end: 2, needs: tee }], ready)).toBe(false)
  })

  it('เสื้อยืด 2 งานต้องเย็บต่อกัน · ป้ายผ้าเย็บพร้อมกันได้', () => {
    const r = simulate([sewJob('t1', 'tshirt', 71), sewJob('t2', 'tshirt', 71), sewJob('b1', 'banner', 71)], friday, undefined, floor)
    const qcDays = 71 / CAPACITY.qc_pack
    expect(r.finishDay.get('t1')! + r.finishDay.get('t2')!).toBeCloseTo(1 + 2 + qcDays * 2 + qcDays, 0)
    expect(Math.max(r.finishDay.get('t1')!, r.finishDay.get('t2')!)).toBeGreaterThanOrEqual(2)
    expect(r.finishDay.get('b1')!).toBeLessThan(2)
  })

  it('ภาระสถานีเย็บของเสื้อยืดคิดเป็น 1 ไลน์', () => {
    const r = simulate([sewJob('t1', 'tshirt', 142)], friday, undefined, floor)
    expect(r.load.sew.days).toBeCloseTo(2)
    expect(Math.round(r.load.sew.rate)).toBe(71)
  })

  it('sewFloorOf นับเฉพาะจักรที่ใช้ได้ และใช้สูตรเสื้อยืดเมื่อไม่รู้สินค้า', () => {
    const f = sewFloorOf([
      { id: '1', code: 'CV-001', type: 'cover', status: 'ready', jobId: 'x' },
      { id: '2', code: 'CV-002', type: 'cover', status: 'broken' },
    ], { tshirt: tee })
    expect(f.ready.cover).toBe(1)
    expect(f.needsOf()).toEqual(tee)
    expect(f.needsOf('unknown')).toEqual([])
  })

  it('สินค้าต่างกันใช้จักรต่างกัน: กางเกงไม่ใช้จักรลา จึงเย็บพร้อมเสื้อยืดได้ · ฮาวายใช้จักรลา ต้องรอ', () => {
    const pants = [{ type: 'ovl4' as const, qty: 1 }, { type: 'single' as const, qty: 1 }]
    const hawaii = [{ type: 'ovl4' as const, qty: 1 }, { type: 'cover' as const, qty: 1 }, { type: 'single' as const, qty: 1 }, { type: 'button' as const, qty: 1 }, { type: 'buttonhole' as const, qty: 1 }]
    const mixed = { ready, needsOf: (code?: string) => (code === 'pajama' ? pants : code === 'hawaii' ? hawaii : tee) }
    const r = simulate([sewJob('t1', 'tshirt', 142), sewJob('p1', 'pajama', 71), sewJob('h1', 'hawaii', 71)], friday, undefined, mixed)
    const qc = 142 / CAPACITY.qc_pack
    expect(r.finishDay.get('p1')!).toBeLessThan(1.5)            // ไลน์ของตัวเองทันที
    expect(r.finishDay.get('h1')! + r.finishDay.get('t1')!).toBeGreaterThan(3 + qc)  // แย่งจักรลาตัวเดียว ต้องเย็บต่อกัน
  })

  it('เวลาเย็บต่อชิ้นตามสินค้า · สินค้าที่ยังไม่จับเวลาใช้เวลาเสื้อยืด', () => {
    expect(lineRate('tshirt')).toBe(71)
    expect(lineRate('banner')).toBe(72)
    expect(lineRate()).toBe(71)
    expect(hasSewMinutes('banner')).toBe(true)
    expect(hasSewMinutes('pajama')).toBe(false)
    expect(lineRate('pajama')).toBe(71)
  })

  it('จักรลาใช้ร่วม (ไม่อยู่ในชุดจักร): เสื้อยืดเปิดได้ 2 ไลน์ตามโพ้ง 4 เส้น', () => {
    const teeLine = [{ type: 'ovl4' as const, qty: 2 }, { type: 'single' as const, qty: 1 }]
    expect(linesFor(teeLine, ready)).toBe(2)
    const shared = { ready, needsOf: () => teeLine, shared: ['cover' as const] }
    const r = simulate([sewJob('t1', 'tshirt', 71), sewJob('t2', 'tshirt', 71), sewJob('t3', 'tshirt', 71)], friday, undefined, shared)
    const days = ['t1', 't2', 't3'].map(id => r.finishDay.get(id)!).sort((a, b) => a - b)
    expect(days[1]).toBeLessThan(1.5)          // 2 งานแรกเย็บพร้อมกัน
    expect(days[2]).toBeGreaterThan(2)         // งานที่ 3 รอโพ้งว่าง
  })
})

describe('คาดวันเสร็จตอนแอดมินส่งงานเข้า (เตือนอย่างเดียว)', () => {
  it('ไม่ขึ้นตัวอย่าง: เข้าสถานีแรกทันที · ขึ้นตัวอย่าง: เผื่อตัวอย่าง + ลูกค้ายืนยัน', () => {
    const plain = receiveForecast([], friday, undefined, { route: 'plain', qty: 10, productCode: 'tshirt', needsSample: false, due: '2026-11-30' })
    const sample = receiveForecast([], friday, undefined, { route: 'plain', qty: 10, productCode: 'tshirt', needsSample: true, due: '2026-11-30' })
    expect(plain.finish).toEqual(friday)
    expect(sample.finish.getTime()).toBeGreaterThan(plain.finish.getTime())
    expect(plain.late).toBeLessThan(0)
  })

  it('งาน Develop: คาดว่าเสร็จหลังตัวอย่าง ไม่นับเวลาผลิตจริง', () => {
    const big = { route: 'normal' as const, qty: 1000, productCode: 'tshirt', needsSample: true, due: '2026-11-30' }
    const dev = receiveForecast([], friday, undefined, { ...big, develop: true })
    expect(dev.finish).toEqual(workdayToDate(LEAD.sample + LEAD.sampleReview, friday))
    expect(dev.finish.getTime()).toBeLessThan(receiveForecast([], friday, undefined, big).finish.getTime())
  })

  it('งานใหญ่กำหนดส่งใกล้: บอกว่าช้ากี่วัน', () => {
    const r = receiveForecast([], friday, undefined, { route: 'normal', qty: 1000, productCode: 'tshirt', needsSample: false, due: '2026-11-21' })
    expect(r.late).toBeGreaterThan(0)
  })

  it('ยังไม่ใส่กำหนดส่ง: ไม่ตัดสินว่าทันหรือไม่', () => {
    expect(receiveForecast([], friday, undefined, { route: 'plain', qty: 10, needsSample: false, due: '' }).late).toBeNull()
  })
})

describe('ความเร็วการคาดการณ์', () => {
  it('งาน 300 งาน (เย็บแย่งจักร) คำนวณเสร็จภายในครึ่งวินาที', () => {
    const ready = { single: 14, ovl4: 4, cover: 1 }
    const floor = { ready, needsOf: () => [{ type: 'single' as const, qty: 1 }], shared: ['cover' as const, 'ovl4' as const] }
    const many: Job[] = Array.from({ length: 300 }, (_, i) => ({ ...job, id: `j${i}`, qty: 50 + (i % 7) * 30, productCode: 'tshirt', due: day(20 + (i % 10)) }))
    const t0 = performance.now()
    const r = simulate(many, friday, { route: 'normal', qty: 500 }, floor)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(r.finishDay.size).toBe(300)
  })
})
