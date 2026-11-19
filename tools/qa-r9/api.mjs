import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const origin = 'http://127.0.0.1:5199'
export const dist = fileURLToPath(new URL('../../app/dist/', import.meta.url))
export const id = n => '90000000-0000-0000-0000-' + String(n).padStart(12, '0')
export const roles = ['owner', 'admin', 'manager', 'production', 'supervisor', 'qc', 'staff']
export const stations = [
  ['print', 'พิมพ์งาน', 2, 'print'], ['press', 'รีดงาน', 1, 'heat_press'], ['cut', 'ตัดงาน', 2, 'cut'],
  ['dtf_press', 'รีดฟิล์ม', 2, 'dtf_press'], ['emb', 'ปักงาน', null, null], ['sew', 'เย็บงาน', null, null],
  ['qc_pack', 'QC + Packing', 1, 'qc_pack'],
].map(([code, name, machines, machine_pool], sort) => ({
  code, name, machines, machine_pool, sort, section: sort < 5 ? 1 : 2, substeps: [], sla_days: 1,
}))
const routes = {
  print_emb: ['print', 'press', 'cut', 'emb', 'sew', 'qc_pack'],
  normal: ['print', 'press', 'cut', 'sew', 'qc_pack'],
  dtf: ['cut', 'dtf_press', 'sew', 'qc_pack'],
}
const routesData = Object.keys(routes).map((code, i) => ({ code, name: ['พิมพ์และปัก', 'พิมพ์ทั้งตัว', 'DTF'][i] }))
const time = new Date().toISOString()
function job(n, no, station, status, route = 'normal', phase = 'production') {
  return {
    id: id(n), confirmation_no: 'TEST-R9-' + no, current_station: station, station_status: status, route_code: route,
    phase, customer_name: 'ลูกค้าจำลองรอบ 9', job_name: 'เสื้อจำลองทดสอบ', product_type_code: 'tshirt',
    qty: 10, unit: 'ตัว', due_date: '2099-01-06', stage_entered_at: time, station_started_at: time, created_at: time,
    needs_sample: phase === 'sample', sample_round: 1, queue_seq: n * 1024, visit: 1,
    qc_passed: 0, sew_count: 0, hold_reason: 'ตรวจอุปกรณ์', dtf_film_received_at: time, mockup_path: null,
  }
}

export const sewId = id(30)
export const labelId = id(1)
const initialJobs = [
  job(1, 'LABEL', 'print', 'queued', 'print_emb'),
  job(2, 'PRINT-A', 'print', 'doing', 'normal', 'sample'),
  job(3, 'PRINT-B', 'print', 'doing'),
  job(4, 'PRINT-HOLD', 'print', 'hold'),
  job(5, 'PRINT-OUT', 'print', 'out'),
  job(6, 'PRESS', 'press', 'queued'),
  job(7, 'CUT', 'cut', 'queued'),
  job(8, 'FILM-A', 'dtf_press', 'doing', 'dtf'),
  job(9, 'FILM-B', 'dtf_press', 'doing', 'dtf'),
  job(10, 'FILM-Q', 'dtf_press', 'queued', 'dtf'),
  job(11, 'EMB', 'emb', 'queued', 'print_emb'),
  job(12, 'QC', 'qc_pack', 'queued'),
  job(30, 'SEW', 'sew', 'queued'),
  job(31, 'SEW-OTHER', 'sew', 'doing'),
]
const sewing = [
  ['SN-001', 'single', 'ready'], ['SN-002', 'single', 'ready'], ['SN-003', 'single', 'ready'],
  ['SN-004', 'single', 'broken'], ['SN-005', 'single', 'ready'], ['SN-006', 'single', 'ready'],
  ['OL4-001', 'ovl4', 'ready'],
].map(([code, type_code, status], i) => ({ id: i + 1, code, type_code, status, sort: i + 1 }))
const files = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.woff2': 'font/woff2',
}

