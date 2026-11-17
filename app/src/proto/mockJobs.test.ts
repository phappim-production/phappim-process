import { expect, it } from 'vitest'
import { makeMockJobs } from './mockJobs'
import { ROUTES } from './model'

const jobs = makeMockJobs(new Date(2026, 10, 17, 9))

it('ข้อมูลจำลองมีงานและเลขที่ใบยืนยันกับรหัสไม่ซ้ำ', () => {
  expect(jobs.length).toBeGreaterThan(0)
  expect(new Set(jobs.map(job => job.no)).size).toBe(jobs.length)
  expect(new Set(jobs.map(job => job.id)).size).toBe(jobs.length)
})

it('งานทุกใบมีจำนวนมากกว่าศูนย์', () => {
  for (const job of jobs) expect(job.qty, job.no).toBeGreaterThan(0)
})

it('งานผลิตทุกใบมีสถานีอยู่ในเส้นทางของตัวเอง', () => {
  const production = jobs.filter(job => job.phase === 'production')

  expect(production.length).toBeGreaterThan(0)
  for (const job of production) expect(ROUTES[job.route].stations, job.no).toContain(job.station)
})

it('งาน DTF ทุกใบมีวันที่คาดว่าจะได้รับและสถานะฟิล์ม', () => {
  const dtf = jobs.filter(job => job.route === 'dtf')

  expect(dtf.length).toBeGreaterThan(0)
  for (const job of dtf) {
    expect(job.film, job.no).toEqual({ eta: expect.any(Date), received: expect.any(Boolean) })
    expect(Number.isFinite(job.film?.eta.getTime()), job.no).toBe(true)
  }
})
