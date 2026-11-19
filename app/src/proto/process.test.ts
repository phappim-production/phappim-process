import { expect, it } from 'vitest'
import type { Job } from './model'
import { processSteps } from './process'

const job = (over: Partial<Job>): Job => ({
  id: 'j', no: 'SC-1', customer: 'ลูกค้า', product: 'เสื้อ', unit: 'ตัว', qty: 10, due: new Date(2026, 11, 1),
  route: 'normal', phase: 'production', station: 'cut', status: 'doing', since: new Date(2026, 10, 19), sampleRound: 1,
  materials: { admin: true, qc: true, production: true }, ...over,
})
const view = (j: Job) => processSteps(j).map(s => `${s.label}:${s.state}${s.note ? `(${s.note})` : ''}`)

it('ผ่านแล้วเขียว · อยู่ตรงนี้พร้อมสถานะ · ยังไม่ถึงเทา ตามเส้นทางของงาน', () => {
  expect(view(job({}))).toEqual(['พิมพ์:done', 'รีด:done', 'ตัด:now(กำลังทำ)', 'เย็บ:todo', 'QC:todo'])
  expect(view(job({ route: 'dtf', station: 'dtf_press', status: 'queued' }))).toEqual(['ตัด:done', 'รีดฟิล์ม:now(รอคิว)', 'เย็บ:todo', 'QC:todo'])
})

it('ติดปัญหา = แดงที่ขั้นนั้น · ส่งออกข้างนอกบอกว่าอยู่ข้างนอก', () => {
  expect(processSteps(job({ status: 'hold' }))[2]).toMatchObject({ state: 'hold', note: 'ติดปัญหา' })
  expect(processSteps(job({ status: 'out' }))[2]).toMatchObject({ state: 'now', note: 'ข้างนอก' })
})

it('ก่อนเข้าสถานี: รอวัตถุดิบ / รอลูกค้ายืนยัน เป็นขั้นแรก · ตัวอย่างบอกว่าเป็นตัวอย่าง · เสร็จแล้วเขียวทั้งแถบ', () => {
  expect(view(job({ phase: 'materials', station: undefined, status: undefined }))[0]).toBe('รอวัตถุดิบ:now')
  expect(view(job({ phase: 'sample_review', station: undefined, status: undefined }))).toEqual(
    ['รอลูกค้ายืนยันตัวอย่าง:now', 'พิมพ์:todo', 'รีด:todo', 'ตัด:todo', 'เย็บ:todo', 'QC:todo'])
  expect(view(job({ phase: 'sample', station: 'print', status: 'doing' }))[0]).toBe('พิมพ์:now(ตัวอย่าง · กำลังทำ)')
  expect(processSteps(job({ phase: 'done', station: undefined, status: undefined })).every(s => s.state === 'done')).toBe(true)
})
