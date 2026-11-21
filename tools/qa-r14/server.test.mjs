import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '../../app/node_modules/@supabase/supabase-js/dist/index.mjs'
import { DEFAULT_PASSWORD } from './db.mjs'
import { startLocalStack } from './server.mjs'

function makeClient(origin, session) {
  return createClient(origin, 'r14-local-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: session
      ? { headers: { Authorization: `Bearer ${session.access_token}` } }
      : undefined,
  })
}

test('Part 0 local PGlite Supabase + R2 Worker full integration', async () => {
  const stack = await startLocalStack({ port: 0, filesPort: 0 })
  try {
    const anon = makeClient(stack.origin)
    const accountsRes = await fetch(`${stack.origin}/__qa/accounts`)
    assert.equal(accountsRes.status, 200)
    const accounts = await accountsRes.json()
    assert.equal(accounts.length, 15)
    const byKey = Object.fromEntries(accounts.map(a => [a.key, a]))

    const machines = await stack.db.execSuper('select count(*)::int n from public.sewing_machines')
    assert.equal(machines.rows[0].n, 22)
    const routes = await stack.db.execSuper('select count(*)::int n from public.routes')
    assert.equal(routes.rows[0].n, 9)
    const jobs0 = await stack.db.execSuper('select count(*)::int n from public.jobs')
    assert.equal(jobs0.rows[0].n, 0)
    const stationCaps = await stack.db.execSuper(`select code, machines, machine_pool from public.stations where code in ('print','press','cut','dtf_press','qc_pack') order by code`)
    assert.deepEqual(stationCaps.rows, [
      { code: 'cut', machines: 2, machine_pool: 'cut' },
      { code: 'dtf_press', machines: 2, machine_pool: 'dtf_press' },
      { code: 'press', machines: 1, machine_pool: 'heat_press' },
      { code: 'print', machines: 2, machine_pool: 'print' },
      { code: 'qc_pack', machines: null, machine_pool: 'qc_pack' },
    ])
    const vendors0 = await stack.db.execSuper('select count(*)::int n from public.vendors where active')
    assert.equal(vendors0.rows[0].n, 6)

    const badLogin = await anon.auth.signInWithPassword({ email: byKey.admin1.email, password: 'wrong' })
    assert.equal(badLogin.error?.code, 'invalid_credentials')
    const adminLogin = await anon.auth.signInWithPassword({ email: byKey.admin1.email, password: DEFAULT_PASSWORD })
    assert.equal(adminLogin.error, null)
    assert.equal(adminLogin.data.user.id, byKey.admin1.id)

    const adminAuthClient = createClient(stack.origin, 'r14-local-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await adminAuthClient.auth.setSession({
      access_token: adminLogin.data.session.access_token,
      refresh_token: adminLogin.data.session.refresh_token,
    })
    const samePw = await adminAuthClient.auth.updateUser({ password: DEFAULT_PASSWORD })
    assert.equal(samePw.error?.code, 'same_password')
    const chgPw = await adminAuthClient.auth.updateUser({ password: 'new-password-123' })
    assert.equal(chgPw.error, null)
    const newLogin = await anon.auth.signInWithPassword({ email: byKey.admin1.email, password: 'new-password-123' })
    assert.equal(newLogin.error, null)

    const disabledSb = makeClient(stack.origin, byKey.disabled.session)
    const dJobs = await disabledSb.from('jobs').select('*')
    assert.equal(dJobs.error, null)
    assert.deepEqual(dJobs.data, [])
    const dVendors = await disabledSb.from('vendors').select('*')
    assert.equal(dVendors.error, null)
    assert.deepEqual(dVendors.data, [])
    const dProfile = await disabledSb.from('profiles').select('*').eq('user_id', byKey.disabled.id).maybeSingle()
    assert.equal(dProfile.error, null)
    assert.equal(dProfile.data?.active, false)

    const anonJobs = await anon.from('jobs').select('id')
    assert.ok(anonJobs.error !== null || anonJobs.data?.length === 0)

    const adminSb = makeClient(stack.origin, byKey.admin1.session)
    const missingId = '00000000-0000-0000-0000-000000000999'
    const maybe0 = await adminSb.from('jobs').select('id').eq('id', missingId).maybeSingle()
    assert.equal(maybe0.error, null)
    assert.equal(maybe0.data, null)
    const single0 = await adminSb.from('jobs').select('id').eq('id', missingId).single()
    assert.equal(single0.error?.code, 'PGRST116')

    const prodSb = makeClient(stack.origin, byKey.prod1.session)
    const prodReceive = await prodSb.rpc('receive_job', {
      p_confirmation_no: 'TEST-P0-DENY', p_customer_name: 'ลูกค้า', p_job_name: 'เสื้อ',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-10',
      p_route_code: 'normal', p_confirmation_pdf_path: null, p_needs_sample: false,
    })
    assert.ok(prodReceive.error)
    assert.match(prodReceive.error.message, /แอดมิน|ทำขั้นนี้ไม่ได้/)

    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])
    const pdfPath = 'TEST-P0-1/0123456789abcdef.pdf'
    const upPdf = await fetch(`${stack.filesOrigin}/upload/confirmations/${pdfPath}`, {
      method: 'PUT',
      headers: {
        Origin: stack.origin,
        Authorization: `Bearer ${byKey.admin1.session.access_token}`,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdfBytes.byteLength),
      },
      body: pdfBytes,
    })
    assert.equal(upPdf.status, 200)

    const badUp = await fetch(`${stack.filesOrigin}/upload/confirmations/TEST-P0-1/bad.pdf`, {
      method: 'PUT',
      headers: {
        Origin: stack.origin,
        Authorization: `Bearer ${byKey.admin1.session.access_token}`,
        'Content-Type': 'application/pdf',
        'Content-Length': '5',
      },
      body: new TextEncoder().encode('hello'),
    })
    assert.equal(badUp.status, 415)

    const disabledUp = await fetch(`${stack.filesOrigin}/upload/confirmations/TEST-P0-1/abcdef01.pdf`, {
      method: 'PUT',
      headers: {
        Origin: stack.origin,
        Authorization: `Bearer ${byKey.disabled.session.access_token}`,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdfBytes.byteLength),
      },
      body: pdfBytes,
    })
    assert.equal(disabledUp.status, 403)

    const okReceive = await adminSb.rpc('receive_job', {
      p_confirmation_no: 'TEST-P0-1', p_customer_name: 'ลูกค้าทดสอบ', p_job_name: 'เสื้อยืด',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-10',
      p_route_code: 'normal', p_confirmation_pdf_path: pdfPath, p_needs_sample: false,
    })
    assert.equal(okReceive.error, null)
    const jobId = okReceive.data
    assert.ok(jobId)

    // Verify YYYY-MM-DD date serialization + numeric serialization
    const jobLive = await adminSb.from('job_live').select('id, due_date, queue_seq').eq('id', jobId).single()
    assert.equal(jobLive.error, null)
    assert.equal(jobLive.data.due_date, '2099-01-10')
    assert.equal(typeof jobLive.data.queue_seq, 'number')

    // Verify R2 signed URL serves exact bytes
    const signRes = await fetch(`${stack.filesOrigin}/sign`, {
      method: 'POST',
      headers: {
        Origin: stack.origin,
        Authorization: `Bearer ${byKey.qc.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind: 'confirmations', paths: [pdfPath] }),
    })
    assert.equal(signRes.status, 200)
    const signed = await signRes.json()
    assert.ok(signed.urls[pdfPath])
    const dl = await fetch(signed.urls[pdfPath])
    assert.equal(dl.status, 200)
    assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), pdfBytes)

    // Verify HEAD count=exact
    const evHead = await adminSb.from('events').select('id', { count: 'exact', head: true }).eq('job_id', jobId)
    assert.equal(evHead.error, null)
    assert.equal(evHead.count, 2)

    const ownerSb = makeClient(stack.origin, byKey.owner.session)
    const embeddedEvents = await ownerSb.from('events').select('id, job_id, type, jobs(confirmation_no, unit)').eq('job_id', jobId)
    assert.equal(embeddedEvents.error, null)
    assert.equal(embeddedEvents.data.length, 2)
    assert.equal(embeddedEvents.data[0].jobs.confirmation_no, 'TEST-P0-1')

    const embeddedMachines = await ownerSb
      .from('sewing_machines')
      .select('id, code, machine_assignments(id), machine_bookings(id), machine_status_log(id)')
      .limit(1, { referencedTable: 'machine_assignments' })
      .limit(1, { referencedTable: 'machine_bookings' })
      .limit(1, { referencedTable: 'machine_status_log' })
      .order('sort')
    assert.equal(embeddedMachines.error, null)
    assert.equal(embeddedMachines.data.length, 22)
    assert.deepEqual(embeddedMachines.data[0].machine_assignments, [])

    const cutRow = await ownerSb.from('stations').select('code, name, section, substeps, machines, machine_pool, sla_days, warn_pct, big_qty, big_sla_days').eq('code', 'cut').single()
    assert.equal(cutRow.error, null)
    const updStation = await ownerSb
      .from('stations')
      .update({ sla_days: 2 })
      .eq('code', 'cut')
      .eq('substeps', JSON.stringify(cutRow.data.substeps))
      .select('code')
      .single()
    assert.equal(updStation.error, null)

    const assignAdd = await ownerSb.from('staff_stations').insert([{ user_id: byKey.staff_empty.id, station_code: 'cut' }])
    assert.equal(assignAdd.error, null)
    const assignDel = await ownerSb.from('staff_stations').delete().eq('user_id', byKey.staff_empty.id).in('station_code', ['cut'])
    assert.equal(assignDel.error, null)

    const audit = await ownerSb.from('audit_log').select('*').order('at', { ascending: false })
    assert.equal(audit.error, null)
    assert.ok(audit.data.length >= 3)

    const resetRes = await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
    assert.equal(resetRes.status, 200)
    const jobsAfter = await stack.db.execSuper('select count(*)::int n from public.jobs')
    assert.equal(jobsAfter.rows[0].n, 0)
    assert.equal(stack.r2Store.size, 0)
    const relogin = await anon.auth.signInWithPassword({ email: byKey.admin1.email, password: DEFAULT_PASSWORD })
    assert.equal(relogin.error, null)
  } finally {
    await stack.close()
  }
})
