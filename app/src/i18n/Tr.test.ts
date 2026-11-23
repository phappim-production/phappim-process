import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import { setLang, setScreenLang, useScreenLang } from './lang'
import { LangScope, Tr } from './Tr'

afterEach(() => { setLang('th'); setScreenLang(null) })

it('ภาษาไทย: แสดงไทยอย่างเดียว', () => {
  setLang('th')
  expect(renderToString(h(Tr, { th: 'พักงาน' }))).toBe('พักงาน')
})

it('ภาษาพม่า: พม่าตัวหลัก มีไทยตัวเล็กใต้', () => {
  setLang('my')
  const html = renderToString(h(LangScope, { allowed: true, children: h(Tr, { th: 'พักงาน' }) }))
  expect(html).toContain('ခဏရပ်')
  expect(html).toContain('พักงาน')
})

it('บทบาทที่ไม่ได้แปลเห็นไทยเสมอ แม้เครื่องตั้งพม่าไว้', () => {
  setLang('my')
  const html = renderToString(h(LangScope, { allowed: false, children: h(Tr, { th: 'พักงาน' }) }))
  expect(html).toBe('พักงาน')
})

it('ไม่มีคำแปล: แสดงไทย ไม่ขึ้นช่องว่าง', () => {
  setLang('my')
  expect(renderToString(h(LangScope, { allowed: true, children: h(Tr, { th: 'ข้อความใหม่ที่ยังไม่แปล' }) }))).toBe('ข้อความใหม่ที่ยังไม่แปล')
})

it('ส่วนนอกหน้า (แถบรุ่นใหม่) ใช้ภาษาของหน้า: แอดมินบนเครื่องที่จำพม่าไว้เห็นไทย', () => {
  const Banner = () => h(LangScope, { allowed: useScreenLang() !== 'th', children: h(Tr, { th: 'โหลดรุ่นใหม่' }) })
  setLang('my')
  setScreenLang('th')
  expect(renderToString(h(Banner))).toBe('โหลดรุ่นใหม่')
  setScreenLang('my')
  expect(renderToString(h(Banner))).toContain('โหลดรุ่นใหม่')
  expect(renderToString(h(Banner))).not.toBe('โหลดรุ่นใหม่')
  setScreenLang(null)
  expect(renderToString(h(Banner))).not.toBe('โหลดรุ่นใหม่')
})
