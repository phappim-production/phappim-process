import { describe, expect, it } from 'vitest'
import { translate } from './lang'
import { MY } from './my'

const THAI = /[ก-๛]/
const QUOTED = /'([^']+)'/g
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

describe('แปลภาษาพม่า', () => {
  it('เติมค่าในข้อความ และแปลค่าที่เป็นคำไทยซ้อนอยู่', () => {
    expect(translate('th', 'เริ่ม{station}', { station: { th: 'ตัดงาน' } })).toBe('เริ่มตัดงาน')
    expect(translate('my', 'เริ่ม{station}', { station: { th: 'ตัดงาน' } })).toBe('ညှပ် စမယ်')
    expect(translate('my', 'คิว {n}', { n: 2 })).toBe('အစဉ် 2')
  })

  it('วันที่: ไทยเป็นชื่อเดือนย่อ · พม่าเป็น วัน/เดือน ตัวเลข', () => {
    const at = new Date('2026-11-21T07:30:00Z')
    expect(translate('th', 'คาดว่าเสร็จ {at}', { at: { at } })).toBe('คาดว่าเสร็จ 21 พ.ย.')
    expect(translate('my', 'คาดว่าเสร็จ {at}', { at: { at } })).toBe('ပြီးမယ့်ရက် 21/11')
    expect(translate('my', 'เริ่ม {at}', { at: { at, time: true } })).toBe('စ 21/11 14:30')
  })

  // คนงานพม่าบอกว่าภาษาเขียนอ่านยาก · ใช้คำพูดหน้างาน
  it('คำแปลเป็นภาษาพูด ไม่ใช้คำลงท้าย/คำเชื่อมแบบภาษาเขียน', () => {
    const formal = /(?<!ဖောက်)သည်|(?<!နာ)မည်|၏|သို့|၍|ယခု|ယနေ့|ပါသည်/
    for (const [th, my] of Object.entries(MY)) expect(formal.test(my), `${th} → ${my}`).toBe(false)
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
  const direct = [/\btx?\('([^']+)'/g, /<Tr(?: inline)? th="([^"]+)"/g, /\b(?:w|word)\('([^']+)'/g, /\{ th: '([^']+)'/g]
  for (const text of Object.values(SOURCES)) {
    if (!text.includes('i18n/')) continue
    const keys = direct.flatMap(re => [...text.matchAll(re)].map(m => m[1]))
    for (const m of text.matchAll(/(?:<Tr(?: inline)? th=\{|\btx?\()([^}\n]*)/g)) keys.push(...[...m[1].matchAll(QUOTED)].map(x => x[1]))
    for (const k of keys) if (THAI.test(k) && !(k in MY)) missing.add(k)
  }
  expect([...missing]).toEqual([])
})
