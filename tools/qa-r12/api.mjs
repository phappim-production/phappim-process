import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stations as baseStations } from '../qa-r9/api.mjs'

export const origin = 'http://127.0.0.1:5200'
export const dist = fileURLToPath(new URL('../../app/dist/', import.meta.url))
const id = number => '92000000-0000-0000-0000-' + String(number).padStart(12, '0')
export const roles = {
  admin: ['admin'], owner: ['owner'], manager: ['manager'], production: ['production'],
  phase1: ['supervisor', 1], phase2: ['supervisor', 2], qc: ['qc'],
  outside: ['staff', null, 'outside'], multi: ['staff', null, 'print', 'press', 'cut'],
  staffQc: ['staff', null, 'qc_pack'], unassigned: ['staff'],
}
export const users = Object.fromEntries(Object.keys(roles).map((key, index) => [key, {
  id: id(index + 100), email: key + '@r12.invalid', app_metadata: {}, user_metadata: {},
}]))
export const jobIds = { waiting: id(1), sent: id(2), done: id(3), internal: id(4) }
export const vendorName = 'โรงงานนอกจำลอง A'
const stations = [...baseStations, {
  code: 'outside', name: 'สั่งผลิตข้างนอก', sort: 5, section: 1, machines: null, machine_pool: null, substeps: [], sla_days: null,
}].map(station => ({ ...station, warn_pct: 80 }))
const routes = {
  outside: ['ผลิตข้างนอกทั้งหมด', ['outside', 'qc_pack']],
  cut_only: ['ตัดงานลูกค้า', ['cut', 'qc_pack']],
}
const products = [
  { code: 'tshirt', name: 'เสื้อยืด', unit: 'ตัว', sort: 1 },
  { code: 'hat', name: 'หมวก', unit: 'ใบ', sort: 2 },
  { code: 'pillow', name: 'หมอน', unit: 'ใบ', sort: 3 },
].map(product => ({ ...product, category: 'งานจำลอง', active: true }))
const contents = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2' }
const time = (minutes = 0) => new Date(Date.now() + minutes * 60_000).toISOString()

function job(key, state = {}) {
  return {
    id: jobIds[key], confirmation_no: 'TEST-R12-' + key.toUpperCase(), customer_name: 'ลูกค้าจำลองรอบ 12',
    job_name: 'หมวกจำลอง', product_type_code: 'hat', route_code: 'outside', qty: 10, unit: 'ใบ',
    due_date: '2099-01-15', current_station: 'outside', station_status: 'queued', phase: 'production',
    created_at: time(-4320), stage_entered_at: time(-45), queue_seq: Object.keys(jobIds).indexOf(key) * 1024 + 1024,
    visit: 1, sample_round: 1, qc_passed: 0, needs_sample: false, spec: {}, confirmation_rev: 0, ...state,
  }
}

function filterRows(rows, search) {
  return rows.filter(row => [...search].every(([key, query]) => {
    const value = String(row[key])
    if (query.startsWith('eq.')) return value === query.slice(3)
    if (query.startsWith('in.(')) return query.slice(4, -1).split(',').includes(value)
    if (query === 'is.null') return row[key] == null
    if (query.startsWith('gte.')) return row[key] != null && value >= query.slice(4)
    if (query.startsWith('lt.')) return row[key] != null && value < query.slice(3)
    return true
  }))
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}
}

