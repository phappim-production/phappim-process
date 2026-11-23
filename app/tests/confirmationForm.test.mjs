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

test('ฟอร์มใบยืนยัน: เปิดใบจากระบบ (takeInbox) เรียกหลังประกาศค่าคงที่ทุกตัว ไม่งั้นสคริปต์หยุดและส่งออก PDF ไม่ได้', () => {
  const js = scripts.find(s => s.includes('function takeInbox'))
  assert.ok(js)
  const call = js.lastIndexOf('\ntakeInbox();')
  assert.ok(call > 0, 'ต้องเรียก takeInbox() ที่ระดับบนสุด')
  assert.doesNotMatch(js.slice(call), /^(const|let|class)\s/m)
  assert.doesNotMatch(js.slice(0, call), /\(function takeInbox/)
})
