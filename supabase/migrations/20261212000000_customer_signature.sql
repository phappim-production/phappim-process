-- ลายเซ็นลูกค้า (รูปที่แอดมินตัดจากใบที่ลูกค้าเซ็น) แสดงในช่อง "ลูกค้า" ของใบยืนยันฉบับโรงงาน
-- เก็บทุกงานในครอบครัวงานแบ่ง (split_job คัดลอกทั้งแถว) · อ่านจากงานแม่ · ผูกกับใบแก้ครั้งที่ลูกค้าเซ็น

alter table public.jobs
  add column if not exists customer_signature_path text,
  add column if not exists customer_signed_on date,
  add column if not exists customer_signature_rev int;

create or replace function public.set_customer_signature(p_job uuid, p_path text, p_signed_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_root uuid;
begin
  perform private.require_role('admin');
  v_root := private.split_root(p_job);
  select * into j from public.jobs where id = v_root for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;

  if p_path is null then
    if j.customer_signature_path is null then return; end if;
    update public.jobs set customer_signature_path = null, customer_signed_on = null, customer_signature_rev = null
    where private.split_root(id) = j.id;
    perform private.log(j.id, 'customer_signature', j.phase, null,
      jsonb_build_object('removed', true, 'path', j.customer_signature_path));
    return;
  end if;

  perform private.check_mockup(p_path);
  if split_part(p_path, '/', 1) <> private.mockup_folder(j.confirmation_no) then
    raise exception 'รูปลายเซ็นนี้ไม่ใช่ของงาน % ให้ตัดลายเซ็นจากรายละเอียดงานนี้อีกครั้ง', j.confirmation_no using errcode = '23514';
  end if;
  if p_signed_on is null or p_signed_on = 'infinity'::date or p_signed_on = '-infinity'::date
     or extract(year from p_signed_on) not between 2000 and 2399 then
    raise exception 'ใส่วันที่ลูกค้าเซ็นให้ถูกต้อง (ปี ค.ศ. เช่น 2026)' using errcode = '23514';
  end if;
  if p_signed_on > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'วันที่ลูกค้าเซ็นอยู่ในอนาคต ให้ตรวจวันที่อีกครั้ง' using errcode = '23514';
  end if;

  update public.jobs set customer_signature_path = p_path, customer_signed_on = p_signed_on,
    customer_signature_rev = j.confirmation_rev
  where private.split_root(id) = j.id;
  perform private.log(j.id, 'customer_signature', j.phase, null, jsonb_build_object(
    'path', p_path, 'signed_on', p_signed_on, 'rev', j.confirmation_rev, 'replaced', j.customer_signature_path is not null));
end $$;
revoke all on function public.set_customer_signature(uuid, text, date) from public, anon;
grant execute on function public.set_customer_signature(uuid, text, date) to authenticated;

create or replace function public.job_customer_signature(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs;
begin
  if private.my_role() is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  select * into j from public.jobs where id = private.split_root(p_job);
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.customer_signature_path is null then return null; end if;
  return jsonb_build_object('path', j.customer_signature_path, 'signed_on', j.customer_signed_on,
    'rev', j.customer_signature_rev, 'current_rev', j.confirmation_rev);
end $$;
revoke all on function public.job_customer_signature(uuid) from public, anon;
grant execute on function public.job_customer_signature(uuid) to authenticated;

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
        or exists (select 1 from public.jobs j where j.customer_signature_path = p)
        or exists (select 1 from public.jobs j where j.spec -> 'mockups' @> jsonb_build_array(jsonb_build_object('path', p)))
        or exists (select 1 from public.mockup_views v where v.image_path = p)
        or exists (select 1 from public.job_material_photos m where m.path = p)
        or exists (select 1 from public.confirmation_drafts d where d.data ->> 'mockup_path' = p)
        or exists (select 1 from public.confirmation_drafts d where d.data -> 'mockups' @> jsonb_build_array(jsonb_build_object('path', p)))
        or private.my_file_upload(p_kind, p)))
      or (p_kind = 'station_photos' and not private.staff_without_station() and (
        exists (select 1 from public.station_checks c where c.photos @> array[p])
        or private.my_file_upload(p_kind, p))));
end $$;
revoke all on function public.file_read_allowed(text, text[]) from public, anon;
grant execute on function public.file_read_allowed(text, text[]) to authenticated;
