// ส่วน E: สิทธิ์ RPC (ด่านบทบาทจาก SQL ตรงตาราง + เรียกจริงทุกบัญชี + สถานีที่จับคู่) · RLS/policy · XSS
import { RPC_POLICY, PROBE_ACCOUNTS, passesGate, firstGate } from '../checks/rpc-policy.mjs'
import { ACCOUNTS } from '../../qa-r14/db.mjs'

const ROLE_DENIED = /บทบาทของคุณ|ต้องเข้าสู่ระบบ|ไม่มีสิทธิ์เข้าใช้งาน|ถูกปิดหรือยังไม่ได้ล็อกอิน|JWT|token/i
// ตารางตั้งค่าที่เจ้าของแก้ตรงผ่านหน้าเว็บได้ (policy ต้องผูก private.is_owner) · ตารางงานทั้งหมดต้องเขียนผ่าน RPC
const OWNER_EDITABLE = new Set([
  'stations', 'routes', 'route_stations', 'product_types', 'material_templates', 'profiles', 'sla_segments',
  'reason_codes', 'machine_types', 'sewing_machines', 'product_machine_needs', 'inbox_settings', 'staff_stations',
])

const accountOf = key => key === 'anon' ? { key, active: false, role: null } : ACCOUNTS.find(a => a.key === key)
const isDenied = r => !r.ok && (r.status === 401 || r.body?.code === '42501')

