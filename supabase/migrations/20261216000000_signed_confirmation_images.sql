-- ใบยืนยันที่ลูกค้าเซ็นแนบเป็นรูป (JPG / PNG / WEBP) ได้ นอกจาก PDF · ชนิดไฟล์ต้องตรงนามสกุล

create or replace function private.check_confirmation_pdf(p_path text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(trim(p_path), '') = '' or lower(p_path) !~ '\.(pdf|jpg|png|webp)$' then
    raise exception 'ไฟล์ใบยืนยันต้องเป็น PDF หรือรูป (JPG / PNG / WEBP)' using errcode = '23514';
  end if;
  if not private.confirmation_uploaded(p_path) then
    raise exception 'ยังไม่พบไฟล์ใบยืนยันในระบบ ให้แนบไฟล์แล้วกดอีกครั้ง' using errcode = '23514';
  end if;
end $$;
revoke all on function private.check_confirmation_pdf(text) from public, anon;

create or replace function private.check_file_upload(p_kind text, p_path text, p_size bigint, p_type text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare err text;
begin
  if private.my_role() is null then
    raise exception 'บัญชีนี้ถูกปิดหรือยังไม่ได้ล็อกอิน ให้ล็อกอินใหม่หรือแจ้งเจ้าของระบบ' using errcode = '42501';
  end if;
  if p_kind = 'station_photos' then
    perform private.require_role('supervisor', 'qc');
    if coalesce(p_type, '') <> 'image/jpeg' then
      raise exception 'รูปจากสถานีต้องเป็นไฟล์ JPG' using errcode = '23514';
    end if;
    err := private.station_photo_upload_error(p_path);
    if err is not null then
      raise exception '%', err using errcode = case when err like 'รูป%' then '23514' else '42501' end;
    end if;
  else
    perform private.require_role('admin');
    if p_kind = 'confirmations' then
      if coalesce(p_path, '') !~ '^[A-Za-z0-9_-]{1,200}/[A-Za-z0-9]{1,64}\.(pdf|jpg|png|webp)$'
         or coalesce(p_type, '') <> ('{"pdf":"application/pdf","jpg":"image/jpeg","png":"image/png","webp":"image/webp"}'::jsonb ->> substring(p_path from '\.([a-z]+)$')) then
        raise exception 'ไฟล์ใบยืนยันต้องเป็น PDF หรือรูป (JPG / PNG / WEBP)' using errcode = '23514';
      end if;
    elsif p_kind = 'mockups' then
      if coalesce(p_path, '') !~ '^[A-Za-z0-9_-]{1,200}/(sheet/)?[A-Za-z0-9]{1,64}\.(jpg|png|webp)$'
         or coalesce(p_type, '') <> ('{"jpg":"image/jpeg","png":"image/png","webp":"image/webp"}'::jsonb ->> substring(p_path from '\.([a-z]+)$')) then
        raise exception 'รูปม็อคอัพต้องเป็นไฟล์ภาพ (JPG / PNG / WEBP)' using errcode = '23514';
      end if;
    else
      raise exception 'ไม่รู้จักประเภทไฟล์ %', p_kind using errcode = '23514';
    end if;
  end if;
  if coalesce(p_size, 0) <= 0 then
    raise exception 'ไฟล์ว่างเปล่า ให้เลือกไฟล์ใหม่' using errcode = '23514';
  end if;
  if p_size > 20 * 1024 * 1024 then
    raise exception 'ไฟล์ใหญ่เกิน 20 MB ให้ย่อไฟล์ก่อน' using errcode = '23514';
  end if;
end $$;
revoke all on function private.check_file_upload(text, text, bigint, text) from public, anon;

-- ที่เก็บสำรองของ Supabase (ใช้เมื่อปิด R2) รับชนิดเดียวกัน
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    update storage.buckets set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    where id = 'confirmations';
  end if;
end $$;
