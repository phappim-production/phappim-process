import { describe, expect, it } from 'vitest'
import { byQueue, queueNo, waitingAt, type Job } from './model'

const base: Job = {
  id: 'x', no: 'SC-X', customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 10,
  due: new Date('2026-11-30T18:00:00+07:00'), since: new Date('2026-11-18T09:00:00+07:00'),
  route: 'plain', phase: 'production', station: 'cut', status: 'queued',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}
const job = (id: string, over: Partial<Job>): Job => ({ ...base, id, no: `SC-${id}`, ...over })

// เจ้าของสั่ง 18 พ.ย.: งานเรียงตามคิว อย่ามั่วคิว · งานด่วนให้แทรกคิว
describe('คิวงาน', () => {
  it('เรียงตามลำดับรับเข้า ไม่ใช่กำหนดส่ง', () => {
    const first = job('1', { queue: 1, due: new Date('2026-12-31') })
    const urgentDue = job('2', { queue: 2, due: new Date('2026-11-19') })
    expect([urgentDue, first].sort(byQueue).map(j => j.id)).toEqual(['1', '2'])
  })

  it('งานที่แทรกคิว (เลขคิวทศนิยม) อยู่ระหว่างสองงาน', () => {
    const list = [job('a', { queue: 1 }), job('b', { queue: 2 }), job('rush', { queue: 1.5 })]
    expect(list.sort(byQueue).map(j => j.id)).toEqual(['a', 'rush', 'b'])
  })

  it('คิวของสถานีนับเฉพาะงานที่รอเริ่มที่สถานีเดียวกัน', () => {
    const doing = job('d', { queue: 1, status: 'doing' })
    const hold = job('h', { queue: 2, status: 'hold' })
    const other = job('o', { queue: 3, station: 'sew' })
    const a = job('a', { queue: 4 })
    const b = job('b', { queue: 5 })
    const all = [b, other, a, hold, doing]
    expect(waitingAt(all, 'cut').map(j => j.id)).toEqual(['a', 'b'])
    expect(queueNo(a, all)).toBe(1)
    expect(queueNo(b, all)).toBe(2)
    expect(queueNo(doing, all)).toBeUndefined()
  })

  it('ตัวอย่างกับผลิตจริงที่สถานีเดียวกันอยู่คิวเดียวกัน (ตรงกับฐานข้อมูล)', () => {
    const sample = job('s', { queue: 2, phase: 'sample' })
    const prod = job('p', { queue: 1 })
    expect(waitingAt([sample, prod], 'cut').map(j => j.id)).toEqual(['p', 's'])
  })
})
