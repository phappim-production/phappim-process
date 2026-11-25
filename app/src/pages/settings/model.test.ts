import { describe, expect, it } from 'vitest'
import type { Substep } from '../../data/stationSteps'
import {
  integer, isProtectedStep, moveStep, nextStepKey, readMachineCode, readProfile, readStation,
  type ProfileDraft,
} from './model'

const profile: ProfileDraft = { name: '  เจ้าของ  ', role: 'owner', active: true, section: null }
const req: Substep = { key: 'step_abc', name: 'ตรวจงาน', kind: 'req' }
const opt: Substep = { key: 'tidy', name: 'จัดของ', kind: 'opt' }
const lock: Substep = { key: 'film_received', name: 'ได้รับฟิล์ม', kind: 'lock' }

describe('ค่าตัวเลขในหน้าตั้งค่า', () => {
  it('สูตรจักรใช้ 0 เพื่อเอาช่องออกและไม่รับจำนวนเศษ', () => {
    expect(integer('0', 'จำนวนจักร', 0)).toBe(0)
    expect(() => integer('1.5', 'จำนวนจักร', 0)).toThrow('จำนวนเต็ม')
  })
})

describe('บัญชีผู้ใช้และบทบาท', () => {
  it('เจ้าของแก้ชื่อบัญชีตัวเองได้', () => {
    expect(readProfile(profile, true, 'owner').name).toBe('เจ้าของ')
  })
  it('เจ้าของปิดบัญชีหรือลดบทบาทตัวเองไม่ได้', () => {
    expect(() => readProfile({ ...profile, active: false }, true, 'owner')).toThrow('บัญชี')
    expect(() => readProfile({ ...profile, role: 'manager' }, true, 'owner')).toThrow('บัญชี')
  })
  it('เปลี่ยนบทบาทเดิมเป็นฝ่ายผลิตแล้วส่ง section เป็น null', () => {
    expect(readProfile({ ...profile, role: 'production', section: 2 }, false, 'supervisor').section).toBeNull()
  })
  it('ปรับเฟสผู้ควบคุมงานเดิมได้และไม่สร้างผู้ควบคุมงานใหม่', () => {
    const legacy = { ...profile, role: 'supervisor' as const, section: 2 as const }
    expect(readProfile(legacy, false, 'supervisor').section).toBe(2)
    expect(() => readProfile(legacy, false, null)).toThrow('บัญชีใหม่')
  })
  it('กำหนดบทบาทให้ผู้ใช้ที่ยังไม่มีโปรไฟล์ได้เมื่อชื่อและบทบาทครบ', () => {
    expect(readProfile({ ...profile, role: 'qc' }, false, null).role).toBe('qc')
    expect(() => readProfile({ ...profile, role: '' }, false, null)).toThrow('เลือกบทบาท')
    expect(() => readProfile({ ...profile, name: ' ' }, false, null)).toThrow('ชื่อผู้ใช้')
  })
})

describe('ขั้นย่อยและรหัสจักร', () => {
  it('ใช้ key ใหม่ที่ไม่ซ้ำและมีเฉพาะอักขระที่อนุญาต', () => {
    expect(nextStepKey([req], 'A-B!c')).toBe('step_abc_2')
    expect(nextStepKey([], 'CC65-2')).toMatch(/^[a-z0-9_]+$/)
  })
  it('ขั้นที่ระบบใช้มีทั้ง lock และขั้นที่ระบุด้วย key', () => {
    expect(isProtectedStep(lock)).toBe(true)
    for (const key of ['sew_count', 'first_piece', 'inspect', 'sort_count']) {
      expect(isProtectedStep({ ...req, key })).toBe(true)
    }
    expect(isProtectedStep(req)).toBe(false)
  })
  it('สลับขั้นที่แก้ได้โดยเก็บ key เดิม และข้ามขั้นที่ระบบใช้ไม่ได้', () => {
    const steps = [req, opt, lock]
    expect(moveStep(steps, 0, 1)).toEqual([opt, req, lock])
    expect(moveStep(steps, 1, 1)).toBe(steps)
    expect(moveStep(steps, 2, -1)).toBe(steps)
    expect(moveStep(steps, 0, -1)).toBe(steps)
  })
  it('บันทึกชื่อขั้นโดยคง key และชนิดของขั้นเดิม', () => {
    const changes = { name: ' รีดฟิล์ม ', section: 1 as const, substeps: [{ ...lock, name: ' รับฟิล์มแล้ว ' }], machines: '', machine_pool: ' ' }
    expect(readStation(changes)).toMatchObject({
      name: 'รีดฟิล์ม', substeps: [{ ...lock, name: 'รับฟิล์มแล้ว' }], machines: null, machine_pool: null,
    })
    expect(readStation({ ...changes, machines: ' 2 ', machine_pool: 'heat_press' })).toMatchObject({ machines: 2, machine_pool: 'heat_press' })
    expect(() => readStation({ ...changes, machines: '0' })).toThrow('จำนวนเครื่อง')
    expect(() => readStation({ ...changes, substeps: [{ ...req, name: '' }] })).toThrow('ชื่อขั้นย่อย')
  })
  it('เก็บรหัสจักรตาม prefix ของชนิด และกันรหัสซ้ำ', () => {
    expect(readMachineCode(' sn-12 ', 'SN', new Set())).toBe('SN-012')
    expect(readMachineCode('SN-123', 'SN', new Set())).toBe('SN-123')
    expect(() => readMachineCode('CV-001', 'SN', new Set())).toThrow('ตามชนิด')
    expect(readMachineCode('SN-1', 'SN', new Set())).toBe('SN-001')
    expect(() => readMachineCode('SN-1234', 'SN', new Set())).toThrow('ตามชนิด')
    expect(() => readMachineCode('SN-', 'SN', new Set())).toThrow('ตามชนิด')
    expect(() => readMachineCode('SN-012', 'SN', new Set(['SN-012']))).toThrow('ถูกใช้แล้ว')
    expect(() => readMachineCode('sn-12', 'SN', new Set(['SN-012']))).toThrow('ถูกใช้แล้ว')
  })
})
