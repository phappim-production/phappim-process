// ส่วน E: ตรวจสิทธิ์อัตโนมัติ (ดึง RPC ทุกตัวจาก pg_proc เทียบตารางคำตอบ + REST เขียนตรง + XSS)
import { RPC_POLICY } from '../checks/rpc-policy.mjs'
import { ACCOUNTS } from '../../qa-r14/db.mjs'

export async function runSecurityAudit(client, browser = null) {
  await client.reset(true)

  // 1. ดึงรายชื่อฟังก์ชัน RPC ทั้งหมดใน schema public จากฐานข้อมูลจริง (ไม่รวม trigger functions)
  const dbProcs = await client.sql(`
    select distinct p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    order by p.proname
  `)
  const missingFromPolicy = dbProcs.map(r => r.proname).filter(name => !(name in RPC_POLICY))
  if (missingFromPolicy.length) {
    throw new Error(`พบ RPC ใหม่ในฐานข้อมูลที่ยังไม่มีใน rpc-policy.mjs: ${missingFromPolicy.join(', ')}`)
  }

  // 2. เรียกทุก RPC ด้วย token ของทุกบทบาท (รวม anon, disabled, staff_empty)
  const roles = ['owner', 'admin1', 'manager', 'prod1', 'sup1', 'sup2', 'qc', 'staff_single', 'staff_empty', 'disabled', 'anon']
  const breaches = []
  let probeCount = 0

  for (const [fn, policy] of Object.entries(RPC_POLICY)) {
    for (const role of roles) {
      probeCount++
      const r = await client.rpc(role, fn, {})
      const isAllowedRole = policy.allowed.includes(role)
      // ถ้าไม่มีสิทธิ์: ต้องไม่ได้ 2xx และถ้าเป็น 400/401/403 ต้องเป็น 42501 หรือ permission denied (ไม่ใช่ 200/204)
      if (!isAllowedRole && r.ok) {
        breaches.push(`${fn} ยอมให้ ${role} เรียกสำเร็จ (${r.status})`)
      }
      // ถ้าเป็น RPC ใหม่ที่ทดสอบด้วย args ว่าง แล้วคนไม่มีสิทธิ์ผ่านไปเจอ P0001 แทน 42501 ก็ยังน่าสงสัยถ้าไม่ใช่ 42501/42883
      if (!isAllowedRole && r.body?.code === 'P0001') {
        breaches.push(`${fn} (${role}) ผ่านด่านสิทธิ์ไปติด P0001: ${r.body.message}`)
      }
    }
  }
  if (breaches.length) throw new Error(`ช่องโหว่สิทธิ์ RPC: ${breaches.slice(0, 5).join(' ; ')}`)

  // 3. ห้ามเขียน/ลบตารางตรงผ่าน REST (สร้างงาน 1 งานก่อน แล้วตรวจว่าลบไม่ได้จริง)
  await client.rpc('admin1', 'receive_job', {
    p_confirmation_no: 'SEC-DEL-CHECK', p_customer_name: 'Sec', p_job_name: 'Sec',
    p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-20',
    p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
  })
  const tables = ['jobs', 'job_materials', 'job_material_photos', 'production_settings', 'events', 'inbox_messages', 'profiles', 'stations']
  for (const role of ['admin1', 'prod1', 'staff_single', 'anon']) {
    for (const tbl of tables) {
      const before = (await client.sql(`select count(*)::int c from public.${tbl}`))[0].c
      const w = await client.rest(role, 'POST', tbl, {})
      if (w.ok) throw new Error(`${role} เขียนตรงตาราง ${tbl} ได้!`)
      await client.rest(role, 'DELETE', `${tbl}?id=not.is.null`)
      const after = (await client.sql(`select count(*)::int c from public.${tbl}`))[0].c
      if (after < before) throw new Error(`${role} ลบข้อมูลจริงในตาราง ${tbl} ได้! (${before} -> ${after})`)
    }
  }

  // 4. XSS check บนเบราว์เซอร์
  if (browser) {
    const r = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: 'SEC-XSS-1', p_customer_name: '<img src=x onerror=window.__qaXss=1>',
      p_job_name: '<script>window.__qaXss=2</script>', p_product_type_code: 'tshirt',
      p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-20', p_route_code: 'cut_only',
      p_confirmation_pdf_path: null, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    await client.rpc('admin1', 'add_job_material', { p_job: r.body, p_name: '<img src=x onerror=window.__qaXss=3>', p_have: true })
    await browser.goto('admin1', `#/board?job=${r.body}`, 1440)
    await browser.waitText('SEC-XSS-1')
    const xss = await browser.ev(() => window.__qaXss || 0)
    if (xss) throw new Error(`XSS ทำงานบนหน้าจอ: ${xss}`)
  }

  return { rpcCount: dbProcs.length, probes: probeCount, tablesChecked: tables.length }
}
