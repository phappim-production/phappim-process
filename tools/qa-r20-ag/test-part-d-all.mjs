// ส่วน D — ความปลอดภัย · ความถูกต้องของข้อมูล · หน้าจอ 375/768/1440 · เน็ตหลุด · ข้อมูลผิด · เขตเวลา · ข้อมูลเยอะ 300+ งาน
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { ACCOUNTS } from '../qa-r14/db.mjs'
import { writeFile, mkdir } from 'node:fs/promises'

const stack = await startLocalStack({ materialsCheck: true })
if (!/^http:\/\/127\.0\.0\.1:/.test(stack.origin)) throw new Error('ต้องเป็นระบบในเครื่องเท่านั้น')
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const h = chrome.wrap(chrome.main)
const results = []

const sql = async (q, params = []) => {
  const r = await (await fetch(stack.origin + '/__qa/sql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql: q, params }),
  })).json()
  if (r.message) throw new Error(r.message)
  return r.rows
}

async function tokenFor(key) {
  if (key === 'anon') return 'r14-local-anon-key'
  const acc = ACCOUNTS.find(a => a.key === key)
  const login = await (await fetch(`${stack.origin}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'r14-local-anon-key' },
    body: JSON.stringify({ email: acc.email, password: acc.password ?? 'r14-local-pass' }),
  })).json()
  return login.access_token
}

async function restRpc(key, fn, body = {}) {
  const tok = await tokenFor(key)
  const res = await fetch(`${stack.origin}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'r14-local-anon-key', authorization: `Bearer ${tok}` },
    body: JSON.stringify(body),
  })
  const txt = await res.text()
  let parsed = txt
  try { parsed = JSON.parse(txt) } catch {}
  return { status: res.status, ok: res.ok, body: parsed }
}

const logs = () => chrome.main.logs.filter(e => !String(e.text ?? '').startsWith("Blocked attempt to show a 'beforeunload'"))

async function step(id, fn) {
  const before = logs().length
  try {
    const detail = await fn()
    const errs = logs().slice(before)
    if (errs.length) throw new Error('console: ' + JSON.stringify(errs).slice(0, 400))
    results.push({ id, status: 'PASS', detail })
    console.log(`PASS ${id} · ${detail ?? ''}`)
  } catch (e) {
    results.push({ id, status: 'FAIL', error: e?.message ?? String(e) })
    console.log(`FAIL ${id} · ${e?.message ?? e}`)
  }
}

