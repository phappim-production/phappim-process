import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { canApproveMockup, canReturnMockup } from '../auth/access'
import { draftFromConfirmation, isFormDraft } from '../data/confirmation'
import { toJobs, type JobRow } from '../data/live'
import { boardJobsFilter } from '../data/useFactoryData'
import { AdminTodo } from '../pages/Overview'
import { nextAction } from './actions'
import { isFilmNotOrdered, isWaitingFilm, queueHead, type Job } from './model'

const now = new Date('2026-11-24T10:00:00+07:00')
const job: Job = {
  id: 'a', no: 'SC-1', customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 50,
  due: new Date('2026-11-30T18:00:00+07:00'), since: now, route: 'dtf', phase: 'production', station: 'cut', status: 'queued',
  sampleRound: 1, materials: { admin: true, qc: true, production: true }, queue: 1024,
}

describe('ปุ่มเริ่มในรายละเอียดงานใช้กฎคิวเดียวกับหน้าคิว', () => {
  const second: Job = { ...job, id: 'b', no: 'SC-2', queue: 2048 }
  const jobs = [second, job]

  it('คิวแรกเริ่มได้เลย · งานถัดไปต้องรู้ว่าคิวแรกคืองานไหนเพื่อถามเหตุผล', () => {
    expect(queueHead(job, jobs)).toBeUndefined()
    expect(queueHead(second, jobs)?.no).toBe('SC-1')
  })

  it('นับเฉพาะงานรอเริ่มที่สถานีเดียวกัน · งานตัวอย่างอยู่คิวเดียวกับงานผลิต', () => {
    expect(queueHead(second, [second, { ...job, station: 'sew' }])).toBeUndefined()
    expect(queueHead(second, [second, { ...job, status: 'doing' }])).toBeUndefined()
    expect(queueHead(second, [second, { ...job, phase: 'sample' }])?.no).toBe('SC-1')
    expect(queueHead({ ...second, status: 'doing' }, jobs)).toBeUndefined()
  })
})

