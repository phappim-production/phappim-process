-- ส่งงานออกบริษัทภายนอก (เจ้าของสั่ง 18 พ.ย.)
-- พิมพ์ · รีด · ตัด · เย็บ · ปัก ส่งออกได้ · ส่งได้หลายสถานีติดกันในครั้งเดียว (บ.A พิมพ์-รีด-ตัด)
-- ส่งต่อจากบริษัทหนึ่งไปอีกบริษัทได้โดยไม่ผ่านโรงงาน (บ.A → บ.B เย็บ) · รับของกลับแล้วงานเข้าสถานีถัดไปที่โรงงาน (QC + Packing)
-- จดเวลา: ของถึงบริษัทเมื่อไร · บริษัทใช้กี่วัน · คาดว่าของถึงที่ต่อไปเมื่อไร · ของถึงจริงเมื่อไร
-- แบ่งจำนวนได้ด้วย split_job (500 → 300 + 200 เป็น 2 งาน ติดตามแยกกัน แล้วส่งออกงานที่ต้องการ)
-- แอดมินเป็นคนบันทึก (owner ทำแทนได้) · QC ไม่ผ่านส่งกลับสถานีต้นเหตุตามเดิม แล้วแอดมินเลือกส่งออกไปแก้หรือแก้เองที่โรงงาน

-- 1. สถานะใหม่ของงานที่สถานี: out = อยู่ที่บริษัทภายนอก
alter table public.jobs drop constraint jobs_station_status_check;
alter table public.jobs add constraint jobs_station_status_check check (station_status in ('queued', 'doing', 'hold', 'out'));

-- 2. บริษัทภายนอก
create table public.vendors (
  id         bigint generated always as identity primary key,
  name       text not null unique check (btrim(name) <> ''),
  stations   text[] not null default '{}',          -- งานที่บริษัทนี้รับ (ใช้เรียงในรายการ ไม่บังคับ)
  contact    text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.vendors enable row level security;
create policy vendors_read on public.vendors for select to authenticated using (true);
revoke all on public.vendors from anon;
grant select on public.vendors to authenticated;

-- 3. รอบส่งออก: 1 แถว = งานนี้อยู่ที่บริษัทหนึ่ง ทำสถานี from_seq..to_seq ของเส้นทาง
create table public.outsource_runs (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  vendor_id   bigint not null references public.vendors(id),
  from_seq    int not null,
  to_seq      int not null check (to_seq >= from_seq),
  stations    text[] not null,
  qty         int not null check (qty > 0),
  is_rework   boolean not null default false,
  sent_at     timestamptz not null default now(),   -- ออกจากที่เดิม (โรงงาน หรือบริษัทก่อนหน้า)
  arrive_at   timestamptz not null,                 -- ของถึงบริษัทนี้
  lead_days   numeric not null check (lead_days >= 0), -- บริษัทใช้เวลาทำกี่วัน
  back_at     timestamptz not null,                 -- คาดว่าของถึงที่ต่อไป (โรงงาน / บริษัทถัดไป)
  note        text,
  closed_at   timestamptz,                          -- ของถึงที่ต่อไปจริง
  closed_how  text check (closed_how in ('received', 'forwarded')),
  next_run_id bigint references public.outsource_runs(id),
  created_by  uuid default auth.uid(),
  closed_by   uuid,
  check (back_at >= arrive_at)
);
create index outsource_runs_job_idx on public.outsource_runs (job_id);
create index outsource_runs_vendor_idx on public.outsource_runs (vendor_id);
create index outsource_runs_next_idx on public.outsource_runs (next_run_id);
create unique index outsource_runs_one_open on public.outsource_runs (job_id) where closed_at is null;
alter table public.outsource_runs enable row level security;
create policy outsource_runs_read on public.outsource_runs for select to authenticated using (true);
revoke all on public.outsource_runs from anon;
grant select on public.outsource_runs to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.outsource_runs;
  end if;
end $$;

-- 4. งานที่อยู่ข้างนอกห้ามเดินต่อด้วยปุ่มของโรงงาน (เริ่ม/เสร็จ/พัก/ยกเลิก) · เปลี่ยนได้เฉพาะผ่านฟังก์ชันส่งออก/รับกลับ
create or replace function private.guard_outsourced() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.station_status = 'out' and coalesce(current_setting('pp142.outsource', true), '') <> '1'
     and (new.station_status is distinct from old.station_status or new.station_seq is distinct from old.station_seq
          or new.phase is distinct from old.phase) then
    raise exception 'งาน % อยู่ที่บริษัทภายนอก แอดมินต้องกด "รับของกลับ" ก่อน', old.confirmation_no using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger jobs_guard_outsourced before update on public.jobs
  for each row execute function private.guard_outsourced();

-- สถานีที่ส่งออกได้
create or replace function private.outsourceable(p_station text) returns boolean
language sql immutable set search_path = '' as $$
  select p_station in ('print', 'press', 'cut', 'sew', 'emb')
$$;

-- สถานีจาก p_from ถึงสถานีชื่อ p_last ในเส้นทาง (ติดกัน · ส่งออกได้ทุกสถานี) → คืน (seq สุดท้าย, รายชื่อสถานี)
create or replace function private.out_span(p_route text, p_from int, p_last text, out to_seq int, out stations text[])
language plpgsql stable security definer set search_path = '' as $$
declare rs record;
begin
  if not exists (select 1 from public.route_stations where route_code = p_route and seq >= p_from and station_code = p_last) then
    raise exception 'สถานี % ไม่อยู่ในเส้นทางของงานนี้หลังสถานีปัจจุบัน', private.station_name(p_last) using errcode = 'P0001';
  end if;
  stations := '{}';
  for rs in select seq, station_code from public.route_stations where route_code = p_route and seq >= p_from order by seq loop
    if not private.outsourceable(rs.station_code) then
      raise exception 'สถานี % ทำที่โรงงานเท่านั้น ส่งออกได้แค่ พิมพ์ · รีด · ตัด · เย็บ · ปัก ที่อยู่ติดกัน', private.station_name(rs.station_code) using errcode = 'P0001';
    end if;
    stations := stations || rs.station_code;
    to_seq := rs.seq;
    if rs.station_code = p_last then return; end if;
  end loop;
end $$;

create or replace function private.station_name(p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select name from public.stations where code = p_code), p_code)
$$;

