import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canOpenPage, isEmployeeRole, roleLabel, toSection } from '../src/auth/access.ts'
import { boardScope, homePage, jobInScope } from '../src/auth/scope.ts'
import { newPasswordProblem, passwordChangeErrorMessage, signInErrorMessage } from '../src/auth/messages.ts'

const roles = ['owner', 'supervisor', 'admin', 'qc', 'production', 'manager']

for (const role of roles) {
  test(`เมนูและสิทธิ์เปิดหน้าของ ${role}`, () => {
    assert.equal(isEmployeeRole(role), true)
    for (const page of ['board', 'system']) {
      assert.equal(canOpenPage(role, page), true)
    }
    assert.equal(canOpenPage(role, 'overview'), ['owner', 'admin', 'manager'].includes(role))
    assert.equal(canOpenPage(role, 'reports'), role === 'owner' || role === 'manager')
    assert.equal(canOpenPage(role, 'settings'), role === 'owner')
  })
}

test('บัญชีที่ไม่มีบทบาทหรือบทบาทนอกชุดที่กำหนดเข้าไม่ได้', () => {
  for (const role of [null, undefined, '', 'employee', 'constructor', 'toString']) {
    assert.equal(isEmployeeRole(role), false)
  }
})

test('ข้อความเข้าสู่ระบบไม่สำเร็จเป็นภาษาไทยและบอกสิ่งที่ต้องทำ', () => {
  assert.equal(signInErrorMessage(null), null)
  assert.match(signInErrorMessage({ code: 'invalid_credentials', status: 400 }), /อีเมลหรือรหัสผ่านไม่ถูกต้อง/)
  assert.match(signInErrorMessage({ code: 'over_request_rate_limit', status: 429 }), /รอ 5 นาที/)
  assert.match(signInErrorMessage({ code: 'user_banned', status: 403 }), /ถูกระงับ/)
  // เน็ตหลุดต้องไม่บอกว่ารหัสผิด
  assert.match(signInErrorMessage({ status: 0, name: 'AuthRetryableFetchError' }), /อินเทอร์เน็ต/)
  assert.match(signInErrorMessage({ code: 'something_new', status: 500 }), /ติดต่อเจ้าของระบบ/)
})

test('ตรวจรหัสผ่านใหม่ก่อนส่ง', () => {
  assert.match(newPasswordProblem('1234567', '1234567'), /อย่างน้อย 8/)
  assert.match(newPasswordProblem(' abcdefgh', ' abcdefgh'), /ช่องว่าง/)
  assert.match(newPasswordProblem('abcd1234', 'abcd1235'), /ไม่ตรงกัน/)
  assert.equal(newPasswordProblem('abcd1234', 'abcd1234'), null)
  assert.equal(newPasswordProblem('รหัสไทย1234', 'รหัสไทย1234'), null)
})

test('ข้อความเปลี่ยนรหัสผ่านไม่สำเร็จ', () => {
  assert.equal(passwordChangeErrorMessage(undefined), null)
  assert.match(passwordChangeErrorMessage({ code: 'same_password', status: 422 }), /ไม่ซ้ำกับรหัสผ่านเดิม/)
  assert.match(passwordChangeErrorMessage({ code: 'weak_password', status: 422 }), /ง่ายเกินไป/)
  assert.match(passwordChangeErrorMessage({ code: 'reauthentication_needed', status: 400 }), /ออกจากระบบแล้วเข้าใหม่/)
  assert.match(passwordChangeErrorMessage({ status: 0 }), /อินเทอร์เน็ต/)
})

test('ป้ายบทบาทบอกเฟสของผู้ควบคุมงาน', () => {
  assert.equal(roleLabel('supervisor', 1), 'ผู้ควบคุมงาน · เฟส 1 พิมพ์-รีด-ตัด')
  assert.equal(roleLabel('supervisor', 2), 'ผู้ควบคุมงาน · เฟส 2 เย็บ-QC')
  assert.equal(roleLabel('supervisor', null), 'ผู้ควบคุมงาน · ทุกเฟส')
  assert.equal(roleLabel('qc', null), 'ฝ่าย QC')
  // ค่าจากฐานข้อมูลที่ไม่ใช่ 1/2 (รวมตอนยังไม่มีคอลัมน์) ถือว่าไม่กำหนดเฟส
  for (const value of [1, 2]) assert.equal(toSection(value), value)
  for (const value of [undefined, null, 0, 3, '1']) assert.equal(toSection(value), null)
})

// งานจำลองขั้นต่ำสำหรับทดสอบขอบเขต
const job = (phase, station, materials = { admin: true, qc: true, production: true }) =>
  ({ id: `${phase}-${station}`, phase, station, materials, route: 'normal' })

test('หน้าแรกตามบทบาท', () => {
  for (const role of ['owner', 'admin', 'manager']) assert.equal(homePage(role), 'overview')
  for (const role of ['supervisor', 'qc', 'production']) assert.equal(homePage(role), 'board')
})

