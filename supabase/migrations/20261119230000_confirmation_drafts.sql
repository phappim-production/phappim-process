-- ใบยืนยันการผลิตบันทึกเข้าระบบได้โดยตรง + PDF ที่ลูกค้าเซ็นไม่บังคับ (เจ้าของโปรเจกต์ตัดสินใจ 17 พ.ย.)
-- เดิม: ฟอร์ม → บันทึกไฟล์ .json → หน้ารับงานแนบ .json + PDF ที่เซ็น (ซ้ำซ้อน และไฟล์ .json อยู่เครื่องเดียว)
-- ใหม่: ฟอร์มกด "บันทึกเข้าระบบ" → เก็บเป็นใบร่าง (เปิดต่อจากเครื่องไหนก็ได้) → หน้ารับงานเลือกใบจากรายการ
--       ส่งงานเข้าได้โดยยังไม่มี PDF ที่เซ็น · แนบ PDF ทีหลังที่รายละเอียดงาน
-- รูปตัวอย่างในฟอร์มไม่เก็บลงตาราง (กฎโปรเจกต์: ห้ามเก็บไฟล์/รูปในตาราง) · รูปอยู่ใน PDF ที่ส่งออก

create table public.confirmation_drafts (
  id              uuid primary key default gen_random_uuid(),
  confirmation_no text not null unique,
  customer_name   text,
  data            jsonb not null check (octet_length(data::text) <= 1000000),   -- คำตอบในฟอร์ม (ไม่มีรูป)
  status          text not null default 'draft' check (status in ('draft', 'received', 'cancelled')),
  job_id          uuid references public.jobs(id) on delete set null,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_at      timestamptz not null default now()
);
create index confirmation_drafts_status_idx on public.confirmation_drafts (status, updated_at desc);
create index confirmation_drafts_job_idx on public.confirmation_drafts (job_id);
alter table public.confirmation_drafts enable row level security;
-- อ่านได้: แอดมิน (คนกรอก/ส่งงานเข้า) · ผู้บริหาร · เจ้าของระบบ · เขียนผ่านฟังก์ชันเท่านั้น
create policy confirmation_drafts_read on public.confirmation_drafts for select to authenticated
  using ((select private.my_role()) in ('admin', 'manager', 'owner'));
revoke all on public.confirmation_drafts from anon;
grant select on public.confirmation_drafts to authenticated;

