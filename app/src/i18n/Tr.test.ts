import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it } from 'vitest'
import { setLang } from './lang'
import { LangScope, Tr } from './Tr'

afterEach(() => setLang('th'))

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
