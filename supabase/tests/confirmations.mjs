// ใบยืนยันการผลิตบันทึกเข้าระบบ (20261119230000) · ฟอร์มกด "บันทึกเข้าระบบ" → ใบร่าง → ส่งงานเข้าแล้วผูกกับงาน

export async function confirmationTests({ db, ok, as }) {
  const U = {
    admin: '00000000-0000-0000-0000-000000000011',
    prod: '00000000-0000-0000-0000-000000000013', mgr: '00000000-0000-0000-0000-000000000014',
  }
  const firstLine = e => e.message.split(String.fromCharCode(10))[0]
  const call = (uid, sql) => as(uid, () => db.query(`select ${sql} as r`))
  const pass = async (name, uid, sql) => {
    try { const r = await call(uid, sql); ok(name, true); return r.rows[0]?.r } catch (e) { ok(name, false, firstLine(e)) }
  }
  const reject = async (name, uid, sql, re) => {
    try { await call(uid, sql); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') }
    catch (e) { ok(name, re ? re.test(e.message) : true, firstLine(e)) }
  }
  const form = (no, customer = 'ลูกค้าฟอร์ม') => `'${JSON.stringify({
    app: 'phappim-confirm', v: 1, h: { doc_no: no, customer }, product: 'tshirt', p: { tshirt: {} }, imgs: ['data:image/webp;base64,AAAA'],
  })}'::jsonb`
  const draft = async no => (await db.query(`select * from public.confirmation_drafts where confirmation_no = '${no}'`)).rows[0]

  const id = await pass('แอดมินบันทึกใบยืนยันเข้าระบบได้', U.admin, `public.save_confirmation_draft(${form('SC-DR-1')})`)
  const d1 = await draft('SC-DR-1')
  ok('ใบร่างเก็บเลขที่ใบ ลูกค้า สถานะร่าง', d1?.id === id && d1.customer_name === 'ลูกค้าฟอร์ม' && d1.status === 'draft')
  ok('ไม่เก็บรูปลงตาราง (กฎโปรเจกต์)', !!d1 && !('imgs' in d1.data))
  await pass('บันทึกซ้ำเลขเดิม = แก้ใบเดิม', U.admin, `public.save_confirmation_draft(${form('SC-DR-1', 'ลูกค้าแก้ชื่อ')})`)
  const same = (await db.query(`select count(*)::int n, max(customer_name) c from public.confirmation_drafts where confirmation_no = 'SC-DR-1'`)).rows[0]
  ok('แก้ใบเดิม ไม่สร้างใบใหม่', same.n === 1 && same.c === 'ลูกค้าแก้ชื่อ')
  await reject('ไม่มีเลขที่ใบ บันทึกไม่ได้', U.admin, `public.save_confirmation_draft('{"h":{"doc_no":" "}}'::jsonb)`, /ใส่เลขที่ใบยืนยัน/)
  await reject('ข้อมูลไม่ใช่ใบยืนยัน บันทึกไม่ได้', U.admin, `public.save_confirmation_draft('[1]'::jsonb)`, /ไม่ถูกต้อง/)
  await reject('ฝ่ายผลิตบันทึกใบยืนยันไม่ได้', U.prod, `public.save_confirmation_draft(${form('SC-DR-P')})`, /ทำขั้นนี้ไม่ได้/)
  await reject('ผู้บริหารบันทึกใบยืนยันไม่ได้', U.mgr, `public.save_confirmation_draft(${form('SC-DR-M')})`, /ทำขั้นนี้ไม่ได้/)
  ok('ผู้บริหารอ่านใบร่างได้', (await as(U.mgr, () => db.query(`select count(*)::int n from public.confirmation_drafts`))).rows[0].n >= 1)
  ok('ฝ่ายผลิตอ่านใบร่างไม่ได้ (RLS)', (await as(U.prod, () => db.query(`select count(*)::int n from public.confirmation_drafts`))).rows[0].n === 0)
  try {
    await as(U.admin, () => db.query(`update public.confirmation_drafts set status = 'received'`))
    ok('แก้ตารางใบร่างตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', (await draft('SC-DR-1')).status === 'draft')
  } catch (e) { ok('แก้ตารางใบร่างตรงไม่ได้ (ต้องผ่านฟังก์ชัน)', /permission denied|row-level/.test(e.message), firstLine(e)) }

  await pass('ส่งงานเข้าด้วยเลขที่ใบเดียวกัน (ยังไม่มี PDF)', U.admin,
    `public.receive_job('SC-DR-1', 'ลูกค้าแก้ชื่อ', 'งาน', 'tshirt', 10, 'ตัว', '2026-12-31', 'plain', null, 0, 0, '{}', false)`)
  const d2 = await draft('SC-DR-1')
  ok('ใบร่างเปลี่ยนเป็นส่งงานเข้าแล้ว และผูกกับงาน', d2.status === 'received' && d2.job_id !== null)
  await reject('ใบที่ส่งงานเข้าแล้ว บันทึกแก้ไม่ได้', U.admin, `public.save_confirmation_draft(${form('SC-DR-1')})`, /ส่งงานเข้าโรงงานแล้ว/)
  await reject('ใบที่ส่งงานเข้าแล้ว ยกเลิกไม่ได้', U.admin, `public.cancel_confirmation_draft('${d2.id}')`, /ส่งงานเข้าแล้ว/)

  const id3 = await pass('บันทึกใบที่สอง', U.admin, `public.save_confirmation_draft(${form('SC-DR-2')})`)
  await pass('ยกเลิกใบร่างได้', U.admin, `public.cancel_confirmation_draft('${id3}')`)
  ok('ใบที่ยกเลิกมีสถานะยกเลิก', (await draft('SC-DR-2')).status === 'cancelled')
  await pass('บันทึกเลขเดิมอีกครั้ง = กลับเป็นใบร่าง', U.admin, `public.save_confirmation_draft(${form('SC-DR-2')})`)
  ok('ใบที่ยกเลิกแล้วบันทึกใหม่กลับเป็นร่าง', (await draft('SC-DR-2')).status === 'draft')
}
