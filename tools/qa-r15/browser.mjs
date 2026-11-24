import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { registerHooks } from 'node:module'

const serverUrl = new URL('../qa-r14/server.mjs', import.meta.url)
const localPort = Number(process.env.QA_PORT ?? 5214)
const workerPort = Number(process.env.QA_FILES_PORT ?? 5215)
const adapter = registerHooks({
  load(url, context, nextLoad) {
    const original = nextLoad(url, context)
    if (url !== serverUrl.href || (localPort === 5214 && workerPort === 5215)) return original
    const anchor = 'const data = await readFile(fullPath)'
    const source = original.source.toString()
    assert.ok(source.includes(anchor), 'ไม่พบจุดโหลด bundle ในตัวจำลอง')
    return { ...original, source: source.replace(anchor, [
      'let data = await readFile(fullPath)',
      "if (relPath.startsWith('/assets/') && relPath.endsWith('.js')) {",
      "  data = Buffer.from(data.toString().replaceAll('http://127.0.0.1:5214', siteOrigin).replaceAll('http://127.0.0.1:5215', filesOrigin))",
      '}',
    ].join('\n')) }
  },
})
const { startLocalStack } = await import(serverUrl.href)
adapter.deregister()
const { openChrome, waitFor } = await import('../qa-r14/chrome.mjs')
const { createFixtures } = await import('../qa-r14/fixtures.mjs')


const out = resolve(process.argv[2])
const mode = process.argv[3]
const evidence = resolve('docs/qa/img')
await mkdir(out, { recursive: true })
const bundles = (await readdir('app/dist/assets')).filter(path => path.endsWith('.js'))
const js = (await Promise.all(bundles.map(path => readFile(resolve('app/dist/assets', path), 'utf8')))).join('')
assert.ok(js.includes('http://127.0.0.1:5214') && js.includes('http://127.0.0.1:5215'), 'ต้อง build แบบ loopback ก่อน')
const stack = await startLocalStack({ port: localPort, filesPort: workerPort })
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
process.env.QA_ORIGIN = stack.origin
const t = chrome.wrap(chrome.main)
const results = []

async function check(id, fn) {
  try {
    const detail = await fn()
    results.push({ id, passed: true, detail })
    console.log('PASS', id)
  } catch (error) {
    const screen = await t.ev(() => document.body.innerText).catch(() => null)
    results.push({ id, passed: false, error: error.message, screen })
    console.log('FAIL', id, error.message)
  }
}

async function capture(name, pdf = false) {
  const result = await t.send(pdf ? 'Page.printToPDF' : 'Page.captureScreenshot',
    pdf ? { printBackground: true, preferCSSPageSize: true } : { format: 'png' })
  const path = resolve(pdf ? out : evidence, name + (pdf ? '.pdf' : '.png'))
  await writeFile(path, Buffer.from(result.data, 'base64'))
}

async function freshForm(key, width, header = {}, spec = {}) {
  await t.goto('admin1', '', width, '/confirmation')
  await t.waitText('ใบยืนยันการผลิต')
  await t.ev((product, h, p) => {
    state = fresh()
    Object.assign(state.h, h)
    state.pickOpen = false
    state.product = product
    Object.assign(scope('p'), p)
    renderForm()
    window.print = () => { window.qaPrints = (window.qaPrints ?? 0) + 1 }
  }, key, header, spec)
}

