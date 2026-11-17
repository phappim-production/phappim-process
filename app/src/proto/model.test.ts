import { expect, it } from 'vitest'
import { columnOf, isDoneToday, isDueSoon, isFilmLate, isOverdue, isWaitingFilm, missingDepts } from './model'
import type { ColumnKey, Job, Phase } from './model'

const today = new Date(2026, 10, 17)
const yesterday = new Date(2026, 10, 16)
const due = new Date(2026, 10, 17, 17)
const job: Job = {
  id: 'j1', no: 'SC-1', customer: 'ลูกค้าทดสอบ', product: 'เสื้อยืด',
  unit: 'ตัว', qty: 80, due, since: yesterday,
  route: 'plain', phase: 'production', station: 'cut',
  sampleRound: 1, materials: { admin: true, qc: false, production: false },
}

it('งานครบกำหนดวันนี้ยังไม่เลยกำหนด แม้ผ่าน 17:00', () => {
  expect(isOverdue(job, new Date(2026, 10, 17, 23, 59))).toBe(false)
})

it('งานครบกำหนดเมื่อวานเลยกำหนดทันทีที่ข้ามเที่ยงคืน', () => {
  expect(isOverdue({ ...job, due: yesterday }, today)).toBe(true)
})

// วันที่ในระบบต้องอิงไทย แต่ startOfDay ใช้เขตเวลาของเครื่อง
it.fails('งานเลยกำหนดทันทีหลังเที่ยงคืนไทยแม้เครื่องใช้ UTC', () => {
  const thaiDue = new Date('2026-11-17T17:00:00+07:00')
  const afterMidnight = new Date('2026-11-18T00:01:00+07:00')

  expect(isOverdue({ ...job, due: thaiDue }, afterMidnight)).toBe(true)
})

it('งานเสร็จแล้วไม่ถูกนับว่าเลยกำหนดหรือใกล้ส่ง', () => {
  expect(isOverdue({ ...job, phase: 'done', due: yesterday }, today)).toBe(false)
  expect(isDueSoon({ ...job, phase: 'done' }, today)).toBe(false)
})

it.each([
  [16, false],
  [17, true],
  [19, true],
  [20, false],
])('กำหนดส่งวันที่ %s อยู่ในช่วงใกล้ส่งหรือไม่: %s', (date, expected) => {
  expect(isDueSoon({ ...job, due: new Date(2026, 10, date) }, today)).toBe(expected)
})

it('ฟิล์มที่ยังไม่ได้รับรอฟิล์ม และช้าเมื่อเลยวัน ETA', () => {
  const dtf: Job = { ...job, route: 'dtf', film: { eta: yesterday, received: false } }

  expect(isWaitingFilm(dtf)).toBe(true)
  expect(isFilmLate(dtf, today)).toBe(true)
  expect(isFilmLate(dtf, yesterday)).toBe(false)
  expect(isWaitingFilm({ ...dtf, film: { eta: yesterday, received: true } })).toBe(false)
  expect(isWaitingFilm({ ...dtf, phase: 'done' })).toBe(false)
  expect(isWaitingFilm({ ...dtf, route: 'plain' })).toBe(false)
  expect(isWaitingFilm({ ...dtf, film: undefined })).toBe(false)
})

it('นับเสร็จวันนี้จากเวลาเสร็จของงานสถานะเสร็จเท่านั้น', () => {
  expect(isDoneToday({ ...job, phase: 'done', doneAt: due }, today)).toBe(true)
  expect(isDoneToday({ ...job, phase: 'done', doneAt: yesterday }, today)).toBe(false)
  expect(isDoneToday({ ...job, phase: 'done' }, today)).toBe(false)
  expect(isDoneToday({ ...job, doneAt: due }, today)).toBe(false)
})

it('ระบุเฉพาะฝ่ายที่ยังไม่ยืนยันวัตถุดิบ', () => {
  expect(missingDepts(job)).toEqual(['qc', 'production'])
})

const columns: [Phase, ColumnKey][] = [
  ['materials', 'materials'],
  ['sample', 'sample'],
  ['sample_review', 'sample_review'],
  ['production', 'cut'],
  ['done', 'done'],
]

it.each(columns)('งานสถานะ %s อยู่คอลัมน์ %s', (phase, column) => {
  expect(columnOf({ ...job, phase })).toBe(column)
})

it('บอร์ดวางงานผลิตที่ขาดสถานีไว้คอลัมน์แรกของเส้นทาง', () => {
  expect(columnOf({ ...job, route: 'normal', station: undefined })).toBe('print')
})
