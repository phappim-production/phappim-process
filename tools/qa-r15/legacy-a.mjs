import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const output = pathToFileURL(resolve(process.argv[2], 'part-a-adapted.json')).href
const legacy = new URL('../qa-r14/qa-part-a.mjs', import.meta.url)
const hook = registerHooks({
  load(url, context, nextLoad) {
    const original = nextLoad(url, context)
    if (url !== legacy.href) return original
    const source = original.source.toString()
      .replace("new URL('./part-a-results.json', import.meta.url)", 'new URL(' + JSON.stringify(output) + ')')
      .replaceAll(/'((?:กำลังทำ|คิวรอเริ่ม)) (\d) งาน'/g, '/$1\\s+$2 งาน/')
      .replace("t.clickButton(/^เริ่ม/)", "t.clickButton(/^(?:\\d+\\.\\s*)?เริ่ม/)")
    return { ...original, source }
  },
})
try {
  await import(legacy.href)
} finally {
  hook.deregister()
}
