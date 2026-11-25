-- ใบยืนยันเลขเดิมแต่คนละสินค้าไม่ทับใบเดิมเงียบ ๆ · ค่าที่อ้างจากจุดกำกับบนม็อคอัพแสดงข้อความ "อื่นๆ" ที่พิมพ์ไว้ (ตรงกับ PDF)

-- เหมือน 20261119230000 เพิ่ม: เลขเดิมที่บันทึกไว้เป็นสินค้าอื่นต้องเปลี่ยนเลข
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
    raise exception 'ใบ % ส่งงานเข้าโรงงานแล้ว แก้ใบยืนยันในระบบไม่ได้ ถ้าต้องแก้ให้ออกใบใหม่', v_no using errcode = '23505';
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

-- เหมือน 20261125000000 เพิ่ม: ตัวเลือก "อื่นๆ" ต่อด้วยข้อความที่พิมพ์ (ช่อง __other)
create or replace function private.mockup_ref_value(p_spec jsonb, p_ref text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  base jsonb := coalesce(p_spec, '{}'::jsonb) -> 'p' -> (p_spec ->> 'product');
  x jsonb; methods text[]; tech text; other text;
begin
  if base is null or p_ref is null then return null; end if;
  if p_ref like 'placement:%' then
    x := base -> 'placements' -> substr(p_ref, 11);
    if x is null or coalesce(x ->> 'on', 'false') <> 'true' then return null; end if;
    tech := nullif(trim(x ->> 'tech'), '');
    if tech is null and jsonb_typeof(base -> 'print_method') = 'array' then
      select array_agg(m) into methods from jsonb_array_elements_text(base -> 'print_method') m where m !~ 'ไม่มีลาย';
      if cardinality(methods) = 1 then tech := methods[1]; end if;
    end if;
    return nullif(concat_ws(' · ', tech,
      case when nullif(trim(x ->> 'size'), '') is null then null
        when trim(x ->> 'size') ~ '^[0-9 .,xX×*/-]+$' then trim(x ->> 'size') || case when base ->> 'placements__unit' = 'นิ้ว' then ' นิ้ว' else ' ซม.' end
        else trim(x ->> 'size') end,
      nullif(trim(x ->> 'note'), '')), '');
  end if;
  if p_ref like 'field:%' then
    x := base -> substr(p_ref, 7);
    other := nullif(trim(base ->> (substr(p_ref, 7) || '__other')), '');
    if x is null then return null; end if;
    if jsonb_typeof(x) = 'array' then
      return nullif((select string_agg(case when trim(v) = 'อื่นๆ' and other is not null then 'อื่นๆ: ' || other else trim(v) end, ', ')
        from jsonb_array_elements_text(x) v where trim(v) <> ''), '');
    end if;
    if jsonb_typeof(x) in ('string', 'number', 'boolean') then
      return nullif(case when trim(x #>> '{}') = 'อื่นๆ' and other is not null then 'อื่นๆ: ' || other else trim(x #>> '{}') end, '');
    end if;
  end if;
  return null;
end $$;
revoke all on function private.mockup_ref_value(jsonb, text) from public, anon;
