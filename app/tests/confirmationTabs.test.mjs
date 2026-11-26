import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boot } from './confirmationHarness.mjs'

const OUTBOX = 'pp142.confirmation.outbox'
const LS = 'phappim-confirm-v1'
const RELINK_REQ = 'pp142.confirmation.relink'
const RELINK_RES = 'pp142.confirmation.relinked'
const link = (path, exp) => `https://files.test/f/mockups/${path}?exp=${exp}&sig=abc`
const nowSec = () => Math.floor(Date.now() / 1000)

function fromJob(b, extra = {}) {
  b.api.loadData({
    h: { doc_no: 'SC-T9', customer: 'ลูกค้า', issue_date: '2026-11-24', due_date: '2026-12-10', rev: '' },
    p: { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ label: 'ขาว', q: { M: '10' } }] } },
    product: 'tshirt', from_job: true, ...extra,
  }, 'x')
}

test('ฟอร์มใบยืนยัน: แก้ใบจากงานส่งรหัสสเปกตอนเปิดใบไปด้วย (กันใบแก้เลขครั้งเดิมจาก 2 แท็บทับกัน)', () => {
  const b = boot()
  fromJob(b, { rev_token: 'tok-1' })
  b.api.state.h.rev = '1'
  b.api.state.h.job_name = 'แก้ชื่องาน'
  b.api.saveToSystem()
  const sent = JSON.parse(b.store.get(OUTBOX))
  assert.equal(sent.revise_job, true)
  assert.equal(sent.base_token, 'tok-1')
  assert.equal('rev_token' in sent, false)
})

test('ฟอร์มใบยืนยัน: งานเก่าที่ยังไม่มีรหัสสเปก ส่งรหัสว่าง · ใบใหม่ (ไม่ใช่ใบแก้) ไม่ส่งรหัส', () => {
  const b = boot()
  fromJob(b)
  b.api.state.h.rev = '1'
  b.api.state.h.job_name = 'แก้'
  b.api.saveToSystem()
  assert.equal(JSON.parse(b.store.get(OUTBOX)).base_token, '')
  const fresh = boot()
  fresh.api.loadData({ h: { doc_no: 'SC-N1', customer: 'ลูกค้า', issue_date: '2026-11-24', due_date: '2026-12-10' }, p: { tshirt: { size_sets: ['ไซซ์ผู้ใหญ่'], sizes: [{ label: 'ขาว', q: { M: '10' } }] } }, product: 'tshirt', base_token: 'x' }, 'x')
  fresh.api.saveToSystem()
  assert.equal('base_token' in JSON.parse(fresh.store.get(OUTBOX)), false)
})

test('ฟอร์มใบยืนยัน: บันทึกไฟล์ใบแก้แล้วเปิดใหม่ รหัสสเปกเดิมยังอยู่', () => {
  const b = boot()
  fromJob(b, { rev_token: 'tok-2' })
  const file = JSON.parse(JSON.stringify({ app: 'phappim-confirm', v: 1, ...b.api.state }))
  const again = boot()
  again.api.loadData(file, 'file')
  assert.equal(again.api.state.base_token, 'tok-2')
})

test('ฟอร์มใบยืนยัน: 2 แท็บใช้ฟอร์มพร้อมกัน รีเฟรชแท็บแรกแล้วได้ใบของแท็บแรก ไม่ใช่ใบที่อีกแท็บบันทึกล่าสุด', () => {
  const store = new Map()
  const tabA = new Map(), tabB = new Map()
  const a = boot('', { store, session: tabA })
  a.api.loadData({ h: { doc_no: 'SC-A', customer: 'ก' }, p: { tshirt: {} }, product: 'tshirt' }, 'x')
  const b = boot('', { store, session: tabB })
  b.api.loadData({ h: { doc_no: 'SC-B', customer: 'ข' }, p: { tshirt: {} }, product: 'tshirt' }, 'x')
  assert.equal(JSON.parse(store.get(LS)).h.doc_no, 'SC-B')
  assert.equal(boot('', { store, session: tabA }).api.state.h.doc_no, 'SC-A')
  assert.equal(boot('', { store, session: new Map() }).api.state.h.doc_no, 'SC-B')
})

test('ฟอร์มใบยืนยัน: อีกแท็บบันทึกฟอร์ม = แท็บนี้ขึ้นเตือนครั้งเดียว · โหมดดูอย่างเดียวไม่เตือน', () => {
  const b = boot()
  b.fire('storage', { key: LS, newValue: '{}' })
  b.fire('storage', { key: LS, newValue: '{}' })
  assert.equal(b.created.filter(e => e.innerHTML.includes('ฟอร์มใบยืนยันเปิดอยู่อีกแท็บ')).length, 1)
  const view = boot()
  view.api.setViewOnly(true)
  view.fire('storage', { key: LS, newValue: '{}' })
  assert.equal(view.created.some(e => e.innerHTML.includes('เปิดอยู่อีกแท็บ')), false)
})

