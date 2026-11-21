import { PGlite } from '../../supabase/tests/node_modules/@electric-sql/pglite/dist/index.js'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', '..', 'supabase', 'migrations')
export const RECORD_SECRET = 'r14-local-record-secret-0123456789abcdef'
export const DEFAULT_PASSWORD = 'r14-local-pass'

const uid = n => '91400000-0000-0000-0000-' + String(n).padStart(12, '0')

export const ACCOUNTS = [
  { key: 'owner', id: uid(1), email: 'owner@r14.invalid', name: 'เจ้าของจำลอง', role: 'owner', section: null, active: true, stations: [] },
  { key: 'manager', id: uid(2), email: 'manager@r14.invalid', name: 'ผู้บริหารจำลอง', role: 'manager', section: null, active: true, stations: [] },
  { key: 'admin1', id: uid(3), email: 'admin1@r14.invalid', name: 'แอดมิน 1 จำลอง', role: 'admin', section: null, active: true, stations: [] },
  { key: 'admin2', id: uid(4), email: 'admin2@r14.invalid', name: 'แอดมิน 2 จำลอง', role: 'admin', section: null, active: true, stations: [] },
  { key: 'prod1', id: uid(5), email: 'prod1@r14.invalid', name: 'ฝ่ายผลิต 1 จำลอง', role: 'production', section: null, active: true, stations: [] },
  { key: 'prod2', id: uid(6), email: 'prod2@r14.invalid', name: 'ฝ่ายผลิต 2 จำลอง', role: 'production', section: null, active: true, stations: [] },
  { key: 'sup1', id: uid(7), email: 'sup1@r14.invalid', name: 'ผู้ควบคุมเฟส 1 จำลอง', role: 'supervisor', section: 1, active: true, stations: [] },
  { key: 'sup2', id: uid(8), email: 'sup2@r14.invalid', name: 'ผู้ควบคุมเฟส 2 จำลอง', role: 'supervisor', section: 2, active: true, stations: [] },
  { key: 'qc', id: uid(9), email: 'qc@r14.invalid', name: 'ฝ่าย QC จำลอง', role: 'qc', section: null, active: true, stations: [] },
  { key: 'staff_multi', id: uid(10), email: 'staff-multi@r14.invalid', name: 'พนักงานหลายสถานี', role: 'staff', section: null, active: true, stations: ['print', 'press', 'cut', 'dtf_press', 'emb'] },
  { key: 'staff_single', id: uid(11), email: 'staff-single@r14.invalid', name: 'พนักงานตัด', role: 'staff', section: null, active: true, stations: ['cut'] },
  { key: 'staff_qc', id: uid(12), email: 'staff-qc@r14.invalid', name: 'พนักงาน QC+Packing', role: 'staff', section: null, active: true, stations: ['qc_pack'] },
  { key: 'staff_empty', id: uid(13), email: 'staff-empty@r14.invalid', name: 'พนักงานยังไม่จับคู่', role: 'staff', section: null, active: true, stations: [] },
  { key: 'disabled', id: uid(14), email: 'disabled@r14.invalid', name: 'บัญชีที่ปิด', role: 'admin', section: null, active: false, stations: [] },
  { key: 'norole', id: uid(15), email: 'norole@r14.invalid', name: 'บัญชียังไม่มีบทบาท', role: null, section: null, active: true, stations: [] },
]

export const ACCOUNT_BY_KEY = Object.fromEntries(ACCOUNTS.map(a => [a.key, a]))
export const ACCOUNT_BY_ID = Object.fromEntries(ACCOUNTS.map(a => [a.id, a]))

const SEED_VENDORS = [
  ['บริษัท พิมพ์รีดจำลอง', ['print', 'press'], 'outsource', '0800000001', 'นิคมอุตสาหกรรมจำลอง 1', 'https://map.r14.invalid/v1', 'พิมพ์ซับลิเมชั่นและรีดร้อน', 'คุณกนก'],
  ['บริษัท ตัดเย็บจำลอง', ['cut', 'sew'], 'outsource', '0800000002', 'ซอยจำลอง 2', null, 'ตัดและเย็บเสื้อกีฬา', 'คุณสมชาย'],
  ['ร้านปักจำลอง', ['emb'], 'outsource', '0800000003', 'ถนนจำลอง 3', null, 'ปักคอมพิวเตอร์', 'คุณวิไล'],
  ['โรงงานผลิตสำเร็จรูปจำลอง', ['outside'], 'outsource', '0800000004', 'นิคมจำลอง 4', 'https://map.r14.invalid/v4', 'หมวกและหมอนสำเร็จรูป', 'คุณประเสริฐ'],
  ['โรงงานเสริมครบวงจรจำลอง', ['print', 'press', 'cut', 'sew', 'emb', 'outside'], 'outsource', '0800000005', 'ซอยจำลอง 5', null, 'รับผลิตทุกสถานี', 'คุณนภา'],
  ['ร้านผ้าจำลอง (ซัพพลายเออร์)', [], 'supplier', '0800000006', 'ตลาดผ้าจำลอง', null, 'จำหน่ายผ้าม้วน', 'คุณมาลี'],
  ['บริษัทที่ปิดใช้งานจำลอง', ['print', 'cut'], 'outsource', '0800000007', null, null, null, 'คุณเก่า'],
]

