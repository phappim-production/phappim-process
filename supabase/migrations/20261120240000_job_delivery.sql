-- งานเสร็จแล้ว แอดมินบันทึกว่าจัดส่งให้ลูกค้าแล้ว (เลขพัสดุ / ผู้รับ) · กดผิดยกเลิกได้โดยใส่เหตุผล · ทั้งสองอย่างลง events
-- job_live สร้างใหม่เพื่อให้มีคอลัมน์จัดส่ง (view เก็บรายชื่อคอลัมน์ตอนสร้าง)

alter table public.jobs
  add column delivered_at timestamptz,
  add column delivered_by uuid references auth.users (id),
  add column delivery_note text;
create index jobs_delivered_by_idx on public.jobs (delivered_by);

create or replace function public.mark_delivered(p_job uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.phase <> 'done' then
    raise exception 'งานนี้ยังผลิตไม่เสร็จ บันทึกจัดส่งได้หลัง QC + Packing กดเสร็จ' using errcode = 'P0001';
  end if;
  if j.delivered_at is not null then perform private.stale('บันทึกจัดส่งไปแล้ว'); end if;
  update public.jobs set delivered_at = now(), delivered_by = (select auth.uid()), delivery_note = nullif(trim(p_note), '')
  where id = p_job;
  perform private.log(p_job, 'delivered', j.phase, null, jsonb_build_object('note', nullif(trim(p_note), '')));
end $$;

create or replace function public.undo_delivery(p_job uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.delivered_at is null then perform private.stale('งานนี้ยังไม่ได้บันทึกจัดส่ง'); end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'ใส่เหตุผลที่ยกเลิกการจัดส่ง เช่น กดผิดงาน ลูกค้ายังไม่ได้รับ' using errcode = '23514';
  end if;
  update public.jobs set delivered_at = null, delivered_by = null, delivery_note = null where id = p_job;
  perform private.log(p_job, 'delivery_undone', j.phase, null,
    jsonb_build_object('reason', trim(p_reason), 'delivered_at', j.delivered_at, 'note', j.delivery_note));
end $$;

revoke all on function public.mark_delivered(uuid, text), public.undo_delivery(uuid, text) from public, anon;
grant execute on function public.mark_delivered(uuid, text), public.undo_delivery(uuid, text) to authenticated;

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
