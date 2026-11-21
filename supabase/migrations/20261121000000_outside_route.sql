-- เส้นทาง "ผลิตข้างนอกทั้งหมด": สั่งผลิตข้างนอก → QC+Packing · แอดมินกดส่งออก แล้วรับของกลับเข้า QC
-- สถานีสั่งผลิตข้างนอกไม่มีคนในโรงงานทำ จึงกดเริ่มไม่ได้ ต้องส่งออกเท่านั้น

insert into public.stations (code, name, sort, substeps, section, machines)
values ('outside', 'สั่งผลิตข้างนอก', 5, '[]', 1, null)
on conflict (code) do nothing;

insert into public.routes (code, name, description)
values ('outside', 'ผลิตข้างนอกทั้งหมด', 'สั่งผลิตข้างนอก → QC+Packing · แอดมินกดส่งออก เลือกบริษัท แล้วรับของกลับเข้า QC')
on conflict (code) do nothing;

insert into public.route_stations (route_code, seq, station_code)
values ('outside', 1, 'outside'), ('outside', 2, 'qc_pack')
on conflict do nothing;

create or replace function private.outsourceable(p_station text) returns boolean
language sql immutable set search_path = '' as $$
  select p_station in ('outside', 'print', 'press', 'cut', 'sew', 'emb')
$$;

create or replace function private.guard_outside_start() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.station_status = 'doing' and old.station_status is distinct from 'doing'
     and private.station_at(new.route_code, new.station_seq) = 'outside' then
    raise exception 'งาน % ผลิตข้างนอกทั้งหมด เริ่มที่โรงงานไม่ได้ · ให้แอดมินกด "ส่งออกบริษัทภายนอก" แล้วกด "รับเข้า" เมื่อของถึง',
      old.confirmation_no using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.guard_outside_start() from public, anon;
create trigger jobs_guard_outside_start before update on public.jobs
  for each row execute function private.guard_outside_start();