export async function runSecurityAudit(client, browser = null) {
  await client.reset(false)
  const problems = []

  const procs = await client.sql(`
    select p.proname, p.prosrc, p.proargnames, p.proargmodes, p.pronargs,
      has_function_privilege('anon', p.oid, 'execute') anon_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
    order by p.proname`)
  const names = new Set(procs.map(p => p.proname))
  const unlisted = [...names].filter(n => !(n in RPC_POLICY))
  const gone = Object.keys(RPC_POLICY).filter(n => !names.has(n))
  if (unlisted.length) problems.push(`E1: RPC ใหม่ยังไม่มีใน rpc-policy.mjs: ${unlisted.join(', ')}`)
  if (gone.length) problems.push(`E1: rpc-policy.mjs มีชื่อที่ไม่มีในฐานแล้ว: ${gone.join(', ')}`)

  for (const p of procs) {
    if (p.anon_exec) problems.push(`E2: anon เรียก ${p.proname} ได้`)
    const pol = RPC_POLICY[p.proname]
    if (!pol) continue
    const sqlGate = firstGate(p.prosrc)
    const want = pol.gate ?? null
    if (JSON.stringify(sqlGate) !== JSON.stringify(want)) {
      problems.push(`E3: ด่านบทบาทของ ${p.proname} ใน SQL = ${JSON.stringify(sqlGate)} แต่ตาราง = ${JSON.stringify(want)}`)
    }
  }

  let probes = 0
  for (const p of procs) {
    const pol = RPC_POLICY[p.proname]
    if (!pol) continue
    const argNames = (p.proargnames ?? [])
      .filter((_, i) => !p.proargmodes || ['i', 'b', 'v'].includes(p.proargmodes[i]))
      .slice(0, p.pronargs)
    const args = Object.fromEntries(argNames.map(n => [n, null]))
    for (const key of PROBE_ACCOUNTS) {
      const acc = accountOf(key)
      probes++
      const r = await client.rpc(key, p.proname, args)
      const msg = String(r.body?.message ?? r.body ?? '').slice(0, 90)
      const inactive = !acc.active || !acc.role
      if (inactive) {
        if (r.ok) problems.push(`E4: ${key} (ปิด/ไม่มีบทบาท) เรียก ${p.proname} สำเร็จ`)
        else if (pol.gate || pol.scope === 'active') {
          if (!isDenied(r)) problems.push(`E4: ${key} เรียก ${p.proname} ได้ ${r.body?.code ?? r.status} แทน 42501: ${msg}`)
        }
        continue
      }
      if (pol.gate) {
        const allowed = passesGate(acc, pol.gate)
        if (!allowed && !isDenied(r)) problems.push(`E5: ${key} ผ่านด่าน ${p.proname} (${r.ok ? 'สำเร็จ' : r.body?.code}): ${msg}`)
        if (allowed && isDenied(r) && ROLE_DENIED.test(msg)) problems.push(`E5: ${key} ควรผ่านด่าน ${p.proname} แต่ถูกปฏิเสธ: ${msg}`)
      } else if (pol.scope === 'active') {
        if (isDenied(r) && ROLE_DENIED.test(msg)) problems.push(`E5: ${key} ถูกปฏิเสธ ${p.proname}: ${msg}`)
      }
    }
  }

  const stationProbes = await probeStationScope(client, problems)

  const rls = await client.sql(`
    select c.relname, c.relkind, c.relrowsecurity,
      coalesce((select array_to_string(c.reloptions, ',')), '') opts
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v')`)
  for (const t of rls) {
    if (t.relkind === 'r' && !t.relrowsecurity) problems.push(`E7: ตาราง ${t.relname} ไม่ได้เปิด RLS`)
    if (t.relkind === 'v' && !/security_invoker=(true|on)/.test(t.opts)) problems.push(`E7: view ${t.relname} ไม่ใช่ security_invoker (อ่านข้าม RLS ได้)`)
  }
  const writePolicies = await client.sql(`
    select tablename, policyname, cmd, roles::text roles, coalesce(qual, '') qual, coalesce(with_check, '') chk
    from pg_policies where schemaname = 'public' and cmd <> 'SELECT'`)
  for (const pol of writePolicies) {
    const ownerOnly = /private\.is_owner\(\)/.test(pol.qual + pol.chk)
    if (!OWNER_EDITABLE.has(pol.tablename)) problems.push(`E8: ตาราง ${pol.tablename} มี policy ${pol.cmd} ให้ client เขียนตรง (${pol.policyname})`)
    else if (!ownerOnly) problems.push(`E8: policy ${pol.cmd} ของ ${pol.tablename} ไม่ได้จำกัดเจ้าของ (${pol.policyname})`)
    if (/anon|public/.test(pol.roles)) problems.push(`E8: policy ${pol.policyname} เปิดให้ ${pol.roles}`)
  }
  const openReads = await client.sql(`
    select tablename, policyname from pg_policies
    where schemaname = 'public' and cmd in ('SELECT', 'ALL') and (roles::text like '%anon%' or roles::text like '%public%' or coalesce(qual, '') in ('true', ''))`)
  for (const o of openReads) problems.push(`E8: policy อ่าน ${o.tablename}.${o.policyname} เปิดกว้าง (anon/public/true)`)

  const restWrites = await probeDirectWrites(client, problems)

  let xssChecked = false
  if (browser) {
    const r = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: 'SEC-XSS-1', p_customer_name: '<img src=x onerror=window.__qaXss=1>',
      p_job_name: '<script>window.__qaXss=2</script>', p_product_type_code: 'tshirt',
      p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-20', p_route_code: 'cut_only',
      p_confirmation_pdf_path: null, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    if (!r.ok) throw new Error(`XSS setup: ${JSON.stringify(r.body)}`)
    await browser.goto('admin1', `#/board?job=${r.body}`, 1440)
    await browser.waitText('SEC-XSS-1')
    const xss = await browser.ev(() => window.__qaXss || 0)
    if (xss) problems.push(`E9: XSS ทำงานบนหน้าจอ (${xss})`)
    xssChecked = true
  }

  if (problems.length) {
    const err = new Error(`${problems.length} ข้อ: ${problems.slice(0, 8).join(' ; ')}`)
    err.details = problems
    throw err
  }
  return { rpcCount: procs.length, probes, stationProbes, restWrites, tablesChecked: rls.length, writePolicies: writePolicies.length, xssChecked }
}

// แถวที่ข้อมูลครบ (ผ่าน not null/check) เพื่อให้ถูกปฏิเสธที่ RLS จริง ไม่ใช่ที่ข้อมูลไม่ครบ
async function probeDirectWrites(client, problems) {
  const r = await client.rpc('admin1', 'receive_job', {
    p_confirmation_no: 'SEC-REST-1', p_customer_name: 'Sec', p_job_name: 'Sec', p_product_type_code: 'tshirt',
    p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-20', p_route_code: 'cut_only',
    p_confirmation_pdf_path: null, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
  })
  if (!r.ok) throw new Error(`REST probe setup: ${JSON.stringify(r.body)}`)
  const job = r.body
  const snapshot = async () => JSON.stringify(await client.sql(
    `select (select row_to_json(j) from public.jobs j where id = $1) j,
            (select count(*) from public.events) e, (select count(*) from public.job_materials) m, (select count(*) from public.jobs) n`, [job]))
  const before = await snapshot()
  let n = 0
  for (const role of ['owner', 'admin1', 'prod1', 'staff_single', 'anon']) {
    const attempts = [
      ['POST', 'jobs', { confirmation_no: `SEC-REST-${role}`, customer_name: 'x', job_name: 'x', product_type_code: 'tshirt', qty: 5, unit: 'ตัว', due_date: '2099-01-20', route_code: 'cut_only' }],
      ['POST', 'events', { job_id: job, type: 'note', payload: {} }],
      ['POST', 'job_materials', { job_id: job, name: 'แทรกตรง' }],
      ['PATCH', `jobs?id=eq.${job}`, { qty: 99999 }],
      ['PATCH', `events?job_id=eq.${job}`, { type: 'tampered' }],
      ['DELETE', `events?job_id=eq.${job}`],
      ['DELETE', `jobs?id=eq.${job}`],
    ]
    for (const [method, path, body] of attempts) {
      n++
      await client.rest(role, method, path, body)
      const now = await snapshot()
      if (now !== before) {
        problems.push(`E10: ${role} ${method} ${path.split('?')[0]} ตรงผ่าน REST แล้วข้อมูลเปลี่ยน`)
        return n
      }
    }
  }
  return n
}