const docFields = { doc_no: 'TEST-R15', customer: 'ลูกค้าจำลอง' }
const faults = /undefined|NaN|\[object|\bnull\b/

async function formChecks() {
  await check('B1-required', async () => {
    await freshForm('jersey', 1440)
    const counts = () => t.ev(() => ({ hard: validate().filter(m => m.hard).map(m => m.id), prints: window.qaPrints ?? 0 }))
    assert.deepEqual(await counts(), { hard: ['fld_h_doc_no', 'fld_h_customer'], prints: 0 })
    await t.clickButton('ส่งออก PDF')
    assert.equal(await t.ev(() => !!document.querySelector('#alert .alert:not(.soft)')), true)
    await t.fillInput('[data-k="doc_no"]', docFields.doc_no)
    await t.fillInput('[data-k="customer"]', docFields.customer)
    await t.fillInput('[data-k="issue_date"]', '2026-12-02')
    await t.fillInput('[data-k="due_date"]', '2026-12-01')
    await t.clickButton('ส่งออก PDF')
    assert.deepEqual(await counts(), { hard: ['fld_h_due_date'], prints: 0 })
    await t.fillInput('[data-k="due_date"]', '2026-12-05')
    const offset = chrome.main.dialogs.length
    chrome.main.setDialogAccept(false)
    await t.clickButton('ส่งออก PDF')
    await waitFor(() => chrome.main.dialogs.length === offset + 1, 'ข้อความยืนยันเมื่อกรอกไม่ครบ')
    assert.deepEqual(await counts(), { hard: [], prints: 0 })
    chrome.main.setDialogAccept(true)
    await t.clickButton('ส่งออก PDF')
    await waitFor(async () => (await counts()).prints === 1, 'เรียกพิมพ์')
    assert.equal(chrome.main.dialogs.length - offset, 2)
    return 'ขาดเลขที่ใบ/ลูกค้าและวันที่ย้อนถูกบล็อก กล่องส้มถามหนึ่งครั้งต่อการกด ยกเลิกไม่พิมพ์'
  })

  const keys = await t.ev(() => Object.keys(PRODUCTS))
  for (const product of keys) {
    await check('B7-min-' + product, async () => {
      await freshForm(product, 768, { ...docFields, doc_no: 'TEST-R15-MIN-' + product })
      const offset = chrome.main.dialogs.length
      await t.clickButton('ส่งออก PDF')
      await waitFor(() => t.ev(() => window.qaPrints === 1), 'เรียกพิมพ์')
      assert.equal(chrome.main.dialogs.length - offset, 1)
      await t.clickButton('ดูตัวอย่าง PDF')
      const doc = await t.ev(() => ({
        text: document.querySelector('#doc').innerText,
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        font: getComputedStyle(document.querySelector('#doc')).fontFamily,
      }))
      assert.match(doc.text, /ลูกค้าจำลอง/)
      assert.doesNotMatch(doc.text, faults)
      await capture('r15-cx-min-' + product, true)
      return { width: doc.width, viewport: doc.viewport, font: doc.font }
    })
  }

  await check('B4-sewing', async () => {
    await freshForm('jersey', 1440, docFields)
    const result = await t.ev(() => {
      const modes = []
      for (const key of Object.keys(PRODUCTS)) {
        state = fresh()
        state.product = key
        state.pickOpen = false
        const part = scope('p')
        const sec = layout().find(sec => sec.fields?.some(f => f.id === 'sew_mode'))
        if (!sec) continue
        const hidden = sec.fields.filter(f => !visible(f, part)).map(f => f.id)
        const defaultMode = part.sew_mode
        renderForm()
        document.querySelectorAll('[data-k="sew_mode"]')[1]?.click()
        const custom = sec.fields.filter(f => visible(f, part)).map(f => f.id)
        modes.push({ key, defaultMode, selected: part.sew_mode, hidden, custom })
      }
      return modes
    })
    assert.ok(result.length > 0)
    for (const row of result) {
      assert.equal(row.defaultMode, 'เย็บตามมาตรฐานโรงงาน')
      assert.match(row.selected, /ลูกค้ากำหนด/)
      assert.ok(row.hidden.length && row.custom.some(field => row.hidden.includes(field)), row.key)
    }
    return result
  })

  await check('B4-legacy-json', async () => {
    const path = resolve(out, 'old-sewing.json')
    await writeFile(path, JSON.stringify({ app: 'phappim-confirm', v: 1, h: docFields,
      product: 'tshirt', p: { tshirt: { hem: 'ลา 1 เข็ม', side_seam: 'โพ้งปกติ' } }, imgs: [] }))
    await freshForm('tshirt', 1440, docFields)
    await t.uploadFiles('#openFile', [path])
    await t.waitText('เปิดไฟล์ old-sewing.json แล้ว')
    const old = await t.ev(() => ({ p: state.p.tshirt, hem: document.querySelector('[data-k=hem]:checked')?.value }))
    assert.equal(old.hem, 'ลา 1 เข็ม')
    assert.equal(old.p.side_seam, 'โพ้งปกติ')
    return old
  })

  await check('B2-fields', async () => {
    const data = []
    for (const key of ['jersey', 'jacket', 'bag']) {
      await freshForm(key, 1440, docFields)
      data.push(await t.ev(() => ({
        key: state.product,
        render: layout().flatMap(s => s.fields ?? []).map(f => [f.id, f.label, f.options, f.cols?.map(c => c.label)]),
      })))
    }
    return data
  })
}


async function specChecks() {
  const fixture = await createFixtures(t)
  const sizes = ['S', 'M', 'L', 'XL'].map((size, i) => ({
    size, chest: String(38 + i * 2), length: String(25 + i),
    sleeve: String(8 + i), other: 'ขนาดซิป ' + (23 + i) + ' นิ้ว',
  }))

  await check('B2-SC690871', async () => {
    for (const key of ['jersey', 'jacket']) {
      const isJersey = key === 'jersey'
      const spec = {
        fabric: isJersey ? 'ผ้าตาข่าย' : 'ผ้าวอร์ม 1 หน้า (Tricot)',
        fabric_rows: [
          { part: 'ตัวหน้า', fabric: 'ผ้าตาข่าย', color: 'สีขาว', print: 'พิมพ์สีแดงจำลอง' },
          { part: 'แขน', fabric: 'ไมโครเรียบ', color: 'สีดำ', print: 'พิมพ์สีขาวจำลอง' },
        ],
        size_chart: 'กำหนดขนาดเอง (ตามตารางด้านล่าง)',
        measure_rows: sizes,
        attach_rows: [
          { kind: 'ป้ายแบรนด์', pos: 'คอด้านหลัง', owner: 'ของลูกค้า (ส่งมา)' },
          { kind: 'ป้ายแบรนด์', pos: 'ชายเสื้อด้านใน', owner: 'ของลูกค้า (ส่งมา)' },
          ...(isJersey ? ['อกซ้าย', 'อกขวา', 'แขนซ้าย', 'แขนขวา'].map(pos => ({
            kind: 'โลโก้ยาง', pos, owner: 'ของลูกค้า (ส่งมา)',
          })) : []),
        ],
        ...(isJersey ? {
          sleeve: 'แขนสั้น', neck_fabric: 'ซกคอสำเร็จ (ริบทอลาย)',
          neck_color: 'ดำริ้วขาว', piping: 'เย็บตัดต่อกุ๊นสีดำ',
        } : {
          cut: 'คอตั้ง ซิปหน้า', zip_type: 'ซิปพลาสติก (ฟันกระดูกงู)', zip_color: 'ดำ YKK',
          details: ['ยางยืดปลายแขน', 'ยางยืดชายเสื้อ', 'อื่นๆ'],
          details__other: 'ปรับเพิ่มความยืดหยุ่นที่แขนและชายเสื้อ',
        }),
      }
      await freshForm(key, isJersey ? 1440 : 768, { ...docFields, doc_no: 'TEST-SC690871-' + (isJersey ? '0001' : '0002'),
        admin: 'ผู้ประสานงานจำลอง', admin_phone: '080-000-0000', delivery: 'รถบริษัทไปส่ง',
        address: 'ที่อยู่ทดสอบ', sample: 'ไม่ขึ้นตัวอย่าง',
      }, spec)
      await t.ev(() => {
        const part = scope('p')
        const row = rows(part, 'sizes')[0]
        row.label = 'สีตัวอย่าง'
        for (const size of ['S', 'M', 'L', 'XL']) row.q[size] = 10
        renderForm()
      })
      await t.uploadFiles('input[type="file"][data-img]', [fixture.paths.frontPng])
      await t.fillInput('[data-imgcap="0"]', 'ตัวอย่างภาพ ' + key)
      await t.clickButton('ส่งออก PDF')
      await waitFor(() => t.ev(() => window.qaPrints === 1), 'เรียกพิมพ์')
      await t.clickButton('ดูตัวอย่าง PDF')
      const doc = await t.ev(() => document.querySelector('#doc').innerText)
      for (const word of ['080-000-0000', 'รถบริษัทไปส่ง', 'XL', 'พิมพ์สีแดงจำลอง', 'พิมพ์สีขาวจำลอง', 'ป้ายแบรนด์', 'ตัวอย่างภาพ ' + key,
        ...(isJersey ? ['ซกคอสำเร็จ', 'ดำริ้วขาว', 'เย็บตัดต่อกุ๊นสีดำ', 'โลโก้ยาง'] : ['YKK', 'กระดูกงู', 'ปรับเพิ่มความยืดหยุ่น'])]) {
        assert.ok(doc.includes(word), key + ' ไม่พบในตัวอย่าง PDF: ' + word)
      }
      await capture('r15-cx-sc690871-' + key, true)
    }
    return 'ผลิตซ้ำ 2 ใบด้วยชื่อ เบอร์ จำนวน และภาพจำลอง โครงรายการอ้างอิงใบจริง'
  })

  await check('B5-bag-options', async () => {
    for (const value of ['หูหิ้ว 2 หู', 'เชือกหูรูด', 'อื่นๆ']) {
      await freshForm('bag', 768, docFields)
      await t.ev(choice => [...document.querySelectorAll('input[data-k="handle_style"]')].find(i => i.value === choice).click(), value)
      if (value === 'อื่นๆ') await t.fillInput('[data-k="handle_style__other"]', 'สายทดสอบแบบเฉพาะ')
      await t.clickButton('ดูตัวอย่าง PDF')
      assert.ok((await t.ev(() => document.querySelector('#doc').innerText)).includes(value === 'อื่นๆ' ? 'สายทดสอบแบบเฉพาะ' : value))
    }
    return 'หูหิ้ว 2 หู เชือกหูรูด อื่นๆ'
  })

  await check('C4-new-fields', async () => {
    await freshForm('jersey', 768, docFields, {
      size_chart: 'กำหนดขนาดเอง (ตามตารางด้านล่าง)',
      measure_rows: [{ size: 'S', chest: '36' }],
      attach_rows: [{ kind: 'ป้ายแบรนด์', pos: 'คอ', owner: 'ของลูกค้า (ส่งมา)' }],
      fabric_rows: [{ part: 'หน้า', fabric: 'ไมโคร', color: 'ขาว' }],
    })
    const input = [
      ['[data-k="admin_phone"]', '080-000-0000'],
      ['[data-t="measure_rows"][data-c="chest"]', '-2.5'],
      ['[data-t="measure_rows"][data-c="other"]', 'ขนาด\t36'],
      ['[data-t="attach_rows"][data-c="pos"]', '<script>ข้อความทดสอบ</script>'],
      ['[data-t="attach_rows"][data-c="note"]', 'รายละเอียด 🧵 ' + 'ทดสอบ'.repeat(65)],
      ['[data-t="fabric_rows"][data-c="print"]', 'ขาว\tดำ 🧵'],
      ['[data-k="piping"]', 'กุ๊น 🧵'],
    ]
    for (const [selector, value] of input) await t.fillInput(selector, value)
    await t.clickButton('ดูตัวอย่าง PDF')
    const result = await t.ev(() => {
      const doc = document.querySelector('#doc')
      return { text: doc.innerText, scriptCount: doc.querySelectorAll('script').length,
        scroll: document.documentElement.scrollWidth, viewport: innerWidth }
    })
    assert.equal(result.scriptCount, 0)
    assert.match(result.text, /<script>ข้อความทดสอบ<\/script>/)
    assert.match(result.text, /🧵/)
    assert.doesNotMatch(result.text, faults)
    await t.clickButton('ส่งออก PDF')
    await waitFor(() => t.ev(() => window.qaPrints === 1), 'ส่งออก PDF ที่มีค่าติดลบ')
    await t.ev(() => [...document.querySelectorAll('#doc td')]
      .find(el => el.innerText.trim() === '-2.5').scrollIntoView({ block: 'center' }))
    await capture('r15-cx-confirmation-negative-measure')
    await capture('r15-cx-confirmation-negative-measure', true)
    return { negativeMeasurementPrinted: result.text.includes('-2.5'), scroll: result.scroll, viewport: result.viewport }
  })
}

async function languageChecks() {
  await promisify(execFile)(process.execPath, ['tools/qa-r14/seed-station.mjs'], { timeout: 20_000 })
  await t.goto('none', '#/', 375)
  await t.waitText('เข้าสู่ระบบ')
  const lang = () => t.ev(() => localStorage.getItem('pp142-lang'))
  if (await lang() !== 'my') {
    await t.ev(() => {
      const button = [...document.querySelectorAll('button')].find(el =>
        /ภาษา|language|မြန်မာ/i.test([el.title, el.getAttribute('aria-label'), el.innerText].join(' ')))
      if (!button) throw new Error('ไม่พบปุ่มลูกโลก')
      button.click()
    })
  }
  assert.equal(await lang(), 'my')
  await capture('r15-cx-login-my-375')

  await t.fillInput('input[name="email"]', 'staff-single@r14.invalid')
  await t.fillInput('input[name="password"]', 'r14-local-pass')
  await t.clickButton('เข้าสู่ระบบ')
  await t.waitText('พนักงานตัด')


  for (const role of ['staff_single', 'staff_multi', 'staff_qc', 'qc', 'admin1', 'manager']) {
    for (const width of (role === 'admin1' || role === 'manager' ? [1440] : [375, 768])) {
      await t.goto(role, '#/board', width)
      await waitFor(() => t.ev(() => !!document.querySelector('main,[data-scroll=dashboard]')), 'แสดงหน้าจอหลังเปลี่ยนบัญชี')
      for (const hash of (role === 'admin1' || role === 'manager' ? ['#/board'] :
        ['#/board', '#/mine', '#/history', '#/report', '#/production-queue', '#/inbox', '#/words'])) {
        await check([role, width, hash].join(' '), async () => {
          const logs = chrome.main.logs.length
          await t.ev(next => { location.hash = next }, hash)
          await waitFor(() => t.ev(next => location.hash === next && !!document.querySelector('main,[data-scroll=dashboard]') &&
            document.querySelector('main,[data-scroll=dashboard]').innerText.trim().length > 0, hash), 'แสดงหน้าจอ')
          const screen = await t.ev(() => {
            const text = document.body.innerText
            const leaves = [...document.querySelectorAll('main *,[data-scroll=dashboard] *')]
              .filter(el => el.getClientRects().length)
              .flatMap(el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim())
                .filter(str => /[\u0E01-\u0E5B]/u.test(str)).filter(() =>
                  !el.closest('.tr') && !/[\u1000-\u109F]/u.test(el.parentElement?.innerText ?? '')))
            const clipped = [...document.querySelectorAll('nav .truncate,header .truncate')]
              .filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth)
              .map(el => ({ text: el.textContent, width: el.clientWidth, needed: el.scrollWidth }))
            return { hash: location.hash, text, pureThai: [...new Set(leaves)], clipped }
          })
          if (role === 'staff_qc' && width === 375 && hash === '#/board') {
            await waitFor(() => t.ev(() => {
              const filters = [...document.querySelectorAll('details')].find(el => el.innerText.includes('ตัวกรองเพิ่มเติม'))
              if (!filters) return false
              filters.open = true
              filters.scrollIntoView({ block: 'center' })
              return true
            }), 'ตัวกรองบอร์ด')
            await capture('r15-cx-board-filter-my-375')
          }
          const ux = await t.measureFloorUx(width)
          const my = /[\u1000-\u109F]/u.test(screen.text)
          assert.equal(my, role !== 'admin1' && role !== 'manager')
          if ((role === 'staff_single' && ['#/board', '#/history', '#/production-queue'].includes(hash)) ||
              (role === 'staff_qc' && hash === '#/inbox')) {
            await capture('r15-cx-' + role + '-' + hash.slice(2) + '-' + width)
          }
          return { ...screen, ux, logs: chrome.main.logs.slice(logs) }
        })
      }
    }
  }
}




