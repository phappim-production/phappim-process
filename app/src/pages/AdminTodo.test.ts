import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { Job } from '../proto/model'
import { AdminTodo } from './Overview'

const now = new Date('2026-11-23T10:00:00+07:00')
const job: Job = {
  id: 'job-1', no: 'SC690002', customer: 'เจอร์รี่', product: 'กางเกงช้าง', unit: 'ตัว', qty: 2,
  due: new Date('2026-11-21T00:00:00+07:00'), since: now, route: 'normal', phase: 'production', station: 'print', status: 'queued',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}

it('รายการต้องตามบนภาพรวมใช้คำ "ล่าช้า X วัน" ตรงกับบอร์ด', () => {
  const html = renderToStaticMarkup(createElement(AdminTodo, { jobs: [job], now, atRisk: [], onOpen: () => {} }))
  expect(html).toContain('ล่าช้า 2 วัน')
  expect(html).not.toContain('เลยกำหนดส่ง')
})
