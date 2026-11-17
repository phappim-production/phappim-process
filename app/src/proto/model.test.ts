import { expect, it } from 'vitest'
import { COLUMNS, columnOf, groupColumns, savedStation, isDoneToday, isDueSoon, isFilmLate, isOverdue, isWaitingFilm, missingDepts } from './model'
import type { ColumnKey, Job, Phase } from './model'

const today = new Date('2026-11-17T00:00:00+07:00')
const yesterday = new Date('2026-11-16T00:00:00+07:00')
const due = new Date('2026-11-17T17:00:00+07:00')
const job: Job = {
  id: 'j1', no: 'SC-1', customer: 'ลูกค้าทดสอบ', product: 'เสื้อยืด',
  unit: 'ตัว', qty: 80, due, since: yesterday,
  route: 'plain', phase: 'production', station: 'cut',
  sampleRound: 1, materials: { admin: true, qc: false, production: false },
}

it('งานครบกำหนดวันนี้ยังไม่เลยกำหนด แม้ผ่าน 17:00', () => {
  expect(isOverdue(job, new Date('2026-11-17T23:59:00+07:00'))).toBe(false)
})

it('งานครบกำหนดเมื่อวานเลยกำหนดทันทีที่ข้ามเที่ยงคืน', () => {
  expect(isOverdue({ ...job, due: yesterday }, today)).toBe(true)
})

// วันที่ในระบบอิงวันไทยเสมอ (thaiDay) · ทดสอบรันด้วย TZ=UTC เพื่อจับกรณีเครื่องตั้งเขตเวลาผิด
it('งานเลยกำหนดทันทีหลังเที่ยงคืนไทยแม้เครื่องใช้ UTC', () => {
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
  // DTG / สกรีน สั่งฟิล์มเข้ามารีดเหมือน DTF · ปักส่งร้านนอกไม่ใช่ฟิล์ม
  expect(isWaitingFilm({ ...dtf, route: 'dtg' })).toBe(true)
  expect(isWaitingFilm({ ...dtf, route: 'screen' })).toBe(true)
  expect(isWaitingFilm({ ...dtf, route: 'emb' })).toBe(false)
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
  ['materials', 'sample'],   // ไม่มีขั้นรอวัตถุดิบแล้ว · งานเก่าแสดงที่จุดถัดไป
  ['sample', 'sample'],
  ['sample_review', 'sample_review'],
  ['production', 'cut'],
  ['done', 'done'],
]

it.each(columns)('งานสถานะ %s อยู่คอลัมน์ %s', (phase, column) => {
  expect(columnOf({ ...job, phase })).toBe(column)
})

it('งานเก่าค้างรอวัตถุดิบแบบไม่ขึ้นตัวอย่าง แสดงที่สถานีแรกของเส้นทาง', () => {
  expect(columnOf({ ...job, phase: 'materials', route: 'normal', needsSample: false })).toBe('print')
})

it('บอร์ดวางงานผลิตที่ขาดสถานีไว้คอลัมน์แรกของเส้นทาง', () => {
  expect(columnOf({ ...job, route: 'normal', station: undefined })).toBe('print')
})

it('แบ่งสถานีเป็น ก่อนผลิต / เฟส 1 / เฟส 2 ตามลำดับ · ตัดกลุ่มที่บทบาทนี้ไม่เห็นทิ้ง', () => {
  expect(groupColumns(COLUMNS).map(g => [g.name, g.columns.map(c => c.key)])).toEqual([
    ['ก่อนผลิต', ['sample', 'sample_review']],
    ['เฟส 1', ['print', 'press', 'cut', 'dtf_press', 'emb']],
    ['เฟส 2', ['sew', 'qc_pack', 'done']],
  ])
  const qcOnly = COLUMNS.filter(c => c.key === 'qc_pack' || c.key === 'done')
  expect(groupColumns(qcOnly).map(g => g.name)).toEqual(['เฟส 2'])
})

it('จำสถานีที่เครื่องนี้เลือกไว้ ใช้ได้เฉพาะสถานีที่ยังเห็นอยู่', () => {
  expect(savedStation('cut', COLUMNS)).toBe('cut')
  expect(savedStation(null, COLUMNS)).toBe('all')
  expect(savedStation('nope', COLUMNS)).toBe('all')
  expect(savedStation('cut', COLUMNS.filter(c => c.key === 'sew'))).toBe('all')
})
