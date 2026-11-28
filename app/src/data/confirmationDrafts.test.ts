import { describe, expect, it } from 'vitest'
import { OUTBOX_KEY, TAKEN_KEY, asNewDraft, recentlyTaken, takeOutbox } from './confirmationDrafts'

function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('ฟอร์มบันทึกเข้าระบบ เปิด 2 แท็บ (QA รอบ 5 G7 บั๊ก 1)', () => {
  const now = 1_800_000_000_000
  const sent = () => memory({ [OUTBOX_KEY]: JSON.stringify({ h: { doc_no: 'SC-9' } }) })

  it('แท็บแรกหยิบใบได้และจดไว้ · แท็บที่สองไม่เจอใบแต่รู้ว่าบันทึกในอีกแท็บ', () => {
    const store = sent()
    expect(takeOutbox(store, now)?.no).toBe('SC-9')
    expect(takeOutbox(store, now + 500)).toBeNull()
    expect(recentlyTaken(store, now + 500)).toBe('SC-9')
  })

  it('เกิน 2 นาที ถือว่าไม่ใช่การกดครั้งนี้ (ให้ขึ้นว่าไม่พบใบตามเดิม)', () => {
    const store = sent()
    takeOutbox(store, now)
    expect(recentlyTaken(store, now + 2 * 60 * 1000)).toBeNull()
  })

  it('ไม่มีใบหรือข้อมูลเสีย ไม่จดว่าหยิบแล้ว', () => {
    const empty = memory()
    expect(takeOutbox(empty, now)).toBeNull()
    expect(recentlyTaken(empty, now)).toBeNull()
    const bad = memory({ [OUTBOX_KEY]: '{"h":{}}', [TAKEN_KEY]: 'x' })
    expect(takeOutbox(bad, now)).toBeNull()
    expect(recentlyTaken(bad, now)).toBeNull()
  })
})

describe('ใบแก้ของงานที่ถูกยกเลิกแล้ว', () => {
  it('บันทึกเป็นใบใหม่เลขเดิม: เอาส่วนของใบแก้ออก ข้อมูลใบ รูป และครั้งที่แก้อยู่ครบ', () => {
    const sent = {
      h: { doc_no: 'SC-X1', customer: 'ลูกค้า', rev: '1' }, product: 'tshirt', p: { tshirt: { fabric: 'คอตตอน' } },
      mockups: [{ name: 'รูป 1', path: 'SC-X1/a.jpg' }], mockup_path: 'SC-X1/a.jpg',
      revise_job: true, changes: ['ผ้า'], base_rev: 0, base_token: 'tok', from_job: true,
    }
    const fresh = asNewDraft(sent)
    expect(fresh).toEqual({
      h: { doc_no: 'SC-X1', customer: 'ลูกค้า', rev: '1' }, product: 'tshirt', p: { tshirt: { fabric: 'คอตตอน' } },
      mockups: [{ name: 'รูป 1', path: 'SC-X1/a.jpg' }], mockup_path: 'SC-X1/a.jpg',
    })
    expect(sent.revise_job).toBe(true)
  })
})
