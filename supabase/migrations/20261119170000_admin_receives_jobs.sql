-- ส่งงานเข้าโรงงาน (รับงาน) = แอดมินเท่านั้น · เจ้าของโปรเจกต์ตัดสินใจ 17 พ.ย.
-- แอดมินกรอกใบยืนยัน ส่งให้ลูกค้าเซ็น และเตรียมวัตถุดิบเองอยู่แล้ว → ส่งงานเข้าระบบเองได้ทันที
-- ไม่ต้องส่งไฟล์ PDF / .json ข้ามเครื่องให้ฝ่ายผลิตกดรับซ้ำ · ฝ่ายผลิตเห็นงานบนบอร์ดตั้งแต่แอดมินส่ง
-- เจ้าของระบบทำแทนได้ (require_role ให้ owner ผ่านเสมอ) · ขั้นวัตถุดิบยังแบ่ง 3 ฝ่ายเหมือนเดิม

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    -- อัปโหลด PDF ใบยืนยันได้เฉพาะคนส่งงานเข้า
    drop policy if exists confirmations_upload on storage.objects;
    execute $p$create policy confirmations_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'confirmations' and (select private.my_role()) in ('admin', 'owner'))$p$;
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

  insert into public.job_materials (job_id, name, dept, key)
  select v_id, t.name, t.dept, t.key from public.material_templates t
  where (t.product_type_code is null or t.product_type_code = p_product_type_code)
    and (t.route_code is null or t.route_code = p_route_code)
  order by t.dept, t.sort;

  perform private.log(v_id, 'received', 'materials', null,
    jsonb_build_object('route', p_route_code, 'qty', p_qty, 'sample', p_needs_sample));
  perform private.release_if_ready(v_id);
  return v_id;
end $$;