test('ฟอร์มใบยืนยัน: ลิงก์รูปจากระบบหมดอายุ ขอลิงก์ใหม่จากแท็บระบบ แล้วส่งออก PDF ต่อได้', async () => {
  const b = boot()
  fromJob(b)
  b.api.state.imgs = [{ name: 'หน้า', path: 'SC-T9/a.jpg', src: link('SC-T9/a.jpg', nowSec() - 60) }, { name: 'ใหม่', src: 'data:image/jpeg;base64,AAAA' }]
  assert.deepEqual(b.api.staleLinks(0).map(x => x.no), [1])
  const ready = b.api.linksReady()
  const req = JSON.parse(b.store.get(RELINK_REQ))
  assert.deepEqual(req.paths, ['SC-T9/a.jpg'])
  b.fire('storage', { key: RELINK_RES, newValue: JSON.stringify({ id: 'อื่น', urls: { 'SC-T9/a.jpg': link('SC-T9/a.jpg', 1) } }) })
  b.fire('storage', { key: RELINK_RES, newValue: JSON.stringify({ id: req.id, urls: { 'SC-T9/a.jpg': link('SC-T9/a.jpg', nowSec() + 3600) } }) })
  assert.equal(await ready, true)
  assert.equal(b.api.staleLinks(0).length, 0)
  assert.equal(b.api.state.imgs[0].path, 'SC-T9/a.jpg')
  assert.equal(b.g.alerts.length, 0)
})

test('ฟอร์มใบยืนยัน: ลิงก์รูปหมดอายุและไม่มีแท็บระบบตอบ = ไม่ส่งออก PDF · บอกว่ารูปไหนและต้องทำอะไร', async () => {
  const b = boot('', { timeout: fn => { fn(); return 0 } })
  fromJob(b)
  b.api.state.imgs = [{ name: 'หน้า', path: 'SC-T9/a.jpg', src: link('SC-T9/a.jpg', nowSec() - 60) }]
  assert.equal(await b.api.linksReady(), false)
  assert.match(b.g.alerts.at(-1), /รูปที่ 1 เป็นรูปจากระบบที่ลิงก์หมดอายุแล้ว/)
  assert.match(b.g.alerts.at(-1), /เปิดหน้าระบบที่เข้าสู่ระบบไว้ในอีกแท็บ/)
})

test('ฟอร์มใบยืนยัน: รูปที่เพิ่งเลือก (data:) และลิงก์ที่ยังไม่หมดอายุ ไม่ต้องขอลิงก์ใหม่', async () => {
  const b = boot()
  fromJob(b)
  b.api.state.imgs = [{ name: 'หน้า', path: 'SC-T9/a.jpg', src: link('SC-T9/a.jpg', nowSec() + 3600) }, { name: 'ใหม่', src: 'data:image/jpeg;base64,AAAA' }]
  assert.equal(await b.api.linksReady(), true)
  assert.equal(b.store.has(RELINK_REQ), false)
})

test('ฟอร์มใบยืนยัน: ได้ลิงก์ใหม่แล้วเปลี่ยนรูปบนจอทันทีโดยไม่วาดฟอร์มใหม่ · คำตอบที่มาช้ากว่าที่รอยังใช้ได้ · ใบที่ส่งแล้วยังนับว่าส่งแล้ว', async () => {
  const b = boot('', { timeout: fn => { fn(); return 0 } })
  fromJob(b)
  const oldUrl = link('SC-T9/a.jpg', nowSec() - 60)
  b.api.state.imgs = [{ name: 'หน้า', path: 'SC-T9/a.jpg', src: oldUrl }]
  const shown = { src: oldUrl, getAttribute: () => shown.src, setAttribute: (_, v) => { shown.src = v } }
  b.imgs.push(shown)
  assert.equal(await b.api.linksReady(), false)
  const req = JSON.parse(b.store.get(RELINK_REQ))
  const fresh = link('SC-T9/a.jpg', nowSec() + 3600)
  b.fire('storage', { key: RELINK_RES, newValue: JSON.stringify({ id: req.id, urls: { 'SC-T9/a.jpg': fresh } }) })
  assert.equal(b.api.state.imgs[0].src, fresh)
  assert.equal(shown.src, fresh)
  assert.equal(b.api.staleLinks(0).length, 0)
})

test('ฟอร์มใบยืนยัน: รูปจากระบบที่ขอลิงก์ไม่สำเร็จตอนเปิด (ไม่มีลิงก์) ถือว่าต้องขอใหม่ก่อนส่งออก PDF', () => {
  const b = boot()
  fromJob(b)
  b.api.state.imgs = [{ name: 'หน้า', path: 'SC-T9/a.jpg', src: '' }, { name: 'ใหม่', src: 'data:image/jpeg;base64,AAAA' }]
  assert.deepEqual(b.api.staleLinks(0).map(x => x.no), [1])
})
