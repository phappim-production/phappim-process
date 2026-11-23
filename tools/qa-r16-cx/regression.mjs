import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { auditBundle } from './bundle.mjs'

const [, , suite, output, mode] = process.argv
assert.ok(suite && output, 'ระบุชุดทดสอบและโฟลเดอร์ผล')
const out = resolve(output)
await mkdir(out, { recursive: true })
process.env.QA_IMG_DIR = out
console.log('BUNDLE', await auditBundle())

const r14 = new URL('../qa-r14/', import.meta.url)
const r15 = new URL('../../../pp142-c16/tools/qa-r15/', import.meta.url)
const isR15 = ['browser', 'legacy-a'].includes(suite)
const target = new URL(suite + '.mjs', isR15 ? r15 : r14)
assert.ok(isR15 || ['qa-part-a', 'qa-part-b', 'qa-part-c', 'confirmation-all'].includes(suite))

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(r15.href) && specifier.startsWith('../qa-r14/')) {
      return nextResolve(new URL(specifier.slice(10), r14).href, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if ((suite === 'qa-part-a' || suite === 'legacy-a') && process.env.QA_PORT === '0' && url === new URL('server.mjs', r14).href) {
      const source = result.source.toString()
      const anchor = 'const data = await readFile(fullPath)'
      assert.ok(source.includes(anchor))
      return { ...result, source: source.replace(anchor, "let data = await readFile(fullPath)\n      if (relPath.startsWith('/assets/') && relPath.endsWith('.js')) data = Buffer.from(data.toString().replaceAll('http://127.0.0.1:5214', siteOrigin).replaceAll('http://127.0.0.1:5215', filesOrigin))") }
    }
    if (url !== target.href) return result
    let source = result.source.toString()
    if (suite.startsWith('qa-part-')) {
      source = source.replace(/fileURLToPath\(new URL\('\.\/part-[abc]-results\.json', import\.meta\.url\)\)/, JSON.stringify(resolve(out, 'results.json')))
    }
    if (suite === 'qa-part-a' && mode === 'routes') {
      const ledger = new URL('./route-ledger.mjs', import.meta.url).href
      source = `import { routeLedger } from ${JSON.stringify(ledger)}\nconst checkpoints = []\n` + source
      source = source.replace(/    await runA[1-7]\(ctx\)\r?\n/g, '')
        .replace('    await runA8(ctx)', '    await runA8(ctx)\n    console.log(JSON.stringify(checkpoints))')
      const i = source.indexOf('async function runA8(')
      assert.ok(i > 0)
      const prefix = source.slice(0, i)
      source = prefix + source.slice(i)
        .replace('  await resetStack(stack)', '  await resetStack(stack)\n  const step = routeLedger(stack, checkpoints)')
        .replace('      if ([\'dtf\'', "      await step(id, 'received', row => row.phase === 'production')\n      if (['dtf'")
        .replace("await t.clickButton(/ได้รับ.*แล้ว/)", "await t.clickButton(/ได้รับ.*แล้ว/)\n        await step(id, 'film-received', row => row.phase === 'production')")
        .replace("await t.clickButton('ยืนยันรับของ')", "await t.clickButton('ยืนยันรับของ')\n        await step(id, 'outside-return', row => row.station === 'qc_pack')")
        .replace("await t.clickButton('เย็บเสร็จ'); await t.clickButton('ยืนยันเย็บเสร็จ')", "await step(id, 'sew-start', row => row.station === 'sew' && row.station_status === 'doing')\n            await t.clickButton('เย็บเสร็จ'); await t.clickButton('ยืนยันเย็บเสร็จ')\n            await step(id, 'sew-finish', row => row.station !== 'sew')")
        .replace('await t.clickButton(/^เริ่ม/)', "await t.clickButton(/^(?:\\d+\\.\\s*)?เริ่ม/)\n            await step(id, st + '-start', row => row.station === st && row.station_status === 'doing')")
        .replace("await t.clickButton('ยืนยัน')", "await t.clickButton('ยืนยัน')\n            await step(id, st + '-finish', row => row.station !== st)")
        .replace("await t.clickButton('เริ่ม QC + Packing')", "await t.clickButton('เริ่ม QC + Packing')\n      await step(id, 'qc-start', row => row.station === 'qc_pack' && row.station_status === 'doing')")
        .replace("await t.clickButton('บันทึกผ่าน')", "await t.clickButton('บันทึกผ่าน')\n      await step(id, 'qc-count', row => row.qc_passed === 10)")
        .replace("await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน')", "await t.clickButton('QC + Packing เสร็จ'); await t.clickButton('ยืนยัน')\n      await step(id, 'qc-finish', row => row.phase === 'done')")
        .replace("await t.clickButton('จัดส่งให้ลูกค้าแล้ว'); await t.clickButton('ยืนยัน')", "await t.clickButton('จัดส่งให้ลูกค้าแล้ว'); await t.clickButton('ยืนยัน')\n      await step(id, 'delivered', row => !!row.delivered_at)")
    }
    if (isR15) {
      source = source.replaceAll('../qa-r14/server.mjs', new URL('server.mjs', r14).href)
        .replace("resolve('docs/qa/img')", JSON.stringify(out))
        .replace('../qa-r14/qa-part-a.mjs', new URL('qa-part-a.mjs', r14).href)
    }
        if (suite === 'qa-part-a' && mode === 'routes') {
      source = source.replaceAll("t.clickButton('ยืนยัน')", "t.clickButton('ยืนยัน', { exact: true })")
    }
    if (suite === 'legacy-a') {
      source = source.replace('return { ...original, source }', "return { ...original, source: source.replaceAll(\"t.clickButton('ยืนยัน')\", \"t.clickButton('ยืนยัน', { exact: true })\") }")
    }
if (suite === 'browser' && mode === 'lang') {
      source = source.replace(/location\.hash === next && !!document\.querySelector[^\n]+\n\s+document\.querySelector[^\n]+? > 0/, "location.hash === next && (next === '#/production-queue' ? document.body.innerText.includes('คิวการผลิต') : !!document.querySelector('main,[data-scroll=dashboard]')?.innerText.trim())")
    }
    if (suite === 'confirmation-all' && mode) {
      source = source.replace('const report = []', 'const report = []\nlet fixtures')
        .replace('const fixtures = await', 'fixtures = await')
        .replace("console.error('ERR', e)", 'throw e')
        .replace('process.exit(0)', [
          "await writeFile(join(outDir, 'network.json'), JSON.stringify({ external: chrome.externalAttempts, fontsBlocked: chrome.blockedFontRequests.length }))",
          'await fixtures?.cleanup()',
          'await chrome.close()',
          'await stack.close()',
          "if (chrome.externalAttempts.length || report.some(row => row.error)) process.exitCode = 1",
        ].join('\n'))
      const marker = 'for (let pass = 0; pass < 5; pass++)'
      assert.ok(source.includes(marker))
      const fill = mode === 'full' ? [
        "const v = scope('p')",
        "const ids = () => layout().flatMap(s => s.fields ?? [])",
        "if (ids().some(f => f.id === 'size_chart')) v.size_chart = SIZE_OWN",
        "const sizes = ids().find(f => f.id === 'measure_rows' && visible(f, v))",
        "if (sizes) v.measure_rows = [Object.fromEntries(sizes.cols.map(c => [c.c, c.c === 'size' ? 'QA-S' : c.c === 'other' ? 'QA-MEASURE' : '24.5']))]",
        "const pocket = ids().find(f => f.type === 'itemTable' && f.cols.some(c => c.c === 'piping'))",
        "if (pocket) v[pocket.id] = [Object.fromEntries(pocket.cols.map(c => [c.c, c.std ?? (c.t === 'select' ? c.options[c.c === 'piping' ? 1 : 0] : 'QA-POCKET')]))]",
        "const binding = ids().find(f => f.id === 'binding')",
        "if (binding) { v.binding = binding.options.slice(0, 2); v.binding_color = 'QA-BINDING สีกรม 2 ซม.' }",
      ] : []
      source = source.replace(marker, fill.join('\n') + '\n' + marker)
      if (mode === 'minimum') {
        source = source.replace(marker, "for (let pass = 0; pass < 0; pass++)")
          .replace("await t.uploadFiles('input[type=\"file\"][data-img]'", "if (false) { await t.uploadFiles('input[type=\"file\"][data-img]'")
          .replace('const missing = await', '} const missing = await')
          .replace("sample: 'ไม่ขึ้นตัวอย่าง', due_date: '2026-12-15', customer: 'บริษัท ตัวอย่าง จำกัด', contact: 'คุณตัวอย่าง', phone: '080-000-0000'", "customer: 'ลูกค้าจำลอง'")
      }
    }
    return { ...result, source }
  },
})
process.argv = [process.argv[0], target.pathname, out, ...(isR15 && mode ? [mode] : [])]
try {
  await import(target.href)
} finally {
  hook.deregister()
}
