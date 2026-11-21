import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stations as baseStations } from '../qa-r9/api.mjs'

export const origin = 'http://127.0.0.1:5199'
export const dist = fileURLToPath(new URL('../../app/dist/', import.meta.url))
const id = n => '91000000-0000-0000-0000-' + String(n).padStart(12, '0')
export const roles = {
  owner: ['owner'], manager: ['manager'], admin: ['admin'], production: ['production'],
  multi: ['staff', 'print', 'press', 'cut'], cut: ['staff', 'cut'], unassigned: ['staff'],
  staffQc: ['staff', 'qc_pack'], qc: ['qc'], phase1: ['supervisor'], phase2: ['supervisor'],
}
export const users = Object.fromEntries(Object.keys(roles).map((key, i) => [key, {
  id: id(i + 100), email: key + '@r13.invalid', app_metadata: {}, user_metadata: {},
}]))
const stations = baseStations.map(s => ({ ...s, warn_pct: 80, big_qty: null, big_sla_days: null }))
const pathCodes = ['print', 'press', 'cut', 'sew', 'qc_pack']
const now = new Date().toISOString()
const no = 'TEST-R13-WEB'
export const markup = '<script type="application/json">r13</script><img data-r13-marker="input">'
export const deliveryJob = id(1)
export const mockupJob = id(2)
export const formJob = id(3)
const imagePath = no + '/main.png'
const shirt = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e9edf2"/><path d="M330 105L245 125L158 231L232 283L273 239V522H527V239L568 283L642 231L555 125L470 105Q400 182 330 105Z" fill="#326390" stroke="#21344c" stroke-width="6"/><rect x="430" y="238" width="52" height="30" rx="5" fill="#dfefff"/></svg>'
const contents = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
}
const makeJob = (jobId, number, phase, spec = {}) => ({
  id: jobId, confirmation_no: number, customer_name: 'ลูกค้าจำลองรอบ 11', job_name: 'เสื้อทดสอบ',
  product_type_code: 'tshirt', route_code: 'normal', qty: 10, unit: 'ตัว', due_date: '2099-01-06',
  current_station: phase === 'done' ? null : 'print', station_status: phase === 'done' ? null : 'queued',
  phase, created_at: now, stage_entered_at: now, finished_at: phase === 'done' ? now : null,
  queue_seq: jobId === deliveryJob ? 1024 : 2048, visit: 1, sample_round: 1, qc_passed: 0,
  delivered_at: null, delivered_by: null, delivery_note: null, confirmation_rev: 0,
  spec, mockup_path: jobId === mockupJob ? imagePath : null,
})
const makeSheet = (job, status = 'draft', rev = 1) => ({
  id: id(20 + rev), job_id: job, rev, status, version: 1, created_at: now, updated_at: now,
  created_by: users.admin.id, updated_by: users.admin.id, confirmation_rev: 0,
  approved_at: status === 'approved' ? now : null, approved_by: status === 'approved' ? users.admin.id : null,
})
const makeDraft = (sheet, path) => ({
  views: [{ id: id(31), sheet_id: sheet.id, view: 'front', image_path: path, width: 800, height: 600 }],
  specs: [{ id: id(32), sheet_id: sheet.id, key: id(32), code: 'S-01', name: 'รายละเอียดงาน', kind: 'print', unit: 'cm', width: 8, height: 6, detail: 'รายละเอียด'.repeat(45), stations: ['print'] }],
  callouts: [
    { id: id(33), sheet_id: sheet.id, view_id: id(31), no: 1, x: 0.55, y: 0.4, box_x: 0.77, box_y: 0.25,
      title: 'จุดหน้าอก', ref_value: 'DTF · 8x8 ซม.', body: 'ตัวอย่างตำแหน่ง', spec_id: id(32), spec_ref: 'placement:หน้าอกซ้าย', stations: ['print'] },
    { id: id(34), sheet_id: sheet.id, view_id: id(31), no: 2, x: 0.52, y: 0.6, box_x: 0.7, box_y: 0.66,
      title: 'จุดตรวจ', body: 'รายละเอียด'.repeat(45), stations: ['qc_pack'] },
  ],
})
async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}
function filterRows(rows, search) {
  return rows.filter(row => [...search].every(([key, expr]) => {
    if (expr.startsWith('eq.')) return String(row[key]) === expr.slice(3)
    if (expr.startsWith('in.(')) return expr.slice(4, -1).split(',').includes(String(row[key]))
    if (expr === 'is.null') return row[key] == null
    return true
  }))
}

