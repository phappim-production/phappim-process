-- ฟอร์มที่ลืมเปลี่ยนเลขที่ใบ (ยังเป็นเลขของงานที่รับแล้ว) บอกให้เปลี่ยนเลข แทนข้อความที่อ่านเหมือนห้ามแก้ใบ

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
  if exists (select 1 from public.jobs where confirmation_no = v_no) then
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
      status = 'draft', updated_at = now(), updated_by = auth.uid()
      where id = v_id;
  end if;
  return v_id;
end $$;
