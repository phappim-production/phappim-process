-- ใบงานบริการ (ลูกค้าส่งของมา): เย็บ / พิมพ์ / พิมพ์ + รีด / รีด / DTF อย่างเดียว = เส้นทางสถานีเดียว + QC
-- ฐานข้อมูลบังคับเส้นทางให้ตรงใบ · เปลี่ยนแบบบริการในใบแก้ไม่ได้ · ใบเย็บอย่างเดียวใช้สินค้าเสื้อผ้าที่เลือก (สูตรจักร)

insert into public.routes (code, name, description) values
  ('sew_only', 'เย็บอย่างเดียว', 'ลูกค้าส่งชิ้นส่วนที่ตัดแล้ว: เย็บ → QC+Packing'),
  ('print_only', 'พิมพ์อย่างเดียว (ส่งกระดาษ)', 'พิมพ์ลงกระดาษส่งลูกค้า: พิมพ์ → QC+Packing'),
  ('print_press_only', 'พิมพ์ + รีดลงผ้าลูกค้า', 'ลูกค้าส่งผ้ามา: พิมพ์ → รีด → QC+Packing'),
  ('press_only', 'รีดอย่างเดียว', 'ลูกค้าส่งกระดาษพิมพ์แล้ว + ผ้า/ชิ้นงาน: รีด → QC+Packing'),
  ('dtf_only', 'DTF อย่างเดียว', 'ลูกค้าส่งชิ้นงานมา: รีดฟิล์ม → QC+Packing')
on conflict (code) do nothing;
insert into public.route_stations (route_code, seq, station_code) values
  ('sew_only', 1, 'sew'), ('sew_only', 2, 'qc_pack'),
  ('print_only', 1, 'print'), ('print_only', 2, 'qc_pack'),
  ('print_press_only', 1, 'print'), ('print_press_only', 2, 'press'), ('print_press_only', 3, 'qc_pack'),
  ('press_only', 1, 'press'), ('press_only', 2, 'qc_pack'),
  ('dtf_only', 1, 'dtf_press'), ('dtf_only', 2, 'qc_pack')
on conflict do nothing;

insert into public.product_types (code, name, category, unit, sort) values
  ('svc_print', 'งานบริการ: พิมพ์อย่างเดียว', 'other', 'หลา', 910),
  ('svc_press', 'งานบริการ: รีดอย่างเดียว', 'other', 'ชิ้น', 920),
  ('svc_dtf', 'งานบริการ: DTF อย่างเดียว', 'other', 'ชิ้น', 930)
on conflict (code) do nothing;

create or replace function private.uses_film(p_route text) returns boolean
language sql immutable set search_path = '' as $$
  select p_route in ('dtf', 'dtg', 'screen', 'dtf_only')
$$;

-- ค่าตัวเลือกต้องตรงกับฟอร์มใบยืนยันทุกตัวอักษร (svc_print.print_output · svc_dtf.film_source)
create or replace function private.service_kind(p_spec jsonb) returns text
language sql immutable set search_path = '' as $$
  select case p_spec ->> 'product'
    when 'svc_sew' then 'sew:' || coalesce(p_spec -> 'p' -> 'svc_sew' ->> 'garment_code', '')
    when 'svc_print' then case when p_spec -> 'p' -> 'svc_print' ->> 'print_output' = 'พิมพ์แล้วรีดลงผ้าของลูกค้า' then 'print_press' else 'print' end
    when 'svc_press' then 'press'
    when 'svc_dtf' then case when p_spec -> 'p' -> 'svc_dtf' ->> 'film_source' = 'ลูกค้าส่งฟิล์มมาเอง' then 'dtf:customer' else 'dtf:factory' end
  end
$$;