export function fixtureApi() {
  const rpcCalls = []
  let jobs, assignments
  function reset() {
    jobs = structuredClone(initialJobs)
    assignments = [{ machine_id: 5, job_id: id(31) }]
    rpcCalls.length = 0
  }
  reset()
  const user = { id: id(900), email: 'fixture@example.test', app_metadata: {}, user_metadata: {} }
  async function handle(req, res) {
    const url = new URL(req.url, origin)
    const path = url.pathname
    const role = req.headers.authorization?.split('.').at(-1)
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    if (path === '/favicon.ico') return res.writeHead(204).end()
    if (path === '/auth/v1/user') return json(user)
    if (path.startsWith('/rest/v1/')) {
      if (!roles.includes(role)) return json({ message: 'ต้องเข้าด้วยบัญชีจำลอง' }, 401)
      const table = path.slice('/rest/v1/'.length)
      const profile = { user_id: user.id, name: 'ผู้ใช้จำลอง', role, section: null, active: true }
      const data = {
        profiles: [profile], stations, jobs, job_live: jobs, routes: routesData,
        route_stations: Object.entries(routes).flatMap(([route_code, steps]) =>
          steps.map((station_code, i) => ({ route_code, station_code, seq: i + 1 }))),
        product_types: [{ code: 'tshirt', name: 'เสื้อยืด', unit: 'ตัว', category: 'เสื้อผ้า' }],
        machine_types: [{ code: 'single', name: 'เข็มเดี่ยว', shared: false }, { code: 'ovl4', name: 'โพ้ง 4 เส้น', shared: true }],
        sewing_machines: sewing, machine_assignments: assignments,
        machine_bookings: [{ id: 1, machine_id: 6, job_id: id(31), starts_at: time, ends_at: new Date(Date.now() + 3_600_000).toISOString() }],
        product_machine_needs: [{ product_type_code: 'tshirt', type_code: 'single', qty: 1 }, { product_type_code: 'tshirt', type_code: 'ovl4', qty: 1 }],
        vendors: [{ id: 1, name: 'โรงงานจำลอง', stations: ['print'], active: true }],
        outsource_runs: [{ id: 1, vendor_id: 1, job_id: id(5), stations: ['print'], qty: 10,
          sent_at: time, arrive_at: time, lead_days: 2, back_at: new Date(Date.now() + 172_800_000).toISOString() }],
        staff_stations: role === 'staff' ? [{ user_id: user.id, station_code: 'print' }] : [],
        events: jobs.map((j, i) => ({ id: i + 1, type: 'received', job_id: j.id, phase: j.phase, at: time, payload: {} })),
      }
      if (table === 'rpc/owner_list_users') return json([{ ...profile, id: user.id, email: user.email }])
      if (table === 'rpc/job_sla_flags') return json([])
      if (table === 'rpc/inbox_scan') return json(0)
      if (table === 'rpc/staff_names') return json([{ user_id: user.id, name: profile.name }])
      if (table.startsWith('rpc/')) {
        const parts = []
        for await (const chunk of req) parts.push(chunk)
        const args = JSON.parse(Buffer.concat(parts).toString() || '{}')
        const name = table.slice(4)
        rpcCalls.push({ name, args, role })
        const selected = args.p_codes ?? args.p_machine_codes
        if (name === 'start_sewing' || name === 'assign_machines') {
          for (const code of selected) assignments.push({ machine_id: sewing.find(m => m.code === code).id, job_id: args.p_job })
          if (name === 'start_sewing') {
            jobs.find(j => j.id === args.p_job).station_status = 'doing'
            return json(selected)
          }
          return json(null)
        }
        if (name === 'release_machines') {
          assignments = assignments.filter(a => a.job_id !== args.p_job || !selected.includes(sewing.find(m => m.id === a.machine_id).code))
          return json(null)
        }
        return json({ message: 'ไม่มี RPC จำลองชื่อนี้' }, 404)
      }
      const rows = (data[table] ?? []).filter(row => [...url.searchParams].every(([key, filter]) => {
        if (filter.startsWith('eq.')) return String(row[key]) === filter.slice(3)
        if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(row[key]))
        if (filter === 'is.null') return row[key] == null
        return true
      }))
      if (req.method === 'HEAD') {
        res.setHeader('Content-Range', rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '*/0')
        return res.writeHead(200).end()
      }
      return json(req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows)
    }
    const file = resolve(dist, path === '/' ? 'index.html' : '.' + path)
    if (!file.startsWith(resolve(dist) + sep)) return res.writeHead(404).end()
    try {
      const bytes = await readFile(file)
      res.writeHead(200, { 'Content-Type': files[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(bytes)
    } catch {
      res.writeHead(404).end()
    }
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch(error => {
      console.error(error.message)
      res.writeHead(500).end()
    })
  })
  return { server, rpcCalls, reset, user }
}
