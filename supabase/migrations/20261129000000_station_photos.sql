-- รูปชิ้นแรก (แอดมิน/ผู้จัดการอนุมัติก่อนทำทั้งล็อต) + รูปงานเสร็จ ก่อนกดเสร็จสถานี · เปิดใช้ด้วย station_photo_settings.enabled_at
-- กฎนับเฉพาะรอบสถานีที่กดเริ่มหลังเปิดใช้ · ช่วงรออนุมัติชิ้นแรกไม่นับเวลามาตรฐาน · รูปเก็บใน R2 ชนิด station_photos

alter table public.stations add column first_piece_check boolean not null default false;
update public.stations set first_piece_check = true where code in ('print', 'press', 'dtf_press', 'cut', 'emb', 'screen');

create table public.station_photo_settings (
  id             boolean primary key default true check (id),
  enabled_at     timestamptz,
  remind_minutes int not null default 15 check (remind_minutes between 5 and 240)
);
insert into public.station_photo_settings (id) values (true);
alter table public.station_photo_settings enable row level security;
create policy station_photo_settings_read on public.station_photo_settings for select to authenticated
  using ((select private.my_role()) is not null);
revoke all on public.station_photo_settings from anon;
grant select on public.station_photo_settings to authenticated;

create table public.station_checks (
  id            bigint generated always as identity primary key,
  job_id        uuid not null references public.jobs(id) on delete cascade,
  station_code  text not null references public.stations(code),
  visit         int not null,
  kind          text not null check (kind in ('first_piece', 'finish')),
  status        text not null check (status in ('pending', 'approved', 'rejected', 'recorded')),
  photos        text[] not null check (cardinality(photos) between 1 and 6),
  note          text check (char_length(note) <= 300),
  reject_reason text check (char_length(reject_reason) <= 300),
  sent_by       uuid references auth.users(id),
  sent_at       timestamptz not null default now(),
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  check ((kind = 'finish') = (status = 'recorded')),
  check (status <> 'rejected' or reject_reason is not null),
  check ((status in ('approved', 'rejected')) = (decided_at is not null))
);
create index station_checks_job_idx on public.station_checks (job_id, station_code, visit);
create index station_checks_station_idx on public.station_checks (station_code);
create index station_checks_sent_by_idx on public.station_checks (sent_by);
create index station_checks_decided_by_idx on public.station_checks (decided_by);
create index station_checks_pending_idx on public.station_checks (sent_at) where status = 'pending';
create unique index station_checks_one_pending on public.station_checks (job_id, station_code, visit) where status = 'pending';
create index station_checks_photos_idx on public.station_checks using gin (photos);
alter table public.station_checks enable row level security;
create policy station_checks_read on public.station_checks for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
revoke all on public.station_checks from anon;
grant select on public.station_checks to authenticated;

alter table private.file_objects drop constraint file_objects_kind_check;
alter table private.file_objects add constraint file_objects_kind_check check (kind in ('confirmations', 'mockups', 'station_photos'));

alter table public.inbox_messages drop constraint inbox_messages_kind_check;
alter table public.inbox_messages add constraint inbox_messages_kind_check check (kind in (
  'hold', 'delay_report', 'rework', 'sewing_issue', 'machine_broken',
  'sample_failed', 'sla_over', 'film_late', 'materials_late', 'due_soon',
  'mockup_pending', 'mockup_returned', 'mockup_approved', 'job_cancelled', 'spec_revised',
  'first_piece_pending', 'first_piece_late', 'first_piece_rejected'
));
insert into public.inbox_settings (kind, enabled) values
  ('first_piece_pending', true), ('first_piece_late', true), ('first_piece_rejected', true)
on conflict (kind) do nothing;

