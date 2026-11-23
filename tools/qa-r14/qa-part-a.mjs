import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_BY_KEY, DEFAULT_PASSWORD } from './db.mjs'
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'
import { createFixtures } from './fixtures.mjs'

const SUMMARY_PATH = fileURLToPath(new URL('./part-a-results.json', import.meta.url))

function makeTracker(chrome) {
  const results = []
  const bugs = []
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim()

  async function check(id, title, fn, { tabs = [chrome.main], allowErrorStatus = false } = {}) {
    const offsets = tabs.map(t => t.logs.length)
    try {
      const detail = await fn()
      const newLogs = tabs.flatMap((t, i) => t.logs.slice(offsets[i])).filter(entry => {
        if (entry.text?.startsWith("Blocked attempt to show a 'beforeunload'")) return false
        if (allowErrorStatus && /400|403|404|409|413|415|422|500|503/.test(entry.text ?? '')) return false
        return true
      })
      if (newLogs.length) throw new Error(`Console error: ${JSON.stringify(newLogs)}`)
      results.push({ id, title, pass: true, detail: detail ?? '' })
      console.log(`PASS [${id}] ${title}${detail ? ' · ' + detail : ''}`)
    } catch (err) {
      const msg = clean(err.message)
      results.push({ id, title, pass: false, error: msg })
      console.log(`FAIL [${id}] ${title} · ${msg}`)
      for (const t of tabs) {
        const seen = await t.ev(() => ({ url: location.href, dialog: (document.querySelector('[role=dialog]')?.innerText ?? '').replace(/s+/g, ' ').slice(0, 1500), buttons: [...document.querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => (b.disabled ? '[x] ' : '') + b.textContent.replace(/\s+/g, ' ').trim()).slice(0, 40) })).catch(() => null)
        console.log(`  ที่หน้า ${JSON.stringify(seen)}`)
        await t.screenshot(`fail-${id}`).catch(() => {})
      }
    }
  }

  return { results, bugs, check }
}

async function resetStack(stack) {
  const res = await fetch(`${stack.origin}/__qa/reset`, { method: 'POST' })
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

async function jobIdByNo(stack, no) {
  const r = await sql(stack, 'select id from public.jobs where confirmation_no = $1', [no])
  return r.rows[0]?.id ?? null
}

async function openJobOnBoard(t, role, no) {
  await t.goto(role, '#/board', 1440)
  await t.waitText(no)
  await t.ev(n => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes(n) && b.getClientRects().length)
    if (!btn) throw new Error('ไม่พบการ์ด ' + n)
    btn.click()
  }, no)
  await t.waitText('ความคืบหน้า')
}

async function openJobDirect(t, role, jobId, width = 1440) {
  await t.goto(role, `#/board?job=${jobId}`, width)
  await t.waitText('ความคืบหน้า')
}

async function receiveViaUi(t, { no, customer, product, qty, due = '2099-01-15', route, sample, pdfPath = null }) {
  await t.goto('admin1', '#/', 1440)
  await t.clickButton('รับงานใหม่')
  await t.waitText('รับงานเข้าโรงงาน')
  await t.fillInput('[role="dialog"] input[placeholder*="SC"]', no)
  await t.ev((cust, prod, q, d, rt) => {
    const dlg = document.querySelector('[role="dialog"]')
    const inputs = [...dlg.querySelectorAll('input')]
    const setVal = (el, val) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const custInput = inputs.find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า'))
    setVal(custInput, cust)
    const prodSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === prod))
    prodSel.value = prod
    prodSel.dispatchEvent(new Event('change', { bubbles: true }))
    const qtyInput = inputs.find(i => i.closest('label')?.textContent.includes('จำนวน'))
    setVal(qtyInput, String(q))
    const dueInput = inputs.find(i => i.type === 'date')
    setVal(dueInput, d)
    const rtSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === rt))
    rtSel.value = rt
    rtSel.dispatchEvent(new Event('change', { bubbles: true }))
  }, customer, product, qty, due, route)
  await t.waitText('ลำดับสถานี:')
  await t.ev(needSample => {
    const radios = [...document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')]
    const target = radios[needSample ? 0 : 1]
    if (!target) throw new Error('ไม่พบปุ่มขึ้นตัวอย่าง')
    target.click()
  }, sample)
  if (pdfPath) {
    await t.uploadFiles('[role="dialog"] input[type="file"][accept*="pdf"]', [pdfPath])
  }
  await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
  await t.waitText(`ส่งงาน ${no} เข้าโรงงานแล้ว`)
}

