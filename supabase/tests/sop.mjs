// ตรวจข้อมูลจริงจาก PP-SOP-01 ให้ตรงกับที่หน้างานกรอกกลับมา
// เรียกจาก run.mjs ก่อนชุดทดสอบ workflow (ซึ่งใช้ข้อมูลสมมติของตัวเอง)

export async function sopTests({ db, ok }) {
  const rows = async (sql, p) => (await db.query(sql, p)).rows

  const fleet = await rows(`select type_code, count(*)::int n, count(*) filter (where status = 'ready')::int ready
    from public.sewing_machines group by 1 order by 1`)
  ok('SOP: จักรจริง เข็มเดี่ยว 14 · โพ้ง 4 เส้น 4 · จักรลา 2 · ติดกระดุม 1 · เจาะรังดุม 1 ใช้ได้ทุกตัว',
    JSON.stringify(fleet) === JSON.stringify([
      { type_code: 'button', n: 1, ready: 1 }, { type_code: 'buttonhole', n: 1, ready: 1 }, { type_code: 'cover', n: 2, ready: 2 },
      { type_code: 'ovl4', n: 4, ready: 4 }, { type_code: 'single', n: 14, ready: 14 }]), JSON.stringify(fleet))
  const codes = (await rows(`select code from public.sewing_machines order by sort`)).map(r => r.code)
  ok('SOP: รหัสจักรตามประเภท SN-001…SN-014 · OL4-001…04 · CV-001 · BT-001 · BH-001',
    codes.length === 22 && codes.includes('CV-002') && codes[0] === 'SN-001' && codes.includes('SN-014') && codes.includes('OL4-004')
    && ['CV-001', 'BT-001', 'BH-001'].every(c => codes.includes(c)), codes.join(','))

  // สูตรทุกสินค้าต้องใช้ได้กับจักรที่มีจริง ไม่อย่างนั้นกดเริ่มเย็บไม่ได้ตลอด
  const impossible = await rows(`
    select n.product_type_code, n.type_code from public.product_machine_needs n
    where n.qty > (select count(*) from public.sewing_machines m where m.type_code = n.type_code and m.status = 'ready')`)
  ok('SOP: ทุกสูตรจักรใช้ได้กับจักรที่โรงงานมีจริง', impossible.length === 0, JSON.stringify(impossible))
  const recipe = async p => (await rows(`select type_code || '×' || qty r from public.product_machine_needs
    where product_type_code = $1 order by type_code`, [p])).map(r => r.r).join(' ')
  ok('SOP: เสื้อยืด = โพ้ง 4 ×2 · จักรลา · เข็มเดี่ยว (ไม่ใช้ลาคอ)', await recipe('tshirt') === 'cover×1 ovl4×2 single×1', await recipe('tshirt'))
  ok('SOP: โปโล ใช้จักรลาแทนสองเข็ม', await recipe('polo') === 'button×1 buttonhole×1 cover×1 ovl4×1 single×1', await recipe('polo'))
  ok('SOP: กางเกงช้าง ใช้เข็มเดี่ยวแทนจักรลา ไม่ใช้ยางยืด', await recipe('elephant') === 'ovl4×1 single×1', await recipe('elephant'))
  ok('SOP: ป้ายผ้า ไม่ใช้โพ้ง 3 เส้น', await recipe('banner') === 'single×1', await recipe('banner'))
  ok('SOP: ถุงผ้า ไม่ใช้สองเข็ม', await recipe('bag') === 'ovl4×1 single×1', await recipe('bag'))

  const rc = Object.fromEntries((await rows(`select code, name from public.reason_codes where active`)).map(r => [r.code, r.name]))
  ok('SOP: แยกผ้าไม่พอ / ผ้ายังไม่มา', rc.W1 === 'ผ้าไม่พอ' && rc.W5 === 'ผ้ายังไม่มา')
  ok('SOP: แยกกระดาษหมด / หมึกหมด', rc.W2 === 'กระดาษหมด' && rc.W6 === 'หมึกหมด')
  ok('SOP: แยกไฟล์ผิด / ไฟล์ยังไม่มา', rc.F1 === 'ไฟล์ผิด' && rc.F4 === 'ไฟล์ยังไม่มา')
  ok('SOP: รหัสสาเหตุ 21 รหัส', Object.keys(rc).length === 21, String(Object.keys(rc).length))

  const subs = async s => (await rows(`select substeps from public.stations where code = $1`, [s]))[0].substeps
  const kindOf = async (s, k) => (await subs(s)).find(x => x.key === k)?.kind
  ok('SOP: พิมพ์ 13 ขั้น · ตรวจงานพิมพ์บังคับ · พิมพ์ทดสอบต้องอนุมัติ',
    (await subs('print')).length === 13 && await kindOf('print', 'check_print') === 'req' && await kindOf('print', 'test_print') === 'appr')
  ok('SOP: พิมพ์ จัดเลย์เอาต์ = ติ๊กว่าบันทึกไฟล์ .TIF แล้ว', await kindOf('print', 'nesting') === 'req')
  ok('SOP: รีด 10 ขั้น · รับม้วนกระดาษอยู่ขั้นแรก', (await subs('press')).length === 10 && (await subs('press'))[0].key === 'receive_roll')
  ok('SOP: ตัด ปูผ้า/แพทเทิร์นไม่บังคับ · นับชิ้นต้องกรอก',
    await kindOf('cut', 'spread') === 'opt' && await kindOf('cut', 'pattern') === 'opt' && await kindOf('cut', 'sort_count') === 'num')
  ok('SOP: ขั้นที่ยังเข้าใจไม่ตรงกันไม่บังคับไว้ก่อน (พิมพ์ข้อ 13 · ตัดข้อ 1)',
    await kindOf('print', 'split_roll') === 'opt' && await kindOf('cut', 'receive_fabric') === 'opt')
  ok('SOP: รีด DTF ยืนยันแล้ว · รีดทดสอบไม่บังคับ · ยังล็อกรอฟิล์ม',
    (await rows(`select is_draft from public.stations where code = 'dtf_press'`))[0].is_draft === false
    && await kindOf('dtf_press', 'test_press') === 'opt' && await kindOf('dtf_press', 'film_received') === 'lock')
  ok('SOP: QC+แพ็ค 9 ขั้น · ลงลังบังคับ', (await subs('qc_pack')).length === 9 && await kindOf('qc_pack', 'boxed') === 'req')
}
