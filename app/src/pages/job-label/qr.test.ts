
import { describe, expect, it } from 'vitest'
import { qrMatrix, qrSvgPath } from './qr'

const url = 'https://pp142.pages.dev/#/board?job=10000000-0000-4000-8000-000000000001'

// Nayuki QR Code generator 1.8.0 · byte mode, level M, automatic mask, no ECC boost.
// Row-major modules, most significant bit first; the last byte is padded with zeros.
const samples = [
  ['hello', 21, '/mP8FhBulrt0ZdusrsEFB/qv4AcAqlCRYRDUuj+QBCayqAB6n/jc8Eewurcd0hmuuisEhS/usYA='],
  [url, 37, '/iPHo/wQHkSQbrVBrLt1BoHl269X2K7BVaIJB/qqqq/gF76iAL4okVvnY+lcIa2MfLyHY7Z9Zp+4Py/7uDUO5oI6FLLPKAJjpXFWwzhLqUyuPSKU7QIs1/F5CWeeea6mKla5KpIqLU0QTziGLYBx7rWAWq5D2V0iK9LstpcBqj18ma9fLPoAYw6Ea/i0kiqwXKKDGbr5IF+t1aw/lm6qCzkXBJlNNZ/pLq8rgA=='],
  ['z'.repeat(200), 57, '/v0wszMzP8EOSXd3dJBuuTlRMRHLt0NYtkZmpduhVA/rMxLsFAbHE3dxB/qqqqqqqv4AKmnHd3UAo2kePszMEorybpZmZqX6/uhURERFIREmWnd3V5G2iZnMzMSTLzbPpmZqX47+nWRERFIxHWP3d3V4C2wObMzMSSLBrpZmZqXy54lURERFJZXtm/d3V5BywYDMzMSSYpiJdmZqXC3ZVVxERFLaXim0d3V5R/wYDEzMSUbpiJZmZqXD+hdPhER/LRdilHd3cZWuaYaszNqWRmaLFmZsXz/1dPxEQ/JrYSnfd3fZUmSepMzNwVSkKwlmZpk8zlakxEQNAJKixfd3fYTkaCfMzNwcSkpp1mZpn3znZcxEQNJZK5H/d3fZQg72JMzNwUCUrolmZpnUzGRExEQNPRe4Hcd3fZRsauJ8zNwUTcvopmZpnpj/hFxEQNPyQxHbd3fZA9ZufszN+QBZrrFmZkX/rxlaxEQrMEZxlHd3UZulDrvszM+V0arf1mZt0utthTREQzcEYRtbd3WY/rLmMMzNEIA='],
  ['กขค', 21, '/nP8EZBuvrt1dduorsFJB/qv4BQAvhPkZP64osOxckKgmgBFg/jfUFRRutGt11iuskkEm3/ujwA='],
] as const

describe('QR byte mode, level M', () => {
  it.each(samples)('matches the reference modules for %s', (text, size, packed) => {
    const bytes = atob(packed)
    const expected = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => {
      const i = y * size + x
      return ((bytes.charCodeAt(i >>> 3) >>> (7 - i % 8)) & 1) === 1
    }))
    expect(qrMatrix(text)).toEqual(expected)
  })

  it('puts the finders and timing at the standard coordinates for the board link', () => {
    const matrix = qrMatrix(url)
    expect(matrix).toHaveLength(37)
    const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111']
    for (const [r, c] of [[0, 0], [0, 30], [30, 0]]) {
      expect(matrix.slice(r, r + 7).map(row => row.slice(c, c + 7).map(Number).join(''))).toEqual(finder)
    }
    for (let i = 8; i < 29; i++) {
      expect(matrix[6][i]).toBe(i % 2 === 0)
      expect(matrix[i][6]).toBe(i % 2 === 0)
    }
  })

  it('writes both copies of the format information for level M, mask 2', () => {
    const matrix = qrMatrix(url)
    const first = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7],
      [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]]
    const second = Array.from({ length: 15 }, (_, i) => i < 8 ? [8, 36 - i] : [22 + i, 8])
    for (const coordinates of [first, second]) {
      const format = coordinates.reduce((word, [r, c], i) => word | (Number(matrix[r][c]) << i), 0)
      expect((format ^ 0x5412) >>> 10).toBe(2)
      expect(format).toBe(0x5e7c)
    }
  })

  it('selects the smallest version and throws in Thai above the version 10 capacity', () => {
    const maxByteLengths = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]
    maxByteLengths.forEach((capacity, index) => {
      expect(qrMatrix('x'.repeat(capacity))).toHaveLength(21 + 4 * index)
      if (index > 0) expect(qrMatrix('x'.repeat(maxByteLengths[index - 1] + 1))).toHaveLength(21 + 4 * index)
    })
    expect(() => qrMatrix('x'.repeat(214))).toThrow('ข้อความยาวเกินสำหรับสร้าง QR')
  })

  it('keeps a four-module quiet zone by offsetting the path', () => {
    expect(qrSvgPath([[true, false], [false, true]])).toBe('M4 4h1v1h-1zM5 5h1v1h-1z')
  })
})
