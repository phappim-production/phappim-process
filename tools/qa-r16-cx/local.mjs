import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { auditBundle } from './bundle.mjs'

export async function localStack() {
  console.log('BUNDLE', await auditBundle())
  const url = new URL('../qa-r14/server.mjs', import.meta.url)
  const hook = registerHooks({
    load(specifier, context, nextLoad) {
      const loaded = nextLoad(specifier, context)
      if (specifier !== url.href) return loaded
      const source = loaded.source.toString()
      const marker = 'const data = await readFile(fullPath)'
      assert.ok(source.includes(marker))
      return { ...loaded, source: source.replace(marker, [
        'let data = await readFile(fullPath)',
        "if (relPath.startsWith('/assets/') && relPath.endsWith('.js')) {",
        "  data = Buffer.from(data.toString().replaceAll('http://127.0.0.1:5214', siteOrigin).replaceAll('http://127.0.0.1:5215', filesOrigin))",
        '}',
      ].join('\n')) }
    },
  })
  try {
    const { startLocalStack } = await import(url.href)
    return await startLocalStack({ port: 0, filesPort: 0 })
  } finally {
    hook.deregister()
  }
}
