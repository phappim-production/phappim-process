import { describe, expect, it } from 'vitest'
import { approveBlock, clampIndex, dragOffset, splitFromPointer, swipeTarget, zoomOrigin } from './photoViewer'

describe('เลื่อนรูป', () => {
  it('ไม่หลุดช่วงรูปที่มี', () => {
    expect(clampIndex(-1, 3)).toBe(0)
    expect(clampIndex(5, 3)).toBe(2)
    expect(clampIndex(1.7, 3)).toBe(1)
    expect(clampIndex(2, 0)).toBe(0)
  })

  it('ลากเกิน 50 px เปลี่ยนรูป · น้อยกว่านั้นอยู่รูปเดิม', () => {
    expect(swipeTarget(0, 3, -51)).toBe(1)
    expect(swipeTarget(1, 3, 60)).toBe(0)
    expect(swipeTarget(1, 3, -30)).toBe(1)
    expect(swipeTarget(1, 3, 49)).toBe(1)
  })

  it('ลากเลยรูปแรก/สุดท้ายไม่เลื่อนต่อ', () => {
    expect(swipeTarget(0, 3, 200)).toBe(0)
    expect(swipeTarget(2, 3, -200)).toBe(2)
    expect(swipeTarget(0, 1, -200)).toBe(0)
  })

  it('ลากที่ขอบหนืดลง · กลางแถวลากได้เต็ม', () => {
    expect(dragOffset(0, 3, 100)).toBeCloseTo(35)
    expect(dragOffset(2, 3, -100)).toBeCloseTo(-35)
    expect(dragOffset(1, 3, 100)).toBe(100)
    expect(dragOffset(0, 3, -100)).toBe(-100)
  })
})

describe('เทียบม็อคอัพ', () => {
  it('ตำแหน่งเส้นแบ่งตามนิ้ว อยู่ในช่วง 4–96%', () => {
    expect(splitFromPointer(150, 100, 200)).toBe(25)
    expect(splitFromPointer(100, 100, 200)).toBe(4)
    expect(splitFromPointer(400, 100, 200)).toBe(96)
    expect(splitFromPointer(10, 0, 0)).toBe(50)
  })

  it('จุดซูมตามตำแหน่งที่แตะ', () => {
    expect(zoomOrigin(50, 25, { left: 0, top: 0, width: 100, height: 100 })).toBe('50% 25%')
    expect(zoomOrigin(-20, 500, { left: 0, top: 0, width: 100, height: 100 })).toBe('0% 100%')
  })
})

describe('กดผ่านได้เมื่อ', () => {
  it('รูปโหลดครบและเปิดได้ทุกรูปเท่านั้น', () => {
    expect(approveBlock({ loading: true, count: 0, broken: 0 })).toBe('loading')
    expect(approveBlock({ loading: false, count: 0, broken: 0 })).toBe('no_photos')
    expect(approveBlock({ loading: false, count: 2, broken: 1 })).toBe('broken')
    expect(approveBlock({ loading: false, count: 2, broken: 0 })).toBeNull()
  })
})
