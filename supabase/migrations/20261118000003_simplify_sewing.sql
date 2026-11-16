-- งานเย็บใช้การยืนยันเสร็จครั้งเดียว ส่วนสถานีอื่นตรวจขั้นย่อยตามเดิม
create or replace function private.missing_substeps(p_job uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs; cur text; sub jsonb; k text; kind text; ok boolean; miss text[] := '{}';
begin
  select * into j from public.jobs where id = p_job;
  cur := private.station_at(j.route_code, j.station_seq);
  if cur = 'sew' or (j.is_rework and cur <> 'qc_pack') then return miss; end if;
  for sub in select s from public.stations st, jsonb_array_elements(st.substeps) s where st.code = cur loop
    k := sub->>'key'; kind := sub->>'kind';
    if j.phase = 'sample' and (kind <> 'req' or cur = 'qc_pack') then continue; end if;
    if kind not in ('req', 'num', 'appr', 'lock') then continue; end if;
    ok := case
      when kind = 'lock' then j.dtf_film_received_at is not null
      when k = 'sew_count' then j.sew_count >= j.qty
      when k = 'first_piece' then j.first_piece_ok
      when cur = 'qc_pack' and k = 'inspect' then
        coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0) >= j.qty
      else exists (select 1 from public.job_substeps s
                   where s.job_id = j.id and s.visit = j.visit and s.station_code = cur and s.substep_key = k)
    end;
    if not ok then miss := miss || (sub->>'name'); end if;
  end loop;
  return miss;
end $$;

create or replace function public.finish_sewing(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_sewing_supervisor();
  j := private.lock_job(p_job);
  if private.station_at(j.route_code, j.station_seq) is distinct from 'sew' then
    perform private.stale('งานออกจากสถานีเย็บแล้ว');
  end if;
  perform public.finish_station(p_job);
end $$;

-- ปัญหาที่แก้ได้ระหว่างเย็บบันทึกในไทม์ไลน์ ส่วนปัญหาที่ต้องหยุดใช้ประวัติพักงานเดิม
create or replace function public.report_sewing_issue(p_job uuid, p_reason text, p_pause boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; detail text := nullif(btrim(p_reason, E' \n\r\t'), '');
begin
  perform private.require_sewing_supervisor();
  j := private.lock_job(p_job);
  if private.station_at(j.route_code, j.station_seq) is distinct from 'sew' or j.station_status is distinct from 'doing' then
    perform private.stale('งานนี้ไม่ได้กำลังเย็บ');
  end if;
  if detail is null then raise exception 'กรุณาระบุปัญหาที่พบ' using errcode = '23514'; end if;
  if p_pause then
    perform public.open_issue(p_job, detail);
  else
    perform private.log(p_job, 'sewing_issue_reported', j.phase, 'sew', jsonb_build_object('reason', detail, 'visit', j.visit));
  end if;
end $$;

-- จ่ายเฉพาะจักรที่ขาดและแก้พักในรายการเดียว หากขาดชนิดหนึ่งให้ย้อนทั้งรายการ
create or replace function public.resume_sewing(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n record; codes text[]; picked text[] := '{}';
begin
  perform private.require_sewing_supervisor();
  j := private.lock_job(p_job);
  if private.station_at(j.route_code, j.station_seq) is distinct from 'sew' or j.station_status is distinct from 'hold' then
    perform private.stale('งานนี้ไม่ได้พักอยู่ที่สถานีเย็บ');
  end if;
  for n in select s.type_code, s.short, t.name from private.machines_short(p_job) s
           join public.machine_types t on t.code = s.type_code where s.short > 0 order by t.sort, t.code loop
    select array_agg(code order by code) into codes from (
      select m.code from public.sewing_machines m
      where m.type_code = n.type_code and m.status = 'ready'
        and not exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null)
        and private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is null
      order by m.code limit n.short for update of m
    ) available;
    if coalesce(cardinality(codes), 0) < n.short then
      raise exception 'จักรไม่ครบ เย็บต่อไม่ได้: ขาด % % ตัว', n.name, n.short - coalesce(cardinality(codes), 0) using errcode = 'P0001';
    end if;
    picked := picked || codes;
  end loop;
  if cardinality(picked) > 0 then perform public.assign_machines(p_job, picked); end if;
  perform public.close_issue(p_job);
end $$;

revoke all on function public.finish_sewing(uuid), public.report_sewing_issue(uuid, text, boolean), public.resume_sewing(uuid) from public, anon;
grant execute on function public.finish_sewing(uuid), public.report_sewing_issue(uuid, text, boolean), public.resume_sewing(uuid) to authenticated;
