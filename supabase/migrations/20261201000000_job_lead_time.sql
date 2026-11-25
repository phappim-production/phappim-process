-- เวลาผลิตทั้งงานตามจำนวน (1–499 = 10 · 500–999 = 15 · 1,000 ขึ้นไป = 20 วันทำงาน จันทร์–เสาร์ นับวันรับงานเป็นวันที่ 1) แทนเวลามาตรฐานรายสถานี/ช่วง
-- ใช้ไป 80% = เตือน · เกิน = แจ้งเตือน + ต้องรายงานสาเหตุก่อนกด QC + Packing เสร็จ

create or replace function private.lead_days(p_qty int) returns int
language sql immutable set search_path = '' as $$
  select case when p_qty >= 1000 then 20 when p_qty >= 500 then 15 else 10 end
$$;

-- รับงานวันอาทิตย์ นับวันที่ 1 เป็นวันจันทร์
create or replace function private.lead_day_n(p_start date, p_n int) returns date
language sql immutable set search_path = '' as $$
  select d::date from generate_series(p_start::timestamp, (p_start + greatest(p_n, 1) * 2 + 1)::timestamp, interval '1 day') d
  where extract(isodow from d) <> 7 order by d offset greatest(p_n, 1) - 1 limit 1
$$;

create or replace function private.lead_used(p_start date, p_end date) returns int
language sql immutable set search_path = '' as $$
  select count(*)::int from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') d
  where extract(isodow from d) <> 7
$$;

-- งานที่แบ่งใบ ใช้วันรับงานของงานแม่ และจำนวนรวมทั้งครอบครัว (แบ่งแล้วกำหนดไม่เปลี่ยน)
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
  where f.id in (select fam.id from fam) and f.phase <> 'cancelled';

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