async function pwaChecks() {
  await check('A1-A6-update-banner', async () => {
    await t.send('Network.setBypassServiceWorker', { bypass: false })
    await t.goto('staff_single', '#/board', 375)
    await t.waitText('งานที่สถานีของฉัน')
    await t.ev(() => document.querySelector('button[aria-label*="เปลี่ยนเป็นภาษาพม่า"]').click())
    await waitFor(() => t.ev(async () => !!(await navigator.serviceWorker.getRegistration())?.active), 'service worker รุ่นแรก', 15_000)
    if (!await t.ev(() => !!navigator.serviceWorker.controller)) {
      await t.goto('staff_single', '#/board', 375)
    }
    await waitFor(() => t.ev(() => !!navigator.serviceWorker.controller), 'service worker คุมหน้า')
    stack.setConfig({ swRev: 1 })
    await t.ev(async () => (await navigator.serviceWorker.getRegistration()).update())
    const getBanner = () => t.ev(() => {
      const el = [...document.querySelectorAll('aside')].find(a => a.innerText.includes('มีระบบรุ่นใหม่'))
      return el && { text: el.innerText, my: !!el.querySelector('.tr-my'), th: !!el.querySelector('.tr-th') }
    })
    const staff = await waitFor(getBanner, 'แถบรุ่นใหม่พนักงาน', 12_000)
    assert.equal(staff.my && staff.th, true)
    await capture('r15-cx-update-my-375')
    const nonStaff = []
    for (const role of ['admin1', 'manager']) {
      await t.goto(role, '#/board', 1440)
      const banner = await waitFor(getBanner, 'แถบรุ่นใหม่ ' + role, 12_000)
      nonStaff.push({ role, ...banner })
      if (banner.my) await capture('r15-cx-update-' + role + '-1440')
    }
    return { staff, nonStaff }
  })
}

