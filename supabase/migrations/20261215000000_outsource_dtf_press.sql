-- รีดฟิล์มส่งออกบริษัทภายนอกได้ทั้งงาน (ตอนงานยังไม่เริ่มสถานีนี้) เหมือน พิมพ์ · รีด · ตัด · เย็บ · ปัก
-- ข้อความ error ที่บอกรายชื่อสถานีที่ส่งออกได้ เพิ่ม รีดฟิล์ม

create or replace function private.outsourceable(p_station text) returns boolean
language sql immutable set search_path = '' as $$
  select p_station in ('outside', 'print', 'press', 'cut', 'dtf_press', 'sew', 'emb')
$$;

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
      raise exception 'สถานี % ทำที่โรงงานเท่านั้น ส่งออกได้แค่ พิมพ์ · รีด · ตัด · รีดฟิล์ม · เย็บ · ปัก ที่อยู่ติดกัน', private.station_name(rs.station_code) using errcode = 'P0001';
    end if;
    stations := stations || rs.station_code;
    to_seq := rs.seq;
    if rs.station_code = p_last then return; end if;
  end loop;
end $$;
revoke all on function private.out_span(text, int, text) from public, anon, authenticated;

create or replace function public.add_vendor(p_name text, p_stations text[] default '{}', p_contact text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  perform private.require_role('admin');
  if coalesce(btrim(p_name), '') = '' then raise exception 'ใส่ชื่อบริษัท' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(coalesce(p_stations, '{}')) s where not private.outsourceable(s)) then
    raise exception 'งานที่บริษัทรับต้องเป็น พิมพ์ · รีด · ตัด · รีดฟิล์ม · เย็บ · ปัก' using errcode = 'P0001';
  end if;
  insert into public.vendors (name, stations, contact) values (btrim(p_name), coalesce(p_stations, '{}'), nullif(btrim(p_contact), ''))
  on conflict (name) do update set active = true, stations = excluded.stations, contact = coalesce(excluded.contact, public.vendors.contact)
  returning id into v;
  return v;
end $$;
