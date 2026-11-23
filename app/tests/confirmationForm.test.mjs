import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Script } from 'node:vm'

const html = readFileSync(new URL('../../production-confirmation.html', import.meta.url), 'utf8')
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])

test('ฟอร์มใบยืนยัน: สคริปต์ทุกก้อนไม่มี syntax error (พังแล้วฟอร์มทั้งหน้าใช้ไม่ได้)', () => {
  assert.ok(scripts.length > 0)
  for (const js of scripts) assert.doesNotThrow(() => new Script(js))
})
