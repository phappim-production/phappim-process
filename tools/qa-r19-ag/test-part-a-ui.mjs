import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'

const PORT = Number(process.env.QA_PORT ?? 5234)
const FILES_PORT = Number(process.env.QA_FILES_PORT ?? 5235)
const IMG_DIR = process.env.QA_IMG_DIR ?? fileURLToPath(new URL('../../docs/qa/img/r19-ag/', import.meta.url))
const OUT_JSON = fileURLToPath(new URL('./part-a-ui-results.json', import.meta.url))

const results = []
const observations = []

function record(id, title, pass, detail = '') {
  results.push({ id, title, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${title}${detail ? ' · ' + detail : ''}`)
}

async function reloadClean(tab, mustHaveText) {
  await tab.ev(() => { window.__preReloadMarker = 1; location.reload() })
  await waitFor(() => tab.ev(() => !window.__preReloadMarker && document.readyState === 'complete').catch(() => false), 'รอโหลดหน้าใหม่', 12000)
  if (mustHaveText) await tab.waitText(mustHaveText, 12000)
}

async function createExtraMediaFixtures(tab) {
  const dir = await mkdtemp(join(tmpdir(), 'pp142-r19-media-'))
  const rendered = await tab.ev(async () => {
    async function draw(w, h, mime, label, bg, fg, noisy = false) {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)
      if (noisy) {
        const img = g.createImageData(w, h)
        const d = img.data
        let s = 1337
        for (let i = 0; i < d.length; i += 4) {
          s = (s * 1664525 + 1013904223) >>> 0
          d[i] = s & 255
          d[i + 1] = (s >>> 8) & 255
          d[i + 2] = (s >>> 16) & 255
          d[i + 3] = 255
        }
        g.putImageData(img, 0, 0)
      }
      g.fillStyle = fg
      g.fillRect(Math.round(w * 0.2), Math.round(h * 0.2), Math.round(w * 0.6), Math.round(h * 0.6))
      g.fillStyle = '#ffffff'
      g.font = `bold ${Math.max(8, Math.round(Math.min(w, h) * 0.08))}px sans-serif`
      g.textAlign = 'center'
      g.fillText(label, w / 2, h / 2)
      const blob = await new Promise(r => c.toBlob(r, mime, 0.92))
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      const CHUNK = 0x8000
      for (let i = 0; i < buf.length; i += CHUNK) {
        bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
      }
      return btoa(bin)
    }
    return {
      portraitJpg: await draw(600, 960, 'image/jpeg', 'PORTRAIT JPG', '#0b3e3d', '#dea256'),
      landscapeJpg: await draw(960, 600, 'image/jpeg', 'LANDSCAPE JPG', '#2b3a8f', '#f59e0b'),
      portraitPng: await draw(540, 900, 'image/png', 'PORTRAIT PNG', '#a8175a', '#10b981'),
      landscapePng: await draw(900, 540, 'image/png', 'LANDSCAPE PNG', '#5a2aa6', '#06b6d4'),
      tinyJpg: await draw(12, 12, 'image/jpeg', 'T', '#111111', '#ff0000'),
      hugePng: await draw(3000, 2200, 'image/png', 'HUGE 10MB+', '#1f2937', '#ef4444', true),
    }
  })

  const paths = {
    portraitJpg: join(dir, 'portrait.jpg'),
    landscapeJpg: join(dir, 'landscape.jpg'),
    portraitPng: join(dir, 'portrait.png'),
    landscapePng: join(dir, 'landscape.png'),
    tinyJpg: join(dir, 'tiny.jpg'),
    hugePng: join(dir, 'huge-10mb.png'),
    fakeJpg: join(dir, 'fake-not-image.jpg'),
    fakeHeic: join(dir, 'iphone-photo.heic'),
  }
  const heicHeader = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // ftyp
    0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00, // heic
    0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63, // mif1heic
  ])
  const hugeBuf = Buffer.from(rendered.hugePng, 'base64')
  await Promise.all([
    writeFile(paths.portraitJpg, Buffer.from(rendered.portraitJpg, 'base64')),
    writeFile(paths.landscapeJpg, Buffer.from(rendered.landscapeJpg, 'base64')),
    writeFile(paths.portraitPng, Buffer.from(rendered.portraitPng, 'base64')),
    writeFile(paths.landscapePng, Buffer.from(rendered.landscapePng, 'base64')),
    writeFile(paths.tinyJpg, Buffer.from(rendered.tinyJpg, 'base64')),
    writeFile(paths.hugePng, hugeBuf),
    writeFile(paths.fakeJpg, 'THIS IS PLAIN TEXT DISGUISED AS JPG'),
    writeFile(paths.fakeHeic, heicHeader),
  ])
  return {
    dir,
    paths,
    sizes: { hugePngBytes: hugeBuf.byteLength },
    async cleanup() {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

async function run() {
  const stack = await startLocalStack({ port: PORT, filesPort: FILES_PORT })
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)
  const baseFx = await createFixtures(t)
  const media = await createExtraMediaFixtures(t)

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
  const accounts = await (await fetch(`${stack.origin}/__qa/accounts`)).json()
  const uid = k => accounts.find(a => a.key === k).id

  async function receiveAndOptionalMockup(no, route, withMockup = true, qty = 20) {
    const [row] = await as(uid('admin1'), `public.receive_job(
      p_confirmation_no => $2, p_customer_name => 'ลูกค้าทดสอบภาพยืนยัน', p_job_name => 'งานทดสอบ',
      p_product_type_code => 'tshirt', p_qty => $3, p_unit => 'ตัว',
      p_due_date => (current_date + 4), p_route_code => $4, p_confirmation_pdf_path => null,
      p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false
    ) as id`, [no, qty, route])
    if (withMockup) {
      const [{ mockup_path: mp }] = await sql(`update public.jobs set mockup_path = private.mockup_folder(confirmation_no) || '/front1.png' where id = $1 returning mockup_path`, [row.id])
      const { readFile } = await import('node:fs/promises')
      stack.r2Store.set('mockups/' + mp, { bytes: new Uint8Array(await readFile(baseFx.paths.frontPng)), type: 'image/png' })
    }
    return row.id
  }

  async function check(id, title, fn, { allowErrorStatus = false, tabs = [chrome.main] } = {}) {
    const offsets = tabs.map(tb => tb.logs.length)
    try {
      const detail = await fn()
      const badLogs = tabs.flatMap((tb, i) => tb.logs.slice(offsets[i])).filter(entry => {
        if (String(entry.text ?? '').startsWith("Blocked attempt to show a 'beforeunload'")) return false
        if (allowErrorStatus && /400|403|404|409|413|415|422|500|503/.test(entry.text ?? '')) return false
        return true
      })
      if (badLogs.length) throw new Error('console error: ' + JSON.stringify(badLogs).slice(0, 400))
      record(id, title, true, detail ?? '')
    } catch (e) {
      record(id, title, false, e?.stack ?? e?.message ?? String(e))
    }
  }

  try {
    await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })

    // 1. Owner enables feature via Settings UI + checks Audit Log (Part A.1 + A.8)
    await check('A1.enable-ui', 'เจ้าของเปิดใช้รูปยืนยันงานผ่านหน้าตั้งค่าและตรวจ Audit Log', async () => {
      await t.goto('owner', '#/settings', 1440)
      await t.waitText('รูปยืนยันงานที่สถานี')
      await t.clickButton('เปิดใช้', { exact: true })
      await t.waitText('เปิดใช้อยู่')
      // เปลี่ยนเวลาเตือน 15 -> 5 -> 60 -> 15 และลองสลับติ๊กสถานีพิมพ์ แล้วตรวจบันทึกการเปลี่ยนแปลง
      await t.selectOption('select', '5', { index: 0 })
      await t.waitText('เกิน 5 นาที')
      await t.selectOption('select', '15', { index: 0 })
      await t.waitText('เกิน 15 นาที')
      // Toggle print off and back on
      await t.ev(() => {
        const lbl = [...document.querySelectorAll('fieldset label')].find(l => l.textContent.includes('พิมพ์งาน'))
        lbl.querySelector('input[type=checkbox]').click()
      })
      await delay(300)
      await t.ev(() => {
        const lbl = [...document.querySelectorAll('fieldset label')].find(l => l.textContent.includes('พิมพ์งาน'))
        lbl.querySelector('input[type=checkbox]').click()
      })
      await delay(300)

      // Check station list in settings (verify whether 'screen' appears despite no route)
      const stationsInSettings = await t.ev(() => [...document.querySelectorAll('fieldset label span')].map(s => s.textContent.trim()))
      observations.push({ key: 'settings_stations', stationsInSettings })

      await t.goto('owner', '#/audit', 1440)
      await t.waitText('บันทึกการเปลี่ยนแปลง')
      const auditText = await t.ev(() => [...document.querySelectorAll('main li')].slice(0, 8).map(li => li.innerText.replace(/\s+/g, ' ').trim()))
      observations.push({ key: 'audit_photo_settings', auditText })
      await t.screenshot('a8-audit-settings-1440', { fullPage: true })
      const hasRawTableName = auditText.some(x => x.includes('station_photo_settings') || x.includes('enabled_at') || x.includes('remind_minutes') || x.includes('first_piece_check'))
      return `สถานี=${stationsInSettings.length}, rawFieldInAudit=${hasRawTableName}`
    })

    // 2. Varied file types (huge >10MB, tiny, fake .jpg, .heic, portrait/landscape, 7 files limit) on cut station
    const jobCut = await receiveAndOptionalMockup('SC-A1-CUT', 'cut_only', true, 30)
    await check('A1.media-variants', 'ทดสอบไฟล์หลายแบบ (ใหญ่ >10MB, เล็กมาก, แนวตั้ง/นอน, .jpg ปลอม, .heic, เกิน 6 รูป)', async () => {
      await t.goto('staff_single', '#/board', 768)
      await t.waitText('SC-A1-CUT')
      await t.clickButton('เริ่มตัดงาน')
      await t.waitText('ทำชิ้นแรก 1 ชิ้น')

      // Check fake .jpg
      await t.uploadFiles('input[type=file][capture]', [media.paths.fakeJpg])
      await t.waitText('ส่งรูปชิ้นแรก 1 รูป')
      await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
      const fakeJpgAlert = await waitFor(() => t.ev(() => {
        const a = [...document.querySelectorAll('[role=alert]')].map(x => x.innerText.trim()).find(s => s.includes('SC-A1-CUT') || s.includes('JPG') || s.includes('เปิดไม่ได้'))
        return a || false
      }), 'error จากไฟล์ fake.jpg', 10000)
      observations.push({ key: 'fake_jpg_error', fakeJpgAlert })
      await t.screenshot('a1-fake-jpg-error-768')
      // Remove the failed file preview
      await t.ev(() => document.querySelector('button[aria-label^="ลบรูปที่"]')?.click())

      // Check undecodable .heic
      await t.uploadFiles('input[type=file][capture]', [media.paths.fakeHeic])
      await t.waitText('ส่งรูปชิ้นแรก 1 รูป')
      await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
      await t.waitText('เปิดไม่ได้ ให้ถ่ายใหม่')
      await t.screenshot('a1-heic-error-768')
      await t.ev(() => document.querySelector('button[aria-label^="ลบรูปที่"]')?.click())

      // Check 7 files uploaded at once -> check how UI behaves!
      await t.uploadFiles('input[type=file][capture]', [
        media.paths.portraitJpg,
        media.paths.landscapeJpg,
        media.paths.portraitPng,
        media.paths.landscapePng,
        media.paths.tinyJpg,
        baseFx.paths.backJpg,
        baseFx.paths.detailWebp,
      ])
      await t.waitText('ครบ 6 รูปแล้ว')
      const previewCount = await t.ev(() => document.querySelectorAll('ul[aria-label="รูปที่เลือก"] li').length)
      const sevenWarning = await t.ev(() => document.body.innerText.includes('7') || document.body.innerText.includes('เกิน 6'))
      observations.push({ key: 'upload_7_files_ui', previewCount, sevenWarning })
      // Clear 6 files and upload huge >10MB PNG + tiny JPG + portrait JPG
      for (let i = 0; i < 6; i++) await t.ev(() => document.querySelector('button[aria-label^="ลบรูปที่"]')?.click())
      await t.uploadFiles('input[type=file][capture]', [media.paths.hugePng, media.paths.tinyJpg, media.paths.portraitJpg])
      await t.waitText('ส่งรูปชิ้นแรก 3 รูป')
      await t.fillInput('input[placeholder*="สีเข้มกว่าม็อคอัพ"]', 'ทดสอบรูปใหญ่เกิน 10MB และภาพแนวตั้ง')
      await t.clickButton('ส่งรูปชิ้นแรก 3 รูป')
      await t.waitText('ชิ้นแรกรออนุมัติ', 15000)

      // Check shrunk R2 object sizes
      const r2Objs = [...stack.r2Store.entries()].filter(([k]) => k.startsWith('station_photos/SC-A1-CUT/'))
      assert.equal(r2Objs.length, 3, 'ต้องอัปโหลด 3 รูป')
      const maxStoredBytes = Math.max(...r2Objs.map(([, v]) => v.bytes.byteLength))
      assert.ok(maxStoredBytes < 1024 * 1024, `รูปหลังย่อยังใหญ่เกิน: ${maxStoredBytes}`)
      return `ต้นฉบับใหญ่ ${(media.sizes.hugePngBytes / 1048576).toFixed(2)} MB → R2 สูงสุด ${(maxStoredBytes / 1024).toFixed(0)} KB · 7รูปเก็บ=${previewCount}(เตือน=${sevenWarning})`
    }, { allowErrorStatus: true })

    // 3. Part A.4 PhotoViewer: swipe, arrow, compare mockup (drag + slider), zoom button + double-click, broken photo, 2 admins race
    await check('A4.viewer-full', 'PhotoViewer: ปัด, คีย์บอร์ด, เทียบม็อคอัพ, ดับเบิลคลิกซูม, รูปเสีย, 2 แอดมินแข่งกัน', async () => {
      await t.goto('admin1', '#/', 1440)
      await t.waitText('รออนุมัติชิ้นแรก')
      await t.clickButton(/SC-A1-CUT.*ตรวจ/)
      await waitFor(() => t.ev(() => {
        const imgs = [...document.querySelectorAll('[aria-roledescription="ตัวดูรูป"] img')]
        return imgs.length >= 3 && imgs.every(i => i.complete && i.naturalWidth > 0)
      }), 'รูปชิ้นแรก 3 รูปโหลดครบ', 12000)

      // Check double-click zoom IN and double-click zoom OUT
      await t.ev(() => {
        const el = document.querySelector('[aria-roledescription="ตัวดูรูป"]')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.5 }))
      })
      const zoomedIn = await t.ev(() => [...document.querySelectorAll('[aria-roledescription="ตัวดูรูป"] div')].some(d => d.style.transform === 'scale(2.2)'))
      assert.ok(zoomedIn, 'ดับเบิลคลิกไม่ซูมเข้า')
      await t.ev(() => {
        const el = document.querySelector('[aria-roledescription="ตัวดูรูป"]')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + r.height * 0.5 }))
      })
      const zoomedOut = await t.ev(() => ![...document.querySelectorAll('[aria-roledescription="ตัวดูรูป"] div')].some(d => d.style.transform === 'scale(2.2)'))
      assert.ok(zoomedOut, 'ดับเบิลคลิกซ้ำไม่ย่อกลับ')

      // Check swipe right -> left (1 -> 2 -> 3), ArrowRight/ArrowLeft, range slider in compare mode
      const counter = () => t.ev(() => [...document.querySelectorAll('[role=dialog] span')].map(s => s.textContent.trim()).find(x => /^\d+ \/ \d+$/.test(x)))
      assert.equal(await counter(), '1 / 3')
      await t.ev(() => {
        const el = document.querySelector('[aria-roledescription="ตัวดูรูป"]')
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      })
      await waitFor(async () => (await counter()) === '2 / 3', 'ArrowRight -> 2/3')
      await t.ev(() => {
        const el = document.querySelector('[aria-roledescription="ตัวดูรูป"]')
        const r = el.getBoundingClientRect(); const y = r.top + r.height / 2
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width * 0.85, clientY: y, pointerId: 1, button: 0, isPrimary: true }))
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * 0.45, clientY: y, pointerId: 1, button: 0, isPrimary: true }))
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + r.width * 0.15, clientY: y, pointerId: 1, button: 0, isPrimary: true }))
      })
      await waitFor(async () => (await counter()) === '3 / 3', 'Swipe -> 3/3')

      // Compare mode + slider input
      await t.clickButton('เทียบม็อคอัพ')
      await t.waitText('เลื่อนเทียบ')
      await t.ev(() => {
        const rng = document.querySelector('[role=dialog] input[type="range"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(rng, '70')
        rng.dispatchEvent(new Event('input', { bubbles: true }))
        rng.dispatchEvent(new Event('change', { bubbles: true }))
      })
      const clip70 = await t.ev(() => document.querySelector('[aria-roledescription="ตัวดูรูป"] [style*="clip-path"]')?.style.clipPath)
      assert.match(clip70 ?? '', /70%/)

      // Test rejecting without selecting/typing reason
      await t.clickButton('ไม่ผ่าน…')
      await t.clickButton('ยืนยันไม่ผ่าน')
      await t.waitText('เลือกหรือพิมพ์เหตุผลที่ไม่ผ่าน')

      // Test rejecting with custom reason ONLY (no preset)
      await t.fillInput('[role=dialog] input[placeholder*="โลโก้"]', 'ตัดขอบเบี้ยว 3 มม.')
      await t.clickButton('ยืนยันไม่ผ่าน')
      await t.waitGone('ยืนยันไม่ผ่าน')

      // Worker sees custom reason & resends 1 photo without note
      await t.goto('staff_single', '#/board', 768)
      await t.waitText('ชิ้นแรกไม่ผ่าน: ตัดขอบเบี้ยว 3 มม.')
      await t.uploadFiles('input[type=file][capture]', [media.paths.landscapeJpg])
      await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
      await t.waitText('ชิ้นแรกรออนุมัติ')

      // Broken photo check: temporarily remove the resent photo from r2Store -> approve button must block
      await t.send('Network.setCacheDisabled', { cacheDisabled: true })
      const stKeys = [...stack.r2Store.keys()].filter(k => k.startsWith('station_photos/SC-A1-CUT/'))
      const latestKey = stKeys.at(-1)
      const savedObj = stack.r2Store.get(latestKey)
      stack.r2Store.delete(latestKey)
      await t.goto('admin1', '#/', 1440)
      await t.waitText('SC-A1-CUT')
      await t.clickButton(/SC-A1-CUT.*ตรวจ/)
      await t.waitText('มีรูปที่เปิดไม่ได้')
      const brokenDisabled = await t.ev(() => {
        const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.includes('มีรูปเปิดไม่ได้') || x.textContent.includes('กดผ่านไม่ได้') || x.textContent.includes('รอรูปโหลด') || x.textContent.includes('ผ่าน ทำทั้งล็อตได้'))
        return b ? { disabled: b.disabled, text: b.textContent.trim() } : null
      })
      assert.ok(brokenDisabled?.disabled, 'ปุ่มผ่านไม่ล็อกเมื่อมีรูปเปิดไม่ได้: ' + JSON.stringify(brokenDisabled))
      await t.screenshot('a4-broken-photo-blocked-1440')
      stack.r2Store.set(latestKey, savedObj)

      // 2 admins simultaneously deciding the same check
      const st = chrome.wrap(await chrome.newTab({ isolated: true }))
      await reloadClean(t, 'SC-A1-CUT')
      await t.send('Network.setCacheDisabled', { cacheDisabled: false })
      await t.clickButton(/SC-A1-CUT.*ตรวจ/)
      await waitFor(() => t.ev(() => {
        const imgs = [...document.querySelectorAll('[aria-roledescription="ตัวดูรูป"] img')]
        return imgs.length >= 1 && imgs.every(i => i.complete && i.naturalWidth > 0)
      }), 'admin1 โหลดรูป')

      await st.goto('admin2', '#/', 1440)
      await st.waitText('SC-A1-CUT')
      await st.clickButton(/SC-A1-CUT.*ตรวจ/)
      await waitFor(() => st.ev(() => {
        const imgs = [...document.querySelectorAll('[aria-roledescription="ตัวดูรูป"] img')]
        return imgs.length >= 1 && imgs.every(i => i.complete && i.naturalWidth > 0)
      }), 'admin2 โหลดรูป')

      // 2 admins simultaneously looking at the same check: admin1 approves, admin2 still open & clicks reject -> must see error!
      await st.clickButton('ไม่ผ่าน…')
      await st.clickButton('สีเพี้ยน', { exact: true })
      await t.clickButton('ผ่าน ทำทั้งล็อตได้')
      await t.waitGone('ผ่าน ทำทั้งล็อตได้')
      await st.clickButton('ยืนยันไม่ผ่าน')
      const errText = await waitFor(() => st.ev(() => document.querySelector('[role=dialog] [role=alert]')?.textContent?.trim() || false), 'ข้อความตัดสินไปแล้วบนแท็บ admin2', 8000)
      assert.match(errText, /ตัดสินไปแล้ว/)
      observations.push({ key: 'a4_2admin_race_alert', errText })
      await st.clickButton('ปิด', { exact: false }).catch(() => {})

      // Worker uploads finish photo + extra finish photo ("ส่งรูปงานเสร็จเพิ่ม") + finishes
      await t.goto('staff_single', '#/board', 768)
      await t.waitText('ชิ้นแรกผ่านแล้ว')
      await t.uploadFiles('input[type=file][capture]', [media.paths.portraitPng])
      await t.clickButton('ส่งรูปงานเสร็จ 1 รูป')
      await t.waitText('ส่งรูปงานเสร็จแล้ว 1 รูป · กดเสร็จได้')
      // Add more finish photos
      await t.ev(() => [...document.querySelectorAll('summary')].find(s => s.textContent.includes('ส่งรูปงานเสร็จเพิ่ม')).click())
      await t.uploadFiles('details input[type=file][capture]', [media.paths.landscapePng])
      await t.clickButton('ส่งรูปงานเสร็จ 1 รูป')
      await t.waitText('ส่งรูปงานเสร็จแล้ว 2 รูป · กดเสร็จได้')
      await t.clickButton('ตัดงานเสร็จ')
      await t.clickButton('ยืนยัน', { exact: true })
      await t.waitText('ส่งต่อแล้ว')

      // Verify Job History has all photos & events (Part A.8)
      await t.goto('admin1', `#/board?job=${jobCut}`, 1440)
      await t.waitText('รูปจากสถานี')
      await waitFor(() => t.ev(() => document.body.innerText.includes('ตัดงานเสร็จ') && document.body.innerText.includes('ส่งรูปงานเสร็จ') && document.body.innerText.includes('ชิ้นแรกไม่ผ่าน')), 'ประวัติรูปงานครบ')
      const histPhotos = await t.ev(() => [...document.querySelectorAll('[role=dialog] img')].filter(i => i.complete && i.naturalWidth > 0).length)
      await t.screenshot('a8-job-history-photos-1440')
      return `zoom dblclick OK · slide+compare 70% · 2admin race="${errText}" · historyImgs=${histPhotos}`
    }, { allowErrorStatus: true })

    // 4. Slow 10s image loading test (using a tiny proxy server to delay 2nd image response by 10.2s) & Job WITHOUT mockup
    await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
    await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
    const jobNoMockup = await receiveAndOptionalMockup('SC-A4-NOMOCK', 'cut_only', false, 15)
    await check('A4.slow10s-nomockup', 'PhotoViewer: งานไม่มีม็อคอัพ + เน็ตช้าหน่วงรูป 10 วิ ปุ่มผ่านต้องล็อกจนครบ', async () => {
      const { createServer } = await import('node:http')
      let delaySecond = true
      const proxy = createServer(async (req, res) => {
        const target = `${stack.filesOrigin}${req.url}`
        if (delaySecond && req.method === 'GET' && req.url.includes('slow2.jpg')) {
          await delay(10_200)
        }
        const fwdHeaders = { ...req.headers }
        delete fwdHeaders.host
        delete fwdHeaders['content-length']
        const upstream = await fetch(target, { method: req.method, headers: fwdHeaders, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req })
        const hdrs = Object.fromEntries(upstream.headers)
        delete hdrs['content-encoding']
        delete hdrs['transfer-encoding']
        res.writeHead(upstream.status, hdrs)
        res.end(upstream.body ? Buffer.from(await upstream.arrayBuffer()) : undefined)
      })
      await new Promise(r => proxy.listen(0, '127.0.0.1', r))
      const proxyOrigin = `http://127.0.0.1:${proxy.address().port}`
      try {
        await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [jobNoMockup])
        const [flag] = await as(uid('staff_single'), `(select json_build_object('folder', x.folder, 'visit', x.visit) from public.station_photo_flags() x where x.job_id = $2::uuid) as f`, [jobNoMockup])
        const p1 = `${flag.f.folder}/cut/${flag.f.visit}/slow1.jpg`
        const p2 = `${flag.f.folder}/cut/${flag.f.visit}/slow2.jpg`
        const { readFile } = await import('node:fs/promises')
        const jpgBytes = new Uint8Array(await readFile(media.paths.portraitJpg))
        for (const p of [p1, p2]) {
          stack.r2Store.set('station_photos/' + p, { bytes: jpgBytes, type: 'image/jpeg' })
          await sql("insert into private.file_objects (kind, path, size, content_type, uploaded_by) values ('station_photos', $1, $2, 'image/jpeg', $3) on conflict do nothing", [p, jpgBytes.byteLength, uid('staff_single')])
        }
        const checkId = (await as(uid('staff_single'), "public.submit_first_piece($2::uuid, 'cut', $3::text[], 'ทดสอบรูปโหลดช้า')", [jobNoMockup, [p1, p2]]))[0].submit_first_piece

        // Intercept /sign on the tab to rewrite returned URLs from filesOrigin -> proxyOrigin
        await t.goto('admin1', '#/', 1440)
        await t.waitText('SC-A4-NOMOCK')
        await t.ev((fOrig, pOrig) => {
          const origFetch = window.fetch.bind(window)
          window.__restoreFetch = () => { window.fetch = origFetch }
          window.fetch = async (input, init) => {
            const res = await origFetch(input, init)
            const u = typeof input === 'string' ? input : input.url
            if (u.includes('/sign')) {
              const json = await res.clone().json()
              if (json.urls) {
                for (const k of Object.keys(json.urls)) json.urls[k] = json.urls[k].replace(fOrig, pOrig)
              }
              return new Response(JSON.stringify(json), { status: res.status, headers: res.headers })
            }
            return res
          }
        }, stack.filesOrigin, proxyOrigin)

        await t.clickButton(/SC-A4-NOMOCK.*ตรวจ/)
        // Check no-mockup message & disabled/absent compare button
        await t.waitText('งานนี้ยังไม่มีม็อคอัพ')
        const dialogButtons = await t.ev(() => [...document.querySelectorAll('[role=dialog] button')].map(x => ({
          text: x.textContent.trim(),
          disabled: x.disabled,
          title: x.title || '',
        })))
        observations.push({ key: 'no_mockup_dialog_buttons', dialogButtons })
        const compareBtn = dialogButtons.find(x => x.text.includes('เทียบม็อคอัพ'))
        assert.ok(!compareBtn || compareBtn.disabled, 'ปุ่มเทียบม็อคอัพยังเปิดใช้ได้ทั้งที่ไม่มีม็อคอัพ: ' + JSON.stringify(compareBtn))

        // While photo 2 is delayed (check at ~2s), approve button MUST still be disabled!
        await delay(2000)
        const duringWait = await t.ev(() => {
          const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.includes('รอรูปโหลด') || x.textContent.includes('ผ่าน ทำทั้งล็อตได้'))
          return b ? { disabled: b.disabled, text: b.textContent.trim() } : null
        })
        assert.ok(duringWait?.disabled && duringWait.text.includes('รอรูปโหลดครบทุกรูป'), 'ปุ่มไม่รอรูปที่ 2: ' + JSON.stringify(duringWait))
        await t.screenshot('a4-slow-10s-locked-1440')

        // Wait for 10s image to arrive and unlock button
        await waitFor(() => t.ev(() => {
          const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.includes('ผ่าน ทำทั้งล็อตได้'))
          return b && !b.disabled
        }), 'ปุ่มปลดล็อกหลังรูปครบ 10 วิ', 14000)
        await t.clickButton('ผ่าน ทำทั้งล็อตได้')
        await t.waitGone('ผ่าน ทำทั้งล็อตได้')
        await t.ev(() => window.__restoreFetch?.())
        return `noMockupDisabled=true · lockedAt2s="${duringWait.text}" · unlockedAfter10s=true (checkId=${checkId})`
      } finally {
        await new Promise(r => proxy.close(r))
      }
    })

    // 5. Part A.1 remaining stations: print, press, dtf_press (including screen route!), emb + Part A.2 sew & qc_pack
    await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
    await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
    await check('A1_A2.all-stations', 'ครบทุกสถานีที่ติ๊ก (print, press, dtf_press, emb, route screen) และไม่ติ๊ก (sew, qc_pack)', async () => {
      // Route print_emb covers: print -> press -> cut -> emb -> sew -> qc_pack
      const jPE = await receiveAndOptionalMockup('SC-A1-PE', 'print_emb', true, 10)
      // Route screen covers: cut -> dtf_press -> sew -> qc_pack
      const jScr = await receiveAndOptionalMockup('SC-A1-SCR', 'screen', true, 10)
      await as(uid('admin1'), 'public.order_film($2::uuid, current_date + 1)', [jScr])
      await as(uid('admin1'), 'public.receive_film($2::uuid)', [jScr])

      // Walk jPE through print -> press -> cut -> emb using prod1 UI
      for (const [idx, [stCode, btnLabel]] of [['print', 'พิมพ์งานเสร็จ'], ['press', 'รีดงานเสร็จ'], ['cut', 'ตัดงานเสร็จ'], ['emb', 'ส่งปักเสร็จ']].entries()) {
        await t.goto('prod1', `#/board?station=${stCode}`, 1440)
        await t.waitText('SC-A1-PE')
        await t.clickButton(/เริ่ม/)
        await t.waitText('ทำชิ้นแรก 1 ชิ้น')
        await t.uploadFiles('input[type=file][capture]', [media.paths.portraitJpg])
        await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
        await t.waitText('ชิ้นแรกรออนุมัติ')
        // Verify finish button locked while waiting
        const lockedMsg = await t.ev(() => document.body.innerText.includes('ยังกดเสร็จไม่ได้'))
        assert.ok(lockedMsg, `สถานี ${stCode} ปุ่มเสร็จไม่ล็อกระหว่างรอ`)
        // Reject with preset+custom on print, preset on press, approve directly on cut & emb
        const [pendingRow] = await sql("select id from public.station_checks where job_id = $1 and station_code = $2 and status = 'pending' order by id desc limit 1", [jPE, stCode])
        if (idx === 0) {
          await as(uid('admin1'), "public.decide_first_piece($2::bigint, false, 'ตำแหน่งผิด · โลโก้เอียง')", [pendingRow.id])
          await t.goto('prod1', `#/board?station=${stCode}`, 1440)
          await t.waitText('ชิ้นแรกไม่ผ่าน')
          await t.uploadFiles('input[type=file][capture]', [media.paths.landscapeJpg])
          await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
          await t.waitText('ชิ้นแรกรออนุมัติ')
          const [p2] = await sql("select id from public.station_checks where job_id = $1 and station_code = $2 and status = 'pending' order by id desc limit 1", [jPE, stCode])
          await as(uid('manager'), 'public.decide_first_piece($2::bigint, true)', [p2.id])
        } else {
          await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [pendingRow.id])
        }
        await t.goto('prod1', `#/board?station=${stCode}`, 1440)
        await t.waitText('ชิ้นแรกผ่านแล้ว')
        await t.uploadFiles('input[type=file][capture]', [media.paths.portraitPng])
        await t.clickButton('ส่งรูปงานเสร็จ 1 รูป')
        await t.waitText('ส่งรูปงานเสร็จแล้ว 1 รูป')
        await t.clickButton(btnLabel)
        await t.clickButton('ยืนยัน', { exact: true })
        await t.waitText('ส่งต่อแล้ว')
      }

      // Now jPE is at sew! Test A.2 SewingNow tab
      await t.goto('prod1', '#/sewing', 1440)
      await t.waitText('SC-A1-PE')
      await t.clickButton(/เริ่มเย็บ/)
      await t.waitText('เริ่มเย็บด้วย')
      await t.clickButton(/เริ่มเย็บด้วย/)
      await t.waitText('ทำเสร็จแล้วถ่ายรูปงานเสร็จ')
      const sewBlocked = await t.ev(() => document.body.innerText.includes('ยังกดเย็บเสร็จไม่ได้'))
      assert.ok(sewBlocked, 'SewingNow ไม่ล็อกปุ่มเย็บเสร็จก่อนส่งรูป')
      await t.screenshot('a2-sew-photo-locked-1440')
      await t.uploadFiles('input[type=file][capture]', [media.paths.landscapePng])
      await t.clickButton('ส่งรูปงานเสร็จ 1 รูป')
      await t.waitText('ส่งรูปงานเสร็จแล้ว 1 รูป · กดเสร็จได้')
      await t.clickButton('เย็บเสร็จ')
      await t.clickButton('ยืนยันเย็บเสร็จ')
      await t.waitText('ส่งต่อ QC + Packing แล้ว')

      // Also test dtf_press on jScr (cut -> dtf_press)
      await t.goto('prod1', '#/board?station=cut', 1440)
      await t.waitText('SC-A1-SCR')
      await t.clickButton(/เริ่ม/)
      await t.waitText('ทำชิ้นแรก 1 ชิ้น')
      await t.uploadFiles('input[type=file][capture]', [media.paths.portraitJpg])
      await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
      await t.waitText('ชิ้นแรกรออนุมัติ')
      const [cCut] = await sql("select id from public.station_checks where job_id = $1 and status = 'pending'", [jScr])
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [cCut.id])
      await t.goto('prod1', '#/board?station=cut', 1440)
      await t.waitText('ชิ้นแรกผ่านแล้ว')
      await t.uploadFiles('input[type=file][capture]', [media.paths.portraitJpg])
      await t.clickButton('ส่งรูปงานเสร็จ 1 รูป')
      await t.waitText('กดเสร็จได้')
      await t.clickButton('ตัดงานเสร็จ')
      await t.clickButton('ยืนยัน', { exact: true })
      await t.waitText('ส่งต่อแล้ว')

      await t.goto('prod1', '#/board?station=dtf_press', 1440)
      await t.waitText('SC-A1-SCR')
      await t.clickButton(/เริ่ม/)
      await t.waitText('ทำชิ้นแรก 1 ชิ้น')
      await t.uploadFiles('input[type=file][capture]', [media.paths.portraitJpg])
      await t.clickButton('ส่งรูปชิ้นแรก 1 รูป')
      await t.waitText('ชิ้นแรกรออนุมัติ')
      const [cDtf] = await sql("select id from public.station_checks where job_id = $1 and status = 'pending'", [jScr])
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [cDtf.id])
      await t.goto('prod1', '#/board?station=dtf_press', 1440)
      await t.waitText('ชิ้นแรกผ่านแล้ว')
      await t.uploadFiles('input[type=file][capture]', [media.paths.portraitJpg])
      await t.clickButton('ส่งรูปงานเสร็จ 1 รูป')
      await t.waitText('กดเสร็จได้')
      await t.clickButton('รีดฟิล์มเสร็จ')
      await t.clickButton('ยืนยัน', { exact: true })
      await t.waitText('ส่งต่อแล้ว')

      // Walk jScr through sew (เย็บงาน) so it reaches qc_pack!
      await t.goto('prod1', '#/sewing', 1440)
      await t.waitText('SC-A1-SCR')
      await t.clickButton(/เริ่มเย็บ/)
      await t.waitText('เริ่มเย็บด้วย')
      await t.clickButton(/เริ่มเย็บด้วย/)
      await t.waitText('ทำเสร็จแล้วถ่ายรูปงานเสร็จ')
      await t.uploadFiles('input[type=file][capture]', [media.paths.landscapePng])
      await t.clickButton('ส่งรูปงานเสร็จ 1 รูป')
      await t.waitText('ส่งรูปงานเสร็จแล้ว 1 รูป · กดเสร็จได้')
      await t.clickButton('เย็บเสร็จ')
      await t.clickButton('ยืนยันเย็บเสร็จ')
      await t.waitText('ส่งต่อ QC + Packing แล้ว')

      // Now A.2 QC + Packing on jPE:
      // Test (1) pass full 10/10 qty with 0 photos -> blocked; (2) test partial 5/10 with photo -> blocked; (3) complete both -> done
      await t.goto('qc', '#/board?station=qc_pack', 1440)
      await t.waitText('SC-A1-PE')
      await t.clickButton('เริ่ม QC + Packing')
      await t.waitText('ทำเสร็จแล้วถ่ายรูปงานเสร็จ')
      // Try pass 10 first without photo
      await t.clickButton('บันทึกผล QC / Packing')
      await t.fillInput('[role=dialog] input[aria-label="จำนวนที่ผ่าน"]', '5')
      await t.clickButton('บันทึกผ่าน')
      await t.waitText('5/10')
      // Upload photo while only 5/10 passed -> finish button MUST still stay locked by QC count
      await t.uploadFiles('[role=dialog] input[type=file][capture]', [media.paths.landscapeJpg])
      await t.clickButton('ส่งรูปงานเสร็จ 1 รูป')
      await t.waitText('ส่งรูปงานเสร็จแล้ว 1 รูป')
      const blockedByQty = await t.ev(() => document.querySelector('[role=dialog]')?.innerText.includes('QC ตรวจผ่าน 5/10 ชิ้น ยังไม่ครบ'))
      assert.ok(blockedByQty, 'QC ไม่บล็อกเมื่อมีรูปแต่ยอดตรวจไม่ครบ')
      // Pass remaining 5 -> finish!
      await t.fillInput('[role=dialog] input[aria-label="จำนวนที่ผ่าน"]', '')
      await t.fillInput('[role=dialog] input[aria-label="จำนวนที่ผ่าน"]', '5')
      await t.clickButton('บันทึกผ่าน')
      await waitFor(() => t.ev(() => {
        const d = document.querySelector('[role=dialog]')
        if (!d) return false
        const b = [...d.querySelectorAll('button')].find(x => x.textContent.includes('QC + Packing เสร็จ'))
        return b && !b.disabled
      }), 'QC ผ่านครบแล้วปลดล็อกปุ่มเสร็จ', 12000)
      await t.clickButton('QC + Packing เสร็จ')
      await t.clickButton('ยืนยัน', { exact: true })
      await t.waitText('ส่งต่อแล้ว')

      // Also test SC-A4-NOMOCK-style QC photo block on jScr (route screen) at QC: pass 10/10 with 0 photos -> blocked by photo!
      await t.goto('qc', '#/board?station=qc_pack', 1440)
      await t.waitText('SC-A1-SCR')
      await t.clickButton('เริ่ม QC + Packing')
      await t.waitText('บันทึกผล QC / Packing')
      await t.clickButton('บันทึกผล QC / Packing')
      await t.fillInput('[role=dialog] input[aria-label="จำนวนที่ผ่าน"]', '10')
      await t.clickButton('บันทึกผ่าน')
      await t.waitText('ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป')
      const blockedByPhoto = await t.ev(() => document.querySelector('[role=dialog]')?.innerText.includes('ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป'))
      assert.ok(blockedByPhoto, 'QC ไม่บล็อกเมื่อผ่านครบ 10/10 แต่ยังไม่ถ่ายรูปงานเสร็จ')
      return 'print, press, cut, dtf_press(screen route), emb, sew, qc_pack (both gates) ผ่านครบ'
    })

    // 6. Part A.9 Burmese Mode + Mobile 375 px across every photo stage
    await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
    await as(uid('owner'), 'public.set_station_photos_enabled(true, 15)')
    const jMy = await receiveAndOptionalMockup('SC-A9-MY', 'cut_only', true, 12)
    await check('A9.burmese-mobile-375', 'โหมดพม่า + มือถือ 375 px ครบทุกขั้นรูป + ตรวจคำไทย/อังกฤษหลุด', async () => {
      await as(uid('staff_single'), 'public.start_in_queue($2::uuid, null)', [jMy])
      await t.goto('staff_single', '#/board', 375)
      // Enable Burmese mode via localStorage and reload
      await t.ev(() => localStorage.setItem('pp142-lang', 'my'))
      await t.goto('staff_single', '#/board', 375)
      await t.waitText('SC-A9-MY')

      const checkCaptureInput = await t.ev(() => {
        const inp = document.querySelector('input[type="file"][capture]')
        return inp ? { accept: inp.getAttribute('accept'), capture: inp.getAttribute('capture') } : null
      })
      assert.equal(checkCaptureInput?.capture, 'environment', 'ไม่มี capture="environment" สำหรับกล้องหลัง')

      await t.screenshot('a9-my-first-piece-375', { fullPage: true })
      const ux1 = await t.measureFloorUx(375)

      // Pick photo, verify preview + small delete button size, note placeholder
      await t.uploadFiles('input[type=file][capture]', [media.paths.portraitJpg])
      await t.waitText('SC-A9-MY')
      const delBtnSize = await t.ev(() => {
        const b = document.querySelector('button[aria-label]')
        const del = [...document.querySelectorAll('ul button')].find(x => x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height < 48)
        return del ? { w: Math.round(del.getBoundingClientRect().width), h: Math.round(del.getBoundingClientRect().height), aria: del.getAttribute('aria-label') } : null
      })
      observations.push({ key: 'photo_delete_btn_size', delBtnSize })
      await t.screenshot('a9-my-picked-375', { fullPage: true })

      // Fake JPG error in Burmese mode
      await t.uploadFiles('input[type=file][capture]', [media.paths.fakeJpg])
      await waitFor(() => t.ev(() => document.querySelectorAll('ul img').length >= 2), 'รูปปลอมเข้า preview')
      await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('SC-A9-MY') && b.className.includes('bg-ok')).click())
      const fakeBurmeseErr = await waitFor(() => t.ev(() => {
        const a = [...document.querySelectorAll('[role=alert]')].map(x => x.innerText.trim()).find(s => s.includes('SC-A9-MY'))
        return a || false
      }), 'error จากไฟล์ fake.jpg ในโหมดพม่า', 10000)
      observations.push({ key: 'burmese_fake_jpg_error', fakeBurmeseErr })
      await t.screenshot('a9-my-fake-error-375')
      // Remove both and upload valid photo
      for (let i = 0; i < 2; i++) await t.ev(() => document.querySelector('ul button')?.click())
      await t.uploadFiles('input[type=file][capture]', [media.paths.portraitJpg])
      await waitFor(() => t.ev(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('SC-A9-MY') && b.className.includes('bg-ok'))), 'ปุ่มส่งสีเขียว')
      await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('SC-A9-MY') && b.className.includes('bg-ok')).click())
      await waitFor(() => t.ev(() => document.body.innerText.includes('စောင့်နေတယ်') || document.body.innerText.includes('အိုကေ')), 'สถานะรออนุมัติพม่า', 12000)
      await t.screenshot('a9-my-waiting-375', { fullPage: true })

      // Backdate 21 min (must also backdate enabled_at & station_started_at so visit_checks includes cWait!)
      const [cWait] = await sql("select id from public.station_checks where job_id = $1 and status = 'pending'", [jMy])
      await sql("update public.station_photo_settings set enabled_at = now() - interval '2 hours'")
      await sql("update public.jobs set station_started_at = now() - interval '90 minutes' where id = $1", [jMy])
      await sql("update public.station_checks set sent_at = now() - interval '21 minutes' where id = $1", [cWait.id])
      await reloadClean(t, 'SC-A9-MY')
      const waitMatch = await waitFor(() => t.ev(() => {
        const txt = document.body.innerText
        const m = txt.match(/[^\n]*အိုကေ စောင့်နေတာ[^\n]*/)?.[0]
        return m ? { m, hasLateNum: /(19|20|21|22)/.test(m) } : false
      }), 'การ์ดรออนุมัติพม่าขึ้นหลังรีเฟรช', 12000)
      observations.push({ key: 'a9_wait_card_after_21m', waitMatch })
      assert.ok(waitMatch.hasLateNum, 'แสดงเวลาไม่ตรง: ' + JSON.stringify(waitMatch))
      await t.screenshot('a9-my-waiting-late-375', { fullPage: true })

      // Reject with preset + custom -> Burmese card
      await as(uid('admin1'), "public.decide_first_piece($2::bigint, false, 'สีเพี้ยน · ขอบไม่ชัด')", [cWait.id])
      await reloadClean(t, 'SC-A9-MY')
      await waitFor(() => t.ev(() => document.body.innerText.includes('မအောင်ဘူး') || document.body.innerText.includes('ไม่ผ่าน')), 'ข้อความไม่ผ่านพม่า/ไทย', 12000)
      await t.screenshot('a9-my-rejected-375', { fullPage: true })
      const rejectTexts = await t.ev(() => [...document.querySelectorAll('p')].filter(p => p.innerText.includes('မအောင်ဘူး') || p.innerText.includes('ไม่ผ่าน')).map(p => p.innerText))
      assert.ok(rejectTexts.some(x => x.includes('မအောင်ဘူး')), 'ข้อความไม่ผ่านควรเป็นพม่า แต่ได้: ' + JSON.stringify(rejectTexts))

      // Resend + approve -> finish photo -> ready in Burmese
      await t.uploadFiles('input[type=file][capture]', [media.paths.landscapeJpg])
      await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('SC-A9-MY') && b.className.includes('bg-ok')).click())
      await waitFor(() => t.ev(() => document.body.innerText.includes('စောင့်နေတယ်')), 'ส่งซ้ำรออนุมัติพม่า', 12000)
      const [c2] = await sql("select id from public.station_checks where job_id = $1 and status = 'pending'", [jMy])
      await as(uid('admin1'), 'public.decide_first_piece($2::bigint, true)', [c2.id])
      await reloadClean(t, 'SC-A9-MY')
      await waitFor(() => t.ev(() => document.body.innerText.includes('အောင်ပြီ')), 'ชิ้นแรกผ่านพม่า', 12000)
      await t.screenshot('a9-my-approved-finish-prompt-375', { fullPage: true })

      await t.uploadFiles('input[type=file][capture]', [media.paths.portraitPng])
      await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('SC-A9-MY') && b.className.includes('bg-ok')).click())
      await waitFor(() => t.ev(() => document.body.innerText.includes('ပြီးပြီ') && document.body.innerText.includes('1')), 'ขึ้นสถานะพร้อมกดเสร็จพม่า', 12000)
      await t.screenshot('a9-my-ready-375', { fullPage: true })

      // Also check Job History in Burmese mode at 375 px (to verify StationPhotoList & timeline Burmese!)
      await t.goto('staff_single', `#/board?job=${jMy}`, 375)
      await t.waitText('SC-A9-MY')
      await t.screenshot('a9-my-drawer-history-375')
      const drawerTexts = await t.ev(() => document.querySelector('[role=dialog]')?.innerText ?? '')
      observations.push({ key: 'burmese_reject_texts', rejectTexts, drawerHasPhotoHistory: drawerTexts.includes('รูปจากสถานี') })

      // Reset lang to Thai
      await t.ev(() => localStorage.removeItem('pp142-lang'))
      return `375px scroll=${ux1.docScrollWidth} · capture=${checkCaptureInput.capture} · delBtn=${JSON.stringify(delBtnSize)}`
    }, { allowErrorStatus: true })
  } finally {
    await media.cleanup()
    await baseFx.cleanup()
    await chrome.close()
    await stack.close()
    await writeFile(OUT_JSON, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      blockedFontRequests: chrome.blockedFontRequests.length,
      results,
      observations,
    }, null, 2))
  }
  const nonLocalExternalAttempts = chrome.externalAttempts.filter(u => !/^http:\/\/127\.0\.0\.1:/.test(u))
  const failed = results.filter(r => !r.pass)
  console.log(`\nSUMMARY test-part-a-ui: ${results.length - failed.length}/${results.length} passed`)
  if (nonLocalExternalAttempts.length > 0) throw new Error('EXTERNAL ATTEMPTS: ' + JSON.stringify(nonLocalExternalAttempts))
  process.exit(failed.length ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