create or replace function private.sla_state_api(p_job uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.my_role() is null then '{}'::jsonb else private.lead_state(p_job) end
$$;

create or replace function public.finish_station(p_job uuid, p_station text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; miss text[]; lead jsonb; v_last int; next_seq int; r text;
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.station_status is distinct from 'doing' then
    if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อน' using errcode = 'P0001'; end if;
    perform private.stale('สถานีนี้ยังไม่ได้เริ่มหรือเสร็จไปแล้ว');
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  -- คำขอจากหน้าสถานีเดิมที่ส่งช้า/ซ้ำ ต้องไม่จบสถานีถัดไปที่เพิ่งเริ่ม
  if p_station is not null and p_station is distinct from cur then
    perform private.stale('งานนี้ไปอยู่สถานีอื่นแล้ว');
  end if;
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC กดเสร็จได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;

  miss := private.missing_substeps(p_job);
  if cardinality(miss) > 0 then
    raise exception 'ยังกดเสร็จไม่ได้: %', array_to_string(miss, ' · ') using errcode = 'P0001';
  end if;

  v_last := private.last_seq(j.route_code);
  if j.is_rework and cur <> 'qc_pack' then
    next_seq := v_last;                       -- งานแก้เสร็จ กลับ QC ทันที
  elsif j.station_seq < v_last then
    next_seq := j.station_seq + 1;
  end if;

  lead := private.lead_state(p_job);
  if next_seq is null and j.phase = 'production' and coalesce((lead->>'lead_over')::boolean, false)
     and not coalesce((lead->>'lead_reported')::boolean, false) then
    raise exception 'งานนี้เกินเวลาผลิต % วันทำงาน (ครบ %) · ส่งรายงานสาเหตุที่ช้าก่อนกด QC + Packing เสร็จ',
      lead->>'lead_days', private.thai_date((lead->>'lead_due')::date) using errcode = 'P0001';
  end if;

  perform private.log(p_job, 'station_done', j.phase, cur, jsonb_build_object('visit', j.visit, 'rework', j.is_rework, 'lead', lead));

  if next_seq is not null then
    perform private.enter_station(p_job, next_seq);
  elsif j.phase = 'sample' then
    update public.jobs set phase = 'sample_review', station_seq = null, station_status = null,
      station_started_at = null, stage_entered_at = now() where id = p_job;
    perform private.log(p_job, 'sample_sent', 'sample', null, jsonb_build_object('round', j.sample_round));
  else
    update public.jobs set phase = 'done', station_seq = null, station_status = null, station_started_at = null,
      is_rework = false, rework_qty = null, finished_at = now(), stage_entered_at = now() where id = p_job;
    perform private.log(p_job, 'done', 'done', null);
  end if;
end $$;

create or replace function public.submit_delay_report(p_job uuid, p_reasons text[], p_detail text, p_new_eta timestamptz,
                                                      p_need_help text default null, p_request uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; bad text[]; v_id bigint; prev text;
begin
  perform private.require_role('supervisor', 'qc', 'admin', 'production');
  j := private.lock_job(p_job);
  prev := private.claim_request(p_request, 'submit_delay_report');
  if prev is not null then return nullif(prev, '')::bigint; end if;
  if j.phase in ('done', 'cancelled') then perform private.stale('งานนี้ปิดแล้ว'); end if;
  if j.develop then raise exception 'งาน Develop ไม่มีเวลาผลิต ไม่ต้องรายงานล่าช้า' using errcode = 'P0001'; end if;
  if p_reasons is null or cardinality(p_reasons) = 0 then raise exception 'ต้องเลือกรหัสสาเหตุอย่างน้อย 1 ข้อ' using errcode = '23514'; end if;
  select array_agg(x) into bad from unnest(p_reasons) x
  where not exists (select 1 from public.reason_codes c where c.code = x and c.active);
  if bad is not null then raise exception 'รหัสสาเหตุไม่ถูกต้อง: %', array_to_string(bad, ', ') using errcode = '23514'; end if;
  if coalesce(trim(p_detail), '') = '' then raise exception 'ต้องอธิบายว่าเกิดอะไรขึ้น' using errcode = '23514'; end if;
  if p_new_eta is null or p_new_eta <= now() then raise exception 'ต้องระบุวันเวลาที่คาดว่าจะเสร็จใหม่ (หลังจากตอนนี้)' using errcode = '23514'; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  insert into public.delay_reports (job_id, visit, station_code, segment_code, reasons, detail, new_eta, need_help, by)
  values (p_job, j.visit, cur, null, p_reasons, trim(p_detail), p_new_eta, nullif(trim(p_need_help), ''), auth.uid())
  returning id into v_id;
  perform private.log(p_job, 'delay_report', j.phase, cur,
    jsonb_build_object('report_id', v_id, 'reasons', p_reasons, 'new_eta', p_new_eta));
  perform private.finish_request(p_request, v_id::text);
  return v_id;
end $$;

drop function public.job_sla_flags();
create function public.job_sla_flags()
returns table (job_id uuid, warn boolean, over boolean, need_report boolean, lead_days int, lead_due date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  return query
  select j.id,
    coalesce((s->>'lead_warn')::boolean, false),
    coalesce((s->>'lead_over')::boolean, false),
    coalesce((s->>'lead_over')::boolean, false) and not coalesce((s->>'lead_reported')::boolean, false),
    (s->>'lead_days')::int,
    (s->>'lead_due')::date
  from public.jobs j
  cross join lateral private.lead_state(j.id) s
  where j.phase not in ('done', 'cancelled') and not j.develop;
end $$;
revoke all on function public.job_sla_flags() from public, anon;
grant execute on function public.job_sla_flags() to authenticated;

create or replace function private.inbox_scan_all() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_added integer := 0;
  j record;
  v_lead jsonb;
  v_depts text[];
  v_qty text;
begin
  for j in
    select jb.*, pt.name as product_name
    from public.jobs jb
    join public.product_types pt on pt.code = jb.product_type_code
    where jb.phase not in ('done', 'cancelled')
  loop
    v_qty := to_char(j.qty, 'FM999,999,999');

    v_lead := private.lead_state(j.id);
    if coalesce((v_lead->>'lead_over')::boolean, false) and not coalesce((v_lead->>'lead_reported')::boolean, false) then
      if private.inbox_emit('sla_over', j.id, 'lead:' || j.id,
        'เกินเวลาผลิต ' || j.confirmation_no,
        format('%s · %s %s %s · รับงาน %s · เวลาผลิต %s วันทำงาน ครบ %s · ต้องส่งรายงานสาเหตุก่อนกด QC + Packing เสร็จ',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date((v_lead->>'lead_start')::date),
          v_lead->>'lead_days', private.thai_date((v_lead->>'lead_due')::date)),
        array['production', 'admin', 'manager'])
      then v_added := v_added + 1; end if;
    end if;

    if private.uses_film(j.route_code) and j.dtf_film_received_at is null and j.dtf_film_eta is not null and v_today > j.dtf_film_eta then
      if private.inbox_emit('film_late', j.id, 'film:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        private.film_label(j.route_code) || ' เลยกำหนด ' || j.confirmation_no,
        format('%s · %s %s %s · กำหนดรับ %s · กรุณาติดตาม%s',
          j.customer_name, j.product_name, v_qty, j.unit, to_char(j.dtf_film_eta, 'DD/MM/YYYY'), private.film_label(j.route_code)),
        array['admin', 'production'])
      then v_added := v_added + 1; end if;
    end if;

    if j.phase = 'materials' and private.work_days(j.stage_entered_at, now()) > 2 then
      select array_agg(distinct m.dept) into v_depts
      from public.job_materials m where m.job_id = j.id and m.checked_at is null;
      if v_depts is not null and cardinality(v_depts) > 0 then
        if private.inbox_emit('materials_late', j.id, 'mat:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
          'รอตรวจวัตถุดิบเกิน 2 วัน ' || j.confirmation_no,
          format('%s · %s %s %s · กรุณาตรวจเช็กวัตถุดิบเพื่อปล่อยงาน%s',
            j.customer_name, j.product_name, v_qty, j.unit,
            case when j.needs_sample then 'ขึ้นตัวอย่าง' else 'เข้าผลิต' end),
          v_depts)
        then v_added := v_added + 1; end if;
      end if;
    end if;

    if j.due_date in (v_today, v_today + 1) then
      if private.inbox_emit('due_soon', j.id, 'due:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        case when j.due_date = v_today then 'ครบกำหนดส่งวันนี้ ' else 'ครบกำหนดส่งพรุ่งนี้ ' end || j.confirmation_no,
        format('%s · %s %s %s · กำหนดส่ง %s',
          j.customer_name, j.product_name, v_qty, j.unit, to_char(j.due_date, 'DD/MM/YYYY')),
        array['production', 'admin', 'manager'])
      then v_added := v_added + 1; end if;
    end if;
  end loop;

  return v_added;
end $$;

drop function private.sla_state(uuid);
drop function private.sla_for_qty(numeric, int, numeric, int);
drop function private.segment_of(text, text);
drop function private.hold_days(uuid, timestamptz);
drop function private.requeue_wait_days(uuid, timestamptz);
drop function private.first_piece_wait_days(uuid, timestamptz);

revoke all on function private.lead_days(int) from public, anon, authenticated;
revoke all on function private.lead_day_n(date, int) from public, anon, authenticated;
revoke all on function private.lead_used(date, date) from public, anon, authenticated;
revoke all on function private.lead_state(uuid, date) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.finish_station(uuid,text)', 'public.submit_delay_report(uuid,text[],text,timestamptz,text,uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