export function fixtureApi() {
  let jobs, runs, calls, vendors
  const people = Object.entries(users).map(([key, user]) => ({
    user_id: user.id, name: 'ผู้ใช้จำลอง ' + key, email: user.email,
    role: roles[key][0], section: roles[key][1] ?? null, active: true,
  }))
  function reset(scenario = 'standard') {
    jobs = [job('waiting'), job('sent', { station_status: 'out' }),
      job('done', { phase: 'done', current_station: null, station_status: null, finished_at: time(-5), qc_passed: 10 })]
    if (scenario === 'mixed') jobs.push(job('internal', {
      phase: 'done', route_code: 'cut_only', current_station: null, station_status: null, finished_at: time(-5), qc_passed: 10,
    }))
    vendors = [
      { id: 1, name: vendorName, stations: ['outside'], kind: 'outsource', active: true },
      { id: 2, name: 'บริษัทตัดจำลอง', stations: ['cut'], kind: 'outsource', active: true },
      { id: 3, name: 'บริษัทปิดจำลอง', stations: ['outside'], kind: 'outsource', active: false },
    ]
    runs = [{ id: 1, job_id: jobIds.sent, vendor_id: 1, stations: ['outside'], qty: 10, is_rework: false,
      sent_at: time(-60), arrive_at: time(-10), lead_days: 7, back_at: time(10080), closed_at: null }]
    calls = []
  }
  reset()

  async function handle(req, res) {
    const url = new URL(req.url, origin)
    const roleKey = req.headers.authorization?.split('.').at(-1)
    const user = users[roleKey]
    const [role] = roles[roleKey] ?? []
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    if (url.pathname === '/favicon.ico') return res.writeHead(204).end()
    if (url.pathname === '/auth/v1/user') return json(user ?? null, user ? 200 : 401)
    if (url.pathname.startsWith('/rest/v1/')) {
      if (!user) return json({ message: 'ใช้บัญชีจำลอง' }, 401)
      const endpoint = url.pathname.slice('/rest/v1/'.length)
      if (endpoint.startsWith('rpc/')) {
        const fn = endpoint.slice(4)
        const args = await body(req)
        calls.push({ fn, args, roleKey })
        const run = runs.find(item => item.id === args.p_run && item.closed_at === null)
        const current = jobs.find(item => item.id === (args.p_job ?? run?.job_id))
        switch (fn) {
          case 'job_sla_flags': return json([])
          case 'inbox_scan': case 'inbox_unread_count': return json(0)
          case 'staff_names': case 'owner_list_users': return json(people)
          case 'receive_job': {
            const newId = id(20 + jobs.length)
            jobs.push(job('waiting', { id: newId, confirmation_no: args.p_confirmation_no,
              customer_name: args.p_customer_name, job_name: args.p_job_name, product_type_code: args.p_product_type_code,
              route_code: args.p_route_code, qty: args.p_qty, unit: args.p_unit, due_date: args.p_due_date,
              queue_seq: 9000 + jobs.length }))
            return json(newId)
          }
          case 'send_out': {
            if (!['admin', 'owner'].includes(role) || !current || current.station_status !== 'queued' ||
                args.p_last_station !== 'outside') return json({ message: 'ส่งออกไม่ได้' }, 400)
            const newRun = runs.length + 1
            runs.push({ id: newRun, job_id: current.id, vendor_id: args.p_vendor, stations: ['outside'], qty: current.qty,
              is_rework: false, sent_at: time(), arrive_at: args.p_arrive_at, lead_days: args.p_lead_days, back_at: args.p_back_at, closed_at: null })
            current.station_status = 'out'
            return json(newRun)
          }
          case 'receive_back':
            if (!['admin', 'owner'].includes(role) || !current) return json({ message: 'รับกลับไม่ได้' }, 400)
            Object.assign(current, { current_station: 'qc_pack', station_status: 'queued', visit: current.visit + 1 })
            run.closed_at = time()
            return json(null)
          default: return json({ message: 'ไม่มี RPC จำลอง ' + fn }, 404)
        }
      }
      const visits = [
        [jobIds.done, 'qc_pack', 2, -35, -5],
        [jobIds.internal, 'cut', 1, -100, -90], [jobIds.internal, 'qc_pack', 2, -45, -5],
      ].map(([job_id, station_code, visit, start, end]) =>
        ({ job_id, station_code, visit, started_at: time(start), done_at: time(end), rework: false, phase: 'production' }))
      const data = {
        profiles: people,
        staff_stations: Object.entries(roles).flatMap(([key, [, , ...links]]) => links.map(station_code => ({ station_code, user_id: users[key].id }))),
        stations, jobs, job_live: jobs, vendors, outsource_runs: runs, station_visits: visits,
        routes: Object.entries(routes).map(([code, [name]]) => ({ code, name })),
        route_stations: Object.entries(routes).flatMap(([route_code, [, path]]) =>
          path.map((station_code, index) => ({ route_code, station_code, seq: index + 1 }))),
        machine_types: [{ code: 'single', name: 'เข็มเดี่ยว', shared: false }],
        product_machine_needs: [{ product_type_code: 'tshirt', type_code: 'single', qty: 1 }],
        product_types: products,
      }
      const found = filterRows(data[endpoint] ?? [], url.searchParams)
      if (req.method === 'HEAD') {
        res.setHeader('Content-Range', found.length ? '0-' + (found.length - 1) + '/' + found.length : '*/0')
        return res.writeHead(200).end()
      }
      return json(req.headers.accept?.includes('vnd.pgrst.object') ? found[0] ?? null : found)
    }
    const file = resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : url.pathname))
    if (!file.startsWith(resolve(dist) + sep)) return res.writeHead(404).end()
    try {
      const bytes = await readFile(file)
      return res.writeHead(200, { 'Content-Type': contents[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(bytes)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return res.writeHead(404).end()
    }
  }
  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      console.error(error)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  return { server, reset, get calls() { return calls }, get jobs() { return jobs } }
}
