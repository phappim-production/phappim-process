-- ยกเลิกบางส่วนของงานที่แบ่งใบ เวลาผลิตของส่วนที่เหลือไม่หดย้อนหลัง (นับจำนวนของส่วนที่ยกเลิกด้วย เหมือนแก้ใบยืนยัน)

-- งานที่แบ่งใบ ใช้วันรับงานของงานแม่ และจำนวนรวมทั้งครอบครัวรวมส่วนที่ยกเลิก (แบ่งหรือยกเลิกบางส่วนแล้วกำหนดไม่เปลี่ยน)
create or replace function private.lead_state(p_job uuid, p_today date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  j public.jobs; r public.jobs;
  v_qty int; v_days int; v_start date; v_end date; v_due date; v_warn_on date; v_reported boolean;
begin
  select * into j from public.jobs where id = p_job;
  if not found or j.develop or j.phase = 'cancelled' then return '{}'; end if;
  select * into r from public.jobs where id = private.split_root(p_job);
  with recursive fam(id, no, depth) as (
    select r.id, r.confirmation_no, 0
    union all
    select c.id, c.confirmation_no, fam.depth + 1 from fam
      join public.events e on e.type = 'job_split_from' and e.payload ->> 'parent' = fam.no
      join public.jobs c on c.id = e.job_id
    where fam.depth < 50
  )
  select coalesce(sum(f.qty), 0) into v_qty from public.jobs f
  where f.id in (select fam.id from fam);

  v_start := (r.created_at at time zone 'Asia/Bangkok')::date;
  v_days := private.lead_days(greatest(v_qty, j.qty));
  v_due := private.lead_day_n(v_start, v_days);
  v_warn_on := private.lead_day_n(v_start, ceil(v_days * 0.8)::int);
  v_end := case when j.phase = 'done' and j.finished_at is not null then (j.finished_at at time zone 'Asia/Bangkok')::date
                else coalesce(p_today, (now() at time zone 'Asia/Bangkok')::date) end;
  select exists (select 1 from private.split_lineage(j.id) l join public.delay_reports d on d.job_id = l.job_id
                 where d.at <= l.until and (d.at at time zone 'Asia/Bangkok')::date >= v_warn_on) into v_reported;
  return jsonb_build_object(
    'lead_qty', greatest(v_qty, j.qty), 'lead_days', v_days, 'lead_start', v_start, 'lead_due', v_due,
    'lead_warn_on', v_warn_on, 'lead_used', private.lead_used(v_start, v_end),
    'lead_warn', v_end >= v_warn_on, 'lead_over', v_end > v_due, 'lead_reported', v_reported);
end $$;
