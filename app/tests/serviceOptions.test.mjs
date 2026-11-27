import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('ข้อความตัวเลือกที่กำหนดเส้นทางงานบริการ ตรงกันทั้งฟอร์มใบยืนยัน ฐานข้อมูล และหน้าเว็บ', () => {
  const form = read('../../production-confirmation.html')
  const sql = read('../../supabase/migrations/20261207000000_service_routes.sql')
  const web = read('../src/data/service.ts')
  for (const words of ['พิมพ์แล้วรีดลงผ้าของลูกค้า', 'ลูกค้าส่งฟิล์มมาเอง']) {
    assert.ok(form.includes(`'${words}'`), `ฟอร์มไม่มี ${words}`)
    assert.ok(sql.includes(`'${words}'`), `SQL ไม่มี ${words}`)
    assert.ok(web.includes(`'${words}'`), `หน้าเว็บไม่มี ${words}`)
  }
  for (const id of ['svc_sew', 'svc_print', 'svc_press', 'svc_dtf', 'svc_uvdtf']) assert.ok(form.includes(`PRODUCTS.${id} =`), id)
  const uv = read('../../supabase/migrations/20261213000000_service_uvdtf.sql')
  assert.ok(uv.includes("when 'svc_uvdtf' then 'uvdtf'") && uv.includes("when 'uvdtf' then 'outside'"))
  assert.ok(web.includes("case 'svc_uvdtf': return 'outside'"))
})
