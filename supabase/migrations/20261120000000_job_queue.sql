-- คิวงาน: งานเรียงตามลำดับที่รับเข้าเสมอ (เจ้าของสั่ง 18 พ.ย. "อย่ามั่วคิวเด็ดขาด")
-- งานด่วน = แทรกคิว (หัวหน้าฝ่ายผลิต / ผู้บริหาร / เจ้าของ · ต้องมีเหตุผล) ไม่ใช่เรียงตามกำหนดส่งเอง
-- สถานีเริ่มงานที่ไม่ใช่คิวแรกได้ แต่ต้องบันทึกเหตุผล (เจ้าของเลือก "แค่เรียง + เตือน")

-- 1. ลำดับคิว · numeric เพื่อแทรกระหว่างสองงานได้โดยไม่ต้องเลื่อนเลขงานอื่น
create sequence public.job_queue_seq;
alter table public.jobs add column queue_seq numeric;
update public.jobs j set queue_seq = q.n
from (select id, row_number() over (order by created_at, id) as n from public.jobs) q
where q.id = j.id;
select setval('public.job_queue_seq', coalesce((select max(queue_seq)::bigint from public.jobs), 0) + 1, false);
alter table public.jobs alter column queue_seq set default nextval('public.job_queue_seq');
alter table public.jobs alter column queue_seq set not null;
create index jobs_queue_idx on public.jobs (queue_seq);
-- เลขคิวออกโดยฐานข้อมูลเท่านั้น (สร้างงานผ่าน receive_job)
revoke all on sequence public.job_queue_seq from public, anon, authenticated;

-- j.* ใน view ขยายตอนสร้าง → ต้องสร้างใหม่ให้มี queue_seq (นิยามเดิมจาก 20261119000001)
drop view public.job_live;
create view public.job_live with (security_invoker = true) as
select j.*,
  rs.station_code                                    as current_station,
  s.name                                             as current_station_name,
  private.last_seq(j.route_code)                     as last_seq,
  (select count(*) from public.job_materials m where m.job_id = j.id and m.checked_at is null)::int as materials_pending,
  (select array_agg(distinct m.dept) from public.job_materials m where m.job_id = j.id and m.checked_at is null) as materials_waiting_depts,
  (select i.reason from public.issues i where i.job_id = j.id and i.closed_at is null order by i.opened_at desc limit 1) as hold_reason,
  coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0)::int as qc_passed,
  private.sla_state_api(j.id)                        as sla
from public.jobs j
left join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq
left join public.stations s on s.code = rs.station_code;
revoke all on public.job_live from anon;
grant select on public.job_live to authenticated;

-- 2. แทรกงานด่วน: ย้าย p_job ไปอยู่ก่อน p_before (คิวทั้งโรงงาน)
create or replace function public.move_job_ahead(p_job uuid, p_before uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; b public.jobs; prev numeric; target numeric;
begin
  perform private.require_role('supervisor', 'manager');
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ใส่เหตุผลที่แทรกงานด่วน เช่น ลูกค้าเลื่อนวันส่งเร็วขึ้น' using errcode = 'P0001';
  end if;
  if p_job = p_before then raise exception 'เลือกงานที่จะแทรกก่อนให้เป็นงานอื่น' using errcode = 'P0001'; end if;
  j := private.lock_job(p_job);
  b := private.lock_job(p_before);
  if j.phase in ('done', 'cancelled') then raise exception 'งานนี้เสร็จหรือยกเลิกแล้ว แทรกคิวไม่ได้' using errcode = 'P0001'; end if;
  if b.phase in ('done', 'cancelled') then perform private.stale('งานที่จะแทรกก่อนเสร็จหรือยกเลิกแล้ว'); end if;
  if j.queue_seq < b.queue_seq then raise exception 'งาน % อยู่ก่อนงาน % ในคิวแล้ว', j.confirmation_no, b.confirmation_no using errcode = 'P0001'; end if;
  select max(queue_seq) into prev from public.jobs where queue_seq < b.queue_seq and id <> p_job;
  target := case when prev is null then b.queue_seq - 1 else (prev + b.queue_seq) / 2 end;
  update public.jobs set queue_seq = target where id = p_job;
  perform private.log(p_job, 'queue_insert', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('before', b.confirmation_no, 'reason', btrim(p_reason), 'from', j.queue_seq, 'to', target));
end $$;

-- 3. เริ่มงานข้ามคิว: บันทึกเหตุผลก่อนกดเริ่ม · คืน false = งานนี้เป็นคิวแรกอยู่แล้ว (ไม่บันทึก)
create or replace function public.note_queue_skip(p_job uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; ahead text[];
begin
  perform private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') or j.station_status is distinct from 'queued' then
    perform private.stale('งานไม่ได้รอเริ่มที่สถานี');
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  select array_agg(o.confirmation_no order by o.queue_seq) into ahead
  from public.jobs o
  where o.id <> j.id and o.phase in ('sample', 'production') and o.station_status = 'queued'
    and o.queue_seq < j.queue_seq and private.station_at(o.route_code, o.station_seq) = cur;
  if ahead is null then return false; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'งานนี้ไม่ใช่คิวแรก (คิวก่อนหน้า: %) ใส่เหตุผลที่เริ่มก่อน', array_to_string(ahead, ', ') using errcode = 'P0001';
  end if;
  perform private.log(p_job, 'queue_skip', j.phase, cur, jsonb_build_object('reason', btrim(p_reason), 'ahead', to_jsonb(ahead)));
  return true;
end $$;

revoke all on function public.move_job_ahead(uuid, uuid, text) from public, anon;
revoke all on function public.note_queue_skip(uuid, text) from public, anon;
grant execute on function public.move_job_ahead(uuid, uuid, text) to authenticated;
grant execute on function public.note_queue_skip(uuid, text) to authenticated;
