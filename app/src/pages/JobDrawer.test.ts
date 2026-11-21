import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { Job } from '../proto/model'
import { JobDrawer } from './Dashboard'

const now = new Date('2026-11-21T10:00:00+07:00')
const job: Job = {
  id: 'job-1', no: 'SC681826', customer: 'คุณแคท', product: 'เสื้อโปโล', unit: 'ตัว', qty: 20,
  due: new Date('2026-11-28T00:00:00+07:00'), since: now, route: 'normal', phase: 'production', station: 'print', status: 'queued',
  sampleRound: 1, materials: { admin: true, qc: true, production: true }, mockupUrl: 'https://files.example/mockup.png',
}
const drawer = (j: Job) => renderToStaticMarkup(createElement(JobDrawer, { job: j, now, onClose: () => {} }))

it('มีม็อคอัพกำกับสเปกฉบับอนุมัติ: แสดงรูปม็อคอัพปกติ กดแล้วไปหน้าม็อคอัพกำกับสเปก', () => {
  const html = drawer({ ...job, specSheet: { id: 'sheet-1', rev: 2, acked: [] } })
  expect(html).toContain('href="#/mockup?id=job-1" class="w-full max-w-72" aria-label="เปิดม็อคอัพกำกับสเปก"')
  expect(html).toContain('กดที่รูปเพื่อดูม็อคอัพกำกับสเปก ฉบับ 2')
  expect(html).not.toContain('href="https://files.example/mockup.png"')
})

it('ยังไม่มีฉบับอนุมัติ: กดที่รูปเปิดรูปม็อคอัพเต็มจอเหมือนเดิม', () => {
  const html = drawer(job)
  expect(html).toContain('href="https://files.example/mockup.png"')
  expect(html).toContain('กดที่รูปเพื่อดูเต็มจอ')
})
