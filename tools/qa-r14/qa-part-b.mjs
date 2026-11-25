import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'
import { createFixtures } from './fixtures.mjs'

const SUMMARY_PATH = fileURLToPath(new URL('./part-b-results.json', import.meta.url))
const WIDTHS = [375, 412, 768, 1440]

const ROLE_PAGES = {
  owner: ['#/admin', '#/users', '#/roles', '#/assign', '#/audit', '#/settings', '#/production', '#/board', '#/reports', '#/inbox', '#/system'],
  manager: ['#/', '#/jobs', '#/board', '#/reports', '#/reviews', '#/inbox', '#/system'],
  admin1: ['#/', '#/jobs', '#/production-queue', '#/board', '#/reports', '#/inbox', '#/system'],
  prod1: ['#/dept', '#/queue', '#/board', '#/issues', '#/reports', '#/inbox', '#/system'],
  sup1: ['#/dept', '#/queue', '#/board', '#/issues', '#/reports', '#/inbox', '#/system'],
  qc: ['#/mine', '#/board', '#/history', '#/report', '#/inbox', '#/system'],
  staff_multi: ['#/mine', '#/board', '#/history', '#/report', '#/inbox', '#/system'],
  staff_empty: ['#/mine', '#/board', '#/history', '#/report', '#/inbox', '#/system'],
}

async function resetStack(stack) {
  const res = await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
  assert.equal(res.status, 200)
}

async function setConfig(stack, patch) {
  const res = await fetch(`${stack.origin}/__qa/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  assert.equal(res.status, 200)
}

async function sql(stack, query, params = []) {
  const res = await fetch(`${stack.origin}/__qa/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: query, params }),
  })
  assert.equal(res.status, 200)
  return res.json()
}

