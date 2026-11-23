import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { Job } from '../proto/model'
import { DueLabel } from './ui'

const now = new Date('2026-11-23T10:00:00+07:00')
const job: Job = {
  id: 'job-1', no: 'SC690002', customer: 'เจอร์รี่', product: 'กางเกงช้าง', unit: 'ตัว', qty: 2,
  due: new Date('2026-11-21T00:00:00+07:00'), since: now, route: 'normal', phase: 'production', station: 'print', status: 'queued',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}
const label = (j: Job, long?: boolean) => renderToStaticMarkup(createElement(DueLabel, { job: j, now, long }))

it('เลยกำหนดส่ง: การ์ดขึ้น "ล่าช้า X วัน" สีแดง', () => {
  const html = label(job)
  expect(html).toContain('ล่าช้า 2 วัน')
  expect(html).toContain('text-danger')
  expect(html).not.toContain('ส่งเลย')
})

it('แบบยาวในรายละเอียดงานใช้คำเดียวกัน', () => {
  expect(label(job, true)).toContain('(ล่าช้า 2 วัน)')
})

it('ยังไม่ถึงกำหนด / งานเสร็จแล้ว ไม่ขึ้นคำว่าล่าช้า', () => {
  expect(label({ ...job, due: new Date('2026-11-24T00:00:00+07:00') })).toContain('ส่งพรุ่งนี้')
  expect(label({ ...job, phase: 'done' })).not.toContain('ล่าช้า')
})
