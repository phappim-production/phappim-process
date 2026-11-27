// ฐานจำลองใช้ now() จริงเปลี่ยนไม่ได้ · "เลื่อนวัน" = ถอยเวลาทุกช่องวันที่ในข้อมูลไป 1 วัน (ปิด trigger ชั่วคราว)
const DATE_TYPES = ['date', 'timestamp with time zone', 'timestamp without time zone']

export function createClock(client) {
  let columns = null
  let shiftedDays = 0

  async function loadColumns() {
    columns = await client.sql(`
      select c.table_schema s, c.table_name t, c.column_name col, c.data_type typ
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema in ('public', 'private') and c.data_type = any($1)
      order by 1, 2, 3`, [DATE_TYPES])
  }

  async function advanceDays(days = 1) {
    if (!columns) await loadColumns()
    const byTable = new Map()
    for (const c of columns) {
      const key = `"${c.s}"."${c.t}"`
      if (!byTable.has(key)) byTable.set(key, [])
      byTable.get(key).push(c.typ === 'date' ? `"${c.col}" = "${c.col}" - ${days}` : `"${c.col}" = "${c.col}" - interval '${days} day'`)
    }
    await client.sql('set session_replication_role = replica')
    try {
      for (const [table, sets] of byTable) await client.sql(`update ${table} set ${sets.join(', ')}`)
    } finally {
      await client.sql('set session_replication_role = origin')
    }
    shiftedDays += days
  }

  return { advanceDays, get shiftedDays() { return shiftedDays } }
}

export const thaiToday = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)

export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// เหมือน private.work_days: นับเวลาจริงเป็นวัน เฉพาะ จ.–ส. ตามเวลาไทย
export function workDays(from, to) {
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (!(b > a)) return 0
  let total = 0
  const dayMs = 86_400_000
  let start = Math.floor((a + 7 * 3600_000) / dayMs) * dayMs - 7 * 3600_000
  for (; start < b; start += dayMs) {
    const dow = new Date(start + 7 * 3600_000).getUTCDay()
    if (dow === 0) continue
    const lo = Math.max(a, start)
    const hi = Math.min(b, start + dayMs)
    if (hi > lo) total += (hi - lo) / dayMs
  }
  return total
}
