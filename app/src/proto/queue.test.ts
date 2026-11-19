import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { boardScope } from '../auth/scope'
import { useFactoryData } from '../data/useFactoryData'
import Dashboard from '../pages/Dashboard'
import { TodoPanel } from '../pages/WorkPanels'
import { StationQueue } from '../pages/StationQueue'
import { byQueue, queueNo, stationCounts, waitingAt, type Job } from './model'
import { simulate, workdayToDate } from './capacity'
import { planSewing } from './sewing'
import { todoList } from './actions'

vi.mock('../data/useFactoryData', async importOriginal => {
  const mod = await importOriginal<typeof import('../data/useFactoryData')>()
  return { ...mod, useFactoryData: vi.fn() }
})

const base: Job = {
  id: 'x', no: 'SC-X', customer: 'ลูกค้า', product: 'เสื้อยืด', unit: 'ตัว', qty: 10,
  due: new Date('2026-11-30T18:00:00+07:00'), since: new Date('2026-11-18T09:00:00+07:00'),
  route: 'plain', phase: 'production', station: 'cut', status: 'queued',
  sampleRound: 1, materials: { admin: true, qc: true, production: true },
}
const job = (id: string, over: Partial<Job>): Job => ({ ...base, id, no: `SC-${id}`, ...over })

describe('คิวงาน', () => {
  it('เรียงตามลำดับรับเข้า ไม่ใช่กำหนดส่ง', () => {
    const first = job('1', { queue: 1, due: new Date('2026-12-31') })
    const urgentDue = job('2', { queue: 2, due: new Date('2026-11-19') })
    expect([urgentDue, first].sort(byQueue).map(j => j.id)).toEqual(['1', '2'])
  })

  it('งานที่แทรกคิว (เลขคิวทศนิยม) อยู่ระหว่างสองงาน', () => {
    const list = [job('a', { queue: 1 }), job('b', { queue: 2 }), job('rush', { queue: 1.5 })]
    expect(list.sort(byQueue).map(j => j.id)).toEqual(['a', 'rush', 'b'])
  })

  it('คิวของสถานีนับเฉพาะงานที่รอเริ่มที่สถานีเดียวกัน', () => {
    const doing = job('d', { queue: 1, status: 'doing' })
    const hold = job('h', { queue: 2, status: 'hold' })
    const other = job('o', { queue: 3, station: 'sew' })
    const a = job('a', { queue: 4 })
    const b = job('b', { queue: 5 })
    const all = [b, other, a, hold, doing]
    expect(waitingAt(all, 'cut').map(j => j.id)).toEqual(['a', 'b'])
    expect(queueNo(a, all)).toBe(1)
    expect(queueNo(b, all)).toBe(2)
    expect(queueNo(doing, all)).toBeUndefined()
  })

  it('ตัวอย่างกับผลิตจริงที่สถานีเดียวกันอยู่คิวเดียวกัน (ตรงกับฐานข้อมูล)', () => {
    const sample = job('s', { queue: 2, phase: 'sample' })
    const prod = job('p', { queue: 1 })
    expect(waitingAt([sample, prod], 'cut').map(j => j.id)).toEqual(['p', 's'])
  })

  it('นับงานแก้และตัวอย่างต่างเส้นทางในคิวตัด แต่ไม่นับงานพักหรือต่างสถานี', () => {
    const repair = job('repair', { queue: 2, route: 'cut_only', rework: { qty: 1, reason: 'ตัดคลาด' } })
    const sample = job('sample', { queue: 3, route: 'cut_only', phase: 'sample', sampleRound: 2 })
    const last = job('last', { queue: 5 })
    const jobs = [last, job('hold', { queue: 1, status: 'hold' }), repair, sample, job('print', { queue: 4, station: 'print' })]
    expect(waitingAt(jobs, 'cut').map(j => j.id)).toEqual(['repair', 'sample', 'last'])
    expect(queueNo(last, jobs)).toBe(3)
  })

  it('เลขคิวเท่ากัน ตัดสินด้วยเวลาเข้าสถานีแล้วใช้ ID', () => {
    const first = job('z', { queue: 4.5 })
    const later = new Date(first.since.getTime() + 60_000)
    const second = job('a', { queue: first.queue, since: later })
    const third = job('b', { queue: first.queue, since: later })
    expect(waitingAt([third, second, first], 'cut').map(j => j.id)).toEqual(['z', 'a', 'b'])
  })

  it('รายการต้องทำและคิวเย็บเรียงตามเลขคิวแม้งานท้ายกำหนดส่งก่อน', () => {
    const first = job('first', { queue: -1, station: 'sew' })
    const last = job('last', { queue: 2, station: 'sew', due: new Date('2026-11-19') })
    const now = new Date('2026-11-18T09:00:00+07:00')
    expect(todoList([last, first], now).map(r => r.job.id)).toEqual(['first', 'last'])
    expect(planSewing([last, first], [], {}, now).rows.map(r => r.job.id)).toEqual(['first', 'last'])
  })

  it('งานที่ส่งไปเย็บข้างนอก ไม่ขึ้นในรอบเย็บของโรงงาน (QA รอบ 5 G7 ข้อ 3)', () => {
    const now = new Date('2026-11-18T09:00:00+07:00')
    const run = (stations: Job['station'][]) => ({
      id: 1, vendor: 'บริษัท', vendorId: 1, stations: stations as NonNullable<Job['station']>[], qty: 10, rework: false,
      sentAt: now, arriveAt: now, leadDays: 1, backAt: now,
    })
    const outSew = job('outSew', { station: 'sew', status: 'out', out: run(['sew']) })
    const outCut = job('outCut', { station: 'cut', status: 'out', out: run(['cut', 'sew']) })
    const home = job('home', { station: 'sew' })
    expect(planSewing([outSew, outCut, home], [], {}, now, true).rows.map(r => r.job.id)).toEqual(['home'])
  })
})

