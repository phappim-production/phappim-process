import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { localStack } from './local.mjs'

assert.ok(process.argv[2], 'ระบุโฟลเดอร์ผลนอก repo')
const out = resolve(process.argv[2])
await mkdir(out, { recursive: true })
process.env.QA_IMG_DIR = out
const stack = await localStack()
const { openChrome, waitFor } = await import('../qa-r14/chrome.mjs')
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const t = chrome.wrap(chrome.main)
const findings = {}
const header = { doc_no: 'TEST-R16-FORM', customer: 'ลูกค้าจำลอง C17' }

async function check(key, fn) {
  try {
    findings[key] = { ok: true, detail: await fn() }
    console.log('PASS', key, JSON.stringify(findings[key].detail))
  } catch (e) {
    findings[key] = { ok: false, error: String(e.stack) }
    console.log('FAIL', key, e.message)
  }
}

async function start(product, values) {
  await t.goto('admin1', '', 768, '/confirmation')
  await t.waitText('ใบยืนยันการผลิต')
  await t.ev((h, k, p) => {
    state = fresh()
    state.h = { ...state.h, ...h }
    state.pickOpen = false
    state.product = k
    Object.assign(scope('p'), p)
    rerender()
  }, header, product, values)
}

async function doc() {
  return t.ev(() => {
    renderDoc()
    return { text: document.querySelector('#doc').innerText, scripts: document.querySelectorAll('#doc script').length }
  })
}

async function evidence(key) {
  const screen = await t.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(resolve(out, 'r16-cx-' + key + '.png'), Buffer.from(screen.data, 'base64'))
  await t.ev(() => togglePreview(true))
  const pdf = await t.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
  await writeFile(resolve(out, 'r16-cx-' + key + '.pdf'), Buffer.from(pdf.data, 'base64'))
}

