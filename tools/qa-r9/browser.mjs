import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureApi, dist, origin, roles, stations, sewId, labelId } from './api.mjs'
import { openChrome, waitFor } from './chrome.mjs'

const evidence = new URL('../../docs/qa/img/', import.meta.url)
const widths = [1440, 768, 375]
const focus = process.env.QA_FOCUS ? new RegExp(process.env.QA_FOCUS, 'u') : null
const menuCounts = { owner: 10, admin: 6, manager: 6, production: 6, supervisor: 6, qc: 5, staff: 5 }
const assets = await readdir(join(dist, 'assets'))
const entry = assets.find(name => /^index-.*\.js$/.test(name))
assert.ok(entry && (await readFile(join(dist, 'assets', entry), 'utf8')).includes(origin), 'ต้อง build ด้วย VITE_SUPABASE_URL=' + origin)
await mkdir(evidence, { recursive: true })
const api = fixtureApi()
api.server.listen(5199, '127.0.0.1')
await once(api.server, 'listening')
let browser
const results = []
const temp = await mkdtemp(join(tmpdir(), 'pp142-r9-print-'))

try {
  browser = await openChrome()
  const { send, ev, logs } = browser
  const installFixture = (loopback, user) => {
    if (location.origin !== loopback) return
    const role = new URLSearchParams(location.search).get('qa-role')
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + btoa(JSON.stringify({ exp: 4_000_000_000, sub: user.id })).replace(/=+$/, '') + '.' + role
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'local-fixture', expires_at: 4_000_000_000, token_type: 'bearer',
      user: { ...user, aud: 'authenticated' },
    }))
    localStorage.removeItem('pp142.station')
    window.WebSocket = class FixtureSocket {
      constructor() {
        this.readyState = 0
        setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')) }, 0)
      }
      send(message) {
        const [joinRef, ref, topic, event, payload] = JSON.parse(message)
        const changes = (payload?.config?.postgres_changes ?? []).map((filter, i) => ({ ...filter, id: i + 1 }))
        const data = JSON.stringify([joinRef, ref, topic, 'phx_reply', {
          status: 'ok', response: { postgres_changes: event === 'phx_join' ? changes : [] },
        }])
        setTimeout(() => this.onmessage?.(new MessageEvent('message', { data })), 0)
      }
      close() { this.readyState = 3 }
      addEventListener(event, listener) { this['on' + event] = listener }
      removeEventListener(event) { delete this['on' + event] }
    }
  }
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: '(' + installFixture.toString() + ')(' + JSON.stringify(origin) + ',' + JSON.stringify(api.user) + ')',
  })

  const waitText = text => waitFor(() => ev(s => document.body.innerText.includes(s), text), text)
  const clean = text => text.replace(/\s+/g, ' ').trim()
  const button = (text, parent = 'body') => waitFor(() => ev((label, selector) => {
    const el = [...(document.querySelector(selector)?.querySelectorAll('button') ?? [])].find(b =>
      b.getClientRects().length && !b.disabled && b.textContent.replace(/\s+/g, ' ').trim() === label)
    if (!el) return false
    el.scrollIntoView({ block: 'nearest' })
    el.click()
    return true
  }, clean(text), parent), text)
  let serial = 0
  async function goto(role, hash) {
    const href = origin + '/?qa-role=' + role + '&case=' + ++serial + hash
    await send('Page.navigate', { url: href })
    await waitFor(() => ev(expected => location.href.startsWith(expected) && document.body.innerText.includes('ผู้ใช้จำลอง'),
      href.split('#')[0]), href)
  }
  async function ready() {
    await waitFor(() => ev(() => {
      const region = document.querySelector('main,[data-scroll="dashboard"]') ?? document.body
      return Boolean(region.querySelector('h1,h2,h3')) && !/กำลังโหลด/.test(region.innerText)
    }), 'หน้าโหลดเสร็จ')
  }
  async function inspect(width) {
    await ready()
    const layout = await ev(() => {
      const region = document.querySelector('main,[data-scroll="dashboard"]') ?? document.body
      return {
        width: innerWidth, document: document.documentElement.scrollWidth,
        regionOverflow: region.clientWidth > 0 ? region.scrollWidth - region.clientWidth : 0,
        broken: /ส่วนนี้แสดงไม่ได้|เกิดข้อผิดพลาด|โหลด[^。\n]*ไม่สำเร็จ/.test(region.innerText),
      }
    })
    assert.equal(layout.width, width)
    assert.ok(layout.document <= width && layout.regionOverflow <= 1, 'ล้น ' + JSON.stringify(layout))
    assert.equal(layout.broken, false, 'หน้าขึ้นข้อความผิดพลาด')
  }
  async function screenshot(name) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(new URL('r9-cx-' + name + '.png', evidence), Buffer.from(data, 'base64'))
  }
  async function record(label, test) {
    if (focus && !focus.test(label)) return
    const from = logs.length
    try {
      const detail = await test()
      assert.deepEqual(logs.slice(from), [], 'console error')
      results.push({ label, pass: true, detail })
      console.log('PASS ' + label + (detail ? ' ' + detail : ''))
    } catch (error) {
      const location = await ev(() => ({ hash: window.location.hash, text: document.body.innerText.slice(0, 1000) })).catch(() => null)
      results.push({ label, pass: false, error: error.message, location, console: logs.slice(from) })
      console.log('FAIL ' + label + ' ' + error.message)
    }
  }

  const menus = new Map()
  const stationNames = ['พิมพ์', 'รีด', 'ตัด', 'รีดฟิล์ม', 'ปัก', 'เย็บ', 'QC']
  for (const width of widths) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    for (const role of roles) {
      await record(width + '/เมนู/' + role, async () => {
        await goto(role, '#/board')
        if (width === 1440) {
          menus.set(role, await ev(() => [...document.querySelectorAll('aside nav[aria-label="เมนูหลัก"] a')].map(a => a.hash)))
        }
        const links = menus.get(role)
        assert.equal(links.length, menuCounts[role])
        for (const hash of links) {
          if (width === 1440) {
            await ev(path => document.querySelector('aside nav[aria-label="เมนูหลัก"] a[href="' + path + '"]').click(), hash)
            await waitFor(() => ev(path => location.hash === path, hash), hash)
          } else {
            await goto(role, hash)
          }
          await inspect(width)
          assert.equal(await ev(() => /หน้านี้สำหรับเจ้าของระบบ|บทบาทของคุณเปิดหน้านี้ไม่ได้/.test(document.body.innerText)), false, hash)
        }
        if (role !== 'owner') {
          await goto(role, '#/audit')
          await waitText('หน้านี้สำหรับเจ้าของระบบ')
          await inspect(width)
        }
        if (width === 1440 && role === 'owner') await screenshot('menu-owner-1440')
        return links.length + ' เมนู' + (role !== 'owner' ? ' + หน้าปฏิเสธสิทธิ์' : '')
      })
    }

    await record(width + '/สถานีและเครื่อง', async () => {
      api.reset()
      await goto('production', '#/board')
      await waitText('ทุกสถานี')
      const numbers = await ev(() => [...document.querySelectorAll('[aria-label="เลือกสถานี"] button span span')]
        .map(el => Number(el.textContent)).filter(Number.isInteger))
      assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7])
      for (const [index, station] of stations.entries()) {
        await waitFor(() => ev(n => {
          const el = [...document.querySelectorAll('[aria-label="เลือกสถานี"] button')].find(b => b.querySelector('span span')?.textContent === String(n))
          if (!el) return false
          el.click()
          return true
        }, index + 1), 'สถานี ' + station.code)
        await waitText('สถานีที่ ' + (index + 1) + ' จาก 7')
        await waitText(stationNames[index])
        await inspect(width)
        const badge = { print: '2/2', press: '0/1', cut: '0/2', dtf_press: '2/2', qc_pack: '0/1' }[station.code]
        if (badge) await waitText('เครื่อง ' + badge)
        if (station.code === 'print') {
          await waitText('เครื่องเต็ม 2/2 (TEST-R9-PRINT-A, TEST-R9-PRINT-B)')
          assert.equal(await ev(() => [...document.querySelectorAll('button')].some(el => el.getClientRects().length && /^เริ่มพิมพ์/.test(el.textContent.trim()))), false)
          await screenshot('station-print-' + width)
        }
        if (station.code === 'press') {
          assert.ok(await ev(() => [...document.querySelectorAll('button')].some(el =>
            el.getClientRects().length && !el.disabled && /^เริ่มรีด/.test(el.textContent.trim()))))
        }
      }
      assert.deepEqual(api.rpcCalls, [])
      return 'แถบ 1–7 · พิมพ์ 2/2 · รีด 0/1 · รีดฟิล์ม 2/2'
    })

    await record(width + '/เลือกและจัดการจักร', async () => {
      api.reset()
      await goto('production', '#/board')
      await button('จักรเย็บ')
      await button('เริ่มเย็บ')
      const pick = (code, parent = 'body') => waitFor(() => ev((name, selector) => {
        const el = [...document.querySelectorAll(selector + ' button[aria-pressed]')].find(b =>
          b.getClientRects().length && b.firstElementChild?.textContent === name)
        if (!el) return null
        return { pressed: el.getAttribute('aria-pressed') === 'true', disabled: el.disabled, label: el.lastElementChild.textContent }
      }, code, parent), code)
      const toggle = (code, suffix, parent) => button(code + suffix, parent)
      assert.equal((await pick('SN-001')).pressed, true)
      for (const code of ['SN-004', 'SN-005', 'SN-006']) assert.equal((await pick(code)).disabled, true, code)
      await toggle('SN-001', '✓ เลือก')
      const short = 'เลือกเข็มเดี่ยว 0/1 ตัว'
      await waitText(short)
      assert.equal(await ev(s => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === s)?.disabled, short), true)
      assert.deepEqual(api.rpcCalls, [])
      await toggle('SN-002', 'ว่าง')
      await inspect(width)
      if (width === 375) await screenshot('sewing-pick-375')
      await button('เริ่มเย็บด้วย SN-002')
      await waitText('เริ่มเย็บ TEST-R9-SEW แล้ว')
      await waitFor(() => ev(() => [...document.querySelectorAll('li,article')].some(el =>
        el.innerText.includes('TEST-R9-SEW') && !el.innerText.includes('TEST-R9-SEW-OTHER') &&
        [...el.querySelectorAll('button')].some(b => b.textContent.trim() === 'จัดการจักร'))), 'งานเริ่มเย็บ')
      const dialog = '[role="dialog"]'
      const opened = await ev(() => {
        const row = [...document.querySelectorAll('li,article')].find(el => el.innerText.includes('TEST-R9-SEW')
          && !el.innerText.includes('TEST-R9-SEW-OTHER') && [...el.querySelectorAll('button')].some(b => b.textContent.trim() === 'จัดการจักร'))
        const el = [...(row?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'จัดการจักร')
        el?.click()
        return Boolean(el)
      })
      assert.equal(opened, true)
      await waitText('จัดการจักร TEST-R9-SEW')
      await toggle('SN-003', 'ว่าง', dialog)
      await waitFor(async () => {
        const tile = await pick('SN-003', dialog)
        return tile.pressed && !tile.disabled
      }, 'จ่าย SN-003')
      await inspect(width)
      if (width === 768) await screenshot('sewing-manage-768')
      await toggle('SN-003', 'ของงานนี้', dialog)
      await waitFor(async () => !(await pick('SN-003', dialog)).pressed, 'คืน SN-003')
      assert.deepEqual(api.rpcCalls, [
        { name: 'start_sewing', args: { p_job: sewId, p_codes: ['SN-002'] }, role: 'production' },
        { name: 'assign_machines', args: { p_job: sewId, p_machine_codes: ['SN-003'] }, role: 'production' },
        { name: 'release_machines', args: { p_job: sewId, p_machine_codes: ['SN-003'] }, role: 'production' },
      ])
      return 'ตรวจ body ของ RPC 3 รายการ'
    })

    await record(width + '/ใบปะงานและ QR', async () => {
      await goto('qc', '#/label?id=' + labelId)
      await waitText('TEST-R9-LABEL')
      for (const text of ['ลูกค้าจำลองรอบ 9', 'เสื้อจำลองทดสอบ', 'เสื้อยืด', '10 ตัว', 'พิมพ์และปัก']) await waitText(text)
      assert.equal(await ev(() => document.querySelector('.job-label-sheet tbody').rows.length), 6)
      await inspect(width)
      await screenshot('label-' + width)
      if (width !== 1440) return
      const qrFile = join(temp, 'qr.png')
      const qr = await ev(async () => {
        const original = document.querySelector('.job-label-qr')
        const svg = original.cloneNode(true)
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        svg.setAttribute('width', '520')
        svg.setAttribute('height', '520')
        const image = new Image()
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        canvas.getContext('2d').drawImage(image, 0, 0)
        return canvas.toDataURL().split(',')[1]
      })
      await writeFile(qrFile, Buffer.from(qr, 'base64'))
      const url = execFileSync(process.env.QA_PYTHON ?? 'python', ['-c',
        'import cv2, numpy as np, pathlib, sys; print(cv2.QRCodeDetector().detectAndDecode(cv2.imdecode(np.frombuffer(pathlib.Path(sys.argv[1]).read_bytes(), dtype=np.uint8), 0))[0])', qrFile], { encoding: 'utf8' }).trim()
      assert.equal(url, 'https://pp142.pages.dev/#/board?job=' + labelId)
      const pdf = join(temp, 'label.pdf')
      const print = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true })
      await writeFile(pdf, Buffer.from(print.data, 'base64'))
      const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })
      assert.match(info, /^Pages:\s+1\s*$/m)
      const [, ptsWide, ptsHigh] = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/)
      assert.ok(Math.abs(Number(ptsWide) * 25.4 / 72 - 148) < 0.5)
      assert.ok(Math.abs(Number(ptsHigh) * 25.4 / 72 - 210) < 0.5)
      const png = join(temp, 'label-print')
      execFileSync('pdftoppm', ['-singlefile', '-scale-to', '1000', '-png', pdf, png])
      await writeFile(new URL('r9-cx-label-print.png', evidence), await readFile(png + '.png'))

      await goto('qc', new URL(url).hash)
      const opened = await waitFor(() => ev(() => document.querySelector('[role="dialog"]')?.innerText), 'รายละเอียดงานจาก QR')
      assert.match(opened, /TEST-R9-LABEL/)
      assert.match(opened, /ลูกค้าจำลองรอบ 9/)
      await inspect(width)
      await screenshot('qr-job-1440')
      return 'ถอด QR แล้วเปิดงานรหัสเดียวกันบน loopback · PDF ' + ptsWide + ' × ' + ptsHigh + ' pt หน้าเดียว'
    })
  }
  await record('BUG: หัวคอลัมน์กำลังทำรวมงานพัก', async () => {
    api.reset()
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: false })
    await goto('production', '#/board?station=print')
    await waitText('เครื่อง 2/2')
    await screenshot('bug-working-count-375')
    const working = await ev(() => document.querySelector('#q-working').textContent)
    assert.match(working, /กำลังทำ\s+2 งาน/)
  })
} finally {
  await browser?.close()
  api.server.closeAllConnections()
  await new Promise(resolve => api.server.close(resolve))
  await rm(temp, { recursive: true, force: true })
  const failures = results.filter(item => !item.pass)
  console.log(JSON.stringify({ passed: results.length - failures.length, failed: failures.length, failures }))
  if (failures.length) process.exitCode = 1
}
