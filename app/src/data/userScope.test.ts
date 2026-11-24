import { expect, it } from 'vitest'
import { onUserChange, userChanged } from './userScope'

it('ล้างข้อมูลที่จำไว้เมื่อออกจากระบบหรือสลับบัญชี · บัญชีเดิมต่ออายุไม่ล้าง', () => {
  let cleared = 0
  onUserChange(() => { cleared++ })
  expect(userChanged('a')).toBe(false)
  expect(userChanged('a')).toBe(false)
  expect(cleared).toBe(0)
  expect(userChanged('b')).toBe(true)
  expect(cleared).toBe(1)
  expect(userChanged(null)).toBe(true)
  expect(cleared).toBe(2)
  expect(userChanged('a')).toBe(false)
})