async function rightsChecks() {
  await promisify(execFile)(process.execPath, ['tools/qa-r14/seed-station.mjs'], { timeout: 20_000 })
  const [{ id }] = await query("select id from jobs where confirmation_no='SC69003'")
  const fixture = await createFixtures(t)
  await t.goto('admin1', '#/mockup?id=' + id, 1440)
  await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
  await t.waitText('อัปโหลดภาพหลักก่อน')
  await t.uploadFiles('input[type="file"][accept*="png"]', [fixture.paths.frontPng])
  await t.clickButton('ใช้เป็นภาพหลัก')
  await t.waitText('เพิ่มภาพหลักแล้ว')
  await t.clickButton('อนุมัติฉบับ 1 ใช้ผลิต')
  await t.waitText('ใช้ผลิต: ฉบับ 1')
  const [{ sheet }] = await query('select id sheet from mockup_sheets where job_id=$1 and status=$2', [id, 'approved'])

  await t.ev(() => localStorage.setItem('pp142-lang', 'my'))
  for (const [role, station, ackAllowed, draftAllowed] of [
    ['admin1', 'cut', false, true],
    ['manager', 'cut', false, false],
    ['staff_single', 'cut', true, false],
    ['prod1', 'cut', true, false],
    ['staff_qc', 'cut', false, false],
    ['qc', 'cut', false, false],
  ]) {
    await check('C3-' + role, async () => {
      await t.goto(role, '#/mockup?id=' + id, 768)
      await t.waitText(/ฉบับ 1|သုံးနေတဲ့/)
      if (role === 'staff_single') {
        await t.waitText('รับทราบสเปกฉบับ 1')
        await capture('r15-cx-mockup-my-768')
        await t.clickButton('รับทราบสเปกฉบับ 1')
        await t.waitText('สถานีตัดงานรับทราบสเปกฉบับ 1 แล้ว')
      }
      const result = await t.ev(async (sheetId, code, testRole) => {
        const session = JSON.parse(localStorage.getItem('sb-127-auth-token'))
        const call = async (name, body) => {
          const response = await fetch('/rest/v1/rpc/' + name, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify(body),
          })
          return { ok: response.ok, status: response.status, text: await response.text() }
        }
        return {
          ack: await call('ack_mockup_sheet', { p_sheet: sheetId, p_station: code }),
          draft: await call('save_confirmation_draft', { p_data: { app: 'phappim-confirm', v: 1, h: { doc_no: 'TEST-R15-RIGHTS-' + testRole }, product: 'jersey', p: {} } }),
          ackButton: [...document.querySelectorAll('button')].some(b => b.innerText.includes('รับทราบสเปกฉบับ')),
        }
      }, sheet, station, role)
      if (result.ack.ok && !ackAllowed || result.draft.ok && !draftAllowed) {
        throw new Error('ระดับ 1: บทบาทผ่านการบันทึกเกินสิทธิ์ ' + JSON.stringify(result))
      }
      assert.equal(result.ack.ok, ackAllowed, JSON.stringify(result))
      assert.equal(result.draft.ok, draftAllowed, JSON.stringify(result))
      return result
    })
  }
}

