import { describe, expect, it } from 'vitest'
import { withSignedType } from './confirmation'
import { PDF_RENDER_LONG_SIDE, renderScale } from './pdfPages'

describe('เปิด PDF ในหน้าตัดลายเซ็น', () => {
  it('ขยายหน้า A4 ให้ด้านยาวราว 2400 px พอเห็นลายเซ็นชัด', () => {
    const scale = renderScale(595, 842)
    expect(Math.round(842 * scale)).toBe(PDF_RENDER_LONG_SIDE)
    expect(Math.round(842 * renderScale(842, 595))).toBeLessThanOrEqual(PDF_RENDER_LONG_SIDE)
  })

  it('หน้าเล็กมากขยายไม่เกิน 6 เท่า · ขนาดผิดใช้ 1 เท่า', () => {
    expect(renderScale(100, 100)).toBe(6)
    expect(renderScale(0, 0)).toBe(1)
  })

  it('ไฟล์จากแอปแชตที่ไม่บอกชนิด ใช้ชนิดตามนามสกุล ตัดลายเซ็นได้', () => {
    expect(withSignedType(new File(['%PDF'], 'ใบเซ็น.PDF', { type: '' })).type).toBe('application/pdf')
    expect(withSignedType(new File(['x'], 'scan.pdf', { type: 'application/octet-stream' })).type).toBe('application/pdf')
    expect(withSignedType(new File(['x'], 'IMG_01.JPEG', { type: 'application/octet-stream' })).type).toBe('image/jpeg')
    expect(withSignedType(new File(['x'], 'a.webp', { type: '' })).type).toBe('image/webp')
  })

  it('ชนิดที่เครื่องบอกมาแล้วไม่เปลี่ยน · ชนิดอื่นไม่เดาจากนามสกุล', () => {
    const png = new File(['x'], 'a.pdf', { type: 'image/png' })
    expect(withSignedType(png)).toBe(png)
    const gif = new File(['x'], 'a.png', { type: 'image/gif' })
    expect(withSignedType(gif)).toBe(gif)
    const pdf = new File(['x'], 'a.bin', { type: 'application/pdf' })
    expect(withSignedType(pdf)).toBe(pdf)
  })
})