test('ผู้ควบคุมงานเฟส 1 เห็นเฉพาะงานที่อยู่สถานีเฟส 1', () => {
  const scope = boardScope('supervisor', 1)
  assert.equal(scope.title, 'งานเฟส 1 พิมพ์-รีด-ตัด')
  for (const s of ['print', 'press', 'cut', 'dtf_press']) assert.equal(jobInScope(job('production', s), scope), true, s)
  for (const s of ['sew', 'qc_pack']) assert.equal(jobInScope(job('production', s), scope), false, s)
  assert.equal(jobInScope(job('sample', 'print'), scope), true)
  assert.equal(jobInScope(job('sample', 'sew'), scope), false)
  assert.equal(jobInScope(job('materials'), scope), false)
  assert.equal(jobInScope(job('done'), scope), false)
  assert.equal(scope.showFilm, true)
})

test('ผู้ควบคุมงานเฟส 2 เห็นเย็บ QC และงานเสร็จ', () => {
  const scope = boardScope('supervisor', 2)
  for (const s of ['sew', 'qc_pack']) assert.equal(jobInScope(job('production', s), scope), true, s)
  assert.equal(jobInScope(job('production', 'print'), scope), false)
  assert.equal(jobInScope(job('sample', 'sew'), scope), true)
  assert.equal(jobInScope(job('done'), scope), true)
  assert.equal(scope.showFilm, false)
})

test('ผู้ควบคุมงานไม่กำหนดเฟส เห็นทุกสถานี แต่ไม่เห็นงานรอวัตถุดิบ', () => {
  const scope = boardScope('supervisor', null)
  for (const s of ['print', 'cut', 'sew', 'qc_pack']) assert.equal(jobInScope(job('production', s), scope), true, s)
  assert.equal(jobInScope(job('materials'), scope), false)
})

test('ฝ่าย QC เห็นเฉพาะวัตถุดิบที่ยังรอ QC และงาน QC + Packing', () => {
  const qc = boardScope('qc', null)
  assert.equal(jobInScope(job('materials', undefined, { admin: true, qc: false, production: true }), qc), true)
  assert.equal(jobInScope(job('materials', undefined, { admin: false, qc: true, production: false }), qc), false)
  assert.equal(jobInScope(job('production', 'qc_pack'), qc), true)
  assert.equal(jobInScope(job('production', 'sew'), qc), false)
})

test('owner แอดมิน ผู้บริหาร ฝ่ายผลิต เห็นกระบวนการผลิตครบทุกขั้น', () => {
  for (const role of ['owner', 'admin', 'manager', 'production']) {
    const scope = boardScope(role, null)
    assert.equal(scope.columns, null)
    for (const j of [job('materials'), job('sample', 'print'), job('sample_review'), job('production', 'print'), job('production', 'sew'), job('production', 'qc_pack'), job('done')]) assert.equal(jobInScope(j, scope), true)
  }
})

test('เฟส 2 ไม่มีปุ่มดูทั้งโรงงาน และกดเริ่มเย็บได้ · เฟส 1 กดเริ่มเย็บไม่ได้', () => {
  assert.equal(boardScope('supervisor', 2).allowFactory, false)
  assert.equal(boardScope('supervisor', 2).canSew, true)
  assert.equal(boardScope('supervisor', 1).allowFactory, true)
  assert.equal(boardScope('supervisor', 1).canSew, false)
  assert.equal(boardScope('supervisor', null).canSew, true)
  for (const role of ['admin', 'manager', 'production', 'qc']) assert.equal(boardScope(role, null).canSew, false, role)
  assert.equal(boardScope('owner', null).canSew, true, 'owner ทำแทนเฟส 2 ได้')
})

test('จองจักรได้เฉพาะฝ่ายผลิต (และ owner ทำแทน)', () => {
  assert.equal(boardScope('production', null).canBook, true)
  assert.equal(boardScope('owner', null).canBook, true)
  for (const [role, section] of [['supervisor', 2], ['supervisor', 1], ['supervisor', null], ['qc', null], ['admin', null], ['manager', null]]) {
    assert.ok(!boardScope(role, section).canBook, `${role} ${section}`)
  }
})

test('ใครแจ้งจักรเสีย / ซ่อมเสร็จได้: เฟส 2 · ทุกเฟส · ฝ่ายผลิต · owner', () => {
  assert.equal(boardScope('supervisor', 2).canReportMachines, true)
  assert.equal(boardScope('supervisor', null).canReportMachines, true)
  assert.equal(boardScope('production', null).canReportMachines, true)
  assert.equal(boardScope('owner', null).canReportMachines, true)
  assert.equal(boardScope('production', null).canSew, false, 'ฝ่ายผลิตแจ้งเสียได้ แต่เริ่มเย็บไม่ได้')
  for (const [role, section] of [['supervisor', 1], ['qc', null], ['admin', null], ['manager', null]]) {
    assert.equal(boardScope(role, section).canReportMachines, false, `${role} ${section}`)
  }
})
