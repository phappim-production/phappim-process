#!/bin/sh
# ลองกู้ไฟล์สำรอง (.dump จาก db-backup) ลง Postgres เปล่า แล้วพิมพ์จำนวนแถวทุกตารางไว้เทียบกับระบบจริง
# ไฟล์สำรองมีแค่ schema public · ฟังก์ชันใน private ไม่อยู่ในไฟล์ → สร้างโครงสร้างจาก migrations ก่อน แล้วกู้เฉพาะข้อมูล
# วิธีใช้ (Docker · ดู docs/กู้คืนข้อมูลสำรอง.md):
#   docker run -d --name pp142-restore -e POSTGRES_PASSWORD=x -v <โฟลเดอร์ที่มี .dump>:/backup -v <repo>/supabase:/supabase postgres:17
#   docker exec pp142-restore sh /supabase/restore/restore.sh /backup/pp142-YYYYMMDD.dump
set -e
DUMP="$1"
[ -f "$DUMP" ] || { echo "ใช้: restore.sh <ไฟล์ .dump>"; exit 1; }
DB=restore_check
until pg_isready -U postgres -q; do sleep 1; done
psql -U postgres -q -c "drop database if exists $DB" -c "create database $DB"
psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f /supabase/restore/stub.sql
for f in $(ls /supabase/migrations/*.sql | sort); do
  psql -U postgres -d $DB -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "migration ไม่ผ่าน: $f"; exit 1; }
done
echo "migrations ครบ"
# 17 ตารางอ้าง auth.users · ระบบจริงต้องสร้างผู้ใช้ใหม่ด้วย UUID เดิม (ดูเอกสาร) · ที่นี่ใส่ UUID จาก profiles แทน
pg_restore -f - --data-only -t profiles "$DUMP" | awk '/^COPY/{f=1;next} /^\\\./{f=0} f{print $1}' > /tmp/ids
while read id; do psql -U postgres -d $DB -q -c "insert into auth.users(id) values ('$id') on conflict do nothing"; done < /tmp/ids
echo "ผู้ใช้จาก profiles: $(wc -l < /tmp/ids)"
# migrations ใส่ข้อมูลตั้งค่าเริ่มต้นไว้ · ล้างก่อนให้ข้อมูลจากไฟล์สำรองแทนทั้งหมด
tables=$(psql -U postgres -d $DB -At -c "select string_agg(format('public.%I', tablename), ',') from pg_tables where schemaname='public'")
psql -U postgres -d $DB -q -c "truncate $tables cascade"
# ปิด trigger ระหว่างกู้ (events ห้ามแก้ · กฎตรวจค่า) เพราะข้อมูลผ่านกฎมาแล้วตอนบันทึกจริง
pg_restore -U postgres -d $DB --data-only --disable-triggers --no-owner "$DUMP"
echo "กู้ข้อมูลครบ · จำนวนแถว:"
psql -U postgres -d $DB -At -c "$(psql -U postgres -d $DB -At -c "select string_agg(format('select %L, count(*) from public.%I', tablename, tablename), ' union all ' order by tablename) from pg_tables where schemaname='public'")"
psql -U postgres -d $DB -At -c "select 'job_live', count(*) from job_live" -c "select 'ฟังก์ชัน private', count(*) from pg_proc where pronamespace = 'private'::regnamespace"
