import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'
import { createFixtures } from './fixtures.mjs'

const outDir = process.argv[2]
if (!outDir) { console.error('ใส่โฟลเดอร์ผลลัพธ์ (นอก repo) เช่น node tools/qa-r14/confirmation-all.mjs $env:TEMP/confirm'); process.exit(1) }
const only = process.argv[3]?.split(',')
await mkdir(outDir, { recursive: true })
const stack = await startLocalStack()
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const report = []
try {
  const t = chrome.wrap(chrome.main)
  const fixtures = await createFixtures(t)
  await t.goto('admin1', '', 1440, '/confirmation')
  await t.waitText('ใบยืนยันการผลิต')
  const keys = only ?? await t.ev(() => Object.keys(PRODUCTS))
  for (const key of keys) {
    try {
      await t.ev(k => {
        if (document.body.classList.contains('preview')) togglePreview(false)
        state = fresh(); state.pickOpen = false; state.product = k
        Object.assign(state.h, { doc_no: 'SC69' + String(Math.floor(Math.random() * 9000) + 1000), job_name: 'งานตัวอย่าง ' + PRODUCTS[k].name, admin: 'น้ำ',
          sample: 'ไม่ขึ้นตัวอย่าง', due_date: '2026-12-15', customer: 'บริษัท ตัวอย่าง จำกัด', contact: 'คุณตัวอย่าง', phone: '080-000-0000' })
        const fillText = f => f.type === 'date' ? '2026-12-01' : f.type === 'textarea' ? 'รายละเอียดตัวอย่างสำหรับ ' + f.label : 'ตัวอย่าง'
        for (let pass = 0; pass < 5; pass++) {
          layout().filter(sec => sec.fields).forEach(sec => {
            const v = scope(sec.s)
            sec.fields.forEach(f => {
              if (!visible(f, v) || f.type === 'images') return
              const val = v[f.id]
              switch (f.type) {
                case 'text': case 'date': case 'textarea': if (!String(val ?? '').trim()) v[f.id] = fillText(f); break
                case 'number': if (!(num(val) > 0)) v[f.id] = f.id === 'rev' ? '' : 5; break
                case 'radio': if (!val) v[f.id] = f.options[0]; break
                case 'check': if (!(val || []).length) v[f.id] = [f.options[0]]; break
                case 'dims': f.parts.forEach((p, i) => { if (!(num(v[f.id + '_' + i]) > 0)) v[f.id + '_' + i] = 20 + i * 10 }); break
                case 'sizeTable': {
                  const rs = rows(v, f.id), cols = sizeCols(v)
                  if (!rs[0].label) { rs[0].label = 'สีขาว'; cols.slice(0, 4).forEach((c, i) => { rs[0].q[c] = 10 + i * 5 }) }
                  break
                }
                case 'itemTable': {
                  const rs = rows(v, f.id, !!f.none)
                  if (!rs.length || !rs[0][f.cols[0].c]) {
                    const r = {}
                    f.cols.forEach(c => { r[c.c] = c.t === 'select' ? c.options[0] : c.t === 'number' ? 5 : (c.label.includes('ขนาด') ? '10 × 12' : 'ตัวอย่าง') })
                    if (rs.length) Object.assign(rs[0], r); else rs.push(r)
                  }
                  break
                }
                case 'placements': {
                  const on = Object.values(val || {}).filter(x => x.on)
                  if (!on.length) {
                    const o = {}
                    const tech = [].concat(v.print_method || []).filter(m => !/ไม่มีลาย/.test(m))[0] || ''
                    f.positions.slice(0, 2).forEach(p => { o[p] = { on: true, size: '10 × 10', tech } })
                    v[f.id] = o
                  }
                  break
                }
              }
            })
          })
        }
        renderForm()
      }, key)
      await t.uploadFiles('input[type="file"][data-img]', [fixtures.paths.frontPng])
      await t.waitText('ชี้จุดบนภาพแรก')
      await waitFor(() => t.ev(() => {
        const img = document.querySelector('[data-co-img]')
        if (!img?.complete || !img.naturalWidth) return false
        const r = img.getBoundingClientRect()
        img.dispatchEvent(new MouseEvent('click', { clientX: r.x + r.width * 0.3, clientY: r.y + r.height * 0.4, bubbles: true }))
        return true
      }), 'จุด')
      await t.fillInput('[data-co="0"][data-cf="title"]', 'จุดตัวอย่าง')
      await t.fillInput('[data-co="0"][data-cf="body"]', 'รายละเอียดจุดตัวอย่าง')
      const missing = await t.ev(() => validate())
      await t.clickButton('ดูตัวอย่าง PDF')
      await t.waitText('ข้อตกลง')
      const info = await t.ev(() => {
        const d = document.querySelector('#doc')
        const text = d.innerText
        const bad = []
        for (const re of [/undefined/, /NaN/, /\[object/, /\bnull\b/, /ภาพภาพ/, /(\S{2,})\s+\1\s/, /:\s*$/m]) { const m = text.match(re); if (m) bad.push(m[0].slice(0, 40)) }
        const over = [...d.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible' && e.clientWidth > 0).map(e => e.className + ':' + e.textContent.slice(0, 30))
        return { pages: document.querySelector('#pageNote')?.textContent, bad, over: over.slice(0, 5), text }
      })
      const pdf = await t.printPdf('all-' + key)
      await copyFile(pdf.path, join(outDir, `${key}.pdf`))
      await writeFile(join(outDir, `${key}.txt`), info.text)
      report.push({ key, missing, pages: info.pages, bad: info.bad, over: info.over })
      console.log(key, JSON.stringify({ missing, bad: info.bad, over: info.over, pages: info.pages }))
    } catch (e) {
      report.push({ key, error: String(e.message || e) })
      console.log(key, 'ERROR', e.message)
    }
  }
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 1))
} catch (e) {
  console.error('ERR', e)
} finally {
  process.exit(0)
}
