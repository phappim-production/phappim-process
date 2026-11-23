import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '../../app/node_modules/@supabase/supabase-js/dist/index.mjs'
import { localStack } from './local.mjs'
import { ACCOUNTS } from '../qa-r14/db.mjs'

assert.ok(process.argv[2], 'ระบุโฟลเดอร์ผลนอก repo')
const out = resolve(process.argv[2])
await mkdir(out, { recursive: true })
process.env.QA_IMG_DIR = out
const stack = await localStack()
const { openChrome, waitFor } = await import('../qa-r14/chrome.mjs')
const { createFixtures } = await import('../qa-r14/fixtures.mjs')
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const t = chrome.wrap(chrome.main)
const { sessionFor } = await import('../qa-r14/server.mjs')
const fixtures = await createFixtures(t)
const checks = {}
const no = 'TEST-R16-REVISE'
const imagePath = no + '/before.png'
const spec = {
  app: 'phappim-confirm', v: 1, product: 'jersey',
  h: { doc_no: no, job_name: 'เสื้อ QA', customer: 'ลูกค้าจำลอง', delivery: 'จัดส่งตามที่อยู่', address: 'QA ADDRESS OLD' },
  p: { jersey: { fabric: 'QA FABRIC', size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ label: 'QA', q: { S: 10 } }] } },
  callouts: [{ x: .3, y: .4, bx: .78, by: .27, title: 'QA POINT', body: 'QA DETAILS' }],
  mockup_path: imagePath, summary: { qty: 10 },
}

const actors = Object.fromEntries(ACCOUNTS.map(account => [account.key, sessionFor(account).access_token]))
function client(actor) {
  return createClient(stack.origin, 'r14-local-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: actor ? { headers: { Authorization: 'Bearer ' + actors[actor] } } : undefined,
  })
}
const admin = client('admin1')
async function rpc(db, name, args) {
  const { error, data } = await db.rpc(name, args)
  assert.equal(error, null, JSON.stringify(error))
  return data
}
async function upload(kind, path, file, type) {
  const body = await readFile(file)
  const result = await fetch(stack.filesOrigin + '/upload/' + kind + '/' + path, {
    method: 'PUT', headers: { Origin: stack.origin, Authorization: 'Bearer ' + actors.admin1, 'Content-Type': type }, body,
  })
  assert.equal(result.status, 200, await result.text())
}
async function snapshot(id) {
  const { rows } = await stack.db.execSuper('select spec, confirmation_pdf_path, mockup_path, phase from jobs where id = $1', [id])
  return rows[0]
}
async function screen(name) {
  const data = await t.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(resolve(out, 'r16-cx-' + name + '.png'), Buffer.from(data.data, 'base64'))
}
async function detail(actor, id) {
  await t.goto(actor, '#/board?job=' + id, 768)
  await t.waitText(actor.startsWith('staff') ? no : 'ความคืบหน้า')
}
async function expand() {
  await waitFor(() => t.ev(() => [...document.querySelectorAll('summary')].some(x => x.textContent.includes('ลูกค้าขอแก้ใบยืนยัน'))), 'เมนูแก้ใบ')
  await t.ev(() => [...document.querySelectorAll('summary')].find(x => x.textContent.includes('ลูกค้าขอแก้ใบยืนยัน')).click())
}
async function check(name, fn) {
  try {
    checks[name] = { ok: true, detail: await fn() }
    console.log('PASS', name, JSON.stringify(checks[name].detail))
  } catch (e) {
    checks[name] = { ok: false, error: e.message, stack: e.stack }
    console.log('FAIL', name, e.message)
  }
}
async function receive(confirmationNo, pSpec, pdfPath) {
  return rpc(admin, 'receive_job', {
    p_confirmation_no: confirmationNo, p_customer_name: 'ลูกค้าจำลอง', p_job_name: 'เสื้อ QA', p_product_type_code: 'jersey',
    p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-10', p_route_code: 'cut_only', p_needs_sample: false,
    p_confirmation_pdf_path: pdfPath, p_spec: pSpec,
  })
}

