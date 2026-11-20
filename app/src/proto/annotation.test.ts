import { describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT, applyEdit, blankSpec, calloutLines, confirmationRefs, defaultBox, forStation, historyEdit, historyOf,
  nextSpecCode, redo, refValue, saveProblems, submitProblems, toNormalized, toPayload, toPixels, undo, type Draft,
} from './annotation'

const spec = {
  product: 'tshirt',
  p: { tshirt: { neck: 'คอกลม', print_method: ['DTF'], sleeve: '', placements: {
    'หน้าอกซ้าย': { on: true, size: '8 × 8', note: 'ห่างคอ 8 ซม.' },
    'กลางหลัง': { on: true, tech: 'ซับลิเมชั่น', size: '25' },
    'แขนซ้าย': { on: false, size: '5' },
  } } },
}
const front = { view: 'front' as const, path: 'SC-1/sheet/a.png', width: 1600, height: 2000 }
const withPoints = (): Draft => {
  let d = applyEdit(EMPTY_DRAFT, { type: 'set_view', view: front })
  d = applyEdit(d, { type: 'add_callout', key: 'a', view: 'front', x: 0.5, y: 0.1 })
  d = applyEdit(d, { type: 'add_callout', key: 'b', view: 'front', x: 0.6, y: 0.3 })
  d = applyEdit(d, { type: 'add_callout', key: 'c', view: 'front', x: 0.2, y: 0.6 })
  return d
}

