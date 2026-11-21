import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHandler, typeOfPath } from '../../workers/files/src/index.js'
import { fakeR2, fileBytes } from '../../workers/files/test/fake-r2.mjs'

const origin = 'http://127.0.0.1:5199'
const env = {
  FILES: fakeR2(), ALLOWED_ORIGINS: origin, SUPABASE_URL: 'http://127.0.0.1:9',
  SUPABASE_ANON_KEY: 'key-fixture', RECORD_SECRET: 'r'.repeat(32), LINK_SECRET: 'l'.repeat(32),
}

test('Worker ปฏิเสธ origin ก่อนติดต่อฐานข้อมูลหรือเขียนไฟล์', async () => {
  let calls = 0
  const handle = createHandler({ fetcher: async () => { calls++; throw new Error('ติดต่อ API โดยไม่คาดหมาย') } })
  const body = fileBytes('application/pdf', 64)
  const request = new Request(origin + '/upload/confirmations/TEST-R13/cafe.pdf', {
    method: 'PUT', body,
    headers: {
      Origin: 'http://127.0.0.1:5188', Authorization: 'Bearer r13-fixture',
      'Content-Type': 'application/pdf', 'Content-Length': String(body.byteLength),
    },
  })
  const response = await handle(request, env)
  assert.equal(response.status, 403)
  assert.equal(calls, 0)
  assert.equal(env.FILES.store.size, 0)
})

test('ชื่อไฟล์เก็บจริงต้องเป็นเลขอ้างอิงและชื่อที่กำหนด', () => {
  assert.equal(typeOfPath('confirmations', 'TEST-R13/cafe.pdf'), 'application/pdf')
  assert.equal(typeOfPath('confirmations', 'TEST-R13/ลูกค้า.pdf'), null)
  assert.equal(typeOfPath('confirmations', 'TEST-R13/cafe file.pdf'), null)
  assert.equal(typeOfPath('confirmations', 'TEST-R13/../cafe.pdf'), null)
})
