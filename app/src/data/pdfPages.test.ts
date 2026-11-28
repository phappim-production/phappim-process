import { describe, expect, it } from 'vitest'
import { isPdfFile, PDF_RENDER_LONG_SIDE, renderScale } from './pdfPages'

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

  it('รู้ว่าไฟล์เป็น PDF จากชนิด หรือจากนามสกุลเมื่อเครื่องไม่บอกชนิด', () => {
    expect(isPdfFile({ name: 'a.bin', type: 'application/pdf' })).toBe(true)
    expect(isPdfFile({ name: 'ใบเซ็น.PDF', type: '' })).toBe(true)
    expect(isPdfFile({ name: 'a.pdf', type: 'image/png' })).toBe(false)
    expect(isPdfFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false)
  })
})
