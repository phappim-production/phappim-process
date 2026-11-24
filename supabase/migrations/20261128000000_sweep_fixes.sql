-- แก้บั๊กจากการตรวจทั้งระบบ 24 พ.ย.: เวลามาตรฐานของงานที่แบ่ง/กลับเข้าคิว · กฎคิวบังคับทุกทางเริ่ม · จักรและการจองค้าง · ข้อความสูตรจักร · แก้ใบงานแก้
-- ประสิทธิภาพ: index ของ path ไฟล์และ events · queue_renumber จัดเลขเฉพาะงานที่ยังไม่จบ รอบเดียว

create index if not exists jobs_mockup_path_idx on public.jobs (mockup_path) where mockup_path is not null;
create index if not exists jobs_confirmation_pdf_path_idx on public.jobs (confirmation_pdf_path) where confirmation_pdf_path is not null;
create index if not exists jobs_spec_mockups_idx on public.jobs using gin ((spec -> 'mockups') jsonb_path_ops);
create index if not exists mockup_views_image_path_idx on public.mockup_views (image_path);
create index if not exists events_at_idx on public.events (at desc);
create index if not exists events_split_parent_idx on public.events ((payload ->> 'parent')) where type = 'job_split_from';

create or replace function private.queue_renumber() returns void
language plpgsql security definer set search_path = '' as $$
declare base numeric;
begin
  -- กันรับงานใหม่ (nextval) แทรกกลางระหว่างจัดเลข · อ่านได้ตามปกติ
  lock table public.jobs in exclusive mode;
  -- เลขใหม่อยู่เหนือทุกเลขที่เคยออก: ไม่ชนงานที่จบแล้ว (คงเลขเดิม) และ unique index ที่ตรวจทีละแถวไม่สะดุด
  select greatest(coalesce(max(queue_seq), 0), (select last_value from public.job_queue_seq)) into base from public.jobs;
  with o as (select id, row_number() over (order by queue_seq) as n from public.jobs where phase not in ('done', 'cancelled'))
  update public.jobs j set queue_seq = base + o.n * 1024 from o where o.id = j.id;
  perform setval('public.job_queue_seq', coalesce((select max(queue_seq)::bigint from public.jobs), 0) + 1024, false);
end $$;

create or replace function private.split_lineage(p_job uuid)
returns table (job_id uuid, until timestamptz, until_event bigint)
language sql stable security definer set search_path = '' as $$
  with recursive up(id, until, until_event, depth) as (
    select p_job, 'infinity'::timestamptz, null::bigint, 0
    union all
    select p.id, least(up.until, e.at), least(up.until_event, e.id), up.depth + 1 from up
      join public.events e on e.job_id = up.id and e.type = 'job_split_from'
      join public.jobs p on p.confirmation_no = e.payload ->> 'parent'
    where up.depth < 50
  )
  select id, until, until_event from up
$$;
revoke all on function private.split_lineage(uuid) from public, anon, authenticated;

create or replace function private.hold_days(p_job uuid, p_from timestamptz) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(private.work_days(greatest(i.opened_at, p_from), least(coalesce(i.closed_at, now()), l.until))), 0)
  from private.split_lineage(p_job) l
  join public.issues i on i.job_id = l.job_id and i.opened_at <= l.until
  where coalesce(i.closed_at, now()) > p_from
$$;

create or replace function private.requeue_wait_days(p_job uuid, p_from timestamptz) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(private.work_days(greatest(w.at, p_from), least(coalesce(n.at, now()), l.until))), 0)
  from private.split_lineage(p_job) l
  join public.events w on w.job_id = l.job_id and (l.until_event is null or w.id < l.until_event)
    and ((w.type = 'resume' and ((w.payload ->> 'requeued')::boolean or (w.payload ->> 'waiting')::boolean))
         or w.type = 'job_split_from')
  left join lateral (select min(e.at) as at from public.events e
                     where e.job_id = w.job_id and e.id > w.id and e.type in ('station_start', 'hold')) n on true
  where coalesce(n.at, now()) > p_from
$$;
revoke all on function private.requeue_wait_days(uuid, timestamptz) from public, anon, authenticated;

