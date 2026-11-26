import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { COLUMNS } from '../proto/model'
import { StationHeader, StationRail } from './StationNav'

it('แถบสถานีคงเลข 1–7 เดิม · สั่งผลิตข้างนอกขึ้นเป็นปุ่มไม่มีเลข', () => {
  const html = renderToStaticMarkup(createElement(StationRail, {
    columns: COLUMNS, counts: () => 0, urgent: () => 0, station: 'all', onPick: () => {},
  }))
  expect(html).toContain('สั่งผลิตข้างนอก')
  const numbers = [...html.matchAll(/rounded-full text-xs[^>]*>(\d+)</g)].map(m => Number(m[1]))
  expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7])
  expect(html.indexOf('QC + Packing')).toBeLessThan(html.indexOf('สั่งผลิตข้างนอก'))
})

it('รอผลิตอยู่ถัดจากทุกสถานี ก่อนสถานีพิมพ์ (ทุกงานผ่านขั้นนี้ก่อน)', () => {
  const html = renderToStaticMarkup(createElement(StationRail, {
    columns: COLUMNS, counts: () => 0, urgent: () => 0, station: 'all', onPick: () => {},
  }))
  const at = (name: string) => html.indexOf(`>${name}<`)
  expect(at('ทุกสถานี')).toBeLessThan(at('รอผลิต'))
  expect(at('รอผลิต')).toBeLessThan(at('พิมพ์'))
  expect(at('รอผลิต')).toBeLessThan(at('ขึ้นตัวอย่าง'))
})

it('หัวสถานีสั่งผลิตข้างนอกบอกว่าโรงงานนอกทำ ไม่ใช่สถานีที่ 0', () => {
  const html = renderToStaticMarkup(createElement(StationHeader, {
    station: 'outside', jobs: [], stations: ['outside', 'qc_pack'], onPick: () => {},
  }))
  expect(html).toContain('โรงงานนอกทำ · แอดมินส่งออกและรับเข้า')
  expect(html).not.toContain('สถานีที่ 0')
})
