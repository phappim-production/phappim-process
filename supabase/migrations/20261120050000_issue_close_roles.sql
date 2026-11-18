-- ปิดปัญหา ("แก้แล้ว ทำต่อ") ได้เฉพาะฝ่ายผลิตและผู้บริหาร (เจ้าของระบบได้เสมอ)
-- เจ้าของ 18 พ.ย. 2569: แอดมินไม่มีหน้าที่แก้ปัญหาที่สถานีแจ้ง · ผู้บริหารเป็นคนตัดสิน ฝ่ายผลิตแก้ปัญหาเล็กเองได้
-- เดิม (20261117000001_workflow): ฝ่ายผลิต · QC · แอดมิน · เจ้าของ (ผู้บริหารกดไม่ได้)
-- แจ้งปัญหา / พักงาน (open_issue) ยังเปิดให้ทุกบทบาทเดิม เพื่อให้ใครเห็นปัญหาก็แจ้งได้

create or replace function public.close_issue(p_job uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; i public.issues; r text := private.my_role();
begin
  -- บอกผู้ใช้ว่าต้องให้ใครกด แทนข้อความบทบาททั่วไป
  if r in ('admin', 'qc') then
    raise exception 'แอดมินและฝ่าย QC ปิดปัญหาไม่ได้ · แจ้งผู้บริหารหรือฝ่ายผลิตให้กด "แก้แล้ว ทำต่อ"' using errcode = '42501';
  end if;
  perform private.require_role('supervisor', 'production', 'manager');
  j := private.lock_job(p_job);
  if j.station_status is distinct from 'hold' then perform private.stale('งานนี้ไม่ได้พักอยู่'); end if;
  select * into i from public.issues where job_id = p_job and closed_at is null order by opened_at desc limit 1;
  update public.issues set closed_at = now(), closed_by = auth.uid() where id = i.id;
  update public.jobs set station_status = coalesce(i.prev_status, 'queued') where id = p_job;
  perform private.log(p_job, 'resume', j.phase, i.station_code,
    jsonb_build_object('issue_id', i.id, 'note', nullif(trim(p_note), '')));
end $$;
