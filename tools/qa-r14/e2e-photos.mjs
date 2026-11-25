// ทดสอบปลายทางถึงปลายทาง: รูปยืนยันงาน + หน้าตาแบบใหม่ บนระบบจำลองในเครื่องเท่านั้น
import { readFile } from 'node:fs/promises'
const WT = new URL('./', import.meta.url).href
const { startLocalStack } = await import(WT + 'server.mjs')
const { openChrome, waitFor } = await import(WT + 'chrome.mjs')
const { createFixtures } = await import(WT + 'fixtures.mjs')

const results = []
const pass = (id, detail = '') => { results.push({ id, pass: true, detail }); console.log(`PASS ${id} ${detail}`) }
const fail = (id, err) => { results.push({ id, pass: false, error: String(err?.message ?? err) }); console.log(`FAIL ${id} · ${err?.message ?? err}`) }

const stack = await startLocalStack()
if (!/^http:\/\/127\.0\.0\.1:/.test(stack.origin)) throw new Error('ต้องเป็นระบบในเครื่องเท่านั้น')
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const h = chrome.wrap(chrome.main)
const logs = () => chrome.main.logs.filter(e => !String(e.text ?? '').startsWith("Blocked attempt to show a 'beforeunload'"))

const sql = async (q, params = []) => {
  const r = await (await fetch(stack.origin + '/__qa/sql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: q, params }) })).json()
  if (r.message) throw new Error(r.message)
  return r.rows
}
const as = (user, call, args) => sql(`with c as materialized (select set_config('request.jwt.claim.sub', $1, false) x) select ${call} from c`, [user, ...args])

async function step(id, fn) {
  const before = logs().length
  try {
    const d = await fn()
    const errs = logs().slice(before)
    if (errs.length) throw new Error('console: ' + JSON.stringify(errs).slice(0, 400))
    pass(id, d ?? '')
  } catch (e) { fail(id, e) }
}
async function ux(id, width) {
  await step(id, async () => {
    const m = await h.measureFloorUx(width)
    const bad = []
    if (m.docScrollWidth > width + 1) bad.push(`ล้นขวา ${m.docScrollWidth}`)
    if (m.overflows.length) bad.push('overflow ' + JSON.stringify(m.overflows))
    if (m.smallButtons.length) bad.push('ปุ่มเล็ก ' + JSON.stringify(m.smallButtons))
    if (m.disabledNoReason) bad.push(`ปุ่มปิดไม่บอกเหตุผล ${m.disabledNoReason}`)
    if (m.badTokens.length) bad.push('ค่าแปลก ' + m.badTokens.join(','))
    if (bad.length) throw new Error(bad.join(' | '))
    return `กว้าง ${width} ผ่าน`
  })
}

try {
  await fetch(stack.origin + '/__qa/reset', { method: 'POST' })
  const fx = (await createFixtures(h)).paths
  const { writeFile } = await import('node:fs/promises')
  fx.backJpg2 = fx.backJpg.replace(/.jpg$/, '-2.jpg')
  const b64 = await h.ev(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d'); g.fillStyle = '#334'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#e8e8e8'; g.fillRect(160, 80, 320, 320); g.fillStyle = '#123'; g.fillRect(300, 160, 90, 60); return c.toDataURL('image/jpeg', 0.9).split(',')[1] })
  await writeFile(fx.backJpg2, Buffer.from(b64, 'base64'))
  const accounts = await (await fetch(stack.origin + '/__qa/accounts')).json()
  const id = k => accounts.find(a => a.key === k).id
  await as(id('owner'), 'public.set_station_photos_enabled(true, 15)', [])
  const [job] = await as(id('admin1'), `public.receive_job(p_confirmation_no => 'SC777001', p_customer_name => 'ร้านทดสอบรูป', p_job_name => 'เสื้อทีม', p_product_type_code => 'tshirt',
    p_qty => 120, p_unit => 'ตัว', p_due_date => (current_date + 3), p_route_code => 'cut_only', p_confirmation_pdf_path => null,
    p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false) as id`, [])
  const [{ mockup_path: mp }] = await sql(`update public.jobs set mockup_path = private.mockup_folder(confirmation_no) || '/front1.png' where id = $1 returning mockup_path`, [job.id])
  stack.r2Store.set('mockups/' + mp, { bytes: new Uint8Array(await readFile(fx.frontPng)), type: 'image/png' })
  await as(id('staff_single'), 'public.start_in_queue(p_job => $2::uuid, p_reason => null)', [job.id])

  for (const w of [375, 768, 1440]) {
    await step(`worker-${w}-render`, async () => {
      await h.goto('staff_single', '#/board', w)
      await h.waitText('SC777001')
      await h.waitText('ทำชิ้นแรก 1 ชิ้น')
      const hero = await h.ev(() => { const s = document.querySelector('section[aria-label^="สถานี"]'); return s ? getComputedStyle(s).backgroundColor : null })
      if (hero !== 'rgb(43, 58, 143)') throw new Error('สีหัวสถานีตัดไม่ตรง ' + hero)
      const track = await h.ev(() => document.querySelector('ol[aria-label="เส้นทาง"] [aria-current="step"]')?.getAttribute('aria-label'))
      if (!track) throw new Error('ไม่มีเส้นทางงานบนการ์ด')
      await h.screenshot(`v3-worker-start-${w}`, { fullPage: true })
      return `สีสถานีตัด + เส้นทาง (${track})`
    })
    await ux(`worker-${w}-ux`, w)
  }

  await step('worker-send-first-piece', async () => {
    await h.goto('staff_single', '#/board', 375)
    await h.waitText('ทำชิ้นแรก 1 ชิ้น')
    await h.uploadFiles('input[type=file][capture]', [fx.backJpg, fx.backJpg2])
    await h.waitText('ส่งรูปชิ้นแรก 2 รูป')
    await h.clickButton('ส่งรูปชิ้นแรก 2 รูป')
    await h.waitText('ชิ้นแรกรออนุมัติ', 12000)
    await h.waitText('อย่าเพิ่งทำทั้งล็อต')
    const finishLocked = await h.ev(() => document.body.innerText.includes('ยังกดเสร็จไม่ได้'))
    if (!finishLocked) throw new Error('ปุ่มเสร็จไม่ถูกล็อกระหว่างรออนุมัติ')
    await h.ev(() => document.querySelector('ol[aria-label="เส้นทาง"]')?.scrollIntoView({ block: 'start' }))
    await h.screenshot('v3-worker-wait-375')
    return 'ส่ง 2 รูป · ปุ่มเสร็จล็อก'
  })

  async function openReview() {
    await h.goto('admin1', '#/', 1440)
    await h.waitText('รออนุมัติชิ้นแรก', 12000)
    await h.clickButton(/SC777001.*ตรวจ/)
    await waitFor(() => h.ev(() => !!document.querySelector('[aria-roledescription="ตัวดูรูป"]')), 'ตัวดูรูป', 12000)
    await waitFor(() => h.ev(() => [...document.querySelectorAll('[aria-roledescription="ตัวดูรูป"] img')].every(i => i.complete)), 'รูปโหลด', 12000)
  }

  await step('admin-viewer-swipe', async () => {
    await openReview()
    const counter = () => h.ev(() => [...document.querySelectorAll('[role=dialog] span')].map(s => s.textContent.trim()).find(t => /^\d+ \/ \d+$/.test(t)))
    if (await counter() !== '1 / 2') throw new Error('เริ่มไม่ใช่รูป 1/2: ' + await counter())
    await h.ev(() => {
      const st = document.querySelector('[aria-roledescription="ตัวดูรูป"]')
      const r = st.getBoundingClientRect(); const y = r.top + r.height / 2
      const fire = (type, x) => st.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true }))
      fire('pointerdown', r.left + r.width * 0.8); fire('pointermove', r.left + r.width * 0.5); fire('pointerup', r.left + r.width * 0.2)
    })
    await waitFor(async () => (await counter()) === '2 / 2', 'ปัดไปรูป 2')
    await h.ev(() => document.querySelector('[aria-roledescription="ตัวดูรูป"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    await waitFor(async () => (await counter()) === '1 / 2', 'ลูกศรซ้ายกลับรูป 1')
    await h.screenshot('v3-admin-viewer-1440')
    return 'ปัด + ลูกศร ทำงาน'
  })

  await step('admin-viewer-compare-zoom', async () => {
    await h.clickButton('เทียบม็อคอัพ')
    await waitFor(() => h.ev(() => { const i = document.querySelector('img[alt="ม็อคอัพที่ลูกค้ายืนยัน"]'); return !!i && i.complete && i.naturalWidth > 0 }), 'ม็อคอัพโหลด', 10000)
    const clip = () => h.ev(() => document.querySelector('[aria-roledescription="ตัวดูรูป"] [style*="clip-path"]')?.style.clipPath)
    const before = await clip()
    await h.ev(() => {
      const st = document.querySelector('[aria-roledescription="ตัวดูรูป"]')
      const r = st.getBoundingClientRect(); const y = r.top + r.height / 2
      st.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width * 0.25, clientY: y, pointerId: 2, button: 0, isPrimary: true }))
      st.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + r.width * 0.25, clientY: y, pointerId: 2, button: 0, isPrimary: true }))
    })
    const after = await clip()
    if (!before || before === after || !/25%/.test(after)) throw new Error(`เส้นเทียบไม่ขยับ ${before} → ${after}`)
    await h.screenshot('v3-admin-compare-1440')
    await h.clickButton('ขยาย')
    const zoomed = await h.ev(() => [...document.querySelectorAll('[aria-roledescription="ตัวดูรูป"] div')].some(d => d.style.transform === 'scale(2.2)'))
    if (!zoomed) throw new Error('ปุ่มขยายไม่ซูม')
    await h.clickButton('ย่อกลับ')
    return `เส้นเทียบ ${before} → ${after} · ซูมได้`
  })

  await step('admin-reject-with-reason', async () => {
    await h.clickButton('ไม่ผ่าน…')
    const locked = await h.ev(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.includes('ยืนยันไม่ผ่าน')); return !!b })
    if (!locked) throw new Error('ไม่เห็นปุ่มยืนยันไม่ผ่าน')
    await h.clickButton('สีเพี้ยน', { exact: true })
    await h.clickButton('ยืนยันไม่ผ่าน')
    await h.waitGone('ยืนยันไม่ผ่าน', 10000)
    await h.goto('staff_single', '#/board', 375)
    await h.waitText('ชิ้นแรกไม่ผ่าน', 10000)
    await h.waitText('สีเพี้ยน')
    await h.ev(() => document.querySelector('ol[aria-label="เส้นทาง"]')?.scrollIntoView({ block: 'start' }))
    await h.screenshot('v3-worker-rejected-375')
    return 'หน้างานเห็นเหตุผล'
  })

  let secondKey = null
  await step('worker-resend', async () => {
    await h.uploadFiles('input[type=file][capture]', [fx.backJpg, fx.backJpg2])
    await h.clickButton('ส่งรูปชิ้นแรก 2 รูป')
    await h.waitText('ชิ้นแรกรออนุมัติ', 12000)
    const keys = [...stack.r2Store.keys()].filter(k => k.startsWith('station_photos/')).sort()
    secondKey = keys.at(-1)
    return `${keys.length} รูปใน R2`
  })

  await step('admin-broken-photo-blocks-pass', async () => {
    const saved = stack.r2Store.get(secondKey)
    stack.r2Store.delete(secondKey)
    await h.send('Network.setCacheDisabled', { cacheDisabled: true })
    await h.send('Network.clearBrowserCache')
    try {
      await openReview()
      await h.waitText('มีรูปที่เปิดไม่ได้', 10000)
      const btn = await h.ev(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.includes('กดผ่านไม่ได้')); return b ? { disabled: b.disabled, text: b.textContent.trim() } : null })
      if (!btn?.disabled) throw new Error('ปุ่มผ่านไม่ล็อกเมื่อรูปเปิดไม่ได้ ' + JSON.stringify(btn))
      await h.screenshot('v3-admin-broken-1440')
      return btn.text
    } finally {
      await h.send('Network.setCacheDisabled', { cacheDisabled: false })
      stack.r2Store.set(secondKey, saved)
      chrome.main.logs.length = 0
    }
  })

  await step('admin-approve', async () => {
    await openReview()
    await h.clickButton('ผ่าน ทำทั้งล็อตได้')
    await h.waitGone('ผ่าน ทำทั้งล็อตได้', 10000)
    return 'อนุมัติแล้ว'
  })

  await step('worker-finish-photo-and-done', async () => {
    await h.goto('staff_single', '#/board', 375)
    await h.waitText('ชิ้นแรกผ่านแล้ว', 10000)
    await h.ev(() => document.querySelector('ol[aria-label="เส้นทาง"]')?.scrollIntoView({ block: 'start' }))
    await h.screenshot('v3-worker-approved-375')
    await h.uploadFiles('input[type=file][capture]', [fx.backJpg])
    await h.clickButton('ส่งรูปงานเสร็จ 1 รูป')
    await h.waitText('กดเสร็จได้', 12000)
    await h.clickButton('ตัดงานเสร็จ')
    await h.clickButton('ยืนยัน', { exact: true })
    await h.waitText('ส่งต่อแล้ว', 12000)
    const [row] = await sql('select station_seq from public.jobs where id = $1', [job.id])
    return `งานไปสถานีถัดไป ${JSON.stringify(row)}`
  })

  for (const w of [375, 1440]) {
    await step(`owner-overview-${w}`, async () => {
      await h.goto('owner', '#/', w)
      await h.waitText('สถานีตอนนี้', 12000).catch(() => {})
      await h.screenshot(`v3-owner-${w}`, { fullPage: true })
      return 'เปิดได้'
    })
    await ux(`owner-${w}-ux`, w)
  }
  await step('board-1440', async () => {
    await h.goto('prod1', '#/board', 1440)
    await h.screenshot('v3-board-1440', { fullPage: true })
  })
  await ux('board-1440-ux', 1440)
} catch (e) {
  fail('setup', e)
} finally {
  await chrome.close()
  await stack.close()
  const failed = results.filter(r => !r.pass)
  console.log(`\nรวม ${results.length} · ผ่าน ${results.length - failed.length} · ไม่ผ่าน ${failed.length}`)
  process.exit(failed.length ? 1 : 0)
}
