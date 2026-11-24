import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startLocalStack } from '../qa-r14/server.mjs'
import { openChrome, waitFor } from '../qa-r14/chrome.mjs'
import { createFixtures } from '../qa-r14/fixtures.mjs'

const OUT_JSON = fileURLToPath(new URL('./part-bc-extra-results.json', import.meta.url))

async function sql(stack, query, params = []) {
  const res = await fetch(`${stack.origin}/__qa/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: query, params }),
  })
  assert.equal(res.status, 200)
  return res.json()
}

async function main() {
  const stack = await startLocalStack()
  const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
  const t = chrome.wrap(chrome.main)
  const fixtures = await createFixtures(t)
  const results = []

  try {
    // สร้างงานตัวอย่าง 1 งานเพื่อให้ #/label, #/mockup, #/artwork, #/board?job= มี id จริง
    await t.goto('admin1', '#/', 1440)
    await t.clickButton('รับงานใหม่')
    await t.fillInput('[role="dialog"] input[placeholder*="SC"]', 'SC69-BC1')
    await waitFor(() => t.ev(() => Boolean([...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.value === 'tshirt')))), 'ตัวเลือก')
    await t.ev(() => {
      const dlg = document.querySelector('[role="dialog"]')
      const inputs = [...dlg.querySelectorAll('input')]
      const setVal = (el, val) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setVal(inputs.find(i => i.closest('label')?.textContent.includes('ชื่อลูกค้า')), 'ลูกค้าทดสอบ BC')
      const pSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'tshirt'))
      pSel.value = 'tshirt'; pSel.dispatchEvent(new Event('change', { bubbles: true }))
      setVal(inputs.find(i => i.closest('label')?.textContent.includes('จำนวน')), '12')
      setVal(inputs.find(i => i.type === 'date'), '2099-02-01')
      const rSel = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'normal'))
      rSel.value = 'normal'; rSel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await t.ev(() => document.querySelectorAll('[role="dialog"] input[name="needs-sample"]')[2].click())
    await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
    await t.waitText('ส่งงาน SC69-BC1 เข้าโรงงานแล้ว')
    const jobId = (await sql(stack, `select id from public.jobs where confirmation_no = 'SC69-BC1'`)).rows[0].id

    // =========================================================================
    // B9: สิทธิ์ผ่านหน้าจอ — เปิด URL หน้าที่ไม่ใช่ของตัวเองตรงๆ (#/...)
    // =========================================================================
    const roleUrlMatrix = {
      admin1: ['#/admin', '#/users', '#/roles', '#/assign', '#/audit', '#/settings', '#/reviews'],
      prod1: ['#/admin', '#/users', '#/roles', '#/assign', '#/audit', '#/settings', '#/reviews'],
      qc: ['#/admin', '#/users', '#/roles', '#/assign', '#/audit', '#/settings', '#/reviews', '#/reports', '#/jobs', '#/production-queue'],
      staff_single: ['#/admin', '#/users', '#/roles', '#/assign', '#/audit', '#/settings', '#/reviews', '#/reports', '#/jobs', '#/production-queue', `#/artwork?id=${jobId}`, `#/label?id=${jobId}`],
      manager: ['#/admin', '#/users', '#/roles', '#/assign', '#/audit', '#/settings'],
      disabled: ['#/', '#/board', '#/admin'],
      norole: ['#/', '#/board', '#/admin'],
    }

    const b9Violations = []
    for (const [role, hashes] of Object.entries(roleUrlMatrix)) {
      for (const h of hashes) {
        await t.goto(role, h, 1440)
        const state = await t.ev(() => {
          const txt = document.body.innerText.replace(/\s+/g, ' ').trim()
          return {
            denied: txt.includes('ไม่มีสิทธิ์') || txt.includes('ยังเข้าใช้งานไม่ได้') || txt.includes('ปิดใช้งาน') || txt.includes('ยังไม่ได้รับบทบาท') || txt.includes('ดูได้อย่างเดียว') || txt.includes('ไม่พบ'),
            hasSettingsInput: Boolean(document.querySelector('input[type="number"], select') && document.body.innerText.includes('ตั้งค่าระบบ')),
            hasUserMgmt: document.body.innerText.includes('เปิด/ปิดการใช้งาน') || document.body.innerText.includes('จัดการผู้ใช้'),
            snippet: txt.slice(0, 140),
          }
        })
        if (!state.denied && (state.hasSettingsInput || state.hasUserMgmt || role === 'disabled' || role === 'norole')) {
          b9Violations.push({ role, hash: h, ...state })
        }
        // สำหรับ staff_single เปิด artwork/label ไม่ควรเห็นปุ่มพิมพ์/แก้ หรือควรขึ้นข้อความจำกัด
        if (role === 'staff_single' && !state.denied && !h.includes('artwork') && !h.includes('label')) {
          b9Violations.push({ role, hash: h, ...state })
        }
      }
    }
    results.push({ id: 'B9', pass: b9Violations.length === 0, violations: b9Violations })
    console.log(`B9 direct-URL check: violations=${b9Violations.length}`, b9Violations)

    // =========================================================================
    // B10: เมนูบนจอ vs คู่มือแต่ละบทบาท
    // =========================================================================
    const menusByRole = {}
    for (const role of ['admin1', 'prod1', 'qc', 'manager', 'owner', 'staff_single']) {
      await t.goto(role, '#/', 1440)
      menusByRole[role] = await t.ev(() => [...document.querySelectorAll('aside nav a')].map(a => a.textContent.replace(/\s+/g, ' ').trim()))
    }
    results.push({ id: 'B10', menusByRole })
    console.log('B10 menusByRole:', JSON.stringify(menusByRole))

    // =========================================================================
    // C1: ตรวจ overflow ที่ qa-part-b พบ (375px #/board และ #/board?job=...)
    // =========================================================================
    await t.goto('admin1', '#/board', 375)
    const board375 = await t.ev(() => ({
      docClient: document.documentElement.clientWidth,
      docScroll: document.documentElement.scrollWidth,
      mainClient: document.querySelector('main')?.clientWidth ?? null,
      mainScroll: document.querySelector('main')?.scrollWidth ?? null,
    }))
    await t.goto('admin1', `#/board?job=${jobId}`, 375)
    const drawer375 = await t.ev(() => {
      const aside = document.querySelector('aside[aria-label]') || document.querySelector('[role="dialog"]')
      const r = aside?.getBoundingClientRect()
      return {
        docClient: document.documentElement.clientWidth,
        docScroll: document.documentElement.scrollWidth,
        asideRight: r ? Math.round(r.right) : null,
        asideWidth: r ? Math.round(r.width) : null,
      }
    })
    results.push({ id: 'C1-overflow', board375, drawer375 })
    console.log('C1 overflow check:', JSON.stringify({ board375, drawer375 }))
  } finally {
    await writeFile(OUT_JSON, JSON.stringify({ results }, null, 2))
    await chrome.close()
    await stack.close()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
