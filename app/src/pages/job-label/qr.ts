
const VERSIONS = [
  { words: 26, ecc: 10, blocks: 1, centers: [] },
  { words: 44, ecc: 16, blocks: 1, centers: [6, 18] },
  { words: 70, ecc: 26, blocks: 1, centers: [6, 22] },
  { words: 100, ecc: 18, blocks: 2, centers: [6, 26] },
  { words: 134, ecc: 24, blocks: 2, centers: [6, 30] },
  { words: 172, ecc: 16, blocks: 4, centers: [6, 34] },
  { words: 196, ecc: 18, blocks: 4, centers: [6, 22, 38] },
  { words: 242, ecc: 22, blocks: 4, centers: [6, 24, 42] },
  { words: 292, ecc: 22, blocks: 5, centers: [6, 26, 46] },
  { words: 346, ecc: 26, blocks: 5, centers: [6, 28, 50] },
]

function multiply(a: number, b: number) {
  let result = 0
  while (b) {
    if (b & 1) result ^= a
    a = (a << 1) ^ ((a & 0x80) ? 0x11d : 0)
    b >>>= 1
  }
  return result
}

function generator(degree: number) {
  let polynomial = [1]
  let root = 1
  for (let i = 0; i < degree; i++) {
    polynomial = [...polynomial, 0].map((coefficient, j) => coefficient ^ multiply(polynomial[j - 1] ?? 0, root))
    root = multiply(root, 2)
  }
  return polynomial.slice(1)
}

function interleave(data: number[], { words, ecc, blocks }: typeof VERSIONS[number]) {
  const polynomial = generator(ecc)
  const dataBlocks: number[][] = []
  const errorBlocks: number[][] = []
  const shortLength = Math.floor(words / blocks) - ecc
  let offset = 0
  for (let i = 0; i < blocks; i++) {
    const length = shortLength + Number(i >= blocks - words % blocks)
    const block = data.slice(offset, offset + length)
    offset += length
    const remainder = Array<number>(ecc).fill(0)
    for (const word of block) {
      const factor = word ^ remainder.shift()!
      remainder.push(0)
      for (let j = 0; j < ecc; j++) remainder[j] ^= multiply(polynomial[j], factor)
    }
    dataBlocks.push(block)
    errorBlocks.push(remainder)
  }

  const result: number[] = []
  for (let i = 0; i <= shortLength; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i])
  }
  for (let i = 0; i < ecc; i++) {
    for (const block of errorBlocks) result.push(block[i])
  }
  return result
}

function bit(value: number, index: number) {
  return ((value >>> index) & 1) === 1
}

function bch(value: number, width: number, polynomial: number) {
  let remainder = value
  for (let i = 0; i < width; i++) {
    remainder = (remainder << 1) ^ (bit(remainder, width - 1) ? polynomial : 0)
  }
  return (value << width) | remainder
}

const MASKS: ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  r => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
]

function linePenalty(line: boolean[]) {
  const runs = [0] // First run is light, even when the first module is dark.
  let dark = false
  for (const module of line) {
    if (module !== dark) {
      dark = module
      runs.push(0)
    }
    runs[runs.length - 1]++
  }
  let score = runs.reduce((sum, length) => sum + (length >= 5 ? length - 2 : 0), 0)

  // The outside of the symbol is light. Count each side with four light units.
  if (dark) runs.push(0)
  runs[0] += line.length
  runs[runs.length - 1] += line.length
  for (let i = 1; i + 5 < runs.length; i += 2) {
    const unit = runs[i]
    if (runs[i + 1] !== unit || runs[i + 2] !== 3 * unit || runs[i + 3] !== unit || runs[i + 4] !== unit) continue
    const before = runs[i - 1]
    const after = runs[i + 5]
    if (before >= 4 * unit && after >= unit) score += 40
    if (after >= 4 * unit && before >= unit) score += 40
  }
  return score
}

