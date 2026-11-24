import { attachHolds } from '../data/live'
import { describe, expect, it } from 'vitest'
import type { Job } from './model'
import { myStationsOf, problemLists, queueBoard, reportable } from './rolePages'

const base = new Date(2026, 10, 19, 9)
let n = 0
const job = (over: Partial<Job>): Job => ({
  id: `j${++n}`, no: `SC-${n}`, customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 10,
  due: new Date(2026, 11, 1), route: 'normal', phase: 'production', station: 'print', status: 'queued',
  since: new Date(base.getTime() + n * 60_000), sampleRound: 1,
  materials: { admin: true, qc: true, production: true }, queue: n, ...over,
})

it('ปัญหา/งานแก้: แยกงานพัก · งานแก้ · เกินเวลามาตรฐาน และกรองตามสถานีที่ดูแล', () => {
  const held = job({ status: 'hold', holdReason: 'หมึกหมด' })
  const rework = job({ station: 'cut', rework: { qty: 2, reason: 'ตัดเบี้ยว' } })
  const over = job({ station: 'cut', status: 'doing', sla: 'over' })
  const fine = job({ station: 'cut' })
  const done = job({ phase: 'done', status: undefined, station: undefined, rework: { qty: 1, reason: 'x' } })
  const all = problemLists([held, rework, over, fine, done], null)
  expect(all.held.map(j => j.id)).toEqual([held.id])
  expect(all.rework.map(j => j.id)).toEqual([rework.id])
  expect(all.overSla.map(j => j.id)).toEqual([over.id])
  const cutOnly = problemLists([held, rework, over], ['cut'])
  expect(cutOnly.held).toEqual([])
  expect(cutOnly.rework).toHaveLength(1)
})

it('แจ้งปัญหา: เฉพาะงานกำลังทำ/รอคิวที่สถานีของฉัน · กำลังทำขึ้นก่อน · ไม่รวมเย็บ งานพัก งานข้างนอก', () => {
  const waiting = job({ station: 'print' })
  const doing = job({ station: 'print', status: 'doing' })
  const other = job({ station: 'cut' })
  const held = job({ station: 'print', status: 'hold' })
  const out = job({ station: 'print', status: 'out' })
  const sew = job({ station: 'sew', status: 'doing' })
  expect(reportable([waiting, doing, other, held, out, sew], ['print', 'sew']).map(j => j.id)).toEqual([doing.id, waiting.id])
})

it('คิวการผลิต: ทุกสถานีเรียงตามคิว แยกกำลังทำ / รอคิว / พัก / ข้างนอก', () => {
  const a = job({ station: 'press', queue: 5 })
  const b = job({ station: 'press', queue: 2 })
  const c = job({ station: 'press', status: 'doing' })
  const rows = queueBoard([a, b, c])
  const press = rows.find(r => r.station === 'press')!
  expect(press.waiting.map(j => j.id)).toEqual([b.id, a.id])
  expect(press.doing.map(j => j.id)).toEqual([c.id])
  expect(rows).toHaveLength(8)
})

it('สถานีของฉัน: QC = QC + Packing · พนักงาน = ที่จับคู่', () => {
  expect(myStationsOf('qc', [])).toEqual(['qc_pack'])
  expect(myStationsOf('staff', ['cut'])).toEqual(['cut'])
  expect(myStationsOf('staff', undefined)).toEqual([])
})

describe('งานพัก: เรียงและนับเวลาจากตอนที่พัก ไม่ใช่ตอนเข้าสถานี', () => {
  it('งานที่เข้าสถานีก่อนแต่เพิ่งพัก อยู่หลังงานที่พักมานานกว่า', () => {
    const early = job({ id: 'a', status: 'hold', since: new Date('2026-11-16T02:00:00Z'), heldSince: new Date('2026-11-18T03:00:00Z') })
    const late = job({ id: 'b', status: 'hold', since: new Date('2026-11-17T02:00:00Z'), heldSince: new Date('2026-11-17T04:00:00Z') })
    expect(problemLists([early, late], null).held.map(j => j.id)).toEqual(['b', 'a'])
    expect(attachHolds([job({ id: 'a', status: 'hold' }), job({ id: 'c', status: 'doing' })], [
      { job_id: 'a', opened_at: '2026-11-17T01:00:00Z' }, { job_id: 'a', opened_at: '2026-11-18T03:00:00Z' }, { job_id: 'c', opened_at: '2026-11-18T03:00:00Z' },
    ]).map(j => j.heldSince?.toISOString())).toEqual(['2026-11-18T03:00:00.000Z', undefined])
  })
})
