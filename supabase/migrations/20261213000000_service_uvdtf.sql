-- ใบงานบริการ UV DTF อย่างเดียว: ผลิตชิ้น UV DTF ให้ลูกค้า (ไม่รีดลงสินค้า) · สั่งผลิตข้างนอก → QC+Packing
insert into public.product_types (code, name, category, unit, sort) values
  ('svc_uvdtf', 'งานบริการ: UV DTF อย่างเดียว', 'other', 'แผ่น', 940)
on conflict (code) do nothing;

create or replace function private.service_kind(p_spec jsonb) returns text
language sql immutable set search_path = '' as $$
  select case p_spec ->> 'product'
    when 'svc_sew' then 'sew:' || coalesce(p_spec -> 'p' -> 'svc_sew' ->> 'garment_code', '')
    when 'svc_print' then case when p_spec -> 'p' -> 'svc_print' ->> 'print_output' = 'พิมพ์แล้วรีดลงผ้าของลูกค้า' then 'print_press' else 'print' end
    when 'svc_press' then 'press'
    when 'svc_dtf' then case when p_spec -> 'p' -> 'svc_dtf' ->> 'film_source' = 'ลูกค้าส่งฟิล์มมาเอง' then 'dtf:customer' else 'dtf:factory' end
    when 'svc_uvdtf' then 'uvdtf'
  end
$$;

create or replace function private.service_route(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case split_part(p_kind, ':', 1)
    when 'sew' then 'sew_only' when 'print' then 'print_only' when 'print_press' then 'print_press_only'
    when 'press' then 'press_only' when 'dtf' then 'dtf_only' when 'uvdtf' then 'outside'
  end
$$;
revoke all on function private.service_kind(jsonb), private.service_route(text) from public, anon, authenticated;