describe('คาดการณ์ตามคิวของสถานี', () => {
  const now = new Date(2026, 10, 18, 9)
  const queued = (id: string, queue: number) => job(id, { queue, route: 'cut_only', station: 'qc_pack', qty: 800 })

  it('ย้ายงานเป็นคิวแรกแล้ววันเสร็จเร็วขึ้น งานทดลองที่พร้อมพร้อมกันต่อท้าย', () => {
    const a = queued('first', 1)
    const b = queued('rush', 2)
    const baseline = simulate([b, a], now)
    const rush = simulate([{ ...b, queue: -1 }, a], now)
    expect(baseline.finishDay.get(b.id)).toBe(2)
    expect(rush.finishDay.get(b.id)).toBe(1)
    expect(workdayToDate(1, now).getDate()).toBe(18)
    expect(workdayToDate(2, now).getDate()).toBe(19)

    const atCut = { ...a, station: 'cut' as const }
    const forecast = simulate([atCut], now, { route: 'cut_only', qty: 800, lead: 0 })
    expect(forecast.finishDay.get(a.id)).toBe(2)
    expect(forecast.extraFinishDay).toBe(3)
    expect(forecast.extraWaitAt).toBe('cut')
  })

  // เกณฑ์หลวม 1,000 ms และใช้รอบเร็วสุดใน 3 รอบ เพราะ CI ช้ากว่าเครื่องพัฒนา 3–4 เท่า · จับแค่กรณีช้าลงหลายเท่า
  it('คาดการณ์ 300 งานผ่านหลายสถานีใช้เวลาไม่เกิน 1,000 ms', () => {
    const routes = ['normal', 'dtf', 'dtg', 'screen', 'emb', 'print_emb', 'cut_only', 'plain'] as const
    const jobs = Array.from({ length: 300 }, (_, i) => job(String(i), {
      queue: 300 - i, route: routes[i % routes.length], station: undefined,
      qty: 10 + (i % 20) * 10, productCode: 'tshirt',
    }))
    const floor = { ready: { flat: 3 }, needsOf: () => [{ type: 'flat' as const, qty: 1 }] }
    let elapsed = Infinity
    let result = simulate(jobs, now, undefined, floor)
    for (let round = 0; round < 3; round++) {
      const start = performance.now()
      result = simulate(jobs, now, undefined, floor)
      elapsed = Math.min(elapsed, performance.now() - start)
    }
    console.info(`simulate 300 งาน: ${elapsed.toFixed(2)} ms (เร็วสุดใน 3 รอบ)`)
    expect(result.finishDay.size).toBe(300)
    expect(elapsed).toBeLessThanOrEqual(1000)
  })
})

