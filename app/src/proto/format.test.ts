import { expect, it } from 'vitest'
import { dayDiff, duration, relDay, stageSteps, stageText } from './format'
import type { Job, Phase, RouteCode } from './model'

const date = new Date('2026-11-17T00:00:00+07:00')
const job: Job = {
  id: 'j1', no: 'SC-1', customer: 'ลูกค้าทดสอบ', product: 'เสื้อยืด',
  unit: 'ตัว', qty: 80, due: date, since: date,
  route: 'normal', phase: 'production', station: 'sew',
  sampleRound: 2, materials: { admin: true, qc: false, production: false },
}

it.each([
  [59, '59 นาที'],
  [60, '1 ชม.'],
  [120, '2 ชม.'],
  [125, '2 ชม. 5 นาที'],
  [1440, '1 วัน'],
  [1500, '1 วัน 1 ชม.'],
  [-1, '0 นาที'],
])('แสดง %s นาที เป็น %s', (minutes, expected) => {
  expect(duration(minutes * 60_000)).toBe(expected)
})

it('นับวันปฏิทินเมื่อเวลาห่างกันเพียงนาทีเดียวแต่ข้ามเที่ยงคืน', () => {
  expect(dayDiff(date, new Date('2026-11-16T23:59:00+07:00'))).toBe(1)
  expect(relDay(date, date)).toBe('วันนี้')
  expect(relDay(new Date('2026-11-16T00:00:00+07:00'), date)).toBe('เมื่อวาน')
  expect(relDay(new Date('2026-11-20T00:00:00+07:00'), date)).toBe('20 พ.ย.')
})

const routes: [RouteCode, string[]][] = [
  ['normal', ['พิมพ์งาน', 'รีดงาน', 'ตัดงาน', 'เย็บงาน', 'QC + Packing']],
  ['dtf', ['ตัดงาน', 'รีดฟิล์ม', 'เย็บงาน', 'QC + Packing']],
  ['dtg', ['ตัดงาน', 'รีดฟิล์ม', 'เย็บงาน', 'QC + Packing']],
  ['screen', ['ตัดงาน', 'รีดฟิล์ม', 'เย็บงาน', 'QC + Packing']],
  ['emb', ['ตัดงาน', 'ส่งปัก', 'เย็บงาน', 'QC + Packing']],
  ['print_emb', ['พิมพ์งาน', 'รีดงาน', 'ตัดงาน', 'ส่งปัก', 'เย็บงาน', 'QC + Packing']],
  ['cut_only', ['ตัดงาน', 'QC + Packing']],
  ['plain', ['ตัดงาน', 'เย็บงาน', 'QC + Packing']],
]

it.each(routes)('เส้นทาง %s แสดงขั้นก่อนผลิตและสถานีตามลำดับ', (route, stations) => {
  expect(stageSteps({ ...job, route }).steps).toEqual(['วัตถุดิบ', 'ขึ้นตัวอย่าง', 'ลูกค้ายืนยัน', ...stations])
})

it('งานไม่ขึ้นตัวอย่าง: ไม่มีขั้นตัวอย่าง · ผลิตจริงสถานีแรกต่อจากวัตถุดิบทันที', () => {
  const noSample = { ...job, route: 'cut_only' as const, needsSample: false }
  expect(stageSteps(noSample).steps).toEqual(['วัตถุดิบ', 'ตัดงาน', 'QC + Packing'])
  expect(stageSteps({ ...noSample, phase: 'production' as const, station: 'qc_pack' as const }).current).toBe(2)
})

const phases: [Phase, number, string][] = [
  ['materials', 0, 'รอวัตถุดิบ (รอ QC, ฝ่ายผลิต)'],
  ['sample', 1, 'ขึ้นตัวอย่าง รอบ 2 · เย็บงาน'],
  ['sample_review', 2, 'รอลูกค้ายืนยันตัวอย่าง'],
  ['production', 6, 'เย็บงาน · รอคิว'],
  ['done', 8, 'เสร็จ / พร้อมส่ง'],
]

it.each(phases)('สถานะ %s ไฮไลต์ตำแหน่ง %s และแสดงข้อความตามขั้น', (phase, current, label) => {
  expect(stageSteps({ ...job, phase }).current).toBe(current)
  expect(stageText({ ...job, phase })).toBe(label)
})

it('ขึ้นตัวอย่างรอบแรกที่ยังไม่มีสถานีแสดงเพียงชื่อขั้น', () => {
  expect(stageText({ ...job, phase: 'sample', sampleRound: 1, station: undefined })).toBe('ขึ้นตัวอย่าง')
})

it('งานผลิตที่ยังไม่มีสถานีไฮไลต์สถานีแรกและใช้ข้อความกลาง', () => {
  const withoutStation = { ...job, station: undefined }

  expect(stageSteps(withoutStation).current).toBe(3)
  expect(stageText(withoutStation)).toBe('กำลังผลิต')
})

it('แสดงสถานะพักงานคู่กับชื่อสถานี', () => {
  expect(stageText({ ...job, status: 'hold' })).toBe('เย็บงาน · ติดปัญหา')
})