async function actionChecks() {
  await promisify(execFile)(process.execPath, ['tools/qa-r14/seed-station.mjs'], { timeout: 20_000 })
  const [, cut2, cut3, cut4] = await query("select id, confirmation_no from jobs where confirmation_no like 'SC6900%' order by confirmation_no")
  await t.goto('staff_single', '#/board?station=cut', 375)
  await t.waitText(cut3.confirmation_no)
  await t.ev(() => document.querySelector('button[aria-label*="เปลี่ยนเป็นภาษาพม่า"]').click())
  await t.waitText('เริ่มก่อนคิว')
  await check('A2-start-early', async () => {
    await t.clickButton('เริ่มก่อนคิว')
    await t.fillInput('#q-wait input, input[placeholder]', 'เหตุผลทดสอบ')
    await t.clickButton('บันทึกและเริ่ม')
    await t.waitText(/เริ่ม SC69004 ก่อนคิวแล้ว/)
    const [row] = await query('select station_status from jobs where id=$1', [cut4.id])
    assert.equal(row.station_status, 'doing')
    await capture('r15-cx-start-early-my')
    return row
  })

  await check('A2-pause-cut', async () => {
    await t.goto('staff_single', '#/board?job=' + cut4.id, 375)
    await t.waitText('ความคืบหน้า')
    await t.clickButton('พักงาน / ติดปัญหา')
    await t.fillInput('[role="dialog"] input:not([type])', 'หยุดเพื่อทดสอบ')
    await t.clickButton('บันทึกพักงาน')
    await t.waitText('พักงานแล้ว · เวลาที่พักไม่นับเป็นเวลาทำงาน')
    const [row] = await query('select station_status from jobs where id=$1', [cut4.id])
    assert.equal(row.station_status, 'hold')
    return row
  })

  await check('A2-finish-cut', async () => {
    await t.goto('staff_single', '#/board?job=' + cut2.id, 768)
    await t.waitText('ความคืบหน้า')
    await t.clickButton('ตัดงานเสร็จ')
    await t.clickButton(/ยืนยัน$/, { inside: '[role="dialog"]' })
    const [row] = await waitFor(async () => {
      const rows = await query("select current_station, station_status from job_live where id=$1 and current_station='qc_pack'", [cut2.id])
      return rows.length && rows
    }, 'งานถึง QC')
    return row
  })

  await check('A2-A3-qc', async () => {
    await t.goto('staff_qc', '#/board?job=' + cut2.id, 375)
    await t.waitText('ความคืบหน้า')
    await t.clickButton('เริ่ม QC + Packing')
    await t.waitText('บันทึกผ่าน')
    assert.equal(await t.ev(() => [...document.querySelectorAll('button')].some(b => b.disabled && b.innerText.includes('ยังกดเสร็จไม่ได้'))), true)
    await t.fillInput('[role="dialog"] input[type="number"]', '101')
    await t.clickButton('บันทึกผ่าน')
    await t.waitText('บันทึกผ่านได้อีกไม่เกิน')
    const passedError = await alerts()
    await capture('r15-cx-qc-pass-error-my')
    await t.clickButton('ส่งกลับแก้')
    await t.fillInput('[role="dialog"] input[type="number"]', '101', { index: 1 })
    await t.ev(() => {
      const input = [...document.querySelectorAll('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])')]
        .find(el => el.closest('.bg-paper') && el.getAttribute('aria-label'))
      if (!input) throw new Error('ไม่พบช่องสาเหตุ')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ตะเข็บจำลอง')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await t.clickButton('ยืนยันส่งกลับแก้')
    await t.waitText(/เหลืออีก|ส่งแก้ได้|ส่งกลับแก้ได้|จำนวนที่ยังไม่ผ่าน/)
    const reworkError = await alerts()
    await capture('r15-cx-qc-rework-error-my')
    await t.fillInput('[role="dialog"] input[type="number"]', '25')
    await t.clickButton('บันทึกผ่าน')
    await t.waitText('บันทึกผ่าน QC 25')
    const [[passMessage], [{ qc_passed }]] = await Promise.all([
      t.ev(() => [...document.querySelectorAll('[role=status]')].map(el => el.innerText).filter(s => s.includes('บันทึกผ่าน QC 25'))),
      query('select qc_passed from job_live where id=$1', [cut2.id]),
    ])
    assert.equal(Number(qc_passed), 25)
    return { passedError, reworkError, passMessage, qc_passed }
  })


  await check('A2-sla-report', async () => {
    await query("update jobs set station_started_at=now()-interval '5 days' where id=$1", [cut2.id])
    await t.goto('staff_qc', '#/board?job=' + cut2.id, 768)
    await t.waitText('ต้องส่งรายงานปัญหาก่อนกดเสร็จ')
    await t.ev(() => document.querySelector('[role="dialog"] fieldset button[aria-pressed="false"]').click())
    await t.fillInput('[role="dialog"] fieldset ~ label textarea', 'ทดสอบเกินเวลามาตรฐาน')
    await t.fillInput('[role="dialog"] input[type="date"]', '2099-01-20')
    await t.clickButton('ส่งรายงานปัญหา')
    await t.waitText('ส่งรายงานปัญหาแล้ว')
    const [row] = await query('select detail from delay_reports where job_id=$1', [cut2.id])
    assert.equal(row.detail, 'ทดสอบเกินเวลามาตรฐาน')
    await capture('r15-cx-delay-report-my-768')
    return row
  })


  await check('A2-send-rework', async () => {
    await t.goto('staff_qc', '#/board?job=' + cut2.id, 768)
    await t.waitText('ความคืบหน้า')
    await t.clickButton('ส่งกลับแก้')
    await t.fillInput('[role="dialog"] input[type="number"]', '1', { index: 1 })
    await t.ev(() => {
      const input = [...document.querySelectorAll('[role="dialog"] input:not([type])')]
        .find(el => el.closest('.bg-paper') && el.getAttribute('aria-label'))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ตัดแก้จำลอง')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await t.clickButton('ยืนยันส่งกลับแก้')
    await t.waitText('ส่งกลับแก้ 1')
    const message = await t.ev(() => [...document.querySelectorAll('[role=status]')].map(el => el.innerText).find(s => s.includes('ส่งกลับแก้ 1')))
    assert.match(message, /[\u1000-\u109f]/u)
    await capture('r15-cx-rework-sent-my-768')
    return message
  })

  await check('A3-offline', async () => {
    await t.goto('staff_multi', '#/board?station=cut', 375)
    await t.waitText(cut3.confirmation_no)
    try {
      await t.setOffline(true)
      const message = await waitFor(() => t.ev(() => [...document.querySelectorAll('[role="status"],[role="alert"]')]
        .map(el => el.innerText).find(s => /ချိတ်ဆက်|အင်တာနက်|ออฟไลน์/.test(s))), 'แถบออฟไลน์')
      await capture('r15-cx-offline-my')
      return message
    } finally {
      await t.setOffline(false)
    }
  })

  await check('A3-stale-wrong-station', async () => {
    const peer = chrome.wrap(await chrome.newTab({ isolated: true }))
    await t.goto('staff_single', '#/board?job=' + cut3.id, 375)
    await t.waitText('เริ่มตัดงาน')
    await peer.goto('staff_single', '#/board?job=' + cut3.id, 768)
    await peer.clickButton('เริ่มตัดงาน')
    await peer.clickButton('ตัดงานเสร็จ')
    await peer.clickButton(/ยืนยัน$/, { inside: '[role="dialog"]' })
    await waitFor(async () => (await query("select id from job_live where id=$1 and current_station='qc_pack'", [cut3.id])).length, 'งานย้ายไป QC')
    await t.clickButton('เริ่มตัดงาน')
    await waitFor(async () => (await alerts()).length, 'แจ้งว่ากดไม่ได้')
    const message = await alerts()
    await capture('r15-cx-stale-station-my')
    const [row] = await query('select current_station,station_status from job_live where id=$1', [cut3.id])
    assert.deepEqual(row, { current_station: 'qc_pack', station_status: 'queued' })
    return message
  })


  await check('A3-stale-same-station', async () => {
    const peer = chrome.wrap(await chrome.newTab({ isolated: true }))
    await t.goto('staff_qc', '#/board?job=' + cut3.id, 375)
    await t.waitText('เริ่ม QC + Packing')
    await peer.goto('staff_qc', '#/board?job=' + cut3.id, 768)
    await peer.clickButton('เริ่ม QC + Packing')
    await peer.waitText('บันทึกผ่าน')
    await t.clickButton('เริ่ม QC + Packing')
    await waitFor(async () => (await alerts()).some(alert => alert.bilingual), 'แจ้งสถานะเปลี่ยนสองภาษา')
    const message = await alerts()
    await capture('r15-cx-stale-status-my')
    return message
  })

}

async function query(sql, params = []) {
  const response = await fetch(stack.origin + '/__qa/sql', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  })
  assert.equal(response.status, 200)
  return (await response.json()).rows
}

async function alerts() {
  return t.ev(() => [...document.querySelectorAll('[role="alert"]')].map(el => ({
    text: el.innerText, bilingual: !!el.querySelector('.tr-my') && !!el.querySelector('.tr-th'),
  })))
}

async function intakeChecks() {
  const variants = [
    ['jersey', '0001', 'แขนสั้น'],
    ['jacket', '0002', null],
    ['jersey', 'LONG', 'แขนยาว'],
    ['bag', 'BAG-HANDLE', null, 'หูหิ้ว 2 หู'],
    ['bag', 'BAG-DRAW', null, 'เชือกหูรูด'],
  ]
  const needs = await query("select product_type_code,type_code,qty from product_machine_needs where product_type_code in ('jersey','sport') order by type_code")
  await check('B5-jersey-formula', () => {
    const rowsFor = product => needs.filter(row => row.product_type_code === product).map(({ type_code, qty }) => ({ type_code, qty }))
    assert.ok(rowsFor('sport').length)
    assert.deepEqual(rowsFor('jersey'), rowsFor('sport'))
    return rowsFor('jersey')
  })
  for (const [product, suffix, sleeve, handle] of variants) {
    const no = 'TEST-SC690871-' + suffix
    await check('B3-B5-' + suffix, async () => {
      await freshForm(product, 768, { ...docFields, doc_no: no,
        job_name: 'สินค้าจำลอง ' + suffix, issue_date: '2026-11-21',
        due_date: '2099-01-20', sample: 'ไม่ขึ้นตัวอย่าง', delivery: 'รถบริษัทไปส่ง',
      })
      await t.ev((variant, handleStyle, qty) => {
        const p = scope('p')
        if (variant) p.sleeve = variant
        if (handleStyle) {
          p.handle_style = handleStyle
          p.qty = qty
        }
        const f = layout().flatMap(s => s.fields ?? []).find(f => f.type === 'sizeTable')
        if (f) {
          rows(p, f.id)[0].label = 'สีจำลอง'
          rows(p, f.id)[0].q[sizeCols(p)[0]] = qty
        } else {
          const table = layout().flatMap(s => s.fields ?? []).find(f => f.type === 'itemTable' && f.cols.some(c => c.c === 'qty'))
          if (table) {
            const row = Object.fromEntries(table.cols.map(c => [c.c, c.c === 'qty' ? qty : 'รายการจำลอง']))
            p[table.id] = [row]
          }
        }
        renderForm()
        window.open = url => { window.qaTarget = url; return window }
      }, sleeve, handle, 10)
      await t.clickButton('บันทึกเข้าระบบ')
      assert.equal(await t.ev(() => window.qaTarget), '/#/board?confirmation=save')
      await t.goto('admin1', '#/board?confirmation=save', 768)
      await waitFor(async () => (await query('select id from confirmation_drafts where confirmation_no=$1', [no])).length, 'ร่างในฐานจำลอง')
      await t.clickButton('รับงานใหม่')
      await t.waitText('รับงานเข้าโรงงาน')
      await waitFor(() => t.ev(number => [...document.querySelectorAll('select option')].some(o => o.textContent.includes(number)), no), 'ร่างพร้อมเลือก')
      await t.ev((number) => {
        const select = [...document.querySelectorAll('select')].find(el => [...el.options].some(o => o.textContent.includes(number)))
        if (!select) throw new Error('ไม่พบตัวเลือกร่างใบยืนยัน')
        select.value = [...select.options].find(o => o.textContent.includes(number)).value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }, no)
      await t.waitText('ดึงข้อมูลจากใบ ' + no)
      await t.selectOption('[role="dialog"] select:has(option[value="plain"])', 'plain')
      await t.waitText('ลำดับสถานี:')
      if (await t.ev(() => !document.querySelector('input[name="needs-sample"]:checked'))) {
        await t.ev(() => document.querySelectorAll('input[name="needs-sample"]')[2].click())
      }
      const quantity = await t.ev(() => [...document.querySelectorAll('[role="dialog"] input')]
        .some(i => i.closest('label')?.textContent.includes('จำนวน')))
      if (quantity) {
        await t.ev(() => {
          const input = [...document.querySelectorAll('[role="dialog"] input')]
            .find(i => i.closest('label')?.textContent.includes('จำนวน'))
          if (Number(input.value) > 0) return
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '10')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
      }
      await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
      await t.waitText('ส่งงาน ' + no + ' เข้าโรงงานแล้ว')
      const [job] = await query('select id, product_type_code, qty, private.station_at(route_code,station_seq) station from jobs where confirmation_no=$1', [no])
      assert.equal(job.product_type_code, product)
      await t.goto('staff_multi', '#/board?station=cut', 375)
      await t.waitText(no)
      await t.clickButton('เริ่มตัดงาน')
      await t.clickButton('ตัดงานเสร็จ')
      await t.clickButton('ยืนยัน')
      const afterCut = await waitFor(async () => {
        const [row] = await query('select private.station_at(route_code,station_seq) station from jobs where id=$1', [job.id])
        return row?.station === 'sew' && row
      }, 'งานไปถึงเย็บ')
      await t.goto('prod1', '#/board', 768)
      await t.clickButton('จักรเย็บ')
      await t.waitText(no)
      await t.clickButton('เริ่มเย็บ', { inside: '#sew-pick-' + job.id })
      await t.clickButton(/เริ่มเย็บด้วย/)
      await waitFor(async () => (await query("select id from jobs where id=$1 and station_status='doing'", [job.id])).length, 'เริ่มเย็บ')
      await capture('r15-cx-sew-' + suffix)
      await t.clickButton('เย็บเสร็จ')
      await t.clickButton('ยืนยันเย็บเสร็จ')
      await waitFor(async () => (await query("select id from jobs where id=$1 and private.station_at(route_code,station_seq)='qc_pack'", [job.id])).length, 'ส่งต่อ QC')
      return { no, product, sleeve, handle, station: afterCut.station }
    })
  }
}

try {
  if (mode === 'forms') await formChecks()
  else if (mode === 'pwa') await pwaChecks()
  else if (mode === 'rights') await rightsChecks()
  else if (mode === 'actions') await actionChecks()
  else if (mode === 'spec') await specChecks()
  else if (mode === 'intake') await intakeChecks()
  else if (mode === 'lang') await languageChecks()
  else throw new Error('ระบุ forms, lang, intake, actions, pwa, rights หรือ spec')
} finally {
  await writeFile(resolve(out, mode + '.json'), JSON.stringify({
    results, external: chrome.externalAttempts, fontsBlocked: [...new Set(chrome.blockedFontRequests)],
    logs: chrome.main.logs,
  }, null, 2))
  if (results.some(result => !result.passed)) process.exitCode = 1
  try {
    assert.deepEqual(chrome.externalAttempts, [])
  } finally {
    await chrome.close()
    await stack.close()
  }
}
