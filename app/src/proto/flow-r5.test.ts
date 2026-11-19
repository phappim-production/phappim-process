import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { attachOutRuns, toJobs, toVendors, type JobRow, type OutRunRow } from '../data/live'
import { StationQueue } from '../pages/StationQueue'
import { OutsourcePanel } from '../pages/OutsourcePanel'
import type { EmployeeRole } from '../auth/access'
import { todoList } from './actions'
import { simulate, workdaysUntil } from './capacity'
import { columnOf, queueNo, stationCounts, waitingAt, type Job, type StationCode } from './model'

const now = new Date(2026, 10, 18, 9)
const stamp = '2026-11-18T02:00:00Z'
const due = '2026-12-31'
const base: Omit<JobRow, 'id' | 'confirmation_no'> = {
  customer_name: 'ลูกค้าจำลอง', job_name: 'งานจำลอง', product_type_code: 'tshirt',
  qty: 10, unit: 'ตัว', due_date: due, route_code: 'cut_only', phase: 'production',
  current_station: 'cut', station_status: 'queued', stage_entered_at: stamp, sample_round: 1,
  needs_sample: false, materials_waiting_depts: null, dtf_film_eta: null, dtf_film_received_at: null,
  sew_count: 0, is_rework: false, rework_qty: null, hold_reason: null, finished_at: null,
}
const states = {
  A: {}, B: {}, C: { current_station: 'qc_pack', station_status: 'doing' },
  D: { station_status: 'hold', hold_reason: 'รอผ้า' },
  E: { phase: 'sample_review', current_station: null, station_status: null, needs_sample: true },
  F: { route_code: 'normal', current_station: 'print', station_status: 'out' },
  G: { route_code: 'normal', current_station: 'press', station_status: 'out' },
  H: { route_code: 'plain', current_station: 'sew', is_rework: true, rework_qty: 3 },
  I: { route_code: 'plain', station_status: 'out', is_rework: true, rework_qty: 3 },
  J: { route_code: 'dtf', current_station: 'dtf_press', dtf_film_eta: '2026-11-20' },
  K: { route_code: 'plain', current_station: 'sew', station_status: 'doing' },
  L: { route_code: 'plain', current_station: 'sew', station_status: 'hold', hold_reason: 'จักรเสีย' },
  M: { station_status: 'doing', stage_entered_at: '2026-11-03T02:00:00Z' },
  N: { phase: 'done', current_station: null, station_status: null, finished_at: stamp },
  O: { phase: 'cancelled', current_station: null, station_status: null },
  P: { qty: 4, confirmation_no: 'TEST-R5-MATRIX-P-2' },
} satisfies Record<string, Partial<JobRow>>
type State = keyof typeof states
const row = (id: State, overrides: Partial<JobRow> = {}): JobRow => ({
  ...base, id, confirmation_no: 'TEST-R5-MATRIX-' + id, queue_seq: id.charCodeAt(0), ...states[id], ...overrides,
})
const vendors = toVendors([
  { id: 1, name: 'บริษัทจำลอง A', stations: ['print', 'press', 'cut'] },
  { id: 2, name: 'บริษัทจำลอง B', stations: ['sew'] },
])
const run = (id: State, stations: StationCode[], overrides: Partial<OutRunRow> = {}): OutRunRow => ({
  id: id.charCodeAt(0), job_id: id, vendor_id: 1, stations, qty: 10, is_rework: false,
  sent_at: stamp, arrive_at: stamp, lead_days: 2, back_at: '2026-11-20T10:00:00Z', note: null, ...overrides,
})
const outRuns = [run('F', ['print']), run('G', ['press', 'cut'], { vendor_id: 2 }), run('I', ['cut'], { qty: 3, is_rework: true })]
const jobs = attachOutRuns(toJobs((Object.keys(states) as State[]).map(id => row(id)), [], [], []), outRuns, vendors)
const get = (id: State) => {
  const job = jobs.find(j => j.id === id)
  if (!job) throw new Error('ไม่พบ fixture ' + id)
  return job
}
const roles: EmployeeRole[] = ['owner', 'admin', 'production', 'qc', 'manager']
const queueView = (station: StationCode, role: EmployeeRole, list = jobs) => renderToStaticMarkup(createElement(StationQueue, {
  station, role, jobs: list, now, call: async () => ({ ok: true as const }), onOpen: () => {},
}))
const outsourceView = (job: Job, role: EmployeeRole) => renderToStaticMarkup(createElement(OutsourcePanel, {
  job, vendors, now, admin: role === 'admin' || role === 'owner', refresh: async () => {},
}))
const section = (html: string, label: string) =>
  html.match(new RegExp('<section aria-labelledby="' + label + '"[^>]*>(.*?)</section>', 's'))?.[1] ?? ''
