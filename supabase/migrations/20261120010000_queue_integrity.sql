-- คิวงานรอบแก้ (QA รอบ 4 · Codex C8 บั๊ก 1–4)
-- 1. แทรกซ้ำในช่วงเดิมหลายสิบครั้ง ค่าเฉลี่ย numeric ปัดจนเลขซ้ำ (ครั้งที่ 54) และหน้าเว็บแปลงเป็น Number ซ้ำก่อน (ครั้งที่ 47)
--    → เลขคิวเป็นจำนวนเต็มห่างกัน 1024 · แทรกใช้กึ่งกลางปัดลง · ช่องว่างหมด = จัดเลขใหม่ทั้งคิว (ลำดับเดิม) · ห้ามเลขซ้ำ
-- 2. เลขเสมอทำให้หน้าเว็บกับฐานข้อมูลเห็นคิวแรกต่างกัน → unique index ไม่ให้เกิดเลขเสมอ
-- 3. บันทึกเหตุผลข้ามคิวค้างทั้งที่เริ่มงานไม่สำเร็จ → start_in_queue ตรวจคิว + บันทึกเหตุผล + เริ่ม ในธุรกรรมเดียว

create or replace function private.queue_renumber() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- กันรับงานใหม่ (nextval) แทรกกลางระหว่างจัดเลข · อ่านได้ตามปกติ
  lock table public.jobs in exclusive mode;
  -- 2 ขั้นเพราะ unique index ตรวจทีละแถว: ย้ายไปช่วงที่ไม่มีใครใช้ก่อน แล้วค่อยลบออก
  with o as (select id, row_number() over (order by queue_seq, created_at, id) as n from public.jobs)
  update public.jobs j set queue_seq = o.n * 1024 + 1000000000000000 from o where o.id = j.id;
  update public.jobs set queue_seq = queue_seq - 1000000000000000;
  perform setval('public.job_queue_seq', coalesce((select max(queue_seq)::bigint from public.jobs), 0) + 1024, false);
end $$;
revoke all on function private.queue_renumber() from public, anon, authenticated;

drop index public.jobs_queue_idx;
alter sequence public.job_queue_seq increment by 1024;
select private.queue_renumber();
create unique index jobs_queue_seq_key on public.jobs (queue_seq);

-- แทรกงานด่วน (นิยามเดิมจาก 20261120000000 + เลขจำนวนเต็ม + จัดเลขใหม่เมื่อช่องว่างหมด + แทรกทีละคำขอ)
create or replace function public.move_job_ahead(p_job uuid, p_before uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; b public.jobs; prev numeric; target numeric;
begin
  perform private.require_role('supervisor', 'manager');
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ใส่เหตุผลที่แทรกงานด่วน เช่น ลูกค้าเลื่อนวันส่งเร็วขึ้น' using errcode = 'P0001';
  end if;
  if p_job = p_before then raise exception 'เลือกงานที่จะแทรกก่อนให้เป็นงานอื่น' using errcode = 'P0001'; end if;
  -- แทรกทีละคำขอ: สองคนแทรกช่องเดียวกันพร้อมกันจะได้เลขเดียวกัน
  perform pg_advisory_xact_lock(hashtext('pp142.job_queue'));
  j := private.lock_job(p_job);
  b := private.lock_job(p_before);
  if j.phase in ('done', 'cancelled') then raise exception 'งานนี้เสร็จหรือยกเลิกแล้ว แทรกคิวไม่ได้' using errcode = 'P0001'; end if;
  if b.phase in ('done', 'cancelled') then perform private.stale('งานที่จะแทรกก่อนเสร็จหรือยกเลิกแล้ว'); end if;
  if j.queue_seq < b.queue_seq then raise exception 'งาน % อยู่ก่อนงาน % ในคิวแล้ว', j.confirmation_no, b.confirmation_no using errcode = 'P0001'; end if;
  select max(queue_seq) into prev from public.jobs where queue_seq < b.queue_seq and id <> p_job;
  if prev is not null and b.queue_seq - prev < 2 then
    perform private.queue_renumber();
    select queue_seq into b.queue_seq from public.jobs where id = p_before;
    select max(queue_seq) into prev from public.jobs where queue_seq < b.queue_seq and id <> p_job;
  end if;
  target := case when prev is null then b.queue_seq - 1024 else floor((prev + b.queue_seq) / 2) end;
  update public.jobs set queue_seq = target where id = p_job;
  perform private.log(p_job, 'queue_insert', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('before', b.confirmation_no, 'reason', btrim(p_reason), 'from', j.queue_seq, 'to', target));
end $$;

-- งานที่รอเริ่มก่อนหน้างานนี้ที่สถานีเดียวกัน (ตรงกับ waitingAt ในหน้าเว็บ)
create or replace function private.queue_ahead(j public.jobs) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_agg(o.confirmation_no order by o.queue_seq)
  from public.jobs o
  where o.id <> j.id and o.phase in ('sample', 'production') and o.station_status = 'queued'
    and o.queue_seq < j.queue_seq
    and private.station_at(o.route_code, o.station_seq) = private.station_at(j.route_code, j.station_seq)
$$;
revoke all on function private.queue_ahead(public.jobs) from public, anon, authenticated;

-- เริ่มงานจากหน้าคิว: ไม่ใช่คิวแรกต้องมีเหตุผล · บันทึกเหตุผลเฉพาะเมื่อเริ่มสำเร็จ (ผิดพลาด = ย้อนทั้งหมด)
-- เย็บใช้ start_sewing (จ่ายจักร) · คืนรหัสจักรที่จ่าย · สถานีอื่นคืน null
create or replace function public.start_in_queue(p_job uuid, p_reason text) returns text[]
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; r text; ahead text[];
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') or j.station_status is distinct from 'queued' then
    perform private.stale('งานไม่ได้รอเริ่มที่สถานี');
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC เริ่มได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;
  ahead := private.queue_ahead(j);
  if ahead is not null then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'งานนี้ไม่ใช่คิวแรกแล้ว (คิวก่อนหน้า: %) กด "เริ่มก่อนคิว" แล้วใส่เหตุผล', array_to_string(ahead, ', ') using errcode = 'P0001';
    end if;
    perform private.log(p_job, 'queue_skip', j.phase, cur, jsonb_build_object('reason', btrim(p_reason), 'ahead', to_jsonb(ahead)));
  end if;
  if cur = 'sew' then return public.start_sewing(p_job); end if;
  perform public.start_station(p_job);
  return null;
end $$;

-- ตรวจข้ามคิวอย่างเดียว (นิยามเดิมจาก 20261120000000) · เพิ่ม: QC ตรวจได้เฉพาะ QC + Packing เหมือน start_station
create or replace function public.note_queue_skip(p_job uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; r text; ahead text[];
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') or j.station_status is distinct from 'queued' then
    perform private.stale('งานไม่ได้รอเริ่มที่สถานี');
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC เริ่มได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;
  ahead := private.queue_ahead(j);
  if ahead is null then return false; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'งานนี้ไม่ใช่คิวแรก (คิวก่อนหน้า: %) ใส่เหตุผลที่เริ่มก่อน', array_to_string(ahead, ', ') using errcode = 'P0001';
  end if;
  perform private.log(p_job, 'queue_skip', j.phase, cur, jsonb_build_object('reason', btrim(p_reason), 'ahead', to_jsonb(ahead)));
  return true;
end $$;

revoke all on function public.start_in_queue(uuid, text) from public, anon;
grant execute on function public.start_in_queue(uuid, text) to authenticated;
