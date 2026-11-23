import { writeFile } from 'node:fs/promises'
import { createLocalDb, ACCOUNTS } from '../qa-r14/db.mjs'

const db = await createLocalDb()
const rollback = new Error('rollback QA probe')
try {
  const { rows } = await db.execSuper(
    "select p.proname as rpc, pg_get_function_identity_arguments(p.oid) as signature, " +
    "pg_catalog.oidvectortypes(p.proargtypes) as types, p.prorettype::regtype::text as result_type, " +
    "has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated, " +
    "has_function_privilege('anon',p.oid,'EXECUTE') as anon " +
    "from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
    "where n.nspname='public' and p.prokind='f' and not exists " +
    "(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') " +
    "order by p.proname,signature",
  )
  const accounts = [...ACCOUNTS.map(a => [a.key, a.id]), ['anon', null]]
  const grants = []
  for (const row of rows) {
    const cells = {}
    const args = row.types ? row.types.split(', ').map(type => 'null::' + type).join(', ') : ''
    for (const [actor, id] of accounts) {
      const execute = id ? row.authenticated : row.anon
      if (row.result_type === 'trigger') {
        cells[actor] = { execute, status: 'trigger' }
        continue
      }
      try {
        await db.withTx(id, async sql => {
          await sql.query('select public.' + row.rpc + '(' + args + ')')
          throw rollback
        })
      } catch (error) {
        cells[actor] = error === rollback
          ? { execute, status: 'accepted' }
          : { execute, status: error.code ?? 'error', message: error.message }
      }
    }
    grants.push({ rpc: row.rpc, signature: row.signature, cells })
  }
  await writeFile(process.argv[2], JSON.stringify({ accounts: accounts.map(([actor]) => actor), grants }, null, 2))
  console.log('SQL EXECUTE and empty-input probes', {
    signatures: rows.length, accounts: accounts.length,
    triggerOnly: rows.filter(row => row.result_type === 'trigger').length,
    calls: rows.filter(row => row.result_type !== 'trigger').length * accounts.length,
  })
} finally {
  await db.close()
}
