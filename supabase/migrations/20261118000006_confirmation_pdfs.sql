-- =====================================================================
-- A3 · PDF ใบยืนยันที่เซ็นครบ (กฎข้อ 1) · 17 พ.ย. 2569
-- เก็บไฟล์ใน Storage ไม่เก็บในตาราง (แผนฟรีฐานข้อมูล 500 MB) · ตารางเก็บแค่ path
-- เดิม receive_job ตรวจแค่ชื่อไฟล์ลงท้าย .pdf จึงส่งชื่อไฟล์ปลอมได้ → ตรวจว่ามีไฟล์จริงใน Storage ด้วย
-- ฐานข้อมูลทดสอบ (PGlite) ไม่มี Storage จึงข้ามส่วนนี้ · ทดสอบแยกใน supabase/tests/storage.mjs
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    -- 20 MB ตามแผน S2 · รับเฉพาะ PDF · ไม่เปิดสาธารณะ (ข้อมูลลูกค้า)
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('confirmations', 'confirmations', false, 20971520, array['application/pdf'])
    on conflict (id) do nothing;
    -- อ่านได้ทุกคนที่มีบทบาท (เปิดดูใบยืนยันจากรายละเอียดงาน) · อัปโหลดได้เฉพาะคนรับงาน
    -- ไม่มีสิทธิ์แก้/ลบ: ใบที่เซ็นแล้วเป็นหลักฐาน ถ้าผิดให้รับงานใหม่ด้วยใบแก้ไข
    execute $p$create policy confirmations_read on storage.objects for select to authenticated
      using (bucket_id = 'confirmations' and (select private.my_role()) is not null)$p$;
    execute $p$create policy confirmations_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'confirmations' and (select private.my_role()) in ('production', 'supervisor', 'owner'))$p$;
  end if;
end $$;

-- มีไฟล์นี้ใน Storage จริงไหม · ไม่มี Storage (ฐานข้อมูลทดสอบ) = ข้ามการตรวจ
create or replace function private.confirmation_uploaded(p_path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if to_regclass('storage.objects') is null then return true; end if;
  if not exists (select 1 from storage.buckets where id = 'confirmations') then return true; end if;
  return exists (select 1 from storage.objects where bucket_id = 'confirmations' and name = p_path);
end $$;
revoke all on function private.confirmation_uploaded(text) from public, anon;

-- เหมือนเดิมทุกอย่าง เพิ่มการตรวจว่าอัปโหลด PDF แล้วจริง
create or replace function public.receive_job(
  p_confirmation_no text, p_customer_name text, p_job_name text, p_product_type_code text,
  p_qty int, p_unit text, p_due_date date, p_route_code text, p_confirmation_pdf_path text,
  p_spare_qty int default 0, p_confirmation_rev int default 0, p_spec jsonb default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_role('supervisor');
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
  if not exists (select 1 from public.routes where code = p_route_code) then
    raise exception 'ไม่พบเส้นทางผลิต %', p_route_code using errcode = '23503';
  end if;
  if not exists (select 1 from public.product_types where code = p_product_type_code) then
    raise exception 'ไม่พบประเภทสินค้า %', p_product_type_code using errcode = '23503';
  end if;
  if exists (select 1 from public.jobs where confirmation_no = trim(p_confirmation_no)) then
    raise exception 'เลขที่ใบยืนยัน % รับเข้าระบบไปแล้ว', trim(p_confirmation_no) using errcode = '23505';
  end if;

  insert into public.jobs (confirmation_no, confirmation_rev, customer_name, job_name, product_type_code, qty, spare_qty,
                           unit, due_date, route_code, spec, confirmation_pdf_path, phase, created_by)
  values (trim(p_confirmation_no), coalesce(p_confirmation_rev, 0), trim(p_customer_name), trim(p_job_name), p_product_type_code,
          p_qty, coalesce(p_spare_qty, 0), p_unit, p_due_date, p_route_code, coalesce(p_spec, '{}'), p_confirmation_pdf_path,
          'materials', auth.uid())
  returning id into v_id;

  insert into public.job_materials (job_id, name, dept, key)
  select v_id, t.name, t.dept, t.key from public.material_templates t
  where (t.product_type_code is null or t.product_type_code = p_product_type_code)
    and (t.route_code is null or t.route_code = p_route_code)
  order by t.dept, t.sort;

  perform private.log(v_id, 'received', 'materials', null, jsonb_build_object('route', p_route_code, 'qty', p_qty));
  perform private.release_if_ready(v_id);
  return v_id;
end $$;