create or replace function private.service_route(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case split_part(p_kind, ':', 1)
    when 'sew' then 'sew_only' when 'print' then 'print_only' when 'print_press' then 'print_press_only'
    when 'press' then 'press_only' when 'dtf' then 'dtf_only'
  end
$$;

-- ใบเย็บอย่างเดียว: งานใช้รหัสสินค้าเสื้อผ้าที่เลือก (สูตรจักร) แต่สเปกยังเป็นใบ svc_sew
create or replace function private.spec_product(p_spec jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when p_spec ->> 'product' = 'svc_sew' then p_spec -> 'p' -> 'svc_sew' ->> 'garment_code' else p_spec ->> 'product' end
$$;
revoke all on function private.service_kind(jsonb), private.service_route(text), private.spec_product(jsonb) from public, anon, authenticated;

create or replace function private.guard_service_job() returns trigger
language plpgsql set search_path = '' as $$
declare v_kind text := private.service_kind(new.spec); v_route text := private.service_route(v_kind);
begin
  if tg_op = 'UPDATE' and v_kind is distinct from private.service_kind(old.spec) then
    raise exception 'งาน % เปลี่ยนแบบงานบริการในใบแก้ไม่ได้ (สินค้าที่เย็บ / ส่งกระดาษหรือรีดลงผ้า / ผู้จัดหาฟิล์ม) · ให้ผู้บริหารยกเลิกงานนี้แล้วรับใบใหม่',
      old.confirmation_no using errcode = '23514';
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
drop trigger if exists jobs_guard_service on public.jobs;
create trigger jobs_guard_service before insert or update of spec, route_code, product_type_code on public.jobs
  for each row execute function private.guard_service_job();

-- ใบเย็บอย่างเดียว: เทียบสินค้าผ่าน private.spec_product
create or replace function public.revise_job_spec(
  p_job uuid, p_spec jsonb, p_rev int, p_customer_name text, p_job_name text,
  p_qty int, p_spare_qty int, p_due_date date, p_needs_sample boolean, p_changes text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs; v_spec jsonb; v_no text; passed int; summary text[] := '{}'; labels text[];
  sheet public.mockup_sheets; stale int := 0; v_job_name text;
  family uuid[]; v_root uuid; parts text[]; family_qty int; split boolean; m public.jobs; v_rework int;
  volatile_keys constant text[] := array['mockup_path', 'mockup', 'imgs', 'from_job', 'revise_job', 'changes', 'job_img', 'pickOpen', 'summary', 'app', 'v', 'base_rev', 'sent_sig', 'sys', 'base_token', 'rev_token'];
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
  if private.spec_product(p_spec) is distinct from j.product_type_code then
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
  -- ฟอร์มส่งเลขครั้งที่แก้ของงานตอนเปิดใบมา · มีใบแก้ใหม่กว่าบันทึกหลังจากนั้น = ใบนี้จะทับการแก้ล่าสุดเงียบๆ
  if p_spec->>'base_rev' ~ '^[0-9]+$' and (p_spec->>'base_rev')::int <> j.confirmation_rev then
    raise exception 'มีการบันทึกใบแก้ไขครั้งที่ % ของงาน % หลังจากเปิดใบนี้ · ปิดฟอร์มนี้ แล้วกด "แก้ใบยืนยัน" ที่งานเพื่อเปิดใบล่าสุดแล้วแก้ใหม่',
      j.confirmation_rev, j.confirmation_no using errcode = 'P0001';
  end if;
  -- ใบแก้เลขครั้งเดิมบันทึกซ้ำได้ จึงเทียบรหัสของสเปกที่เปิดมาด้วย · ไม่มีรหัส = ฟอร์ม/ไฟล์เก่า ใช้กฎเลขครั้งอย่างเดียว
  if p_spec ? 'base_token' and coalesce(p_spec->>'base_token', '') <> coalesce(j.spec->>'rev_token', '') then
    raise exception 'ใบแก้ของงาน % ถูกบันทึกไปแล้วหลังจากเปิดใบนี้ (จากแท็บอื่น หรือจากฟอร์มนี้เอง) · ปิดฟอร์มนี้ แล้วกด "แก้ใบยืนยัน" ที่งานเพื่อเปิดใบล่าสุดแล้วแก้ใหม่',
      j.confirmation_no using errcode = 'P0001';
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
  v_spec := v_spec || jsonb_build_object('rev_token', gen_random_uuid()::text);

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