function penalty(matrix: boolean[][]) {
  const size = matrix.length
  let score = 0
  let dark = 0
  for (let r = 0; r < size; r++) {
    score += linePenalty(matrix[r]) + linePenalty(matrix.map(row => row[r]))
    for (let c = 0; c < size; c++) {
      const value = matrix[r][c]
      if (value) dark++
      if (r > 0 && c > 0 && value === matrix[r - 1][c] && value === matrix[r][c - 1] && value === matrix[r - 1][c - 1]) score += 3
    }
  }
  return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
}

function drawFormat(matrix: boolean[][], mask: number, draw = (r: number, c: number, value: boolean) => { matrix[r][c] = value }) {
  const size = matrix.length
  // Level M has format indicator 00, so only the mask contributes to the payload.
  const bits = bch(mask, 10, 0x537) ^ 0x5412
  for (let i = 0; i <= 5; i++) draw(i, 8, bit(bits, i))
  draw(7, 8, bit(bits, 6))
  draw(8, 8, bit(bits, 7))
  draw(8, 7, bit(bits, 8))
  for (let i = 9; i < 15; i++) draw(8, 14 - i, bit(bits, i))
  for (let i = 0; i < 8; i++) draw(8, size - 1 - i, bit(bits, i))
  for (let i = 8; i < 15; i++) draw(size - 15 + i, 8, bit(bits, i))
  draw(size - 8, 8, true)
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  const useEci = bytes.some(byte => byte >= 0x80)
  const countWidth = (index: number) => index < 9 ? 8 : 16
  const index = VERSIONS.findIndex(({ words, ecc, blocks }, i) =>
    (useEci ? 12 : 0) + 4 + countWidth(i) + bytes.length * 8 <= (words - ecc * blocks) * 8)
  if (index === -1) throw new Error('ข้อความยาวเกินสำหรับสร้าง QR')

  const version = index + 1
  const spec = VERSIONS[index]
  const capacity = (spec.words - spec.ecc * spec.blocks) * 8
  const bits: number[] = []
  const append = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push(Number(bit(value, i)))
  }
  if (useEci) {
    append(0b0111, 4)
    append(26, 8) // ECI assignment for UTF-8
  }
  append(0b0100, 4)
  append(bytes.length, countWidth(index))
  for (const byte of bytes) append(byte, 8)
  append(0, Math.min(4, capacity - bits.length))
  append(0, (8 - bits.length % 8) % 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0))
  for (let pad = 0; data.length * 8 < capacity; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11)
  const words = interleave(data, spec)

  const size = 17 + version * 4
  const grid = () => Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const matrix = grid()
  const reserved = grid()
  const set = (r: number, c: number, dark: boolean) => {
    matrix[r][c] = dark
    reserved[r][c] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [row, col] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = row + dr
        const c = col + dc
        const radius = Math.max(Math.abs(dr), Math.abs(dc))
        if (r >= 0 && c >= 0 && r < size && c < size) set(r, c, radius !== 2 && radius !== 4)
      }
    }
  }
  for (const row of spec.centers) {
    for (const col of spec.centers) {
      const last = size - 7
      if ((row === 6 && (col === 6 || col === last)) || (row === last && col === 6)) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) set(row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
      }
    }
  }
  drawFormat(matrix, 0, set)
  if (version >= 7) {
    const info = bch(version, 12, 0x1f25)
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + i % 3
      const b = Math.floor(i / 3)
      set(a, b, bit(info, i))
      set(b, a, bit(info, i))
    }
  }

  let next = 0
  let up = true
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--
    for (let i = 0; i < size; i++) {
      const r = up ? size - 1 - i : i
      for (let c = right; c >= right - 1; c--) {
        if (reserved[r][c]) continue
        if (next < words.length * 8) matrix[r][c] = bit(words[next >>> 3], 7 - next % 8)
        next++
      }
    }
    up = !up
  }

  let best = matrix
  let lowest = Infinity
  for (const [mask, applies] of MASKS.entries()) {
    const candidate = matrix.map((row, r) => row.map((dark, c) => dark !== (!reserved[r][c] && applies(r, c))))
    drawFormat(candidate, mask)
    const score = penalty(candidate)
    if (score < lowest) {
      best = candidate
      lowest = score
    }
  }
  return best
}

export function qrSvgPath(matrix: boolean[][]): string {
  const path: string[] = []
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) path.push('M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z')
  }))
  return path.join('')
}