async function initInstance() {
  const pglite = new PGlite()
  await pglite.exec(`
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text unique,
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated nologin;
    create role anon nologin;
  `)

  for (const file of readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
    await pglite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }

  await pglite.exec(`
    grant usage on schema public, auth to authenticated, anon;
    grant all on all tables in schema public to authenticated, anon;
    grant all on all sequences in schema public to authenticated, anon;
    grant execute on all functions in schema auth to authenticated, anon;
    insert into private.file_settings (record_secret) values ('${RECORD_SECRET}');
    -- ฐานจริงปรับ QC + Packing เป็นไลน์ผลิตไม่จำกัดเครื่อง
    update public.stations set machines = null where code = 'qc_pack';
  `)

  for (const v of SEED_VENDORS) {
    const active = v[0] !== 'บริษัทที่ปิดใช้งานจำลอง'
    await pglite.query(
      `insert into public.vendors (name, stations, kind, phone, address, map_url, specialty, contact, active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [...v, active],
    )
  }

  for (const acc of ACCOUNTS) {
    await pglite.query(`insert into auth.users (id, email) values ($1, $2)`, [acc.id, acc.email])
    if (acc.role) {
      await pglite.query(
        `insert into public.profiles (user_id, name, role, section, active) values ($1, $2, $3, $4, $5)`,
        [acc.id, acc.name, acc.role, acc.section, acc.active],
      )
    }
    for (const st of acc.stations) {
      await pglite.query(`insert into public.staff_stations (user_id, station_code) values ($1, $2)`, [acc.id, st])
    }
  }

  const schema = await introspect(pglite)
  return { pglite, schema }
}

async function introspect(pglite) {
  const cols = await pglite.query(`
    select table_name, column_name, data_type, udt_name
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position
  `)
  const tables = new Map()
  for (const r of cols.rows) {
    let t = tables.get(r.table_name)
    if (!t) {
      t = { columns: new Map(), fksFrom: [], fksTo: [] }
      tables.set(r.table_name, t)
    }
    const isArray = r.data_type === 'ARRAY'
    const baseType = isArray ? r.udt_name.replace(/^_/, '') : r.udt_name
    t.columns.set(r.column_name, { name: r.column_name, udt: r.udt_name, baseType, isArray })
  }

  const fks = await pglite.query(`
    select
      c.conrelid::regclass::text as src_table,
      a1.attname as src_col,
      c.confrelid::regclass::text as dst_table,
      a2.attname as dst_col
    from pg_constraint c
    join pg_attribute a1 on a1.attrelid = c.conrelid and a1.attnum = c.conkey[1]
    join pg_attribute a2 on a2.attrelid = c.confrelid and a2.attnum = c.confkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
  `)
  const stripSchema = name => name.replace(/^public\./, '')
  for (const fk of fks.rows) {
    const src = stripSchema(fk.src_table)
    const dst = stripSchema(fk.dst_table)
    tables.get(src)?.fksFrom.push({ table: dst, localCol: fk.src_col, remoteCol: fk.dst_col })
    tables.get(dst)?.fksTo.push({ table: src, localCol: fk.dst_col, remoteCol: fk.src_col })
  }

  const procs = await pglite.query(`
    select
      p.proname,
      p.proretset,
      p.prorettype::regtype::text as ret_type,
      p.proargnames,
      p.proargmodes,
      (select coalesce(array_agg(t::regtype::text order by i), '{}')
       from unnest(p.proargtypes) with ordinality as a(t, i)) as arg_types
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
    order by p.proname
  `)
  const rpcs = new Map()
  for (const p of procs.rows) {
    const names = p.proargnames ?? []
    const modes = p.proargmodes
    const inNames = []
    if (modes) {
      for (let i = 0; i < modes.length; i++) {
        if (modes[i] === 'i' || modes[i] === 'b' || modes[i] === 'v') inNames.push(names[i])
      }
    } else {
      for (let i = 0; i < p.arg_types.length; i++) inNames.push(names[i] ?? `arg_${i + 1}`)
    }
    const args = p.arg_types.map((type, i) => ({ name: inNames[i] ?? `arg_${i + 1}`, type }))
    const list = rpcs.get(p.proname) ?? []
    list.push({ name: p.proname, args, returnsVoid: p.ret_type === 'void', returnsSet: p.proretset })
    rpcs.set(p.proname, list)
  }

  return { tables, rpcs }
}

export async function createLocalDb() {
  let state = await initInstance()
  let queue = Promise.resolve()

  const serialize = fn => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  return {
    get schema() {
      return state.schema
    },
    withTx(uid, fn) {
      return serialize(async () => {
        const { pglite, schema } = state
        await pglite.exec('begin')
        try {
          const role = uid ? 'authenticated' : 'anon'
          await pglite.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ''])
          await pglite.exec(`set local role ${role}`)
          const result = await fn(pglite, schema)
          await pglite.exec('commit')
          return result
        } catch (err) {
          await pglite.exec('rollback').catch(() => {})
          throw err
        }
      })
    },
    execSuper(sql, params = []) {
      return serialize(() => state.pglite.query(sql, params))
    },
    reset() {
      return serialize(async () => {
        await state.pglite.close()
        state = await initInstance()
      })
    },
    close() {
      return serialize(() => state.pglite.close())
    },
  }
}