try {
  await upload('mockups', imagePath, fixtures.paths.frontPng, 'image/png')
  const draft = await rpc(admin, 'save_confirmation_draft', { p_data: spec })
  const id = await receive(no, spec, null)
  const before = await snapshot(id)
  assert.equal(before.mockup_path, imagePath)
  const initialPath = no + '/initial.pdf'
  await upload('confirmations', initialPath, fixtures.paths.pdf, 'application/pdf')
  await rpc(admin, 'attach_confirmation_pdf', { p_job: id, p_path: initialPath })

  const files = []
  await check('A1 reopen PDF and block duplicate draft', async () => {
    for (const [actor, revision] of [['admin1', 1], ['owner', 2]]) {
      await detail(actor, id)
      await expand()
      await t.ev(() => { window.open = () => null })
      await t.clickButton('เปิดใบยืนยันในฟอร์ม')
      await t.waitText('ของงานที่รับแล้ว')
      await waitFor(() => t.ev(() => {
        const img = document.querySelector('[data-co-img]')
        return img?.complete && img.naturalWidth > 0
      }), 'รูปจากระบบ')
      const opening = await t.ev(() => ({ address: state.h.address, points: state.callouts.map(x => x.title) }))
      assert.deepEqual(opening, { address: 'QA ADDRESS OLD', points: ['QA POINT'] })
      await t.fillInput('[data-k="address"]', 'QA ADDRESS REV ' + revision)
      await t.fillInput('[data-k="rev"]', String(revision))
      await t.ev(() => { window.print = () => { window.qaPrinted = true } })
      await t.clickButton('ส่งออก PDF')
      await waitFor(() => t.ev(() => window.qaPrinted), 'ส่งออก PDF')
      await t.ev(() => togglePreview(true))
      await t.waitText('QA ADDRESS REV ' + revision)
      const filename = resolve(out, 'r16-cx-revision-' + revision + '.pdf')
      const pdf = await t.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
      await writeFile(filename, Buffer.from(pdf.data, 'base64'))
      files.push(filename)
      if (revision === 1) {
        await screen('revision-form')
        await t.ev(() => {
          togglePreview(false)
          window.open = () => null
        })
        await t.clickButton('บันทึกเข้าระบบ')
        await t.waitText('กดเปิดหน้าระบบ')
        await t.goto(actor, '#/board?confirmation=save', 768)
        await t.waitText('ส่งงานเข้าโรงงานแล้ว')
        await screen('revision-duplicate')
        const state = await stack.db.execSuper('select status, job_id, data from confirmation_drafts where id = $1', [draft])
        assert.deepEqual(state.rows[0], { status: 'received', job_id: id, data: spec })
        const count = await stack.db.execSuper('select count(*)::int as n from jobs where confirmation_no = $1', [no])
        assert.equal(count.rows[0].n, 1)
      }
    }
    return { files: files.length, draftPreserved: true, mockup: imagePath, point: 'QA POINT' }
  })

  await check('A1 replace twice, reject bad files, sign latest bytes', async () => {
    assert.equal(files.length, 2)
    let expectedPath
    for (const [i, actor] of ['admin1', 'owner'].entries()) {
      await detail(actor, id)
      await expand()
      const selector = 'details input[type="file"][accept*="pdf"]'
      if (i === 0) {
        const invalid = resolve(out, 'qa-not-pdf.txt')
        const oversized = resolve(out, 'qa-oversized.pdf')
        await writeFile(invalid, 'QA')
        await writeFile(oversized, Buffer.alloc(20 * 1024 * 1024 + 1))
        await t.uploadFiles(selector, [invalid])
        await t.waitText(/เลือกไฟล์ PDF|ต้องเป็น PDF/)
        await t.uploadFiles(selector, [oversized])
        await t.waitText(/20 MB/)
        assert.equal((await snapshot(id)).confirmation_pdf_path, initialPath)
      }
      await t.uploadFiles(selector, [files[i]])
      await t.clickButton(/^เปลี่ยนเป็น PDF ใบใหม่$/)
      const next = await waitFor(async () => {
        const current = await snapshot(id)
        return current.confirmation_pdf_path !== (expectedPath ?? initialPath) && current
      }, 'บันทึก PDF ฉบับใหม่')
      expectedPath = next.confirmation_pdf_path
      assert.deepEqual(next.spec, before.spec)
      await t.waitText('เปลี่ยน PDF ใบยืนยัน')
    }
    const signed = await fetch(stack.filesOrigin + '/sign', {
      method: 'POST', headers: { Origin: stack.origin, Authorization: 'Bearer ' + actors.admin1, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'confirmations', paths: [expectedPath] }),
    })
    assert.equal(signed.status, 200)
    const latest = (await signed.json()).urls[expectedPath]
    assert.equal(new URL(latest).origin, stack.filesOrigin)
    const fetched = await fetch(latest)
    assert.equal(fetched.status, 200)
    assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), await readFile(files[1]))
    const events = await stack.db.execSuper("select count(*)::int as n from events where job_id=$1 and type='confirmation_pdf'", [id])
    assert.equal(events.rows[0].n, 3)
    await screen('revision-replaced')
    return { events: 3, latest: expectedPath, identicalDownload: true }
  })

  await check('A1 non-form message', async () => {
    const manual = await receive(no + '-MANUAL', {}, null)
    await detail('admin1', manual)
    await expand()
    await t.clickButton('เปิดใบยืนยันในฟอร์ม')
    await t.waitText('งานนี้รับเข้าโดยไม่ได้ใช้ฟอร์มใบยืนยัน')
    return true
  })

  await check('A1 roles and cancellation', async () => {
    const denied = {}
    for (const account of ACCOUNTS.filter(a => !a.active || !['owner', 'admin'].includes(a.role))) {
      const { error } = await client(account.key).rpc('attach_confirmation_pdf', { p_job: id, p_path: initialPath })
      assert.ok(error, account.key)
      denied[account.key] = error.code
    }
    const visibility = {}
    for (const actor of ['prod1', 'qc', 'staff_single', 'manager']) {
      await detail(actor, id)
      visibility[actor] = await t.ev(() => document.body.innerText.includes('ลูกค้าขอแก้ใบยืนยัน'))
      assert.equal(visibility[actor], false)
    }
    await rpc(client('manager'), 'cancel_job', { p_job: id, p_reason: 'QA cancelled' })
    const { error } = await admin.rpc('attach_confirmation_pdf', { p_job: id, p_path: initialPath })
    assert.match(error?.message ?? '', /ยกเลิกแล้ว/)
    return { denied, visibility, cancelled: error.message }
  })
} finally {
  await writeFile(resolve(out, 'revision.json'), JSON.stringify({ checks, external: chrome.externalAttempts, logs: chrome.main.logs }, null, 2))
  await fixtures.cleanup()
  await chrome.close()
  await stack.close()
  assert.deepEqual(chrome.externalAttempts, [])
  if (Object.values(checks).some(result => !result.ok)) process.exitCode = 1
}
