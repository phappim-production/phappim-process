import { describe, expect, it } from 'vitest'
import { MIN_CROP_PX, cropOnImage, currentRevOf, outputSize, parseSignature, signatureIsCurrent, signaturePath } from './customerSignature'

describe('ตัดลายเซ็นลูกค้า', () => {
  const shown = { w: 400, h: 300 }, natural = { w: 2000, h: 1500 }

  it('กรอบบนรูปที่ย่อ = กรอบบนรูปจริงตามสัดส่วน', () => {
    expect(cropOnImage({ x: 40, y: 30, w: 100, h: 50 }, shown, natural)).toEqual({ x: 200, y: 150, w: 500, h: 250 })
  })

  it('ลากจากขวาล่างไปซ้ายบนได้ผลเดียวกัน', () => {
    expect(cropOnImage({ x: 140, y: 80, w: -100, h: -50 }, shown, natural)).toEqual({ x: 200, y: 150, w: 500, h: 250 })
  })

  it('ลากเลยขอบรูป = ตัดที่ขอบรูป', () => {
    expect(cropOnImage({ x: 350, y: 250, w: 200, h: 200 }, shown, natural)).toEqual({ x: 1750, y: 1250, w: 250, h: 250 })
  })

  it('กรอบเล็กเกินไป (แตะเฉยๆ) หรือรูปยังไม่โหลด = ยังตัดไม่ได้', () => {
    expect(cropOnImage({ x: 10, y: 10, w: MIN_CROP_PX - 1, h: 40 }, shown, natural)).toBeNull()
    expect(cropOnImage({ x: 10, y: 10, w: 50, h: 50 }, { w: 0, h: 0 }, natural)).toBeNull()
  })

  it('ลายเซ็นกว้างเกิน 600 px ย่อลงคงสัดส่วน · เล็กกว่าไม่ขยาย', () => {
    expect(outputSize({ x: 0, y: 0, w: 1200, h: 300 })).toEqual({ w: 600, h: 150 })
    expect(outputSize({ x: 0, y: 0, w: 300, h: 90 })).toEqual({ w: 300, h: 90 })
  })

  it('อ่านลายเซ็นจากฐาน · ไม่มีลายเซ็น = null · ใบแก้ครั้งใหม่ = ไม่ใช่ลายเซ็นของใบนี้', () => {
    const s = parseSignature({ path: 'SC-1/sigab.png', signed_on: '2026-11-26', rev: 1, current_rev: 2 })
    expect(s).toEqual({ path: 'SC-1/sigab.png', signedOn: '2026-11-26', rev: 1, currentRev: 2 })
    expect(signatureIsCurrent(s!)).toBe(false)
    expect(signatureIsCurrent({ ...s!, rev: 2 })).toBe(true)
    expect(parseSignature(null)).toBeNull()
    expect(parseSignature({ path: 'x' })).toBeNull()
  })

  it('งานที่ยังไม่มีลายเซ็นยังรู้ว่าใบล่าสุดเป็นครั้งที่เท่าไร', () => {
    expect(currentRevOf({ current_rev: 3 })).toBe(3)
    expect(parseSignature({ current_rev: 3 })).toBeNull()
    expect(currentRevOf(null)).toBe(0)
    expect(currentRevOf({ current_rev: 'x' })).toBe(0)
  })

  it('ที่เก็บรูปลายเซ็นผ่านกฎชื่อไฟล์ของ Worker ทั้งเลขที่ใบไทย / มีช่องว่าง / เครื่องที่ไม่มี crypto', () => {
    const workerMockupPath = /^[A-Za-z0-9_-]{1,200}\/(?:sheet\/)?[A-Za-z0-9]{1,64}\.(?:jpg|png|webp)$/
    for (const no of ['SC691475-01', 'SC691475 -01', 'ใบ-12']) {
      for (const key of ['0123456789abcdef', String(Date.now())]) expect(signaturePath(no, key)).toMatch(workerMockupPath)
    }
  })
})
