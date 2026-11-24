// ตารางตั้งค่าไม่อยู่ใน Realtime · จำไว้ในแท็บ แล้วโหลดใหม่เมื่อครบอายุ กลับมาที่แท็บ หรือมีการบันทึกตั้งค่าในแท็บนี้
export const STATIC_MAX_AGE_MS = 10 * 60 * 1000

export type StaticCache<T> = { get: () => Promise<T>; invalidate: () => void }

const all = new Set<() => void>()

export function createStaticCache<T>(load: () => Promise<T>, maxAgeMs = STATIC_MAX_AGE_MS, clock: () => number = Date.now): StaticCache<T> {
  let entry: { value: T; at: number } | null = null
  let pending: Promise<T> | null = null
  const invalidate = () => { entry = null; pending = null }
  all.add(invalidate)
  return {
    get() {
      if (entry && clock() - entry.at < maxAgeMs) return Promise.resolve(entry.value)
      if (pending) return pending
      const run: Promise<T> = load().then(value => {
        // ล้างระหว่างโหลด = ผลรอบนี้อาจเก่ากว่าการบันทึก ไม่เก็บ
        if (pending === run) entry = { value, at: clock() }
        return value
      }).finally(() => { if (pending === run) pending = null })
      pending = run
      return run
    },
    invalidate,
  }
}

export function invalidateStatic() {
  for (const clear of all) clear()
}