-- เหมือน 20261120260000 เพิ่ม: รูปจากสถานี (พนักงานสถานีอัปโหลด · JPG ที่ย่อในเครื่องแล้ว)
create or replace function private.check_file_upload(p_kind text, p_path text, p_size bigint, p_type text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'บัญชีนี้ถูกปิดหรือยังไม่ได้ล็อกอิน ให้ล็อกอินใหม่หรือแจ้งเจ้าของระบบ' using errcode = '42501';
  end if;
  if p_kind = 'station_photos' then
    perform private.require_role('supervisor', 'qc');
    if coalesce(p_type, '') <> 'image/jpeg' or coalesce(p_path, '') !~ '^[A-Za-z0-9_-]{1,200}/[a-z_]{1,20}/[0-9]{1,4}/[A-Za-z0-9]{1,64}\.jpg$' then
      raise exception 'รูปจากสถานีต้องเป็นไฟล์ JPG' using errcode = '23514';
    end if;
  else
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
  end if;
  if coalesce(p_size, 0) <= 0 then
    raise exception 'ไฟล์ว่างเปล่า ให้เลือกไฟล์ใหม่' using errcode = '23514';
  end if;
  if p_size > 20 * 1024 * 1024 then
    raise exception 'ไฟล์ใหญ่เกิน 20 MB ให้ย่อไฟล์ก่อน' using errcode = '23514';
  end if;
end $$;
revoke all on function private.check_file_upload(text, text, bigint, text) from public, anon;

-- เหมือน 20261126000000 เพิ่ม: รูปจากสถานีเห็นได้เท่าที่เห็นงาน
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
        or exists (select 1 from public.jobs j where j.spec -> 'mockups' @> jsonb_build_array(jsonb_build_object('path', p)))
        or exists (select 1 from public.mockup_views v where v.image_path = p)
        or exists (select 1 from public.confirmation_drafts d where d.data ->> 'mockup_path' = p)
        or exists (select 1 from public.confirmation_drafts d where d.data -> 'mockups' @> jsonb_build_array(jsonb_build_object('path', p)))
        or private.my_file_upload(p_kind, p)))
      or (p_kind = 'station_photos' and (
        exists (select 1 from public.station_checks c where c.photos @> array[p])
        or private.my_file_upload(p_kind, p))));
end $$;
revoke all on function public.file_read_allowed(text, text[]) from public, anon;
grant execute on function public.file_read_allowed(text, text[]) to authenticated;

