-- ลายเซ็นลูกค้า: ตัดจากส่วนที่แบ่งได้ (รูปอยู่โฟลเดอร์ของส่วนนั้น) · งานแม่ยกเลิกแล้วแต่ส่วนที่แบ่งยังผลิต แนบได้ · index + ล็อกเดียวกับ split_job
-- ใบงานบริการ: สินค้า svc_* ต้องมาจากใบงานบริการ · สินค้าของงานตรงกับใบ · UV DTF หน่วยของงานตรงกับใบ และเปลี่ยนหน่วยในใบแก้ไม่ได้

create index if not exists jobs_customer_signature_path_idx on public.jobs (customer_signature_path) where customer_signature_path is not null;

create or replace function public.set_customer_signature(p_job uuid, p_path text, p_signed_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; t public.jobs; v_root uuid;
begin
  perform private.require_role('admin');
  perform pg_advisory_xact_lock(hashtext('pp142.job_queue'));
  select * into t from public.jobs where id = p_job;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if t.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  v_root := private.split_root(p_job);
  select * into j from public.jobs where id = v_root for update;

  if p_path is null then
    if j.customer_signature_path is null then return; end if;
    update public.jobs set customer_signature_path = null, customer_signed_on = null, customer_signature_rev = null
    where id in (select private.split_family(j.id));
    perform private.log(j.id, 'customer_signature', j.phase, null,
      jsonb_build_object('removed', true, 'path', j.customer_signature_path));
    return;
  end if;

  perform private.check_mockup(p_path);
  if split_part(p_path, '/', 1) not in (private.mockup_folder(j.confirmation_no), private.mockup_folder(t.confirmation_no)) then
    raise exception 'รูปลายเซ็นนี้ไม่ใช่ของงาน % ให้ตัดลายเซ็นจากรายละเอียดงานนี้อีกครั้ง', t.confirmation_no using errcode = '23514';
  end if;
  if p_signed_on is null or p_signed_on = 'infinity'::date or p_signed_on = '-infinity'::date
     or extract(year from p_signed_on) not between 2000 and 2399 then
    raise exception 'ใส่วันที่ลูกค้าเซ็นให้ถูกต้อง (ปี ค.ศ. เช่น 2026)' using errcode = '23514';
  end if;
  if p_signed_on > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'วันที่ลูกค้าเซ็นอยู่ในอนาคต ให้ตรวจวันที่อีกครั้ง' using errcode = '23514';
  end if;

  update public.jobs set customer_signature_path = p_path, customer_signed_on = p_signed_on,
    customer_signature_rev = j.confirmation_rev
  where id in (select private.split_family(j.id));
  perform private.log(j.id, 'customer_signature', j.phase, null, jsonb_build_object(
    'path', p_path, 'signed_on', p_signed_on, 'rev', j.confirmation_rev, 'replaced', j.customer_signature_path is not null,
    'from', case when t.id <> j.id then t.confirmation_no end));
end $$;
revoke all on function public.set_customer_signature(uuid, text, date) from public, anon;
grant execute on function public.set_customer_signature(uuid, text, date) to authenticated;

create or replace function public.job_customer_signature(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs;
begin
  if private.my_role() is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  select * into j from public.jobs where id = private.split_root(p_job);
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.customer_signature_path is null then return jsonb_build_object('current_rev', j.confirmation_rev); end if;
  return jsonb_build_object('path', j.customer_signature_path, 'signed_on', j.customer_signed_on,
    'rev', j.customer_signature_rev, 'current_rev', j.confirmation_rev);
end $$;
revoke all on function public.job_customer_signature(uuid) from public, anon;
grant execute on function public.job_customer_signature(uuid) to authenticated;

create or replace function private.service_kind(p_spec jsonb) returns text
language sql immutable set search_path = '' as $$
  select case p_spec ->> 'product'
    when 'svc_sew' then 'sew:' || coalesce(p_spec -> 'p' -> 'svc_sew' ->> 'garment_code', '')
    when 'svc_print' then case when p_spec -> 'p' -> 'svc_print' ->> 'print_output' = 'พิมพ์แล้วรีดลงผ้าของลูกค้า' then 'print_press' else 'print' end
    when 'svc_press' then 'press'
    when 'svc_dtf' then case when p_spec -> 'p' -> 'svc_dtf' ->> 'film_source' = 'ลูกค้าส่งฟิล์มมาเอง' then 'dtf:customer' else 'dtf:factory' end
    when 'svc_uvdtf' then 'uvdtf:' || case when p_spec -> 'p' -> 'svc_uvdtf' ->> 'uv_unit' = 'ชิ้น' then 'ชิ้น' else 'แผ่น' end
  end
$$;
revoke all on function private.service_kind(jsonb) from public, anon, authenticated;

create or replace function private.guard_service_job() returns trigger
language plpgsql set search_path = '' as $$
declare v_kind text := private.service_kind(new.spec); v_route text := private.service_route(v_kind);
begin
  if tg_op = 'UPDATE' and v_kind is distinct from private.service_kind(old.spec) then
    raise exception 'งาน % เปลี่ยนแบบงานบริการในใบแก้ไม่ได้ (สินค้าที่เย็บ / ส่งกระดาษหรือรีดลงผ้า / ผู้จัดหาฟิล์ม / หน่วยนับ UV DTF) · ให้ผู้บริหารยกเลิกงานนี้แล้วรับใบใหม่',
      old.confirmation_no using errcode = '23514';
  end if;
  if new.product_type_code like 'svc\_%' and v_kind is null then
    raise exception 'สินค้างานบริการต้องรับจากใบงานบริการในฟอร์มใบยืนยัน · เปิดฟอร์ม เลือกใบงานบริการ แล้วบันทึกเข้าระบบใหม่' using errcode = '23514';
  end if;
  if v_kind is not null and v_kind not like 'sew:%' and new.product_type_code is distinct from new.spec ->> 'product' then
    raise exception 'สินค้าของงานต้องตรงกับใบงานบริการ · เลือกสินค้าให้ตรงกับใบ' using errcode = '23514';
  end if;
  if v_kind like 'uvdtf:%' and new.unit is distinct from split_part(v_kind, ':', 2) then
    raise exception 'หน่วยของงานต้องตรงกับใบ UV DTF (%) · รับงานจากใบในระบบอีกครั้ง', split_part(v_kind, ':', 2) using errcode = '23514';
  end if;
  if v_route is not null and new.route_code is distinct from v_route then
    raise exception 'ใบงานบริการนี้ต้องใช้เส้นทาง "%" · เลือกเส้นทางให้ตรงกับใบ', (select r.name from public.routes r where r.code = v_route)
      using errcode = '23514';
  end if;
  if v_route is null and new.route_code in ('sew_only', 'print_only', 'print_press_only', 'press_only', 'dtf_only')
     and new.product_type_code <> 'service' then
    raise exception 'เส้นทาง "%" ใช้กับใบงานบริการ (ลูกค้าส่งของมา) เท่านั้น · เลือกเส้นทางตามขั้นตอนผลิตของสินค้านี้',
      (select r.name from public.routes r where r.code = new.route_code) using errcode = '23514';
  end if;
  if v_kind like 'sew:%' and new.product_type_code is distinct from split_part(v_kind, ':', 2) then
    raise exception 'สินค้าของงานต้องเป็นสินค้าที่เลือกในใบเย็บอย่างเดียว · แก้ในฟอร์มใบยืนยัน แล้วบันทึกเข้าระบบใหม่' using errcode = '23514';
  end if;
  -- ลูกค้าส่งฟิล์มมาเอง = ไม่ต้องสั่ง · ของจริงเช็คตอนรอผลิต
  if tg_op = 'INSERT' and v_kind = 'dtf:customer' then
    new.dtf_film_ordered_at := coalesce(new.dtf_film_ordered_at, now());
    new.dtf_film_eta := coalesce(new.dtf_film_eta, (now() at time zone 'Asia/Bangkok')::date);
    new.dtf_film_received_at := coalesce(new.dtf_film_received_at, now());
  end if;
  return new;
end $$;
revoke all on function private.guard_service_job() from public, anon, authenticated;
