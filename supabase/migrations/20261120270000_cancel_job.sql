-- ยกเลิกงาน (ลูกค้ายกเลิกออเดอร์) เฉพาะผู้บริหาร ต้องใส่เหตุผล · คืนจักร ยกเลิกการจอง ปิดปัญหาที่ค้าง · ลง events + แจ้งกล่องจดหมาย
-- ยกเลิกแล้วย้อนกลับไม่ได้ · งานที่อยู่บริษัทภายนอกต้องรับของกลับก่อน

alter table public.inbox_messages drop constraint inbox_messages_kind_check;
alter table public.inbox_messages add constraint inbox_messages_kind_check check (kind in (
  'hold', 'delay_report', 'rework', 'sewing_issue', 'machine_broken',
  'sample_failed', 'sla_over', 'film_late', 'materials_late', 'due_soon',
  'mockup_pending', 'mockup_returned', 'mockup_approved', 'job_cancelled'
));
insert into public.inbox_settings (kind, enabled) values ('job_cancelled', true) on conflict (kind) do nothing;

create or replace function public.cancel_job(p_job uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; st text; closed_issues int;
begin
  perform private.require_role('manager');
  j := private.lock_job(p_job);
  if j.phase = 'cancelled' then perform private.stale('งานนี้ถูกยกเลิกไปแล้ว'); end if;
  if j.phase = 'done' then
    raise exception 'งาน % ผลิตเสร็จแล้ว ยกเลิกไม่ได้', j.confirmation_no using errcode = 'P0001';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'ใส่เหตุผลที่ยกเลิกงาน เช่น ลูกค้ายกเลิกออเดอร์' using errcode = '23514';
  end if;
  if j.station_status = 'out' then
    raise exception 'งาน % อยู่ที่บริษัทภายนอก ให้แอดมินกด "รับของกลับ" ก่อน แล้วค่อยยกเลิก', j.confirmation_no
      using errcode = 'P0001';
  end if;
  st := private.station_at(j.route_code, j.station_seq);

  update public.issues set closed_at = now(), closed_by = (select auth.uid())
    where job_id = p_job and closed_at is null;
  get diagnostics closed_issues = row_count;
  update public.jobs set phase = 'cancelled', station_seq = null, station_status = null, station_started_at = null
    where id = p_job;
  update public.machine_assignments set released_at = now(), released_by = (select auth.uid())
    where job_id = p_job and released_at is null;
  update public.machine_bookings set ends_at = now()
    where job_id = p_job and cancelled_at is null and starts_at < now() and ends_at > now();
  update public.machine_bookings set cancelled_at = now(), cancelled_by = (select auth.uid())
    where job_id = p_job and cancelled_at is null and starts_at >= now();

  perform private.log(p_job, 'job_cancelled', j.phase, st, jsonb_build_object(
    'reason', trim(p_reason), 'station_status', j.station_status, 'issues_closed', closed_issues));

  begin
    perform private.inbox_emit('job_cancelled', j.id, 'cancel:' || j.id,
      'ยกเลิกงาน ' || j.confirmation_no,
      format('%s · %s · เหตุผล: %s · หยุดทำงานนี้ทุกสถานี', j.customer_name, j.job_name, trim(p_reason)),
      array['admin', 'production', 'supervisor', 'qc', 'manager']);
  exception when others then
    perform private.inbox_log_error('cancel_job', sqlerrm);
  end;
end $$;

revoke all on function public.cancel_job(uuid, text) from public, anon;
grant execute on function public.cancel_job(uuid, text) to authenticated;
