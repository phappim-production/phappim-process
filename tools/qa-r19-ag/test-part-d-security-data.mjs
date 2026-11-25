import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack, sessionFor } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'
import { ACCOUNTS } from '../qa-r14/db.mjs'

const PORT = Number(process.env.QA_PORT ?? 5234)
const FILES_PORT = Number(process.env.QA_FILES_PORT ?? 5235)
const OUT_JSON = fileURLToPath(new URL('./part-d-security-data.json', import.meta.url))
const OUT_SQL_JSON = fileURLToPath(new URL('./data-integrity-sql.json', import.meta.url))

const results = []
const observations = []

function record(id, title, pass, detail = '') {
  results.push({ id, title, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${title}${detail ? ' · ' + detail : ''}`)
}

async function run() {
  const stack = await startLocalStack({ port: PORT, filesPort: FILES_PORT })
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)
  const fx = await createFixtures(t)
  const accByKey = Object.fromEntries(ACCOUNTS.map(a => [a.key, a]))
  const uid = k => accByKey[k].id
  const tokenOf = k => (k === 'anon' ? null : sessionFor(accByKey[k]).access_token)

  const sql = async (q, params = []) => {
    const r = await fetch(`${stack.origin}/__qa/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: q, params }),
    })
    const j = await r.json()
    if (!r.ok || j.message) throw new Error(j.message ?? `SQL HTTP ${r.status}`)
    return j.rows
  }
  const as = (userId, call, args = []) => sql(`with c as materialized (select set_config('request.jwt.claim.sub', $1, false) x) select ${call} from c`, [userId, ...args])
  const callRpcHttp = async (actorKey, fn, bodyObj = {}) => {
    const tok = tokenOf(actorKey)
    const headers = {
      apikey: 'r14-local-anon-key',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tok ?? 'r14-local-anon-key'}`,
    }
    const res = await fetch(`${stack.origin}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(bodyObj) })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: res.ok, status: res.status, code: data?.code ?? '', message: data?.message ?? '' }
  }
  const restHttp = async (actorKey, method, path, bodyObj = null) => {
    const tok = tokenOf(actorKey)
    const headers = {
      apikey: 'r14-local-anon-key',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tok ?? 'r14-local-anon-key'}`,
    }
    const res = await fetch(`${stack.origin}/rest/v1/${path}`, {
      method,
      headers,
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: res.ok, status: res.status, data }
  }

  async function receiveJob(no, route = 'normal', opts = {}) {
    const [row] = await as(uid('admin1'), `public.receive_job(
      p_confirmation_no => $2, p_customer_name => $3, p_job_name => $4,
      p_product_type_code => 'tshirt', p_qty => $5, p_unit => 'ตัว',
      p_due_date => (current_date + 4), p_route_code => $6, p_confirmation_pdf_path => null,
      p_spare_qty => 0, p_confirmation_rev => 0, p_spec => $7::jsonb, p_needs_sample => $8, p_develop => $9
    ) as id`, [no, opts.customer ?? 'ลูกค้า D', opts.jobName ?? 'งาน D', opts.qty ?? 20, route, JSON.stringify(opts.spec ?? {}), opts.needsSample ?? false, opts.develop ?? false])
    return row.id
  }

  async function check(id, title, fn, { allowErrorStatus = false } = {}) {
    const off = chrome.main.logs.length
    try {
      const detail = await fn()
      const bad = chrome.main.logs.slice(off).filter(e => {
        if (String(e.text ?? '').startsWith("Blocked attempt to show a 'beforeunload'")) return false
        if (allowErrorStatus && /400|403|404|409|413|415|422|500|503/.test(e.text ?? '')) return false
        return true
      })
      if (bad.length) throw new Error('console error: ' + JSON.stringify(bad).slice(0, 400))
      record(id, title, true, detail ?? '')
    } catch (e) {
      record(id, title, false, e?.stack ?? e?.message ?? String(e))
    }
  }

  try {
    await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
    await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
    const jBase = await receiveJob('SC-D1-BASE', 'cut_only', { withMockup: false })

    // === D.1a Direct URL Matrix across all roles + disabled + norole ===
    await check('D1.direct-url-matrix', 'D1.1 เปิด URL #/... ตรงๆ ครบทุกเส้นทาง x ทุกบทบาท: บัญชีไม่มีสิทธิ์/ถูกปิดต้องเข้าหน้าต้องห้ามไม่ได้', async () => {
      const routes = [
        '#/', '#/production', '#/jobs', '#/board', '#/queue', '#/production-queue', '#/sewing',
        '#/dept', '#/issues', '#/report', '#/history', '#/reports', '#/inbox', '#/reviews',
        '#/admin', '#/roles', '#/audit', '#/users', '#/assign', '#/settings', '#/words',
        `#/label?id=${jBase}`, `#/mockup?id=${jBase}`, `#/artwork?id=${jBase}`,
      ]
      // Exact mapping of app/src/auth/access.ts:canOpenPage + App.tsx:115 redirect
      const isOverviewRole = r => r === 'owner' || r === 'admin1'
        || r === 'manager'
      const shouldAllow = (role, h) => {
        if (role === 'disabled' || role === 'norole') return false
        if (role === 'owner') return true
        const page = h.split('?')[0]
        if (['#/settings', '#/users', '#/assign', '#/admin', '#/roles', '#/audit'].includes(page)) return false
        if (page === '#/reviews') return role === 'manager'
        if (page === '#/issues') return ['manager', 'prod1', 'sup1', 'sup2'].includes(role)
        if (page === '#/dept') return ['prod1', 'sup1', 'sup2'].includes(role)
        if (page === '#/reports' || page === '#/production-queue') return !role.startsWith('staff') && role !== 'qc'
        if (page === '#/artwork') return !role.startsWith('staff')
        return true
      }

      const matrix = {}
      const leaks = []
      const testAccounts = ['owner', 'manager', 'admin1', 'prod1', 'sup1', 'sup2', 'qc', 'staff_single', 'staff_multi', 'staff_qc', 'staff_empty', 'disabled', 'norole']
      for (const role of testAccounts) {
        matrix[role] = {}
        for (const h of routes) {
          await t.goto(role, h, 1440)
          await delay(160)
          const st = await t.ev(() => {
            const txt = document.body.innerText
            const blocked = /บทบาทของคุณเปิดหน้านี้ไม่ได้|หน้านี้สำหรับเจ้าของระบบ|บัญชีนี้ถูกปิด|ยังไม่ได้รับบทบาท|เข้าสู่ระบบพนักงาน/.test(txt)
            const hasJobLeak = txt.includes('SC-D1-BASE')
            const hasOverviewHeading = txt.includes('สถานีตอนนี้') || txt.includes('รับงานเพิ่มได้ไหม')
            const hasAllJobsHeading = txt.includes('ใบงานทั้งหมด') && !txt.includes('เมนู')
            return { blocked, hasJobLeak, hasOverviewHeading, hasAllJobsHeading, title: document.querySelector('h1, h2')?.textContent?.trim() ?? '' }
          })
          matrix[role][h] = st.blocked ? 'DENY' : 'ALLOW'
          if ((role === 'disabled' || role === 'norole') && (!st.blocked || st.hasJobLeak)) {
            leaks.push({ role, h, st })
          }
          if (!shouldAllow(role, h) && !st.blocked) {
            leaks.push({ role, h, reason: 'expected DENY on page', st })
          }
          const basePage = h.split('?')[0]
          if (!isOverviewRole(role) && role !== 'disabled' && role !== 'norole' && (basePage === '#/production' || basePage === '#/jobs')) {
            if (st.hasOverviewHeading || st.hasAllJobsHeading) {
              leaks.push({ role, h, reason: 'non-overview role saw overview content', st })
            }
          }
        }
      }
      assert.equal(leaks.length, 0, 'พบสิทธิ์หน้าจอหลุด: ' + JSON.stringify(leaks))
      observations.push({ key: 'D1_url_matrix', rolesTested: testAccounts.length, routesTested: routes.length, leaks })
      return `${testAccounts.length} accounts x ${routes.length} routes checked · leaks=${leaks.length}`
    }, { allowErrorStatus: true })

    // === D.1b Dynamic pg_proc RPC Permission Matrix + Direct REST Writes ===
    await check('D1.rpc-matrix-and-rest-writes', 'D1.2 ดึงฟังก์ชัน public จาก pg_proc ครบทุกตัว x ทุกบทบาท + ห้ามเขียนตารางตรงผ่าน REST', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      const jT = await receiveJob('SC-D1-RPC', 'cut_only')
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [jT])
      const fakePath = `SC-D1-RPC/cut/1/test1.jpg`
      stack.r2Store.set('station_photos/' + fakePath, { bytes: new Uint8Array([0xff, 0xd8, 0xff]), type: 'image/jpeg' })
      await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, 3, 'image/jpeg', $2) on conflict do nothing", [fakePath, uid('staff_single')])
      const cPending = (await as(uid('staff_single'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jT, [fakePath]]))[0].id

      const pgProcs = await sql(`
        select p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
        order by p.proname
      `)
      // Map every actionable RPC to dummy-safe test payload + who is expected to fail permission check (42501 / 401 / auth)
      const dummyId = '00000000-0000-0000-0000-000000000000'
      const rpcArgs = {
        receive_job: { p_confirmation_no: 'X', p_customer_name: 'x', p_job_name: 'x', p_product_type_code: 'tshirt', p_qty: 1, p_unit: 'ตัว', p_due_date: '2026-12-30', p_route_code: 'cut_only', p_confirmation_pdf_path: null },
        check_material: { p_material_id: 999999, p_checked: true },
        order_film: { p_job: dummyId, p_eta: '2026-12-30' },
        receive_film: { p_job: dummyId },
        start_station: { p_job: dummyId },
        complete_substep: { p_job: dummyId, p_key: 'x' },
        update_sew_count: { p_job: dummyId, p_count: 1 },
        record_qc: { p_job: dummyId, p_passed: 1 },
        send_rework: { p_job: dummyId, p_qty: 1, p_reason: 'x', p_source_station: 'cut' },
        finish_station: { p_job: dummyId },
        record_sample_result: { p_job: dummyId, p_pass: true },
        open_issue: { p_job: dummyId, p_reason: 'x' },
        close_issue: { p_job: dummyId },
        submit_delay_report: { p_job: dummyId, p_reasons: ['x'], p_detail: 'x', p_new_eta: '2026-12-30T10:00:00Z', p_segment_code: null },
        correct_event: { p_job: dummyId, p_event_id: 999999, p_reason: 'x' },
        assign_machines: { p_job: dummyId, p_machine_codes: [] },
        release_machines: { p_job: dummyId },
        set_machine_status: { p_machine_code: 'NOPE', p_status: 'active' },
        set_repair_eta: { p_machine_code: 'NOPE', p_repair_eta: '2026-12-30T10:00:00Z' },
        book_machines: { p_job: dummyId, p_starts: '2026-12-30T10:00:00Z', p_ends: '2026-12-30T12:00:00Z' },
        cancel_booking: { p_job: dummyId },
        start_sewing: { p_job: dummyId },
        finish_sewing: { p_job: dummyId },
        report_sewing_issue: { p_job: dummyId, p_reason: 'x', p_pause: false },
        resume_sewing: { p_job: dummyId },
        inbox_scan: {},
        inbox_mark_read: { p_ids: [] },
        inbox_mark_all_read: {},
        inbox_unread_count: {},
        staff_names: {},
        save_confirmation_draft: { p_data: { product: 'tshirt', h: { doc_no: 'X', customer: 'x', due_date: '2026-12-30', sample: 'ไม่ขึ้นตัวอย่าง' }, p: { tshirt: { qty: 1 } }, summary: { qty: 1 } } },
        cancel_confirmation_draft: { p_id: dummyId },
        attach_confirmation_pdf: { p_job: dummyId, p_path: 'X/a.pdf' },
        move_job_ahead: { p_job: dummyId, p_before: dummyId, p_reason: 'x' },
        start_in_queue: { p_job: dummyId, p_reason: null },
        note_queue_skip: { p_job: dummyId, p_reason: 'x' },
        add_vendor: { p_name: 'X', p_stations: ['cut'] },
        send_out: { p_job: dummyId, p_vendor: 1, p_last_station: 'cut', p_arrive_at: '2026-12-30T10:00:00Z', p_lead_days: 1, p_back_at: '2026-12-31T10:00:00Z' },
        forward_out: { p_run: 999999, p_vendor: 1, p_last_station: 'cut', p_arrive_at: '2026-12-30T10:00:00Z', p_lead_days: 1, p_back_at: '2026-12-31T10:00:00Z' },
        receive_back: { p_run: 999999 },
        update_out_plan: { p_run: 999999, p_arrive_at: '2026-12-30T10:00:00Z', p_lead_days: 1, p_back_at: '2026-12-31T10:00:00Z' },
        split_job: { p_job: dummyId, p_qty: 1 },
        job_sla_flags: {},
        set_job_mockup: { p_job: dummyId, p_path: 'X/a.jpg' },
        ack_review: { p_kind: 'delay', p_ref: 999999 },
        start_mockup_sheet: { p_job: dummyId },
        save_mockup_draft: { p_sheet: dummyId, p_version: 1, p_data: {} },
        discard_mockup_draft: { p_sheet: dummyId },
        submit_mockup_sheet: { p_sheet: dummyId, p_version: 1 },
        return_mockup_sheet: { p_sheet: dummyId, p_reason: 'x' },
        approve_mockup_sheet: { p_sheet: dummyId },
        ack_mockup_sheet: { p_sheet: dummyId, p_station: 'cut' },
        mark_delivered: { p_job: dummyId },
        undo_delivery: { p_job: dummyId, p_reason: 'x' },
        file_upload_allowed: { p_kind: 'station_photos', p_path: 'X/cut/1/a.jpg', p_size: 100, p_type: 'image/jpeg' },
        record_file_upload: { p_kind: 'station_photos', p_path: 'X/cut/1/a.jpg', p_size: 100, p_type: 'image/jpeg', p_proof: 'bad' },
        file_read_allowed: { p_kind: 'station_photos', p_paths: [fakePath] },
        cancel_job: { p_job: dummyId, p_reason: 'x' },
        revise_job_spec: { p_job: dummyId, p_spec: {}, p_rev: 1, p_customer_name: 'x', p_job_name: 'x', p_qty: 1, p_spare_qty: 0, p_due_date: '2026-12-30', p_needs_sample: false },
        set_job_machines: { p_job: dummyId, p_type: 'single', p_qty: 1 },
        submit_first_piece: { p_job: dummyId, p_station: 'cut', p_photos: [] },
        decide_first_piece: { p_check: cPending, p_approve: true },
        add_finish_photos: { p_job: dummyId, p_station: 'cut', p_photos: [] },
        set_station_photos_enabled: { p_on: true, p_remind_minutes: 15 },
        station_photo_flags: {},
        owner_list_users: {},
      }
      const helpersOrReadOnly = new Set(['my_role', 'is_owner', 'events_no_change'])
      const unmappedProcs = pgProcs.filter(p => !helpersOrReadOnly.has(p.proname) && !(p.proname in rpcArgs)).map(p => p.proname)
      const uniqueProcs = [...new Set(pgProcs.map(p => p.proname))]

      // Verify anon, disabled, norole are BLOCKED from ALL non-helper write RPCs AND file/read RPCs!
      const blockedRoles = ['anon', 'disabled', 'norole']
      const securityViolations = []
      for (const proc of Object.keys(rpcArgs)) {
        for (const actor of blockedRoles) {
          const r = await callRpcHttp(actor, proc, rpcArgs[proc])
          if (r.ok) securityViolations.push({ actor, proc, status: r.status })
        }
      }
      // Verify staff_empty & non-owners cannot call owner-only or production write RPCs
      for (const proc of ['submit_first_piece', 'add_finish_photos', 'start_in_queue', 'record_qc', 'decide_first_piece', 'receive_job', 'cancel_job', 'set_station_photos_enabled', 'owner_list_users']) {
        const r = await callRpcHttp('staff_empty', proc, rpcArgs[proc])
        if (r.ok) securityViolations.push({ actor: 'staff_empty', proc, status: r.status })
      }
      const rOwnerListByAdmin = await callRpcHttp('admin1', 'owner_list_users', {})
      if (rOwnerListByAdmin.ok) securityViolations.push({ actor: 'admin1', proc: 'owner_list_users', status: rOwnerListByAdmin.status })
      assert.equal(securityViolations.length, 0, 'พบช่องโหว่สิทธิ์ RPC: ' + JSON.stringify(securityViolations))

      // Direct REST writes across core tables (even owner cannot bypass RPC on workflow tables!)
      const directWriteViolations = []
      const directWrites = [
        ['POST', 'jobs', { confirmation_no: 'HACK-1', customer_name: 'x', product_type_code: 'tshirt', qty: 1, unit: 'ตัว', due_date: '2026-12-30', route_code: 'cut_only' }],
        ['PATCH', `jobs?id=eq.${jT}&select=id`, { phase: 'done' }],
        ['POST', 'events', { job_id: jT, type: 'done', phase: 'done' }],
        ['POST', 'station_checks', { job_id: jT, station_code: 'cut', visit: 1, kind: 'first_piece', status: 'approved', photos: [] }],
        ['PATCH', `station_checks?id=eq.${cPending}&select=id`, { status: 'approved' }],
        ['PATCH', 'station_photo_settings?id=eq.true&select=id', { enabled_at: null }],
        ['PATCH', `profiles?user_id=eq.${uid('staff_empty')}&select=user_id`, { role: 'staff' }],
      ]
      for (const actor of ['anon', 'disabled', 'staff_single', 'prod1', 'qc', 'admin1', 'manager', 'owner']) {
        for (const [m, p, b] of directWrites) {
          // Owner manages profiles directly in Settings (profiles_owner_all); every other table & every non-owner must reject direct REST writes
          if (actor === 'owner' && p.startsWith('profiles?')) continue
          const rw = await restHttp(actor, m, p, b)
          const modified = rw.ok && (m !== 'PATCH' || !Array.isArray(rw.data) || rw.data.length > 0)
          if (modified) directWriteViolations.push({ actor, method: m, path: p, status: rw.status, data: rw.data })
        }
      }
      assert.equal(directWriteViolations.length, 0, 'อนุญาตแก้ตารางตรงผ่าน REST: ' + JSON.stringify(directWriteViolations))

      observations.push({ key: 'D1_rpc_and_rest', pgProcsCount: uniqueProcs.length, unmappedProcs, securityViolations, directWriteViolations })
      return `pg_proc=${uniqueProcs.length} (unmapped=${unmappedProcs.length}) · RPC violations=0 · directREST=0`
    })

    // === D.1c XSS Sweep across ALL UI, Confirmation Form, Print Views ===
    await check('D1.xss-sweep', 'D1.3 ทดสอบ XSS (<script>, <img onerror>) ทุกช่องข้อความที่แสดงผลและพิมพ์ PDF', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      const xss = `<script>window.__xss=1</script><img src=x onerror="window.__xss=2">`
      const jXss = await receiveJob('SC-D1-XSS', 'normal', {
        customer: `ลูกค้า ${xss}`,
        jobName: `งาน ${xss}`,
        spec: {
          app: 'phappim-confirm', v: 1, product: 'tshirt',
          h: { doc_no: 'SC-D1-XSS', customer: `ลูกค้า ${xss}`, job_name: `งาน ${xss}`, sample: 'ไม่ขึ้นตัวอย่าง' },
          p: { tshirt: { neck: 'อื่นๆ', neck__other: xss, notes: xss, sizes: [{ label: xss, q: { M: 5 } }] } },
        },
      })
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jXss])
      const fpPath = 'SC-D1-XSS/print/1/x1.jpg'
      stack.r2Store.set('station_photos/' + fpPath, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), type: 'image/jpeg' })
      await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, 4, 'image/jpeg', $2) on conflict do nothing", [fpPath, uid('prod1')])
      const chkId = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'print', $3::text[], $4)", [jXss, [fpPath], xss]))[0].submit_first_piece
      await as(uid('prod1'), 'public.open_issue($2::uuid, $3)', [jXss, xss])
      // Also create a mockup sheet with XSS callout
      const sheetId = (await as(uid('admin1'), 'public.start_mockup_sheet($2::uuid, null)', [jXss]))[0].start_mockup_sheet
      const mPath = 'SC-D1-XSS/m1.png'
      stack.r2Store.set('mockups/' + mPath, { bytes: new Uint8Array(await import('node:fs/promises').then(m => m.readFile(fx.paths.frontPng))), type: 'image/png' })
      await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('mockups', $1, 100, 'image/png', $2) on conflict do nothing", [mPath, uid('admin1')])
      await as(uid('admin1'), 'public.save_mockup_draft($2::uuid, 1, $3::jsonb)', [sheetId, JSON.stringify({ views: [{ view: 'front', image_path: mPath, width: 600, height: 600 }], specs: [], callouts: [{ no: 1, view: 'front', x: 0.5, y: 0.5, box_x: 0.1, box_y: 0.1, title: xss, body: xss, stations: ['print'] }] })])

      // Visit every rendering view and verify window.__xss is NEVER set!
      for (const h of ['#/', '#/board', `#/board?job=${jXss}`, '#/production-queue', '#/history', '#/inbox', `#/label?id=${jXss}`, `#/mockup?id=${jXss}`]) {
        await t.goto('admin1', h, 1440)
        await delay(300)
        const triggered = await t.ev(() => window.__xss)
        assert.equal(triggered, undefined, `XSS ทำงานในหน้า ${h}!`)
      }
      // Also check FirstPieceReview Viewer modal opens with XSS worker note + reject reason -> still undefined!
      await t.goto('admin1', '#/', 1440)
      await t.waitText('SC-D1-XSS')
      await t.clickButton(/SC-D1-XSS.*ตรวจ/)
      await t.waitText('หน้างานบอก:')
      assert.equal(await t.ev(() => window.__xss), undefined, 'XSS ทำงานในตัวดูรูป!')
      await t.clickButton('ไม่ผ่าน…')
      await t.fillInput('[role=dialog] input[placeholder*="โลโก้"]', xss)
      await t.clickButton('ยืนยันไม่ผ่าน')
      await t.waitGone('ยืนยันไม่ผ่าน')
      assert.equal(await t.ev(() => window.__xss), undefined, 'XSS ทำงานหลังปฏิเสธรูป!')

      // Also check confirmation.html preview with XSS values
      await t.goto('admin1', '#/', 1440, '/confirmation.html?new=1')
      await t.fillInput('[data-k="doc_no"]', 'SC-XSS-PDF')
      await t.fillInput('[data-k="customer"]', xss)
      await t.fillInput('[data-k="notes"]', xss)
      await t.clickButton('ดูตัวอย่าง PDF')
      await delay(300)
      assert.equal(await t.ev(() => window.__xss), undefined, 'XSS ทำงานในตัวอย่าง PDF ใบยืนยัน!')

      return 'XSS payload escaped safely across Overview, Board, Drawer, FirstPieceReview, History, Inbox, Label, Mockup, and Confirmation PDF'
    }, { allowErrorStatus: true })

    // === D.2 SQL Data Integrity Audit ===
    await check('D2.sql-data-integrity', 'D2 ตรวจความถูกต้องของข้อมูลในฐานข้อมูลด้วย SQL หลังจบทุกเส้นทาง', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // Seed rich lifecycle: normal done+shipped, split parent+child, reworked, hold, cancelled, develop done
      const jDone = await receiveJob('SC-D2-DONE', 'cut_only', { qty: 10 })
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jDone])
      const pFp = 'SC-D2-DONE/cut/1/fp.jpg'; const pFn = 'SC-D2-DONE/cut/1/fn.jpg'; const pQc = 'SC-D2-DONE/qc_pack/2/q.jpg'
      for (const [k, s] of [[pFp, uid('prod1')], [pFn, uid('prod1')], [pQc, uid('qc')]]) {
        stack.r2Store.set('station_photos/' + k, { bytes: new Uint8Array([0xff, 0xd8, 0xff]), type: 'image/jpeg' })
        await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, 3, 'image/jpeg', $2) on conflict do nothing", [k, s])
      }
      const cD = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jDone, [pFp]]))[0].id
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [cD])
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'cut', $3::text[])", [jDone, [pFn]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jDone])
      await as(uid('qc'), 'public.start_in_queue($2::uuid, null)', [jDone])
      await as(uid('qc'), 'public.record_qc($2::uuid, 10)', [jDone])
      await as(uid('qc'), "public.add_finish_photos($2::uuid, 'qc_pack', $3::text[])", [jDone, [pQc]])
      await as(uid('qc'), "public.finish_station($2::uuid, 'qc_pack')", [jDone])
      await as(uid('admin1'), 'public.mark_delivered($2::uuid, null)', [jDone])

      const jSp = await receiveJob('SC-D2-SP', 'cut_only', { qty: 50 })
      const jSpChild = (await as(uid('admin1'), 'public.split_job($2::uuid, 20) as id', [jSp]))[0].id
      const jCan = await receiveJob('SC-D2-CAN', 'cut_only', { qty: 10 })
      await as(uid('owner'), "public.cancel_job($2::uuid, 'ยกเลิก D2')", [jCan])

      const integrityQueries = {
        contradictoryStates: `select id, confirmation_no, phase, station_seq, station_status from public.jobs
          where (phase in ('done', 'cancelled') and (station_seq is not null or station_status is not null))
             or (phase = 'production' and (station_seq is null or station_status is null))`,
        orphanedMachineAssignments: `select ma.id, ma.job_id, j.confirmation_no, j.phase, j.station_seq, j.station_status
          from public.machine_assignments ma join public.jobs j on j.id = ma.job_id
          where ma.released_at is null and (j.phase in ('done', 'cancelled') or j.station_status = 'out')`,
        orphanedOpenIssues: `select i.id, i.job_id, j.confirmation_no, j.phase from public.issues i join public.jobs j on j.id = i.job_id
          where i.closed_at is null and j.phase in ('done', 'cancelled')`,
        orphanedOutRuns: `select r.id, r.job_id, j.confirmation_no, j.phase from public.outsource_runs r join public.jobs j on j.id = r.job_id
          where r.closed_at is null and j.phase in ('done', 'cancelled')`,
        splitQtySumCheck: `select sum(qty)::int as family_sum from public.jobs where confirmation_no like 'SC-D2-SP%'`,
        pendingChecksOnClosedJobs: `select c.id, c.job_id, j.confirmation_no, j.phase from public.station_checks c join public.jobs j on j.id = c.job_id
          where c.status = 'pending' and j.phase in ('done', 'cancelled')`,
      }
      const sqlAudit = {}
      for (const [k, q] of Object.entries(integrityQueries)) {
        sqlAudit[k] = await sql(q)
      }
      assert.equal(sqlAudit.contradictoryStates.length, 0)
      assert.equal(sqlAudit.orphanedMachineAssignments.length, 0)
      assert.equal(sqlAudit.orphanedOpenIssues.length, 0)
      assert.equal(sqlAudit.orphanedOutRuns.length, 0)
      assert.equal(sqlAudit.splitQtySumCheck[0].family_sum, 50)
      observations.push({ key: 'D2_sql_audit', sqlAudit, pendingChecksOnClosedCount: sqlAudit.pendingChecksOnClosedJobs.length })
      await writeFile(OUT_SQL_JSON, JSON.stringify({ queries: integrityQueries, results: sqlAudit }, null, 2))
      return `contradictions=0 · orphanMachines=0 · orphanIssues=0 · splitSum=${sqlAudit.splitQtySumCheck[0].family_sum} · pendingChecksOnClosed=${sqlAudit.pendingChecksOnClosedJobs.length}`
    })
  } finally {
    await fx.cleanup()
    await chrome.close()
    await stack.close()
    await writeFile(OUT_JSON, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      results,
      observations,
    }, null, 2))
  }
  const failed = results.filter(r => !r.pass)
  console.log(`\nSUMMARY test-part-d-security-data: ${results.length - failed.length}/${results.length} passed`)
  if (chrome.externalAttempts.length > 0) throw new Error('EXTERNAL ATTEMPTS: ' + JSON.stringify(chrome.externalAttempts))
  process.exit(failed.length ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
