-- เลขที่ใบที่ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่ถือเป็นเลขเดียวกัน: รับงาน / บันทึกใบร่าง ปฏิเสธพร้อมบอกเลขที่มีอยู่
-- receive_job เรียก free_cancelled_no ก่อนบันทึกทุกครั้ง จึงใส่ด่านไว้ที่นั่น ไม่ต้องคัดลอก receive_job

create or replace function private.doc_no_case_check(p_no text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_other text;
begin
  select confirmation_no into v_other from public.jobs
    where lower(confirmation_no) = lower(p_no) and confirmation_no <> p_no and phase <> 'cancelled' limit 1;
  if v_other is null then
    select confirmation_no into v_other from public.confirmation_drafts
      where lower(confirmation_no) = lower(p_no) and confirmation_no <> p_no and status = 'draft' limit 1;
  end if;
  if v_other is not null then
    raise exception 'เลขที่ใบ % ซ้ำกับใบ % ที่มีในระบบแล้ว (ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่) · ถ้าเป็นใบเดียวกัน ให้แก้เลขในฟอร์มเป็น % · ถ้าเป็นใบใหม่ ให้ใช้เลขอื่น', p_no, v_other, v_other
      using errcode = '23505';
  end if;
end $$;
revoke all on function private.doc_no_case_check(text) from public, anon, authenticated;

create or replace function private.free_cancelled_no(p_no text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_new text; n int := 2;
begin
  perform private.doc_no_case_check(p_no);
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
  perform private.doc_no_case_check(v_no);
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
