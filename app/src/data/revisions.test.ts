import { describe, expect, it } from 'vitest'
import type { Job } from '../proto/model'
import { attachRevisions, needsRevisionAck, revisionShort, revisionWhen, toRevision, type RevisionFlagRow } from './revisions'

const job: Job = {
  id: 'a', no: 'SC-A', customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 10,
  due: new Date('2026-11-30T18:00:00+07:00'), since: new Date('2026-11-18T09:00:00+07:00'),
  route: 'normal', phase: 'production', station: 'cut', status: 'doing',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}
const row: RevisionFlagRow = {
  job_id: 'a', rev: 2, revised_at: '2026-11-25T07:32:00Z', revised_by: 'แอดมิน 1',
  fields: ['ปก', 'จำนวน'], summary: ['จำนวน 10 → 12'], event_id: '91', acked_stations: ['print', 'xx'],
}

describe('ใบยืนยันฉบับแก้', () => {
  it('อ่านสรุปใบแก้จากฐานข้อมูล · สถานีที่ไม่รู้จักตัดทิ้ง', () => {
    expect(toRevision(row)).toEqual({ rev: 2, at: new Date('2026-11-25T07:32:00Z'), by: 'แอดมิน 1', fields: ['ปก', 'จำนวน'], summary: ['จำนวน 10 → 12'], eventId: 91, acked: ['print'] })
    expect(toRevision({ ...row, fields: null, summary: null, acked_stations: null, revised_by: null })).toMatchObject({ fields: [], summary: [], acked: [], by: null })
  })

  it('ผูกใบแก้เข้ากับงาน · งานที่ไม่มีใบแก้แล้วเอาออก', () => {
    const [a, b] = attachRevisions([job, { ...job, id: 'b', revision: toRevision(row) }], [row])
    expect(a.revision?.rev).toBe(2)
    expect('revision' in b).toBe(false)
  })

  it('ต้องรับทราบเมื่อสถานีที่งานอยู่ยังไม่กด · กดแล้วหรืองานไม่อยู่สถานีไม่ต้อง', () => {
    const revised = { ...job, revision: toRevision(row) }
    expect(needsRevisionAck(revised)).toBe(true)
    expect(needsRevisionAck({ ...revised, station: 'print' })).toBe(false)
    expect(needsRevisionAck({ ...revised, phase: 'done' })).toBe(false)
    expect(needsRevisionAck({ ...revised, station: 'outside' })).toBe(false)
    expect(needsRevisionAck(job)).toBe(false)
  })

  it('วันเวลาแก้เป็นเวลาไทย ปี พ.ศ. (ตรงกับข้อความจากฐานข้อมูล)', () => {
    expect(revisionWhen(new Date('2026-11-25T07:32:00Z'))).toBe('25/11/2569 14:32')
    expect(revisionWhen(new Date('2026-12-31T18:05:00Z'))).toBe('1/1/2570 01:05')
    expect(revisionShort(new Date('2026-11-25T07:32:00Z'))).toBe('25/11 14:32')
  })
})
