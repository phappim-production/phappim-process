-- จำนวนเครื่องจริงต่อสถานี: เครื่องเต็มแล้วเริ่มงานใหม่ไม่ได้ · งานที่พักไม่นับว่าใช้เครื่อง · แก้แล้วถ้าเครื่องเต็มกลับเข้าคิว
-- สถานีที่ใช้เครื่องร่วมกัน (machine_pool เดียวกัน) นับรวมกัน · เพิ่มจักรลาตัวที่ 2

alter table public.stations add column machines smallint check (machines between 1 and 50);
alter table public.stations add column machine_pool text;

update public.stations set machines = 2, machine_pool = 'print' where code = 'print';
update public.stations set machines = 1, machine_pool = 'heat_press' where code in ('press', 'dtf_press');
update public.stations set machines = 2, machine_pool = 'cut' where code = 'cut';
update public.stations set machines = 1, machine_pool = 'qc_pack' where code = 'qc_pack';

insert into public.sewing_machines (code, type_code, sort)
select 'CV-002', 'cover', t.sort * 100 + 2 from public.machine_types t where t.code = 'cover'
on conflict (code) do nothing;

-- null = ไม่จำกัด (ปักเป็นร้านนอก · เย็บคุมด้วยจักรรายตัวแทน)
create or replace function private.station_full(p_job uuid, p_station text) returns text
language plpgsql security definer set search_path = '' as $$
declare st public.stations; busy text[];
begin
  select * into st from public.stations where code = p_station;
  if st.machines is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('station_machines:' || coalesce(st.machine_pool, st.code)));
  select array_agg(j.confirmation_no order by j.station_started_at) into busy
  from public.jobs j
  join public.stations s on s.code = private.station_at(j.route_code, j.station_seq)
  where j.id <> p_job and j.phase in ('sample', 'production') and j.station_status = 'doing'
    and coalesce(s.machine_pool, s.code) = coalesce(st.machine_pool, st.code);
  if coalesce(cardinality(busy), 0) < st.machines then return null; end if;
  return format('เครื่อง%sเต็ม (ใช้อยู่ %s/%s เครื่อง: %s) · รอให้งานเสร็จ หรือพักงานที่ติดปัญหาก่อน',
    st.name, cardinality(busy), st.machines, array_to_string(busy, ', '));
end $$;
revoke all on function private.station_full(uuid, text) from public, anon;

create or replace function public.start_station(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; r text; full_text text;
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
  update public.jobs set station_status = 'doing', station_started_at = now() where id = p_job;
  perform private.log(p_job, 'station_start', j.phase, cur,
    jsonb_build_object('visit', j.visit, 'round', j.sample_round, 'rework', j.is_rework));
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
    jsonb_build_object('issue_id', i.id, 'note', nullif(trim(p_note), ''), 'requeued', requeued));
end $$;