create or replace function private.station_photo_uploaded(p_path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.r2_enabled() then
    return exists (select 1 from private.file_objects where kind = 'station_photos' and path = p_path);
  end if;
  return true;
end $$;
revoke all on function private.station_photo_uploaded(text) from public, anon;

create or replace function private.photo_gate_on(j public.jobs) returns boolean
language sql stable security definer set search_path = '' as $$
  select j.phase in ('sample', 'production') and j.station_seq is not null and j.station_started_at is not null
    and coalesce(private.station_at(j.route_code, j.station_seq), 'outside') <> 'outside'
    and exists (select 1 from public.station_photo_settings s where s.enabled_at is not null and j.station_started_at >= s.enabled_at)
$$;
revoke all on function private.photo_gate_on(public.jobs) from public, anon, authenticated;

create or replace function private.needs_first_piece(j public.jobs) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.photo_gate_on(j) and coalesce((select s.first_piece_check from public.stations s
    where s.code = private.station_at(j.route_code, j.station_seq)), false)
$$;
revoke all on function private.needs_first_piece(public.jobs) from public, anon, authenticated;

-- งานที่แบ่งออกมานับรูปของงานต้นทางก่อนแบ่งด้วย (เหมือนประวัติพักงาน)
create or replace function private.visit_checks(j public.jobs) returns setof public.station_checks
language sql stable security definer set search_path = '' as $$
  select c.* from private.split_lineage(j.id) l
  join public.station_checks c on c.job_id = l.job_id and c.sent_at <= l.until
  where c.station_code = private.station_at(j.route_code, j.station_seq) and c.visit = j.visit
    and c.sent_at >= j.station_started_at
$$;
revoke all on function private.visit_checks(public.jobs) from public, anon, authenticated;

create or replace function private.photo_gate_missing(p_job uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs; last_fp public.station_checks; miss text[] := '{}';
begin
  select * into j from public.jobs where id = p_job;
  if not found or not private.photo_gate_on(j) then return miss; end if;
  if private.needs_first_piece(j) then
    select * into last_fp from private.visit_checks(j) c where c.kind = 'first_piece' order by c.sent_at desc, c.id desc limit 1;
    if last_fp.id is null then
      miss := miss || 'ถ่ายรูปชิ้นแรกส่งให้แอดมินอนุมัติก่อน'::text;
    elsif last_fp.status = 'pending' then
      miss := miss || 'รูปชิ้นแรกรอแอดมินอนุมัติ'::text;
    elsif last_fp.status = 'rejected' then
      miss := miss || format('ชิ้นแรกไม่ผ่าน (%s) แก้แล้วถ่ายรูปชิ้นแรกส่งใหม่', last_fp.reject_reason);
    end if;
  end if;
  if not exists (select 1 from private.visit_checks(j) c where c.kind = 'finish') then
    miss := miss || 'ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป'::text;
  end if;
  return miss;
end $$;
revoke all on function private.photo_gate_missing(uuid) from public, anon, authenticated;

-- เหมือน 20261119200000 เพิ่ม: เงื่อนไขรูปชิ้นแรก/รูปงานเสร็จ (ใช้กับเย็บและงานแก้ด้วย)
create or replace function private.missing_substeps(p_job uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs; cur text; sub jsonb; k text; kind text; passed int; miss text[] := '{}';
begin
  select * into j from public.jobs where id = p_job;
  cur := private.station_at(j.route_code, j.station_seq);
  if not (cur = 'sew' or (j.is_rework and cur <> 'qc_pack')) then
    for sub in select s from public.stations st, jsonb_array_elements(st.substeps) s where st.code = cur loop
      k := sub->>'key'; kind := sub->>'kind';
      if kind = 'lock' then
        if j.dtf_film_received_at is null then
          miss := miss || format('รอแอดมินบันทึก "%s"', sub->>'name');
        end if;
      elsif cur = 'qc_pack' and k = 'inspect' and j.phase = 'production' then
        passed := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0);
        if passed < j.qty then
          miss := miss || format('QC ตรวจผ่าน %s/%s ชิ้น ยังไม่ครบ (ชิ้นไม่ผ่านให้กด "ส่งแก้")', passed, j.qty);
        end if;
      end if;
    end loop;
  end if;
  return miss || private.photo_gate_missing(p_job);
end $$;

create or replace function private.check_station_photos(j public.jobs, p_photos text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare p text; folder text; clean text[];
begin
  select coalesce(array_agg(distinct x), '{}') into clean from unnest(p_photos) x where nullif(btrim(x), '') is not null;
  if cardinality(clean) = 0 then raise exception 'ยังไม่มีรูป ให้ถ่ายรูปก่อนส่ง' using errcode = '23514'; end if;
  if cardinality(clean) > 6 then raise exception 'ส่งรูปได้ครั้งละไม่เกิน 6 รูป' using errcode = '23514'; end if;
  folder := private.mockup_folder(j.confirmation_no) || '/' || private.station_at(j.route_code, j.station_seq) || '/' || j.visit || '/';
  foreach p in array clean loop
    if left(p, length(folder)) <> folder or p !~ '^[A-Za-z0-9_-]{1,200}/[a-z_]{1,20}/[0-9]{1,4}/[A-Za-z0-9]{1,64}\.jpg$' then
      raise exception 'รูปนี้ไม่ใช่ของงาน % สถานีนี้ ให้ถ่ายรูปใหม่จากหน้างานนี้', j.confirmation_no using errcode = '23514';
    end if;
    if not private.station_photo_uploaded(p) then
      raise exception 'รูปยังอัปโหลดไม่เสร็จ ให้ถ่ายหรือส่งรูปอีกครั้ง' using errcode = 'P0001';
    end if;
  end loop;
  return clean;
end $$;
revoke all on function private.check_station_photos(public.jobs, text[]) from public, anon, authenticated;

create or replace function private.station_photo_job(p_job uuid, p_station text) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r text; cur text;
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') or j.station_seq is null then perform private.stale('งานไม่ได้อยู่ในสถานี'); end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if p_station is distinct from cur then perform private.stale('งานนี้ไปอยู่สถานีอื่นแล้ว'); end if;
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC ส่งรูปได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;
  if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อน' using errcode = 'P0001'; end if;
  if j.station_status is distinct from 'doing' then raise exception 'กด "เริ่ม" ก่อนถ่ายรูป' using errcode = 'P0001'; end if;
  if not private.photo_gate_on(j) then raise exception 'รอบนี้ไม่ต้องส่งรูป กด "เสร็จ" ได้เลย' using errcode = 'P0001'; end if;
  return j;
end $$;
revoke all on function private.station_photo_job(uuid, text) from public, anon, authenticated;

create or replace function public.submit_first_piece(p_job uuid, p_station text, p_photos text[], p_note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; last_fp public.station_checks; clean text[]; v_id bigint; v_note text := nullif(btrim(p_note), ''); st_name text;
begin
  j := private.station_photo_job(p_job, p_station);
  if not private.needs_first_piece(j) then raise exception 'สถานีนี้ไม่ต้องส่งรูปชิ้นแรก ถ่ายรูปงานเสร็จได้เลย' using errcode = 'P0001'; end if;
  select * into last_fp from private.visit_checks(j) c where c.kind = 'first_piece' order by c.sent_at desc, c.id desc limit 1;
  if last_fp.status = 'pending' then raise exception 'ส่งรูปชิ้นแรกไปแล้ว รอแอดมินอนุมัติ' using errcode = 'P0001'; end if;
  if last_fp.status = 'approved' then perform private.stale('ชิ้นแรกผ่านแล้ว'); end if;
  clean := private.check_station_photos(j, p_photos);
  insert into public.station_checks (job_id, station_code, visit, kind, status, photos, note, sent_by)
  values (j.id, p_station, j.visit, 'first_piece', 'pending', clean, v_note, auth.uid())
  returning id into v_id;
  perform private.log(j.id, 'first_piece_sent', j.phase, p_station,
    jsonb_build_object('check_id', v_id, 'visit', j.visit, 'photos', cardinality(clean), 'resend', last_fp.id is not null));
  select name into st_name from public.stations where code = p_station;
  perform private.inbox_emit('first_piece_pending', j.id, 'fp:' || v_id, 'รออนุมัติชิ้นแรก ' || j.confirmation_no,
    format('%s · สถานี%s · %s', j.customer_name, st_name, coalesce(v_note, 'ตรวจรูปชิ้นแรกเทียบม็อคอัพ')),
    array['admin', 'manager']);
  return v_id;
end $$;

create or replace function public.decide_first_piece(p_check bigint, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.station_checks; j public.jobs; v_reason text := nullif(btrim(p_reason), ''); st_name text;
begin
  perform private.require_role('admin', 'manager');
  if p_approve is null then raise exception 'เลือก "ผ่าน" หรือ "ไม่ผ่าน"' using errcode = '22023'; end if;
  select * into c from public.station_checks where id = p_check;
  if not found or c.kind <> 'first_piece' then raise exception 'ไม่พบรายการรูปชิ้นแรกนี้' using errcode = 'P0002'; end if;
  select * into j from public.jobs where id = c.job_id for update;
  select * into c from public.station_checks where id = p_check for update;
  if c.status <> 'pending' then perform private.stale('รูปชิ้นแรกนี้ตัดสินไปแล้ว'); end if;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if private.station_at(j.route_code, j.station_seq) is distinct from c.station_code or j.visit <> c.visit then
    perform private.stale('งานออกจากสถานีนี้แล้ว');
  end if;
  if not p_approve and v_reason is null then raise exception 'ใส่เหตุผลที่ไม่ผ่าน ให้หน้างานรู้ว่าต้องแก้อะไร' using errcode = '23514'; end if;
  update public.station_checks set status = case when p_approve then 'approved' else 'rejected' end,
    reject_reason = case when p_approve then null else left(v_reason, 300) end,
    decided_by = auth.uid(), decided_at = now()
  where id = p_check;
  perform private.log(c.job_id, case when p_approve then 'first_piece_ok' else 'first_piece_rejected' end, j.phase, c.station_code,
    jsonb_build_object('check_id', c.id, 'visit', c.visit, 'reason', case when p_approve then null else v_reason end));
  if not p_approve then
    select name into st_name from public.stations where code = c.station_code;
    perform private.inbox_emit('first_piece_rejected', j.id, 'fpr:' || c.id, 'ชิ้นแรกไม่ผ่าน ' || j.confirmation_no,
      format('สถานี%s · %s · แก้แล้วถ่ายรูปชิ้นแรกส่งใหม่', st_name, v_reason),
      array['supervisor', 'staff', 'production']);
  end if;
end $$;

create or replace function public.add_finish_photos(p_job uuid, p_station text, p_photos text[]) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; clean text[]; v_id bigint; fp text[];
begin
  j := private.station_photo_job(p_job, p_station);
  fp := array(select m from unnest(private.photo_gate_missing(p_job)) m where m <> 'ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป');
  if cardinality(fp) > 0 then raise exception '%', fp[1] using errcode = 'P0001'; end if;
  clean := private.check_station_photos(j, p_photos);
  insert into public.station_checks (job_id, station_code, visit, kind, status, photos, sent_by)
  values (j.id, p_station, j.visit, 'finish', 'recorded', clean, auth.uid())
  returning id into v_id;
  perform private.log(j.id, 'finish_photo', j.phase, p_station,
    jsonb_build_object('check_id', v_id, 'visit', j.visit, 'photos', cardinality(clean)));
  return v_id;
end $$;

create or replace function public.set_station_photos_enabled(p_on boolean, p_remind_minutes int default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role('owner');
  update public.station_photo_settings set
    enabled_at = case when p_on then coalesce(enabled_at, now()) else null end,
    remind_minutes = coalesce(p_remind_minutes, remind_minutes)
  where id;
end $$;

revoke all on function public.submit_first_piece(uuid, text, text[], text), public.decide_first_piece(bigint, boolean, text),
  public.add_finish_photos(uuid, text, text[]), public.set_station_photos_enabled(boolean, int) from public, anon;
grant execute on function public.submit_first_piece(uuid, text, text[], text), public.decide_first_piece(bigint, boolean, text),
  public.add_finish_photos(uuid, text, text[]), public.set_station_photos_enabled(boolean, int) to authenticated;

create or replace function public.station_photo_flags()
returns table (job_id uuid, station_code text, needs_first_piece boolean, first_piece text, first_piece_id bigint,
  reject_reason text, first_piece_at timestamptz, finish_photos int, visit int, folder text, remind_minutes int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  return query
  select j.id, private.station_at(j.route_code, j.station_seq), private.needs_first_piece(j),
    fp.status, fp.id, fp.reject_reason, fp.sent_at,
    (select coalesce(sum(cardinality(c.photos)), 0)::int from private.visit_checks(j) c where c.kind = 'finish'), j.visit, private.mockup_folder(j.confirmation_no),
    (select s.remind_minutes from public.station_photo_settings s)
  from public.jobs j
  left join lateral (select c.* from private.visit_checks(j) c where c.kind = 'first_piece'
    order by c.sent_at desc, c.id desc limit 1) fp on true
  where j.phase in ('sample', 'production') and j.station_status in ('doing', 'hold') and private.photo_gate_on(j);
end $$;
revoke all on function public.station_photo_flags() from public, anon;
grant execute on function public.station_photo_flags() to authenticated;

-- รูปที่ค้างรอแต่งานออกจากสถานีไปแล้ว (ปิดฟีเจอร์ระหว่างรอ) ไม่นับ · ช่วงพักงาน / รอเครื่องซ้อนอยู่หักไปแล้วใน hold_days / requeue_wait_days
create or replace function private.first_piece_wait_days(p_job uuid, p_from timestamptz) returns numeric
language sql stable security definer set search_path = '' as $$
  with cur as (select private.station_at(route_code, station_seq) station, visit from public.jobs where id = p_job),
  w as (
    select l.job_id, greatest(c.sent_at, p_from) a,
      least(coalesce(c.decided_at, case when c.station_code = cur.station and c.visit = cur.visit then now() else c.sent_at end), l.until) b
    from cur cross join private.split_lineage(p_job) l
    join public.station_checks c on c.job_id = l.job_id and c.kind = 'first_piece' and c.sent_at <= l.until
  )
  select coalesce(sum(greatest(private.work_days(w.a, w.b) - coalesce((
      select sum(private.work_days(greatest(i.opened_at, w.a), least(coalesce(i.closed_at, now()), w.b)))
      from public.issues i where i.job_id = w.job_id and i.opened_at < w.b and coalesce(i.closed_at, now()) > w.a), 0) - coalesce((
      select sum(private.work_days(greatest(q.at, w.a), least(coalesce(n.at, now()), w.b)))
      from public.events q
      left join lateral (select min(e.at) as at from public.events e
                         where e.job_id = q.job_id and e.id > q.id and e.type in ('station_start', 'hold')) n on true
      where q.job_id = w.job_id and q.type = 'resume' and ((q.payload ->> 'requeued')::boolean or (q.payload ->> 'waiting')::boolean)
        and q.at < w.b and coalesce(n.at, now()) > w.a), 0), 0)), 0)
  from w where w.b > w.a
$$;
revoke all on function private.first_piece_wait_days(uuid, timestamptz) from public, anon, authenticated;

-- เหมือน 20261128000000 เพิ่ม: หักเวลารอแอดมินอนุมัติชิ้นแรก
create or replace function private.sla_state(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  j public.jobs; st public.stations; seg public.sla_segments;
  cur text; el numeric; seg_start timestamptz; seg_el numeric; reported boolean; seg_reported boolean;
  st_days numeric; seg_days numeric;
  res jsonb := '{}';
begin
  select * into j from public.jobs where id = p_job;
  if not found or j.phase <> 'production' or j.station_seq is null then return res; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  select * into st from public.stations where code = cur;
  st_days := private.sla_for_qty(st.sla_days, st.big_qty, st.big_sla_days, j.qty);

  if j.station_started_at is not null and st_days is not null and not j.is_rework then
    el := private.work_days(j.station_started_at, now()) - private.hold_days(j.id, j.station_started_at)
      - private.requeue_wait_days(j.id, j.station_started_at) - private.first_piece_wait_days(j.id, j.station_started_at);
    select exists (select 1 from private.split_lineage(j.id) l join public.delay_reports d on d.job_id = l.job_id
                   where d.visit = j.visit and d.at <= l.until) into reported;
    res := res || jsonb_build_object(
      'station_sla_days', st_days, 'station_days', round(greatest(el, 0), 3),
      'station_warn', el >= st_days * st.warn_pct / 100.0,
      'station_over', el > st_days, 'station_reported', reported);
  end if;

  seg := private.segment_of(j.route_code, cur);
  seg_days := private.sla_for_qty(seg.sla_days, seg.big_qty, seg.big_sla_days, j.qty);
  if seg.code is not null and seg_days is not null and not j.is_rework then
    select min(e.at) into seg_start from private.split_lineage(j.id) l join public.events e on e.job_id = l.job_id
    where (l.until_event is null or e.id < l.until_event) and e.type = 'station_start' and e.phase = 'production' and e.station_code = seg.from_station
      and not coalesce((e.payload->>'rework')::boolean, false);
    if seg_start is not null then
      seg_el := private.work_days(seg_start, now()) - private.hold_days(j.id, seg_start) - private.first_piece_wait_days(j.id, seg_start);
      select exists (select 1 from private.split_lineage(j.id) l join public.delay_reports d on d.job_id = l.job_id
                     where d.segment_code = seg.code and d.at >= seg_start and d.at <= l.until)
        into seg_reported;
      res := res || jsonb_build_object(
        'segment_code', seg.code, 'segment_name', seg.name, 'segment_sla_days', seg_days,
        'segment_days', round(greatest(seg_el, 0), 3),
        'segment_warn', seg_el >= seg_days * seg.warn_pct / 100.0,
        'segment_over', seg_el > seg_days, 'segment_reported', seg_reported);
    end if;
  end if;
  return res;
end $$;

create or replace function private.first_piece_scan() returns integer
language plpgsql security definer set search_path = '' as $$
declare c record; v_added integer := 0; v_minutes int;
begin
  select remind_minutes into v_minutes from public.station_photo_settings;
  for c in
    select sc.id, sc.sent_at, j.id as job_id, j.confirmation_no, j.customer_name, s.name as station_name
    from public.station_checks sc
    join public.jobs j on j.id = sc.job_id and j.phase in ('sample', 'production') and j.visit = sc.visit
      and private.station_at(j.route_code, j.station_seq) = sc.station_code
    join public.stations s on s.code = sc.station_code
    where sc.status = 'pending' and sc.sent_at < now() - make_interval(mins => coalesce(v_minutes, 15))
  loop
    if private.inbox_emit('first_piece_late', c.job_id, 'fpl:' || c.id, 'ชิ้นแรกรออนุมัติเกิน ' || coalesce(v_minutes, 15) || ' นาที ' || c.confirmation_no,
      format('%s · สถานี%s · ส่งรูปตั้งแต่ %s น. หน้างานรออยู่', c.customer_name, c.station_name,
        to_char(c.sent_at at time zone 'Asia/Bangkok', 'HH24:MI')),
      array['manager', 'production'])
    then v_added := v_added + 1; end if;
  end loop;
  return v_added;
end $$;
revoke all on function private.first_piece_scan() from public, anon, authenticated;

-- เหมือน 20261118200000 เพิ่ม: เตือนรูปชิ้นแรกที่รออนุมัตินาน
create or replace function public.inbox_scan() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'ไม่มีสิทธิ์เข้าใช้งาน' using errcode = '42501';
  end if;
  return private.inbox_scan_all() + private.first_piece_scan();
end $$;

-- pg_cron เรียก inbox_scan_all ตรง (ไม่ผ่าน inbox_scan) · ต้องเตือนรูปรอนานแม้ไม่มีใครเปิดหน้าเว็บ
create or replace function private.inbox_scan_cron() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  return private.inbox_scan_all() + private.first_piece_scan();
end $$;
revoke all on function private.inbox_scan_cron() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('inbox-scan-5m', '*/5 * * * *', 'select private.inbox_scan_cron()');
  end if;
exception when others then null;
end $$;
