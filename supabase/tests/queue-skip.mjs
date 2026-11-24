const reason = 'งานของชุดทดสอบอื่นรอคิวอยู่'
const startCall = /public\.start_(?:station|sewing)\(\s*'([0-9a-f-]{36})'/g

// ต้องตรงกับเงื่อนไขที่ start_station ปฏิเสธงานที่ไม่ใช่คิวแรก (20261128000000_sweep_fixes.sql) ทุกตัวอักษร
const queueBlocks = `j.phase in ('sample', 'production') and private.queue_ahead(j) is not null
  and not exists (select 1 from public.events e where e.job_id = j.id and e.type = 'queue_skip'
    and e.station_code = private.station_at(j.route_code, j.station_seq)
    and ((e.payload ->> 'visit')::int = j.visit or (not e.payload ? 'visit' and e.at >= j.stage_entered_at)))`

const insertSkip = `insert into public.events (job_id, type, phase, station_code, payload, by)
  select j.id, 'queue_skip', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('reason', $3::text, 'ahead', to_jsonb(private.queue_ahead(j)), 'visit', j.visit), $2
  from public.jobs j
  where j.id = $1 and j.station_status = 'queued' and ${queueBlocks}
  returning id`

export const startsJob = name => name === 'start_station' || name === 'start_sewing'

export function queueSkips(db, suite) {
  let starts = 0
  let skips = 0
  const blocked = async id =>
    (await db.query(`select ${queueBlocks} as blocked from public.jobs j where j.id = $1`, [id])).rows[0]?.blocked === true
  const before = async (id, note) => {
    starts++
    if (await blocked(id) && await note()) skips++
  }
  return {
    before,
    async beforeSql(as, uid, sql) {
      for (const [, id] of sql.matchAll(startCall)) {
        await before(id, async () => {
          try {
            return (await as(uid, () => db.query('select public.note_queue_skip($1, $2) as noted', [id, reason]))).rows[0].noted === true
          } catch { return false /* เริ่มไม่ได้อยู่แล้ว: ให้คำสั่งจริงเป็นคนตอบ */ }
        })
      }
    },
    async insert(id, by) {
      starts++
      if ((await db.query(insertSkip, [id, by, reason])).rows.length) skips++
    },
    report: () => console.log(`${suite}: queue skip needed: ${skips} of ${starts} starts`),
  }
}