try {
  await check('A5 legacy JSON and saved draft', async () => {
    const results = []
    for (const key of ['elephant', 'muaythai', 'pajama', 'scrub', 'jersey']) {
      const input = resolve(out, 'legacy-' + key + '.json')
      const oldSize = { size: 'QA-OLD', chest: '37.125', length: '42.25', sleeve: '19.75' }
      await start(key, {})
      const { sizeChart, pocket } = await t.ev(k => {
        state.product = k
        return { sizeChart: SIZE_OWN, pocket: layout().flatMap(s => s.fields ?? []).find(f => f.cols?.some(c => c.c === 'piping')) }
      }, key)
      const p = { size_chart: sizeChart, measure_rows: [oldSize] }
      if (pocket) p[pocket.id] = [Object.fromEntries(pocket.cols.filter(c => c.c !== 'piping').map(c => [c.c, c.t === 'select' ? c.options[0] : 'QA-OLD-POCKET']))]
      await writeFile(input, JSON.stringify({ app: 'phappim-confirm', v: 1, product: key, h: header, p: { [key]: p } }))
      await start(key, {})
      await t.uploadFiles('#openFile', [input])
      await waitFor(() => t.ev(() => scope('p').measure_rows?.[0]?.size === 'QA-OLD'), 'เปิด JSON เก่า')
      const form = await t.ev(() => [...document.querySelectorAll('input[data-t="measure_rows"]')].map(x => [x.dataset.c, x.value]))
      const printable = (await doc()).text
      const retained = await t.ev(() => scope('p').measure_rows[0])
      assert.deepEqual(retained, oldSize)
      await t.goto('admin1', '', 768, '/confirmation')
      await waitFor(() => t.ev(() => scope('p').measure_rows?.[0]?.size === 'QA-OLD'), 'กู้ใบร่างเดิม')
      const draftText = (await doc()).text
      const missing = Object.values(oldSize).filter(value => !printable.includes(value))
      results.push({ key, form, missing, draftMissing: Object.values(oldSize).filter(value => !draftText.includes(value)),
        pocketShown: pocket ? printable.includes('QA-OLD-POCKET') : null })
      if (key === 'elephant' || key === 'muaythai') await evidence('legacy-' + key)
    }
    return results
  })
  await check('A2 piping and standard across products', async () => {
    const products = await t.ev(() => Object.keys(PRODUCTS))
    const hits = []
    for (const key of products) {
      await start(key, {})
      const tables = await t.ev(() => layout().flatMap(s => s.fields ?? []).filter(f => f.cols?.some(c => c.c === 'piping')).map(f => {
        const p = scope('p')
        p.sew_mode = SEW_CUSTOM
        p[f.id] = [Object.fromEntries(f.cols.map(c => [c.c, c.t === 'select' ? c.options[0] : 'QA-POCKET']))]
        return f.id
      }))
      if (!tables.length) continue
      await t.ev(() => rerender())
      for (const id of tables) {
        const result = await t.ev(k => {
          const selector = '[data-t="' + k + '"][data-r="0"]'
          const direct = suffix => document.querySelector(selector + suffix)
          const checkbox = direct('[data-std]')
          if (!checkbox) return { hidden: true }
          checkbox.click()
          const on = direct('[data-std]')?.checked && !direct('[data-c="size"][type="text"]')
          const select = direct('[data-c="piping"]')
          select.value = 'กุ๊นปากกระเป๋า'
          select.dispatchEvent(new Event('input', { bubbles: true }))
          renderDoc()
          const text = document.querySelector('#doc').innerText
          direct('[data-std]').click()
          const off = direct('[data-c="size"][type="text"]')?.value === ''
          const clear = direct('[data-c="piping"]')
          clear.value = 'ไม่มีกุ๊น'
          clear.dispatchEvent(new Event('input', { bubbles: true }))
          renderDoc()
          return { on, off, printed: text.includes('กุ๊นปากกระเป๋า') && text.includes('ขนาดมาตรฐาน'),
            nonePrinted: document.querySelector('#doc').innerText.includes('ไม่มีกุ๊น') }
        }, id)
        hits.push({ key, id, ...result })
      }
    }
    return hits
  })
  await check('A3 columns and factory chart', async () => {
    const results = []
    for (const key of ['elephant', 'muaythai', 'pajama', 'scrub', 'jersey']) {
      await start(key, {})
      const result = await t.ev(() => {
        const v = scope('p')
        const f = layout().flatMap(s => s.fields ?? []).find(f => f.id === 'sizes')
        const sizeSet = layout().flatMap(s => s.fields ?? []).find(f => f.id === 'size_sets')
        if (sizeSet.options.includes('FS / PS')) v.size_sets = ['FS / PS']
        const modes = [SIZE_STD, 'ตารางไซซ์ของลูกค้า (แนบมา)', SIZE_OWN].map(chart => {
          v.size_chart = chart
          rerender()
          renderDoc()
          const def = layout().flatMap(s => s.fields ?? []).find(f => f.id === 'measure_rows' && visible(f, v))
          if (def) {
            v.measure_rows = [Object.fromEntries(def.cols.map(c => [c.c, c.c === 'size' ? 'QA-S' : '26.75']))]
            rerender()
            renderDoc()
          }
          return { chart, cols: def?.cols.map(c => c.c), required: def?.cols.filter(c => !c.opt).map(c => c.c),
            factoryChart: sizeChart(f, v).length, pdfText: document.querySelector('#doc').innerText.includes('รอบอก') }
        })
        return modes
      })
      results.push({ key, modes: result })
    }
    return results
  })
  await check('A4 bindings and B5 unusual input', async () => {
    const products = await t.ev(() => Object.keys(PRODUCTS).filter(k => PRODUCTS[k].name.includes('ถุง')))
    const results = []
    for (const key of products) {
      await start(key, {})
      const hit = await t.ev(() => {
        const v = scope('p')
        const fields = layout().flatMap(s => s.fields ?? [])
        const binding = fields.find(f => f.id === 'binding')
        if (!binding) return null
        const color = fields.find(f => f.id === 'binding_color')
        const handle = fields.find(f => f.id === 'handle_mat')
        v.sew_mode = SEW_STD
        v.binding = binding.options.slice(0, 2)
        v.binding_color = 'QA -2.5 2.75 😀\tExcel <script type="application/json">QA</script> ' + 'X'.repeat(500)
        rerender()
        renderDoc()
        const d = document.querySelector('#doc')
        return { visible: visible(binding, v) && visible(color, v), choices: binding.options, handle: handle?.options,
          printed: v.binding.every(choice => d.innerText.includes(choice)),
          literal: d.innerText.includes('<script') && d.innerText.includes('Excel') && d.innerText.includes('😀'),
          scripts: d.querySelectorAll('script').length }
      })
      if (hit) {
        await evidence('binding-' + key)
        results.push({ key, ...hit })
      }
    }
    return results
  })
  await check('B5 numeric and literal text fields', async () => {
    const observations = []
    for (const [key, fields] of [['elephant', ['waist', 'hip', 'leg']], ['pajama', ['chest', 'length', 'sleeve', 'waist', 'hip', 'leg']]]) {
      await start(key, {})
      await t.ev(() => {
        const p = scope('p')
        p.size_chart = SIZE_OWN
        p.measure_rows = [{ size: 'QA-S' }]
        rerender()
      })
      const values = ['-2.5', '2.75', 'Excel\t😀 <script>QA</script> ' + 'Z'.repeat(500)]
      for (const [index, field] of fields.entries()) {
        await t.fillInput('input[data-t="measure_rows"][data-c="' + field + '"]', values[index % values.length])
      }
      const data = await doc()
      observations.push({ key, fields, retained: values.slice(0, 2).every(value => data.text.includes(value)),
        literal: data.text.includes('<script>QA</script>'), scripts: data.scripts })
    }
    await start('elephant', {})
    await t.ev(() => {
      const p = scope('p')
      p.size_chart = SIZE_OWN
      p.measure_rows = [{ size: 'QA-S', waist: '-2.5', hip: '2.75', leg: '20' }]
      rerender()
      window.print = () => { window.qaPrinted = true }
    })
    await t.clickButton('ส่งออก PDF')
    await waitFor(() => t.ev(() => window.qaPrinted), 'พิมพ์ค่าติดลบผ่านกล่องเตือน')
    await evidence('negative-pants')
    return observations
  })
} finally {
  const external = chrome.externalAttempts
  await writeFile(resolve(out, 'form.json'), JSON.stringify({ findings, external, logs: chrome.main.logs }, null, 2))
  await chrome.close()
  await stack.close()
  assert.deepEqual(external, [])
  if (Object.values(findings).some(result => !result.ok)) process.exitCode = 1
}
