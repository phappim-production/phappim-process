-- เส้นทาง "พิมพ์ + DTF": พิมพ์ → รีด → ตัด → รีดฟิล์ม → เย็บ → QC+Packing · ต้องได้รับฟิล์ม DTF ก่อนเริ่มรีดฟิล์ม
-- เย็บที่โรงงานหรือส่งเย็บข้างนอก แอดมินเลือกตอนงานถึงสถานีเย็บ (send_out เดิม)

insert into public.routes (code, name, description) values
  ('print_dtf', 'พิมพ์ + DTF', 'พิมพ์ → รีด → ตัด → รีดฟิล์ม → เย็บ → QC+Packing · แอดมินต้องสั่งฟิล์ม DTF')
on conflict (code) do nothing;

insert into public.route_stations (route_code, seq, station_code) values
  ('print_dtf', 1, 'print'), ('print_dtf', 2, 'press'), ('print_dtf', 3, 'cut'),
  ('print_dtf', 4, 'dtf_press'), ('print_dtf', 5, 'sew'), ('print_dtf', 6, 'qc_pack')
on conflict do nothing;

create or replace function private.uses_film(p_route text) returns boolean
language sql immutable set search_path = '' as $$
  select p_route in ('dtf', 'dtg', 'screen', 'dtf_only', 'print_dtf')
$$;
