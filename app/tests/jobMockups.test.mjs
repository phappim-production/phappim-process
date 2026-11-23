import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardPath, formMockups, specMockups, specVariants } from '../src/data/jobMockups.ts'

test('รูปของงาน: ใช้รายการในสเปก · สเปกรุ่นก่อนใช้ mockup_path รูปเดียว', () => {
  const spec = { mockups: [{ name: 'หน้า', path: 'SC-1/a.jpg' }, { name: '', path: '' }, 'x', { name: 'แดง', path: 'SC-1/b.jpg' }] }
  assert.deepEqual(specMockups(spec, 'SC-1/z.jpg'), [{ name: 'หน้า', path: 'SC-1/a.jpg' }, { name: 'แดง', path: 'SC-1/b.jpg' }])
  assert.deepEqual(specMockups({ h: {} }, 'SC-1/z.jpg'), [{ name: '', path: 'SC-1/z.jpg' }])
  assert.deepEqual(specMockups(null, null), [])
})

test('รูปจากฟอร์ม: แยกรูปเดิมในระบบ (path) กับรูปใหม่ (data) · ไม่ใช่รายการ = ฟอร์มรุ่นเก่า', () => {
  assert.deepEqual(formMockups([{ name: 'ก', path: 'SC-1/a.jpg', data: 'data:x' }, { name: 'ข', data: 'data:image/jpeg;base64,AA' }, null]),
    [{ name: 'ก', path: 'SC-1/a.jpg' }, { name: 'ข', data: 'data:image/jpeg;base64,AA' }, { name: '' }])
  assert.equal(formMockups(undefined), null)
})

test('รูปบนการ์ด = รูปแรก เฉพาะเมื่ออยู่ในโฟลเดอร์ของใบนี้', () => {
  assert.equal(cardPath([{ name: '', path: 'SC-1/a.jpg' }, { name: '', path: 'SC-1/b.jpg' }], 'SC-1'), 'SC-1/a.jpg')
  assert.equal(cardPath([{ name: '', path: 'SC-2/a.jpg' }], 'SC-1'), null)
  assert.equal(cardPath([], 'SC-1'), null)
})

test('แบบในงาน: ตารางแบบของกระเป๋า · เลขรูปเกินจำนวนรูป = ไม่ระบุ · แถวไม่มีจำนวนไม่นับ', () => {
  const spec = { product: 'bag', p: { bag: { items: [
    { name: 'ลาย A', color: 'แดง', img: '2', qty: '30' },
    { name: 'ลาย B', color: '', img: '9', qty: 20 },
    { name: 'ว่าง', qty: '' },
  ] } } }
  assert.deepEqual(specVariants(spec, 2), [
    { name: 'ลาย A', color: 'แดง', sizes: '', qty: 30, img: 2 },
    { name: 'ลาย B', color: '', sizes: '', qty: 20, img: null },
  ])
})

test('แบบในงาน: เสื้อผ้าใช้แถวของตารางไซซ์ พร้อมจำนวนแต่ละไซซ์', () => {
  const spec = { product: 'tshirt', p: { tshirt: { sizes: [
    { label: 'สีขาว', img: '1', q: { S: '10', M: '5', L: '' } },
    { label: 'สีดำ', q: { M: 3 } },
    { label: 'ไม่มีจำนวน', q: {} },
  ] } } }
  assert.deepEqual(specVariants(spec, 1), [
    { name: 'สีขาว', color: '', sizes: 'S 10 · M 5', qty: 15, img: 1 },
    { name: 'สีดำ', color: '', sizes: 'M 3', qty: 3, img: null },
  ])
  assert.deepEqual(specVariants({ product: 'x', p: {} }, 0), [])
})