const card = (html: string, job: Job) =>
  html.match(/<article\b[^>]*>.*?<\/article>/gs)?.find(part => part.includes('ดูรายละเอียดงาน ' + job.no + '"')) ?? ''

describe('R5 สถานะงานจาก job_live', () => {
  it('คอลัมน์ คิว และจำนวนงานที่สถานีตรงกับข้อมูล A–P', () => {
    expect(jobs.map(j => [j.id, columnOf(j)])).toEqual([
      ['A', 'cut'], ['B', 'cut'], ['C', 'qc_pack'], ['D', 'cut'], ['E', 'sample_review'],
      ['F', 'print'], ['G', 'press'], ['H', 'sew'], ['I', 'cut'], ['J', 'dtf_press'],
      ['K', 'sew'], ['L', 'sew'], ['M', 'cut'], ['N', 'done'], ['P', 'cut'],
    ])
    expect(waitingAt(jobs, 'cut').map(j => j.id)).toEqual(['A', 'B', 'P'])
    expect(waitingAt(jobs, 'sew').map(j => j.id)).toEqual(['H'])
    expect(waitingAt(jobs, 'dtf_press').map(j => j.id)).toEqual(['J'])
    expect(jobs.map(j => queueNo(j, jobs) ?? null)).toEqual([1, 2, null, null, null, null, null, 1, null, 1, null, null, null, null, 3])
    const counts = Object.fromEntries(stationCounts(jobs, now).map(r => [r.key, [r.waiting, r.doing, r.hold, r.out]]))
    expect(counts).toEqual({
      cut: [3, 1, 1, 1], print: [0, 0, 0, 1], press: [0, 0, 0, 1], emb: [0, 0, 0, 0],
      sew: [1, 1, 1, 0], dtf_press: [1, 0, 0, 0], qc_pack: [0, 1, 0, 0],
    })
  })

  it('รายการต้องทำรักษาคิว และแสดงการรอผล รอฟิล์ม งานพัก และงานที่แบ่ง', () => {
    const actions = todoList([...jobs].reverse(), now)
    expect(actions.map(a => a.job.id)).toEqual('ABCDEFGHIJKLMP'.split(''))
    const text = (id: State) => actions.find(a => a.job.id === id)?.text
    expect(text('E')).toContain('บันทึกผลตัวอย่าง')
    expect(text('D')).toContain('รอผ้า')
    expect(text('J')).toContain('รอฟิล์ม DTF')
    expect(text('L')).toContain('จักรเสีย')
    expect(actions.find(a => a.job.id === 'P')?.job.qty).toBe(4)
  })

  it('คาดวันเสร็จได้ทุกงานเปิดโดยเคารพวันรับงานข้างนอกของ F/G/I', () => {
    const result = simulate(jobs, now)
    for (const job of jobs) {
      const finish = result.finishDay.get(job.id)
      if (job.phase === 'done') expect(finish).toBeUndefined()
      else expect(typeof finish === 'number' && Number.isFinite(finish) && finish >= 0, job.id).toBe(true)
      if (job.out) expect(finish).toBeGreaterThanOrEqual(workdaysUntil(job.out.backAt, now))
    }
    expect(result.finishDay.has('O')).toBe(false)
    const repaired = simulate([get('I')], now)
    expect(repaired.load.cut.jobs).toBe(0)
    expect(repaired.load.sew.jobs).toBe(0)
    expect(repaired.load.qc_pack.qty).toBe(3)
  })

  it.each(['F', 'G', 'I'] as const)('รายการต้องทำของ %s ต้องบอกว่ารอรับของจากบริษัทภายนอก', id => {
    const action = todoList([get(id)], now)[0]
    expect(action?.text).toMatch(/ข้างนอก|บริษัท|รับ.*กลับ/)
  })

  it('งานแก้ในโรงงานคิดเฉพาะสถานีต้นเหตุและ QC ตามจำนวนที่ส่งกลับ', () => {
    const repair = { ...get('H'), station: 'cut' as const }
    const { load } = simulate([repair], now)
    expect([load.cut.qty, load.sew.qty, load.qc_pack.qty]).toEqual([3, 0, 3])
  })

  it('งานตัดข้างนอกที่กลับมารีด DTF ต้องรอวันคาดว่าได้รับฟิล์ม', () => {
    const pending = row('J', { current_station: 'cut', station_status: 'out', dtf_film_eta: '2026-11-27' })
    const [job] = attachOutRuns(toJobs([pending], [], [], []), [run('J', ['cut'])], vendors)
    const finish = simulate([job], now).finishDay.get(job.id)
    expect(finish).toBeGreaterThan(workdaysUntil(job.film!.eta, now))
  })
})