describe('สถานีตอนนี้ (หน้าภาพรวม)', () => {
  it('นับงานรอ กำลังทำ ติดปัญหา เลยกำหนด ต่อสถานี ตามลำดับกระบวนการ', () => {
    const now = new Date('2026-11-25T10:00:00+07:00')
    const jobs = [
      job('a', {}), job('b', { status: 'doing' }), job('c', { status: 'hold', due: new Date('2026-11-20T18:00:00+07:00') }),
      job('d', { station: 'sew', status: 'doing' }), job('e', { phase: 'done', station: undefined, status: undefined }),
    ]
    const rows = stationCounts(jobs, now)
    expect(rows[0].key).toBe('print')
    expect(rows.find(r => r.key === 'cut')).toMatchObject({ waiting: 1, doing: 1, hold: 1, late: 1 })
    expect(rows.find(r => r.key === 'sew')).toMatchObject({ waiting: 0, doing: 1, hold: 0, late: 0 })
  })
})

describe('หน้าคิวและรายการต้องทำ', () => {
  const now = new Date('2026-11-18T09:00:00+07:00')

  it('ลิงก์สถานีตอนเปิดหน้าครั้งแรกแสดงคิวสถานีของฝ่ายผลิต', () => {
    vi.mocked(useFactoryData).mockReturnValue({
      state: {
        status: 'ready', loadedAt: now,
        data: { vendors: [], jobs: [job('waiting', { queue: 1 })], machines: [], bookings: [], needs: {}, shared: [], products: [] },
      },
      live: true, refresh: async () => {},
    })
    vi.stubGlobal('window', { location: { hash: '#/board?station=cut' }, history: { replaceState: vi.fn() } })
    vi.stubGlobal('localStorage', { setItem: vi.fn() })
    try {
      const html = renderToStaticMarkup(createElement(Dashboard, {
        view: 'board', today: '18 พ.ย.', role: 'production', scope: boardScope('production', null),
      }))
      expect(html.includes('คิวรอเริ่ม'), 'ลิงก์ต้องเปิดคิวตัดทันที').toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ข้อความรายการต้องทำระบุว่าเรียงตามคิว', () => {
    const jobs = [job('first', { queue: 1 }), job('urgent', { queue: 2, status: 'hold' })]
    const html = renderToStaticMarkup(createElement(TodoPanel, { jobs, now, onOpen: () => {} }))
    expect(html.indexOf('SC-first')).toBeLessThan(html.indexOf('SC-urgent'))
    expect(html.includes('เรียงด่วนสุดก่อน'), 'หัวรายการต้องไม่ขัดกับเลขคิวที่แสดง').toBe(false)
  })
})

describe('การ์ดคิวสถานี', () => {
  const now = new Date('2026-11-18T09:00:00+07:00')
  const render = (station: Job['station'], jobs: Job[], role: 'production' | 'admin' = 'production') =>
    renderToStaticMarkup(createElement(StationQueue, { station: station!, jobs, role, now, call: async () => ({ ok: true as const }), onOpen: () => {} }))

  it('งานกำลังทำมีปุ่ม เสร็จ และ พักงาน บนการ์ด', () => {
    const html = render('cut', [job('d', { status: 'doing', queue: 1 })])
    expect(html).toContain('ตัดงานเสร็จ')
    expect(html).toContain('>พักงาน<')
  })

  it('QC + Packing เว้นวรรคก่อนคำไทย (งานตัวอย่าง · คิวว่าง)', () => {
    const html = render('qc_pack', [job('s', { station: 'qc_pack', status: 'doing', phase: 'sample', queue: 1 })])
    expect(html).toContain('QC + Packing เสร็จ')
    expect(html).toContain('ไม่มีงานรอที่ QC + Packing')
    expect(html).not.toMatch(/Packingเสร็จ|ที่QC/)
  })

  it('แอดมินดูอย่างเดียว ไม่มีปุ่มพักงาน', () => {
    const html = render('cut', [job('d', { status: 'doing', queue: 1 })], 'admin')
    expect(html).not.toContain('>พักงาน<')
  })
})