async function runA1(ctx) {
  const { stack, chrome, t, second, fixtures, tracker } = ctx
  await resetStack(stack)

  await tracker.check('A1.1', 'ฟอร์ม /confirmation 5 กลุ่มสินค้า + ผ้าเพิ่ม + ลูกค้าส่งผ้ามาเอง + 2 Callout + PDF 5 ไฟล์', async () => {
    await t.goto('admin1', '', 1440, '/confirmation')
    await t.waitText('ใบยืนยันการผลิต')

    await t.ev(() => {
      if (document.body.classList.contains('preview')) togglePreview(false)
      state = fresh()
      state.pickOpen = false
      renderForm()
    })
    await t.fillInput('[data-s="h"][data-k="doc_no"]', 'TEST-A1-TSHIRT')
    await t.fillInput('[data-s="h"][data-k="issue_date"]', '2099-01-01')
    await t.fillInput('[data-s="h"][data-k="admin"]', 'แอดมิน 1')
    await t.fillInput('[data-s="h"][data-k="due_date"]', '2099-01-20')
    await t.fillInput('[data-s="h"][data-k="customer"]', 'บจก. สยามจำลอง')
    await t.fillInput('[data-s="h"][data-k="contact"]', 'คุณสมชาย')
    await t.fillInput('[data-s="h"][data-k="phone"]', '0812345678')
    await t.fillInput('[data-s="h"][data-k="job_name"]', 'เสื้อกีฬางานวิ่ง')
    await t.ev(() => {
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
    await t.fillInput('[data-s="p"][data-k="fabric_color"]', 'ขาว')
    await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="label"]', 'สีขาว')
    await t.fillInput('input[data-t="sizes"][data-r="0"][data-c="q:M"]', '20')
    await t.ev(() => {
      const pl = document.querySelector('input[type="checkbox"][data-pl="placements"][data-pos="หน้าอกซ้าย"]')
      if (pl && !pl.checked) pl.click()
    })
    await t.fillInput('input[data-pl="placements"][data-pos="หน้าอกซ้าย"][data-pf="size"]', '10 × 8')
    await t.clickButton('+ เพิ่มผ้า', { inside: '#form' })
    await t.ev(() => {
      const row = document.querySelectorAll('input[data-t="fabric_rows"]')
      for (const el of row) {
        if (el.dataset.c === 'part') { el.value = 'แขน'; el.dispatchEvent(new Event('input', { bubbles: true })) }
        if (el.dataset.c === 'fabric') { el.value = 'ผ้าตาข่าย'; el.dispatchEvent(new Event('input', { bubbles: true })) }
        if (el.dataset.c === 'color') { el.value = 'เขียวเข้ม'; el.dispatchEvent(new Event('input', { bubbles: true })) }
      }
    })
    await t.uploadFiles('input[type="file"][data-img]', [fixtures.paths.frontPng])
    await t.waitText('ชี้จุดบนภาพแรก')
    for (const [i, title] of ['จุดอกซ้าย', 'จุดกลางหลัง'].entries()) {
      await waitFor(() => t.ev(idx => {
        const img = document.querySelector('[data-co-img]')
        if (!img?.complete || !img.naturalWidth) return false
        const r = img.getBoundingClientRect()
        img.dispatchEvent(new MouseEvent('click', {
          clientX: r.x + r.width * (0.38 + idx * 0.24),
          clientY: r.y + r.height * (0.35 + idx * 0.25),
          bubbles: true,
        }))
        return true
      }, i), `เพิ่มจุดที่ ${i + 1}`)
      await t.fillInput(`[data-co="${i}"][data-cf="title"]`, title)
      await t.fillInput(`[data-co="${i}"][data-cf="body"]`, `รายละเอียดจุดที่ ${i + 1}`)
    }
    const missingTshirt = await t.ev(() => validate())
    assert.deepEqual(missingTshirt, [])
    await t.clickButton('ดูตัวอย่าง PDF')
    await t.waitText('ผ้าตาข่าย')
    const pdfTshirt = await t.printPdf('pdf-confirm-tshirt')
    assert.equal(pdfTshirt.header, '%PDF-')
    await t.clickButton('กลับไปแก้ไข')

    await t.ev(() => { window.open = () => null })
    await waitFor(() => t.ev(() => !readingImgs && !!thumb), 'ย่อรูปในฟอร์ม')
    await t.clickButton('บันทึกเข้าระบบ')
    await t.waitText('ส่งใบ TEST-A1-TSHIRT แล้ว')
    const outboxHash = await t.ev(() => document.querySelector('#toast a')?.getAttribute('href'))
    assert.equal(outboxHash, '/#/board?confirmation=save')

    // รับเข้า Outbox ในแท็บที่สอง
    await second.goto('admin1', outboxHash.slice(1), 1440)
    await second.waitText('บันทึกใบยืนยัน TEST-A1-TSHIRT เข้าระบบแล้ว')
    await second.clickButton('ส่งงานเข้าโรงงานเลย')
    await second.waitText('รับงานเข้าโรงงาน')
    await waitFor(() => second.ev(() => {
      const dlg = document.querySelector('[role="dialog"]')
      if (!dlg || dlg.innerText.includes('กำลังโหลด')) return false
      return [...dlg.querySelectorAll('input')].some(i => i.value === 'TEST-A1-TSHIRT')
    }), 'โหลดร่างใบ TEST-A1-TSHIRT ในรับงาน')
    await second.ev(() => {
      const dlg = document.querySelector('[role="dialog"]')
      const rtSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'normal'))
      rtSel.value = 'normal'
      rtSel.dispatchEvent(new Event('change', { bubbles: true }))
      document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[1].click()
    })
    await second.waitText('ลำดับสถานี:')
    await second.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
    await second.waitText('ส่งงาน TEST-A1-TSHIRT เข้าโรงงานแล้ว')

    await t.ev(() => {
      if (document.body.classList.contains('preview')) togglePreview(false)
      state = fresh()
      state.product = 'banner'
      state.pickOpen = false
      renderForm()
    })
    await t.fillInput('[data-s="h"][data-k="doc_no"]', 'TEST-A1-BANNER')
    await t.fillInput('[data-s="h"][data-k="issue_date"]', '2099-01-01')
    await t.fillInput('[data-s="h"][data-k="admin"]', 'แอดมิน 1')
    await t.fillInput('[data-s="h"][data-k="due_date"]', '2099-01-21')
    await t.fillInput('[data-s="h"][data-k="customer"]', 'ลูกค้าป้ายผ้าจำลอง')
    await t.fillInput('[data-s="h"][data-k="contact"]', 'คุณสมศรี')
    await t.fillInput('[data-s="h"][data-k="phone"]', '0898765432')
    await t.fillInput('[data-s="h"][data-k="job_name"]', 'ป้ายงานวิ่งประจำปี')
    await t.ev(() => {
      const clickRadio = (s, k, val) => document.querySelector(`input[type="radio"][data-s="${s}"][data-k="${k}"][value="${val}"]`)?.click()
      clickRadio('h', 'sample', 'ไม่ขึ้นตัวอย่าง')
      clickRadio('h', 'delivery', 'ลูกค้ารับเองที่โรงงาน')
      for (let i = 0; i < 10; i++) {
        const next = [...document.querySelectorAll('input[type="checkbox"][data-s="p"][data-k="print_method"]')].find(c => {
          const want = c.value.includes('ลูกค้าส่งผ้ามาเอง')
          return c.checked !== want
        })
        if (!next) break
        next.click()
      }
      clickRadio('p', 'fabric', 'ผ้าไซลอน')
      clickRadio('p', 'sides', 'พิมพ์หน้าเดียว (สีซึมด้านหลัง)')
      clickRadio('p', 'edge', 'พับริมเย็บ 4 ด้าน')
      clickRadio('p', 'thread', 'ตามสีผ้า')
      clickRadio('p', 'eyelet', '4 มุม')
      clickRadio('p', 'eyelet_color', 'เงิน')
      clickRadio('p', 'pack', 'พับใส่ถุง')
    })
    const hiddenCheck = await t.ev(() => ({
      hasPlacements: !!document.querySelector('[data-pl]'),
      hasColorMatch: !!document.querySelector('[data-k="color_match"]'),
    }))
    assert.deepEqual(hiddenCheck, { hasPlacements: false, hasColorMatch: false })
    await t.fillInput('input[data-t="items"][data-r="0"][data-c="name"]', 'ป้ายงานวิ่ง')
    await t.fillInput('input[data-t="items"][data-r="0"][data-c="w"]', '150')
    await t.fillInput('input[data-t="items"][data-r="0"][data-c="h"]', '80')
    await t.fillInput('input[data-t="items"][data-r="0"][data-c="qty"]', '5')
    await t.uploadFiles('input[type="file"][data-img]', [fixtures.paths.frontPng])
    await waitFor(() => t.ev(() => !readingImgs && state.imgs.length > 0), 'โหลดรูป banner')
    assert.deepEqual(await t.ev(() => validate()), [])
    await t.clickButton('ดูตัวอย่าง PDF')
    await t.waitText('ลูกค้าส่งผ้ามาเอง')
    const pdfBanner = await t.printPdf('pdf-confirm-banner')
    assert.equal(pdfBanner.header, '%PDF-')
    await t.clickButton('กลับไปแก้ไข')

    const extraGroups = [
      ['bag', 'TEST-A1-BAG', 'pdf-confirm-bag'],
      ['hat', 'TEST-A1-HAT', 'pdf-confirm-hat'],
      ['pillow', 'TEST-A1-PILLOW', 'pdf-confirm-pillow'],
    ]
    for (const [prod, docNo, pdfName] of extraGroups) {
      await t.ev((p, no) => {
        if (document.body.classList.contains('preview')) togglePreview(false)
        state = fresh()
        state.product = p
        state.pickOpen = false
        state.h = {
          doc_no: no,
          customer: 'ลูกค้าจำลอง ' + p,
          job_name: 'งานจำลอง ' + p,
          issue_date: '2099-01-01',
          due_date: '2099-01-22',
          sample: 'ไม่ขึ้นตัวอย่าง',
          admin: 'แอดมิน 1',
          contact: 'ผู้ติดต่อ',
          phone: '0811112222',
          delivery: 'ลูกค้ารับเองที่โรงงาน',
        }
        renderForm()
        const fill = (sec, f) => {
          const r = scope(sec)
          if (!visible(f, r) || f.id === 'fabric_rows' || f.id === 'pocket_rows') return
          if (f.type === 'radio' && f.req) r[f.id] ??= f.options[0]
          if (f.type === 'check' && f.req) r[f.id] ??= [f.options[0]]
          if (['text', 'textarea'].includes(f.type) && f.req) r[f.id] ??= 'ข้อมูลจำลอง'
          if (f.type === 'number' && (f.req || f.id === 'qty')) r[f.id] ??= '15'
          if (f.type === 'dims' && f.req) f.parts.forEach((_, i) => { r[f.id + '_' + i] = '20' })
          if (f.type === 'itemTable' && (f.req || f.cols.some(c => c.sum))) {
            r[f.id] = [Object.fromEntries(f.cols.filter(c => !c.opt || c.sum).map(c => [c.c, c.t === 'number' ? '15' : c.options?.[0] ?? 'จำลอง']))]
          }
          if (f.type === 'placements') {
            const first = f.positions[0] ?? 'ด้านหน้า'
            r[f.id] = { [first]: { on: true, size: '10 × 10', tech: (r.print_method ?? [])[0] ?? 'ซับลิเมชั่น' } }
          }
        }
        for (let pass = 0; pass < 5; pass++) layout().filter(s => s.fields).forEach(s => s.fields.forEach(f => fill(s.s, f)))
        rerender()
      }, prod, docNo)
      await t.uploadFiles('input[type="file"][data-img]', [fixtures.paths.frontPng])
      await waitFor(() => t.ev(() => !readingImgs && state.imgs.length > 0), `โหลดรูป ${prod}`)
      assert.deepEqual(await t.ev(() => validate()), [])
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText(docNo)
      const pRes = await t.printPdf(pdfName)
      assert.equal(pRes.header, '%PDF-')
    }
    return '5 กลุ่มสินค้า + PDF 5 ไฟล์ + ผ้าเพิ่ม + ลูกค้าส่งผ้ามาเอง + บันทึกเข้าระบบ'
  })

  await tracker.check('A1.2', 'แนบ PDF ใบยืนยันทีหลังผ่าน R2 Worker + เปิดดู PDF ได้จริง', async () => {
    const jid = await jobIdByNo(stack, 'TEST-A1-TSHIRT')
    assert.ok(jid)
    await openJobDirect(t, 'admin1', jid)
    await t.waitText('ยังไม่มี PDF ใบยืนยันที่ลูกค้าเซ็น')
    await t.uploadFiles('input[type="file"][accept*="pdf"]', [fixtures.paths.pdf])
    await t.clickButton('แนบ PDF ใบยืนยัน')
    await t.waitText('เปิด PDF ใบยืนยัน')
    await t.clickButton('เปิด PDF ใบยืนยัน')
    await t.waitText('ถ้าไฟล์ไม่เปิดขึ้นมา กดที่นี่')
    const href = await t.ev(() => [...document.querySelectorAll('a')].find(a => a.textContent.includes('กดที่นี่'))?.href)
    assert.ok(href && href.startsWith(stack.filesOrigin))
    const fetched = await fetch(href)
    assert.equal(fetched.status, 200)
    const buf = Buffer.from(await fetched.arrayBuffer())
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-')
    return `R2 object size=${buf.byteLength}`
  })

  await tracker.check('A1.3', 'DTF สั่ง/รับฟิล์ม + ล็อกรีดฟิล์มก่อนได้รับ', async () => {
    await receiveViaUi(t, { no: 'TEST-A1-DTF', customer: 'ลูกค้า DTF', product: 'tshirt', qty: 10, route: 'dtf', sample: true })
    const jid = await jobIdByNo(stack, 'TEST-A1-DTF')
    await openJobDirect(t, 'prod1', jid)
    await t.clickButton('เริ่มตัดงาน')
    await t.clickButton('ตัดงานเสร็จ')
    await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('ส่งต่อแล้ว')
    await openJobDirect(t, 'prod1', jid)
    const disabledBefore = await t.ev(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('เริ่มไม่ได้ · ยังไม่ได้รับฟิล์ม DTF'))?.disabled)
    assert.equal(disabledBefore, true)

    await openJobDirect(t, 'admin1', jid)
    await t.fillInput('input[type="date"]', '2099-01-10')
    await t.clickButton('บันทึกสั่งฟิล์ม DTF')
    await t.waitText('ได้รับฟิล์ม DTF แล้ว')
    await t.clickButton('ได้รับฟิล์ม DTF แล้ว')
    await t.waitText('เริ่มรีดฟิล์มได้')
    return 'สั่ง+รับฟิล์มปลดล็อกรีดฟิล์มสำเร็จ'
  })

  await tracker.check('A1.4', 'แบ่งงาน + ส่งออกบริษัทภายนอก + แก้กำหนด + ส่งต่อ + รับกลับ + ผลิตข้างนอกทั้งหมด', async () => {
    await receiveViaUi(t, { no: 'TEST-A1-OUT', customer: 'ลูกค้าส่งออก', product: 'tshirt', qty: 20, route: 'normal', sample: false })
    const outId = await jobIdByNo(stack, 'TEST-A1-OUT')
    await openJobDirect(t, 'admin1', outId)
    await t.clickButton('แบ่งจำนวน (ส่งออกบางส่วน)')
    await t.fillInput('input[type="number"]', '8')
    await t.clickButton('บันทึกแบ่งงาน')
    await t.waitText('เป็นงานใหม่')
    const splitId = await jobIdByNo(stack, 'TEST-A1-OUT-2')
    assert.ok(splitId)

    await openJobDirect(t, 'admin1', splitId)
    await t.clickButton('ส่งออกบริษัทภายนอก')
    await t.ev(() => {
      const selects = [...document.querySelectorAll('select')]
      const vSel = selects.find(s => [...s.options].some(o => o.textContent.includes('บริษัท พิมพ์รีดจำลอง')))
      vSel.value = [...vSel.options].find(o => o.textContent.includes('บริษัท พิมพ์รีดจำลอง')).value
      vSel.dispatchEvent(new Event('change', { bubbles: true }))
      const lastSel = selects.find(s => [...s.options].some(o => o.value === 'press'))
      lastSel.value = 'press'
      lastSel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await t.clickButton('บันทึกส่งออก')
    await t.waitText('อยู่ที่บริษัทภายนอก')

    await t.clickButton('แก้กำหนด')
    await t.fillInput('input[type="number"]', '2')
    await t.clickButton('บันทึกกำหนดใหม่')
    await t.waitText('บันทึกกำหนดใหม่แล้ว')

    await t.clickButton(/ส่งต่อบริษัทอื่น/)
    await t.ev(() => {
      const selects = [...document.querySelectorAll('select')]
      const vSel = selects.find(s => [...s.options].some(o => o.textContent.includes('บริษัท ตัดเย็บจำลอง')))
      vSel.value = [...vSel.options].find(o => o.textContent.includes('บริษัท ตัดเย็บจำลอง')).value
      vSel.dispatchEvent(new Event('change', { bubbles: true }))
      const lastSel = selects.find(s => [...s.options].some(o => o.value === 'sew'))
      lastSel.value = 'sew'
      lastSel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await t.clickButton('บันทึกส่งต่อ')
    await t.waitText('บริษัท ตัดเย็บจำลอง')

    await t.clickButton('ของถึงโรงงานแล้ว · รับเข้า')
    await t.fillInput('input[placeholder*="เช่น ได้ครบ"]', 'ครบ 8 ตัว')
    await t.clickButton('ยืนยันรับของ')
    await t.waitText('QC + Packing')

    await receiveViaUi(t, { no: 'TEST-A1-OUTSIDE', customer: 'ลูกค้าหมวกนอก', product: 'hat', qty: 15, route: 'outside', sample: false })
    const outsideId = await jobIdByNo(stack, 'TEST-A1-OUTSIDE')
    await openJobDirect(t, 'admin1', outsideId)
    await t.clickButton('ส่งออกบริษัทภายนอก')
    await t.ev(() => {
      const selects = [...document.querySelectorAll('select')]
      const vSel = selects.find(s => [...s.options].some(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')))
      vSel.value = [...vSel.options].find(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')).value
      vSel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await t.clickButton('บันทึกส่งออก')
    await t.waitText('อยู่ที่บริษัทภายนอก')
    await t.clickButton('ของถึงโรงงานแล้ว · รับเข้า')
    await t.clickButton('ยืนยันรับของ')
    await t.waitText('QC + Packing')
    return 'แบ่งงาน+ส่งออก+แก้กำหนด+ส่งต่อ+รับเข้า+outside ครบ'
  })

  await tracker.check('A1.5', 'ขึ้นตัวอย่างไม่ผ่าน → รอบ 2 → ผ่าน + จัดส่ง/ยกเลิกจัดส่ง', async () => {
    await receiveViaUi(t, { no: 'TEST-A1-SAMPLE', customer: 'ลูกค้าตัวอย่าง', product: 'tshirt', qty: 5, route: 'cut_only', sample: true })
    const sampId = await jobIdByNo(stack, 'TEST-A1-SAMPLE')
    await openJobDirect(t, 'prod1', sampId)
    await t.clickButton('เริ่มตัดงาน')
    await t.clickButton('ตัดงานเสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('เริ่ม QC + Packing')
    await t.clickButton('เริ่ม QC + Packing')
    await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน', { exact: true })

    await openJobDirect(t, 'admin1', sampId)
    await t.waitText('บันทึกผลตัวอย่าง (รอบ 1)')
    await t.ev(() => {
      const ta = document.querySelector('textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'คอเสื้อกว้างไป ปรับรอบ 2')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await t.clickButton('ไม่ผ่าน · ขึ้นตัวอย่างใหม่')
    await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('ขึ้นตัวอย่างรอบ 2')

    await openJobDirect(t, 'prod1', sampId)
    await t.clickButton('เริ่มตัดงาน'); await t.clickButton('ตัดงานเสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    await t.clickButton('เริ่ม QC + Packing'); await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    await openJobDirect(t, 'admin1', sampId)
    await t.waitText('บันทึกผลตัวอย่าง (รอบ 2)')
    await t.clickButton('ตัวอย่างผ่าน'); await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('งานไปผลิตจริงที่สถานีแรก')

    const outsideId = await jobIdByNo(stack, 'TEST-A1-OUTSIDE')
    await openJobDirect(t, 'staff_qc', outsideId)
    await t.clickButton('เริ่ม QC + Packing')
    await t.fillInput('input[aria-label="จำนวนที่ผ่าน"]', '15')
    await t.clickButton('บันทึกผ่าน')
    await t.waitText('ผ่านแล้ว 15 จาก 15')
    await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('รอจัดส่ง')

    await openJobDirect(t, 'admin1', outsideId)
    await t.fillInput('input[placeholder*="Kerry"]', 'KEX-R14-001')
    await t.clickButton('จัดส่งให้ลูกค้าแล้ว'); await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('จัดส่งแล้ว')
    await t.clickButton('บันทึกผิด · ยกเลิกการจัดส่ง')
    await t.fillInput('input[placeholder*="กดผิดงาน"]', 'ส่งผิดสาขา')
    await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('ยกเลิกการบันทึกจัดส่งแล้ว')
    return 'ตัวอย่าง 2 รอบ + จัดส่ง + ยกเลิกจัดส่ง ผ่าน'
  })

  await tracker.check('A1.6', 'ม็อคอัพกำกับสเปก: ดึงจุดจากใบยืนยัน + ผูกสเปก S-01 + แอดมินอนุมัติฉบับ 1 + สร้าง/อนุมัติฉบับ 2 + ฉบับ 1 ห้ามแก้', async () => {
    const jid = await jobIdByNo(stack, 'TEST-A1-TSHIRT')
    await t.goto('admin1', `#/mockup?id=${jid}`, 1440)
    await t.waitText('Callout (2)')
    await t.screenshot('a1-mockup-from-confirmation')

    await t.clickButton(/จุดอกซ้าย/)
    await t.ev(() => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value.startsWith('placement:')))
      const opt = [...sel.options].find(o => o.value.startsWith('placement:'))
      if (opt) {
        sel.value = opt.value
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    await t.clickButton('+ สร้างสเปกใหม่จากจุดนี้')
    await t.fillInput('input[aria-label="ชื่อสเปก"]', 'สเปกอกซ้าย R14')
    await t.fillInput('input[aria-label="กว้าง"]', '10')
    await t.fillInput('input[aria-label="สูง"]', '8')
    await t.clickButton('บันทึกร่าง')
    await t.waitGone('ยังไม่ได้บันทึก')
    await t.waitText('ฉบับ 1 · ร่าง')
    await t.clickButton('อนุมัติฉบับ 1 ใช้ผลิต')
    await t.waitText('ใช้ผลิต: ฉบับ 1')

    await t.fillInput('input[placeholder*="ขยายโลโก้"]', 'เพิ่มมุมด้านหลัง')
    await t.clickButton('สร้างฉบับแก้ไข')
    await t.waitText('ฉบับ 2 · ร่าง')
    await t.selectOption('select[aria-label="มุมภาพที่จะอัปโหลด"]', 'back')
    await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.backJpg])
    await t.clickButton('ใช้เป็นภาพด้านหลัง')
    await t.waitText('เพิ่มภาพด้านหลังแล้ว')
    await t.clickButton('อนุมัติฉบับ 2 ใช้ผลิต')
    await t.waitText('ใช้ผลิต: ฉบับ 2')
    await t.waitText('ฉบับ 1 · ถูกแทนที่')
    await t.screenshot('a1-mockup-rev2-approved')
    return 'ม็อคอัพฉบับ 1→ถูกแทนที่, ฉบับ 2 อนุมัติแล้ว'
  })
}

async function runA2(ctx) {
  const { stack, t, peer, fixtures, tracker } = ctx
  await resetStack(stack)

  await tracker.check('A2.1', 'ฝ่ายผลิต 2 แท็บพร้อมกัน + จำกัดเครื่องรีด 1/1 + พักงานคืนเครื่อง + ทำต่อตอนเครื่องเต็มกลับคิว + แทรกคิว/เริ่มก่อนคิว', async () => {
    await receiveViaUi(t, { no: 'TEST-A2-P1', customer: 'ลูกค้า A2-1', product: 'tshirt', qty: 10, route: 'normal', sample: false })
    await receiveViaUi(t, { no: 'TEST-A2-P2', customer: 'ลูกค้า A2-2', product: 'tshirt', qty: 10, route: 'normal', sample: false })
    await receiveViaUi(t, { no: 'TEST-A2-P3', customer: 'ลูกค้า A2-3', product: 'tshirt', qty: 10, route: 'plain', sample: false })

    for (const no of ['TEST-A2-P1', 'TEST-A2-P2']) {
      await t.goto('prod1', '#/board?station=print', 1440)
      await t.waitText(no)
      await t.clickButton('เริ่มพิมพ์งาน')
      await t.waitText('กำลังทำ 1 งาน')
      await t.clickButton('พิมพ์งานเสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
      await t.waitText('ส่งต่อแล้ว')
    }

    await t.goto('prod1', '#/board?station=press', 1440)
    await peer.goto('prod2', '#/board?station=press', 1440)
    await t.waitText(/เครื่อง 0\/1[\s\n]+ว่าง 1/)
    await t.clickButton('เริ่มรีดงาน')
    await t.waitText(/เครื่อง 1\/1[\s\n]+เต็ม/)

    await peer.goto('prod2', '#/board?station=press', 1440)
    await peer.waitText(/เครื่องเต็ม 1\/1/)
    await peer.screenshot('a2-press-full-blocked')

    await t.clickButton('พักงาน')
    await t.fillInput('input[placeholder*="ผ้าไม่พอ"]', 'ความร้อนรีดไม่นิ่ง')
    await t.clickButton('บันทึกพักงาน')
    await t.waitText(/เครื่อง 0\/1[\s\n]+ว่าง 1/)

    await peer.goto('prod2', '#/board?station=press', 1440)
    await peer.clickButton('เริ่มรีดงาน')
    await peer.waitText(/เครื่อง 1\/1[\s\n]+เต็ม/)

    await t.clickButton('แก้แล้ว ทำต่อ')
    await t.waitText('กลับเข้าคิวรอเริ่ม')

    await peer.clickButton('รีดงานเสร็จ'); await peer.clickButton('ยืนยัน', { exact: true })
    await peer.waitText('ส่งต่อแล้ว')
    await t.goto('prod1', '#/board?station=press', 1440)
    await t.clickButton('เริ่มรีดงาน'); await t.clickButton('รีดงานเสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('ส่งต่อแล้ว')

    await t.goto('prod1', '#/board?station=cut', 1440)
    await t.waitText('คิวรอเริ่ม 3 งาน')
    await t.clickButton('แทรกเป็นคิวแรก (งานด่วน)', { index: 0 })
    await t.fillInput('input[aria-label="เหตุผล"]', 'ลูกค้าขอเร่งด่วน')
    await t.clickButton('แทรกเป็นคิวแรก', { exact: true })
    await t.waitText('เป็นคิวแรกแล้ว')
    await t.clickButton('เริ่มก่อนคิว', { index: 0 })
    await t.fillInput('input[aria-label="เหตุผล"]', 'ผ้าพร้อมก่อน')
    await t.clickButton('บันทึกและเริ่ม', { exact: true })
    await t.waitText('กำลังทำ 1 งาน')

    while (await t.ev(() => !document.body.innerText.includes('ไม่มีงานรอที่ตัดงาน') || [...document.querySelectorAll('button')].some(b => b.textContent.includes('ตัดงานเสร็จ') || b.textContent.includes('เริ่มตัดงาน')))) {
      const didFinish = await t.ev(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'ตัดงานเสร็จ' && !x.disabled)
        if (b) { b.click(); return true }
        return false
      })
      if (didFinish) {
        await t.clickButton('ยืนยัน', { exact: true })
        await t.waitText('ส่งต่อแล้ว')
        continue
      }
      await t.clickButton('เริ่มตัดงาน')
      await t.waitText('ตัดงานเสร็จ')
    }
    await t.waitText('ไม่มีงานรอที่ตัดงาน')
    await t.waitText('กำลังทำ 0 งาน')
    return 'จำกัดเครื่อง 1/1 + พัก/ทำต่อเมื่อเต็ม + แทรกคิว + เริ่มก่อนคิว ผ่าน'
  })

  await tracker.check('A2.2', 'เย็บ: เลือกจักร + จัดการจักร (กันคืนตัวสุดท้าย) + จักรเสีย 1/2 เดินต่อ vs 0/1 พักอัตโนมัติ + ซ่อมเสร็จ + เย็บต่อ + เสร็จ', async () => {
    const p1Id = await jobIdByNo(stack, 'TEST-A2-P1')
    await t.goto('prod1', '#/board', 1440)
    await t.clickButton('จักรเย็บ')
    await t.waitText('งานระหว่างเย็บ')
    await t.waitText('TEST-A2-P1')
    await t.clickButton('เริ่มเย็บ', { inside: `#sew-pick-${p1Id}` })
    await t.waitText('เลือกจักรที่จะนั่งเย็บงาน')
    if (await t.ev(() => !!document.querySelector('input[placeholder*="ผ้างานคิวแรก"]'))) {
      await t.fillInput('input[placeholder*="ผ้างานคิวแรก"]', 'เริ่มงานแรกตามแผน')
    }
    await t.clickButton('SN-002')
    await t.clickButton(/เริ่มเย็บด้วย/)
    await t.waitText('งานระหว่างเย็บ 1 งาน')
    await t.screenshot('a2-sewing-started')

    await t.clickButton('จัดการจักร')
    await t.waitText('กดจักรที่ว่าง = เพิ่มให้งานนี้')
    await t.clickButton('SN-001', { inside: '[role="dialog"]' })
    await t.waitText('คืนจักร SN-001 แล้ว')
    await t.clickButton('SN-002', { inside: '[role="dialog"]' })
    await t.waitText(/กำลังเย็บอยู่ คืนแล้วจักรจะไม่ครบชุด/)
    await t.clickButton('SN-003', { inside: '[role="dialog"]' })
    await t.waitText('เพิ่มจักร SN-003')
    await t.clickButton('เสร็จ', { exact: true, inside: '[role="dialog"]' })
    await t.waitGone('กดจักรที่ว่าง')

    // แจ้งเสีย SN-003 (ยังเหลือ SN-002 งานไม่พัก)
    await waitFor(() => t.ev(() => {
      const li = [...document.querySelectorAll('li')].find(el => el.textContent.includes('SN-003') && [...el.querySelectorAll('button')].some(b => b.textContent.trim() === 'แจ้งเสีย'))
      const btn = [...(li?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'แจ้งเสีย')
      if (!btn) return false
      btn.click()
      return true
    }), 'แจ้งเสีย SN-003')
    await t.waitText('แจ้งจักร SN-003 เสีย')
    await t.clickButton('เข็มหัก', { inside: '[role="dialog"]' })
    await t.clickButton('3 ชั่วโมง', { inside: '[role="dialog"]' })
    await t.clickButton('ยืนยันแจ้งเสีย', { inside: '[role="dialog"]' })
    await t.waitText('จักร SN-003 แจ้งเสียแล้ว')

    // แจ้งเสีย SN-002 (ตัวสุดท้าย → งานพักอัตโนมัติ)
    await waitFor(() => t.ev(() => {
      const li = [...document.querySelectorAll('li')].find(el => el.textContent.includes('SN-002') && [...el.querySelectorAll('button')].some(b => b.textContent.trim() === 'แจ้งเสีย'))
      const btn = [...(li?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'แจ้งเสีย')
      if (!btn) return false
      btn.click()
      return true
    }), 'แจ้งเสีย SN-002')
    await t.waitText('แจ้งจักร SN-002 เสีย')
    await t.clickButton('มอเตอร์ไม่หมุน', { inside: '[role="dialog"]' })
    await t.clickButton('3 ชั่วโมง', { inside: '[role="dialog"]' })
    await t.clickButton('ยืนยันแจ้งเสีย', { inside: '[role="dialog"]' })
    await t.waitText('จักร SN-002 แจ้งเสียแล้ว')

    // ซ่อมเสร็จ SN-002 & SN-003 แล้วกด เย็บต่อ + เย็บเสร็จ
    for (const code of ['SN-002', 'SN-003']) {
      await waitFor(() => t.ev(c => {
        const li = [...document.querySelectorAll('li')].find(el => el.textContent.includes(c) && [...el.querySelectorAll('button')].some(b => b.textContent.trim() === 'ซ่อมเสร็จ'))
        const btn = [...(li?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'ซ่อมเสร็จ')
        if (!btn) return false
        btn.click()
        return true
      }, code), `ซ่อมเสร็จ ${code}`)
      await t.waitText(`จักร ${code} ซ่อมเสร็จ พร้อมใช้`)
    }
    await t.clickButton('เย็บต่อ')
    await t.waitText('เย็บต่อแล้ว')
    await t.clickButton('เย็บเสร็จ')
    await t.clickButton('ยืนยันเย็บเสร็จ')
    await t.waitText('ส่งต่อ QC + Packing แล้ว')
    return 'เลือกจักร + จัดการจักร + เสีย 1/2 ต่อได้ + เสีย 0/1 พัก + ซ่อม + เย็บต่อ + เสร็จ'
  }, { allowErrorStatus: true })

  await tracker.check('A2.3', 'ม็อคอัพ pending: ฝ่ายผลิตส่งกลับ/อนุมัติฉบับ 1 + ห้ามอนุมัติฉบับ 2 หลังเริ่มผลิต', async () => {
    await receiveViaUi(t, { no: 'TEST-A2-MOCK', customer: 'ลูกค้าม็อคอัพ', product: 'tshirt', qty: 10, route: 'normal', sample: false })
    const mockId = await jobIdByNo(stack, 'TEST-A2-MOCK')
    await t.goto('admin1', `#/mockup?id=${mockId}`, 1440)
    await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
    await t.waitText('อัปโหลดภาพหลักก่อน')
    await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.frontPng])
    await t.clickButton('ใช้เป็นภาพหลัก')
    await t.waitText('เพิ่มภาพหลักแล้ว')
    await waitFor(() => t.ev(() => {
      const img = document.querySelector('[data-testid="canvas-front"] img')
      if (!img?.complete || !img.naturalWidth) return false
      const r = img.getBoundingClientRect()
      img.dispatchEvent(new MouseEvent('click', { clientX: r.x + r.width * 0.5, clientY: r.y + r.height * 0.4, bubbles: true }))
      return true
    }), 'คลิกวางจุด Callout')
    await t.fillInput('input[aria-label="ชื่อจุด"]', 'จุดตรวจฝ่ายผลิต')
    await t.fillInput('textarea[aria-label="ข้อความเพิ่มเติม"]', 'พิมพ์สีขาว')
    await t.clickButton('บันทึกร่าง')
    await t.waitText('ฉบับ 1 · ร่าง')
    const sheetRes = await sql(stack, 'select id, version from public.mockup_sheets where job_id = $1 and rev = 1', [mockId])
    const s1 = sheetRes.rows[0]
    await sql(stack, `update public.mockup_sheets set status = 'pending', submitted_by = $1, submitted_at = now() where id = $2`, [ACCOUNT_BY_KEY.admin1.id, s1.id])

    await t.goto('prod1', `#/mockup?id=${mockId}`, 1440)
    await t.waitText('รออนุมัติ')
    await t.fillInput('input[placeholder*="ขนาดโลโก้"]', 'ขอขยายตัวอักษร')
    await t.clickButton('ส่งกลับให้แอดมินแก้')
    await t.waitText('ถูกส่งกลับให้แก้')
    await sql(stack, `update public.mockup_sheets set status = 'pending', version = version + 1 where id = $1`, [s1.id])

    await t.goto('prod1', `#/mockup?id=${mockId}`, 1440)
    await t.clickButton('อนุมัติฉบับ 1 ใช้ผลิต')
    await t.waitText('ใช้ผลิต: ฉบับ 1')

    await openJobDirect(t, 'prod1', mockId)
    await t.clickButton('เริ่มพิมพ์งาน')

    await t.goto('admin1', `#/mockup?id=${mockId}`, 1440)
    await t.fillInput('input[placeholder*="ขยายโลโก้"]', 'แก้รอบ 2 หลังเริ่มผลิต')
    await t.clickButton('สร้างฉบับแก้ไข')
    await t.waitText('ฉบับ 2 · ร่าง')
    const s2Res = await sql(stack, 'select id from public.mockup_sheets where job_id = $1 and rev = 2', [mockId])
    await sql(stack, `update public.mockup_sheets set status = 'pending', submitted_by = $1, submitted_at = now() where id = $2`, [ACCOUNT_BY_KEY.admin1.id, s2Res.rows[0].id])

    await t.goto('prod1', `#/mockup?id=${mockId}`, 1440)
    await t.waitText('งานนี้เริ่มผลิตแล้ว ฉบับแก้ไขต้องให้แอดมิน ผู้บริหาร หรือเจ้าของอนุมัติ')
    return 'pending ส่งกลับ/อนุมัติฉบับ 1 + กันฝ่ายผลิตอนุมัติฉบับ 2 หลังเริ่มผลิต'
  })

  await tracker.check('A2.4', 'เกินเวลามาตรฐาน (SLA): ปุ่มแดง + กันกดเสร็จก่อนส่งรายงานปัญหา + ส่งรายงานแล้วกดเสร็จได้', async () => {
    const p2Id = await jobIdByNo(stack, 'TEST-A2-P2')
    await t.goto('prod1', '#/board', 1440)
    await t.clickButton('จักรเย็บ')
    await t.waitText('งานระหว่างเย็บ')
    await t.clickButton('เริ่มเย็บ', { inside: `#sew-pick-${p2Id}` })
    await t.waitText('เลือกจักรที่จะนั่งเย็บงาน')
    if (await t.ev(() => !!document.querySelector('input[placeholder*="ผ้างานคิวแรก"]'))) {
      await t.fillInput('input[placeholder*="ผ้างานคิวแรก"]', 'เร่งตรวจ SLA')
    }
    await t.clickButton(/เริ่มเย็บด้วย/)
    await t.waitText('กำลังเย็บ')

    await sql(stack, `update public.jobs set station_started_at = now() - interval '6 days' where id = $1`, [p2Id])
    await t.goto('prod1', '#/board', 1440)
    await t.clickButton('จักรเย็บ')
    await t.waitText('เกินเวลา · ส่งรายงานปัญหาก่อนกดเย็บเสร็จ')
    await t.screenshot('a2-sla-overdue-button')

    await t.clickButton('เกินเวลา · ส่งรายงานปัญหาก่อนกดเย็บเสร็จ')
    await t.waitText('ต้องส่งรายงานปัญหาก่อนกดเสร็จ')
    await t.clickButton(/^[A-Z]\d+ /, { inside: '#delay-report' })
    await t.fillInput('#delay-report textarea', 'งานเย็บเยอะ รอคิว')
    await t.fillInput('#delay-report input[type="date"]', '2099-01-20')
    await t.fillInput('#delay-report input[placeholder*="ช่างซ่อม"]', 'หัวหน้าทีม')
    await t.clickButton('ส่งรายงานปัญหา', { exact: true, inside: '#delay-report' })
    await t.waitText('ส่งรายงานปัญหาแล้ว')

    await t.goto('prod1', '#/board', 1440)
    await t.clickButton('จักรเย็บ')
    await t.waitText('งานระหว่างเย็บ')
    await t.clickButton('เย็บเสร็จ')
    await t.clickButton('ยืนยันเย็บเสร็จ')
    await t.waitText('ส่งต่อ QC + Packing แล้ว')
    return 'SLA เกินเวลาบังคับรายงานก่อนกดเสร็จ'
  })
}

async function runA3(ctx) {
  const { stack, t, fixtures, tracker } = ctx
  await resetStack(stack)

  await tracker.check('A3.1', 'staff (มือถือ 375px): เห็นเฉพาะสถานีตน + กดเริ่ม/พัก/เสร็จ + แจ้งปัญหา + ประวัติ + รับทราบม็อคอัพ + staff ว่าง + บัญชีปิด', async () => {
    await receiveViaUi(t, { no: 'TEST-A3-CUT', customer: 'ลูกค้า staff', product: 'tshirt', qty: 8, route: 'plain', sample: false })
    await receiveViaUi(t, { no: 'TEST-A3-PRINT', customer: 'ลูกค้าพิมพ์', product: 'tshirt', qty: 8, route: 'normal', sample: false })
    const cutId = await jobIdByNo(stack, 'TEST-A3-CUT')

    // ใส่รูปและอนุมัติม็อคอัพฉบับ 1
    await t.goto('admin1', `#/mockup?id=${cutId}`, 1440)
    await t.clickButton('เริ่มทำม็อคอัพกำกับสเปก')
    await t.waitText('อัปโหลดภาพหลักก่อน')
    await t.uploadFiles('input[type="file"][accept*="png"]', [fixtures.paths.frontPng])
    await t.clickButton('ใช้เป็นภาพหลัก')
    await t.waitText('เพิ่มภาพหลักแล้ว')
    await waitFor(() => t.ev(() => {
      const img = document.querySelector('[data-testid="canvas-front"] img')
      if (!img?.complete || !img.naturalWidth) return false
      const r = img.getBoundingClientRect()
      img.dispatchEvent(new MouseEvent('click', { clientX: r.x + r.width * 0.5, clientY: r.y + r.height * 0.45, bubbles: true }))
      return true
    }), 'คลิกวางจุดตัดผ้า')
    await t.fillInput('input[aria-label="ชื่อจุด"]', 'จุดตัดผ้า')
    await t.fillInput('textarea[aria-label="ข้อความเพิ่มเติม"]', 'เผื่อตะเข็บ 1 ซม.')
    await t.clickButton('อนุมัติฉบับ 1 ใช้ผลิต')
    await t.waitText('ใช้ผลิต: ฉบับ 1')

    await t.goto('staff_single', '#/board', 375)
    await t.waitText('TEST-A3-CUT')
    const seesPrint = await t.ev(() => document.body.innerText.includes('TEST-A3-PRINT'))
    assert.equal(seesPrint, false)
    await t.screenshot('a3-staff-mobile-375')

    await t.clickButton(/ตัด/, { inside: 'nav[aria-label="เลือกสถานี"]' })
    await t.clickButton('เริ่มตัดงาน')
    await t.waitText('กำลังทำ 1 งาน')

    await t.goto('staff_single', '#/report', 375)
    await t.waitText('เลือกงานที่มีปัญหา')
    await t.clickButton('แจ้งปัญหา')
    await t.fillInput('input[placeholder*="ผ้าไม่พอ"]', 'มีดตัดทื่อ')
    await t.clickButton('แจ้งปัญหา')
    await t.waitText('งานพักไว้รอฝ่ายผลิตแก้')

    await t.goto('staff_single', '#/board?station=cut', 375)
    await t.waitText('รอผู้บริหารหรือฝ่ายผลิตกด "แก้แล้ว ทำต่อ"')

    await openJobDirect(t, 'prod1', cutId)
    await t.clickButton('แก้แล้ว ทำต่อ')
    await t.waitText('กลับมาทำต่อได้')

    await t.goto('staff_single', '#/board?station=cut', 375)
    await t.clickButton('ตัดงานเสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('ส่งต่อแล้ว')

    await t.goto('staff_single', '#/history', 375)
    await t.waitText('ตัดงานเสร็จ')

    await openJobDirect(t, 'staff_single', cutId, 375)
    await waitFor(() => t.ev(() => {
      const a = document.querySelector('a[aria-label="เปิดม็อคอัพกำกับสเปก"]')
      if (!a) return false
      a.click()
      return true
    }), 'ลิงก์เปิดม็อคอัพกำกับสเปก')
    await t.waitText('รับทราบสเปกฉบับ 1 · สถานีตัดงาน')
    const selectLocked = await t.ev(() => document.querySelector('select')?.disabled)
    assert.equal(selectLocked, true)
    await t.clickButton('รับทราบสเปกฉบับ 1 · สถานีตัดงาน')
    await t.waitText('สถานีตัดงานรับทราบสเปกฉบับ 1 แล้ว')

    await t.goto('staff_multi', '#/board', 375)
    await t.waitText('TEST-A3-PRINT')

    await t.goto('staff_empty', '#/mine', 375)
    await t.waitText('ยังไม่ได้จับคู่สถานี')

    // บัญชีที่ปิดใช้งาน ลองล็อกอินจริงผ่านหน้า EmployeeLogin
    await t.goto('none', '#/', 375)
    await t.waitText('เข้าสู่ระบบพนักงาน')
    await t.fillInput('input[name="email"]', ACCOUNT_BY_KEY.disabled.email)
    await t.fillInput('input[name="password"]', DEFAULT_PASSWORD)
    await t.clickButton('เข้าสู่ระบบ')
    await t.waitText('บัญชีนี้ถูกปิดใช้งาน')
    await t.screenshot('a3-disabled-account')
    return 'staff 375px + รับทราบม็อคอัพ + staff_multi + staff_empty + disabled ผ่าน'
  })
}

async function runA4(ctx) {
  const { stack, t, tracker } = ctx
  await resetStack(stack)

  await tracker.check('A4.1', 'QC (staff_qc & qc): เริ่มหลายงานพร้อมกัน + ผ่านไม่ครบเสร็จไม่ได้ + ส่งแก้ sew/outside + ตัวอย่าง', async () => {
    await receiveViaUi(t, { no: 'TEST-A4-N1', customer: 'ลูกค้า QC1', product: 'tshirt', qty: 10, route: 'plain', sample: false })
    await receiveViaUi(t, { no: 'TEST-A4-N2', customer: 'ลูกค้า QC2', product: 'tshirt', qty: 6, route: 'cut_only', sample: false })
    await receiveViaUi(t, { no: 'TEST-A4-OS', customer: 'ลูกค้าข้างนอก', product: 'hat', qty: 8, route: 'outside', sample: false })
    await receiveViaUi(t, { no: 'TEST-A4-SM', customer: 'ลูกค้าตัวอย่าง', product: 'tshirt', qty: 4, route: 'cut_only', sample: true })

    // เดินงานมาถึง qc_pack
    for (const no of ['TEST-A4-N1', 'TEST-A4-N2', 'TEST-A4-SM']) {
      const id = await jobIdByNo(stack, no)
      await openJobDirect(t, 'prod1', id)
      await t.clickButton('เริ่มตัดงาน'); await t.clickButton('ตัดงานเสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    }
    const n1Id = await jobIdByNo(stack, 'TEST-A4-N1')
    await t.goto('prod1', '#/board', 1440)
    await t.clickButton('จักรเย็บ')
    await t.waitText('งานระหว่างเย็บ')
    await t.clickButton('เริ่มเย็บ', { inside: `#sew-pick-${n1Id}` }); await t.clickButton(/เริ่มเย็บด้วย/)
    await t.clickButton('เย็บเสร็จ'); await t.clickButton('ยืนยันเย็บเสร็จ')

    const osId = await jobIdByNo(stack, 'TEST-A4-OS')
    await openJobDirect(t, 'admin1', osId)
    await t.clickButton('ส่งออกบริษัทภายนอก')
    await t.ev(() => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')))
      sel.value = [...sel.options].find(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')).value
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await t.clickButton('บันทึกส่งออก'); await t.waitText('อยู่ที่บริษัทภายนอก')
    await t.clickButton('ของถึงโรงงานแล้ว · รับเข้า'); await t.clickButton('ยืนยันรับของ')

    // staff_qc เริ่ม 2 งานพร้อมกัน (ไม่จำกัดเครื่อง)
    await t.goto('staff_qc', '#/board?station=qc_pack', 1440)
    await t.waitText('เริ่ม QC + Packing')
    assert.equal(await t.ev(() => document.body.innerText.includes('เครื่องเต็ม')), false)
    await t.clickButton('เริ่ม QC + Packing')
    await t.clickButton('เริ่ม QC + Packing')
    await t.waitText('กำลังทำ 2 งาน')

    // N1: ผ่าน 6/10 -> ปุ่มเสร็จล็อก -> ส่งแก้ 4 ไปเย็บ -> เย็บแก้ -> ผ่านอีก 4 -> เสร็จ
    await openJobDirect(t, 'staff_qc', n1Id)
    await t.fillInput('input[aria-label="จำนวนที่ผ่าน"]', '6')
    await t.clickButton('บันทึกผ่าน')
    await t.waitText('ยังกดเสร็จไม่ได้: QC ตรวจผ่าน 6/10 ชิ้น ยังไม่ครบ')
    await t.clickButton('ส่งกลับแก้')
    await t.fillInput('input[aria-label="จำนวนที่ไม่ผ่าน"]', '4')
    await t.fillInput('input[aria-label="สาเหตุ"]', 'ตะเข็บเอียง 4 ตัว')
    await t.clickButton('ยืนยันส่งกลับแก้')
    await t.waitText('ส่งกลับแก้ 4 ตัว')

    await t.goto('prod1', '#/board', 1440)
    await t.clickButton('จักรเย็บ')
    await t.waitText('งานแก้')
    await t.clickButton('เริ่มเย็บ', { inside: `#sew-pick-${n1Id}` }); await t.clickButton(/เริ่มเย็บด้วย/)
    await t.clickButton('เย็บเสร็จ'); await t.clickButton('ยืนยันเย็บเสร็จ')

    await openJobDirect(t, 'staff_qc', n1Id)
    await t.clickButton('เริ่ม QC + Packing')
    await t.fillInput('input[aria-label="จำนวนที่ผ่าน"]', '4')
    await t.clickButton('บันทึกผ่าน')
    await t.waitText('ผ่านแล้ว 10 จาก 10')
    await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('รอจัดส่ง')

    // outside: ส่งแก้ไป outside แล้วแอดมินส่งออก/รับกลับ
    await openJobDirect(t, 'qc', osId)
    await t.clickButton('เริ่ม QC + Packing')
    await t.clickButton('ส่งกลับแก้')
    await t.fillInput('input[aria-label="จำนวนที่ไม่ผ่าน"]', '3')
    await t.fillInput('input[aria-label="สาเหตุ"]', 'ปีกหมวกเบี้ยว 3 ใบ')
    await t.clickButton('ยืนยันส่งกลับแก้')
    await t.waitText('สั่งผลิตข้างนอก')

    await openJobDirect(t, 'admin1', osId)
    await t.clickButton('ส่งออกบริษัทภายนอก')
    await t.ev(() => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')))
      sel.value = [...sel.options].find(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')).value
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await t.clickButton('บันทึกส่งออก'); await t.waitText('อยู่ที่บริษัทภายนอก')
    await t.clickButton('ของถึงโรงงานแล้ว · รับเข้า'); await t.clickButton('ยืนยันรับของ')
    await openJobDirect(t, 'qc', osId)
    await t.clickButton('เริ่ม QC + Packing')
    await t.fillInput('input[aria-label="จำนวนที่ผ่าน"]', '8')
    await t.clickButton('บันทึกผ่าน')
    await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('รอจัดส่ง')

    // ตัวอย่างส่งตรวจผล
    const smId = await jobIdByNo(stack, 'TEST-A4-SM')
    await openJobDirect(t, 'qc', smId)
    await t.clickButton('เริ่ม QC + Packing')
    await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
    await t.waitText('รอผลตัวอย่าง')
    return 'QC ไม่จำกัดเครื่อง + ส่งแก้ sew & outside + ตัวอย่าง ผ่าน'
  })
}

async function runA5(ctx) {
  const { stack, t, tracker } = ctx
  await resetStack(stack)

  await tracker.check('A5.1', 'ผู้บริหาร: ภาพรวม + ค้นหางาน + รายงาน + รายการรออนุมัติ + ยกเลิกงานทุกสถานะ', async () => {
    await receiveViaUi(t, { no: 'TEST-A5-QUEUED', customer: 'ยกเลิกตอนรอ', product: 'tshirt', qty: 10, route: 'plain', sample: false })
    await receiveViaUi(t, { no: 'TEST-A5-SEW', customer: 'ยกเลิกตอนเย็บ', product: 'tshirt', qty: 10, route: 'plain', sample: false })
    await receiveViaUi(t, { no: 'TEST-A5-HOLD', customer: 'ยกเลิกตอนพัก', product: 'tshirt', qty: 10, route: 'plain', sample: false })
    await receiveViaUi(t, { no: 'TEST-A5-OUT', customer: 'ห้ามยกเลิกข้างนอก', product: 'hat', qty: 10, route: 'outside', sample: false })
    await receiveViaUi(t, { no: 'TEST-A5-DONE', customer: 'ห้ามยกเลิกเสร็จ', product: 'tshirt', qty: 5, route: 'cut_only', sample: false })

    const qId = await jobIdByNo(stack, 'TEST-A5-QUEUED')
    const sewId = await jobIdByNo(stack, 'TEST-A5-SEW')
    const holdId = await jobIdByNo(stack, 'TEST-A5-HOLD')
    const outId = await jobIdByNo(stack, 'TEST-A5-OUT')
    const doneId = await jobIdByNo(stack, 'TEST-A5-DONE')

    // สร้าง queue_insert ใน cut ตอนมีหลายงานรอคิวอยู่ ให้ผู้บริหารรับทราบใน #/reviews
    await t.goto('prod1', '#/board?station=cut', 1440)
    await t.clickButton('แทรกเป็นคิวแรก (งานด่วน)', { index: 0 })
    await t.fillInput('input[aria-label="เหตุผล"]', 'ผู้บริหารขอเร่ง')
    await t.clickButton('แทรกเป็นคิวแรก')
    await t.waitText('แทรก')

    // ทำความก้าวหน้า: SEW อยู่เย็บ (พร้อมจองและจ่ายจักร), HOLD พักที่ตัด, DONE เสร็จ, OUT อยู่ข้างนอก
    for (const id of [sewId, doneId]) {
      await openJobDirect(t, 'prod1', id)
      await t.clickButton('เริ่มตัดงาน'); await t.clickButton('ตัดงานเสร็จ'); await t.clickButton('ยืนยัน', { exact: true })
      await t.waitText('ส่งต่อแล้ว')
    }
    await openJobDirect(t, 'qc', doneId)
    await t.clickButton('เริ่ม QC + Packing')
    await t.fillInput('input[aria-label="จำนวนที่ผ่าน"]', '5')
    await t.clickButton('บันทึกผ่าน')
    await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน', { exact: true })

    await t.goto('prod1', '#/board', 1440)
    await t.clickButton('จักรเย็บ')
    await t.waitText('งานระหว่างเย็บ')
    await t.clickButton('เริ่มเย็บ', { inside: `#sew-pick-${sewId}` }); await t.clickButton(/เริ่มเย็บด้วย/)
    await t.waitText('กำลังเย็บ')

    await openJobDirect(t, 'prod1', holdId)
    await t.clickButton('เริ่มตัดงาน')
    await t.clickButton('พักงาน / ติดปัญหา')
    await t.fillInput('input[placeholder*="ผ้าไม่พอ"]', 'รอลูกค้าเปลี่ยนสี')
    await t.clickButton('บันทึกพักงาน')

    await openJobDirect(t, 'admin1', outId)
    await t.clickButton('ส่งออกบริษัทภายนอก')
    await t.ev(() => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')))
      sel.value = [...sel.options].find(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')).value
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await t.clickButton('บันทึกส่งออก')

    await t.goto('manager', '#/', 1440); await t.waitText('ภาพรวมการผลิต')
    await t.goto('manager', '#/jobs', 1440); await t.waitText('ดูงานในโรงงานทั้งหมด')
    await t.goto('manager', '#/reports', 1440); await t.waitText('รายงาน')
    await t.goto('manager', '#/reviews', 1440)
    await t.waitText('แทรกคิว / เริ่มข้ามคิว')
    await t.clickButton('รับทราบ')
    await t.waitText('รับทราบ')

    // ยกเลิกงาน queued, sew (กำลังเย็บ), hold (พักงาน)
    for (const id of [qId, sewId, holdId]) {
      await openJobDirect(t, 'manager', id)
      await t.clickButton('ยกเลิกงานนี้')
      await t.fillInput('input[placeholder*="ลูกค้ายกเลิก"]', 'ลูกค้ายกเลิกออเดอร์ทดสอบ')
      await t.clickButton('ยืนยันยกเลิกงาน')
      await t.waitText('ถูกผู้บริหารยกเลิกแล้ว')
    }
    const sewAssigns = await sql(stack, 'select count(*)::int n from public.machine_assignments where job_id = $1 and released_at is null', [sewId])
    assert.equal(sewAssigns.rows[0].n, 0)
    const openIssues = await sql(stack, 'select count(*)::int n from public.issues where job_id = $1 and closed_at is null', [holdId])
    assert.equal(openIssues.rows[0].n, 0)

    // เปิดลิงก์ตรงของงานที่ยกเลิกแล้ว
    await t.goto('admin1', `#/board?job=${sewId}`, 1440)
    await t.waitText('ถูกผู้บริหารยกเลิกแล้ว')

    // งานข้างนอกและงานเสร็จยกเลิกไม่ได้
    await openJobDirect(t, 'manager', outId)
    await t.waitText('งานอยู่ที่บริษัทภายนอก ให้แอดมินกด "รับของกลับ" ก่อน แล้วค่อยยกเลิก')
    await openJobDirect(t, 'manager', doneId)
    const hasCancelOnDone = await t.ev(() => document.body.innerText.includes('ยกเลิกงานนี้'))
    assert.equal(hasCancelOnDone, false)
    return 'ผู้บริหาร: 5 หน้า + รับทราบ + ยกเลิก queued/sew/hold + กันยกเลิก out/done'
  })
}

async function runA6(ctx) {
  const { stack, t, tracker } = ctx
  await resetStack(stack)

  await tracker.check('A6.1', 'เจ้าของ: ภาพรวมระบบ + ผู้ใช้งาน + Roles + Station Assignment + ตั้งค่าทุกแท็บ + Audit Log', async () => {
    await t.goto('owner', '#/admin', 1440)
    await t.waitText('ภาพรวมระบบ')
    await t.waitText('บัญชียังไม่มีบทบาท')

    await t.goto('owner', '#/users', 1440)
    await t.waitText('ผู้ใช้และบทบาท')
    await t.clickButton('กำหนดบทบาท')
    await t.fillInput('input[type="text"], input:not([type])', 'พนักงานใหม่ทดสอบ', { index: 0 })
    await t.selectOption('select', 'staff')
    await t.clickButton('บันทึก')
    await t.waitText('บันทึกแล้ว')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มผู้ใช้')

    await t.goto('owner', '#/roles', 1440)
    await t.waitText('Roles & Permissions')

    await t.goto('owner', '#/assign', 1440)
    await t.waitText('จับคู่พนักงานกับสถานี')
    await t.clickButton('เลือกสถานี', { index: 0 })
    await t.waitText('พิมพ์')
    await t.ev(() => {
      const cb = [...document.querySelectorAll('input[type="checkbox"]')].find(c => c.closest('label')?.textContent.includes('พิมพ์'))
      if (cb && !cb.checked) cb.click()
    })
    await t.clickButton('บันทึก')
    await t.waitText('บันทึกแล้ว')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มจับคู่สถานี')

    await t.goto('owner', '#/settings', 1440)
    await t.waitText('ตั้งค่าระบบ')

    await t.waitText('สถานีและขั้นย่อย')
    await t.clickButton('แก้ไข', { index: 0 })
    await t.ev(() => {
      const inp = [...document.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('จำนวนเครื่อง'))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '3')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await t.clickButton('บันทึก')
    await t.waitText('3 เครื่อง')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มสถานี')

    await t.clickButton('เวลามาตรฐานของช่วง')
    await t.waitText('พิมพ์ + รีด + ตัด')
    await t.clickButton('แก้ไข', { index: 0 })
    await t.ev(() => {
      const inp = [...document.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('เวลามาตรฐาน (วันทำงาน)'))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '4')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await t.clickButton('บันทึก')
    await t.waitText('4 วันทำงาน')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มช่วง')

    await t.clickButton('แม่แบบวัตถุดิบ')
    await t.waitText('เพิ่มแม่แบบวัตถุดิบ')
    await t.clickButton('เพิ่มแม่แบบวัตถุดิบ')
    await t.waitText('ชื่อแม่แบบวัตถุดิบ')
    await t.ev(() => {
      const inp = [...document.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('ชื่อแม่แบบ'))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'วัตถุดิบทดสอบ R14')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await t.clickButton('บันทึก')
    await t.waitText('วัตถุดิบทดสอบ R14')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มวัตถุดิบ')

    await t.clickButton('รหัสสาเหตุ')
    await t.waitText('เพิ่มรหัสสาเหตุ')
    await t.clickButton('เพิ่มรหัสสาเหตุ')
    await t.waitText('รหัสสาเหตุ')
    await t.ev(() => {
      const setL = (lbl, val) => {
        const inp = [...document.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes(lbl))
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, val)
        inp.dispatchEvent(new Event('input', { bubbles: true }))
      }
      setL('รหัสสาเหตุ', 'T99')
      setL('กลุ่มสาเหตุ', 'ทดสอบ')
      setL('ชื่อสาเหตุ', 'สาเหตุจำลอง R14')
    })
    await t.clickButton('บันทึก')
    await t.waitText('T99 · สาเหตุจำลอง R14')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มรหัสสาเหตุ')

    await t.clickButton('จักรเย็บ')
    await t.waitText('เพิ่มจักร')
    await t.clickButton('เพิ่มจักร')
    await t.waitText('รหัสจักร')
    await t.ev(() => {
      const inp = [...document.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('รหัสจักร'))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'SN-099')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await t.clickButton('บันทึก')
    await t.waitText('SN-099')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มเพิ่มจักร')

    await t.clickButton('จำนวนจักรตามสินค้า')
    await t.waitText('เลือกสินค้า')
    await t.selectOption('select', 'hat')
    await t.clickButton('แก้ไข', { index: 0 })
    await t.waitText('จำนวนจักร')
    await t.ev(() => {
      const inp = [...document.querySelectorAll('input')].find(i => i.closest('label')?.textContent.includes('จำนวนจักร'))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '1')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await t.clickButton('บันทึก')
    await t.waitText('1 ตัว')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มสูตรจักร')

    await t.clickButton('ชนิดจักร')
    await t.waitText('เข็มเดี่ยว · SN')
    await t.clickButton('แก้ไข', { index: 1 })
    await t.selectOption('select', 'shared')
    await t.clickButton('บันทึก')
    await t.waitText('ใช้ร่วม')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มชนิดจักร')

    await t.clickButton('การแจ้งเตือน')
    await t.waitText('เมื่อปิด ระบบจะหยุดสร้างข้อความใหม่')
    await t.clickButton('แก้ไข', { index: 0 })
    await t.waitText('เปิดการแจ้งเตือน')
    await t.ev(() => document.querySelector('input[type="checkbox"]').click())
    await t.clickButton('บันทึก')
    await waitFor(() => t.ev(() => !document.querySelector('form button[type="submit"]')), 'ปิดฟอร์มการแจ้งเตือน')
    await t.waitText('ปิด')

    await t.goto('owner', '#/audit', 1440)
    await t.waitText('Audit Log')
    await t.waitText('เพิ่มจักรเย็บ')
    await t.waitText('สาเหตุจำลอง R14')
    return 'owner ครบ 6 เมนู + ตั้งค่าครบทุกแท็บ + Audit Log'
  })
}

async function runA7(ctx) {
  const { stack, t, tracker } = ctx
  await resetStack(stack)

  await tracker.check('A7.1', 'ผู้ควบคุมงานเฟส 1 และ เฟส 2 เห็นและกดงานได้ตามเฟส', async () => {
    await receiveViaUi(t, { no: 'TEST-A7-1', customer: 'ลูกค้าเฟส', product: 'tshirt', qty: 6, route: 'plain', sample: false })
    const jid = await jobIdByNo(stack, 'TEST-A7-1')
    await t.goto('sup2', '#/board', 1440)
    await t.waitText('งานเฟส 2')
    const sup2SeesCut = await t.ev(() => document.body.innerText.includes('TEST-A7-1'))
    assert.equal(sup2SeesCut, false)

    await t.goto('sup1', '#/board?station=cut', 1440)
    await t.waitText('TEST-A7-1')
    await t.clickButton('เริ่มตัดงาน')
    await t.clickButton('ตัดงานเสร็จ'); await t.clickButton('ยืนยัน', { exact: true })

    await t.goto('sup1', '#/board', 1440)
    const sup1SeesSew = await t.ev(() => document.body.innerText.includes('TEST-A7-1'))
    assert.equal(sup1SeesSew, false)

    await t.goto('sup2', '#/board', 1440)
    await t.clickButton('จักรเย็บ')
    await t.waitText('TEST-A7-1')
    await t.clickButton('เริ่มเย็บ', { inside: `#sew-pick-${jid}` }); await t.clickButton(/เริ่มเย็บด้วย/)
    await t.clickButton('เย็บเสร็จ'); await t.clickButton('ยืนยันเย็บเสร็จ')
    return 'เฟส 1 และเฟส 2 แยกสิทธิ์และสถานีถูกต้อง'
  })
}

async function runA8(ctx) {
  const { stack, t, tracker } = ctx
  await resetStack(stack)

  await tracker.check('A8.1', 'ข้ามบทบาทต่อเนื่องครบ 9 เส้นทาง + ตรวจความตรงกันของบอร์ด ภาพรวม คิว กล่องจดหมาย ประวัติ รายงาน', async () => {
    const routes = [
      ['normal', 'tshirt', 'TEST-A8-1'],
      ['dtf', 'tshirt', 'TEST-A8-2'],
      ['dtg', 'tshirt', 'TEST-A8-3'],
      ['screen', 'tshirt', 'TEST-A8-4'],
      ['emb', 'tshirt', 'TEST-A8-5'],
      ['print_emb', 'tshirt', 'TEST-A8-6'],
      ['cut_only', 'tshirt', 'TEST-A8-7'],
      ['plain', 'tshirt', 'TEST-A8-8'],
      ['outside', 'hat', 'TEST-A8-9'],
    ]

    for (const [rt, prod, no] of routes) {
      await receiveViaUi(t, { no, customer: `ลูกค้า ${rt}`, product: prod, qty: 10, route: rt, sample: false })
      const id = await jobIdByNo(stack, no)
      if (['dtf', 'dtg', 'screen'].includes(rt)) {
        await openJobDirect(t, 'admin1', id)
        await t.fillInput('input[type="date"]', '2099-01-10')
        await t.clickButton(/บันทึกสั่ง/)
        await t.clickButton(/ได้รับ.*แล้ว/)
      }
      if (rt === 'outside') {
        await openJobDirect(t, 'admin1', id)
        await t.clickButton('ส่งออกบริษัทภายนอก')
        await t.ev(() => {
          const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')))
          sel.value = [...sel.options].find(o => o.textContent.includes('โรงงานผลิตสำเร็จรูปจำลอง')).value
          sel.dispatchEvent(new Event('change', { bubbles: true }))
        })
        await t.clickButton('บันทึกส่งออก')
        await t.clickButton('ของถึงโรงงานแล้ว · รับเข้า')
        await t.clickButton('ยืนยันรับของ')
      } else {
        // เดินสถานีหน้างานจนถึง qc_pack
        while (true) {
          const stRes = await sql(stack, 'select private.station_at(route_code, station_seq) st, station_status from public.jobs where id = $1', [id])
          const st = stRes.rows[0]?.st
          if (!st || st === 'qc_pack') break
          if (st === 'sew') {
            await t.goto('prod1', '#/board', 1440)
            await t.clickButton('จักรเย็บ')
            await t.waitText('งานระหว่างเย็บ')
            await t.clickButton('เริ่มเย็บ', { inside: `#sew-pick-${id}` }); await t.clickButton(/เริ่มเย็บด้วย/)
            await t.clickButton('เย็บเสร็จ'); await t.clickButton('ยืนยันเย็บเสร็จ')
          } else {
            const actor = ['print', 'press', 'cut', 'dtf_press', 'emb'].includes(st) ? 'staff_multi' : 'prod1'
            await openJobDirect(t, actor, id)
            await t.clickButton(/^(?:\d+\. )?เริ่ม/)
            await t.clickButton(/^(?:\d+\. )?(?:พิมพ์งานเสร็จ|รีดงานเสร็จ|ตัดงานเสร็จ|รีดฟิล์มเสร็จ|ส่งปักเสร็จ|QC \+ Packing เสร็จ)$/)
            await t.clickButton('ยืนยัน', { exact: true })
          }
        }
      }
      await openJobDirect(t, 'staff_qc', id)
      await t.clickButton('เริ่ม QC + Packing')
      await t.fillInput('input[aria-label="จำนวนที่ผ่าน"]', '10')
      await t.clickButton('บันทึกผ่าน')
      await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน', { exact: true })

      await openJobDirect(t, 'admin1', id)
      await t.clickButton('จัดส่งให้ลูกค้าแล้ว'); await t.clickButton('ยืนยัน', { exact: true })
    }

    await t.goto('admin1', '#/', 1440)
    await t.waitText('เสร็จวันนี้')
    await t.waitText('9')
    await t.goto('admin1', '#/production-queue', 1440)
    await t.waitText('คิวการผลิต')
    await t.goto('manager', '#/reports', 1440)
    await t.waitText('9')
    await t.goto('admin1', '#/inbox', 1440)
    await t.waitText('กล่องจดหมาย')
    return '9 เส้นทางเดินครบถึงจัดส่ง + รายงาน 9 งานตรง'
  })
}

async function main() {
  const stack = await startLocalStack()
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)
  const second = chrome.wrap(await chrome.newTab())
  const peer = chrome.wrap(await chrome.newTab({ isolated: true }))
  const fixtures = await createFixtures(t)
  const tracker = makeTracker(chrome)

  try {
    const ctx = { stack, chrome, t, second, peer, fixtures, tracker }
    const only = (process.env.QA_ONLY ?? '').split(',').filter(Boolean)
    for (const [name, run] of Object.entries({ A1: runA1, A2: runA2, A3: runA3, A4: runA4, A5: runA5, A6: runA6, A7: runA7, A8: runA8 })) {
      if (!only.length || only.includes(name)) await run(ctx)
    }
    assert.deepEqual(chrome.externalAttempts, [])
  } finally {
    await writeFile(SUMMARY_PATH, JSON.stringify({
      externalAttempts: chrome.externalAttempts,
      blockedFontRequests: chrome.blockedFontRequests.length,
      results: tracker.results,
    }, null, 2))
    await fixtures.cleanup()
    await chrome.close()
    await stack.close()
  }
  if (tracker.results.some(r => !r.pass)) process.exitCode = 1
}

main()
