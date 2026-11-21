import { describe, expect, it } from 'vitest'
import { translate } from './lang'
import { MY } from './my'

const THAI = /[ก-๛]/
const QUOTED = /'([^']+)'/g
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

describe('แปลภาษาพม่า', () => {
  it('เติมค่าในข้อความ และแปลค่าที่เป็นคำไทยซ้อนอยู่', () => {
    expect(translate('th', 'เริ่ม{station}', { station: { th: 'ตัดงาน' } })).toBe('เริ่มตัดงาน')
    expect(translate('my', 'เริ่ม{station}', { station: { th: 'ตัดงาน' } })).toBe('ဖြတ် စတင်')
    expect(translate('my', 'คิว {n}', { n: 2 })).toBe('တန်း 2')
  })

  it('ไม่มีคำแปล = แสดงไทยเดิม', () => {
    expect(translate('my', 'ข้อความที่ยังไม่มีคำแปล')).toBe('ข้อความที่ยังไม่มีคำแปล')
  })

  it('คำแปลมีตัวแปร {…} ครบตรงกับต้นฉบับ และไม่มีตัวอักษรไทยหลงอยู่', () => {
    for (const [th, my] of Object.entries(MY)) {
      expect(placeholders(my), th).toEqual(placeholders(th))
      expect(THAI.test(my), `${th} → ${my}`).toBe(false)
    }
  })
})

const SOURCES = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true })

// หน้าจอพนักงานใช้ t('…') / <Tr th="…"> / w('…') · ทุกข้อความคงที่ต้องมีคำแปล ไม่งั้นคนพม่าเห็นไทยกลางจอ
it('ทุกข้อความที่ส่งเข้าตัวแปลในหน้าจอมีคำแปลพม่า', () => {
  const missing = new Set<string>()
  const direct = [/\btx?\('([^']+)'/g, /<Tr(?: inline)? th="([^"]+)"/g, /\bw\('([^']+)'/g, /\{ th: '([^']+)'/g]
  for (const text of Object.values(SOURCES)) {
    if (!text.includes('i18n/')) continue
    const keys = direct.flatMap(re => [...text.matchAll(re)].map(m => m[1]))
    for (const m of text.matchAll(/(?:<Tr(?: inline)? th=\{|\btx?\()([^}\n]*)/g)) keys.push(...[...m[1].matchAll(QUOTED)].map(x => x[1]))
    for (const k of keys) if (THAI.test(k) && !(k in MY)) missing.add(k)
  }
  expect([...missing]).toEqual([])
})