create or replace function private.check_out_plan(p_arrive_at timestamptz, p_lead_days numeric, p_back_at timestamptz) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_arrive_at is null or p_back_at is null or p_lead_days is null then
    raise exception 'กรอกให้ครบ: ของถึงบริษัทเมื่อไร · ใช้เวลากี่วัน · คาดว่าของถึงที่ต่อไปเมื่อไร' using errcode = 'P0001';
  end if;
  if p_lead_days < 0 or p_lead_days > 60 then raise exception 'จำนวนวันที่บริษัทใช้ต้องอยู่ระหว่าง 0–60 วัน' using errcode = 'P0001'; end if;
  if p_back_at < p_arrive_at then raise exception 'วันที่ของถึงที่ต่อไป ต้องไม่ก่อนวันที่ของถึงบริษัท' using errcode = 'P0001'; end if;
end $$;

-- 5. เพิ่มบริษัทภายนอก
create or replace function public.add_vendor(p_name text, p_stations text[] default '{}', p_contact text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  perform private.require_role('admin');
  if coalesce(btrim(p_name), '') = '' then raise exception 'ใส่ชื่อบริษัท' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(coalesce(p_stations, '{}')) s where not private.outsourceable(s)) then
    raise exception 'งานที่บริษัทรับต้องเป็น พิมพ์ · รีด · ตัด · เย็บ · ปัก' using errcode = 'P0001';
  end if;
  insert into public.vendors (name, stations, contact) values (btrim(p_name), coalesce(p_stations, '{}'), nullif(btrim(p_contact), ''))
  on conflict (name) do update set active = true, stations = excluded.stations, contact = coalesce(excluded.contact, public.vendors.contact)
  returning id into v;
  return v;
end $$;

-- 6. ส่งออก: งานรอเริ่มที่สถานีปัจจุบัน → บริษัททำตั้งแต่สถานีนี้ถึง p_last_station
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
  perform private.log(p_job, 'outsource_sent', j.phase, cur, jsonb_build_object(
    'run', run_id, 'vendor', vname, 'stations', to_jsonb(span.stations), 'arrive_at', p_arrive_at,
    'lead_days', p_lead_days, 'back_at', p_back_at, 'rework', j.is_rework, 'note', nullif(btrim(p_note), '')));
  return run_id;
end $$;

-- 7. ส่งต่อบริษัทอื่นโดยไม่ผ่านโรงงาน (บ.A ทำเสร็จ → บ.B ทำสถานีถัดไป)
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
  perform private.log(j.id, 'outsource_forwarded', j.phase, private.station_at(j.route_code, r.to_seq + 1), jsonb_build_object(
    'run', run_id, 'from_vendor', old_vendor, 'vendor', vname, 'done_stations', to_jsonb(r.stations), 'stations', to_jsonb(span.stations),
    'arrive_at', p_arrive_at, 'lead_days', p_lead_days, 'back_at', p_back_at));
  return run_id;
end $$;