create or replace function private.sla_state(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  j public.jobs; st public.stations; seg public.sla_segments;
  cur text; el numeric; seg_start timestamptz; seg_el numeric; reported boolean; seg_reported boolean;
  st_days numeric; seg_days numeric;
  res jsonb := '{}';
begin
  select * into j from public.jobs where id = p_job;
  if not found or j.phase <> 'production' or j.station_seq is null then return res; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  select * into st from public.stations where code = cur;
  st_days := private.sla_for_qty(st.sla_days, st.big_qty, st.big_sla_days, j.qty);

  if j.station_started_at is not null and st_days is not null and not j.is_rework then
    el := private.work_days(j.station_started_at, now()) - private.hold_days(j.id, j.station_started_at)
      - private.requeue_wait_days(j.id, j.station_started_at);
    select exists (select 1 from private.split_lineage(j.id) l join public.delay_reports d on d.job_id = l.job_id
                   where d.visit = j.visit and d.at <= l.until) into reported;
    res := res || jsonb_build_object(
      'station_sla_days', st_days, 'station_days', round(greatest(el, 0), 3),
      'station_warn', el >= st_days * st.warn_pct / 100.0,
      'station_over', el > st_days, 'station_reported', reported);
  end if;

  seg := private.segment_of(j.route_code, cur);
  seg_days := private.sla_for_qty(seg.sla_days, seg.big_qty, seg.big_sla_days, j.qty);
  if seg.code is not null and seg_days is not null and not j.is_rework then
    -- เริ่มนับจากครั้งแรกที่เริ่มสถานีต้นช่วงในการผลิตจริง (งานแก้ที่ย้อนกลับมาไม่เริ่มนับใหม่)
    select min(e.at) into seg_start from private.split_lineage(j.id) l join public.events e on e.job_id = l.job_id
    where (l.until_event is null or e.id < l.until_event) and e.type = 'station_start' and e.phase = 'production' and e.station_code = seg.from_station
      and not coalesce((e.payload->>'rework')::boolean, false);
    if seg_start is not null then
      seg_el := private.work_days(seg_start, now()) - private.hold_days(j.id, seg_start);
      select exists (select 1 from private.split_lineage(j.id) l join public.delay_reports d on d.job_id = l.job_id
                     where d.segment_code = seg.code and d.at >= seg_start and d.at <= l.until)
        into seg_reported;
      res := res || jsonb_build_object(
        'segment_code', seg.code, 'segment_name', seg.name, 'segment_sla_days', seg_days,
        'segment_days', round(greatest(seg_el, 0), 3),
        'segment_warn', seg_el >= seg_days * seg.warn_pct / 100.0,
        'segment_over', seg_el > seg_days, 'segment_reported', seg_reported);
    end if;
  end if;
  return res;
end $$;

create or replace function public.close_issue(p_job uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; i public.issues; r text := private.my_role(); next_status text; requeued boolean := false;
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
  next_status := coalesce(i.prev_status, 'queued');
  if next_status = 'doing' and private.station_full(p_job, private.station_at(j.route_code, j.station_seq)) is not null then
    next_status := 'queued';
    requeued := true;
  end if;
  update public.jobs set station_status = next_status where id = p_job;
  perform private.log(p_job, 'resume', j.phase, i.station_code,
    jsonb_build_object('issue_id', i.id, 'note', nullif(trim(p_note), ''), 'requeued', requeued,
      'waiting', next_status = 'queued' and j.station_started_at is not null));
end $$;

create or replace function public.start_station(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; r text; full_text text; ahead text[];
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') then perform private.stale('งานไม่ได้อยู่ในสถานี'); end if;
  if j.station_status = 'doing' then perform private.stale('สถานีนี้เริ่มไปแล้ว'); end if;
  if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อนเริ่มต่อ' using errcode = 'P0001'; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC เริ่มได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;
  if cur = 'dtf_press' and j.dtf_film_received_at is null then
    raise exception 'ยังไม่ได้รับ% เริ่มรีดฟิล์มไม่ได้', private.film_label(j.route_code) using errcode = 'P0001';
  end if;
  full_text := private.station_full(p_job, cur);
  if full_text is not null then raise exception '%', full_text using errcode = 'P0001'; end if;
  ahead := private.queue_ahead(j);
  if ahead is not null and not exists (
      select 1 from public.events e where e.job_id = p_job and e.type = 'queue_skip' and e.station_code = cur
        and ((e.payload ->> 'visit')::int = j.visit or (not e.payload ? 'visit' and e.at >= j.stage_entered_at))) then
    raise exception 'งานนี้ไม่ใช่คิวแรกแล้ว (คิวก่อนหน้า: %) กด "เริ่มก่อนคิว" แล้วใส่เหตุผล', array_to_string(ahead, ', ') using errcode = 'P0001';
  end if;
  -- งานที่พักแล้วกลับเข้าคิว (เครื่องเต็ม) เริ่มต่อในรอบเดิม: เวลาที่ทำไปแล้วต้องนับต่อ
  update public.jobs set station_status = 'doing', station_started_at = coalesce(j.station_started_at, now()) where id = p_job;
  perform private.log(p_job, 'station_start', j.phase, cur,
    jsonb_build_object('visit', j.visit, 'round', j.sample_round, 'rework', j.is_rework));
end $$;

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
    perform private.log(p_job, 'queue_skip', j.phase, cur, jsonb_build_object('reason', btrim(p_reason), 'ahead', to_jsonb(ahead), 'visit', j.visit));
  end if;
  if cur = 'sew' then return public.start_sewing(p_job); end if;
  perform public.start_station(p_job);
  return null;
end $$;

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
  perform private.log(p_job, 'queue_skip', j.phase, cur, jsonb_build_object('reason', btrim(p_reason), 'ahead', to_jsonb(ahead), 'visit', j.visit));
  return true;
end $$;

create or replace function private.no_machine_recipe(p_product text) returns text
language sql stable security definer set search_path = '' as $$
  select format('สินค้า "%s" ยังไม่มีสูตรจักรเย็บ เย็บในโรงงานไม่ได้ · ให้เจ้าของระบบเพิ่มสูตรที่ ตั้งค่า → จักรเย็บ หรือให้แอดมินส่งงานเย็บออกบริษัทภายนอก',
                coalesce((select pt.name from public.product_types pt where pt.code = p_product), p_product))
  where not exists (select 1 from public.product_machine_needs n where n.product_type_code = p_product)
$$;
revoke all on function private.no_machine_recipe(text) from public, anon, authenticated;

create or replace function private.leave_sewing(p_job uuid, p_keep_future boolean) returns void
language sql security definer set search_path = '' as $$
  update public.machine_assignments set released_at = now(), released_by = (select auth.uid())
    where job_id = p_job and released_at is null;
  update public.machine_bookings set ends_at = now()
    where job_id = p_job and cancelled_at is null and starts_at < now() and ends_at > now();
  update public.machine_bookings set cancelled_at = now(), cancelled_by = (select auth.uid())
    where job_id = p_job and cancelled_at is null
      and (starts_at = now() or (not p_keep_future and starts_at > now()));
$$;
revoke all on function private.leave_sewing(uuid, boolean) from public, anon, authenticated;

create or replace function private.release_machines_on_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sew_seq int;
begin
  if private.station_at(old.route_code, old.station_seq) = 'sew'
     and (new.phase not in ('sample', 'production') or private.station_at(new.route_code, new.station_seq) is distinct from 'sew') then
    -- ตัวอย่างเก็บการจองในอนาคตไว้ให้ผลิตจริง · งาน Develop ไม่มีผลิตจริง
    perform private.leave_sewing(new.id, new.phase = 'sample' and not new.develop);
  elsif new.phase in ('done', 'cancelled') and old.phase not in ('done', 'cancelled') then
    perform private.leave_sewing(new.id, false);
  elsif new.phase = old.phase and new.phase in ('sample', 'production') then
    select seq into sew_seq from public.route_stations where route_code = new.route_code and station_code = 'sew';
    -- รับกลับจากบริษัทภายนอก / งานแก้กลับ QC ข้ามสถานีเย็บไปโดยไม่เคยอยู่ที่เย็บ
    if old.station_seq <= sew_seq and new.station_seq > sew_seq then
      perform private.leave_sewing(new.id, new.phase = 'sample' and not new.develop);
    end if;
  end if;
  return new;
end $$;

create or replace function private.require_machines_to_sew() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lack text;
begin
  if new.station_status = 'doing' and old.station_status is distinct from 'doing'
     and new.phase in ('sample', 'production') and private.station_at(new.route_code, new.station_seq) = 'sew'
     and exists (select 1 from public.sewing_machines) then
    if not exists (select 1 from public.product_machine_needs where product_type_code = new.product_type_code) then
      if not exists (select 1 from public.machine_assignments where job_id = new.id and released_at is null) then
        raise exception '%', private.no_machine_recipe(new.product_type_code) using errcode = 'P0001';
      end if;
    else
      select string_agg(mt.name || ' ' || s.short || ' ตัว', ' · ') into lack
        from private.machines_short(new.id) s join public.machine_types mt on mt.code = s.type_code where s.short > 0;
      if lack is not null then
        raise exception 'จักรไม่ครบ เย็บต่อไม่ได้: ขาด % · กด "เริ่มเย็บ" ให้ระบบเลือกจักรว่าง หรือรอจักรว่าง', lack
          using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.send_out(p_job uuid, p_vendor bigint, p_last_station text,
  p_arrive_at timestamptz, p_lead_days numeric, p_back_at timestamptz, p_note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; span record; run_id bigint; vname text;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') then perform private.stale('งานไม่ได้อยู่ในสถานี'); end if;
  if j.station_status = 'out' then raise exception 'งานนี้อยู่ที่บริษัทภายนอกแล้ว' using errcode = 'P0001'; end if;
  if j.station_status is distinct from 'queued' then
    raise exception 'ส่งออกได้เฉพาะงานที่ยังไม่เริ่มสถานีนี้ (ตอนนี้: %)', case j.station_status when 'doing' then 'กำลังทำ' when 'hold' then 'พักงาน' else '-' end using errcode = 'P0001';
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if not private.outsourceable(cur) then
    raise exception 'สถานี % ทำที่โรงงานเท่านั้น', private.station_name(cur) using errcode = 'P0001';
  end if;
  select name into vname from public.vendors where id = p_vendor and active;
  if vname is null then raise exception 'ไม่พบบริษัทนี้ เลือกบริษัทจากรายการ' using errcode = 'P0001'; end if;
  perform private.check_out_plan(p_arrive_at, p_lead_days, p_back_at);
  select * into span from private.out_span(j.route_code, j.station_seq, coalesce(p_last_station, cur));
  -- งานแก้ (QC ส่งกลับ) ทำเฉพาะสถานีต้นเหตุแล้วกลับ QC
  if j.is_rework and span.to_seq <> j.station_seq then
    raise exception 'งานแก้ส่งออกได้เฉพาะสถานีต้นเหตุ (%) แล้วกลับมา QC', private.station_name(cur) using errcode = 'P0001';
  end if;

  insert into public.outsource_runs (job_id, vendor_id, from_seq, to_seq, stations, qty, is_rework, arrive_at, lead_days, back_at, note)
  values (p_job, p_vendor, j.station_seq, span.to_seq, span.stations,
          case when j.is_rework then coalesce(j.rework_qty, j.qty) else j.qty end, j.is_rework,
          p_arrive_at, p_lead_days, p_back_at, nullif(btrim(p_note), ''))
  returning id into run_id;
  perform set_config('pp142.outsource', '1', true);
  update public.jobs set station_status = 'out', station_started_at = null, stage_entered_at = now() where id = p_job;
  perform set_config('pp142.outsource', '', true);
  if 'sew' = any (span.stations) then
    perform private.leave_sewing(j.id, j.phase = 'sample' and not j.develop);
  end if;
  perform private.log(p_job, 'outsource_sent', j.phase, cur, jsonb_build_object(
    'run', run_id, 'vendor', vname, 'stations', to_jsonb(span.stations), 'arrive_at', p_arrive_at,
    'lead_days', p_lead_days, 'back_at', p_back_at, 'rework', j.is_rework, 'note', nullif(btrim(p_note), '')));
  return run_id;
end $$;

create or replace function public.forward_out(p_run bigint, p_vendor bigint, p_last_station text,
  p_arrive_at timestamptz, p_lead_days numeric, p_back_at timestamptz, p_note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare r public.outsource_runs; j public.jobs; span record; run_id bigint; vname text; old_vendor text;
begin
  perform private.require_role('admin');
  select * into r from public.outsource_runs where id = p_run for update;
  if not found or r.closed_at is not null then perform private.stale('รอบส่งออกนี้ปิดไปแล้ว'); end if;
  j := private.lock_job(r.job_id);
  if r.is_rework then raise exception 'งานแก้ทำเสร็จแล้วต้องกลับมา QC ที่โรงงาน กด "รับของกลับ"' using errcode = 'P0001'; end if;
  if r.to_seq >= private.last_seq(j.route_code) then perform private.stale('ไม่มีสถานีถัดไป'); end if;
  select name into vname from public.vendors where id = p_vendor and active;
  if vname is null then raise exception 'ไม่พบบริษัทนี้ เลือกบริษัทจากรายการ' using errcode = 'P0001'; end if;
  if p_vendor = r.vendor_id then raise exception 'ส่งต่อให้บริษัทเดิมไม่ได้ ถ้าบริษัทเดิมทำต่อ ให้กด "แก้กำหนด" แทน' using errcode = 'P0001'; end if;
  perform private.check_out_plan(p_arrive_at, p_lead_days, p_back_at);
  select * into span from private.out_span(j.route_code, r.to_seq + 1, coalesce(p_last_station, private.station_at(j.route_code, r.to_seq + 1)));
  select name into old_vendor from public.vendors where id = r.vendor_id;

  -- รอบเปิดได้ 1 รอบต่องาน (unique) → ปิดรอบเดิมก่อน แล้วค่อยสร้างรอบใหม่และผูก next
  update public.outsource_runs set closed_at = now(), closed_how = 'forwarded', closed_by = auth.uid() where id = r.id;
  insert into public.outsource_runs (job_id, vendor_id, from_seq, to_seq, stations, qty, arrive_at, lead_days, back_at, note, sent_at)
  values (j.id, p_vendor, r.to_seq + 1, span.to_seq, span.stations, r.qty, p_arrive_at, p_lead_days, p_back_at, nullif(btrim(p_note), ''), now())
  returning id into run_id;
  update public.outsource_runs set next_run_id = run_id where id = r.id;
  perform set_config('pp142.outsource', '1', true);
  update public.jobs set station_seq = r.to_seq + 1, station_status = 'out', station_started_at = null,
    visit = visit + 1, stage_entered_at = now() where id = j.id;
  perform set_config('pp142.outsource', '', true);
  if 'sew' = any (span.stations) then
    perform private.leave_sewing(j.id, j.phase = 'sample' and not j.develop);
  end if;
  perform private.log(j.id, 'outsource_forwarded', j.phase, private.station_at(j.route_code, r.to_seq + 1), jsonb_build_object(
    'run', run_id, 'from_vendor', old_vendor, 'vendor', vname, 'done_stations', to_jsonb(r.stations), 'stations', to_jsonb(span.stations),
    'arrive_at', p_arrive_at, 'lead_days', p_lead_days, 'back_at', p_back_at));
  return run_id;
end $$;

create or replace function public.book_machines(p_job uuid, p_starts timestamptz, p_ends timestamptz) returns text[]
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n record; got bigint[]; picked text[] := '{}'; why text; problems text[] := '{}'; now_start boolean; sew_seq int;
begin
  perform private.require_role('production');
  -- ล็อกแถวงานตรงๆ (ไม่ใช้ lock_job) เพราะงานที่จองล่วงหน้ามักยังอยู่สถานีเฟส 1
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase in ('done', 'cancelled') then raise exception 'งานนี้เสร็จแล้ว จองจักรไม่ได้' using errcode = 'P0001'; end if;
  select seq into sew_seq from public.route_stations where route_code = j.route_code and station_code = 'sew';
  if sew_seq is null then
    raise exception 'งานนี้ใช้เส้นทางที่ไม่มีสถานีเย็บ ไม่ต้องจองจักร' using errcode = 'P0001';
  end if;
  -- ตัวอย่างที่ผ่านเย็บแล้วยังต้องเย็บอีกรอบตอนผลิตจริง จึงจองได้ · งาน Develop จบที่ตัวอย่าง
  if (j.phase = 'production' or j.develop) and (j.station_seq > sew_seq or j.phase = 'sample_review') then
    raise exception 'งานนี้เย็บเสร็จแล้ว จองจักรไม่ได้' using errcode = 'P0001';
  end if;
  if j.phase = 'production' and j.is_rework and j.station_seq < sew_seq then
    raise exception 'งานแก้นี้ทำที่สถานีต้นเหตุแล้วกลับ QC เลย ไม่ผ่านสถานีเย็บ ไม่ต้องจองจักร' using errcode = 'P0001';
  end if;
  if (j.phase = 'production' or j.develop) and exists (select 1 from public.outsource_runs r
       where r.job_id = p_job and r.closed_at is null and 'sew' = any (r.stations)) then
    raise exception 'งานนี้ส่งเย็บที่บริษัทภายนอก ไม่ต้องจองจักร' using errcode = 'P0001';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    raise exception 'เวลาจบต้องหลังเวลาเริ่ม' using errcode = '23514';
  end if;
  if p_ends <= now() then raise exception 'ช่วงเวลานี้ผ่านไปแล้ว เลือกเวลาใหม่' using errcode = '23514'; end if;
  if p_ends - p_starts > interval '14 days' then raise exception 'จองได้ครั้งละไม่เกิน 14 วัน' using errcode = '23514'; end if;
  if extract(isodow from p_starts at time zone 'Asia/Bangkok') = 7 then
    raise exception 'วันอาทิตย์โรงงานหยุด เลือกวันเริ่มใหม่' using errcode = '23514';
  end if;
  if exists (select 1 from public.machine_bookings where job_id = p_job and cancelled_at is null and ends_at > now()) then
    raise exception 'งานนี้จองจักรไว้แล้ว ยกเลิกการจองเดิมก่อนจองใหม่' using errcode = 'P0001';
  end if;
  if private.no_machine_recipe(j.product_type_code) is not null then
    raise exception '%', private.no_machine_recipe(j.product_type_code) using errcode = 'P0001';
  end if;
  now_start := p_starts <= now();

  for n in select pmn.type_code, pmn.qty, mt.name from public.product_machine_needs pmn
           join public.machine_types mt on mt.code = pmn.type_code
           where pmn.product_type_code = j.product_type_code and not mt.shared order by mt.sort loop
    select array_agg(id order by code) into got from (
      select m.id, m.code from public.sewing_machines m
      where m.type_code = n.type_code and m.status = 'ready'
        and private.booked_by_other(m.id, p_starts, p_ends, null) is null
        -- จองเริ่มทันที: จักรต้องไม่ติดงานอื่นอยู่ตอนนี้
        and not (now_start and exists (select 1 from public.machine_assignments a
                                      where a.machine_id = m.id and a.released_at is null and a.job_id <> p_job))
      order by m.code limit n.qty for update of m) free;
    if coalesce(cardinality(got), 0) < n.qty then
      select string_agg(m.code || ' ' || coalesce(
               case when m.status = 'broken' then 'เสีย' when m.status = 'off' then 'ปิด' end,
               'จองให้ ' || private.booked_by_other(m.id, p_starts, p_ends, null),
               'ใช้กับ ' || (select jb.confirmation_no from public.machine_assignments a join public.jobs jb on jb.id = a.job_id
                             where a.machine_id = m.id and a.released_at is null)), ', ' order by m.code)
        into why
        from public.sewing_machines m
        where m.type_code = n.type_code
          and (m.status <> 'ready' or private.booked_by_other(m.id, p_starts, p_ends, null) is not null
               or (now_start and exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null and a.job_id <> p_job)));
      problems := problems || format('%s ขาด %s ตัว%s', n.name, n.qty - coalesce(cardinality(got), 0),
                                     case when why is null then ' (ยังไม่มีจักรประเภทนี้)' else ' (' || why || ')' end);
    else
      insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at, booked_by)
        select unnest(got), p_job, p_starts, p_ends, (select auth.uid());
      picked := picked || (select array_agg(code order by code) from public.sewing_machines where id = any (got));
    end if;
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'จองไม่ได้ ช่วงเวลานี้จักรไม่พอ: %', array_to_string(problems, ' · ') using errcode = 'P0001';
  end if;
  picked := (select array_agg(c order by c) from unnest(picked) c);
  perform private.log(p_job, 'machines_booked', j.phase, 'sew',
    jsonb_build_object('machines', picked, 'starts_at', p_starts, 'ends_at', p_ends));
  return picked;
exception when exclusion_violation then
  -- ฐานข้อมูลกันการจองชน แม้สองคำขอผ่านการตรวจพร้อมกัน
  perform private.stale('มีคนจองจักรช่วงนี้ไปก่อน');
end $$;

create or replace function public.assign_machines(p_job uuid, p_machine_codes text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; m public.sewing_machines; c text; busy text; codes text[]; type_name text; is_shared boolean;
begin
  perform private.require_sewing_supervisor();
  -- ตรวจสถานีก่อนล็อก เพื่อให้ข้อความบอกเรื่องจริง (ยังไม่ถึงเย็บ) ไม่ใช่เรื่องเฟส · ตรวจซ้ำหลังล็อกกันสถานะเปลี่ยนระหว่างทาง
  select * into j from public.jobs where id = p_job;
  if found and (j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew') then
    raise exception 'จ่ายจักรได้เฉพาะงานที่อยู่สถานีเย็บ' using errcode = 'P0001';
  end if;
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew' then
    perform private.stale('งานออกจากสถานีเย็บแล้ว');
  end if;
  if j.station_status is distinct from 'doing' and j.station_status is distinct from 'hold' then
    if private.no_machine_recipe(j.product_type_code) is not null then
      raise exception '%', private.no_machine_recipe(j.product_type_code) using errcode = 'P0001';
    end if;
    raise exception 'งานนี้ยังไม่เริ่มเย็บ กด "เริ่มเย็บ" ก่อน ระบบจ่ายจักรชุดแรกให้เอง แล้วค่อยเพิ่มจักร' using errcode = 'P0001';
  end if;
  -- รหัสเดียวกันพิมพ์ต่างกัน (ตัวเล็ก/เว้นวรรค/ซ้ำ) = จักรตัวเดียว
  select array_agg(distinct upper(trim(x))) into codes from unnest(p_machine_codes) x where trim(x) <> '';
  if coalesce(cardinality(codes), 0) = 0 then
    raise exception 'เลือกจักรอย่างน้อย 1 ตัว' using errcode = '23514';
  end if;
  foreach c in array codes loop
    select * into m from public.sewing_machines where code = c for update;
    if not found then raise exception 'ไม่พบจักรรหัส %', c using errcode = 'P0002'; end if;
    select t.name, t.shared into type_name, is_shared from public.machine_types t where t.code = m.type_code;
    if is_shared then
      raise exception 'จักร % เป็น% ที่ทุกไลน์ใช้ร่วมกันอยู่แล้ว ไม่ต้องจ่ายให้งาน', m.code, type_name using errcode = 'P0001';
    end if;
    if m.status <> 'ready' then
      raise exception 'จักร % % อยู่ จ่ายให้งานไม่ได้', m.code, case m.status when 'broken' then 'เสีย' else 'ปิดใช้งาน' end
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.job_id = p_job and a.released_at is null) then
      perform private.stale(format('จักร %s อยู่กับงานนี้แล้ว', m.code));
    end if;
    select jb.confirmation_no into busy from public.machine_assignments a join public.jobs jb on jb.id = a.job_id
      where a.machine_id = m.id and a.released_at is null;
    if found then
      raise exception 'จักร % ใช้กับงาน % อยู่ ต้องคืนจักรก่อน', m.code, busy using errcode = 'P0001';
    end if;
    busy := private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job);
    if busy is not null then
      raise exception 'จักร % จองให้ % อยู่ ใช้กับงานอื่นไม่ได้', m.code, busy using errcode = 'P0001';
    end if;
    insert into public.machine_assignments (machine_id, job_id, assigned_by) values (m.id, p_job, (select auth.uid()));
  end loop;
  perform private.log(p_job, 'machines_assigned', j.phase, 'sew', jsonb_build_object('machines', codes));
end $$;

create or replace function public.set_job_machines(p_job uuid, p_type text, p_qty int) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs; t public.machine_types; have int; need int; got bigint[]; codes text[]; free_count int;
begin
  perform private.require_sewing_supervisor();
  select * into j from public.jobs where id = p_job;
  if found and (j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew') then
    raise exception 'จัดจักรได้เฉพาะงานที่อยู่สถานีเย็บ' using errcode = 'P0001';
  end if;
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew' then
    perform private.stale('งานออกจากสถานีเย็บแล้ว');
  end if;
  perform pg_advisory_xact_lock(hashtext('pp142.sewing_machines'));
  if j.station_status is distinct from 'doing' and j.station_status is distinct from 'hold' then
    if private.no_machine_recipe(j.product_type_code) is not null then
      raise exception '%', private.no_machine_recipe(j.product_type_code) using errcode = 'P0001';
    end if;
    raise exception 'งานนี้ยังไม่เริ่มเย็บ กด "เริ่มเย็บ" ก่อน' using errcode = 'P0001';
  end if;
  select * into t from public.machine_types where code = p_type;
  if not found then raise exception 'ไม่พบชนิดจักรนี้' using errcode = 'P0002'; end if;
  if t.shared then
    raise exception '% ทุกไลน์ใช้ร่วมกันอยู่แล้ว ไม่ต้องจ่ายให้งาน', t.name using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty < 0 then raise exception 'จำนวนจักรต้องเป็น 0 ขึ้นไป' using errcode = '23514'; end if;

  select count(*)::int into have from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id
    where a.job_id = p_job and a.released_at is null and m.type_code = p_type;
  if p_qty = have then
    perform private.stale(format('%s ของงานนี้มี %s ตัวอยู่แล้ว', t.name, have));
  end if;
  select coalesce(sum(n.qty), 0)::int into need from public.product_machine_needs n
    where n.product_type_code = j.product_type_code and n.type_code = p_type;
  if j.station_status = 'doing' and p_qty < need then
    raise exception 'กำลังเย็บอยู่ ต้องมี% อย่างน้อย % ตัว · ถ้าจะหยุดเย็บให้กด "รายงานปัญหา" แล้วพักงานก่อน', t.name, need
      using errcode = 'P0001';
  end if;

  if p_qty > have then
    select array_agg(id order by code) into got from (
      select m.id, m.code from public.sewing_machines m
      where m.type_code = p_type and m.status = 'ready'
        and not exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null)
        and private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is null
      order by exists (select 1 from public.machine_bookings b where b.machine_id = m.id and b.job_id = p_job
                       and b.cancelled_at is null and b.ends_at > now()) desc, m.code
      limit p_qty - have for update of m) free;
    free_count := coalesce(cardinality(got), 0);
    if free_count < p_qty - have then
      raise exception '% ว่างอยู่ % ตัว เพิ่มเป็น % ตัวไม่ได้ (ตัวอื่นใช้กับงานอื่น / เสีย / จองไว้)', t.name, free_count, p_qty
        using errcode = 'P0001';
    end if;
    insert into public.machine_assignments (machine_id, job_id, assigned_by)
      select unnest(got), p_job, (select auth.uid());
    select array_agg(code order by code) into codes from public.sewing_machines where id = any (got);
    perform private.log(p_job, 'machines_assigned', j.phase, 'sew', jsonb_build_object('machines', codes));
  else
    with picked as (
      select a.id from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id
      where a.job_id = p_job and a.released_at is null and m.type_code = p_type
      order by a.assigned_at desc, a.id desc limit have - p_qty
    ), released as (
      update public.machine_assignments a set released_at = now(), released_by = (select auth.uid())
      from picked, public.sewing_machines m
      where a.id = picked.id and m.id = a.machine_id
      returning m.code
    )
    select array_agg(code order by code) into codes from released;
    perform private.log(p_job, 'machines_released', j.phase, 'sew', jsonb_build_object('machines', codes));
  end if;
  return codes;
end $$;

create or replace function public.start_sewing(p_job uuid, p_codes text[] default null) returns text[]
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n record; got bigint[]; picked text[] := '{}'; why text; problems text[] := '{}'; codes text[]; pm public.sewing_machines; pick_code text; t public.machine_types; busy text; have int; need int;
begin
  perform private.require_sewing_supervisor();
  select * into j from public.jobs where id = p_job;
  if found and (j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew') then
    raise exception 'งานนี้ยังไม่ถึงสถานีเย็บ' using errcode = 'P0001';
  end if;
  j := private.lock_job(p_job);
  -- อีกเครื่องอาจกดเย็บเสร็จระหว่างรอล็อก · ไม่ตรวจซ้ำแล้วจะไปเริ่มสถานีถัดไปแทน
  if j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew' then
    perform private.stale('งานนี้ออกจากสถานีเย็บแล้ว');
  end if;
  -- กันสองงานเลือกจักรว่างตัวเดียวกันตอนให้ระบบเลือกให้
  perform pg_advisory_xact_lock(hashtext('pp142.sewing_machines'));
  if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อนเริ่มต่อ' using errcode = 'P0001'; end if;
  if j.station_status = 'doing' then perform private.stale('เริ่มเย็บไปแล้ว'); end if;
  if private.no_machine_recipe(j.product_type_code) is not null then
    raise exception '%', private.no_machine_recipe(j.product_type_code) using errcode = 'P0001';
  end if;

  if p_codes is not null then
    select array_agg(distinct upper(trim(x))) into codes from unnest(p_codes) x where trim(x) <> '';
    if coalesce(cardinality(codes), 0) = 0 then raise exception 'เลือกจักรอย่างน้อย 1 ตัว' using errcode = '23514'; end if;
    foreach pick_code in array codes loop
      select * into pm from public.sewing_machines where code = pick_code for update;
      if not found then raise exception 'ไม่พบจักรรหัส %', pick_code using errcode = 'P0002'; end if;
      select * into t from public.machine_types where code = pm.type_code;
      if t.shared then raise exception 'จักร % เป็น% ที่ทุกไลน์ใช้ร่วมกัน ไม่ต้องเลือก', pm.code, t.name using errcode = 'P0001'; end if;
      if not exists (select 1 from public.product_machine_needs where product_type_code = j.product_type_code and type_code = pm.type_code) then
        raise exception 'งานนี้ไม่ใช้% (จักร %) เลือกตัวอื่น', t.name, pm.code using errcode = 'P0001';
      end if;
      if pm.status <> 'ready' then
        raise exception 'จักร % % อยู่ เลือกตัวอื่น', pm.code, case pm.status when 'broken' then 'เสีย' else 'ปิดใช้งาน' end using errcode = 'P0001';
      end if;
      select jb.confirmation_no into busy from public.machine_assignments a join public.jobs jb on jb.id = a.job_id
        where a.machine_id = pm.id and a.released_at is null and a.job_id <> p_job;
      if found then raise exception 'จักร % ใช้กับงาน % อยู่ เลือกตัวอื่น', pm.code, busy using errcode = 'P0001'; end if;
      busy := private.booked_by_other(pm.id, now(), now() + interval '1 minute', p_job);
      if busy is not null then raise exception 'จักร % จองให้ % อยู่ เลือกตัวอื่น', pm.code, busy using errcode = 'P0001'; end if;
    end loop;
    for n in select pmn.type_code, pmn.qty, mt.name from public.product_machine_needs pmn
             join public.machine_types mt on mt.code = pmn.type_code
             where pmn.product_type_code = j.product_type_code and not mt.shared order by mt.sort loop
      if (select count(*) from public.sewing_machines sm where sm.type_code = n.type_code
            and (sm.code = any (codes) or exists (select 1 from public.machine_assignments a where a.machine_id = sm.id and a.job_id = p_job and a.released_at is null))) < n.qty then
        problems := problems || format('เลือก%s ไม่ครบ ต้องใช้อย่างน้อย %s ตัว', n.name, n.qty);
      end if;
    end loop;
    if cardinality(problems) = 0 then
      insert into public.machine_assignments (machine_id, job_id, assigned_by)
        select sm.id, p_job, (select auth.uid()) from public.sewing_machines sm where sm.code = any (codes) and not exists (select 1 from public.machine_assignments a where a.machine_id = sm.id and a.job_id = p_job and a.released_at is null);
    end if;
  end if;

  if p_codes is null then
    for n in select pmn.type_code, pmn.qty, mt.name from public.product_machine_needs pmn
             join public.machine_types mt on mt.code = pmn.type_code
             where pmn.product_type_code = j.product_type_code and not mt.shared order by mt.sort loop
      -- จักรที่งานถืออยู่แล้ว (จ่ายไว้ตอนพักงาน) นับรวม ไม่จ่ายซ้ำอีกชุด
      select count(*)::int into have from public.machine_assignments a join public.sewing_machines sm on sm.id = a.machine_id
        where a.job_id = p_job and a.released_at is null and sm.type_code = n.type_code;
      need := greatest(n.qty - have, 0);
      select array_agg(id order by code) into got from (
        select m.id, m.code from public.sewing_machines m
        where m.type_code = n.type_code and m.status = 'ready'
          and not exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null)
          and private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is null
        order by exists (select 1 from public.machine_bookings b where b.machine_id = m.id and b.job_id = p_job
                         and b.cancelled_at is null and b.ends_at > now()) desc, m.code
        limit need for update of m) free;
      if coalesce(cardinality(got), 0) < need then
        select string_agg(m.code || case when m.status = 'broken' then ' เสีย' when m.status = 'off' then ' ปิด'
                                         when a.id is not null then ' ใช้กับ ' || coalesce(jb.confirmation_no, 'งานอื่น')
                                         else ' จองให้ ' || private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) end,
                          ', ' order by m.code)
          into why
          from public.sewing_machines m
          left join public.machine_assignments a on a.machine_id = m.id and a.released_at is null
          left join public.jobs jb on jb.id = a.job_id
          where m.type_code = n.type_code
            and (m.status <> 'ready' or a.id is not null
                 or private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is not null);
        problems := problems || format('%s ขาด %s ตัว%s', n.name, need - coalesce(cardinality(got), 0),
                                       case when why is null then ' (ยังไม่มีจักรประเภทนี้)' else ' (' || why || ')' end);
      else
        insert into public.machine_assignments (machine_id, job_id, assigned_by)
          select unnest(got), p_job, (select auth.uid());
      end if;
    end loop;
  end if;

  -- จักรใช้ร่วม: ไม่จ่ายให้งาน · ต้องมีตัวที่ใช้ได้ครบจำนวนที่สินค้าต้องใช้ (เช่น เสื้อยืดใช้โพ้ง 2 ตัว)
  for n in select mt.name, pmn.qty, (select count(*)::int from public.sewing_machines m
                                     where m.type_code = pmn.type_code and m.status = 'ready') as ready
           from public.product_machine_needs pmn join public.machine_types mt on mt.code = pmn.type_code
           where pmn.product_type_code = j.product_type_code and mt.shared
           order by mt.sort loop
    if n.ready = 0 then
      problems := problems || format('%s ใช้ไม่ได้ทุกตัว (เสีย / ปิด / ยังไม่มีในระบบ)', n.name);
    elsif n.ready < n.qty then
      problems := problems || format('%s ใช้ได้ %s ตัว ต้องใช้ %s ตัว (ที่เหลือเสีย / ปิด)', n.name, n.ready, n.qty);
    end if;
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'จักรไม่ว่าง เริ่มเย็บไม่ได้: %', array_to_string(problems, ' · ') using errcode = 'P0001';
  end if;
  select array_agg(sm.code order by sm.code) into picked
    from public.machine_assignments a join public.sewing_machines sm on sm.id = a.machine_id
    where a.job_id = p_job and a.released_at is null;
  perform private.log(p_job, 'machines_assigned', j.phase, 'sew', jsonb_build_object('machines', picked));
  perform public.start_station(p_job);
  return picked;
end $$;

create or replace function public.resume_sewing(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n record; codes text[]; picked text[] := '{}'; prev text;
begin
  perform private.require_sewing_supervisor();
  j := private.lock_job(p_job);
  if private.station_at(j.route_code, j.station_seq) is distinct from 'sew' or j.station_status is distinct from 'hold' then
    perform private.stale('งานนี้ไม่ได้พักอยู่ที่สถานีเย็บ');
  end if;
  perform pg_advisory_xact_lock(hashtext('pp142.sewing_machines'));
  select i.prev_status into prev from public.issues i where i.job_id = p_job and i.closed_at is null order by i.opened_at desc limit 1;
  -- งานที่พักตอนยังรอคิวกลับไปรอคิว ไม่รับจักร · start_sewing จ่ายให้ตอนเริ่ม
  if prev = 'doing' then
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
  end if;
  perform public.close_issue(p_job);
  if (select station_status from public.jobs where id = p_job) = 'queued' then
    with released as (
      update public.machine_assignments a set released_at = now(), released_by = (select auth.uid())
      from public.sewing_machines m
      where m.id = a.machine_id and a.job_id = p_job and a.released_at is null
      returning m.code
    )
    select array_agg(code order by code) into codes from released;
    if codes is not null then
      perform private.log(p_job, 'machines_released', j.phase, 'sew', jsonb_build_object('machines', codes, 'reason', 'กลับเข้าคิว'));
    end if;
  end if;
end $$;

create or replace function public.set_machine_status(p_machine_code text, p_status text, p_note text default null,
  p_repair_eta timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.sewing_machines; a public.machine_assignments; jb public.jobs; why text; held_job uuid; r text; locked_job uuid;
begin
  perform private.require_machine_reporter();
  r := private.my_role();
  if p_status not in ('ready', 'broken', 'off') then
    raise exception 'สถานะจักรต้องเป็น ใช้ได้ / เสีย / ปิดใช้งาน' using errcode = '23514';
  end if;
  -- ล็อกงานก่อนจักร ลำดับเดียวกับ start_sewing / resume_sewing · สลับลำดับแล้ว deadlock ได้
  select a2.job_id into locked_job from public.machine_assignments a2 join public.sewing_machines sm on sm.id = a2.machine_id
    where sm.code = upper(trim(p_machine_code)) and a2.released_at is null;
  if locked_job is not null then perform 1 from public.jobs where id = locked_job for update; end if;
  select * into m from public.sewing_machines where code = upper(trim(p_machine_code)) for update;
  if not found then raise exception 'ไม่พบจักรรหัส %', p_machine_code using errcode = 'P0002'; end if;
  if p_status = 'broken' and coalesce(trim(p_note), '') = '' then
    raise exception 'แจ้งจักรเสียต้องบอกอาการ' using errcode = '23514';
  end if;
  if p_repair_eta is not null and p_status <> 'broken' then
    raise exception 'กรอบเวลาซ่อมใส่ได้เฉพาะตอนแจ้งเสีย' using errcode = '23514';
  end if;
  if p_repair_eta is not null and r not in ('production', 'owner') then
    raise exception 'กรอบเวลาซ่อมเป็นหน้าที่ของฝ่ายผลิต' using errcode = '42501';
  end if;
  if p_status = 'broken' and r = 'production' and p_repair_eta is null then
    raise exception 'ฝ่ายผลิตแจ้งเสียต้องกำหนดเวลาซ่อมเสร็จ' using errcode = '23514';
  end if;
  if p_repair_eta is not null then perform private.check_repair_eta(p_repair_eta); end if;
  -- กดซ้ำ / อีกคนกดไปก่อน (กฎข้อ 11)
  if m.status = p_status then
    perform private.stale(format('จักร %s %s อยู่แล้ว', m.code, case p_status when 'broken' then 'เสีย' when 'off' then 'ปิดใช้งาน' else 'ใช้ได้' end));
  end if;

  perform set_config('app.machine_status_rpc', 'on', true);
  update public.sewing_machines
    set status = p_status, note = case when p_status = 'ready' then null else nullif(trim(p_note), '') end,
        repair_eta = case when p_status = 'broken' then p_repair_eta end,
        status_changed_at = now(), status_changed_by = (select auth.uid())
    where id = m.id;
  perform set_config('app.machine_status_rpc', 'off', true);

  if p_status <> 'ready' then
    update public.machine_assignments set released_at = now(), released_by = (select auth.uid())
      where machine_id = m.id and released_at is null
      returning * into a;
    if found then
      if a.job_id is distinct from locked_job then perform private.stale('จักรเพิ่งถูกจ่ายให้งานอื่น'); end if;
      held_job := a.job_id;
      select * into jb from public.jobs where id = a.job_id;
      perform private.log(jb.id, 'machines_released', jb.phase, 'sew',
        jsonb_build_object('machines', array[m.code], 'reason', case p_status when 'broken' then 'จักรเสีย' else 'ปิดใช้งาน' end,
                           'note', nullif(trim(p_note), '')));
      if jb.station_status = 'doing' and exists (select 1 from private.machines_short(jb.id) s where s.short > 0) then
        why := case p_status when 'broken' then format('จักร %s เสีย: %s', m.code, trim(p_note)) else format('จักร %s ปิดใช้งาน', m.code) end
          || coalesce(' · คาดว่าซ่อมเสร็จ ' || to_char(p_repair_eta at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'), '');
        perform public.open_issue(jb.id, why);
      end if;
    end if;
  end if;

  insert into public.machine_status_log (machine_id, status, note, job_id, repair_eta, by)
    values (m.id, p_status, nullif(trim(p_note), ''), held_job, p_repair_eta, (select auth.uid()));
end $$;

create or replace function public.revise_job_spec(
  p_job uuid, p_spec jsonb, p_rev int, p_customer_name text, p_job_name text,
  p_qty int, p_spare_qty int, p_due_date date, p_needs_sample boolean, p_changes text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs; v_spec jsonb; v_no text; passed int; summary text[] := '{}'; labels text[];
  sheet public.mockup_sheets; stale int := 0; v_job_name text;
  family uuid[]; v_root uuid; parts text[]; family_qty int; split boolean; m public.jobs; v_rework int;
  volatile_keys constant text[] := array['mockup_path', 'mockup', 'imgs', 'from_job', 'revise_job', 'changes', 'job_img', 'pickOpen', 'summary', 'app', 'v'];
begin
  perform private.require_role('admin');
  -- ล็อกเดียวกับ split_job: ไม่ให้มีส่วนใหม่เกิดระหว่างหาครอบครัวงาน แล้วค้างสเปกเก่า
  perform pg_advisory_xact_lock(hashtext('pp142.job_queue'));
  v_root := private.split_root(p_job);
  if v_root <> p_job then
    select * into j from public.jobs where id = v_root;
    if j.phase = 'cancelled' then
      raise exception 'งานแม่ % ถูกยกเลิกแล้ว แก้ใบของส่วนที่แบ่งไม่ได้ · ถ้าลูกค้าแก้สเปก ให้รับเป็นใบใหม่', j.confirmation_no
        using errcode = 'P0001';
    end if;
    p_job := v_root;
  end if;
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว แก้ใบยืนยันไม่ได้' using errcode = 'P0001'; end if;

  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or jsonb_typeof(p_spec->'h') is distinct from 'object'
     or jsonb_typeof(p_spec->'p') is distinct from 'object' or jsonb_typeof(p_spec->'product') is distinct from 'string' then
    raise exception 'ข้อมูลใบยืนยันไม่ถูกต้อง ให้กดบันทึกจากฟอร์มใบยืนยันการผลิต' using errcode = '22023';
  end if;
  v_no := trim(coalesce(p_spec->'h'->>'doc_no', ''));
  if v_no <> j.confirmation_no then
    raise exception 'เลขที่ใบในฟอร์ม (%) ไม่ตรงกับงาน % · แก้เลขที่ใบกลับเป็น % แล้วบันทึกอีกครั้ง', v_no, j.confirmation_no, j.confirmation_no
      using errcode = '23514';
  end if;
  if p_spec->>'product' is distinct from j.product_type_code then
    raise exception 'เปลี่ยนชนิดสินค้าหลังรับงานไม่ได้ · ถ้าลูกค้าเปลี่ยนสินค้า ให้ผู้บริหารยกเลิกงานนี้แล้วรับใบใหม่' using errcode = '23514';
  end if;
  if p_needs_sample is distinct from j.needs_sample then
    raise exception 'งานนี้รับเข้าแบบ% เปลี่ยนในใบแก้ไม่ได้ · เลือก "ขึ้นตัวอย่าง" ในฟอร์มให้ตรงกับงาน',
      case when j.needs_sample then 'ขึ้นตัวอย่าง' else 'ไม่ขึ้นตัวอย่าง' end using errcode = '23514';
  end if;
  if p_spec->'h' ? 'sample' and ((p_spec->'h'->>'sample') ~ 'Develop') is distinct from j.develop then
    raise exception 'งานนี้รับเข้าแบบ% เปลี่ยนในใบแก้ไม่ได้ · เลือก "ขึ้นตัวอย่าง" ในฟอร์มให้ตรงกับงาน',
      case when j.develop then 'งาน Develop (จบที่ตัวอย่าง)' else 'ผลิตจริง' end using errcode = '23514';
  end if;
  if coalesce(p_rev, 0) < 1 then
    raise exception 'ใส่ "แก้ไขครั้งที่" ในฟอร์มก่อนบันทึกการแก้ (ใบแรกที่รับงานคือครั้งที่ 0)' using errcode = '23514';
  end if;
  if p_rev < j.confirmation_rev then
    raise exception 'งานนี้บันทึกใบแก้ไขครั้งที่ % ไว้แล้ว · ใส่ "แก้ไขครั้งที่" เป็น % ขึ้นไป', j.confirmation_rev, j.confirmation_rev
      using errcode = '23514';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then raise exception 'ต้องระบุชื่อลูกค้า' using errcode = '23514'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนต้องมากกว่า 0' using errcode = '23514'; end if;
  if coalesce(p_spare_qty, 0) < 0 then raise exception 'จำนวนเผื่อเสียติดลบไม่ได้' using errcode = '23514'; end if;
  if p_due_date is null then raise exception 'ต้องระบุกำหนดส่ง' using errcode = '23514'; end if;

  select array_agg(f.id order by x.confirmation_no), array_agg(x.confirmation_no order by x.confirmation_no), sum(x.qty)
    into family, parts, family_qty
    from private.split_family(p_job) f(id) join public.jobs x on x.id = f.id;
  split := cardinality(family) > 1;
  perform 1 from public.jobs where id = any(family) for update;

  if split and p_qty <> family_qty then
    raise exception 'งาน % ถูกแบ่งเป็น % แล้ว (รวม % ชิ้น) เปลี่ยนจำนวนในใบแก้ไม่ได้ · ใส่จำนวนในฟอร์มกลับเป็น % แล้วบันทึกอีกครั้ง · ถ้าลูกค้าสั่งเพิ่มให้รับเป็นงานใหม่',
      j.confirmation_no, array_to_string(parts, ', '), family_qty, family_qty using errcode = '23514';
  end if;
  if not split and p_qty <> j.qty and j.phase = 'done' then
    raise exception 'งาน % ผลิตเสร็จแล้ว เปลี่ยนจำนวนไม่ได้ · ถ้าลูกค้าสั่งเพิ่มให้รับเป็นงานใหม่', j.confirmation_no using errcode = 'P0001';
  end if;
  passed := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = p_job), 0);
  if not split and p_qty < passed then
    raise exception 'QC ผ่านไปแล้ว % ชิ้น ลดจำนวนต่ำกว่านี้ไม่ได้', passed using errcode = '23514';
  end if;
  -- ที่ QC จำนวนส่งแก้เป็นประวัติของรอบที่กลับมาแล้ว จึงตรวจเฉพาะตอนงานยังอยู่สถานีแก้
  if not split and p_qty < j.qty and j.is_rework and j.rework_qty > p_qty - passed
     and private.station_at(j.route_code, j.station_seq) is distinct from 'qc_pack' then
    if p_qty - passed < 1 then
      raise exception 'งาน % กำลังแก้ % ชิ้น (QC ผ่านแล้ว % ชิ้น) ลดจำนวนเหลือ % ไม่ได้ เพราะไม่เหลือชิ้นที่กำลังแก้ · ใส่จำนวนอย่างน้อย % หรือให้งานแก้กลับถึง QC ก่อนแล้วบันทึกใบแก้อีกครั้ง',
        j.confirmation_no, j.rework_qty, passed, p_qty, passed + 1 using errcode = '23514';
    end if;
    v_rework := p_qty - passed;
  end if;

  v_spec := p_spec - volatile_keys;
  v_job_name := coalesce(nullif(trim(p_job_name), ''), j.job_name);
  if (j.spec - volatile_keys) = v_spec and p_rev = j.confirmation_rev and trim(p_customer_name) = j.customer_name
     and v_job_name = j.job_name and (split or p_qty = j.qty) and coalesce(p_spare_qty, 0) = j.spare_qty and p_due_date = j.due_date then
    return jsonb_build_object('changed', false);
  end if;

  if not split and p_qty <> j.qty then summary := summary || format('จำนวน %s → %s', j.qty, p_qty); end if;
  if v_rework is not null then summary := summary || format('จำนวนส่งแก้ %s → %s', j.rework_qty, v_rework); end if;
  if coalesce(p_spare_qty, 0) <> j.spare_qty then summary := summary || format('เผื่อเสีย %s → %s', j.spare_qty, coalesce(p_spare_qty, 0)); end if;
  if p_due_date <> j.due_date then
    summary := summary || format('กำหนดส่ง %s → %s', private.thai_date(j.due_date), private.thai_date(p_due_date));
  end if;
  if trim(p_customer_name) <> j.customer_name then summary := summary || 'ชื่อลูกค้า'::text; end if;
  if v_job_name <> j.job_name then summary := summary || 'ชื่องาน'::text; end if;
  select coalesce(array_agg(l order by n), '{}') into labels from (
    select distinct on (l) left(trim(c), 80) as l, n from unnest(coalesce(p_changes, '{}')) with ordinality as t(c, n)
    where trim(coalesce(c, '')) <> '' order by l, n
  ) x;
  labels := labels[1:40];

  update public.jobs set spec = v_spec, confirmation_rev = p_rev, customer_name = trim(p_customer_name), job_name = v_job_name,
    qty = case when split then qty else p_qty end, rework_qty = coalesce(v_rework, rework_qty), spare_qty = coalesce(p_spare_qty, 0), due_date = p_due_date
    where id = p_job;
  update public.jobs set spec = v_spec, confirmation_rev = p_rev, customer_name = trim(p_customer_name), job_name = v_job_name,
    due_date = p_due_date
    where id = any(family) and id <> p_job and phase <> 'cancelled';

  select * into sheet from public.mockup_sheets where job_id = p_job and status = 'approved' order by rev desc limit 1;
  if found then
    select count(*) into stale from public.mockup_callouts c
      where c.sheet_id = sheet.id and c.spec_ref is not null
        and c.ref_value is distinct from private.mockup_ref_value(v_spec, c.spec_ref);
  end if;

  for m in select * from public.jobs where id = any(family) and (id = p_job or phase <> 'cancelled') loop
    perform private.log(m.id, 'spec_revised', m.phase, private.station_at(m.route_code, m.station_seq), jsonb_build_object(
      'rev_from', j.confirmation_rev, 'rev', p_rev, 'summary', to_jsonb(summary), 'fields', to_jsonb(labels),
      'qty_from', case when m.id = p_job then j.qty else m.qty end, 'qty_to', m.qty, 'due_from', j.due_date, 'due_to', p_due_date,
      'spare_from', case when m.id = p_job then j.spare_qty else m.spare_qty end, 'spare_to', m.spare_qty,
      'renamed', to_jsonb(array_remove(array[case when trim(p_customer_name) <> j.customer_name then 'ชื่อลูกค้า' end,
                                           case when v_job_name <> j.job_name then 'ชื่องาน' end], null)),
      'mockup_rev', case when m.id = p_job then sheet.rev end, 'mockup_stale', case when m.id = p_job then stale else 0 end,
      'parts', case when split then to_jsonb(parts) end));
  end loop;

  begin
    perform private.inbox_emit('spec_revised', j.id, 'revise:' || j.id || ':' || p_rev || ':' || extract(epoch from clock_timestamp()),
      format('แก้ใบยืนยัน %s ครั้งที่ %s', j.confirmation_no, p_rev),
      concat_ws(' · ', trim(p_customer_name), v_job_name,
        case when split then 'ใช้กับทุกส่วนที่แบ่ง: ' || array_to_string(parts, ', ') end,
        nullif(array_to_string(summary, ' · '), ''),
        case when cardinality(labels) > 0 then 'ช่องที่แก้: ' || array_to_string(labels[1:8], ', ')
          || case when cardinality(labels) > 8 then format(' และอีก %s ช่อง', cardinality(labels) - 8) else '' end end,
        case when stale > 0 then format('ม็อคอัพกำกับสเปกฉบับ %s ยังเป็นค่าเก่า %s จุด รอแอดมินทำฉบับใหม่', sheet.rev, stale) end,
        'ผลิตตามสเปกใหม่ในรายละเอียดงาน'),
      array['admin', 'production', 'supervisor', 'qc', 'manager']);
  exception when others then
    perform private.inbox_log_error('revise_job_spec', sqlerrm);
  end;

  return jsonb_build_object('changed', true, 'rev', p_rev, 'mockup_rev', sheet.rev, 'mockup_stale', stale,
    'parts', case when split then to_jsonb(parts) end);
end $$;

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
  -- จัดเลขคิวใหม่ก่อนล็อกแถวงาน: ล็อกทั้งตารางขณะถือแถวอยู่ = deadlock กับคนที่กดเริ่มงานเดียวกัน · เลขคิวเปลี่ยนได้เฉพาะคนที่ถือล็อกคิว จึงอ่านก่อนล็อกแถวได้
  select queue_seq into b.queue_seq from public.jobs where id = p_before;
  select max(queue_seq) into prev from public.jobs where queue_seq < b.queue_seq and id <> p_job;
  if prev is not null and b.queue_seq - prev < 2 then perform private.queue_renumber(); end if;
  j := private.lock_job(p_job);
  b := private.lock_job(p_before);
  if j.phase in ('done', 'cancelled') then raise exception 'งานนี้เสร็จหรือยกเลิกแล้ว แทรกคิวไม่ได้' using errcode = 'P0001'; end if;
  if b.phase in ('done', 'cancelled') then perform private.stale('งานที่จะแทรกก่อนเสร็จหรือยกเลิกแล้ว'); end if;
  if j.queue_seq < b.queue_seq then raise exception 'งาน % อยู่ก่อนงาน % ในคิวแล้ว', j.confirmation_no, b.confirmation_no using errcode = 'P0001'; end if;
  select max(queue_seq) into prev from public.jobs where queue_seq < b.queue_seq and id <> p_job;
  if prev is not null and b.queue_seq - prev < 2 then perform private.stale('เลขคิวเพิ่งถูกจัดใหม่'); end if;
  target := case when prev is null then b.queue_seq - 1024 else floor((prev + b.queue_seq) / 2) end;
  update public.jobs set queue_seq = target where id = p_job;
  perform private.log(p_job, 'queue_insert', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('before', b.confirmation_no, 'reason', btrim(p_reason), 'from', j.queue_seq, 'to', target));
end $$;

create or replace function public.split_job(p_job uuid, p_qty int, p_request uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; new_id uuid := gen_random_uuid(); new_no text; n int; nxt numeric; target numeric; prev text;
begin
  perform private.require_role('admin');
  perform pg_advisory_xact_lock(hashtext('pp142.job_queue'));
  -- จัดเลขคิวใหม่ก่อนล็อกแถวงาน (เหตุผลเดียวกับ move_job_ahead)
  select queue_seq into j.queue_seq from public.jobs where id = p_job;
  select min(queue_seq) into nxt from public.jobs where queue_seq > j.queue_seq;
  if nxt is not null and nxt - j.queue_seq < 2 then perform private.queue_renumber(); end if;
  j := private.lock_job(p_job);
  prev := private.claim_request(p_request, 'split_job');
  if prev is not null then return nullif(prev, '')::uuid; end if;
  if j.phase <> 'production' or j.station_status is distinct from 'queued' then
    raise exception 'แบ่งงานได้เฉพาะงานผลิตจริงที่ยังไม่เริ่มสถานีนี้' using errcode = 'P0001';
  end if;
  if j.is_rework then raise exception 'งานแก้แบ่งไม่ได้ (ส่งแก้ตามจำนวนที่ QC ส่งกลับ)' using errcode = 'P0001'; end if;
  if private.station_at(j.route_code, j.station_seq) = 'qc_pack' then raise exception 'งานที่ QC + Packing แบ่งไม่ได้' using errcode = 'P0001'; end if;
  if p_qty is null or p_qty < 1 or p_qty >= j.qty then
    raise exception 'จำนวนที่แบ่งต้องอยู่ระหว่าง 1 ถึง % %', j.qty - 1, j.unit using errcode = 'P0001';
  end if;
  n := 2;
  while exists (select 1 from public.jobs where confirmation_no = j.confirmation_no || '-' || n) loop n := n + 1; end loop;
  new_no := j.confirmation_no || '-' || n;
  -- คิวถัดจากงานเดิมทันที (ไม่ต่อท้ายคิว · ทั้งสองส่วนเป็นงานเดียวกันที่รับเข้ามาพร้อมกัน)
  select min(queue_seq) into nxt from public.jobs where queue_seq > j.queue_seq;
  if nxt is not null and nxt - j.queue_seq < 2 then perform private.stale('เลขคิวเพิ่งถูกจัดใหม่'); end if;
  -- งานสุดท้ายของคิว: ใช้เลขถัดไปจาก sequence ไม่อย่างนั้นแบ่งซ้ำแล้วได้เลขชนกับงานที่รับเข้าถัดไป
  target := case when nxt is null then nextval('public.job_queue_seq') else floor((j.queue_seq + nxt) / 2) end;

  insert into public.jobs select (jsonb_populate_record(null::public.jobs, to_jsonb(j) || jsonb_build_object(
    'id', new_id, 'confirmation_no', new_no, 'qty', p_qty, 'spare_qty', 0, 'sew_count', 0,
    'queue_seq', target, 'created_at', now(), 'created_by', auth.uid(), 'stage_entered_at', now()))).*;
  update public.jobs set qty = qty - p_qty where id = p_job;
  perform private.log(p_job, 'job_split', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('child', new_no, 'qty', p_qty, 'left', j.qty - p_qty));
  perform private.log(new_id, 'job_split_from', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('parent', j.confirmation_no, 'qty', p_qty, 'parent_left', j.qty - p_qty));
  perform private.finish_request(p_request, new_id::text);
  return new_id;
end $$;
