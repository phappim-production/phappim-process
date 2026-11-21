import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { Draft } from '../../proto/annotation'
import { SpecPreview, SpecSheetView } from './SpecPreview'

const draft: Draft = {
  views: [
    { view: 'front', path: 'SC-1/sheet/front.png', width: 1600, height: 2000 },
    { view: 'back', path: 'SC-1/sheet/back.png', width: 1600, height: 2000 },
  ],
  specs: [],
  callouts: [
    { key: 'b', view: 'back', no: 2, x: 0.5, y: 0.4, boxX: 0.1, boxY: 0.4, title: 'ลายหลัง', body: '', specRef: 'placement:กลางหลัง', specKey: null, stations: [], refValue: 'ซับลิเมชั่น · 25 ซม.' },
    { key: 'a', view: 'front', no: 1, x: 0.5, y: 0.1, boxX: 0.8, boxY: 0.05, title: 'คอเสื้อ', body: 'ปกสีครีม', specRef: null, specKey: null, stations: ['sew', 'qc_pack'] },
  ],
}

it('แสดงม็อคอัพกำกับสเปกฉบับอนุมัติในรายละเอียดงาน: ภาพทุกมุม จุดเรียงตามเลข และสถานีของแต่ละจุด', () => {
  const html = renderToStaticMarkup(createElement(SpecSheetView, {
    rev: 2, sheet: { draft, urls: new Map([['SC-1/sheet/front.png', 'https://x/front'], ['SC-1/sheet/back.png', 'https://x/back']]) }, open: null,
  }))
  expect(html).toContain('ม็อคอัพกำกับสเปก · ฉบับ 2')
  expect(html).toContain('data-testid="canvas-front"')
  expect(html).toContain('data-testid="canvas-back"')
  expect(html).toContain('https://x/back')
  expect(html.indexOf('คอเสื้อ')).toBeLessThan(html.indexOf('ลายหลัง'))
  expect(html).toContain('เย็บงาน, QC + Packing')
  expect(html).toContain('ทุกสถานี')
  expect(html).toContain('ตำแหน่ง กลางหลัง: ซับลิเมชั่น · 25 ซม.')
})

it('ระหว่างโหลดยังเห็นรูปม็อคอัพเดิม และมีปุ่มเปิดเต็มจอ', () => {
  const html = renderToStaticMarkup(createElement(SpecPreview, {
    jobId: 'job-1', sheetId: 'sheet-1', rev: 1, fallback: createElement('img', { alt: 'รูปเดิม' }),
  }))
  expect(html).toContain('alt="รูปเดิม"')
  expect(html).toContain('กำลังโหลดม็อคอัพกำกับสเปก')
  expect(html).toContain('href="#/mockup?id=job-1"')
})