describe('พิกัดบนภาพ', () => {
  it('แปลงจุดที่กดเป็นสัดส่วน 0–1 ของภาพ และตัดส่วนที่เกินขอบ', () => {
    expect(toNormalized(150, 250, { left: 100, top: 200, width: 400, height: 500 })).toEqual({ x: 0.125, y: 0.1 })
    expect(toNormalized(900, 100, { left: 100, top: 200, width: 400, height: 500 })).toEqual({ x: 1, y: 0 })
    expect(toNormalized(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('จุดเดิมอยู่ตำแหน่งเดียวกันบนภาพทุกขนาดจอและทุกระดับซูม (คลาดไม่เกิน 0.5 px)', () => {
    const point = toNormalized(337, 512, { left: 20, top: 40, width: 700, height: 875 })
    for (const width of [375, 768, 1440]) {
      for (const zoom of [0.5, 1, 1.5, 2, 4]) {
        const size = { width: width * zoom, height: width * zoom * 1.25 }
        const px = toPixels(point.x, point.y, size)
        const back = toNormalized(px.left, px.top, { left: 0, top: 0, ...size })
        expect(Math.abs(back.x - point.x) * size.width).toBeLessThan(0.5)
        expect(Math.abs(back.y - point.y) * size.height).toBeLessThan(0.5)
      }
    }
  })

  it('กล่องข้อความวางออกด้านที่ใกล้ขอบภาพ และอยู่ในภาพเสมอ', () => {
    expect(defaultBox(0.2, 0.5).boxX).toBeLessThan(0.2)
    expect(defaultBox(0.8, 0.5).boxX).toBeGreaterThan(0.8)
    const edge = defaultBox(0.99, 1)
    expect(edge.boxX).toBeLessThanOrEqual(0.9)
    expect(edge.boxY).toBeLessThanOrEqual(0.95)
  })
})

describe('Callout เพิ่ม / แก้ / ลบ / เรียง', () => {
  it('เลขต่อกันอัตโนมัติ', () => {
    expect(withPoints().callouts.map(c => c.no)).toEqual([1, 2, 3])
  })

  it('ลบแล้วเลขเรียงใหม่ไม่เว้นช่อง', () => {
    const d = applyEdit(withPoints(), { type: 'remove_callout', key: 'b' })
    expect(d.callouts.map(c => [c.key, c.no])).toEqual([['a', 1], ['c', 2]])
  })

  it('เลื่อนลำดับขึ้น/ลง และเลื่อนเกินหัว/ท้ายไม่เปลี่ยน', () => {
    const up = applyEdit(withPoints(), { type: 'reorder_callout', key: 'c', dir: -1 })
    expect(up.callouts.sort((a, b) => a.no - b.no).map(c => c.key)).toEqual(['a', 'c', 'b'])
    const same = withPoints()
    expect(applyEdit(same, { type: 'reorder_callout', key: 'a', dir: -1 })).toBe(same)
  })

  it('ย้ายจุดและกล่องได้ ค่าถูกตัดให้อยู่ในภาพ', () => {
    const d = applyEdit(withPoints(), { type: 'update_callout', key: 'a', patch: { x: 1.4, boxY: -2, title: 'คอเสื้อ' } })
    const a = d.callouts.find(c => c.key === 'a')!
    expect([a.x, a.boxY, a.title]).toEqual([1, 0, 'คอเสื้อ'])
  })

  it('ลบภาพแล้ว Callout บนภาพนั้นหายด้วย', () => {
    let d = applyEdit(withPoints(), { type: 'set_view', view: { ...front, view: 'back' } })
    d = applyEdit(d, { type: 'add_callout', key: 'z', view: 'back', x: 0.5, y: 0.5 })
    d = applyEdit(d, { type: 'remove_view', view: 'front' })
    expect(d.callouts.map(c => [c.key, c.no])).toEqual([['z', 1]])
  })
})

describe('Undo / Redo', () => {
  it('ย้อนและทำซ้ำได้ แก้ใหม่หลังย้อนแล้วล้างรายการทำซ้ำ', () => {
    let h = historyOf(withPoints())
    h = historyEdit(h, { type: 'update_callout', key: 'a', patch: { title: 'คอ' } })
    h = historyEdit(h, { type: 'remove_callout', key: 'b' })
    expect(h.present.callouts).toHaveLength(2)
    h = undo(h)
    expect(h.present.callouts).toHaveLength(3)
    h = undo(h)
    expect(h.present.callouts[0]!.title).toBe('')
    h = redo(h)
    expect(h.present.callouts[0]!.title).toBe('คอ')
    h = historyEdit(h, { type: 'remove_callout', key: 'c' })
    expect(h.future).toEqual([])
    expect(undo(historyOf(EMPTY_DRAFT)).present).toBe(EMPTY_DRAFT)
  })
})

describe('สเปก', () => {
  it('ค่าจากใบยืนยันตรงกับในฐานข้อมูล (ตำแหน่งไม่ใส่เทคนิค = ใช้เทคนิคเดียวของใบ)', () => {
    expect(refValue(spec, 'placement:หน้าอกซ้าย')).toBe('DTF · 8 × 8 ซม. · ห่างคอ 8 ซม.')
    expect(refValue(spec, 'placement:กลางหลัง')).toBe('ซับลิเมชั่น · 25 ซม.')
    expect(refValue(spec, 'placement:แขนซ้าย')).toBeNull()
    expect(refValue(spec, 'field:print_method')).toBe('DTF')
    expect(refValue(spec, 'field:sleeve')).toBeNull()
    expect(refValue(null, 'field:neck')).toBeNull()
  })

  it('รายการให้เลือกจากใบยืนยัน มีเฉพาะช่องที่มีค่า', () => {
    expect(confirmationRefs(spec).map(r => r.ref)).toEqual(['placement:หน้าอกซ้าย', 'placement:กลางหลัง', 'field:neck', 'field:print_method'])
  })

  it('สร้างสเปกใหม่จาก Callout แล้วผูกให้ทันที · ลบสเปกแล้วจุดไม่ค้างอ้างของที่ไม่มี', () => {
    let d = withPoints()
    d = applyEdit(d, { type: 'add_spec', spec: blankSpec('s1', d.specs, { name: 'ขอบคอ', width: 2 }), linkTo: 'a' })
    expect(d.specs[0]!.code).toBe('S-01')
    expect(d.callouts.find(c => c.key === 'a')!.specKey).toBe('s1')
    d = applyEdit(d, { type: 'update_callout', key: 'b', patch: { specKey: 's1' } })
    expect(d.callouts.filter(c => c.specKey === 's1')).toHaveLength(2)
    d = applyEdit(d, { type: 'remove_spec', key: 's1' })
    expect(d.callouts.some(c => c.specKey)).toBe(false)
  })

  it('รหัสสเปกถัดไปใช้เลขว่างตัวแรก ไม่ซ้ำของเดิม', () => {
    expect(nextSpecCode([blankSpec('a', [], { code: 'S-02' })])).toBe('S-01')
    expect(nextSpecCode([blankSpec('a', [], { code: 'S-01' }), blankSpec('b', [], { code: 'S-02' })])).toBe('S-03')
    expect(nextSpecCode([blankSpec('a', [], { code: 'S-01' }), blankSpec('b', [], { code: 'S-03' })])).toBe('S-02')
  })

  it('ข้อความของจุด: ใบยืนยัน + สเปกเพิ่มเติม + ข้อความ · ฉบับอนุมัติใช้ค่าที่แช่ไว้', () => {
    let d = withPoints()
    d = applyEdit(d, { type: 'add_spec', spec: blankSpec('s1', [], { name: 'ขอบคอ', width: 2, color: 'ดำ' }), linkTo: 'b' })
    d = applyEdit(d, { type: 'update_callout', key: 'b', patch: { specRef: 'placement:หน้าอกซ้าย', body: 'ระวังตะเข็บ' } })
    const b = d.callouts.find(c => c.key === 'b')!
    expect(calloutLines(b, d, spec)).toEqual(['ตำแหน่ง หน้าอกซ้าย: DTF · 8 × 8 ซม. · ห่างคอ 8 ซม.', 'S-01 ขอบคอ · กว้าง 2 ซม. · สี ดำ', 'ระวังตะเข็บ'])
    expect(calloutLines({ ...b, refValue: 'DTF · 7 ซม.' }, d, spec)[0]).toBe('ตำแหน่ง หน้าอกซ้าย: DTF · 7 ซม.')
  })
})

describe('ตรวจก่อนบันทึก / ส่งอนุมัติ', () => {
  it('ส่งอนุมัติต้องมีภาพหน้า และทุกจุดมีชื่อ + สเปกหรือข้อความ', () => {
    expect(submitProblems(EMPTY_DRAFT)).toEqual(['ยังไม่มีภาพด้านหน้า'])
    expect(submitProblems(withPoints())).toEqual(['Callout 1, 2, 3 ยังไม่มีชื่อจุด', 'Callout 1, 2, 3 ยังไม่มีสเปกหรือข้อความ'])
  })

  it('บันทึกร่างต้องมีชื่อจุด รหัสสเปกไม่ซ้ำ และขนาดมากกว่า 0', () => {
    let d = applyEdit(EMPTY_DRAFT, { type: 'add_spec', spec: blankSpec('a', [], { code: 'S-01', name: 'x', width: 0 }) })
    d = applyEdit(d, { type: 'add_spec', spec: blankSpec('b', [], { code: 'S-01', name: 'y' }) })
    expect(saveProblems(d)).toEqual(['รหัสสเปก S-01 ซ้ำกัน', 'ขนาดของสเปก S-01 ต้องมากกว่า 0'])
  })

  it('ข้อมูลที่ส่งเข้าระบบใช้ชื่อช่องของฐานข้อมูล และเลขเรียงต่อกัน', () => {
    const d = applyEdit(withPoints(), { type: 'remove_callout', key: 'a' })
    const p = toPayload(d)
    expect(p.views[0]).toEqual({ view: 'front', image_path: 'SC-1/sheet/a.png', width: 1600, height: 2000 })
    expect(p.callouts.map(c => c.no)).toEqual([1, 2])
    expect(Object.keys(p.callouts[0]!)).toEqual(['view', 'no', 'x', 'y', 'box_x', 'box_y', 'title', 'body', 'spec_ref', 'spec_key', 'stations'])
  })
})

describe('หน้าดูของสถานี', () => {
  it('เห็นเฉพาะจุดของสถานีตัวเอง + จุดที่ไม่ระบุสถานี', () => {
    let d = withPoints()
    d = applyEdit(d, { type: 'update_callout', key: 'a', patch: { stations: ['sew'] } })
    d = applyEdit(d, { type: 'update_callout', key: 'b', patch: { stations: ['print', 'press'] } })
    expect(forStation(d.callouts, 'print').map(c => c.key)).toEqual(['b', 'c'])
    expect(forStation(d.callouts, null)).toHaveLength(3)
  })
})
