import { describe, expect, it } from 'vitest'
import { hasBurmese, translate } from './lang'
import { DB_ERRORS } from './dbErrors'
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

describe('ข้อความจากฐานข้อมูล', () => {
  it('ทุกแบบมีตัวแปรครบ ไม่มีไทยหลง และเป็นภาษาพูด', () => {
    const formal = /(?<!ဖောက်)သည်|(?<!နာ)မည်|၏|သို့|၍|ယခု|ယနေ့/
    for (const [th, my] of DB_ERRORS) {
      const n = th.split('%').length - 1
      const used = [...my.matchAll(/\{(\d)\}/g)].map(m => Number(m[1]))
      expect(used.every(i => i >= 1 && i <= n), th).toBe(true)
      expect(THAI.test(my) || formal.test(my), `${th} → ${my}`).toBe(false)
    }
  })

  it('แปลข้อความที่มีค่าแทรก รวมถึงชื่อสถานีและข้อความซ้อน', () => {
    expect(translate('my', 'งานนี้อยู่สถานีตัดงาน ซึ่งไม่ใช่สถานีของคุณ ให้เจ้าของระบบจับคู่สถานีให้ก่อน หรือให้ฝ่ายผลิตกด')).toContain('ညှပ်')
    expect(translate('my', 'ยังกดเสร็จไม่ได้: QC ตรวจผ่าน 7/10 ชิ้น ยังไม่ครบ (ชิ้นไม่ผ่านให้กด "ส่งแก้")')).toBe('ပြီးပြီ နှိပ်လို့ မရသေးဘူး: QC အောင် 7/10 ပဲ ရှိသေးတယ် (မအောင်တာ "ပြန်ပြင်" နှိပ်ပါ)')
    expect(translate('th', 'งานนี้ถูกยกเลิกแล้ว')).toBe('งานนี้ถูกยกเลิกแล้ว')
    expect(hasBurmese('ข้อความจากฐานข้อมูลที่ไม่รู้จัก')).toBe(false)
  })
})