-- 8. รับของกลับเข้าโรงงาน → งานเข้าสถานีถัดไป (งานแก้ → กลับ QC)
create or replace function public.receive_back(p_run bigint, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.outsource_runs; j public.jobs; next_seq int; vname text;
begin
  perform private.require_role('admin');
  select * into r from public.outsource_runs where id = p_run for update;
  if not found or r.closed_at is not null then perform private.stale('รอบส่งออกนี้ปิดไปแล้ว'); end if;
  j := private.lock_job(r.job_id);
  next_seq := case when r.is_rework then private.last_seq(j.route_code) else r.to_seq + 1 end;
  if next_seq > private.last_seq(j.route_code) then perform private.stale('ไม่มีสถานีถัดไปที่โรงงาน'); end if;
  select name into vname from public.vendors where id = r.vendor_id;
  update public.outsource_runs set closed_at = now(), closed_how = 'received', closed_by = auth.uid(),
    note = coalesce(nullif(btrim(p_note), ''), note) where id = r.id;
  perform set_config('pp142.outsource', '1', true);
  perform private.enter_station(j.id, next_seq);
  perform set_config('pp142.outsource', '', true);
  perform private.log(j.id, 'outsource_received', j.phase, private.station_at(j.route_code, next_seq), jsonb_build_object(
    'run', r.id, 'vendor', vname, 'done_stations', to_jsonb(r.stations), 'late', now() > r.back_at, 'note', nullif(btrim(p_note), '')));
end $$;

-- 9. แก้กำหนด (บริษัทเลื่อน / ของถึงไม่ตรงที่คาด)
create or replace function public.update_out_plan(p_run bigint, p_arrive_at timestamptz, p_lead_days numeric, p_back_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.outsource_runs;
begin
  perform private.require_role('admin');
  select * into r from public.outsource_runs where id = p_run for update;
  if not found or r.closed_at is not null then perform private.stale('รอบส่งออกนี้ปิดไปแล้ว'); end if;
  perform private.check_out_plan(p_arrive_at, p_lead_days, p_back_at);
  update public.outsource_runs set arrive_at = p_arrive_at, lead_days = p_lead_days, back_at = p_back_at where id = p_run;
  perform private.log(r.job_id, 'outsource_plan', null, null, jsonb_build_object(
    'run', r.id, 'arrive_at', p_arrive_at, 'lead_days', p_lead_days, 'back_at', p_back_at, 'old_back_at', r.back_at));
end $$;

-- 10. แบ่งงาน: งานที่รอเริ่มสถานีปัจจุบัน แยก p_qty ชิ้นเป็นงานใหม่ (เลขที่ใบเดิม-2, -3 …) อยู่สถานีเดียวกัน คิวถัดจากงานเดิม
create or replace function public.split_job(p_job uuid, p_qty int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; new_id uuid := gen_random_uuid(); new_no text; n int; nxt numeric; target numeric;
begin
  perform private.require_role('admin');
  perform pg_advisory_xact_lock(hashtext('pp142.job_queue'));
  j := private.lock_job(p_job);
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
  if nxt is not null and nxt - j.queue_seq < 2 then
    perform private.queue_renumber();
    select queue_seq into j.queue_seq from public.jobs where id = p_job;
    select min(queue_seq) into nxt from public.jobs where queue_seq > j.queue_seq;
  end if;
  target := case when nxt is null then j.queue_seq + 512 else floor((j.queue_seq + nxt) / 2) end;

  insert into public.jobs select (jsonb_populate_record(null::public.jobs, to_jsonb(j) || jsonb_build_object(
    'id', new_id, 'confirmation_no', new_no, 'qty', p_qty, 'spare_qty', 0, 'sew_count', 0,
    'queue_seq', target, 'created_at', now(), 'created_by', auth.uid(), 'stage_entered_at', now()))).*;
  update public.jobs set qty = qty - p_qty where id = p_job;
  perform private.log(p_job, 'job_split', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('child', new_no, 'qty', p_qty, 'left', j.qty - p_qty));
  perform private.log(new_id, 'job_split_from', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('parent', j.confirmation_no, 'qty', p_qty, 'parent_left', j.qty - p_qty));
  return new_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_vendor(text,text[],text)',
    'public.send_out(uuid,bigint,text,timestamptz,numeric,timestamptz,text)',
    'public.forward_out(bigint,bigint,text,timestamptz,numeric,timestamptz,text)',
    'public.receive_back(bigint,text)',
    'public.update_out_plan(bigint,timestamptz,numeric,timestamptz)',
    'public.split_job(uuid,int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.out_span(text, int, text) from public, anon, authenticated;
revoke all on function private.guard_outsourced() from public, anon, authenticated;
