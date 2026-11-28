-- ลายเซ็นผู้อนุมัติ (ตัดจากใบที่ลูกค้าเซ็นใบเดียวกัน) แสดงในช่อง "ผู้อนุมัติ" ของใบฉบับโรงงาน · เก็บแบบเดียวกับลายเซ็นลูกค้า
-- job_customer_signature คืนลายเซ็นผู้อนุมัติใน approver · file_read_allowed เปิดรูปลายเซ็นผู้อนุมัติได้

alter table public.jobs
  add column if not exists approver_signature_path text,
  add column if not exists approver_signed_on date,
  add column if not exists approver_signature_rev int;

create index if not exists jobs_approver_signature_path_idx on public.jobs (approver_signature_path) where approver_signature_path is not null;

create or replace function public.set_approver_signature(p_job uuid, p_path text, p_signed_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; t public.jobs; v_root uuid;
begin
  perform private.require_role('admin');
  perform pg_advisory_xact_lock(hashtext('pp142.job_queue'));
  select * into t from public.jobs where id = p_job;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if t.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  v_root := private.split_root(p_job);
  select * into j from public.jobs where id = v_root for update;

  if p_path is null then
    if j.approver_signature_path is null then return; end if;
    update public.jobs set approver_signature_path = null, approver_signed_on = null, approver_signature_rev = null
    where id in (select private.split_family(j.id));
    perform private.log(j.id, 'approver_signature', j.phase, null,
      jsonb_build_object('removed', true, 'path', j.approver_signature_path));
    return;
  end if;

  perform private.check_mockup(p_path);
  if split_part(p_path, '/', 1) not in (private.mockup_folder(j.confirmation_no), private.mockup_folder(t.confirmation_no)) then
    raise exception 'รูปลายเซ็นผู้อนุมัตินี้ไม่ใช่ของงาน % ให้ตัดลายเซ็นจากรายละเอียดงานนี้อีกครั้ง', t.confirmation_no using errcode = '23514';
  end if;
  if p_signed_on is null or p_signed_on = 'infinity'::date or p_signed_on = '-infinity'::date
     or extract(year from p_signed_on) not between 2000 and 2399 then
    raise exception 'ใส่วันที่ผู้อนุมัติเซ็นให้ถูกต้อง (ปี ค.ศ. เช่น 2026)' using errcode = '23514';
  end if;
  if p_signed_on > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'วันที่ผู้อนุมัติเซ็นอยู่ในอนาคต ให้ตรวจวันที่อีกครั้ง' using errcode = '23514';
  end if;

  update public.jobs set approver_signature_path = p_path, approver_signed_on = p_signed_on,
    approver_signature_rev = j.confirmation_rev
  where id in (select private.split_family(j.id));
  perform private.log(j.id, 'approver_signature', j.phase, null, jsonb_build_object(
    'path', p_path, 'signed_on', p_signed_on, 'rev', j.confirmation_rev, 'replaced', j.approver_signature_path is not null,
    'from', case when t.id <> j.id then t.confirmation_no end));
end $$;
revoke all on function public.set_approver_signature(uuid, text, date) from public, anon;
grant execute on function public.set_approver_signature(uuid, text, date) to authenticated;

create or replace function public.job_customer_signature(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs; out jsonb;
begin
  if private.my_role() is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  select * into j from public.jobs where id = private.split_root(p_job);
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  out := jsonb_build_object('current_rev', j.confirmation_rev);
  if j.customer_signature_path is not null then
    out := out || jsonb_build_object('path', j.customer_signature_path, 'signed_on', j.customer_signed_on, 'rev', j.customer_signature_rev);
  end if;
  if j.approver_signature_path is not null then
    out := out || jsonb_build_object('approver', jsonb_build_object(
      'path', j.approver_signature_path, 'signed_on', j.approver_signed_on, 'rev', j.approver_signature_rev));
  end if;
  return out;
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
        or exists (select 1 from public.jobs j where j.approver_signature_path = p)
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
