import { expect, it } from 'vitest'
import { changedJob, jobKey, jobVersion, touchJob } from './jobKey'
import type { Job } from '../proto/model'

const date = new Date('2026-11-24T10:00:00+07:00')
const job: Job = {
  id: 'j1', no: 'SC-1', customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 80, due: date, since: date,
  route: 'dtf', phase: 'production', station: 'cut', status: 'queued', sampleRound: 1,
  materials: { admin: true, qc: true, production: true },
}

it('งานเดิมที่โหลดมาใหม่โดยไม่มีอะไรเปลี่ยนได้ key เดิม', () => {
  expect(jobKey({ ...job, since: new Date(date.getTime()), mockupUrl: 'https://x/ลิงก์ใหม่' })).toBe(jobKey(job))
})

it('ทุกอย่างที่รายละเอียดงานแสดงเปลี่ยน = key เปลี่ยน', () => {
  const base = jobKey(job)
  const changes: Partial<Job>[] = [
    { status: 'doing' }, { station: 'sew' }, { phase: 'done' }, { since: new Date(date.getTime() + 1) }, { qty: 81 },
    { film: { eta: date, received: false } }, { holdReason: 'ผ้าไม่พอ' }, { rework: { qty: 2, reason: 'ตะเข็บ' } },
    { delivered: { at: date, note: '' } }, { sla: 'warn' }, { queue: 2048 }, { mockup: 'a/b.jpg' },
    { specSheet: { id: 's1', rev: 1, acked: [] } }, { sewingReports: [{ reason: 'เข็มหัก', at: date, paused: false }] },
  ]
  for (const c of changes) expect(jobKey({ ...job, ...c }), JSON.stringify(c)).not.toBe(base)
  expect(jobKey({ ...job, film: { eta: date, received: true } })).not.toBe(jobKey({ ...job, film: { eta: date, received: false } }))
  expect(jobKey({ ...job, specSheet: { id: 's1', rev: 1, acked: ['cut'] } })).not.toBe(jobKey({ ...job, specSheet: { id: 's1', rev: 1, acked: [] } }))
})

it('Realtime: หางานที่เปลี่ยนจากแถว · บอกไม่ได้ = ทุกงาน · จักรเย็บไม่เกี่ยวกับรายละเอียดงาน', () => {
  expect(changedJob('jobs', { new: { id: 'j1' }, old: {} })).toBe('j1')
  expect(changedJob('events', { new: { id: 9, job_id: 'j2' }, old: {} })).toBe('j2')
  expect(changedJob('issues', { new: {}, old: { id: 4 } })).toBe('all')
  expect(changedJob('machine_assignments', { new: {}, old: { id: 4, job_id: 'j3' } })).toBe('j3')
  expect(changedJob('sewing_machines', { new: { id: 1 }, old: {} })).toBeNull()
})

it('งานที่ถูกแตะเท่านั้นได้รุ่นใหม่ · แตะทุกงาน = ทุกงานได้รุ่นใหม่', () => {
  const a = jobVersion('a')
  const b = jobVersion('b')
  touchJob('a')
  expect(jobVersion('a')).not.toBe(a)
  expect(jobVersion('b')).toBe(b)
  touchJob(null)
  expect(jobVersion('b')).toBe(b)
  const a2 = jobVersion('a')
  touchJob('all')
  expect(jobVersion('a')).not.toBe(a2)
  expect(jobVersion('b')).not.toBe(b)
})