-- PDF ใบยืนยัน: ต้องเป็น .pdf และอัปโหลดเข้า Storage แล้วจริง (ใช้ทั้งตอนส่งงานเข้าและแนบทีหลัง)
create or replace function private.check_confirmation_pdf(p_path text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(trim(p_path), '') = '' or lower(p_path) not like '%.pdf' then
    raise exception 'ไฟล์ใบยืนยันต้องเป็น PDF' using errcode = '23514';
  end if;
  if not private.confirmation_uploaded(p_path) then
    raise exception 'ยังไม่พบไฟล์ PDF ใบยืนยันในระบบ ให้แนบไฟล์แล้วกดอีกครั้ง' using errcode = '23514';
  end if;
end $$;
revoke all on function private.check_confirmation_pdf(text) from public, anon;

-- ฟอร์มกด "บันทึกเข้าระบบ": บันทึกใหม่หรือแก้ใบร่างเดิมตามเลขที่ใบ · ใบที่ส่งงานเข้าแล้วแก้ไม่ได้
create or replace function public.save_confirmation_draft(p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_no text; v_id uuid;
begin
  perform private.require_role('admin');
  if p_data is null or jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data->'h') is distinct from 'object' then
    raise exception 'ข้อมูลใบยืนยันไม่ถูกต้อง ให้กดบันทึกจากฟอร์มใบยืนยันการผลิต' using errcode = '22023';
  end if;
  v_no := nullif(trim(p_data->'h'->>'doc_no'), '');
  if v_no is null then
    raise exception 'ใส่เลขที่ใบยืนยันในฟอร์มก่อนบันทึกเข้าระบบ' using errcode = '23514';
  end if;
  if exists (select 1 from public.jobs where confirmation_no = v_no) then
    raise exception 'ใบ % ส่งงานเข้าโรงงานแล้ว แก้ใบยืนยันในระบบไม่ได้ ถ้าต้องแก้ให้ออกใบใหม่', v_no using errcode = '23505';
  end if;
  select id into v_id from public.confirmation_drafts where confirmation_no = v_no for update;
  if v_id is null then
    insert into public.confirmation_drafts (confirmation_no, customer_name, data, updated_by)
      values (v_no, nullif(trim(p_data->'h'->>'customer'), ''), p_data - 'imgs', auth.uid())
      returning id into v_id;
  else
    update public.confirmation_drafts set data = p_data - 'imgs', customer_name = nullif(trim(p_data->'h'->>'customer'), ''),
      status = 'draft', updated_at = now(), updated_by = auth.uid()
      where id = v_id;
  end if;
  return v_id;
end $$;

-- ยกเลิกใบร่าง (ลูกค้าไม่สั่งต่อ) · ใบที่ส่งงานเข้าแล้วยกเลิกที่นี่ไม่ได้
create or replace function public.cancel_confirmation_draft(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role('admin');
  update public.confirmation_drafts set status = 'cancelled', updated_at = now(), updated_by = auth.uid()
    where id = p_id and status = 'draft';
  if not found then
    perform private.stale('ใบนี้ส่งงานเข้าแล้วหรือถูกยกเลิกไปแล้ว');
  end if;
end $$;

-- แนบ / เปลี่ยน PDF ใบยืนยันที่ลูกค้าเซ็นหลังส่งงานเข้าแล้ว (บันทึก 1 แถวใน events)
create or replace function public.attach_confirmation_pdf(p_job uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  perform private.check_confirmation_pdf(p_path);
  update public.jobs set confirmation_pdf_path = p_path where id = p_job;
  perform private.log(p_job, 'confirmation_pdf', j.phase, null,
    jsonb_build_object('path', p_path, 'replaced', j.confirmation_pdf_path is not null));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.save_confirmation_draft(jsonb)', 'public.cancel_confirmation_draft(uuid)', 'public.attach_confirmation_pdf(uuid,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

alter table public.jobs alter column confirmation_pdf_path drop not null;
comment on column public.jobs.confirmation_pdf_path is 'PDF ใบยืนยันที่ลูกค้าเซ็น (Storage) · ว่างได้ แนบทีหลังด้วย attach_confirmation_pdf';

-- เหมือน 20261119190000 ทุกอย่าง ยกเว้น PDF ไม่บังคับ และผูกใบร่างที่เลขที่ใบเดียวกัน
create or replace function public.receive_job(
  p_confirmation_no text, p_customer_name text, p_job_name text, p_product_type_code text,
  p_qty int, p_unit text, p_due_date date, p_route_code text, p_confirmation_pdf_path text,
  p_spare_qty int default 0, p_confirmation_rev int default 0, p_spec jsonb default '{}',
  p_needs_sample boolean default true   -- ไม่ระบุ = ขึ้นตัวอย่าง (ทางที่ปลอดภัยกว่า) · หน้ารับงานบังคับให้เลือกเอง
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_pdf text;
begin
  -- บอกคนหน้างานตรงๆ ว่าต้องทำอะไร แทนข้อความบทบาททั่วไป
  if private.my_role() in ('production', 'supervisor') then
    raise exception 'แอดมินเป็นคนส่งงานเข้าโรงงาน ให้แจ้งแอดมินส่งใบยืนยันเข้าระบบ' using errcode = '42501';
  end if;
  perform private.require_role('admin');
  -- PDF ที่ลูกค้าเซ็นไม่บังคับแล้ว · แนบทีหลังได้ด้วย attach_confirmation_pdf · ถ้าแนบมาต้องเป็น PDF ที่อัปโหลดแล้วจริง
  v_pdf := nullif(trim(p_confirmation_pdf_path), '');
  if v_pdf is not null then
    perform private.check_confirmation_pdf(v_pdf);
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
          p_qty, coalesce(p_spare_qty, 0), p_unit, p_due_date, p_route_code, coalesce(p_spec, '{}'), v_pdf,
          'materials', p_needs_sample, auth.uid())
  returning id into v_id;

  -- ไม่สร้างเช็คลิสต์วัตถุดิบ: แอดมินเตรียมของครบก่อนส่งงานเข้า → ปล่อยเข้าสถานีแรกทันที
  perform private.log(v_id, 'received', 'materials', null,
    jsonb_build_object('route', p_route_code, 'qty', p_qty, 'sample', p_needs_sample, 'pdf', v_pdf is not null));
  -- ใบยืนยันที่บันทึกจากฟอร์มเข้าระบบไว้ (เลขที่ใบเดียวกัน) ถือว่าส่งงานเข้าแล้ว
  update public.confirmation_drafts set status = 'received', job_id = v_id, updated_at = now(), updated_by = auth.uid()
    where confirmation_no = trim(p_confirmation_no) and status = 'draft';
  perform private.release_if_ready(v_id);
  return v_id;
end $$;
