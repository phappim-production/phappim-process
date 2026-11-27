// ส่วน D: ไล่ทุกเมนูของทุกบทบาท (จาก auth/menus.ts) × ขนาดจอ · หน้าที่บทบาทเปิดไม่ได้ · ลิ้นชักงาน · ออฟไลน์ · console
import { roleMenu, ROUTES, canOpenPage } from '../lib/lead.mjs'
import { ACCOUNTS } from '../../qa-r14/db.mjs'

const FLOOR_ROLES = new Set(['staff', 'qc', 'supervisor'])
const SETTLE_MS = 700

export async function runUiCrawler(browser, client, { quick = false } = {}) {
  await client.reset(false)
  const job = await seedJob(client)
  const widths = quick ? [375, 1440] : [375, 768, 1440]
  const keys = quick ? ['admin1', 'staff_single', 'qc'] : ['owner', 'manager', 'admin1', 'prod1', 'sup1', 'sup2', 'qc', 'staff_single', 'staff_qc', 'staff_empty']
  const logs = browser.tab?.logs
  if (!Array.isArray(logs)) throw new Error('อ่าน console ของเบราว์เซอร์ไม่ได้ (browser.tab.logs)')
  await browser.goto('admin1', '#/board', 1440)
  const probeAt = logs.length
  await browser.ev(() => console.error('qa-suite-console-probe'))
  await new Promise(r => setTimeout(r, 200))
  if (!logs.slice(probeAt).some(l => /qa-suite-console-probe/.test(l.text))) throw new Error('ตัวจับ console error ไม่ทำงาน')
  const issues = []
  let screens = 0

  const check = async (key, role, hash, width) => {
    const logStart = logs.length
    await browser.goto(key, hash, width)
    await new Promise(r => setTimeout(r, SETTLE_MS))
    screens++
    const m = await browser.measureFloorUx(width)
    const text = await browser.ev(() => document.body.innerText.trim())
    const where = `${key} ${hash} @${width}`
    if (m.docScrollWidth > m.viewport + 1) issues.push(`${where}: หน้ากว้างเกินจอ ${m.docScrollWidth - m.viewport}px`)
    if (m.overflows.length) issues.push(`${where}: ของล้นขวา ${JSON.stringify(m.overflows.slice(0, 2))}`)
    if (m.pageScroll > 1) issues.push(`${where}: หน้าเลื่อนทั้งหน้า ${m.pageScroll}px`)
    if (m.badTokens.length) issues.push(`${where}: ข้อความผิดปกติ ${m.badTokens.join(',')}`)
    if (FLOOR_ROLES.has(role) && m.smallButtons.length) issues.push(`${where}: ปุ่มหลักต่ำกว่า 48px ${JSON.stringify(m.smallButtons.slice(0, 2))}`)
    if (!text) issues.push(`${where}: จอขาว`)
    if (/Failed to fetch|NetworkError|TypeError|Unexpected token/i.test(text)) issues.push(`${where}: ข้อความ error อังกฤษบนจอ`)
    const newLogs = logs.slice(logStart).filter(l => !/favicon|fonts\.g/.test(`${l.text} ${l.url ?? ''}`))
    if (newLogs.length) issues.push(`${where}: console ${JSON.stringify(newLogs.slice(0, 2))}`)
    return text
  }

  for (const key of keys) {
    const acc = ACCOUNTS.find(a => a.key === key)
    const hashes = [...new Set(roleMenu(acc.role).flatMap(g => g.items.map(i => i.hash)))]
    for (const hash of hashes) for (const w of widths) await check(key, acc.role, hash, w)
    if (!quick || key === 'admin1') for (const w of widths) await check(key, acc.role, `#/board?job=${job}`, w)

    for (const [hash, route] of Object.entries(ROUTES)) {
      if (canOpenPage(acc.role, route.page) || hash === '#/' || route.page === 'overview') continue
      if (quick && !['#/settings', '#/users', '#/audit', '#/reports'].includes(hash)) continue
      const text = await check(key, acc.role, hash, 1440)
      if (!/เปิดหน้านี้ไม่ได้|หน้านี้สำหรับเจ้าของระบบ/.test(text)) issues.push(`${key} เปิด ${hash} ได้ (บทบาท ${acc.role} ไม่มีสิทธิ์)`)
    }
  }

  await browser.goto('admin1', '#/board', 1440)
  await browser.setOffline(true)
  await new Promise(r => setTimeout(r, 400))
  const offline = await browser.ev(() => document.body.innerText)
  await browser.setOffline(false)
  if (/Failed to fetch|NetworkError/i.test(offline)) issues.push('ออฟไลน์แล้วขึ้น Failed to fetch')

  if (issues.length) {
    const err = new Error(`${issues.length} ข้อ: ${issues.slice(0, 8).join(' ; ')}`)
    err.details = issues
    throw err
  }
  return { screens }
}

async function seedJob(client) {
  const r = await client.rpc('admin1', 'receive_job', {
    p_confirmation_no: 'UI-JOB-1', p_customer_name: 'ลูกค้าทดสอบหน้าจอที่ชื่อยาวมากเพื่อดูว่าตัดบรรทัดถูก', p_job_name: 'งานทดสอบหน้าจอ',
    p_product_type_code: 'tshirt', p_qty: 120, p_unit: 'ตัว', p_due_date: '2099-01-20', p_route_code: 'cut_only',
    p_confirmation_pdf_path: null, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
  })
  if (!r.ok) throw new Error(`UI seed: ${JSON.stringify(r.body)}`)
  return r.body
}
