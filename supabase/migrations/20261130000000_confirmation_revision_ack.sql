-- แอดมินแก้ใบยืนยันหลังรับงาน → สถานีที่งานอยู่ต้องกด "รับทราบใบแก้" ก่อนกดเสร็จ · ยึด event spec_revised ล่าสุด (แก้ซ้ำครั้งเดิมก็ต้องรับทราบใหม่)
-- หน้าเว็บอ่านวันเวลา ผู้แก้ ช่องที่แก้ และสถานีที่รับทราบแล้ว จาก confirmation_revision_flags

create table public.confirmation_acks (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  event_id     bigint not null references public.events(id) on delete cascade,
  rev          int not null,
  station_code text not null references public.stations(code),
  user_id      uuid references auth.users(id) on delete set null,
  at           timestamptz not null default now(),
  unique (event_id, station_code)
);
create index confirmation_acks_job_idx on public.confirmation_acks (job_id);
create index confirmation_acks_station_idx on public.confirmation_acks (station_code);
create index confirmation_acks_user_idx on public.confirmation_acks (user_id);
alter table public.confirmation_acks enable row level security;
create policy confirmation_acks_read on public.confirmation_acks for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
revoke all on public.confirmation_acks from anon;
grant select on public.confirmation_acks to authenticated;
create index events_spec_revised_idx on public.events (job_id, id) where type = 'spec_revised';

-- งานที่แบ่งออกมานับใบแก้ของงานต้นทางก่อนแบ่งด้วย
create or replace function private.latest_revision(j public.jobs) returns public.events
language sql stable security definer set search_path = '' as $$
  select e.* from private.split_lineage(j.id) l
  join public.events e on e.job_id = l.job_id and (l.until_event is null or e.id < l.until_event)
  where e.type = 'spec_revised'
  order by e.id desc limit 1
$$;
revoke all on function private.latest_revision(public.jobs) from public, anon, authenticated;

create or replace function private.revision_ack_missing(p_job uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs; ev public.events; cur text;
begin
  select * into j from public.jobs where id = p_job;
  if not found or j.phase not in ('sample', 'production') or j.station_seq is null then return '{}'; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if cur is null or cur = 'outside' then return '{}'; end if;
  ev := private.latest_revision(j);
  if ev.id is null or exists (select 1 from public.confirmation_acks a where a.event_id = ev.id and a.station_code = cur) then
    return '{}';
  end if;
  return array[format('กด "รับทราบใบแก้" ก่อน · แอดมินแก้ใบยืนยันครั้งที่ %s เมื่อ %s %s น.', coalesce(ev.payload ->> 'rev', '?'),
    private.thai_date((ev.at at time zone 'Asia/Bangkok')::date), to_char(ev.at at time zone 'Asia/Bangkok', 'HH24:MI'))];
end $$;
revoke all on function private.revision_ack_missing(uuid) from public, anon, authenticated;

-- เหมือน 20261129000000 เพิ่ม: ต้องรับทราบใบแก้ก่อนกดเสร็จ (ใช้กับเย็บและงานแก้ด้วย)
create or replace function private.missing_substeps(p_job uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs; cur text; sub jsonb; k text; kind text; passed int; miss text[] := '{}';
begin
  select * into j from public.jobs where id = p_job;
  cur := private.station_at(j.route_code, j.station_seq);
  if not (cur = 'sew' or (j.is_rework and cur <> 'qc_pack')) then
    for sub in select s from public.stations st, jsonb_array_elements(st.substeps) s where st.code = cur loop
      k := sub->>'key'; kind := sub->>'kind';
      if kind = 'lock' then
        if j.dtf_film_received_at is null then
          miss := miss || format('รอแอดมินบันทึก "%s"', sub->>'name');
        end if;
      elsif cur = 'qc_pack' and k = 'inspect' and j.phase = 'production' then
        passed := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0);
        if passed < j.qty then
          miss := miss || format('QC ตรวจผ่าน %s/%s ชิ้น ยังไม่ครบ (ชิ้นไม่ผ่านให้กด "ส่งแก้")', passed, j.qty);
        end if;
      end if;
    end loop;
  end if;
  return miss || private.revision_ack_missing(p_job) || private.photo_gate_missing(p_job);
end $$;

create or replace function public.ack_confirmation_revision(p_job uuid, p_station text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r text; cur text; ev public.events;
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') or j.station_seq is null then perform private.stale('งานไม่ได้อยู่ในสถานี'); end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if p_station is distinct from cur then perform private.stale('งานนี้ไปอยู่สถานีอื่นแล้ว'); end if;
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC รับทราบได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;
  ev := private.latest_revision(j);
  if ev.id is null then raise exception 'งานนี้ยังไม่มีใบแก้ให้รับทราบ' using errcode = 'P0001'; end if;
  insert into public.confirmation_acks (job_id, event_id, rev, station_code, user_id)
  values (j.id, ev.id, coalesce((ev.payload ->> 'rev')::int, j.confirmation_rev), cur, auth.uid())
  on conflict (event_id, station_code) do nothing;
  if found then
    perform private.log(j.id, 'confirmation_ack', j.phase, cur,
      jsonb_build_object('rev', ev.payload -> 'rev', 'event_id', ev.id, 'revised_at', ev.at));
  end if;
end $$;
revoke all on function public.ack_confirmation_revision(uuid, text) from public, anon;
grant execute on function public.ack_confirmation_revision(uuid, text) to authenticated;

create or replace function public.confirmation_revision_flags()
returns table (job_id uuid, rev int, revised_at timestamptz, revised_by text, fields text[], summary text[], event_id bigint, acked_stations text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  return query
  select j.id, coalesce((ev.payload ->> 'rev')::int, j.confirmation_rev), ev.at, p.name,
    array(select jsonb_array_elements_text(coalesce(ev.payload -> 'fields', '[]'))),
    array(select jsonb_array_elements_text(coalesce(ev.payload -> 'summary', '[]'))),
    ev.id,
    array(select a.station_code from public.confirmation_acks a where a.event_id = ev.id order by a.station_code)
  from public.jobs j
  cross join lateral (select e.* from private.split_lineage(j.id) l
    join public.events e on e.job_id = l.job_id and (l.until_event is null or e.id < l.until_event)
    where e.type = 'spec_revised' order by e.id desc limit 1) ev
  left join public.profiles p on p.user_id = ev.by
  where j.phase not in ('done', 'cancelled');
end $$;
revoke all on function public.confirmation_revision_flags() from public, anon;
grant execute on function public.confirmation_revision_flags() to authenticated;
