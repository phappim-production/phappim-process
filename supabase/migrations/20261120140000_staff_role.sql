-- บทบาทพนักงานสถานี (staff) + ตารางจับคู่พนักงานกับสถานี
-- staff กดได้เหมือนฝ่าย QC แต่เฉพาะงานที่อยู่สถานีที่จับคู่ไว้ (ตรวจใน lock_job)

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','supervisor','admin','qc','production','manager','staff'));

create table public.staff_stations (
  user_id      uuid not null references public.profiles(user_id) on delete cascade,
  station_code text not null references public.stations(code) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, station_code)
);
create index staff_stations_station_idx on public.staff_stations (station_code);
alter table public.staff_stations enable row level security;
create policy staff_stations_read on public.staff_stations for select to authenticated
  using ((select private.my_role()) is not null);
create policy staff_stations_owner_insert on public.staff_stations for insert to authenticated
  with check ((select private.is_owner()));
create policy staff_stations_owner_delete on public.staff_stations for delete to authenticated
  using ((select private.is_owner()));
revoke all on public.staff_stations from anon;
grant select, insert, delete on public.staff_stations to authenticated;

create or replace function private.require_role(variadic p_roles text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r text := private.my_role();
begin
  if r is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  if r = 'production' and 'supervisor' = any (p_roles) and not ('production' = any (p_roles)) then
    return 'supervisor';
  end if;
  if r = 'staff' and 'qc' = any (p_roles) then
    return 'staff';
  end if;
  if r <> 'owner' and not (r = any (p_roles)) then
    raise exception 'บทบาทของคุณ (%) ทำขั้นนี้ไม่ได้', r using errcode = '42501';
  end if;
  return r;
end $$;
revoke all on function private.require_role(text[]) from public, anon;

create or replace function private.lock_job(p_job uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  my_section smallint;
  st public.stations;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;

  if private.my_role() = 'supervisor' and j.phase in ('sample', 'production') and j.station_seq is not null then
    select p.section into my_section from public.profiles p where p.user_id = (select auth.uid());
    if my_section is not null then
      select s.* into st
      from public.route_stations rs join public.stations s on s.code = rs.station_code
      where rs.route_code = j.route_code and rs.seq = j.station_seq;
      if found and st.section <> my_section then
        raise exception 'งานนี้อยู่สถานี% (เฟส %) ให้ผู้ควบคุมงานเฟส % เป็นคนกด', st.name, st.section, st.section
          using errcode = '42501';
      end if;
    end if;
  end if;

  if private.my_role() = 'staff' then
    select s.* into st
    from public.route_stations rs join public.stations s on s.code = rs.station_code
    where rs.route_code = j.route_code and rs.seq = j.station_seq and j.phase in ('sample', 'production');
    if not found then
      raise exception 'งานนี้ยังไม่อยู่ที่สถานีใด ให้ฝ่ายผลิตเป็นคนกด' using errcode = '42501';
    end if;
    if not exists (select 1 from public.staff_stations ss where ss.user_id = (select auth.uid()) and ss.station_code = st.code) then
      raise exception 'งานนี้อยู่สถานี% ซึ่งไม่ใช่สถานีของคุณ ให้เจ้าของระบบจับคู่สถานีให้ก่อน หรือให้ฝ่ายผลิตกด', st.name
        using errcode = '42501';
    end if;
  end if;
  return j;
end $$;
