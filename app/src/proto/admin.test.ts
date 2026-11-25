import { expect, it } from 'vitest'
import { auditChanges, auditTitle, pendingReviews, roleCounts, type AuditRow } from './admin'

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: 1, at: '2026-11-19T09:00:00Z', by: 'u1', table_name: 'profiles', row_key: 'u2', action: 'update',
  old_row: null, new_row: null, ...over,
})

it('Audit Log: แสดงเฉพาะช่องที่เปลี่ยน · บทบาทเป็นชื่อไทย · ไม่แสดง updated_at', () => {
  const r = row({
    old_row: { user_id: 'u2', name: 'สมชาย', role: 'production', active: true, updated_at: 'a' },
    new_row: { user_id: 'u2', name: 'สมชาย', role: 'staff', active: false, updated_at: 'b' },
  })
  expect(auditChanges(r)).toEqual(['บทบาท: ฝ่ายผลิต → พนักงานสถานี', 'ใช้งาน: ใช่ → ไม่'])
  expect(auditChanges(row({ action: 'insert', new_row: { code: 'x' } }))).toEqual([])
})

it('Audit Log: หัวรายการบอกการกระทำ ตาราง และชื่อ', () => {
  const name = (id: string) => (id === 'u2' ? 'สมชาย' : '?')
  expect(auditTitle(row({ new_row: { user_id: 'u2' } }), name)).toBe('แก้ไขผู้ใช้: สมชาย')
  expect(auditTitle(row({ table_name: 'staff_stations', action: 'insert', row_key: 'u2:cut', new_row: { user_id: 'u2', station_code: 'cut' } }), name))
    .toBe('เพิ่มจับคู่พนักงานกับสถานี: สมชาย · cut')
  expect(auditTitle(row({ table_name: 'reason_codes', action: 'delete', row_key: 'R1', old_row: { code: 'R1', name: 'ผ้าขาด' } }), name))
    .toBe('ลบรหัสสาเหตุ: ผ้าขาด')
  expect(auditTitle(row({ table_name: 'sewing_machines', action: 'insert', row_key: '41', new_row: { id: 41, code: 'SN-099' } }), name))
    .toBe('เพิ่มจักรเย็บ: SN-099')
})

it('Audit Log: ตั้งค่ารูปยืนยันงานเป็นภาษาไทย · เวลาเป็นเวลาไทย ไม่ใช่ ISO', () => {
  const r = row({ table_name: 'station_photo_settings', row_key: 'true',
    old_row: { id: true, enabled_at: null, remind_minutes: 5 }, new_row: { id: true, enabled_at: '2026-11-25T03:56:05.932+00:00', remind_minutes: 15 } })
  expect(auditTitle(r, () => '?')).toBe('แก้ไขระบบรูปยืนยันงาน')
  const changes = auditChanges(r)
  expect(changes[1]).toBe('เตือนเมื่อรอเกิน (นาที): 5 → 15')
  expect(changes[0]).toMatch(/^เปิดใช้เมื่อ: — → 25 พ\.ย\. 2569 10:56 น\.$/)
  expect(changes.join(' ')).not.toMatch(/enabled_at|remind_minutes|T03:56/)
  expect(auditChanges(row({ table_name: 'stations', old_row: { code: 'print', first_piece_check: false }, new_row: { code: 'print', first_piece_check: true } })))
    .toEqual(['รออนุมัติชิ้นแรก: ไม่ → ใช่'])
})

it('รายการรออนุมัติ: ตัดรายการที่ผู้บริหารรับทราบแล้ว · เก่าสุดขึ้นก่อน', () => {
  const items = [
    { kind: 'queue_event' as const, ref: 5, jobId: 'a', at: '2026-11-19T10:00:00Z' },
    { kind: 'delay_report' as const, ref: 5, jobId: 'b', at: '2026-11-19T08:00:00Z' },
    { kind: 'queue_event' as const, ref: 6, jobId: 'c', at: '2026-11-19T09:00:00Z' },
  ]
  expect(pendingReviews(items, [{ kind: 'queue_event', ref_id: 5 }]).map(i => `${i.kind}:${i.ref}`)).toEqual(['delay_report:5', 'queue_event:6'])
})

it('ภาพรวมระบบ: นับผู้ใช้ที่เปิดใช้งานแยกบทบาท ตามลำดับบทบาท', () => {
  expect(roleCounts([
    { role: 'staff', active: true }, { role: 'owner', active: true }, { role: 'staff', active: true },
    { role: 'qc', active: false }, { role: null, active: null },
  ])).toEqual([{ role: 'owner', n: 1 }, { role: 'staff', n: 2 }])
})