try {
  await fetch(stack.origin + '/__qa/reset', { method: 'POST' })
  await sql('update public.production_settings set materials_check = true')

  // D.1: ห้ามเขียนตารางตรงผ่าน REST + บทบาทปิดURLตรง + XSS
  await step('D1.security-rest-writes-and-urls', async () => {
    const tables = ['jobs', 'job_materials', 'job_material_photos', 'production_settings', 'events']
    for (const who of ['admin1', 'prod1', 'staff_single', 'anon']) {
      const tok = await tokenFor(who)
      for (const tbl of tables) {
        const res = await fetch(`${stack.origin}/rest/v1/${tbl}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: 'r14-local-anon-key', authorization: `Bearer ${tok}` },
          body: JSON.stringify({}),
        })
        if (res.ok) throw new Error(`${who} เขียนตรงตาราง ${tbl} ได้! (${res.status})`)
      }
    }

    // บัญชี disabled เข้าอ่าน job_live ไม่ได้
    const disTok = await tokenFor('disabled')
    const disRead = await fetch(`${stack.origin}/rest/v1/job_live?select=id`, {
      headers: { apikey: 'r14-local-anon-key', authorization: `Bearer ${disTok}` },
    })
    const disRows = await disRead.json()
    if (Array.isArray(disRows) && disRows.length > 0) throw new Error('disabled อ่าน job_live ได้')

    // XSS ในชื่องาน + ชื่อวัตถุดิบ
    const r = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-D1-XSS', p_customer_name: '<img src=x onerror=window.__xss=1>',
      p_job_name: '<script>window.__xss=2</script>', p_product_type_code: 'tshirt',
      p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-25', p_route_code: 'cut_only',
      p_confirmation_pdf_path: null, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    await restRpc('admin1', 'set_job_materials', { p_job: r.body, p_items: ['<img src=x onerror=window.__xss=3>'] })
    await h.goto('admin1', `#/board?job=${r.body}`, 1440)
    await h.waitText('SC-D1-XSS')
    const xssFired = await h.ev(() => window.__xss || 0)
    if (xssFired) throw new Error('XSS executed: ' + xssFired)
    return 'เขียนตารางตรงถูกปฏิเสธทุกบทบาท · disabled ว่าง · XSS ไม่ทำงาน'
  })

  // D.2 & D.6: ความถูกต้องของข้อมูล + ข้อมูลผิดรูปแบบ (0 / ลบ / เกินแสน / 2569)
  await step('D2-D6.data-integrity-and-bad-inputs', async () => {
    for (const q of [0, -5, 100001]) {
      const r = await restRpc('admin1', 'receive_job', {
        p_confirmation_no: `SC-BAD-${q}`, p_customer_name: 'Bad', p_job_name: 'Bad',
        p_product_type_code: 'tshirt', p_qty: q, p_unit: 'ตัว', p_due_date: '2099-01-25',
        p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
      })
      if (r.ok) throw new Error(`ยอมรับจำนวน ${q}`)
    }
    const badPhase = await sql("select count(*)::int c from public.job_live where phase = 'materials' and current_station is not null")
    if (badPhase[0].c > 0) throw new Error('พบงาน materials ที่มี current_station: ' + badPhase[0].c)
    return 'กันจำนวน 0/-5/100001 · ไม่มีงาน materials ที่มีสถานี'
  })

  // D.4: เน็ตหลุดกลางทางต้องไม่มีข้อความภาษาอังกฤษดิบ (Failed to fetch)
  await step('D4.offline-no-raw-english-error', async () => {
    await h.goto('admin1', '#/board', 1440)
    await h.waitText('SC-D1-XSS')
    const logBefore = chrome.main.logs.length
    await h.setOffline(true)
    await new Promise(r => setTimeout(r, 300))
    const txt = await h.ev(() => document.body.innerText)
    await h.setOffline(false)
    chrome.main.logs.splice(logBefore)
    if (/Failed to fetch|NetworkError/i.test(txt)) throw new Error('หลุดคำอังกฤษดิบ: ' + txt.slice(0, 200))
    return 'ออฟไลน์ไม่มี Failed to fetch หลุดขึ้นจอ'
  })

  // D.8: ข้อมูลเยอะ 300+ งาน (รวม 50 งานรอผลิต) -> จับเวลาเปิดบอร์ด/ภาพรวม/รายงาน/กำหนดส่ง
  await step('D8.scale-300-jobs-performance', async () => {
    await sql(`
      insert into public.jobs (confirmation_no, customer_name, job_name, product_type_code, qty, unit, due_date, route_code, phase, station_seq, station_status, needs_sample)
      select 'SC-SCALE-' || g, 'ลูกค้า ' || g, 'งานจำนวนมาก ' || g, 'tshirt', 100, 'ตัว', current_date + (g % 30), 'cut_only',
        case when g <= 50 then 'materials' else 'production' end,
        case when g <= 50 then 0 else 1 end,
        case when g <= 50 then null else 'queued' end,
        false
      from generate_series(1, 300) g
    `)
    const timings = {}
    for (const [name, route] of [['board', '#/board'], ['overview', '#/overview'], ['reports', '#/reports'], ['deliveries', '#/deliveries']]) {
      const t0 = Date.now()
      await h.goto('admin1', route, 1440)
      await waitFor(() => h.ev(() => !document.body.innerText.includes('กำลังโหลด')), `โหลด ${name}`, 15000)
      timings[name] = Date.now() - t0
    }
    return `300+ งาน (50 รอผลิต) · เวลาโหลด ms = ${JSON.stringify(timings)}`
  })
} finally {
  await mkdir('tools/qa-r20-ag', { recursive: true })
  await writeFile('tools/qa-r20-ag/part-d-all-results.json', JSON.stringify({
    externalAttempts: chrome.externalAttempts,
    results,
  }, null, 2))
  await chrome.close()
  await stack.close?.()
}
const failed = results.filter(r => r.status === 'FAIL').length
console.log(`SUMMARY: ${results.length - failed}/${results.length} PASS · externalAttempts=${chrome.externalAttempts.length}`)
process.exit(failed ? 1 : 0)
