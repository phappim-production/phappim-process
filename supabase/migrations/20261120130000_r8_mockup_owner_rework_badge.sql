-- รูปม็อคอัพ: โฟลเดอร์ไม่ชนกันระหว่างเลขที่ใบ และส่งงานเข้าตรวจว่ารูปในใบร่างอยู่โฟลเดอร์ของใบนั้น
-- QC ผ่านครบจำนวนแล้ว งานแก้ไม่ค้างป้ายยอดส่งแก้

-- ตัวที่ไม่ใช่อังกฤษ/ตัวเลข/ขีด เป็น _ + รหัสอักษร 6 หลัก จึงไม่ชนกัน (ตรงกับ mockupFolder ในหน้าเว็บ)
create or replace function private.mockup_folder(p_no text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif((
    select string_agg(case when c ~ '^[A-Za-z0-9-]$' then c else '_' || lpad(to_hex(ascii(c)), 6, '0') end, '' order by i)
    from regexp_split_to_table(trim(p_no), '') with ordinality as t(c, i) where c <> ''
  ), ''), 'job')
$$;
revoke all on function private.mockup_folder(text) from public, anon;

create or replace function public.receive_job(
  p_confirmation_no text, p_customer_name text, p_job_name text, p_product_type_code text,
  p_qty int, p_unit text, p_due_date date, p_route_code text, p_confirmation_pdf_path text,
  p_spare_qty int default 0, p_confirmation_rev int default 0, p_spec jsonb default '{}',
  p_needs_sample boolean default true   -- ไม่ระบุ = ขึ้นตัวอย่าง (ทางที่ปลอดภัยกว่า) · หน้ารับงานบังคับให้เลือกเอง
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_pdf text; v_mockup text;
begin
  if private.my_role() in ('production', 'supervisor') then
    raise exception 'แอดมินเป็นคนส่งงานเข้าโรงงาน ให้แจ้งแอดมินส่งใบยืนยันเข้าระบบ' using errcode = '42501';
  end if;
  perform private.require_role('admin');
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

  -- รูปหาย/ผิดชนิด/ไม่ใช่ของใบนี้ = ส่งงานเข้าได้โดยไม่มีรูป ไม่ให้รูปขวางการรับงาน
  select nullif(trim(d.data->>'mockup_path'), '') into v_mockup
  from public.confirmation_drafts d where d.confirmation_no = trim(p_confirmation_no) and d.status = 'draft';
  if v_mockup is not null and (lower(v_mockup) !~ '\.(jpe?g|png|webp)$' or not private.mockup_uploaded(v_mockup)
                               or split_part(v_mockup, '/', 1) <> private.mockup_folder(p_confirmation_no)) then
    v_mockup := null;
  end if;

  insert into public.jobs (confirmation_no, confirmation_rev, customer_name, job_name, product_type_code, qty, spare_qty,
                           unit, due_date, route_code, spec, confirmation_pdf_path, phase, needs_sample, created_by, mockup_path)
  values (trim(p_confirmation_no), coalesce(p_confirmation_rev, 0), trim(p_customer_name), trim(p_job_name), p_product_type_code,
          p_qty, coalesce(p_spare_qty, 0), p_unit, p_due_date, p_route_code, coalesce(p_spec, '{}'), v_pdf,
          'materials', p_needs_sample, auth.uid(), v_mockup)
  returning id into v_id;

  perform private.log(v_id, 'received', 'materials', null,
    jsonb_build_object('route', p_route_code, 'qty', p_qty, 'sample', p_needs_sample, 'pdf', v_pdf is not null, 'mockup', v_mockup is not null));
  update public.confirmation_drafts set status = 'received', job_id = v_id, updated_at = now(), updated_by = auth.uid()
    where confirmation_no = trim(p_confirmation_no) and status = 'draft';
  perform private.release_if_ready(v_id);
  return v_id;
end $$;

create or replace function public.record_qc(p_job uuid, p_passed int, p_request uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; done int;
begin
  perform private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  -- ล็อกงานก่อนจองรหัส: คำขอซ้ำที่มาพร้อมกันเข้าคิวที่งานเดียวกัน
  if private.claim_request(p_request, 'record_qc') is not null then return; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if j.phase <> 'production' or cur is distinct from 'qc_pack' then perform private.stale('งานไม่ได้อยู่ที่ QC'); end if;
  if j.station_status is distinct from 'doing' then raise exception 'ต้องกด "เริ่ม" สถานี QC ก่อน' using errcode = 'P0001'; end if;
  if p_passed is null or p_passed <= 0 then raise exception 'จำนวนที่ผ่านต้องมากกว่า 0' using errcode = '23514'; end if;
  done := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = p_job), 0);
  if done >= j.qty then
    raise exception 'ผ่านครบ %/% ชิ้นแล้ว · กด "QC + Packing เสร็จ" ได้เลย', done, j.qty using errcode = '23514';
  end if;
  if done + p_passed > j.qty then
    raise exception 'บันทึกผ่านได้อีกไม่เกิน % ชิ้น (ผ่านแล้ว %/% ชิ้น) · ตรวจจำนวนแล้วกรอกใหม่', j.qty - done, done, j.qty using errcode = '23514';
  end if;
  insert into public.qc_results (job_id, passed, failed, by) values (p_job, p_passed, 0, auth.uid());
  perform private.log(p_job, 'qc_result', j.phase, cur, jsonb_build_object('passed', p_passed));
  if j.is_rework and done + p_passed = j.qty then
    update public.jobs set is_rework = false, rework_qty = null where id = p_job;
  end if;
end $$;
