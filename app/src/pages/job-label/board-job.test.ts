
import { describe, expect, it } from 'vitest'
import { decideBoardJob } from '../../data/useFactoryData'
import type { Job } from '../../proto/model'

const id = '10000000-0000-4000-8000-00000000000a'
const oldId = '10000000-0000-4000-8000-00000000000b'
const job: Job = {
  id, no: 'TEST-C5-01', customer: 'ลูกค้าทดสอบ', product: 'เสื้อทดสอบ', productCode: 'tshirt', unit: 'ตัว',
  qty: 50, due: new Date('2026-11-30'), route: 'print_emb', phase: 'materials', since: new Date('2026-11-17'),
  sampleRound: 1, materials: { admin: false, production: false, qc: false },
}

describe('board deep link', () => {
  it('uses the existing job without reading it again', () => {
    expect(decideBoardJob(id.toUpperCase(), [job])).toEqual({ status: 'found', job })
  })

  it('reads a valid UUID absent from the board', () => {
    expect(decideBoardJob(oldId.toUpperCase(), [job])).toEqual({ status: 'fetch', id: oldId })
  })

  it.each(['', 'TEST-C5-01', id + 'x'])('treats an invalid ID as missing (%s)', value => {
    expect(decideBoardJob(value, [job])).toEqual({ status: 'missing' })
  })
})
