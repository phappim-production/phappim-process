import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canOpenPage, isEmployeeRole, roleLabel, toSection } from '../src/auth/access.ts'
import { newPasswordProblem, passwordChangeErrorMessage, signInErrorMessage } from '../src/auth/messages.ts'

const roles = ['owner', 'supervisor', 'admin', 'qc', 'production', 'manager']

for (const role of roles) {
  test(`เมนูและสิทธิ์เปิดหน้าของ ${role}`, () => {
    assert.equal(isEmployeeRole(role), true)
    for (const page of ['overview', 'board', 'system']) {
      assert.equal(canOpenPage(role, page), true)
    }
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
