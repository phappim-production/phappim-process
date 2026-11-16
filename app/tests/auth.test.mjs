import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canOpenPage, isEmployeeRole } from '../src/auth/access.ts'

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