async function seedRichDataset(stack, t, fixtures) {
  // สร้างงานหลากหลายสถานะผ่าน UI และอัปโหลดรูปผ่าน Worker จริง
  const receive = async (no, route, sample, qty = 12) => {
    await t.goto('admin1', '#/', 1440)
    await t.clickButton('รับงานใหม่')
    await t.fillInput('[role="dialog"] input[placeholder*="SC"]', no)
    await waitFor(() => t.ev(() => Boolean([...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.value === 'tshirt')))), 'ตัวเลือกสินค้า')
    await t.ev((n, rt) => {
      const dlg = document.querySelector('[role="dialog"]')
      const inputs = [...dlg.querySelectorAll('input')]
      const setVal = (el, val) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setVal(inputs.find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า')), 'ลูกค้าทดสอบ B ' + n)
      const pSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'tshirt'))
      pSel.value = 'tshirt'; pSel.dispatchEvent(new Event('change', { bubbles: true }))
      setVal(inputs.find(i => i.closest('label')?.textContent.includes('จำนวน')), String(12))
      setVal(inputs.find(i => i.type === 'date'), '2099-01-25')
      const rSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === rt))
      rSel.value = rt; rSel.dispatchEvent(new Event('change', { bubbles: true }))
    }, no, route)
    await t.ev(smp => document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[smp ? 0 : 2].click(), sample)
    await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
    await t.waitText(`ส่งงาน ${no} เข้าโรงงานแล้ว`)
    return (await sql(stack, 'select id from public.jobs where confirmation_no = $1', [no])).rows[0].id
  }

  const queuedId = await receive('TEST-B-Q', 'normal', false)
  const doingId = await receive('TEST-B-DOING', 'normal', false)
  const holdId = await receive('TEST-B-HOLD', 'plain', false)
  const outId = await receive('TEST-B-OUT', 'outside', false)
  const doneId = await receive('TEST-B-DONE', 'cut_only', false)

  // ม็อคอัพอนุมัติ + รูปหลักบน TEST-B-DOING
  await t.goto('admin1', `#/mockup?id=${doingId}`, 1440)
  await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
  await t.waitText('อัปโหลดภาพหลักก่อน')
  await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.frontPng])
  await t.clickButton('ใช้เป็นภาพหลัก')
  await t.waitText('เพิ่มภาพหลักแล้ว')
  await waitFor(() => t.ev(() => {
    const img = document.querySelector('[data-testid="canvas-front"] img')
    if (!img?.complete || !img.naturalWidth) return false
    const r = img.getBoundingClientRect()
    img.dispatchEvent(new MouseEvent('click', { clientX: r.x + r.width * 0.45, clientY: r.y + r.height * 0.4, bubbles: true }))
    return true
  }), 'คลิกวางจุดบนม็อคอัพ B')
  await t.fillInput('input[aria-label="ชื่อจุด"]', 'โลโก้หน้าอก')
  await t.fillInput('textarea[aria-label="ข้อความเพิ่มเติม"]', 'พิมพ์ซับลิเมชั่น 10x10 ซม.')
  await t.clickButton('อนุมัติฉบับ 1 ใช้ผลิต')
  await t.waitText('ใช้ผลิต: ฉบับ 1')

  // ผูกรูปม็อคอัพบนการ์ดงานของ TEST-B-DOING
  await t.goto('admin1', `#/board?job=${doingId}`, 1440)
  await waitFor(() => t.ev(() => Boolean(document.querySelector('input[type="file"][accept*="image/jpeg"]'))), 'ช่องอัปโหลดม็อคอัพบนการ์ดงาน')
  await t.uploadFiles('input[type="file"][accept*="image/jpeg"]', [fixtures.paths.frontPng])
  await t.clickButton('บันทึกรูปม็อคอัพ')
  await t.waitText('เพิ่มรูปม็อคอัพแล้ว')

  // เดินสถานะงาน
  await t.goto('prod1', `#/board?job=${doingId}`, 1440)
  await t.clickButton('เริ่มพิมพ์งาน')
  await sql(stack, `update public.jobs set station_started_at = now() - interval '5 days' where id = $1`, [doingId])

  await t.goto('prod1', `#/board?job=${holdId}`, 1440)
  await t.clickButton('เริ่มตัดงาน')
  await t.clickButton('พักงาน / ติดปัญหา')
  await t.fillInput('input[placeholder*="ผ้าไม่พอ"]', 'รอผ้าเสริม')
  await t.clickButton('บันทึกพักงาน')

  await t.goto('admin1', `#/board?job=${outId}`, 1440)
  await t.clickButton('ส่งออกบริษัทภายนอก')
  await t.ev(() => {
    const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')))
    sel.value = [...sel.options].find(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')).value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await t.clickButton('บันทึกส่งออก')

  await t.goto('prod1', `#/board?job=${doneId}`, 1440)
  await t.clickButton('เริ่มตัดงาน'); await t.clickButton('ตัดงานเสร็จ'); await t.clickButton('ยืนยัน')
  await t.goto('qc', `#/board?job=${doneId}`, 1440)
  await t.clickButton('เริ่ม QC + Packing')
  await t.fillInput('input[aria-label="จำนวนที่ผ่าน"]', '12')
  await t.clickButton('บันทึกผ่าน')
  await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน')

  return { queuedId, doingId, holdId, outId, doneId }
}

async function main() {
  const stack = await startLocalStack()
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)
  const second = chrome.wrap(await chrome.newTab({ isolated: true }))
  const fixtures = await createFixtures(t)
  const results = []
  const findings = []

  async function check(id, title, fn, { allowErrorStatus = false } = {}) {
    const o1 = chrome.main.logs.length
    const o2 = second.tab.logs.length
    try {
      const detail = await fn()
      const newLogs = [...chrome.main.logs.slice(o1), ...second.tab.logs.slice(o2)].filter(e => {
        if (e.text?.startsWith("Blocked attempt to show a 'beforeunload'")) return false
        if (allowErrorStatus && /400|403|404|409|413|415|422|500|503|Failed to fetch|ERR_INTERNET_DISCONNECTED/.test(e.text ?? '')) return false
        return true
      })
      if (newLogs.length) throw new Error('Console errors: ' + JSON.stringify(newLogs))
      results.push({ id, title, pass: true, detail })
      console.log(`PASS [${id}] ${title}${detail ? ' · ' + detail : ''}`)
    } catch (err) {
      results.push({ id, title, pass: false, error: err.message })
      console.log(`FAIL [${id}] ${title} · ${err.message}`)
    }
  }

  try {
    await resetStack(stack)
    const ids = await seedRichDataset(stack, t, fixtures)

    await check('B1', 'ทุกหน้า x ทุกบทบาท ที่ 375 / 412 / 768 / 1440 px (ไม่ล้น, ปุ่ม >= 48px, ตัวอักษร >= 16px, ไม่มี NaN/undefined)', async () => {
      const uxIssues = []
      for (const [role, pages] of Object.entries(ROLE_PAGES)) {
        for (const w of WIDTHS) {
          for (const hash of pages) {
            await t.goto(role, hash, w)
            await waitFor(() => t.ev(() => !document.body.innerText.includes('กำลังโหลดข้อมูลงาน')), `โหลด ${role} ${hash}`)
            const m = await t.measureFloorUx(w)
            if (m.docScrollWidth > w || m.mainOverflow > 1 || m.overflows.length > 0) {
              uxIssues.push({ type: 'overflow', role, w, hash, docScrollWidth: m.docScrollWidth, mainOverflow: m.mainOverflow, overflows: m.overflows })
            }
            if (m.smallButtons.length > 0) {
              uxIssues.push({ type: 'smallButtons', role, w, hash, smallButtons: m.smallButtons })
            }
            if (m.bodyFontSize < 15.5) {
              uxIssues.push({ type: 'smallFont', role, w, hash, bodyFontSize: m.bodyFontSize })
            }
            if (m.badTokens.length > 0) {
              uxIssues.push({ type: 'badTokens', role, w, hash, badTokens: m.badTokens })
            }
            if (m.disabledNoReason > 0) {
              uxIssues.push({ type: 'disabledNoReason', role, w, hash, count: m.disabledNoReason })
            }
          }
        }
      }
      for (const w of WIDTHS) {
        for (const extraHash of [`#/board?job=${ids.doingId}`, `#/mockup?id=${ids.doingId}`, `#/label?id=${ids.doingId}`, `#/artwork?id=${ids.doingId}`]) {
          await t.goto('admin1', extraHash, w)
          await waitFor(() => t.ev(() => !document.body.innerText.includes('กำลังโหลด')), extraHash)
          const m = await t.measureFloorUx(w)
          if (m.docScrollWidth > w || m.mainOverflow > 1 || m.overflows.length > 0) {
            uxIssues.push({ type: 'overflow', role: 'admin1', w, hash: extraHash, docScrollWidth: m.docScrollWidth, mainOverflow: m.mainOverflow, overflows: m.overflows })
          }
          if (m.badTokens.length > 0) uxIssues.push({ type: 'badTokens', role: 'admin1', w, hash: extraHash, badTokens: m.badTokens })
        }
      }
      await t.goto('admin1', '#/production-queue', 375)
      await t.waitText('TEST-B-DOING')
      await t.screenshot('b1-admin-queue-375')
      await t.goto('prod1', '#/queue', 375)
      await t.waitText('TEST-B-Q')
      await t.screenshot('b1-prod-queue-375')
      await t.goto('admin1', '#/board', 375)
      await t.waitText('TEST-B-DOING')
      await t.screenshot('b1-admin-board-375')
      await t.goto('admin1', '#/board', 768)
      await t.waitText('TEST-B-DOING')
      await t.screenshot('b1-admin-board-768')
      await t.goto('admin1', '#/board', 1440)
      await t.waitText('TEST-B-DOING')
      await t.screenshot('b1-admin-board-1440')
      findings.push({ section: 'B1', uxIssues })
      assert.equal(uxIssues.filter(x => x.type === 'badTokens').length, 0, JSON.stringify(uxIssues))
      return `ตรวจครบ ${Object.values(ROLE_PAGES).flat().length * 3 + 12} จอ · พบประเด็น UX ${uxIssues.length} จุด`
    })

    await check('B2', 'สถานะ กำลังโหลด / ไม่มีข้อมูล / ผิดพลาด (ปิดหลังบ้านกลางคัน)', async () => {
      try {
        await setConfig(stack, { latencyMs: 1200 })
        await t.goto('admin1', '#/board', 1440, '/', { wait: false })
        await t.waitText('กำลังโหลดข้อมูลงาน')
        await setConfig(stack, { latencyMs: 0 })
        await t.waitText('TEST-B-DOING')

        await t.goto('admin1', '#/inbox', 1440)
        await t.waitText('กล่องจดหมาย')
        await setConfig(stack, { serverDown: true })
        await t.ev(() => { window.location.hash = '#/board' })
        await t.waitText('โหลดข้อมูลงานไม่สำเร็จ')
        await t.screenshot('b2-server-error')
        await setConfig(stack, { serverDown: false })
        await t.clickButton('ลองอีกครั้ง')
        await t.waitText('TEST-B-DOING')

        await setConfig(stack, { serverDown: true })
        await t.goto('admin1', '#/board', 1440, '/', { wait: false })
        await t.waitText('ตรวจสอบสิทธิ์เข้าใช้งานไม่สำเร็จ')
        await setConfig(stack, { serverDown: false })
        await t.clickButton('ตรวจสอบอีกครั้ง')
        await t.waitText('TEST-B-DOING')

        await resetStack(stack)
        await t.goto('admin1', '#/', 1440)
        await t.waitText('ไม่มีงานที่ต้องตาม')
        return 'กำลังโหลด / ว่าง / ขัดข้องกู้คืนได้ทั้งหมด'
      } finally {
        await setConfig(stack, { latencyMs: 0, serverDown: false })
      }
    }, { allowErrorStatus: true })

    await check('B3', 'เน็ตช้า 3 วิ + กดรัว + ย้อนกลับเบราว์เซอร์ + แก้พร้อมกัน 2 แท็บ + กู้งานค้าง + ออฟไลน์/ออนไลน์', async () => {
      try {
        await resetStack(stack)
        const idsB3 = await seedRichDataset(stack, t, fixtures)

        await t.goto('prod1', '#/board?station=print', 1440)
        await t.waitText('TEST-B-Q')
        await setConfig(stack, { latencyMs: 3000 })
        await t.ev(() => {
          const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'เริ่มพิมพ์งาน')
          b.click(); b.click(); b.click()
        })
        await new Promise(r => setTimeout(r, 100))
        const disabledAfter100ms = await t.ev(() => {
          const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'กำลังเริ่ม…')
          return Boolean(b?.disabled)
        })
        assert.equal(disabledAfter100ms, true)
        await waitFor(async () => {
          const domDone = await t.ev(() => !document.body.innerText.includes('กำลังเริ่ม…') && !document.body.innerText.includes('เริ่มพิมพ์งาน'))
          if (!domDone) return false
          const st = await sql(stack, `select station_status from public.jobs where id = $1`, [idsB3.queuedId])
          return st.rows[0]?.station_status === 'doing'
        }, 'งานเปลี่ยนเป็นกำลังทำครบหลังเน็ตช้า 3 วิ', 35000)
        const sameTickAlert = await t.ev(() => document.querySelector('[role="alert"]')?.textContent?.trim() ?? null)
        await setConfig(stack, { latencyMs: 0 })
        const evCount = await sql(stack, `select count(*)::int n from public.events where job_id = $1 and type = 'station_start'`, [idsB3.queuedId])
        assert.equal(evCount.rows[0].n, 1)
        findings.push({ section: 'B3', disabledAfter100ms, sameTickAlert })

        await t.goto('admin1', `#/mockup?id=${idsB3.doingId}`, 1440)
        await t.fillInput('input[placeholder*="ขยายโลโก้"]', 'แก้ร่วมกัน B3')
        await t.clickButton('สร้างฉบับแก้ไข')
        await t.waitText('ฉบับ 2 · ร่าง')
        await second.goto('admin2', `#/mockup?id=${idsB3.doingId}`, 1440)
        await t.clickButton(/โลโก้หน้าอก/)
        await second.clickButton(/โลโก้หน้าอก/)
        await t.fillInput('input[aria-label="ชื่อจุด"]', 'แท็บ 1 ชนะ')
        await second.fillInput('input[aria-label="ชื่อจุด"]', 'แท็บ 2 ชน')
        await t.clickButton('บันทึกร่าง')
        await t.waitGone('ยังไม่ได้บันทึก')
        await t.waitText('ฉบับ 2 · ร่าง')
        await second.clickButton('บันทึกร่าง')
        await second.waitText(/มีคนบันทึก.*โหลดใหม่/)

        await t.clickButton(/แท็บ 1 ชนะ/)
        await t.fillInput('input[aria-label="ชื่อจุด"]', 'ยังไม่ทันบันทึก')
        await t.goto('admin1', '#/', 1440)
        await t.goto('admin1', `#/mockup?id=${idsB3.doingId}`, 1440)
        await t.waitText('มีงานที่ยังไม่ได้บันทึกจากครั้งก่อนในเครื่องนี้')
        await t.clickButton('กู้คืน')
        await t.clickButton(/ยังไม่ทันบันทึก/)
        const titleBack = await t.ev(() => document.querySelector('input[aria-label="ชื่อจุด"]')?.value)
        assert.equal(titleBack, 'ยังไม่ทันบันทึก')

        await t.goto('admin1', '#/board', 1440)
        await t.waitText('TEST-B-DOING')
        await t.setOffline(true)
        await t.waitText('ขาดการเชื่อมต่อ')
        await t.screenshot('b3-offline-banner')
        await t.setOffline(false)
        await t.waitGone('ขาดการเชื่อมต่อ')

        await t.goto('admin1', '#/production-queue', 1440)
        await t.waitText('คิวการผลิต')
        await t.ev(() => history.back())
        await t.waitText('หน้างานทั้งโรงงาน')
        return 'เน็ตช้ากดรัวได้ 1 ครั้ง + ชน 2 แท็บไม่ทับ + กู้ร่างได้ + ออฟไลน์/ออนไลน์ + back/forward'
      } finally {
        await setConfig(stack, { latencyMs: 0, serverDown: false })
        await t.setOffline(false)
      }
    }, { allowErrorStatus: true })

    await check('B4', 'พิมพ์ PDF ใบปะงาน A5 + ใบกำกับงานพิมพ์ A4 / A3 แนวนอน + ตรวจไม่มีเลขทับภาพ', async () => {
      await resetStack(stack)
      const idsB4 = await seedRichDataset(stack, t, fixtures)
      await t.goto('admin1', `#/label?id=${idsB4.doingId}`, 768)
      await t.waitText('ใบปะงาน')
      await t.waitText('TEST-B-DOING')
      await t.screenshot('b4-label-a5')
      const pdfLabel = await t.printPdf('pdf-label-a5', { paperWidth: 5.83, paperHeight: 8.27 })
      assert.equal(pdfLabel.header, '%PDF-')

      await t.goto('admin1', `#/artwork?id=${idsB4.doingId}`, 1440)
      await t.waitText('ใบกำกับงานพิมพ์')
      const svgTextCount = await t.ev(() => document.querySelectorAll('.artwork-sheet svg text').length)
      assert.equal(svgTextCount, 0)
      await t.screenshot('b4-artwork-a4')
      const pdfA4 = await t.printPdf('pdf-artwork-a4', { landscape: true })
      assert.equal(pdfA4.header, '%PDF-')

      await t.clickButton('A3 แนวนอน')
      await t.screenshot('b4-artwork-a3')
      const pdfA3 = await t.printPdf('pdf-artwork-a3', { landscape: true })
      assert.equal(pdfA3.header, '%PDF-')
      return `Label A5=${pdfLabel.bytes}B, Artwork A4=${pdfA4.bytes}B, A3=${pdfA3.bytes}B`
    })

    await check('B5', 'เทียบข้อความ/ปุ่ม/สิทธิ์บนจอจริงกับคู่มือทุกบทบาท', async () => {
      await t.goto('owner', '#/settings', 1440)
      await t.waitText('ตั้งค่าระบบ')
      const settingsTabs = await t.ev(() => [...document.querySelectorAll('[role="tab"], [aria-label="หมวดตั้งค่า"] button')].map(b => b.textContent.trim()))
      const qcUnlimitedSetting = await t.ev(() => document.body.innerText.includes('QC + Packing') && document.body.innerText.includes('ไม่จำกัด'))
      await t.clickButton('จักรเย็บ')
      await t.waitText('ชนิดจักร')
      await t.clickButton('ชนิดจักร')
      const hasSharedEdit = await t.ev(() => document.body.innerText.includes('แก้ไข') && document.body.innerText.includes('ใช้ร่วม'))

      await t.goto('qc', '#/board?station=qc_pack', 1440)
      await t.waitText('QC + Packing')
      const qcNoCap = await t.ev(() => !document.body.innerText.includes('เครื่อง 0/1') && !document.body.innerText.includes('เครื่องเต็ม'))

      const qcArtwork = await t.goto('qc', `#/artwork?id=${(await sql(stack, "select id from public.jobs where confirmation_no = 'TEST-B-DOING'")).rows[0].id}`, 1440).then(async () => {
        await waitFor(() => t.ev(() => !document.body.innerText.includes('กำลังโหลด')), 'artwork qc')
        return t.ev(() => ({
          hasPrintBtn: document.body.innerText.includes('พิมพ์ / PDF') || document.body.innerText.includes('พิมพ์ / บันทึก PDF'),
          blocked: document.body.innerText.includes('ไม่มีสิทธิ์') || document.body.innerText.includes('ดูได้อย่างเดียว'),
        }))
      })

      findings.push({
        section: 'B5',
        settingsTabs,
        hasSharedEdit,
        qcUnlimitedSetting,
        qcNoCap,
        qcArtwork,
      })
      return `ตั้งค่าจริง ${settingsTabs.length} แท็บ, ชนิดจักรแก้ใช้ร่วมบนเว็บได้=${hasSharedEdit}, QC ไม่จำกัดเครื่อง=${qcNoCap}, QC เปิด artwork=${qcArtwork.hasPrintBtn}`
    })

    assert.deepEqual(chrome.externalAttempts, [])
  } finally {
    await writeFile(SUMMARY_PATH, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      blockedFontRequests: chrome.blockedFontRequests.length,
      results,
      findings,
    }, null, 2))
    await fixtures.cleanup()
    await chrome.close()
    await stack.close()
  }
  if (results.some(r => !r.pass)) process.exitCode = 1
}

main()