describe('R5 ปุ่มตามสถานะและบทบาท', () => {
  it.each(roles)('StationQueue จัดส่วนและแสดงปุ่มสำหรับ %s', role => {
    const cut = queueView('cut', role)
    const sew = queueView('sew', role)
    const press = queueView('press', role)
    const print = queueView('print', role)
    const film = queueView('dtf_press', role)
    const qc = queueView('qc_pack', role)
    const floor = role === 'owner' || role === 'production'
    const rush = floor || role === 'manager'
    expect(card(section(cut, 'q-waiting'), get('A'))).toContain('คิว 1')
    expect(card(section(cut, 'q-waiting'), get('B'))).toContain('คิว 2')
    expect(card(section(cut, 'q-waiting'), get('P'))).toContain(get('P').no)
    expect(card(section(cut, 'q-working'), get('D'))).toContain('พักงาน')
    expect(card(section(cut, 'q-working'), get('M'))).toContain('กำลังทำ')
    expect(card(section(sew, 'q-waiting'), get('H'))).toContain('งานแก้')
    expect(card(section(sew, 'q-working'), get('K'))).toContain('กำลังทำ')
    expect(card(section(sew, 'q-working'), get('L'))).toContain('จักรเสีย')
    for (const [html, id] of [[print, 'F'], [press, 'G'], [cut, 'G'], [cut, 'I']] as const) {
      const outside = card(section(html, 'q-outside'), get(id))
      expect(outside).toContain('ข้างนอก')
      expect(outside).not.toMatch(/เริ่มก่อนคิว|แทรกเป็นคิวแรก|ทำต่อ|เย็บต่อ/)
      expect(card(section(html, 'q-waiting'), get(id))).toBe('')
      expect(card(section(html, 'q-working'), get(id))).toBe('')
    }
    expect(card(cut, get('A')).includes('เริ่มตัดงาน')).toBe(floor)
    expect(card(cut, get('B')).includes('เริ่มก่อนคิว')).toBe(floor)
    expect(card(cut, get('B')).includes('แทรกเป็นคิวแรก')).toBe(rush)
    expect(card(sew, get('L')).includes('แก้แล้ว เย็บต่อ</button>')).toBe(floor)
    // ปิดปัญหา: ฝ่ายผลิต / ผู้บริหาร / เจ้าของ · แอดมินกับ QC เห็นว่าต้องรอใคร
    expect(card(cut, get('D')).includes('แก้แล้ว ทำต่อ</button>')).toBe(rush)
    expect(card(cut, get('D')).includes('รอผู้บริหารหรือฝ่ายผลิตกด')).toBe(!rush)
    expect(card(sew, get('L')).includes('รอฝ่ายผลิตกด')).toBe(!floor)
    expect(card(qc, get('C')).includes('บันทึกผล QC / Packing')).toBe(floor || role === 'qc')
    expect(card(film, get('J'))).not.toContain('เริ่มรีดฟิล์ม')
    expect(card(film, get('J')).includes('ยังไม่ได้รับฟิล์ม DTF')).toBe(floor)
    for (const id of ['E', 'N'] as const) expect(card(cut + sew + qc, get(id))).toBe('')
    expect(cut + sew + qc).not.toContain(row('O').confirmation_no)
  })

  it.each(roles)('OutsourcePanel แสดงปุ่มสำหรับ %s ครบสถานะ', role => {
    const admin = role === 'owner' || role === 'admin'
    for (const job of jobs) {
      const html = outsourceView(job, role)
      expect(/>ส่งออกบริษัทภายนอก<\/button>/.test(html), job.id).toBe(admin && ['A', 'B', 'H', 'P'].includes(job.id))
      expect(html.includes('แบ่งจำนวน (ส่งออกบางส่วน)'), job.id).toBe(admin && ['A', 'B', 'J', 'P'].includes(job.id))
      expect(html.includes('ของถึงโรงงานแล้ว · รับเข้า'), job.id).toBe(admin && ['F', 'G', 'I'].includes(job.id))
      expect(html.includes('แก้กำหนด'), job.id).toBe(admin && ['F', 'G', 'I'].includes(job.id))
      expect(html.includes('ส่งต่อบริษัทอื่น ('), job.id).toBe(admin && ['F', 'G'].includes(job.id))
      if (job.out) expect(html).toContain(job.out.vendor)
    }
  })
})
