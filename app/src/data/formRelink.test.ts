import { expect, it } from 'vitest'
import { parseRelink } from './formRelink'

it('คำขอลิงก์รูปใหม่จากฟอร์ม: รับเฉพาะ path รูปที่ถูกรูปแบบ', () => {
  expect(parseRelink(JSON.stringify({ id: 'a1', paths: ['SC-1/m1.jpg', 'SC-1/m1.jpg', 'SC-1/sheet/x.png'] })))
    .toEqual({ id: 'a1', paths: ['SC-1/m1.jpg', 'SC-1/sheet/x.png'] })
})

it('คำขอที่เสีย / มี path แปลก / ว่าง = ไม่ออกลิงก์', () => {
  expect(parseRelink(null)).toBeNull()
  expect(parseRelink('{')).toBeNull()
  expect(parseRelink(JSON.stringify({ id: '', paths: ['a.jpg'] }))).toBeNull()
  expect(parseRelink(JSON.stringify({ id: 'a', paths: [] }))).toBeNull()
  expect(parseRelink(JSON.stringify({ id: 'a', paths: ['../secret.jpg'] }))).toBeNull()
  expect(parseRelink(JSON.stringify({ id: 'a', paths: ['ok.jpg', 'https://x.test/a.jpg'] }))).toBeNull()
  expect(parseRelink(JSON.stringify({ id: 'a', paths: Array.from({ length: 41 }, (_, i) => `SC/${i}.jpg`) }))).toBeNull()
})
