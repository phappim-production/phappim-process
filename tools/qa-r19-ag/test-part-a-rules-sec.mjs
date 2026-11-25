import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack, sessionFor } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'
import { ACCOUNTS } from '../qa-r14/db.mjs'
import { createHandler, hmacHex } from '../../workers/files/src/index.js'

const PORT = Number(process.env.QA_PORT ?? 5234)
const FILES_PORT = Number(process.env.QA_FILES_PORT ?? 5235)
const OUT_JSON = fileURLToPath(new URL('./part-a-rules-sec-results.json', import.meta.url))

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
  const validJpgBytes = new Uint8Array(await readFile(fx.paths.backJpg))

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
  const as = (uid, call, args = []) => sql(`with c as materialized (select set_config('request.jwt.claim.sub', $1, false) x) select ${call} from c`, [uid, ...args])
  const accByKey = Object.fromEntries(ACCOUNTS.map(a => [a.key, a]))
  const uid = k => accByKey[k].id
  const tokenOf = k => (k === 'anon' ? null : sessionFor(accByKey[k]).access_token)

  async function callRpcHttp(actorKey, fn, bodyObj = {}) {
    const tok = tokenOf(actorKey)
    const headers = {
      apikey: 'r14-local-anon-key',
      'Content-Type': 'application/json',
      ...(tok ? { Authorization: `Bearer ${tok}` } : { Authorization: 'Bearer r14-local-anon-key' }),
    }
    const res = await fetch(`${stack.origin}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObj),
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: res.ok, status: res.status, data }
  }

  async function restHttp(actorKey, method, path, bodyObj = null) {
    const tok = tokenOf(actorKey)
    const headers = {
      apikey: 'r14-local-anon-key',
      'Content-Type': 'application/json',
      ...(tok ? { Authorization: `Bearer ${tok}` } : { Authorization: 'Bearer r14-local-anon-key' }),
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

  async function seedJpg(userId, jobId, stationCode, name = 'p1') {
    const [r] = await sql('select private.mockup_folder(confirmation_no) as f, visit from public.jobs where id = $1', [jobId])
    const path = `${r.f}/${stationCode}/${r.visit}/${name}.jpg`
    stack.r2Store.set('station_photos/' + path, { bytes: validJpgBytes, type: 'image/jpeg' })
    await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, $2, 'image/jpeg', $3) on conflict do nothing", [path, validJpgBytes.byteLength, userId])
    return path
  }

  async function receiveJob(no, route = 'normal', needsSample = false, develop = false, qty = 20) {
    const [row] = await as(uid('admin1'), `public.receive_job(
      p_confirmation_no => $2, p_customer_name => 'ลูกค้า A3-A10', p_job_name => 'งานทดสอบกฎ',
      p_product_type_code => 'tshirt', p_qty => $3, p_unit => 'ตัว',
      p_due_date => (current_date + 5), p_route_code => $4, p_confirmation_pdf_path => null,
      p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => $5, p_develop => $6
    ) as id`, [no, qty, route, needsSample, develop])
    return row.id
  }

  async function check(id, title, fn) {
    try {
      const detail = await fn()
      record(id, title, true, detail ?? '')
    } catch (e) {
      record(id, title, false, e?.message ?? String(e))
    }
  }

  try {
    await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
    await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')

    // === A.3 Role matrix via real HTTP/JWT tokens ===
    await check('A3.role-matrix', 'ตรวจสิทธิ์ทุกบทบาทเรียก RPC รูปสถานีผ่าน token จริง', async () => {
      const jPrint = await receiveJob('SC-A3-P', 'normal', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jPrint])
      const pPrint = await seedJpg(uid('prod1'), jPrint, 'print', 'a1')

      const jCut = await receiveJob('SC-A3-C', 'cut_only', false)
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [jCut])
      const pCut = await seedJpg(uid('staff_single'), jCut, 'cut', 'c1')

      const jQc = await receiveJob('SC-A3-Q', 'cut_only', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jQc])
      const pq1 = await seedJpg(uid('prod1'), jQc, 'cut', 'q1')
      const cCut = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jQc, [pq1]]))[0].id
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [cCut])
      const pq2 = await seedJpg(uid('prod1'), jQc, 'cut', 'q2')
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'cut', $3::text[])", [jQc, [pq2]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jQc])
      await as(uid('qc'), 'public.start_in_queue($2::uuid, null)', [jQc])
      const pQc = await seedJpg(uid('qc'), jQc, 'qc_pack', 'qc1')

      const allRoles = ['owner', 'manager', 'admin1', 'prod1', 'sup1', 'sup2', 'qc', 'staff_single', 'staff_multi', 'staff_qc', 'staff_empty', 'disabled', 'norole', 'anon']

      // Test submit_first_piece on jCut (station cut, phase 1)
      const expectSubmitCut = new Set(['owner', 'prod1', 'sup1', 'staff_single', 'staff_multi'])
      const submitCutRes = {}
      // Test decide_first_piece on a pending check on jPrint
      const cPrint = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'print', $3::text[]) as id", [jPrint, [pPrint]]))[0].id
      const expectDecide = new Set(['owner', 'manager', 'admin1'])
      const decideRes = {}

      for (const actor of allRoles) {
        // submit_first_piece on jCut (reject if not allowed, or check first)
        const rSub = await callRpcHttp(actor, 'submit_first_piece', { p_job: jCut, p_station: 'cut', p_photos: [pCut], p_note: null })
        submitCutRes[actor] = rSub.ok ? 'ALLOW' : `DENY(${rSub.status}:${rSub.data?.code ?? ''})`
        if (expectSubmitCut.has(actor)) {
          // If one already succeeded, reset jCut's station_check so remaining allowed roles can be tested!
          assert.ok(rSub.ok, `submit_first_piece(cut) ควรอนุญาต ${actor} แต่ได้ ${JSON.stringify(rSub)}`)
          await sql('delete from public.station_checks where job_id = $1', [jCut])
        } else {
          assert.ok(!rSub.ok, `submit_first_piece(cut) ห้ามอนุญาต ${actor} แต่ผ่าน!`)
        }

        const rDec = await callRpcHttp(actor, 'decide_first_piece', { p_check: cPrint, p_approve: true, p_reason: null })
        decideRes[actor] = rDec.ok ? 'ALLOW' : `DENY(${rDec.status}:${rDec.data?.code ?? ''})`
        if (expectDecide.has(actor)) {
          assert.ok(rDec.ok, `decide_first_piece ควรอนุญาต ${actor} แต่ได้ ${JSON.stringify(rDec)}`)
          await sql("update public.station_checks set status = 'pending', decided_by = null, decided_at = null where id = $1", [cPrint])
        } else {
          assert.ok(!rDec.ok, `decide_first_piece ห้ามอนุญาต ${actor} แต่ผ่าน!`)
        }
      }

      // Test add_finish_photos on jQc (qc_pack, phase 2)
      const expectQcFinish = new Set(['owner', 'prod1', 'sup2', 'qc', 'staff_qc'])
      const qcFinishRes = {}
      for (const actor of allRoles) {
        const rFin = await callRpcHttp(actor, 'add_finish_photos', { p_job: jQc, p_station: 'qc_pack', p_photos: [pQc] })
        qcFinishRes[actor] = rFin.ok ? 'ALLOW' : `DENY(${rFin.status})`
        if (expectQcFinish.has(actor)) assert.ok(rFin.ok, `add_finish_photos(qc_pack) ควรอนุญาต ${actor}: ${JSON.stringify(rFin)}`)
        else assert.ok(!rFin.ok, `add_finish_photos(qc_pack) ห้ามอนุญาต ${actor}`)
      }

      // Test staff_single trying print station & sup1 trying qc_pack & set_station_photos_enabled
      const rStaffWrong = await callRpcHttp('staff_single', 'submit_first_piece', { p_job: jPrint, p_station: 'print', p_photos: [pPrint], p_note: null })
      assert.ok(!rStaffWrong.ok && /ไม่ใช่สถานีของคุณ/.test(rStaffWrong.data?.message ?? ''), JSON.stringify(rStaffWrong))
      for (const actor of allRoles.filter(x => x !== 'owner')) {
        const rEn = await callRpcHttp(actor, 'set_station_photos_enabled', { p_on: false, p_remind_minutes: null })
        assert.ok(!rEn.ok, `set_station_photos_enabled ห้ามอนุญาต ${actor}`)
        const rDirect = await restHttp(actor, 'PATCH', 'station_photo_settings?id=eq.true&select=id', { enabled_at: null })
        // In PostgREST/PGlite with RLS SELECT-only policy, UPDATE either denies (403/401) or modifies 0 rows (empty [])
        const rowsUpdated = Array.isArray(rDirect.data) ? rDirect.data.length : 0
        assert.ok(!rDirect.ok || rowsUpdated === 0, `PATCH station_photo_settings ห้ามแก้แถวได้สำหรับ ${actor}: ${JSON.stringify(rDirect)}`)
      }
      const rOwnerDirect = await restHttp('owner', 'PATCH', 'station_photo_settings?id=eq.true&select=id', { enabled_at: null })
      const ownerUpdated = Array.isArray(rOwnerDirect.data) ? rOwnerDirect.data.length : 0
      assert.ok(!rOwnerDirect.ok || ownerUpdated === 0, 'แม้ owner ก็ห้าม PATCH station_photo_settings ตรง')
      const [stSettingsStillOn] = await sql('select enabled_at is not null as on from public.station_photo_settings')
      assert.equal(stSettingsStillOn.on, true, 'enabled_at ต้องไม่ถูกปิดจาก PATCH ตรง')

      observations.push({ key: 'A3_role_matrix', submitCutRes, decideRes, qcFinishRes })
      return `14 roles tested across submit/decide/finish/settings`
    })

    // === A.5 Hard Edge Cases ===
    await check('A5.1-hold-requeue', 'A5.1 พักงานระหว่างรออนุมัติ + แก้แล้วเครื่องเต็มกลับคิว ยังอยู่ในรายการรออนุมัติ', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // Press has 1 machine limit
      const jPress1 = await receiveJob('SC-A5-PR1', 'normal', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jPress1])
      const c1 = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'print', $3::text[]) as id", [jPress1, [await seedJpg(uid('prod1'), jPress1, 'print', 'x2')]]))[0].id
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [c1])
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'print', $3::text[])", [jPress1, [await seedJpg(uid('prod1'), jPress1, 'print', 'x1')]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'print')", [jPress1])
      // Now jPress1 is at press
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jPress1])
      const cp1 = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'press', $3::text[]) as id", [jPress1, [await seedJpg(uid('prod1'), jPress1, 'press', 'pr1')]]))[0].id
      await as(uid('prod1'), "public.open_issue($2::uuid, 'เครื่องรีดร้อนไม่สม่ำเสมอ')", [jPress1])
      // Check station_photo_flags still returns pending while hold
      const fHold = (await as(uid('admin1'), `(select json_build_object('first_piece', x.first_piece) from public.station_photo_flags() x where x.job_id = $2::uuid) as f`, [jPress1]))[0]?.f
      assert.equal(fHold?.first_piece, 'pending')

      // Check UI shows พักงานอยู่ in FirstPieceQueue
      await t.goto('admin1', '#/', 1440)
      await t.waitText('SC-A5-PR1')
      await t.waitText('พักงานอยู่')

      // Start jPress2 at press to fill 1/1 machine, then close_issue on jPress1 -> requeued!
      const jPress2 = await receiveJob('SC-A5-PR2', 'normal', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jPress2])
      const cy = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'print', $3::text[]) as id", [jPress2, [await seedJpg(uid('prod1'), jPress2, 'print', 'y2')]]))[0].id
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [cy])
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'print', $3::text[])", [jPress2, [await seedJpg(uid('prod1'), jPress2, 'print', 'y1')]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'print')", [jPress2])
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jPress2])

      await as(uid('prod1'), "public.close_issue($2::uuid, 'ซ่อมแล้ว')", [jPress1])
      const [stAfter] = await sql('select station_status from public.jobs where id = $1', [jPress1])
      assert.equal(stAfter.station_status, 'queued', 'ต้องกลับเข้าคิวเมื่อเครื่องเต็ม')
      const fQueue = (await as(uid('admin1'), `(select json_build_object('first_piece', x.first_piece) from public.station_photo_flags() x where x.job_id = $2::uuid) as f`, [jPress1]))[0]?.f
      assert.equal(fQueue?.first_piece, 'pending', 'กลับเข้าคิวแล้วยังต้องอยู่รายการรออนุมัติ')
      await t.goto('admin1', '#/', 1440)
      await t.waitText('SC-A5-PR1')
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [cp1])
      return 'hold -> requeue ยังอยู่คิวอนุมัติและอนุมัติได้'
    })

    await check('A5.2-split-cancel-parent', 'A5.2 แบ่งงานระหว่างรออนุมัติ + ยกเลิกงานต้นทาง (ทั้งกรณีอนุมัติและกรณีไม่ผ่าน)', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // Case 1: Split while pending (after requeue so split_job allows), cancel parent, then APPROVE child
      const p1 = await receiveJob('SC-A5-SP1', 'cut_only', false, false, 10)
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [p1])
      const c1 = (await as(uid('staff_single'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [p1, [await seedJpg(uid('staff_single'), p1, 'cut', 'sp1')]]))[0].id
      // Hold and fill cut (2 machines) to requeue p1
      const filler1 = await receiveJob('SC-A5-FILL1', 'cut_only', false)
      const filler2 = await receiveJob('SC-A5-FILL2', 'cut_only', false)
      await as(uid('staff_single'), "public.open_issue($2::uuid, 'พักชั่วคราว')", [p1])
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [filler1])
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [filler2])
      await as(uid('prod1'), 'public.close_issue($2::uuid, null)', [p1])
      // Split p1 into child1 (4 pcs), cancel p1 while child1 is queued, then finish filler1 & start child1!
      const child1 = (await as(uid('admin1'), 'public.split_job($2::uuid, 4) as id', [p1]))[0].id
      await as(uid('owner'), "public.cancel_job($2::uuid, 'ยกเลิกต้นทางทดสอบ')", [p1])
      await as(uid('staff_single'), "public.open_issue($2::uuid, 'หยุดชั่วคราว')", [filler1])
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [child1])

      // Verify child1 appears in FirstPieceQueue UI & approve via UI!
      await t.goto('admin1', '#/', 1440)
      await t.waitText('SC-A5-SP1-2')
      await t.clickButton(/SC-A5-SP1-2.*ตรวจ/)
      await t.waitText('ผ่าน ทำทั้งล็อตได้')
      await waitFor(() => t.ev(() => {
        const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.includes('ผ่าน ทำทั้งล็อตได้'))
        return b && !b.disabled
      }), 'รอรูปโหลดในลูกที่แยก')
      await t.clickButton('ผ่าน ทำทั้งล็อตได้')
      await t.waitGone('ผ่าน ทำทั้งล็อตได้')

      // Check child1 history UI & events!
      const childEvents = await sql('select type, station_code from public.events where job_id = $1 order by id', [child1])
      const parentEvents = await sql('select type, station_code from public.events where job_id = $1 order by id', [p1])
      // Child completes finish photo + finish_station
      await as(uid('staff_single'), "public.add_finish_photos($2::uuid, 'cut', $3::text[])", [child1, [await seedJpg(uid('staff_single'), child1, 'cut', 'chf')]])
      await as(uid('staff_single'), "public.finish_station($2::uuid, 'cut')", [child1])

      // Case 2: Split while pending, cancel parent, then REJECT -> can child2 resend and finish?
      const p2 = await receiveJob('SC-A5-SP2', 'cut_only', false, false, 10)
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [p2])
      const c2 = (await as(uid('staff_single'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [p2, [await seedJpg(uid('staff_single'), p2, 'cut', 'sp2')]]))[0].id
      await as(uid('staff_single'), "public.open_issue($2::uuid, 'พัก2')", [p2])
      const filler3 = await receiveJob('SC-A5-FILL3', 'cut_only', false)
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [filler3])
      await as(uid('prod1'), 'public.close_issue($2::uuid, null)', [p2])
      const child2 = (await as(uid('admin1'), 'public.split_job($2::uuid, 4) as id', [p2]))[0].id
      await as(uid('owner'), "public.cancel_job($2::uuid, 'ยกเลิกต้นทาง 2')", [p2])
      await as(uid('staff_single'), "public.open_issue($2::uuid, 'หยุด')", [filler3])
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [child2])

      await as(uid('admin1'), "public.decide_first_piece($2::bigint, false, 'สีเพี้ยน')", [c2])
      // Child2 MUST see rejected and be able to resend!
      const child2Flags = (await as(uid('staff_single'), `(select json_build_object('first_piece', x.first_piece, 'reject_reason', x.reject_reason) from public.station_photo_flags() x where x.job_id = $2::uuid) as f`, [child2]))[0]?.f
      assert.equal(child2Flags?.first_piece, 'rejected', 'ลูกหลังแยกต้องเห็น status=rejected')
      const c2Resend = (await as(uid('staff_single'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [child2, [await seedJpg(uid('staff_single'), child2, 'cut', 'sp2r')]]))[0].id
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [c2Resend])
      await as(uid('staff_single'), "public.add_finish_photos($2::uuid, 'cut', $3::text[])", [child2, [await seedJpg(uid('staff_single'), child2, 'cut', 'sp2f')]])
      await as(uid('staff_single'), "public.finish_station($2::uuid, 'cut')", [child2])

      observations.push({
        key: 'A5_split_cancel_parent',
        child1Events: childEvents.map(e => e.type),
        parent1Events: parentEvents.map(e => e.type),
        child2AfterReject: child2Flags,
      })
      return `approve+reject child after parent cancel OK (childEvents=${childEvents.map(e => e.type).join(',')})`
    })

    await check('A5.3-outsource-with-pending-photo', 'A5.3 ส่งงานออกข้างนอก (send_out) จากสถานีที่มีรูปชิ้นแรกค้างอยู่', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // Clear cut fillers first
      const jOut = await receiveJob('SC-A5-OUT', 'cut_only', false, false, 10)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jOut])
      const cOut = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jOut, [await seedJpg(uid('prod1'), jOut, 'cut', 'o1')]]))[0].id
      // Hold and fill cut (2 machines) to requeue jOut so admin can send_out
      await as(uid('prod1'), "public.open_issue($2::uuid, 'จะส่งออกข้างนอก')", [jOut])
      const fA = await receiveJob('SC-A5-OFA', 'cut_only', false)
      const fB = await receiveJob('SC-A5-OFB', 'cut_only', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [fA])
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [fB])
      await as(uid('prod1'), 'public.close_issue($2::uuid, null)', [jOut])
      const [vendor] = await sql("select id from public.vendors where active and 'cut' = any(stations) limit 1")
      const runId = (await as(uid('admin1'), "public.send_out($2::uuid, $3::bigint, 'cut', now() + interval '1 hour', 1, now() + interval '2 days', null) as id", [jOut, vendor.id]))[0].id

      // 1) Check station_photo_flags when station_status='out'
      const flagsWhileOut = await as(uid('admin1'), `(select json_build_object('first_piece', x.first_piece) from public.station_photo_flags() x where x.job_id = $2::uuid) as f`, [jOut])
      const flagsWhileOutActive = flagsWhileOut.filter(r => r.f !== null)
      // 2) Backdate sent_at 25 mins and run inbox_scan() -> CHECK if first_piece_late fires falsely while out!
      await sql("update public.station_checks set sent_at = now() - interval '25 minutes' where id = $1", [cOut])
      await as(uid('admin1'), 'public.inbox_scan()')
      const lateMsgWhileOut = await sql("select id, title, body from public.inbox_messages where job_id = $1 and kind = 'first_piece_late'", [jOut])
      // 3) Check decide_first_piece while station_status='out' -> should it be allowed or blocked?
      const decideWhileOut = await callRpcHttp('admin1', 'decide_first_piece', { p_check: cOut, p_approve: true, p_reason: null })
      // 4) Check receive_back -> moves to qc_pack, check if station_started_at / visit behave cleanly!
      await as(uid('admin1'), 'public.receive_back($2::bigint, null)', [runId])
      const [jobAfterBack] = await sql('select phase, station_seq, station_status, station_started_at, visit from public.jobs where id = $1', [jOut])
      observations.push({
        key: 'A5_3_outsource_pending_photo',
        flagsWhileOutCount: flagsWhileOutActive.length,
        lateMsgWhileOut,
        decideWhileOut,
        jobAfterBack,
      })
      return `flagsOut=${flagsWhileOutActive.length} · lateInboxWhileOut=${lateMsgWhileOut.length} · decideWhileOut=${decideWhileOut.ok ? 'ALLOWED!' : decideWhileOut.data?.message}`
    })

    await check('A5.4_to_9-edge-cases', 'A5.4–A5.9 งานแก้จาก QC, ตัวอย่าง/Develop, ยกเลิกงาน, ปิดฟีเจอร์, เลิกติ๊กสถานี, งานเริ่มก่อนเปิดใช้', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // A5.4 Rework back to cut: visit 1 -> QC send_rework -> visit 2 requires NEW first piece & finish photo
      const jRw = await receiveJob('SC-A5-RW', 'cut_only', false, false, 10)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jRw])
      const rwV1p = await seedJpg(uid('prod1'), jRw, 'cut', 'v1fp')
      const rwC1 = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jRw, [rwV1p]]))[0].id
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [rwC1])
      const rwV1f = await seedJpg(uid('prod1'), jRw, 'cut', 'v1fin')
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'cut', $3::text[])", [jRw, [rwV1f]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jRw])
      await as(uid('qc'), 'public.start_in_queue($2::uuid, null)', [jRw])
      await as(uid('qc'), "public.send_rework($2::uuid, 3, 'ตัดเบี้ยว', 'cut')", [jRw])
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jRw])
      // Old visit 1 photo MUST be rejected & finish MUST be rejected
      const rOldPath = await callRpcHttp('prod1', 'submit_first_piece', { p_job: jRw, p_station: 'cut', p_photos: [rwV1p] })
      assert.ok(!rOldPath.ok && /ไม่ใช่ของงาน/.test(rOldPath.data?.message ?? ''), JSON.stringify(rOldPath))
      const rFinishNoNew = await callRpcHttp('prod1', 'finish_station', { p_job: jRw, p_station: 'cut' })
      assert.ok(!rFinishNoNew.ok && /ถ่ายรูปชิ้นแรก/.test(rFinishNoNew.data?.message ?? ''), JSON.stringify(rFinishNoNew))
      const rwV2p = await seedJpg(uid('prod1'), jRw, 'cut', 'v2fp')
      const rwC2 = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jRw, [rwV2p]]))[0].id
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [rwC2])
      const rwV2f = await seedJpg(uid('prod1'), jRw, 'cut', 'v2fin')
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'cut', $3::text[])", [jRw, [rwV2f]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jRw])

      // A5.5 Sample & Develop (reset cut/qc queue cleanly via skip reason on qc_pack)
      const jDev = await receiveJob('SC-A5-DEV', 'cut_only', true, true, 5)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jDev])
      const devFp = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jDev, [await seedJpg(uid('prod1'), jDev, 'cut', 'df1')]]))[0].id
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [devFp])
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'cut', $3::text[])", [jDev, [await seedJpg(uid('prod1'), jDev, 'cut', 'df2')]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jDev])
      await as(uid('qc'), "public.start_in_queue($2::uuid, 'ตรวจตัวอย่าง Develop ก่อน')", [jDev])
      await as(uid('qc'), "public.add_finish_photos($2::uuid, 'qc_pack', $3::text[])", [jDev, [await seedJpg(uid('qc'), jDev, 'qc_pack', 'dq1')]])
      await as(uid('qc'), "public.finish_station($2::uuid, 'qc_pack')", [jDev])
      await as(uid('admin1'), "public.record_sample_result($2::uuid, true, 'ผ่าน', current_date)", [jDev])
      const [devDone] = await sql('select phase from public.jobs where id = $1', [jDev])
      assert.equal(devDone.phase, 'done')

      // A5.6 Cancel while pending (backdate settings & station_started_at too)
      await sql("update public.station_photo_settings set enabled_at = now() - interval '2 hours'")
      const jCan = await receiveJob('SC-A5-CAN', 'cut_only', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jCan])
      const cCan = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jCan, [await seedJpg(uid('prod1'), jCan, 'cut', 'cn1')]]))[0].id
      await sql("update public.jobs set station_started_at = now() - interval '1 hour' where id = $1", [jCan])
      await sql("update public.station_checks set sent_at = now() - interval '30 minutes' where id = $1", [cCan])
      await as(uid('manager'), "public.cancel_job($2::uuid, 'ลูกค้ายกเลิก')", [jCan])
      assert.equal((await as(uid('admin1'), 'exists(select 1 from public.station_photo_flags() where job_id = $2::uuid) as has', [jCan]))[0].has, false)
      const rDecCan = await callRpcHttp('admin1', 'decide_first_piece', { p_check: cCan, p_approve: true, p_reason: null })
      assert.ok(!rDecCan.ok && /ยกเลิก/.test(rDecCan.data?.message ?? ''))
      await as(uid('owner'), 'public.inbox_scan()')
      assert.equal((await sql("select 1 from public.inbox_messages where dedupe_key = $1", ['fpl:' + cCan])).length, 0)

      // A5.8 Uncheck station while pending -> can finish with finish_photo only, no alert
      const jUnchk = await receiveJob('SC-A5-UNCHK', 'cut_only', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jUnchk])
      const cUnchk = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jUnchk, [await seedJpg(uid('prod1'), jUnchk, 'cut', 'uc1')]]))[0].id
      await sql("update public.jobs set station_started_at = now() - interval '1 hour' where id = $1", [jUnchk])
      await sql("update public.station_checks set sent_at = now() - interval '30 minutes' where id = $1", [cUnchk])
      await sql("update public.stations set first_piece_check = false where code = 'cut'")
      await as(uid('owner'), 'public.inbox_scan()')
      assert.equal((await sql("select 1 from public.inbox_messages where dedupe_key = $1", ['fpl:' + cUnchk])).length, 0)
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'cut', $3::text[])", [jUnchk, [await seedJpg(uid('prod1'), jUnchk, 'cut', 'uc2')]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jUnchk])
      await sql("update public.stations set first_piece_check = true where code = 'cut'")

      // A5.7 Disable feature while pending + A5.9 Job started BEFORE enabling
      const jOff = await receiveJob('SC-A5-OFF', 'cut_only', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jOff])
      const cOff = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jOff, [await seedJpg(uid('prod1'), jOff, 'cut', 'off1')]]))[0].id
      await sql("update public.jobs set station_started_at = now() - interval '1 hour' where id = $1", [jOff])
      await sql("update public.station_checks set sent_at = now() - interval '30 minutes' where id = $1", [cOff])
      await as(uid('owner'), 'public.set_station_photos_enabled(false, null)')
      await as(uid('owner'), 'public.inbox_scan()')
      assert.equal((await sql("select 1 from public.inbox_messages where dedupe_key = $1", ['fpl:' + cOff])).length, 0)
      // What if admin tries to decide_first_piece BEFORE worker finishes, while feature is disabled?
      const decideWhileDisabled = await callRpcHttp('admin1', 'decide_first_piece', { p_check: cOff, p_approve: true, p_reason: null })
      // Worker can finish immediately while feature off:
      await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jOff])

      // A5.9 Started BEFORE enabling -> finishes free, next station requires photos!
      const jPre = await receiveJob('SC-A5-PRE', 'cut_only', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jPre])
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // cut started BEFORE enabling -> finish allowed without photo!
      await as(uid('prod1'), "public.finish_station($2::uuid, 'cut')", [jPre])
      // qc_pack started AFTER enabling -> requires photo! (jRw still queued ahead at qc_pack, pass skip reason)
      await as(uid('qc'), "public.start_in_queue($2::uuid, 'ทดสอบ A5.9')", [jPre])
      await as(uid('qc'), 'public.record_qc($2::uuid, 20)', [jPre])
      const rQcNeedPhoto = await callRpcHttp('qc', 'finish_station', { p_job: jPre, p_station: 'qc_pack' })
      assert.ok(!rQcNeedPhoto.ok && /ถ่ายรูปงานเสร็จ/.test(rQcNeedPhoto.data?.message ?? ''), JSON.stringify(rQcNeedPhoto))

      observations.push({ key: 'A5_7_decide_while_feature_off', decideWhileDisabled })
      return `A5.4-A5.9 ผ่านครบ (decideWhileFeatureOff=${decideWhileDisabled.ok})`
    })

    // === A.6 SLA & Time consistency (DB vs Job History vs Reports) ===
    await check('A6.sla-vs-history-reports', 'A6 เวลามาตรฐาน (หักรออนุมัติ + ไม่หักซ้ำพักงาน) เทียบกับรายละเอียดงานและรายงาน', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      // Segment SLA print->cut is 3 work days. Create a job that started print 3.5 work days ago,
      // waited 1.5 work days for first_piece approval (with 0.5 work day overlapping hold!), then finished through done so Reports also shows it.
      const jSla = await receiveJob('SC-A6-SLA', 'normal', false, false, 10)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jSla])
      const fp1 = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'print', $3::text[]) as id", [jSla, [await seedJpg(uid('prod1'), jSla, 'print', 'sla1')]]))[0].id
      // Hold during wait
      await as(uid('prod1'), "public.open_issue($2::uuid, 'ทดสอบพักซ้อน')", [jSla])
      await as(uid('prod1'), 'public.close_issue($2::uuid, null)', [jSla])
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [fp1])

      // Set controlled timestamps (all within Mon-Sat working hours)
      await sql(`update public.station_photo_settings set enabled_at = now() - interval '10 days'`)
      await sql(`update public.jobs set station_started_at = now() - interval '72 hours' where id = $1`, [jSla])
      await sql(`update public.station_checks set sent_at = now() - interval '60 hours', decided_at = now() - interval '12 hours' where id = $1`, [fp1])
      await sql(`update public.issues set opened_at = now() - interval '48 hours', closed_at = now() - interval '24 hours' where job_id = $1`, [jSla])
      await sql(`alter table public.events disable trigger user`)
      await sql(`update public.events set at = now() - interval '72 hours' where job_id = $1 and type = 'station_start'`, [jSla])
      await sql(`update public.events set at = now() - interval '48 hours' where job_id = $1 and type = 'hold'`, [jSla])
      await sql(`update public.events set at = now() - interval '24 hours' where job_id = $1 and type = 'resume'`, [jSla])
      await sql(`alter table public.events enable trigger user`)
      const [slaCalc] = await sql(`
        select
          round(private.work_days(station_started_at, now()), 3) as raw_work_days,
          round(private.hold_days(id, station_started_at), 3) as hold_days,
          round(private.first_piece_wait_days(id, station_started_at), 3) as fp_wait_days,
          private.sla_state(id) as sla
        from public.jobs where id = $1
      `, [jSla])
      const netFromParts = Number(slaCalc.raw_work_days) - Number(slaCalc.hold_days) - Number(slaCalc.fp_wait_days)
      const segDays = Number(slaCalc.sla.segment_days)
      assert.ok(Math.abs(netFromParts - segDays) < 0.02, `segment_days (${segDays}) != raw-hold-fp (${netFromParts})`)

      // Finish print, press, cut, sew, qc_pack so jSla is done and included in Reports!
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'print', $3::text[])", [jSla, [await seedJpg(uid('prod1'), jSla, 'print', 'sla2')]])
      await as(uid('prod1'), "public.finish_station($2::uuid, 'print')", [jSla])
      for (const st of ['press', 'cut']) {
        await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jSla])
        const c = (await as(uid('prod1'), `public.submit_first_piece($2::uuid, '${st}', $3::text[]) as id`, [jSla, [await seedJpg(uid('prod1'), jSla, st, 'fp')]]))[0].id
        await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [c])
        await as(uid('prod1'), `public.add_finish_photos($2::uuid, '${st}', $3::text[])`, [jSla, [await seedJpg(uid('prod1'), jSla, st, 'fn')]])
        await as(uid('prod1'), `public.finish_station($2::uuid, '${st}')`, [jSla])
      }
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jSla])
      await as(uid('prod1'), "public.add_finish_photos($2::uuid, 'sew', $3::text[])", [jSla, [await seedJpg(uid('prod1'), jSla, 'sew', 'fn')]])
      await as(uid('prod1'), 'public.finish_sewing($2::uuid)', [jSla])
      await as(uid('qc'), 'public.start_in_queue($2::uuid, null)', [jSla])
      await as(uid('qc'), 'public.record_qc($2::uuid, 10)', [jSla])
      await as(uid('qc'), "public.add_finish_photos($2::uuid, 'qc_pack', $3::text[])", [jSla, [await seedJpg(uid('qc'), jSla, 'qc_pack', 'fn')]])
      await as(uid('qc'), "public.finish_station($2::uuid, 'qc_pack')", [jSla])

      await t.goto('admin1', `#/board?job=${jSla}`, 1440)
      await t.waitText('เวลาที่ใช้ต่อสถานี')
      const visitText = await t.ev(() => [...document.querySelectorAll('section')].find(s => s.innerText.includes('เวลาที่ใช้ต่อสถานี'))?.innerText ?? '')

      await t.goto('admin1', '#/reports', 1440)
      await t.waitText('เวลาเฉลี่ยต่อสถานี')
      const reportPrintText = await t.ev(() => [...document.querySelectorAll('li')].find(li => li.innerText.includes('พิมพ์งาน'))?.innerText ?? '')

      observations.push({ key: 'A6_sla_consistency', slaCalc, visitText, reportPrintText })
      return `DB segment_days=${segDays} (raw=${slaCalc.raw_work_days}, hold=${slaCalc.hold_days}, fp=${slaCalc.fp_wait_days}) · printReport="${reportPrintText.replace(/\s+/g, ' ')}"`
    })

    // === A.7 Inbox settings & reminders (5 / 15 / 60 min + toggles) ===
    await check('A7.inbox-reminders', 'A7 กล่องจดหมาย: เตือน 5/15/60 นาที + ปิดแจ้งเตือนทีละชนิด', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      for (const mins of [5, 15, 60]) {
        await as(uid('owner'), 'public.set_station_photos_enabled(true, $2::int)', [mins])
        await sql("update public.station_photo_settings set enabled_at = now() - interval '4 hours'")
        const jIn = await receiveJob(`SC-A7-${mins}`, 'cut_only', false)
        await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jIn])
        const cIn = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jIn, [await seedJpg(uid('prod1'), jIn, 'cut', 'in1')]]))[0].id
        await sql(`update public.jobs set station_started_at = now() - interval '3 hours' where id = $1`, [jIn])
        // Not yet late at mins - 1
        await sql(`update public.station_checks set sent_at = now() - make_interval(mins => $2) where id = $1`, [cIn, mins - 1])
        await as(uid('owner'), 'public.inbox_scan()')
        assert.equal((await sql("select 1 from public.inbox_messages where dedupe_key = $1", ['fpl:' + cIn])).length, 0, `${mins - 1}m ยังไม่ควรเตือน`)
        // Late at mins + 1 -> alerts ONCE
        await sql(`update public.station_checks set sent_at = now() - make_interval(mins => $2) where id = $1`, [cIn, mins + 1])
        await as(uid('owner'), 'public.inbox_scan()')
        await as(uid('owner'), 'public.inbox_scan()')
        const rowsLate = await sql("select audience, title from public.inbox_messages where dedupe_key = $1", ['fpl:' + cIn])
        assert.equal(rowsLate.length, 1, `${mins}m ต้องเตือน 1 ครั้ง`)
        assert.deepEqual(rowsLate[0].audience.sort(), ['manager', 'production'])
        // Clean up job so next iteration doesn't confuse
        await as(uid('manager'), "public.cancel_job($2::uuid, 'ล้างทดสอบแจ้งเตือน')", [jIn])
      }
      // Disable all 3 kinds in inbox_settings and test 0 emitted
      await sql("update public.inbox_settings set enabled = false where kind in ('first_piece_pending', 'first_piece_late', 'first_piece_rejected')")
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 5)')
      await sql("update public.station_photo_settings set enabled_at = now() - interval '2 hours'")
      const jMute = await receiveJob('SC-A7-MUTE', 'cut_only', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jMute])
      const cMute = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jMute, [await seedJpg(uid('prod1'), jMute, 'cut', 'm1')]]))[0].id
      await sql(`update public.jobs set station_started_at = now() - interval '1 hour' where id = $1`, [jMute])
      await sql(`update public.station_checks set sent_at = now() - interval '10 minutes' where id = $1`, [cMute])
      await as(uid('owner'), 'public.inbox_scan()')
      await as(uid('admin1'), "public.decide_first_piece($2::bigint, false, 'สีเพี้ยน')", [cMute])
      const mutedMsgs = await sql('select kind from public.inbox_messages where job_id = $1', [jMute])
      assert.equal(mutedMsgs.length, 0, 'ปิดการแจ้งเตือนทั้ง 3 ชนิดแล้วต้องไม่ส่ง: ' + JSON.stringify(mutedMsgs))
      await sql("update public.inbox_settings set enabled = true where kind in ('first_piece_pending', 'first_piece_late', 'first_piece_rejected')")
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      return '5/15/60m เตือนครั้งเดียว + ปิดทีละชนิดได้ผล'
    })

    // === A.10 Photo security ===
    await check('A10.photo-security', 'A10 ความปลอดภัยของรูป: สิทธิ์ดูรูป/อัปโหลดโฟลเดอร์ผิด, ลิงก์หมดอายุ, ส่งรูปซ้ำ', async () => {
      await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
      await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
      const jSec = await receiveJob('SC-A10-SEC', 'normal', false)
      await as(uid('prod1'), 'public.start_in_queue($2::uuid, null)', [jSec])
      const pSec = await seedJpg(uid('prod1'), jSec, 'print', 'sec1')
      const cSec = (await as(uid('prod1'), "public.submit_first_piece($2::uuid, 'print', $3::text[]) as id", [jSec, [pSec]]))[0].id

      // 1) Can anon / disabled / norole / staff_empty / staff_single (assigned only to cut, NOT print) sign or read pSec?
      const signCheck = async (actorKey) => {
        const tok = tokenOf(actorKey)
        const res = await fetch(`${stack.filesOrigin}/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
          body: JSON.stringify({ kind: 'station_photos', paths: [pSec], seconds: 3600 }),
        })
        const j = await res.json().catch(() => ({}))
        return { status: res.status, signed: !!j.urls?.[pSec] }
      }
      const anonSign = await signCheck('anon')
      const disabledSign = await signCheck('disabled')
      const noroleSign = await signCheck('norole')
      const staffEmptySign = await signCheck('staff_empty')
      const staffCutSign = await signCheck('staff_single')
      const adminSign = await signCheck('admin1')
      assert.equal(anonSign.status, 401)
      assert.equal(disabledSign.status, 403)
      assert.equal(noroleSign.status, 403)
      assert.ok(adminSign.signed)

      // Check what station_photo_flags() returns to staff_empty and staff_single!
      const flagsStaffEmpty = await callRpcHttp('staff_empty', 'station_photo_flags', {})
      const flagsStaffCut = await callRpcHttp('staff_single', 'station_photo_flags', {})

      // 2) Signed URL: tampered sig (403), expired link (410) via Worker createHandler
      const adminSignedUrl = (await (await fetch(`${stack.filesOrigin}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOf('admin1')}` },
        body: JSON.stringify({ kind: 'station_photos', paths: [pSec], seconds: 60 }),
      })).json()).urls[pSec]
      const getOk = await fetch(adminSignedUrl)
      assert.equal(getOk.status, 200)
      const getTampered = await fetch(adminSignedUrl.replace(/sig=[^&]+/, 'sig=deadbeef'))
      assert.equal(getTampered.status, 403)
      const expHandler = createHandler({ now: () => 5_000_000_000_000 })
      const fakeEnv = {
        FILES: { head: async () => null, get: async () => null },
        RECORD_SECRET: 'x', LINK_SECRET: 'r14-local-link-secret-0123456789abcdef',
        SUPABASE_URL: stack.origin, SUPABASE_ANON_KEY: 'r14-local-anon-key',
      }
      const resExpired = await expHandler(new Request(adminSignedUrl), fakeEnv)
      assert.equal(resExpired.status, 410, 'ลิงก์หมดอายุต้องคืน 410')

      // 3) Upload photo into folder of another job / station / visit -> test Worker PUT AND RPC!
      const validJpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
      const wrongFolderPath = `SC-OTHER-JOB/cut/99/hack01.jpg`
      const putWrongFolder = await fetch(`${stack.filesOrigin}/upload/station_photos/${wrongFolderPath}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tokenOf('staff_empty')}`, 'Content-Type': 'image/jpeg' },
        body: validJpgBytes,
      })
      // Now try submitting wrong-station / wrong-visit / wrong-job paths to RPC
      const jCutSec = await receiveJob('SC-A10-CUT', 'cut_only', false)
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [jCutSec])
      const badPaths = [
        wrongFolderPath,
        `SC-A10-CUT/print/1/bad1.jpg`, // wrong station
        `SC-A10-CUT/cut/99/bad2.jpg`,  // wrong visit
      ]
      for (const bp of badPaths) {
        await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, 12, 'image/jpeg', $2) on conflict do nothing", [bp, uid('staff_single')])
        const rBad = await callRpcHttp('staff_single', 'submit_first_piece', { p_job: jCutSec, p_station: 'cut', p_photos: [bp] })
        assert.ok(!rBad.ok && /ไม่ใช่ของงาน/.test(rBad.data?.message ?? ''), `ต้องปฏิเสธ path ${bp}: ${JSON.stringify(rBad)}`)
      }

      // 4) Send SAME photo twice:
      // (a) [p1, p1] in same call
      const pCutSec = await seedJpg(uid('staff_single'), jCutSec, 'cut', 'dup1')
      const rDupArr = await callRpcHttp('staff_single', 'submit_first_piece', { p_job: jCutSec, p_station: 'cut', p_photos: [pCutSec, pCutSec] })
      // check_station_photos deduplicates via array_agg(distinct x) -> sends 1 photo! Let's record what happened
      // (b) Approve c1, then try reusing THE EXACT SAME first_piece photo path pCutSec as finish photo in add_finish_photos!
      const cDup = rDupArr.data
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [cDup])
      const rReuseFpAsFinish = await callRpcHttp('staff_single', 'add_finish_photos', { p_job: jCutSec, p_station: 'cut', p_photos: [pCutSec] })
      // (c) Resubmit rejected photo path on another job
      const jRej = await receiveJob('SC-A10-REJ', 'cut_only', false)
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [jRej])
      const pRej = await seedJpg(uid('staff_single'), jRej, 'cut', 'rej1')
      const cRej = (await as(uid('staff_single'), "public.submit_first_piece($2::uuid, 'cut', $3::text[]) as id", [jRej, [pRej]]))[0].id
      await as(uid('admin1'), "public.decide_first_piece($2::bigint, false, 'สีเพี้ยน')", [cRej])
      const rResendSamePath = await callRpcHttp('staff_single', 'submit_first_piece', { p_job: jRej, p_station: 'cut', p_photos: [pRej] })

      observations.push({
        key: 'A10_security',
        signAccess: { anonSign, disabledSign, noroleSign, staffEmptySign, staffCutSign, adminSign },
        flagsForStaffEmptyCount: Array.isArray(flagsStaffEmpty.data) ? flagsStaffEmpty.data.length : flagsStaffEmpty,
        flagsForStaffCutCount: Array.isArray(flagsStaffCut.data) ? flagsStaffCut.data.length : flagsStaffCut,
        putWrongFolderByStaffEmpty: { status: putWrongFolder.status, body: await putWrongFolder.text() },
        dupInSameArray: { ok: rDupArr.ok, checkId: cDup },
        reuseFirstPieceAsFinish: { ok: rReuseFpAsFinish.ok, data: rReuseFpAsFinish.data },
        resendRejectedSamePath: { ok: rResendSamePath.ok, data: rResendSamePath.data },
      })
      return `anon/disabled/norole denied · expired=410 · wrongFolderPut=${putWrongFolder.status} · reuseFpAsFinish=${rReuseFpAsFinish.ok} · staffEmptySign=${staffEmptySign.signed}`
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
  console.log(`\nSUMMARY test-part-a-rules-sec: ${results.length - failed.length}/${results.length} passed`)
  if (chrome.externalAttempts.length > 0) throw new Error('EXTERNAL ATTEMPTS: ' + JSON.stringify(chrome.externalAttempts))
  process.exit(failed.length ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
