-- ไฟล์แนบใหม่ (PDF ใบยืนยัน + รูปม็อคอัพ) เก็บใน Cloudflare R2 ผ่าน Worker · ฐานข้อมูลจดไฟล์ที่ Worker ยืนยันแล้ว
-- เปิดใช้ = ใส่ private.file_settings 1 แถว · ไม่มีแถว = ตรวจกับ Supabase Storage แบบเดิม · รูปม็อคอัพเพดาน 20 MB

create table private.file_settings (
  id boolean primary key default true check (id),
  record_secret text not null check (char_length(record_secret) >= 32)
);
revoke all on private.file_settings from public, anon, authenticated;

create table private.file_objects (
  kind text not null check (kind in ('confirmations', 'mockups')),
  path text not null check (char_length(path) <= 300),
  size bigint not null check (size > 0),
  content_type text not null,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  primary key (kind, path)
);
revoke all on private.file_objects from public, anon, authenticated;

create or replace function private.r2_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.file_settings)
$$;
revoke all on function private.r2_enabled() from public, anon;

-- ฐานข้อมูลไม่มี pgcrypto ในทุกที่ที่ใช้ (PGlite ทดสอบ) จึงคำนวณ HMAC-SHA256 จาก sha256() ที่มีในตัว
create or replace function private.hmac_sha256(p_key bytea, p_msg bytea) returns bytea
language plpgsql immutable set search_path = '' as $$
declare k bytea := p_key; ipad bytea; opad bytea;
begin
  if length(k) > 64 then k := sha256(k); end if;
  k := k || decode(repeat('00', 64 - length(k)), 'hex');
  ipad := k; opad := k;
  for i in 0..63 loop
    ipad := set_byte(ipad, i, get_byte(k, i) # 54);
    opad := set_byte(opad, i, get_byte(k, i) # 92);
  end loop;
  return sha256(opad || sha256(ipad || p_msg));
end $$;
revoke all on function private.hmac_sha256(bytea, bytea) from public, anon;

create or replace function private.check_file_upload(p_kind text, p_path text, p_size bigint, p_type text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'บัญชีนี้ถูกปิดหรือยังไม่ได้ล็อกอิน ให้ล็อกอินใหม่หรือแจ้งเจ้าของระบบ' using errcode = '42501';
  end if;
  perform private.require_role('admin');
  if p_kind = 'confirmations' then
    if coalesce(p_type, '') <> 'application/pdf' or coalesce(p_path, '') !~ '^[A-Za-z0-9_-]{1,200}/[A-Za-z0-9]{1,64}\.pdf$' then
      raise exception 'ไฟล์ใบยืนยันต้องเป็น PDF' using errcode = '23514';
    end if;
  elsif p_kind = 'mockups' then
    if coalesce(p_path, '') !~ '^[A-Za-z0-9_-]{1,200}/(sheet/)?[A-Za-z0-9]{1,64}\.(jpg|png|webp)$'
       or coalesce(p_type, '') <> ('{"jpg":"image/jpeg","png":"image/png","webp":"image/webp"}'::jsonb ->> substring(p_path from '\.([a-z]+)$')) then
      raise exception 'รูปม็อคอัพต้องเป็นไฟล์ภาพ (JPG / PNG / WEBP)' using errcode = '23514';
    end if;
  else
    raise exception 'ไม่รู้จักประเภทไฟล์ %', p_kind using errcode = '23514';
  end if;
  if coalesce(p_size, 0) <= 0 then
    raise exception 'ไฟล์ว่างเปล่า ให้เลือกไฟล์ใหม่' using errcode = '23514';
  end if;
  if p_size > 20 * 1024 * 1024 then
    raise exception 'ไฟล์ใหญ่เกิน 20 MB ให้ย่อไฟล์ก่อน' using errcode = '23514';
  end if;
end $$;
revoke all on function private.check_file_upload(text, text, bigint, text) from public, anon;

-- Worker ถามก่อนรับไฟล์ด้วยโทเคนของผู้ใช้
create or replace function public.file_upload_allowed(p_kind text, p_path text, p_size bigint, p_type text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.check_file_upload(p_kind, p_path, p_size, p_type);
end $$;
revoke all on function public.file_upload_allowed(text, text, bigint, text) from public, anon;
grant execute on function public.file_upload_allowed(text, text, bigint, text) to authenticated;

-- p_proof = HMAC จาก Worker หลังตรวจว่าไฟล์อยู่ใน R2 แล้ว · ผู้ใช้เรียกเองโดยไม่มีลายเซ็นไม่ได้ · ส่งซ้ำ = ไม่เพิ่มแถว
create or replace function public.record_file_upload(p_kind text, p_path text, p_size bigint, p_type text, p_proof text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  perform private.check_file_upload(p_kind, p_path, p_size, p_type);
  select record_secret into v_secret from private.file_settings;
  if v_secret is null then
    raise exception 'ระบบเก็บไฟล์ใหม่ยังไม่เปิดใช้ แจ้งเจ้าของระบบ' using errcode = '55000';
  end if;
  if p_proof is distinct from encode(private.hmac_sha256(convert_to(v_secret, 'UTF8'),
       convert_to(p_kind || '|' || p_path || '|' || p_size || '|' || p_type, 'UTF8')), 'hex') then
    raise exception 'ยืนยันไฟล์ไม่ผ่าน ให้อัปโหลดไฟล์อีกครั้ง' using errcode = '42501';
  end if;
  insert into private.file_objects (kind, path, size, content_type, uploaded_by)
  values (p_kind, p_path, p_size, p_type, auth.uid())
  on conflict (kind, path) do nothing;
end $$;
revoke all on function public.record_file_upload(text, text, bigint, text, text) from public, anon;
grant execute on function public.record_file_upload(text, text, bigint, text, text) to authenticated;

create or replace function private.my_file_upload(p_kind text, p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.file_objects f
                 where f.kind = p_kind and f.path = p_path and f.uploaded_by = (select auth.uid()))
$$;
revoke all on function private.my_file_upload(text, text) from public, anon;
grant execute on function private.my_file_upload(text, text) to authenticated;

-- security invoker: เห็นไฟล์ได้เท่าที่ RLS ให้เห็นงาน / ฉบับม็อคอัพ / ใบร่าง · บัญชีปิด = ปฏิเสธ · ไฟล์ที่ตัวเองเพิ่งอัปโหลดเปิดได้ก่อนผูกกับงาน
create or replace function public.file_read_allowed(p_kind text, p_paths text[]) returns text[]
language plpgsql stable security invoker set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'บัญชีนี้ถูกปิดหรือยังไม่ได้ล็อกอิน ให้ล็อกอินใหม่หรือแจ้งเจ้าของระบบ' using errcode = '42501';
  end if;
  return (
    select coalesce(array_agg(distinct p), '{}')
    from unnest(p_paths[1:200]) p
    where (p_kind = 'confirmations' and (
        exists (select 1 from public.jobs j where j.confirmation_pdf_path = p)
        or private.my_file_upload(p_kind, p)))
      or (p_kind = 'mockups' and (
        exists (select 1 from public.jobs j where j.mockup_path = p)
        or exists (select 1 from public.mockup_views v where v.image_path = p)
        or exists (select 1 from public.confirmation_drafts d where d.data ->> 'mockup_path' = p)
        or private.my_file_upload(p_kind, p))));
end $$;
revoke all on function public.file_read_allowed(text, text[]) from public, anon;
grant execute on function public.file_read_allowed(text, text[]) to authenticated;

-- เหมือน 20261118000006 เพิ่ม: เปิดใช้ R2 แล้วตรวจจากรายการไฟล์ที่ Worker ยืนยัน
create or replace function private.confirmation_uploaded(p_path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.r2_enabled() then
    return exists (select 1 from private.file_objects where kind = 'confirmations' and path = p_path);
  end if;
  if to_regclass('storage.objects') is null then return true; end if;
  if not exists (select 1 from storage.buckets where id = 'confirmations') then return true; end if;
  return exists (select 1 from storage.objects where bucket_id = 'confirmations' and name = p_path);
end $$;
revoke all on function private.confirmation_uploaded(text) from public, anon;

-- เหมือน 20261120110000 เพิ่ม: เปิดใช้ R2 แล้วตรวจจากรายการไฟล์ที่ Worker ยืนยัน
create or replace function private.mockup_uploaded(p_path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.r2_enabled() then
    return exists (select 1 from private.file_objects where kind = 'mockups' and path = p_path);
  end if;
  if to_regclass('storage.objects') is null then return true; end if;
  if not exists (select 1 from storage.buckets where id = 'mockups') then return true; end if;
  return exists (select 1 from storage.objects where bucket_id = 'mockups' and name = p_path);
end $$;
revoke all on function private.mockup_uploaded(text) from public, anon;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    update storage.buckets set file_size_limit = 20971520 where id = 'mockups';
  end if;
end $$;