// งานจริงที่สถานีตัด: staff ที่ไม่ได้จับคู่สถานีนั้น / ผู้ควบคุมงานต่างเฟส ต้องได้ 42501
async function probeStationScope(client, problems) {
  const make = async no => {
    const r = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: no, p_customer_name: 'Sec', p_job_name: 'Sec', p_product_type_code: 'tshirt',
      p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-20', p_route_code: 'cut_only',
      p_confirmation_pdf_path: null, p_confirmation_rev: 0, p_spec: {}, p_needs_sample: false,
    })
    if (!r.ok) throw new Error(`station probe setup: ${JSON.stringify(r.body)}`)
    return r.body
  }
  const job = await make('SEC-STATION-1')
  const [cut] = await client.sql("select section from public.stations where code = 'cut'")
  const otherSup = ACCOUNTS.find(a => a.role === 'supervisor' && a.section !== cut.section)
  const sameSup = ACCOUNTS.find(a => a.role === 'supervisor' && a.section === cut.section)
  let n = 0
  const expectDenied = async (key, fn, args) => {
    n++
    const r = await client.rpc(key, fn, args)
    if (!isDenied(r)) problems.push(`E6: ${key} กด ${fn} งานที่สถานีตัดได้ (${r.ok ? 'สำเร็จ' : r.body?.code}: ${String(r.body?.message ?? '').slice(0, 80)})`)
  }
  for (const key of ['staff_qc', 'staff_empty', otherSup?.key].filter(Boolean)) {
    await expectDenied(key, 'start_in_queue', { p_job: job, p_reason: 'probe' })
    await expectDenied(key, 'start_station', { p_job: job })
    await expectDenied(key, 'open_issue', { p_job: job, p_reason: 'probe' })
  }
  n++
  const ok = await client.rpc('staff_single', 'start_station', { p_job: job })
  if (!ok.ok) problems.push(`E6: staff_single (สถานีตัด) เริ่มงานที่ตัดไม่ได้: ${JSON.stringify(ok.body)}`)
  for (const key of ['staff_qc', 'staff_empty', otherSup?.key].filter(Boolean)) {
    await expectDenied(key, 'finish_station', { p_job: job, p_station: 'cut' })
  }
  if (sameSup) {
    n++
    const fin = await client.rpc(sameSup.key, 'finish_station', { p_job: job, p_station: 'cut' })
    if (!fin.ok) problems.push(`E6: ${sameSup.key} (เฟสเดียวกับตัด) กดเสร็จไม่ได้: ${JSON.stringify(fin.body)}`)
  }
  const [{ station_code: now } = {}] = await client.sql(
    `select rs.station_code from public.jobs j join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq where j.id = $1`, [job])
  if (now !== 'qc_pack') {
    problems.push(`E6: งานทดสอบไม่ไปถึง QC (อยู่ที่ ${now})`)
    return n
  }
  for (const key of ['staff_single', 'staff_empty']) {
    await expectDenied(key, 'start_station', { p_job: job })
  }
  n++
  const qcStart = await client.rpc('staff_qc', 'start_station', { p_job: job })
  if (!qcStart.ok) problems.push(`E6: staff_qc เริ่ม QC ไม่ได้: ${JSON.stringify(qcStart.body)}`)
  for (const key of ['staff_single', 'staff_empty']) await expectDenied(key, 'record_qc', { p_job: job, p_passed: 10 })
  n++
  const qc = await client.rpc('staff_qc', 'record_qc', { p_job: job, p_passed: 10 })
  if (!qc.ok) problems.push(`E6: staff_qc บันทึก QC ไม่ได้: ${JSON.stringify(qc.body)}`)
  return n
}
