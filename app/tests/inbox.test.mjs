import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterInbox, groupByDay, kindLabel, kindTone, relativeTime, unreadBadge } from '../src/pages/inbox/format.ts'

const item = (over = {}) => ({
  id: 1,
  kind: 'hold',
  jobId: 'job-1',
  title: 'งานติดปัญหา SC1',
  body: 'ลูกค้า · เสื้อ 100 ตัว',
  createdAt: new Date('2026-11-17T03:00:00Z'), // 10:00 เวลาไทย
  read: false,
  ...over,
})

test('สีตามความหมาย: แดงสำหรับเร่งด่วน/ติดปัญหา · ส้มสำหรับเตือน/รอ', () => {
  for (const k of ['hold', 'sla_over', 'film_late', 'rework', 'machine_broken', 'sample_failed']) {
    assert.equal(kindTone(k), 'danger', k)
  }
  for (const k of ['due_soon', 'materials_late', 'delay_report', 'sewing_issue']) {
    assert.equal(kindTone(k), 'warn', k)
  }
})

test('ป้ายชื่อหมวดหมู่เป็นภาษาไทยทั้งหมด', () => {
  assert.equal(kindLabel('hold'), 'พักงาน')
  assert.equal(kindLabel('machine_broken'), 'จักรเสีย')
  assert.equal(kindLabel('due_soon'), 'ใกล้กำหนดส่ง')
})

test('ข้อความเวลาสัมพัทธ์ภาษาไทยตามเวลาไทย', () => {
  const now = new Date('2026-11-17T03:05:00Z') // 10:05 เวลาไทย
  assert.equal(relativeTime(new Date('2026-11-17T03:04:40Z'), now), 'เมื่อสักครู่')
  assert.equal(relativeTime(new Date('2026-11-17T03:00:00Z'), now), '5 นาทีก่อน')
  assert.equal(relativeTime(new Date('2026-11-17T01:05:00Z'), now), '2 ชม.ก่อน')
  assert.equal(relativeTime(new Date('2026-11-16T08:30:00Z'), now), 'เมื่อวาน 15:30')
  assert.match(relativeTime(new Date('2026-11-10T02:00:00Z'), now), /09:00$/)
})

test('กรองยังไม่อ่าน/ทั้งหมด และเรียงใหม่สุดก่อน', () => {
  const items = [
    item({ id: 1, createdAt: new Date('2026-11-17T01:00:00Z'), read: false }),
    item({ id: 2, createdAt: new Date('2026-11-17T03:00:00Z'), read: true }),
    item({ id: 3, createdAt: new Date('2026-11-17T02:00:00Z'), read: false }),
  ]
  assert.deepEqual(filterInbox(items, 'all').map(i => i.id), [2, 3, 1])
  assert.deepEqual(filterInbox(items, 'unread').map(i => i.id), [3, 1])
})

test('จัดกลุ่ม วันนี้ / เมื่อวาน / ก่อนหน้า ตามวันเวลาไทย', () => {
  const now = new Date('2026-11-17T03:05:00Z') // 2026-11-17 10:05 เวลาไทย
  const items = [
    // 2026-11-17 00:30 เวลาไทย (17:30 UTC ของวันที่ 16) -> ต้องเป็น "วันนี้"
    item({ id: 1, createdAt: new Date('2026-11-16T17:30:00Z') }),
    // 2026-11-16 23:00 เวลาไทย (16:00 UTC ของวันที่ 16) -> ต้องเป็น "เมื่อวาน"
    item({ id: 2, createdAt: new Date('2026-11-16T16:00:00Z') }),
    // 2026-11-15 12:00 เวลาไทย -> "ก่อนหน้า"
    item({ id: 3, createdAt: new Date('2026-11-15T05:00:00Z') }),
  ]
  const groups = groupByDay(items, now)
  assert.deepEqual(groups.map(g => [g.label, g.items.map(i => i.id)]), [
    ['วันนี้', [1]],
    ['เมื่อวาน', [2]],
    ['ก่อนหน้า', [3]],
  ])
})

test('ตัวเลขบนกระดิ่ง: ซ่อนเมื่อ 0 · เกิน 99 แสดง 99+', () => {
  assert.equal(unreadBadge(0), null)
  assert.equal(unreadBadge(-1), null)
  assert.equal(unreadBadge(5), '5')
  assert.equal(unreadBadge(99), '99')
  assert.equal(unreadBadge(100), '99+')
})
