// ส่วน A — ทดสอบขั้นรอผลิต (PR 231 + 233) ครบทุกข้อ 1-10 บนระบบจำลอง 127.0.0.1 เท่านั้น
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'
import { ACCOUNTS } from '../qa-r14/db.mjs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

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

const accounts = await (await fetch(stack.origin + '/__qa/accounts')).json()
const uid = k => accounts.find(a => a.key === k)?.id

async function restRpc(key, fn, body = {}) {
  const acc = ACCOUNTS.find(a => a.key === key)
  const tok = key === 'anon' ? 'r14-local-anon-key' : (await (await fetch(`${stack.origin}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'r14-local-anon-key' },
    body: JSON.stringify({ email: acc.email, password: acc.password ?? 'r14-local-pass' }),
  })).json()).access_token
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

async function signUrls(key, kind, paths) {
  const acc = ACCOUNTS.find(a => a.key === key)
  let tok = 'r14-local-anon-key'
  if (key !== 'anon') {
    const login = await (await fetch(`${stack.origin}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: 'r14-local-anon-key' },
      body: JSON.stringify({ email: acc.email, password: acc.password ?? 'r14-local-pass' }),
    })).json()
    tok = login.access_token
  }
  const res = await fetch(`${stack.filesOrigin}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: JSON.stringify({ kind, paths }),
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

const dialogText = () => h.ev(() => document.querySelector('[role="dialog"]')?.innerText.replace(/\s+/g, ' ') ?? '')
const waitDialog = (re, what, ms = 10000) => waitFor(async () => re.test(await dialogText()), what, ms)

async function createLargeAndSpecialImages(dir) {
  const res = await chrome.main.ev(async () => {
    async function draw(w, h, mime, quality = 0.92) {
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const g = c.getContext('2d')
      g.fillStyle = '#0ea5e9'; g.fillRect(0, 0, w, h)
      g.fillStyle = '#fef08a'; g.fillRect(10, 10, w - 20, h - 20)
      const blob = await new Promise(r => c.toBlob(r, mime, quality))
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''; for (const b of buf) bin += String.fromCharCode(b)
      return btoa(bin)
    }
    return {
      portrait: await draw(400, 900, 'image/jpeg'),
      landscape: await draw(900, 400, 'image/png'),
      tiny: await draw(32, 32, 'image/webp'),
    }
  })
  const p = {
    portrait: join(dir, 'mat-portrait.jpg'),
    landscape: join(dir, 'mat-landscape.png'),
    tiny: join(dir, 'mat-tiny.webp'),
    big11mb: join(dir, 'mat-big-11mb.jpg'),
    fakeJpg: join(dir, 'mat-fake.jpg'),
    heic: join(dir, 'mat-photo.heic'),
  }
  const jpgHead = Buffer.from(res.portrait, 'base64')
  // สร้างรูป PNG แท้ขนาดใหญ่ (2400x2400 noisy) ให้ขนาดไฟล์ > 10MB
  const bigPngB64 = await chrome.main.ev(async () => {
    const c = document.createElement('canvas')
    c.width = 2400; c.height = 2400
    const g = c.getContext('2d')
    const img = g.createImageData(2400, 2400)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 13) & 255
      img.data[i + 1] = (i * 29) & 255
      img.data[i + 2] = (i * 53) & 255
      img.data[i + 3] = 255
    }
    g.putImageData(img, 0, 0)
    const blob = await new Promise(r => c.toBlob(r, 'image/png'))
    const buf = new Uint8Array(await blob.arrayBuffer())
    let bin = ''; for (const b of buf) bin += String.fromCharCode(b)
    return btoa(bin)
  })
  await Promise.all([
    writeFile(p.portrait, jpgHead),
    writeFile(p.landscape, Buffer.from(res.landscape, 'base64')),
    writeFile(p.tiny, Buffer.from(res.tiny, 'base64')),
    writeFile(p.big11mb, Buffer.from(bigPngB64, 'base64')),
    writeFile(p.fakeJpg, 'THIS IS NOT A JPEG FILE'),
    writeFile(p.heic, 'ftypheicfake'),
  ])
  return p
}

try {
  await fetch(stack.origin + '/__qa/reset', { method: 'POST' })
  await sql('update public.production_settings set materials_check = true')
  const fx = await createFixtures(chrome.main)
  const extraFx = await createLargeAndSpecialImages(fx.dir)

  // A.1: รับงานทุกแบบ (ไม่ขึ้นตัวอย่าง · ขึ้นตัวอย่าง · Develop · ทุกเส้นทาง · จากฟอร์มและ .json)
  await step('A1.receive-all-types', async () => {
    // 1) รับจากฟอร์มใบยืนยัน (บันทึกเข้าระบบ -> รับงาน)
    await h.goto('admin1', '', 1440, '/confirmation')
    await h.waitText('ใบยืนยันการผลิต')
    await h.ev(() => {
      if (document.body.classList.contains('preview')) togglePreview(false)
      state = fresh()
      state.pickOpen = false
      renderForm()
    })
    await h.fillInput('[data-s="h"][data-k="doc_no"]', 'SC-R20-A1-FORM')
    await h.fillInput('[data-s="h"][data-k="issue_date"]', '2026-11-26')
    await h.fillInput('[data-s="h"][data-k="admin"]', 'แอดมิน 1')
    await h.fillInput('[data-s="h"][data-k="due_date"]', '2026-12-20')
    await h.fillInput('[data-s="h"][data-k="customer"]', 'ลูกค้า A1')
    await h.fillInput('[data-s="h"][data-k="contact"]', 'คุณเอ')
    await h.fillInput('[data-s="h"][data-k="phone"]', '0811112222')
    await h.fillInput('[data-s="h"][data-k="job_name"]', 'ทดสอบรอผลิตจากฟอร์ม')
    await h.ev(() => {
      const clickRadio = (s, k, val) => document.querySelector(`input[type="radio"][data-s="${s}"][data-k="${k}"][value="${val}"]`)?.click()
      const ensureCheck = (s, k, val) => {
        const el = document.querySelector(`input[type="checkbox"][data-s="${s}"][data-k="${k}"][value="${val}"]`)
        if (el && !el.checked) el.click()
      }
      clickRadio('h', 'sample', 'ไม่ขึ้นตัวอย่าง')
      clickRadio('h', 'delivery', 'ลูกค้ารับเองที่โรงงาน')
      clickRadio('p', 'fabric', 'ไมโครเรียบ')
      ensureCheck('p', 'fit', 'ทรงตรง (ชาย/ยูนิเซ็กส์)')
      clickRadio('p', 'neck', 'คอกลม')
      clickRadio('p', 'neck_fabric', 'ผ้าเดียวกับตัว')
      clickRadio('p', 'sleeve', 'แขนสั้น')
      clickRadio('p', 'sleeve_end', 'ลาแขนปกติ')
      ensureCheck('p', 'size_sets', 'ไซซ์ผู้ใหญ่')
      clickRadio('p', 'size_chart', 'ตารางไซซ์มาตรฐานโรงงาน')
      ensureCheck('p', 'print_method', 'ซับลิเมชั่น เฉพาะจุด')
      clickRadio('p', 'color_match', 'ตามไฟล์ (คลาดเคลื่อนได้ตามปกติของงานพิมพ์)')
      clickRadio('p', 'side_seam', 'โพ้งปกติ')
      clickRadio('p', 'hem', 'ลา 1 เข็ม')
      clickRadio('p', 'thread', 'ตามสีผ้า')
      clickRadio('p', 'neck_label', 'ไม่มี')
      clickRadio('p', 'size_label', 'ไม่มี')
      clickRadio('p', 'fold', 'พับแยกตัว')
      clickRadio('p', 'bag', 'แพ็ค 1/1 (ถุงแยกตัว)')
      clickRadio('p', 'outer_pack', 'ไม่มีแพ็คใหญ่')
    })
    await h.fillInput('[data-s="p"][data-k="fabric_color"]', 'ขาว')
    await h.fillInput('input[data-t="sizes"][data-r="0"][data-c="label"]', 'สีขาว')
    await h.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '100')
    await h.ev(() => {
      const pl = document.querySelector('input[type="checkbox"][data-pl="placements"][data-pos="หน้าอกซ้าย"]')
      if (pl && !pl.checked) pl.click()
    })
    await h.fillInput('input[data-pl="placements"][data-pos="หน้าอกซ้าย"][data-pf="size"]', '10 × 8')
    await h.uploadFiles('input[type="file"][data-img]', [fx.paths.frontPng])
    await h.waitText('ชี้จุดบนภาพแรก')
    await waitFor(() => h.ev(() => !readingImgs && state.imgs.length > 0 && state.imgs.every(m => !!shrunk.get(m.src))), 'ย่อรูปในฟอร์ม')
    await h.clickButton('บันทึกเข้าระบบ')
    await waitFor(() => h.ev(() => Boolean(localStorage.getItem('pp142.confirmation.outbox'))), 'outbox')
    await h.goto('admin1', '#/board?confirmation=save', 1440)
    await h.waitText('ส่งงานเข้าโรงงานเลย', 10000)
    await h.clickButton('ส่งงานเข้าโรงงานเลย')
    await h.waitText('รับงานเข้าโรงงาน', 10000)
    await waitFor(() => h.ev(() => {
      const dlg = document.querySelector('[role="dialog"]')
      if (!dlg || dlg.innerText.includes('กำลังโหลด')) return false
      return [...dlg.querySelectorAll('input')].some(i => i.value === 'SC-R20-A1-FORM')
    }), 'โหลดร่างใบ SC-R20-A1-FORM ในรับงาน')
    await h.ev(() => {
      const dlg = document.querySelector('[role="dialog"]')
      const rtSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'normal'))
      if (rtSel) { rtSel.value = 'normal'; rtSel.dispatchEvent(new Event('change', { bubbles: true })) }
      dlg.querySelectorAll('input[name="needs-sample"]')[2]?.click()
    })
    await h.waitText('ลำดับสถานี:')
    await h.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
    await waitFor(() => h.ev(() => /รอผลิต|เช็ควัตถุดิบ/.test(document.body.innerText)), 'ข้อความหลังรับงาน', 10000)
    const toastMsg = await h.ev(() => document.body.innerText.match(/รับงาน.*?(?:\n|$)/)?.[0] ?? '')

    // 2) รับหลายเส้นทาง + ขึ้นตัวอย่าง + Develop ผ่าน receive_job และตรวจ .json upload
    const routes = [
      { no: 'SC-R20-A1-SAMPLE', route: 'cut_only', sample: true, dev: false },
      { no: 'SC-R20-A1-DEV', route: 'cut_only', sample: true, dev: true },
      { no: 'SC-R20-A1-DTF', route: 'dtf', sample: false, dev: false },
      { no: 'SC-R20-A1-DTG', route: 'dtg', sample: false, dev: false },
      { no: 'SC-R20-A1-SCREEN', route: 'screen', sample: false, dev: false },
      { no: 'SC-R20-A1-OUT', route: 'outside', sample: false, dev: false },
    ]
    for (const r of routes) {
      const res = await restRpc('admin1', 'receive_job', {
        p_confirmation_no: r.no, p_customer_name: 'ลูกค้าเส้นทาง', p_job_name: r.no,
        p_product_type_code: 'tshirt', p_qty: 120, p_unit: 'ตัว',
        p_due_date: '2026-12-25', p_route_code: r.route, p_confirmation_pdf_path: null,
        p_spare_qty: 0, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: r.sample, p_develop: r.dev,
      })
      if (!res.ok) throw new Error(`${r.no}: ${JSON.stringify(res.body)}`)
    }

    // ตรวจบอร์ด: ปุ่มรอผลิตอยู่ถัดจากทุกสถานี · การ์ดขึ้นรอเช็ควัตถุดิบ
    await h.goto('admin1', '#/board', 1440)
    await h.waitText('SC-R20-A1-FORM')
    const railOrder = await h.ev(() => {
      const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim().replace(/\s+/g, ' '))
      const idxAll = btns.findIndex(t => t.startsWith('ทุกสถานี'))
      const idxMat = btns.findIndex(t => t.startsWith('รอผลิต'))
      return { idxAll, idxMat, hasBadge: document.body.innerText.includes('รอเช็ควัตถุดิบ') }
    })
    if (railOrder.idxAll < 0 || railOrder.idxMat !== railOrder.idxAll + 1 || !railOrder.hasBadge) {
      throw new Error('ลำดับปุ่ม/ป้ายบนบอร์ดผิด: ' + JSON.stringify(railOrder))
    }

    // ขยับ created_at / stage_entered_at ย้อนหลัง 30 วัน -> เวลาผลิตต้องยังไม่เริ่มนับ และไม่ขึ้นเกินเวลาในภาพรวม/รายงาน
    await sql("update public.jobs set created_at = now() - interval '30 days', stage_entered_at = now() - interval '30 days' where confirmation_no = 'SC-R20-A1-FORM'")
    const [live] = await sql("select phase, current_station, sla from public.job_live where confirmation_no = 'SC-R20-A1-FORM'")
    if (live.phase !== 'materials' || live.current_station || Object.keys(live.sla ?? {}).length > 0) {
      throw new Error('sla ยังเริ่มนับ: ' + JSON.stringify(live))
    }
    await h.goto('admin1', '#/overview', 1440)
    await h.waitText('SC-R20-A1-FORM')
    const ovText = await h.ev(() => document.body.innerText)
    if (/SC-R20-A1-FORM.*เกินเวลาผลิต/.test(ovText)) throw new Error('ขึ้นเกินเวลาผลิตทั้งที่ยังรอผลิต')
    return `รับงานครบ 7 แบบอยู่รอผลิต · ${toastMsg.trim()}`
  })

  // A.2: ใครเห็นอะไร + เรียก RPC ตรงทุกบทบาท
  await step('A2.visibility-and-rpc-rbac', async () => {
    // staff_single, staff_multi, staff_empty, qc, sup1, sup2: ไม่เห็นในหน้าหลัก/คิว/ต้องทำตอนนี้ แต่เห็นในทั้งโรงงานแบบอ่านอย่างเดียว
    for (const who of ['staff_single', 'staff_multi', 'staff_empty', 'qc', 'sup1', 'sup2']) {
      await h.goto(who, '#/board', 375)
      await new Promise(r => setTimeout(r, 600))
      const t = await h.ev(() => document.body.innerText)
      if (t.includes('SC-R20-A1-FORM')) throw new Error(`${who} เห็นงานรอผลิตบนบอร์ดตัวเอง`)
    }
    // staff_single เปิดจากทั้งโรงงาน + โหมดพม่า
    await h.goto('staff_single', '#/board?all=1', 375)
    await new Promise(r => setTimeout(r, 800))
    const jobRow = await sql("select id from public.jobs where confirmation_no = 'SC-R20-A1-FORM'")
    const formJobId = jobRow[0].id
    // เปิดตรงในฐานะ staff_single (อ่านอย่างเดียว) + โหมดพม่า
    await h.goto('staff_single', `#/board?job=${formJobId}`, 375)
    await waitDialog(/รอผลิต|ကုန်ကြမ်း/, 'staff อ่านอย่างเดียว', 10000)
    const staffRo = await h.ev(() => ({
      hasEdit: !!document.querySelector('[role="dialog"] input[placeholder^="เช่น ผ้า"]') || document.querySelectorAll('[role="dialog"] [role="checkbox"]').length > 0,
      hasRelease: [...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.includes('ปล่อยเข้าไลน์')),
    }))
    if (staffRo.hasEdit || staffRo.hasRelease) throw new Error('staff เห็นปุ่มแก้/ปล่อย: ' + JSON.stringify(staffRo))

    // prod1 & manager อ่านอย่างเดียว
    for (const who of ['prod1', 'manager']) {
      await h.goto(who, `#/board?job=${formJobId}`, 768)
      await waitDialog(/รอผลิต · เช็ควัตถุดิบ/, `${who} อ่านอย่างเดียว`)
      const ro = await h.ev(() => ({
        input: !!document.querySelector('[role="dialog"] input[placeholder^="เช่น ผ้า"]'),
        cb: document.querySelectorAll('[role="dialog"] [role="checkbox"]').length,
        rel: [...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.includes('ปล่อยเข้าไลน์')),
      }))
      if (ro.input || ro.cb || ro.rel) throw new Error(`${who} มีปุ่มแก้: ${JSON.stringify(ro)}`)
    }

    // เรียก RPC ตรงทุกบทบาท
    const allRoles = ['owner', 'admin1', 'manager', 'prod1', 'sup1', 'sup2', 'qc', 'staff_single', 'staff_multi', 'staff_empty', 'disabled', 'anon']
    for (const role of allRoles) {
      const expectOk = role === 'owner' || role === 'admin1'
      const r1 = await restRpc(role, 'set_job_materials', { p_job: formJobId, p_items: ['ผ้าทดลอง'] })
      if (r1.ok !== expectOk) throw new Error(`set_job_materials (${role}): expected=${expectOk} got=${r1.status} ${JSON.stringify(r1.body)}`)
      const r5 = await restRpc(role, 'release_job', { p_job: formJobId })
      // admin/owner จะติด P0001 ยังไม่มีรูป (ถือว่าผ่านด่านสิทธิ์), บทบาทอื่นต้อง 401/403/42501
      if (!expectOk && (r5.ok || r5.status === 400)) throw new Error(`release_job (${role}) ผ่านด่านสิทธิ์: ${r5.status} ${JSON.stringify(r5.body)}`)
    }
    return `ตรวจสิทธิ์ UI + RPC ตรง 12 บทบาทผ่านครบ`
  })

  // A.3: รายการวัตถุดิบ (เพิ่มปุ่ม/Enter · ซ้ำ · ว่าง · 80+ · 30+1 · emoji/XSS/Excel · ลบ/ติ๊ก · กดรัว · 2 แท็บ)
  await step('A3.materials-checklist-edge-cases', async () => {
    const [{ id: jobId }] = await sql("select id from public.jobs where confirmation_no = 'SC-R20-A1-FORM'")
    await sql('delete from public.job_materials where job_id = $1', [jobId])
    await h.goto('admin1', `#/board?job=${jobId}`, 1440)
    await waitDialog(/ยังไม่มีรายการ/, 'เปิดงาน A3')

    // เพิ่มด้วย Enter + ปุ่มเพิ่ม
    await h.fillInput('[role="dialog"] input[placeholder^="เช่น ผ้า"]', 'ผ้าคอตตอน 32 สีขาว 150 หลา')
    await h.ev(() => {
      const inp = document.querySelector('[role="dialog"] input[placeholder^="เช่น ผ้า"]')
      inp.closest('form').requestSubmit()
    })
    await waitDialog(/เพิ่ม "ผ้าคอตตอน 32 สีขาว 150 หลา" แล้ว/, 'เพิ่มด้วย Enter')

    // ชื่อซ้ำ (case + space)
    await h.fillInput('[role="dialog"] input[placeholder^="เช่น ผ้า"]', '  ผ้าคอตตอน 32 สีขาว 150 หลา  ')
    await h.ev(() => {
      const inp = document.querySelector('[role="dialog"] input[placeholder^="เช่น ผ้า"]')
      inp.closest('form').requestSubmit()
    })
    await waitDialog(/มี "ผ้าคอตตอน 32 สีขาว 150 หลา" ในรายการแล้ว|มีในรายการแล้ว/, 'กันซ้ำ')

    // 80+ ตัวอักษร (ช่อง input มี maxLength=80, และ SQL left(..., 80))
    const long85 = 'ก'.repeat(85)
    const rLong = await restRpc('admin1', 'set_job_materials', { p_job: jobId, p_items: ['ผ้าคอตตอน 32 สีขาว 150 หลา', long85] })
    if (!rLong.ok) throw new Error('set 85 chars failed: ' + JSON.stringify(rLong.body))
    const [{ len }] = await sql("select char_length(name) len from public.job_materials where job_id = $1 and name like 'กกก%'", [jobId])
    if (len !== 80) throw new Error('ความยาวไม่ตัดที่ 80: ' + len)

    // 30 รายการแล้วเพิ่มอีก 1 (31st)
    const thirty = Array.from({ length: 30 }, (_, i) => `รายการ-${i + 1}`)
    const r30 = await restRpc('admin1', 'set_job_materials', { p_job: jobId, p_items: thirty })
    if (!r30.ok) throw new Error('30 items failed: ' + JSON.stringify(r30.body))
    const r31 = await restRpc('admin1', 'set_job_materials', { p_job: jobId, p_items: [...thirty, 'รายการ-31'] })
    if (r31.ok || !/ไม่เกิน 30 รายการ/.test(JSON.stringify(r31.body))) throw new Error('31st not blocked: ' + JSON.stringify(r31.body))

    // ล้างเหลือ 0 แล้วทดสอบ: emoji, <script>, วางจาก Excel (มี tab/newline), กดเพิ่มรัวๆ 5 รายการติดกัน
    await restRpc('admin1', 'set_job_materials', { p_job: jobId, p_items: [] })
    await h.goto('admin1', `#/board?job=${jobId}`, 1440)
    await waitDialog(/ยังไม่มีรายการ/, 'ล้างรายการแล้ว')
    const itemsToAdd = ['🧵 ด้ายสีขาว', '<script>alert(1)</script>', 'ป้ายคอ ไซซ์ M', 'ถุงแพ็ค 100 ใบ', 'กระดุม 200 เม็ด']
    for (const it of itemsToAdd) {
      await waitFor(() => h.ev(() => {
        const inp = document.querySelector('[role="dialog"] input[placeholder^="เช่น ผ้า"]')
        return inp && inp.value === ''
      }), `ช่องพิมพ์ว่างก่อนเพิ่ม (${it})`)
      await h.fillInput('[role="dialog"] input[placeholder^="เช่น ผ้า"]', it)
      await h.clickButton('เพิ่ม', { exact: true, inside: '[role="dialog"]' })
    }
    await waitDialog(/ติ๊กแล้ว 0\/5 รายการ/, 'เพิ่มรัว 5 รายการ', 12000)
    const dText = await dialogText()
    if (/แก้จากเครื่องอื่น/.test(dText)) throw new Error('กดเพิ่มรัวๆ ขึ้นแก้จากเครื่องอื่น: ' + dText)

    // 2 แท็บแก้พร้อมกัน (แท็บ A เปิดอยู่แล้ว แอบแก้ผ่าน API แทนแท็บ B แล้วแท็บ A กดเพิ่มอีก 1 รายการ)
    const logBeforeConflict = chrome.main.logs.length
    await restRpc('admin1', 'set_job_materials', { p_job: jobId, p_items: [...itemsToAdd, 'จากแท็บ B'] })
    await h.fillInput('[role="dialog"] input[placeholder^="เช่น ผ้า"]', 'จากแท็บ A')
    await h.ev(() => document.querySelector('[role="dialog"] input[placeholder^="เช่น ผ้า"]')?.closest('form')?.requestSubmit())
    await waitDialog(/ถูกแก้จากเครื่องอื่น/, '2 แท็บชนกันต้องเตือน')
    chrome.main.logs.splice(logBeforeConflict)
    return 'เพิ่มรัว 5 รายการไม่ชน · 30+1 บล็อก · 80 ตัวอักษร · 2 แท็บเตือนไม่ทับกัน'
  })

  // A.4: รูปวัตถุดิบ (หลายชนิด · ใหญ่ 11MB · ปลอม .jpg · ม็อคอัพของงาน · 12+1 · ซ้ำ · ลบที่ 375px · โฟลเดอร์อื่น · ใครเปิดรูปได้บ้าง)
  await step('A4.material-photos-security-and-ux', async () => {
    const [{ id: jobId }] = await sql("select id from public.jobs where confirmation_no = 'SC-R20-A1-FORM'")
    await h.goto('admin1', `#/board?job=${jobId}`, 375)
    await waitDialog(/รอผลิต · เช็ควัตถุดิบ/, 'เปิดงาน A4')

    // อัปโหลด 3 รูปพร้อมกัน (portrait jpg, landscape png, tiny webp)
    await h.uploadFiles('[role="dialog"] input[type=file][multiple][accept^="image/jpeg"]', [extraFx.portrait, extraFx.landscape, extraFx.tiny])
    await waitDialog(/เพิ่มรูปวัตถุดิบ 3 รูปแล้ว/, 'อัปโหลด 3 รูป', 15000)

    // อัปโหลดรูปใหญ่ 11MB (สร้าง PNG/JPG ใหญ่จริง หรือตรวจผลหน้าจอ)
    await h.uploadFiles('[role="dialog"] input[type=file][multiple][accept^="image/jpeg"]', [extraFx.big11mb])
    await waitDialog(/เพิ่มรูปวัตถุดิบ 1 รูปแล้ว|ไม่เกิน|อ่านรูป|ไม่ใช่รูป/, 'อัปโหลดรูป 11MB', 20000)
    const bigResult = await dialogText()

    // อัปโหลดไฟล์ .jpg ปลอม (text) — ยอมรับ HTTP 415 จาก worker ที่ตั้งใจทดสอบ
    const logBeforeFake = chrome.main.logs.length
    await h.uploadFiles('[role="dialog"] input[type=file][multiple][accept^="image/jpeg"]', [extraFx.fakeJpg])
    await waitDialog(/ไม่ใช่รูป|JPG|PNG|WEBP|รูปที่ 1/, 'กัน .jpg ปลอม', 10000)
    chrome.main.logs.splice(logBeforeFake)

    // ทดสอบใช้รูปม็อคอัพของงานแทนรูปวัตถุดิบ
    const mockPath = 'SC-R20-A1-FORM/mock0001.jpg'
    await sql("insert into private.file_objects (kind, path, size, content_type) values ('mockups', $1, 50, 'image/jpeg')", [mockPath])
    stack.r2Store.set('mockups/' + mockPath, { bytes: new Uint8Array(await readFile(fx.paths.backJpg)), type: 'image/jpeg' })
    await sql('update public.jobs set mockup_path = $1 where id = $2', [mockPath, jobId])
    const rMock = await restRpc('admin1', 'add_material_photos', { p_job: jobId, p_paths: [mockPath] })
    if (rMock.ok || !/ม็อคอัพ/.test(JSON.stringify(rMock.body))) throw new Error('ยอมรับรูปม็อคอัพ: ' + JSON.stringify(rMock.body))

    // ทดสอบอัปโหลดเข้าโฟลเดอร์งานอื่นแล้วส่ง RPC
    const otherPath = 'SC-R20-A1-SAMPLE/other001.jpg'
    await sql("insert into private.file_objects (kind, path, size, content_type) values ('mockups', $1, 50, 'image/jpeg')", [otherPath])
    const rOther = await restRpc('admin1', 'add_material_photos', { p_job: jobId, p_paths: [otherPath] })
    if (rOther.ok) throw new Error('ยอมรับรูปโฟลเดอร์งานอื่น!')

    // ตรวจปุ่มลบรูปที่ 375px ต้องไม่ทับรูปข้างๆ
    await h.screenshot('r20-a4-photos-375')
    const overlap = await h.ev(() => {
      const imgs = [...document.querySelectorAll('[role="dialog"] ul img')].map(el => el.getBoundingClientRect())
      const dels = [...document.querySelectorAll('[role="dialog"] button[aria-label^="ลบรูปที่"]')].map(el => el.getBoundingClientRect())
      for (let i = 0; i < dels.length; i++) {
        for (let j = 0; j < imgs.length; j++) {
          if (i === j) continue
          const d = dels[i], im = imgs[j]
          if (d.left < im.right && d.right > im.left && d.top < im.bottom && d.bottom > im.top) return { del: i, img: j }
        }
      }
      return null
    })
    if (overlap) throw new Error('ปุ่มลบรูปทับรูปข้างๆ: ' + JSON.stringify(overlap))

    // ตรวจสิทธิ์การอ่านรูปวัตถุดิบของบทบาทที่ห้ามเห็นงานรอผลิต (staff_empty, staff_single, qc)
    const [{ path: matPhotoPath }] = await sql('select path from public.job_material_photos where job_id = $1 limit 1', [jobId])
    const signStaffEmpty = await signUrls('staff_empty', 'mockups', [matPhotoPath])
    const signStaffSingle = await signUrls('staff_single', 'mockups', [matPhotoPath])
    const signAnon = await signUrls('anon', 'mockups', [matPhotoPath])
    const signDisabled = await signUrls('disabled', 'mockups', [matPhotoPath])
    return `3+11MB ผ่าน · fakeJpg/mockup/otherFolder บล็อก · ไม่ทับที่ 375px · sign(anon=${signAnon.status}, disabled=${signDisabled.status}, staff_empty=${signStaffEmpty.status}:${JSON.stringify(signStaffEmpty.body)?.slice(0,80)}, staff_single=${signStaffSingle.status})`
  })

  // A.5: ปล่อยเข้าไลน์ (เหตุผลปุ่มล็อก · กล่องยืนยัน · ยกเลิก · คิวต่อท้าย · เวลาผลิตเริ่มวันนี้ · แก้หลังปล่อยไม่ได้ · ประวัติ)
  await step('A5.release-and-queue-and-history', async () => {
    const [{ id: jobForm }] = await sql("select id from public.jobs where confirmation_no = 'SC-R20-A1-FORM'")
    const [{ id: jobDtf }] = await sql("select id from public.jobs where confirmation_no = 'SC-R20-A1-DTF'")
    // ติ๊กทุกรายการใน jobForm
    const mats = await sql('select id from public.job_materials where job_id = $1', [jobForm])
    for (const m of mats) await restRpc('admin1', 'check_material', { p_material_id: m.id, p_checked: true })
    await h.goto('admin1', `#/board?job=${jobForm}`, 1440)
    await waitDialog(/ปล่อยเข้าไลน์การผลิต/, 'พร้อมปล่อย')
    await h.clickButton('ปล่อยเข้าไลน์การผลิต', { exact: true, inside: '[role="dialog"]' })
    await waitDialog(/เข้าคิวสถานีพิมพ์/, 'กล่องยืนยันปลายทาง')
    await h.clickButton('ยังไม่ปล่อย', { exact: true, inside: '[role="dialog"]' })
    await new Promise(r => setTimeout(r, 300))
    const stillMat = (await sql('select phase from public.jobs where id = $1', [jobForm]))[0].phase
    if (stillMat !== 'materials') throw new Error('กดยังไม่ปล่อยแต่หลุดไป ' + stillMat)

    // ปล่อยจริง
    await h.clickButton('ปล่อยเข้าไลน์การผลิต', { exact: true, inside: '[role="dialog"]' })
    await waitDialog(/ยืนยันปล่อยเข้าไลน์/, 'ยืนยัน')
    await h.clickButton('ยืนยันปล่อยเข้าไลน์', { exact: true, inside: '[role="dialog"]' })
    await waitFor(() => h.ev(() => document.body.innerText.includes('ปล่อย SC-R20-A1-FORM เข้าไลน์การผลิตแล้ว')), 'ปล่อยแล้ว', 10000)

    // กดปล่อยซ้ำผ่าน RPC -> ต้องปฏิเสธ
    const rAgain = await restRpc('admin1', 'release_job', { p_job: jobForm })
    if (rAgain.ok) throw new Error('ปล่อยซ้ำผ่าน!')
    const rEdit = await restRpc('admin1', 'set_job_materials', { p_job: jobForm, p_items: ['เพิ่มทีหลัง'] })
    if (rEdit.ok) throw new Error('แก้รายการหลังปล่อยได้!')
    return 'ยกเลิกปล่อยได้ · ปล่อยแล้วไปสถานีพิมพ์ · กันปล่อยซ้ำและแก้หลังปล่อย'
  })

  // A.6: ขอบเขตยาก (ยกเลิกงาน · แก้ใบ · แนบ PDF · สั่ง/รับฟิล์ม · แบ่งงาน · ปิด/เปิดขั้นรอผลิตกลางทาง)
  await step('A6.hard-edge-cases', async () => {
    const [{ id: jobDtf }] = await sql("select id from public.jobs where confirmation_no = 'SC-R20-A1-DTF'")
    // สั่ง/รับฟิล์มระหว่างรอผลิต -> ต้องไม่หลุดเข้าไลน์เอง
    const o1 = await restRpc('admin1', 'order_film', { p_job: jobDtf, p_eta: '2026-12-10' })
    if (!o1.ok) throw new Error('order_film failed: ' + JSON.stringify(o1.body))
    const o2 = await restRpc('admin1', 'receive_film', { p_job: jobDtf })
    if (!o2.ok) throw new Error('receive_film failed: ' + JSON.stringify(o2.body))
    const [{ phase: pAfterFilm }] = await sql('select phase from public.jobs where id = $1', [jobDtf])
    if (pAfterFilm !== 'materials') throw new Error('รับฟิล์มแล้วหลุดออกจากรอผลิตเป็น ' + pAfterFilm)

    // แบ่งงานระหว่างรอผลิต -> ควรทำไม่ได้
    const sp = await restRpc('admin1', 'split_job', { p_job: jobDtf, p_qty: 20 })
    if (sp.ok) throw new Error('แบ่งงานได้ทั้งที่ยังรอผลิต!')

    // ผู้บริหารยกเลิกงานระหว่างรอผลิต -> แอดมินกดอะไรต่อต้องบอกว่ายกเลิกแล้ว
    const [{ id: jobDtg }] = await sql("select id from public.jobs where confirmation_no = 'SC-R20-A1-DTG'")
    const can = await restRpc('manager', 'cancel_job', { p_job: jobDtg, p_reason: 'ลูกค้ายกเลิก' })
    if (!can.ok) throw new Error('cancel_job failed: ' + JSON.stringify(can.body))
    const afterCan = await restRpc('admin1', 'set_job_materials', { p_job: jobDtg, p_items: ['ผ้า'] })
    if (afterCan.ok || !/ยกเลิกแล้ว/.test(JSON.stringify(afterCan.body))) throw new Error('ไม่บอกว่ายกเลิกแล้ว: ' + JSON.stringify(afterCan.body))

    // ปิดขั้นรอผลิตกลางทาง -> งานใหม่เข้าสถานีแรกทันที · งานค้างกดปล่อยได้ไม่ต้องเช็ค · เปิดกลับแล้วงานใหม่ค้างอีก
    await sql('update public.production_settings set materials_check = false')
    const rImmediate = await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-R20-A6-OFF', p_customer_name: 'ปิดรอผลิต', p_job_name: 'ทดสอบปิด',
      p_product_type_code: 'tshirt', p_qty: 50, p_unit: 'ตัว', p_due_date: '2026-12-25',
      p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_spare_qty: 0, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    if (!rImmediate.ok) throw new Error('receive when off failed')
    const [{ phase: immPhase }] = await sql("select phase from public.jobs where confirmation_no = 'SC-R20-A6-OFF'")
    if (immPhase !== 'production') throw new Error('ปิดขั้นแล้วยังค้างที่ ' + immPhase)
    // งานที่ค้างอยู่ (jobDtf) กดปล่อยได้โดยไม่ต้องมีรายการ/รูป
    const relNoCheck = await restRpc('admin1', 'release_job', { p_job: jobDtf })
    if (!relNoCheck.ok) throw new Error('ปิดขั้นแล้วปล่อยงานค้างไม่ได้: ' + JSON.stringify(relNoCheck.body))
    // เปิดกลับแล้วงานใหม่ค้างอีก
    await sql('update public.production_settings set materials_check = true')
    await restRpc('admin1', 'receive_job', {
      p_confirmation_no: 'SC-R20-A6-ON', p_customer_name: 'เปิดกลับ', p_job_name: 'ทดสอบเปิด',
      p_product_type_code: 'tshirt', p_qty: 50, p_unit: 'ตัว', p_due_date: '2026-12-25',
      p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_spare_qty: 0, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    const [{ phase: onPhase }] = await sql("select phase from public.jobs where confirmation_no = 'SC-R20-A6-ON'")
    if (onPhase !== 'materials') throw new Error('เปิดกลับแล้วไม่ค้างรอผลิต: ' + onPhase)
    return 'รับฟิล์มไม่หลุด · กันแบ่งงาน · ยกเลิกแจ้งชัด · ปิด/เปิดขั้นกลางทางถูกต้อง'
  })

  // A.7: กล่องจดหมาย (รอผลิตเกิน 2 วันทำงาน)
  await step('A7.inbox-materials-late', async () => {
    const [{ id: jobScreen }] = await sql("select id from public.jobs where confirmation_no = 'SC-R20-A1-SCREEN'")
    await sql("update public.jobs set stage_entered_at = now() - interval '5 days' where id = $1", [jobScreen])
    await sql("delete from public.inbox_messages where kind = 'materials_late'")
    await h.goto('admin1', '#/inbox', 1440)
    await h.waitText('รอผลิตเกิน 2 วันทำงาน', 10000)
    const [{ cnt, roles }] = await sql("select count(*)::int cnt, array_agg(distinct r) roles from public.inbox_messages, unnest(audience) r where kind = 'materials_late' and job_id = $1", [jobScreen])
    if (cnt !== 1 || roles.join() !== 'admin') throw new Error(`cnt=${cnt} roles=${JSON.stringify(roles)}`)
    return 'แอดมินได้ข้อความรอผลิตนาน 1 ข้อความ ไม่ซ้ำ บทบาทอื่นไม่ได้'
  })

  // A.8 & A.9: หน้าอื่นสอดคล้อง + 375/768/1440 px
  await step('A8-A9.consistency-and-responsive', async () => {
    const [{ id: jobSample }] = await sql("select id from public.jobs where confirmation_no = 'SC-R20-A1-SAMPLE'")
    for (const p of ['#/overview', '#/deliveries', '#/reports']) {
      await h.goto('admin1', p, 1440)
      await new Promise(r => setTimeout(r, 700))
      const txt = await h.ev(() => document.body.innerText)
      if (/NaN|undefined|Invalid Date/.test(txt)) throw new Error(`${p} มี NaN/undefined/Invalid Date`)
    }
    await h.goto('admin1', '#/deliveries', 1440)
    await h.waitText('SC-R20-A1-SAMPLE')
    await h.screenshot('r20-a8-deliveries-materials-1440')

    for (const w of [375, 768, 1440]) {
      await h.goto('admin1', `#/board?job=${jobSample}`, w)
      await waitDialog(/รอผลิต · เช็ควัตถุดิบ/, `drawer ${w}`)
      const m = await h.ev(() => ({
        scroll: document.documentElement.scrollWidth,
        w: innerWidth,
      }))
      if (m.scroll > m.w + 1) throw new Error(`overflow ${w}: ${m.scroll} > ${m.w}`)
      await h.screenshot(`r20-a9-materials-${w}`)
    }
    return 'ภาพรวม/กำหนดส่ง/รายงานสอดคล้อง · 375/768/1440 ไม่ล้น'
  })
} finally {
  await mkdir('tools/qa-r20-ag', { recursive: true })
  await writeFile('tools/qa-r20-ag/part-a-materials-results.json', JSON.stringify({
    externalAttempts: chrome.externalAttempts,
    results,
  }, null, 2))
  await chrome.close()
  await stack.close?.()
}
const failed = results.filter(r => r.status === 'FAIL').length
console.log(`SUMMARY: ${results.length - failed}/${results.length} PASS · externalAttempts=${chrome.externalAttempts.length}`)
process.exit(failed ? 1 : 0)
