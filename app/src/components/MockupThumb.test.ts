import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { MockupThumb } from './ui'

const BASE = 'https://files.test'
const url = `${BASE}/f/mockups/SC-1/aabbccddeeff0011.jpg?exp=1764000000&sig=abc`
const src = (html: string) => /src="([^"]*)"/.exec(html)?.[1]?.replaceAll('&amp;', '&')

afterEach(() => { vi.unstubAllEnvs() })

it('การ์ดเล็ก / กลางใช้รูปย่อ · กรอบใหญ่ใช้รูปเต็ม', () => {
  vi.stubEnv('VITE_FILES_URL', BASE)
  expect(src(renderToStaticMarkup(createElement(MockupThumb, { job: { no: 'SC-1', mockupUrl: url } })))).toBe(`${url}&v=thumb`)
  expect(src(renderToStaticMarkup(createElement(MockupThumb, { job: { no: 'SC-1', mockupUrl: url }, size: 'md' })))).toBe(`${url}&v=thumb`)
  expect(src(renderToStaticMarkup(createElement(MockupThumb, { job: { no: 'SC-1', mockupUrl: url }, size: 'lg' })))).toBe(url)
})

it('ยังไม่เปิดใช้ R2 ใช้ลิงก์ Storage เดิม · ไม่มีรูป = กรอบว่าง', () => {
  const storage = 'https://db.supabase.co/storage/v1/object/sign/mockups/SC-1/a.jpg?token=t'
  expect(src(renderToStaticMarkup(createElement(MockupThumb, { job: { no: 'SC-1', mockupUrl: storage } })))).toBe(storage)
  expect(renderToStaticMarkup(createElement(MockupThumb, { job: { no: 'SC-1' } }))).not.toContain('<img')
})
