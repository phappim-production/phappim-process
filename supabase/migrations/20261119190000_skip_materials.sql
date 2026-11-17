-- ไม่มีขั้น "รอวัตถุดิบ" แล้ว · เจ้าของโปรเจกต์อธิบาย flow จริง 17 พ.ย.:
-- แอดมินส่งใบยืนยันเข้าโรงงานเมื่อวัตถุดิบพร้อมแล้ว (ยกเว้นฟิล์ม DTF / DTG / สกรีนที่นำเข้าภายหลัง)
-- → งานที่ส่งเข้าไปสถานีแรกทันที (หรือขึ้นตัวอย่างถ้างานนั้นต้องขึ้น) ไม่ต้องให้ 3 ฝ่ายติ๊กซ้ำ
-- ฟิล์ม: แอดมินบันทึกสั่ง/ได้รับได้ทุกช่วงของงาน · สถานีรีดฟิล์มเริ่มได้เมื่อได้รับแล้ว (start_station เดิม)
-- แม่แบบวัตถุดิบในหน้าตั้งค่ายังอยู่ เผื่อกลับมาใช้

-- ปล่อยงานได้ทันทีโดยไม่ดูรายการวัตถุดิบ (งานเก่าที่ค้างรายการไว้ก็ปล่อยได้)
create or replace function private.release_if_ready(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  if j.phase <> 'materials' then return; end if;
  if j.needs_sample then
    update public.jobs set phase = 'sample' where id = p_job;
    perform private.enter_station(p_job, 1);
    perform private.log(p_job, 'released', 'sample', null, jsonb_build_object('round', j.sample_round));
  else
    update public.jobs set phase = 'production', first_piece_ok = false, sew_count = 0 where id = p_job;
    perform private.enter_station(p_job, 1);
    perform private.log(p_job, 'released', 'production', null, jsonb_build_object('sample', false));
  end if;
end $$;

create or replace function public.receive_job(
  p_confirmation_no text, p_customer_name text, p_job_name text, p_product_type_code text,
  p_qty int, p_unit text, p_due_date date, p_route_code text, p_confirmation_pdf_path text,
  p_spare_qty int default 0, p_confirmation_rev int default 0, p_spec jsonb default '{}',
  p_needs_sample boolean default true   -- ไม่ระบุ = ขึ้นตัวอย่าง (ทางที่ปลอดภัยกว่า) · หน้ารับงานบังคับให้เลือกเอง
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  -- บอกคนหน้างานตรงๆ ว่าต้องทำอะไร แทนข้อความบทบาททั่วไป
  if private.my_role() in ('production', 'supervisor') then
    raise exception 'แอดมินเป็นคนส่งงานเข้าโรงงาน ให้แจ้งแอดมินส่งใบยืนยันเข้าระบบ' using errcode = '42501';
  end if;
  perform private.require_role('admin');
  if coalesce(trim(p_confirmation_pdf_path), '') = '' or lower(p_confirmation_pdf_path) not like '%.pdf' then
    raise exception 'ต้องแนบ PDF ใบยืนยันที่ลูกค้าเซ็นครบก่อนรับงาน' using errcode = '23514';
  end if;
  if not private.confirmation_uploaded(p_confirmation_pdf_path) then
    raise exception 'ยังไม่พบไฟล์ PDF ใบยืนยันในระบบ ให้แนบไฟล์แล้วกดรับงานอีกครั้ง' using errcode = '23514';
  end if;
  if coalesce(trim(p_confirmation_no), '') = '' then raise exception 'ต้องระบุเลขที่ใบยืนยัน' using errcode = '23514'; end if;
  if coalesce(trim(p_customer_name), '') = '' then raise exception 'ต้องระบุชื่อลูกค้า' using errcode = '23514'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนต้องมากกว่า 0' using errcode = '23514'; end if;
  if p_due_date is null then raise exception 'ต้องระบุกำหนดส่ง' using errcode = '23514'; end if;
  if coalesce(p_spare_qty, 0) < 0 then raise exception 'จำนวนเผื่อเสียติดลบไม่ได้' using errcode = '23514'; end if;
  if p_needs_sample is null then
    raise exception 'ต้องเลือกว่างานนี้ขึ้นตัวอย่างหรือไม่ (ตามที่ตกลงกับลูกค้าในใบยืนยัน)' using errcode = '23514';
  end if;
  if not exists (select 1 from public.routes where code = p_route_code and active) then
    raise exception 'ไม่พบเส้นทางผลิต %', p_route_code using errcode = '23503';
  end if;
  if not exists (select 1 from public.product_types where code = p_product_type_code) then
    raise exception 'ไม่พบประเภทสินค้า %', p_product_type_code using errcode = '23503';
  end if;
  if exists (select 1 from public.jobs where confirmation_no = trim(p_confirmation_no)) then
    raise exception 'เลขที่ใบยืนยัน % รับเข้าระบบไปแล้ว', trim(p_confirmation_no) using errcode = '23505';
  end if;

  insert into public.jobs (confirmation_no, confirmation_rev, customer_name, job_name, product_type_code, qty, spare_qty,
                           unit, due_date, route_code, spec, confirmation_pdf_path, phase, needs_sample, created_by)
  values (trim(p_confirmation_no), coalesce(p_confirmation_rev, 0), trim(p_customer_name), trim(p_job_name), p_product_type_code,
          p_qty, coalesce(p_spare_qty, 0), p_unit, p_due_date, p_route_code, coalesce(p_spec, '{}'), p_confirmation_pdf_path,
          'materials', p_needs_sample, auth.uid())
  returning id into v_id;

  -- ไม่สร้างเช็คลิสต์วัตถุดิบ: แอดมินเตรียมของครบก่อนส่งงานเข้า → ปล่อยเข้าสถานีแรกทันที
  perform private.log(v_id, 'received', 'materials', null,
    jsonb_build_object('route', p_route_code, 'qty', p_qty, 'sample', p_needs_sample));
  perform private.release_if_ready(v_id);
  return v_id;
end $$;

-- งานที่ค้างอยู่ขั้นรอวัตถุดิบตอนนี้ ปล่อยเข้าสถานีแรกเลย (บันทึก event released ตามปกติ)
do $$
declare r record;
begin
  for r in select id from public.jobs where phase = 'materials' order by created_at loop
    perform private.release_if_ready(r.id);
  end loop;
end $$;
