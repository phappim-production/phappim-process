-- ใช้เลขที่ใบของงานที่ยกเลิกแล้วกับใบใหม่ได้: ตอนรับงาน เลขของงานเก่าเปลี่ยนเป็น "<เลข> (ยกเลิก)"
-- งานที่เคยแบ่งใช้ซ้ำไม่ได้ เพราะประวัติการแบ่ง (events แก้ไม่ได้) อ้างงานแม่ด้วยเลขที่ใบ

create or replace function private.cancelled_no_split_check(p_no text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where confirmation_no = p_no and phase = 'cancelled';
  if not found then return; end if;
  if exists (select 1 from public.events e
             where e.type = 'job_split_from' and (e.job_id = j.id or e.payload ->> 'parent' = j.confirmation_no)) then
    raise exception 'เลขที่ใบ % เป็นของงานที่ยกเลิกแล้วซึ่งเคยแบ่งงาน ใช้เลขเดิมซ้ำไม่ได้ · ให้ต่อท้ายเลข เช่น %-0002 แล้วบันทึกอีกครั้ง', p_no, p_no
      using errcode = '23505';
  end if;
end $$;
revoke all on function private.cancelled_no_split_check(text) from public, anon, authenticated;

create or replace function private.free_cancelled_no(p_no text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_new text; n int := 2;
begin
  select * into j from public.jobs where confirmation_no = p_no for update;
  if not found then return; end if;
  if j.phase <> 'cancelled' then
    raise exception 'เลขที่ใบยืนยัน % รับเข้าระบบไปแล้ว', p_no using errcode = '23505';
  end if;
  perform private.cancelled_no_split_check(p_no);
  v_new := p_no || ' (ยกเลิก)';
  while exists (select 1 from public.jobs where confirmation_no = v_new) loop
    v_new := format('%s (ยกเลิก %s)', p_no, n);
    n := n + 1;
  end loop;
  update public.jobs set confirmation_no = v_new where id = j.id;
  perform private.log(j.id, 'confirmation_no_freed', j.phase, null, jsonb_build_object('from', p_no, 'to', v_new));
end $$;
revoke all on function private.free_cancelled_no(text) from public, anon, authenticated;

create or replace function public.save_confirmation_draft(p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_no text; v_id uuid; v_old jsonb; v_status text;
begin
  perform private.require_role('admin');
  if p_data is null or jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data->'h') is distinct from 'object' then
    raise exception 'ข้อมูลใบยืนยันไม่ถูกต้อง ให้กดบันทึกจากฟอร์มใบยืนยันการผลิต' using errcode = '22023';
  end if;
  v_no := nullif(trim(p_data->'h'->>'doc_no'), '');
  if v_no is null then
    raise exception 'ใส่เลขที่ใบยืนยันในฟอร์มก่อนบันทึกเข้าระบบ' using errcode = '23514';
  end if;
  perform private.cancelled_no_split_check(v_no);
  if exists (select 1 from public.jobs where confirmation_no = v_no and phase <> 'cancelled') then
    raise exception 'เลขที่ใบ % เป็นของงานที่ส่งงานเข้าโรงงานแล้ว · ถ้าเป็นใบใหม่ ให้เปลี่ยน "เลขที่ใบยืนยัน" ในฟอร์มเป็นเลขของใบใหม่ แล้วกดบันทึกเข้าระบบอีกครั้ง · ถ้าลูกค้าขอแก้งานเดิม ให้เปิดใบจากรายละเอียดงานแล้วกด "บันทึกการแก้เข้างาน"', v_no
      using errcode = '23505';
  end if;
  select id, data, status into v_id, v_old, v_status from public.confirmation_drafts where confirmation_no = v_no for update;
  if v_id is not null and v_status = 'draft' and nullif(v_old->>'product', '') is not null
     and v_old->>'product' is distinct from p_data->>'product' then
    raise exception 'เลขที่ใบ % บันทึกไว้แล้วเป็นสินค้าอื่น · ถ้าเป็นสินค้าคนละชิ้นในออเดอร์เดียวกัน ให้ต่อท้ายเลข เช่น %-0002', v_no, v_no
      using errcode = '23505';
  end if;
  if v_id is null then
    insert into public.confirmation_drafts (confirmation_no, customer_name, data, updated_by)
      values (v_no, nullif(trim(p_data->'h'->>'customer'), ''), p_data - 'imgs', auth.uid())
      returning id into v_id;
  else
    update public.confirmation_drafts set data = p_data - 'imgs', customer_name = nullif(trim(p_data->'h'->>'customer'), ''),
      status = 'draft', job_id = null, updated_at = now(), updated_by = auth.uid()
      where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.receive_job(
  p_confirmation_no text, p_customer_name text, p_job_name text, p_product_type_code text,
  p_qty int, p_unit text, p_due_date date, p_route_code text, p_confirmation_pdf_path text,
  p_spare_qty int default 0, p_confirmation_rev int default 0, p_spec jsonb default '{}',
  p_needs_sample boolean default true, p_develop boolean default false
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
  if coalesce(p_develop, false) and not p_needs_sample then
    raise exception 'งาน Develop ต้องขึ้นตัวอย่าง · เลือก "ขึ้นตัวอย่าง (งาน Develop)"' using errcode = '23514';
  end if;
  if not exists (select 1 from public.routes where code = p_route_code and active) then
    raise exception 'ไม่พบเส้นทางผลิต %', p_route_code using errcode = '23503';
  end if;
  if not exists (select 1 from public.product_types where code = p_product_type_code) then
    raise exception 'ไม่พบประเภทสินค้า %', p_product_type_code using errcode = '23503';
  end if;
  perform private.free_cancelled_no(trim(p_confirmation_no));

  -- รูปหาย/ผิดชนิด/ไม่ใช่ของใบนี้ = ส่งงานเข้าได้โดยไม่มีรูป ไม่ให้รูปขวางการรับงาน
  select nullif(trim(d.data->>'mockup_path'), '') into v_mockup
  from public.confirmation_drafts d where d.confirmation_no = trim(p_confirmation_no) and d.status = 'draft';
  if v_mockup is not null and (lower(v_mockup) !~ '\.(jpe?g|png|webp)$' or not private.mockup_uploaded(v_mockup)
                               or split_part(v_mockup, '/', 1) <> private.mockup_folder(p_confirmation_no)) then
    v_mockup := null;
  end if;

  insert into public.jobs (confirmation_no, confirmation_rev, customer_name, job_name, product_type_code, qty, spare_qty,
                           unit, due_date, route_code, spec, confirmation_pdf_path, phase, needs_sample, develop, created_by, mockup_path)
  values (trim(p_confirmation_no), coalesce(p_confirmation_rev, 0), trim(p_customer_name), trim(p_job_name), p_product_type_code,
          p_qty, coalesce(p_spare_qty, 0), p_unit, p_due_date, p_route_code, coalesce(p_spec, '{}'), v_pdf,
          'materials', p_needs_sample, coalesce(p_develop, false), auth.uid(), v_mockup)
  returning id into v_id;

  perform private.log(v_id, 'received', 'materials', null,
    jsonb_build_object('route', p_route_code, 'qty', p_qty, 'sample', p_needs_sample, 'develop', coalesce(p_develop, false), 'pdf', v_pdf is not null, 'mockup', v_mockup is not null));
  update public.confirmation_drafts set status = 'received', job_id = v_id, updated_at = now(), updated_by = auth.uid()
    where confirmation_no = trim(p_confirmation_no) and status = 'draft';
  perform private.release_if_ready(v_id);
  return v_id;
end $$;
revoke all on function public.receive_job(text, text, text, text, int, text, date, text, text, int, int, jsonb, boolean, boolean) from public, anon;
grant execute on function public.receive_job(text, text, text, text, int, text, date, text, text, int, int, jsonb, boolean, boolean) to authenticated;
