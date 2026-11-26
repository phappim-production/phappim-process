import { expect, it } from 'vitest'
import { deliverySchedule, deliveryState } from './deliveries'
import type { Job } from './model'

const now = new Date('2026-11-26T09:00:00+07:00')
const day = (d: string) => new Date(`${d}T00:00:00+07:00`)
const base: Job = {
  id: 'j', no: 'SC-1', customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 50, due: day('2026-11-26'), since: day('2026-11-20'),
  route: 'plain', phase: 'production', station: 'cut', status: 'queued', sampleRound: 1, materials: { admin: true, qc: true, production: true },
}
const job = (id: string, patch: Partial<Job>): Job => ({ ...base, id, no: id, ...patch })

it('สถานะส่งของ: เสร็จแล้ว = พร้อมส่ง · เลยกำหนด = แดง · คาดว่าเสร็จหลังวันส่ง = เสี่ยงไม่ทัน', () => {
  expect(deliveryState(job('a', { phase: 'done', station: undefined, status: undefined }), now)).toBe('ready')
  expect(deliveryState(job('b', { due: day('2026-11-25') }), now)).toBe('late')
  expect(deliveryState(job('c', { due: day('2026-11-28') }), now, day('2026-11-30'))).toBe('risk')
  expect(deliveryState(job('d', { due: day('2026-11-28') }), now, day('2026-11-28'))).toBe('waiting')
  expect(deliveryState(job('e', { due: day('2026-11-28'), status: 'hold' }), now)).toBe('hold')
  expect(deliveryState(job('f', { due: day('2026-11-28'), phase: 'sample_review', station: undefined, status: undefined }), now)).toBe('sample')
  expect(deliveryState(job('g', { due: day('2026-11-28'), status: 'out' }), now)).toBe('out')
  expect(deliveryState(job('h', { due: day('2026-11-28'), status: 'doing' }), now)).toBe('doing')
  expect(deliveryState(job('i', { phase: 'done', delivered: { at: now, note: '' } }), now)).toBe('delivered')
})

it('ตารางส่งของ: เลยกำหนด → วันนี้ → พรุ่งนี้ → รายวัน → หลังจากนั้น · ส่งแล้วไม่อยู่ในตาราง', () => {
  const jobs = [
    job('LATE', { due: day('2026-11-24') }),
    job('LATER', { due: day('2026-12-31') }),
    job('TODAY-READY', { phase: 'done', station: undefined, status: undefined }),
    job('TODAY-WAIT', {}),
    job('TOMORROW', { due: day('2026-11-27') }),
    job('MON', { due: day('2026-11-30') }),
    job('SENT', { phase: 'done', delivered: { at: day('2026-11-20'), note: '' } }),
  ]
  const r = deliverySchedule(jobs, now, () => undefined)
  expect(r.days.map(d => d.kind)).toEqual(['overdue', 'today', 'tomorrow', 'day', 'later'])
  expect(r.days.map(d => d.items.map(i => i.job.no))).toEqual([['LATE'], ['TODAY-WAIT', 'TODAY-READY'], ['TOMORROW'], ['MON'], ['LATER']])
  expect(r.summary).toEqual({ overdue: 1, today: 2, todayReady: 1, tomorrow: 1, week: 4, risk: 0 })
  expect(r.deliveredToday).toEqual([])
})

it('ตารางส่งของ: งานที่บันทึกส่งวันนี้แยกไว้ให้ดูว่าออกไปแล้ว', () => {
  const r = deliverySchedule([job('SENT', { phase: 'done', delivered: { at: new Date('2026-11-26T08:00:00+07:00'), note: 'รถบริษัท' } })], now, () => undefined)
  expect(r.days).toEqual([])
  expect(r.deliveredToday.map(i => i.job.no)).toEqual(['SENT'])
})

it('ตารางส่งของ: วันเดียวกันเรียงเรื่องที่ต้องตามก่อน (เสี่ยงไม่ทัน → ติดปัญหา → รอคิว → กำลังทำ → พร้อมส่ง)', () => {
  const due = day('2026-11-28')
  const jobs = [
    job('READY', { due, phase: 'done', station: undefined, status: undefined }),
    job('DOING', { due, status: 'doing' }),
    job('HOLD', { due, status: 'hold' }),
    job('RISK', { due }),
    job('WAIT', { due }),
  ]
  const r = deliverySchedule(jobs, now, j => (j.no === 'RISK' ? day('2026-12-02') : undefined))
  expect(r.days[0].items.map(i => i.job.no)).toEqual(['RISK', 'HOLD', 'WAIT', 'DOING', 'READY'])
  expect(r.days[0].items[0].finish).toEqual(day('2026-12-02'))
  expect(r.summary.risk).toBe(1)
})

it('ตารางส่งของ: นับวันตามเวลาไทย · หลังเที่ยงคืนไทยงานของเมื่อวานเป็นเลยกำหนดทันที', () => {
  const r = deliverySchedule([job('X', { due: day('2026-11-26') })], new Date('2026-11-27T00:05:00+07:00'), () => undefined)
  expect(r.days[0].kind).toBe('overdue')
})

it('ตารางส่งของ: เกิน 14 วันรวมไว้ในหลังจากนั้น เรียงตามวันส่ง', () => {
  const r = deliverySchedule([job('B', { due: day('2027-01-20') }), job('A', { due: day('2027-01-05') }), job('D14', { due: day('2026-12-10') })], now, () => undefined)
  expect(r.days.map(d => d.kind)).toEqual(['day', 'later'])
  expect(r.days[1].items.map(i => i.job.no)).toEqual(['A', 'B'])
})
