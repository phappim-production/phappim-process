// ชุดทดสอบใช้ฐานเดียวกัน งานรอคิวของชุดก่อนหน้าค้างอยู่ที่สถานี · ผู้กดบันทึกเหตุผลข้ามคิวก่อนเรียก start_station / start_sewing ตรง (กฎคิวทดสอบใน queue.mjs และ sweep-fixes.mjs)
export async function skipQueue(db, as, uid, sql) {
  for (const [, id] of sql.matchAll(/public\.start_(?:station|sewing)\(\s*'([0-9a-f-]{36})'/g)) {
    try {
      await as(uid, () => db.query('select public.note_queue_skip($1, $2)', [id, 'งานของชุดทดสอบอื่นรอคิวอยู่']))
    } catch { /* เริ่มไม่ได้อยู่แล้ว: ให้คำสั่งจริงเป็นคนตอบ */ }
  }
}

// ชุดที่เดินงานในธุรกรรมเดียวและเทียบ events ทีละคำสั่ง: ลงเหตุผลข้ามคิวตรงตารางก่อนจับภาพ events (คำสั่งที่ผิดพลาดจะทำธุรกรรมค้าง)
export const queueSkipSql = `insert into public.events (job_id, type, phase, station_code, payload, by)
  select j.id, 'queue_skip', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('reason', 'งานของชุดทดสอบอื่นรอคิวอยู่', 'ahead', to_jsonb(private.queue_ahead(j)), 'visit', j.visit), $2
  from public.jobs j
  where j.id = $1 and j.phase in ('sample', 'production') and j.station_status = 'queued' and private.queue_ahead(j) is not null`
export const startsDirect = name => name === 'start_station' || name === 'start_sewing'
