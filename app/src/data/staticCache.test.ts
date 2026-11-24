import { expect, it } from 'vitest'
import { createStaticCache, invalidateStatic } from './staticCache'

function counter() {
  let n = 0
  return { load: () => Promise.resolve(++n), calls: () => n }
}

it('จำค่าไว้จนครบอายุ แล้วโหลดใหม่', async () => {
  let now = 0
  const c = counter()
  const cache = createStaticCache(c.load, 1000, () => now)
  expect(await cache.get()).toBe(1)
  now = 999
  expect(await cache.get()).toBe(1)
  now = 1000
  expect(await cache.get()).toBe(2)
  expect(c.calls()).toBe(2)
})

it('เรียกพร้อมกันหลายที่ = โหลดครั้งเดียว', async () => {
  const c = counter()
  const cache = createStaticCache(c.load)
  expect(await Promise.all([cache.get(), cache.get(), cache.get()])).toEqual([1, 1, 1])
  expect(c.calls()).toBe(1)
})

it('บันทึกตั้งค่าแล้วล้าง = ครั้งถัดไปโหลดใหม่ทุกตาราง', async () => {
  const a = counter()
  const b = counter()
  const first = createStaticCache(a.load)
  const second = createStaticCache(b.load)
  await first.get()
  await second.get()
  invalidateStatic()
  expect(await first.get()).toBe(2)
  expect(await second.get()).toBe(2)
})

it('โหลดไม่สำเร็จไม่ถูกจำ · ครั้งถัดไปลองใหม่', async () => {
  let fail = true
  const cache = createStaticCache(() => fail ? Promise.reject(new Error('x')) : Promise.resolve('ok'))
  await expect(cache.get()).rejects.toThrow('x')
  fail = false
  expect(await cache.get()).toBe('ok')
})

it('ล้างระหว่างที่กำลังโหลด = ไม่เก็บผลรอบเก่า', async () => {
  let release: (v: string) => void = () => {}
  let n = 0
  const cache = createStaticCache(() => { n++; return n === 1 ? new Promise<string>(r => { release = r }) : Promise.resolve('ใหม่') })
  const old = cache.get()
  cache.invalidate()
  release('เก่า')
  expect(await old).toBe('เก่า')
  expect(await cache.get()).toBe('ใหม่')
  expect(n).toBe(2)
})