export function fixtureApi() {
  let jobs, sheets, draft, confirmation, events, acks, calls, scenarioName, latency, missingLabelChunk, failedTables
  let workerRevision = 0
  function reset(scenario = 'empty', jobCount = 200) {
    scenarioName = scenario
    latency = 0
    missingLabelChunk = null
    failedTables = []
    const spec = { product: 'tshirt', p: { tshirt: { placements: { หน้าอกซ้าย: { on: true, tech: 'DTF', size: '8x8 ซม.' } } } } }
    jobs = scenario === 'delivery' ? [makeJob(deliveryJob, no + '-SEND', 'done')]
      : ['draft', 'approved', 'blocked', 'markup'].includes(scenario) ? [makeJob(mockupJob, no, 'production', spec)] : []
    sheets = jobs[0]?.id === mockupJob ? [makeSheet(mockupJob, ['approved', 'markup'].includes(scenario) ? 'approved' : 'draft')] : []
    draft = sheets.length ? makeDraft(sheets[0], imagePath) : { views: [], specs: [], callouts: [] }
    if (scenario === 'blocked') {
      draft.callouts[0] = { ...draft.callouts[0], body: '', spec_ref: null, spec_id: null }
    }
    if (scenario === 'bare') jobs = [{ ...makeJob(mockupJob, no, 'production'), mockup_path: null }]
    if (scenario === 'loaded') jobs = Array.from({ length: jobCount }, (_, i) => ({
      ...makeJob(id(200 + i), 'TEST-R13-LOAD-' + String(i + 1).padStart(3, '0'), i < jobCount / 2 ? 'production' : 'done'),
      queue_seq: (i + 1) * 1024, needs_sample: false,
    }))
    events = scenario === 'loaded' ? Array.from({ length: jobCount * 25 }, (_, i) => ({
      id: i + 1, job_id: jobs[i % jobs.length].id, type: 'received', phase: 'production', at: now, by: users.admin.id,
      payload: { note: 'ข้อมูลจำลอง' },
    })) : []
    acks = []; calls = []; confirmation = []
    if (scenario === 'markup') {
      jobs[0].customer_name = markup
      draft.callouts[0].title = markup
      events.push({ id: 1, job_id: mockupJob, type: 'hold', phase: 'production', at: now, by: users.admin.id,
        payload: { reason: markup } })
    }
  }
  reset()

  async function handle(req, res) {
    const url = new URL(req.url, origin)
    if (url.pathname.startsWith('/rest/v1/') && latency) await new Promise(resolve => setTimeout(resolve, latency))
    const roleKey = req.headers.authorization?.split('.').at(-1)
    const user = users[roleKey]
    const [role, ...links] = roles[roleKey] ?? []
    const profile = user && { user_id: user.id, name: 'ผู้ใช้จำลอง ' + roleKey, role, section: roleKey === 'phase1' ? 1 : roleKey === 'phase2' ? 2 : null, active: true }
    const json = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    const log = (jobId, type, payload) => events.push({
      id: events.length + 1, job_id: jobId, type, phase: jobs.find(j => j.id === jobId)?.phase,
      at: new Date().toISOString(), by: user.id, payload,
    })
    if (url.pathname === '/favicon.ico') return res.writeHead(204).end()
    if (url.pathname === '/fixture-shirt.svg' || (url.pathname === '/storage/v1/fixture-shirt.svg' && url.searchParams.get('token') === 'local')) return res.writeHead(200, { 'Content-Type': contents['.svg'] }).end(shirt)
    if (url.pathname === '/auth/v1/user') return json(user ?? null, user ? 200 : 401)
    if (url.pathname.startsWith('/storage/v1/')) {
      if (!user) return json({ message: 'ใช้บัญชีจำลอง' }, 401)
      if (url.pathname.includes('/sign/')) {
        const args = JSON.parse(await body(req))
        if (Array.isArray(args.paths)) return json(args.paths.map(path => ({ path, signedURL: '/fixture-shirt.svg?token=local' })))
        return json({ signedURL: '/fixture-shirt.svg?token=local' })
      }
      await body(req)
      return json({ Key: url.pathname })
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (!user) return json({ message: 'ใช้บัญชีจำลอง' }, 401)
      const table = url.pathname.slice('/rest/v1/'.length)
      if (failedTables.includes(table) || scenarioName === 'error' && ['jobs', 'job_live'].includes(table)) {
        return json({ message: 'ข้อมูลจำลองโหลดไม่สำเร็จ' }, 400)
      }
      if (scenarioName === 'loaded' && table === 'events') calls.push({ fn: 'events', roleKey })
      if (table.startsWith('rpc/')) {
        const fn = table.slice(4)
        const input = await body(req)
        const args = input.length ? JSON.parse(input) : {}
        calls.push({ fn, args, roleKey })
        const job = jobs.find(j => j.id === args.p_job)
        const sheet = sheets.find(s => s.id === args.p_sheet)
        switch (fn) {
          case 'job_sla_flags': return json([])
          case 'inbox_scan': return json(0)
          case 'staff_names': return json(Object.entries(users).map(([k, u]) => ({ user_id: u.id, name: 'ผู้ใช้จำลอง ' + k })))
          case 'owner_list_users': return json(Object.entries(users).map(([k, u]) => ({ user_id: u.id, email: u.email, name: k, role: roles[k][0], active: true })))
          case 'mark_delivered':
            Object.assign(job, { delivered_at: new Date().toISOString(), delivered_by: user.id, delivery_note: args.p_note })
            log(job.id, 'delivered', { note: args.p_note })
            return json(null)
          case 'undo_delivery':
            Object.assign(job, { delivered_at: null, delivered_by: null, delivery_note: null })
            log(job.id, 'delivery_undone', { reason: args.p_reason })
            return json(null)
          case 'cancel_job':
            Object.assign(job, { phase: 'cancelled', station_seq: null, station_status: null })
            log(job.id, 'job_cancelled', { reason: args.p_reason })
            return json(null)
          case 'save_confirmation_draft':
            confirmation = [{ id: id(80), confirmation_no: args.p_data.h.doc_no, status: 'draft', data: args.p_data, updated_at: now }]
            return json(id(80))
          case 'receive_job': {
            const received = makeJob(formJob, args.p_confirmation_no, 'production', args.p_spec)
            received.mockup_path = confirmation[0]?.data.mockup_path ?? null
            jobs.push(received)
            confirmation[0].status = 'received'
            log(received.id, 'received', {})
            return json(received.id)
          }
          case 'start_mockup_sheet':
            sheets = [makeSheet(args.p_job)]
            return json(sheets[0].id)
          case 'save_mockup_draft': {
            if (sheet.version !== args.p_version) return json({ code: 'P0001', message: 'มีคนบันทึกฉบับใหม่กว่าแล้ว กดโหลดใหม่ก่อน' }, 400)
            const data = args.p_data
            draft.views = data.views.map((view, i) => ({ ...view, id: id(31 + i), sheet_id: sheet.id }))
            draft.specs = data.specs.map(spec => ({ ...spec, id: spec.key, sheet_id: sheet.id }))
            draft.callouts = data.callouts.map((callout, i) => ({
              ...callout, id: id(40 + i), sheet_id: sheet.id, spec_id: callout.spec_key,
              view_id: draft.views.find(v => v.view === callout.view).id,
            }))
            sheet.version++
            return json(sheet.version)
          }
          case 'approve_mockup_sheet':
            if (sheet.version !== args.p_version) return json({ code: 'P0001', message: 'มีคนบันทึกฉบับใหม่กว่าแล้ว กดโหลดใหม่ก่อน' }, 400)
            Object.assign(sheet, { status: 'approved', approved_by: user.id, approved_at: now })
            log(sheet.job_id, 'mockup_approved', {})
            return json(null)
          case 'ack_mockup_sheet':
            acks.push({ job_id: sheet.job_id, sheet_id: sheet.id, user_id: user.id, rev: sheet.rev, station_code: args.p_station, at: now })
            return json(null)
          default: return json({ message: 'ไม่มี RPC จำลอง ' + fn }, 404)
        }
      }
      const data = {
        profiles: [profile], staff_stations: links.map(station_code => ({ station_code, user_id: user.id })),
        stations, jobs, job_live: jobs, events, mockup_sheets: sheets, mockup_acks: acks,
        mockup_views: draft.views, mockup_specs: draft.specs, mockup_callouts: draft.callouts,
        confirmation_drafts: confirmation,
        station_visits: scenarioName === 'loaded' ? jobs.filter(job => job.phase === 'done').map(job => ({
          job_id: job.id, station_code: 'qc_pack', phase: 'production', visit: 2, rework: false,
          started_at: new Date(Date.parse(now) - 1_800_000).toISOString(), done_at: now,
        })) : [],
        routes: [{ code: 'normal', name: 'พิมพ์ทั้งตัว' }],
        route_stations: pathCodes.map((station_code, i) => ({ route_code: 'normal', station_code, seq: i + 1 })),
        machine_types: [{ code: 'single', name: 'เข็มเดี่ยว', shared: false }],
        sewing_machines: [{ id: 1, code: 'SN-R11', type_code: 'single', status: 'ready', sort: 1,
          machine_assignments: [], machine_bookings: [], machine_status_log: [] }],
        product_machine_needs: [{ product_type_code: 'tshirt', type_code: 'single', qty: 1 }],
        product_types: [{ code: 'tshirt', name: 'เสื้อยืด', unit: 'ตัว', category: 'เสื้อผ้า', active: true, sort: 1 }],
      }
      const matching = filterRows(data[table] ?? [], url.searchParams)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? matching.length)
      const rows = matching.slice(offset, offset + limit)
      if (req.method === 'HEAD') {
        res.setHeader('Content-Range', rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '*/0')
        return res.writeHead(200).end()
      }
      return json(req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows)
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname === '/confirmation' ? '/confirmation.html' : url.pathname
    if (missingLabelChunk) {
      const destination = req.headers['sec-fetch-dest']
      if (path === '/index.html' && destination === 'document' && missingLabelChunk.failed) {
        missingLabelChunk = null
        calls.push({ fn: 'stale_reloaded' })
      } else if (destination === 'script' && /\/assets\/LabelPage-.*\.js$/.test(path)) {
        missingLabelChunk.failed = true
        calls.push({ fn: 'stale_chunk', path })
        return res.writeHead(404, { 'Cache-Control': 'no-store' }).end()
      }
    }
    const file = resolve(dist, '.' + path)
    if (!file.startsWith(resolve(dist) + sep)) return res.writeHead(404).end()
    try {
      const source = await readFile(file)
      const bytes = path === '/sw.js' && workerRevision > 0
        ? Buffer.concat([source, Buffer.from('\n// local QA build ' + workerRevision + '\n')])
        : source
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
  return { server, reset, setLatency(ms) { latency = ms }, size: () => [jobs.length, events.length],
    failLabelChunk() { missingLabelChunk = { failed: false } }, bumpWorker() { workerRevision++ },
    failRest(tables) { failedTables = tables },
    get calls() { return calls }, get draft() { return draft }, get confirmation() { return confirmation },
    get sheetVersion() { return sheets[0]?.version } }
}
