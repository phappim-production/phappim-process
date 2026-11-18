-- สถานะเวลามาตรฐานของทุกงานที่กำลังทำ ให้การ์ดบนบอร์ด / ต้องทำตอนนี้ เป็นสีส้ม-แดงได้
-- QA รอบ 5 (G7 ข้อสังเกต 4): เดิมเห็นแถบส้ม/แดงเฉพาะในรายละเอียดงาน คนหน้างานต้องเปิดทีละงานถึงรู้ว่าต้องรายงานก่อนกดเสร็จ
-- อ่านอย่างเดียว · ใช้ private.sla_state ตัวเดียวกับที่ finish_station ใช้บล็อกปุ่มเสร็จ ตัวเลขจึงตรงกันเสมอ

create or replace function public.job_sla_flags()
returns table (job_id uuid, warn boolean, over boolean, need_report boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  return query
  select j.id,
    coalesce((s->>'station_warn')::boolean, false) or coalesce((s->>'segment_warn')::boolean, false),
    coalesce((s->>'station_over')::boolean, false) or coalesce((s->>'segment_over')::boolean, false),
    (coalesce((s->>'station_over')::boolean, false) and not coalesce((s->>'station_reported')::boolean, false))
      or (coalesce((s->>'segment_over')::boolean, false) and not coalesce((s->>'segment_reported')::boolean, false))
  from public.jobs j
  cross join lateral private.sla_state(j.id) s
  where j.phase = 'production' and j.station_status in ('doing', 'hold')
    and (s ? 'station_days' or s ? 'segment_days');
end $$;

revoke all on function public.job_sla_flags() from public, anon;
grant execute on function public.job_sla_flags() to authenticated;