describe('เส้นทางฟิล์มที่ยังไม่ได้สั่งฟิล์ม', () => {
  it('ยังไม่สั่ง = งานที่ยังไม่ผ่านสถานีรีดฟิล์มและไม่มีข้อมูลฟิล์ม', () => {
    expect(isFilmNotOrdered(job)).toBe(true)
    expect(isFilmNotOrdered({ ...job, station: 'dtf_press' })).toBe(true)
    expect(isFilmNotOrdered({ ...job, phase: 'sample', station: 'cut' })).toBe(true)
    expect(isFilmNotOrdered({ ...job, route: 'screen' })).toBe(true)
    expect(isFilmNotOrdered({ ...job, film: { eta: now, received: false } })).toBe(false)
    expect(isFilmNotOrdered({ ...job, station: 'sew' })).toBe(false)
    expect(isFilmNotOrdered({ ...job, phase: 'done', station: undefined })).toBe(false)
    expect(isFilmNotOrdered({ ...job, route: 'normal', station: 'print' })).toBe(false)
    expect(isFilmNotOrdered({ ...job, develop: true, phase: 'sample_review', station: undefined })).toBe(false)
    expect(isWaitingFilm(job)).toBe(false)
  })

  it('ต้องทำตอนนี้ที่สถานีรีดฟิล์มบอกว่ายังไม่ได้สั่ง ไม่ใช่ให้เริ่มรีด', () => {
    const waiting = nextAction({ ...job, station: 'dtf_press' }, now)
    expect(waiting?.text).toBe('ยังไม่ได้สั่งฟิล์ม DTF · แจ้งแอดมินสั่งก่อน ยังเริ่มรีดไม่ได้')
    expect(waiting?.tone).toBe('warn')
    expect(nextAction({ ...job, station: 'dtf_press', film: { eta: now, received: false } }, now)?.text).toBe('รอฟิล์ม DTFก่อนเริ่มรีด')
    expect(nextAction({ ...job, station: 'dtf_press', film: { eta: now, received: true } }, now)?.text).toBe('เริ่มรีดฟิล์ม')
    expect(nextAction(job, now)?.text).toBe('เริ่มตัดงาน')
  })

  it('งานที่ต้องตามของแอดมินมีรายการ "ยังไม่ได้สั่งฟิล์ม" · งานที่สั่งแล้วยังขึ้น "รอฟิล์ม"', () => {
    const html = (j: Job) => renderToStaticMarkup(createElement(AdminTodo, { jobs: [j], now, atRisk: [], onOpen: () => {} }))
    expect(html(job)).toContain('ยังไม่ได้สั่งฟิล์ม')
    expect(html({ ...job, station: 'dtf_press' })).toContain('งานรอที่สถานีรีดฟิล์มแล้ว')
    expect(html({ ...job, film: { eta: new Date('2026-11-26T18:00:00+07:00'), received: false } })).toContain('รอฟิล์ม')
    expect(html({ ...job, film: { eta: now, received: true } })).toContain('ไม่มีงานที่ต้องตาม')
    expect(html({ ...job, route: 'normal', station: 'print' })).toContain('ไม่มีงานที่ต้องตาม')
  })

  it('ได้รับฟิล์มแล้วแม้ไม่มีวันคาดว่าได้รับ = ไม่นับว่ายังไม่ได้สั่ง', () => {
    const row: JobRow = {
      id: 'a', confirmation_no: 'SC-1', customer_name: 'ลูกค้า', job_name: null, product_type_code: 'tshirt', qty: 50, unit: 'ตัว',
      due_date: '2026-11-30', route_code: 'dtf', phase: 'production', current_station: 'dtf_press', station_status: 'queued',
      stage_entered_at: '2026-11-24T03:00:00Z', sample_round: 1, materials_waiting_depts: null, dtf_film_eta: null,
      dtf_film_received_at: '2026-11-23T04:00:00Z', sew_count: 0, is_rework: false, rework_qty: null, hold_reason: null, finished_at: null,
    }
    const [received] = toJobs([row], [], [], [])
    expect(received.film?.received).toBe(true)
    expect(isFilmNotOrdered(received)).toBe(false)
    const [none] = toJobs([{ ...row, dtf_film_received_at: null }], [], [], [])
    expect(none.film).toBeUndefined()
    expect(isFilmNotOrdered(none)).toBe(true)
  })
})

it('บอร์ดโหลดงานเสร็จที่ยังไม่จัดส่งเสมอ · งานเสร็จที่ส่งแล้วเก็บ 14 วัน', () => {
  expect(boardJobsFilter(new Date('2026-11-24T03:00:00Z'))).toBe('phase.neq.done,finished_at.gte.2026-11-10T03:00:00.000Z,delivered_at.is.null')
})

describe('หน้ารับงาน: ใบที่มาจากฟอร์มล็อกจำนวนและสินค้า', () => {
  it('ใบจากฟอร์ม (มี h · p · product) ล็อก · กรอกเองไม่ล็อก', () => {
    const fromForm = draftFromConfirmation({ h: { doc_no: 'SC-1' }, p: { tshirt: { qty: 10 } }, product: 'tshirt' })
    expect(fromForm && isFormDraft(fromForm)).toBe(true)
    expect(isFormDraft({ spec: {} })).toBe(false)
    expect(isFormDraft({ spec: { h: {}, p: {} } })).toBe(false)
  })
})

it('ส่งม็อคอัพกลับให้แก้: ผู้บริหารและฝ่ายผลิตเท่านั้น (แอดมินอนุมัติได้แต่ส่งกลับไม่ได้)', () => {
  expect(canApproveMockup('admin')).toBe(true)
  expect(canReturnMockup('admin')).toBe(false)
  expect((['owner', 'manager', 'production'] as const).every(canReturnMockup)).toBe(true)
  expect((['qc', 'staff', 'supervisor'] as const).some(canReturnMockup)).toBe(false)
})
