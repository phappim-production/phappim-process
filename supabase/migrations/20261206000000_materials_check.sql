-- ขั้น "รอผลิต": รับงานแล้วยังไม่เข้าไลน์จนแอดมินเช็ควัตถุดิบครบ (รายการพิมพ์เองต่องาน) + รูปวัตถุดิบอย่างน้อย 1 รูป แล้วกดปล่อย
-- เวลาผลิตทั้งงานนับจากวันปล่อยเข้าไลน์ · ปิดขั้นนี้ได้ที่ production_settings.materials_check (ปิด = ปล่อยทันทีเหมือนเดิม)

create table if not exists public.production_settings (
  id              boolean primary key default true check (id),
  materials_check boolean not null default true
);
insert into public.production_settings (id) values (true) on conflict do nothing;
alter table public.production_settings enable row level security;
drop policy if exists production_settings_read on public.production_settings;
create policy production_settings_read on public.production_settings for select to authenticated
  using ((select private.my_role()) is not null);
revoke all on public.production_settings from anon;
grant select on public.production_settings to authenticated;
drop trigger if exists production_settings_audit on public.production_settings;
create trigger production_settings_audit after insert or update or delete on public.production_settings
  for each row execute function private.audit_settings('id');

create table if not exists public.job_material_photos (
  id     bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  path   text not null,
  by     uuid references auth.users(id),
  at     timestamptz not null default now(),
  unique (job_id, path)
);
create index if not exists job_material_photos_job_idx on public.job_material_photos (job_id);
create index if not exists job_material_photos_by_idx on public.job_material_photos (by);
alter table public.job_material_photos enable row level security;
drop policy if exists job_material_photos_read on public.job_material_photos;
create policy job_material_photos_read on public.job_material_photos for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
revoke all on public.job_material_photos from anon;
grant select on public.job_material_photos to authenticated;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_material_photos') then
    alter publication supabase_realtime add table public.job_material_photos;
  end if;
end $$;

-- manual = แอดมินกดปล่อยหลังเช็ควัตถุดิบ (เวลาผลิตเริ่มนับวันนี้) · ไม่ใช่ = ปล่อยทันทีตอนรับงาน
drop function if exists private.release_now(uuid);
create or replace function private.release_now(p_job uuid, p_manual boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n_items int; n_photos int; v_extra jsonb;
begin
  select * into j from public.jobs where id = p_job;
  select count(*) into n_items from public.job_materials where job_id = p_job;
  select count(*) into n_photos from public.job_material_photos where job_id = p_job;
  v_extra := case when p_manual then jsonb_build_object('manual', true, 'materials', n_items, 'photos', n_photos) else '{}'::jsonb end;
  if j.needs_sample then
    update public.jobs set phase = 'sample' where id = p_job;
    perform private.enter_station(p_job, 1);
    perform private.log(p_job, 'released', 'sample', null, jsonb_build_object('round', j.sample_round) || v_extra);
  else
    update public.jobs set phase = 'production', first_piece_ok = false, sew_count = 0 where id = p_job;
    perform private.enter_station(p_job, 1);
    perform private.log(p_job, 'released', 'production', null, jsonb_build_object('sample', false) || v_extra);
  end if;
end $$;
revoke all on function private.release_now(uuid, boolean) from public, anon, authenticated;

-- เปิดขั้นรอผลิตอยู่ = งานใหม่ค้างที่ "รอผลิต" จนแอดมินกดปล่อย (release_job)
-- ปล่อยเองได้เฉพาะในธุรกรรมที่รับงาน (created_at = now()) · งานที่รออยู่แล้วไม่หลุดเข้าไลน์ตอนสั่งฟิล์ม แม้ปิดขั้นนี้ภายหลัง
create or replace function private.release_if_ready(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  if j.phase <> 'materials' or j.created_at <> now() then return; end if;
  if coalesce((select s.materials_check from public.production_settings s), false) then return; end if;
  perform private.release_now(p_job);
end $$;

-- p_base = รายการที่หน้าจอเห็นตอนกด · ไม่ตรง = มีเครื่องอื่นแก้ก่อน ไม่บันทึกทับ
drop function if exists public.set_job_materials(uuid, text[]);
create or replace function public.set_job_materials(p_job uuid, p_items text[], p_base text[] default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_items text[];
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if j.phase <> 'materials' then perform private.stale('งานนี้ปล่อยเข้าไลน์การผลิตแล้ว แก้รายการวัตถุดิบไม่ได้'); end if;
  if p_base is not null and p_base is distinct from
     (select coalesce(array_agg(m.name order by m.id), '{}') from public.job_materials m where m.job_id = p_job) then
    perform private.stale('รายการวัตถุดิบเพิ่งถูกแก้จากเครื่องอื่น · ดูรายการล่าสุดแล้วลองอีกครั้ง');
  end if;
  select coalesce(array_agg(x order by n), '{}') into v_items from (
    select distinct on (lower(btrim(t.x))) left(btrim(t.x), 80) as x, t.n
    from unnest(coalesce(p_items, '{}')) with ordinality as t(x, n)
    where btrim(coalesce(t.x, '')) <> ''
    order by lower(btrim(t.x)), t.n
  ) s;
  if cardinality(v_items) > 30 then
    raise exception 'รายการวัตถุดิบไม่เกิน 30 รายการ · รวมของที่เป็นชุดเดียวกันไว้ในรายการเดียว' using errcode = '23514';
  end if;
  delete from public.job_materials m where m.job_id = p_job and m.key is null and not (m.name = any (v_items));
  insert into public.job_materials (job_id, name, dept)
    select p_job, x, 'admin' from unnest(v_items) as x
    where not exists (select 1 from public.job_materials m where m.job_id = p_job and m.name = x);
  perform private.log(p_job, 'materials_set', 'materials', null, jsonb_build_object('items', to_jsonb(v_items)));
end $$;
revoke all on function public.set_job_materials(uuid, text[], text[]) from public, anon;
grant execute on function public.set_job_materials(uuid, text[], text[]) to authenticated;

create or replace function public.check_material(p_material_id bigint, p_checked boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.job_materials; j public.jobs;
begin
  perform private.require_role('admin');
  select * into m from public.job_materials where id = p_material_id;
  if not found then raise exception 'ไม่พบรายการวัตถุดิบ' using errcode = 'P0002'; end if;
  j := private.lock_job(m.job_id);
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if j.phase <> 'materials' then perform private.stale('งานนี้ปล่อยเข้าไลน์การผลิตแล้ว'); end if;
  update public.job_materials set checked_at = case when p_checked then now() end,
                                  checked_by = case when p_checked then auth.uid() end
  where id = p_material_id;
  perform private.log(j.id, case when p_checked then 'material_checked' else 'material_unchecked' end, 'materials', null,
                      jsonb_build_object('material_id', p_material_id, 'name', m.name));
end $$;

create or replace function public.add_material_photos(p_job uuid, p_paths text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_folder text; p text; added int := 0;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if j.phase <> 'materials' then perform private.stale('งานนี้ปล่อยเข้าไลน์การผลิตแล้ว'); end if;
  if coalesce(cardinality(p_paths), 0) = 0 then raise exception 'เลือกรูปวัตถุดิบอย่างน้อย 1 รูป' using errcode = '23514'; end if;
  v_folder := private.mockup_folder(j.confirmation_no);
  foreach p in array p_paths loop
    if coalesce(p, '') !~ '^[A-Za-z0-9_-]{1,200}/[A-Za-z0-9]{1,64}\.(jpg|png|webp)$' or split_part(p, '/', 1) <> v_folder
       or not private.mockup_uploaded(p) then
      raise exception 'รูปวัตถุดิบยังอัปโหลดไม่สำเร็จ ให้เลือกรูปใหม่อีกครั้ง' using errcode = '23514';
    end if;
    if p = j.mockup_path or coalesce(j.spec -> 'mockups', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('path', p)) then
      raise exception 'รูปนี้เป็นรูปม็อคอัพของงาน · ถ่ายรูปวัตถุดิบจริงที่เตรียมไว้' using errcode = '23514';
    end if;
    insert into public.job_material_photos (job_id, path, by) values (p_job, p, auth.uid()) on conflict do nothing;
    if found then added := added + 1; end if;
  end loop;
  if (select count(*) from public.job_material_photos where job_id = p_job) > 12 then
    raise exception 'รูปวัตถุดิบไม่เกิน 12 รูปต่องาน · ลบรูปที่ซ้ำออกก่อน' using errcode = '23514';
  end if;
  if added = 0 then raise exception 'รูปนี้แนบไว้แล้ว · ถ่ายรูปใหม่ถ้าต้องการเพิ่ม' using errcode = 'P0001'; end if;
  perform private.log(p_job, 'material_photos', 'materials', null, jsonb_build_object('added', added));
end $$;
revoke all on function public.add_material_photos(uuid, text[]) from public, anon;
grant execute on function public.add_material_photos(uuid, text[]) to authenticated;

create or replace function public.remove_material_photo(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare ph public.job_material_photos; j public.jobs;
begin
  perform private.require_role('admin');
  select * into ph from public.job_material_photos where id = p_id;
  if not found then perform private.stale('รูปนี้ถูกลบไปแล้ว'); end if;
  j := private.lock_job(ph.job_id);
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if j.phase <> 'materials' then perform private.stale('งานนี้ปล่อยเข้าไลน์การผลิตแล้ว ลบรูปวัตถุดิบไม่ได้'); end if;
  delete from public.job_material_photos where id = p_id;
  perform private.log(ph.job_id, 'material_photo_removed', 'materials', null, jsonb_build_object('path', ph.path));
end $$;
revoke all on function public.remove_material_photo(bigint) from public, anon;
grant execute on function public.remove_material_photo(bigint) to authenticated;

create or replace function public.release_job(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_left text[];
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  if j.phase <> 'materials' then perform private.stale('งานนี้ปล่อยเข้าไลน์การผลิตไปแล้ว'); end if;
  -- ปิดขั้นนี้แล้ว = งานที่ค้างรออยู่กดปล่อยได้เลยไม่ต้องเช็ค
  if coalesce((select s.materials_check from public.production_settings s), true) then
    if not exists (select 1 from public.job_materials where job_id = p_job) then
      raise exception 'เพิ่มรายการวัตถุดิบที่ต้องเช็คอย่างน้อย 1 รายการก่อนปล่อยเข้าไลน์' using errcode = 'P0001';
    end if;
    select array_agg(name order by id) into v_left from public.job_materials where job_id = p_job and checked_at is null;
    if v_left is not null then
      raise exception 'ยังไม่ได้ติ๊กวัตถุดิบ: % · เช็คของให้ครบก่อนปล่อยเข้าไลน์', array_to_string(v_left, ', ') using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.job_material_photos where job_id = p_job) then
      raise exception 'ถ่ายรูปวัตถุดิบอย่างน้อย 1 รูปก่อนปล่อยเข้าไลน์' using errcode = 'P0001';
    end if;
  end if;
  -- ลำดับคิวตามวันที่ของพร้อม ไม่ใช่วันที่รับใบ
  update public.jobs set queue_seq = nextval('public.job_queue_seq') where id = p_job;
  perform private.release_now(p_job, true);
end $$;
revoke all on function public.release_job(uuid) from public, anon;
grant execute on function public.release_job(uuid) to authenticated;

-- เวลาผลิตเริ่มนับวันที่แอดมินปล่อยเข้าไลน์ (released แบบ manual ของงานต้นทาง) · งานที่ปล่อยทันทีตอนรับ = วันรับงานเหมือนเดิม · ยังรอผลิต = ยังไม่เริ่มนับ
create or replace function private.lead_state(p_job uuid, p_today date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  j public.jobs; r public.jobs;
  v_qty int; v_days int; v_start date; v_end date; v_due date; v_warn_on date; v_reported boolean;
begin
  select * into j from public.jobs where id = p_job;
  if not found or j.develop or j.phase in ('cancelled', 'materials') then return '{}'; end if;
  select * into r from public.jobs where id = private.split_root(p_job);
  select (min(e.at) at time zone 'Asia/Bangkok')::date into v_start from public.events e
    where e.job_id = r.id and e.type = 'released' and e.payload ->> 'manual' = 'true';
  v_start := coalesce(v_start, (r.created_at at time zone 'Asia/Bangkok')::date);
  with recursive fam(id, no, depth) as (
    select r.id, r.confirmation_no, 0
    union all
    select c.id, c.confirmation_no, fam.depth + 1 from fam
      join public.events e on e.type = 'job_split_from' and e.payload ->> 'parent' = fam.no
      join public.jobs c on c.id = e.job_id
    where fam.depth < 50
  )
  select coalesce(sum(f.qty), 0) into v_qty from public.jobs f
  where f.id in (select fam.id from fam);

  v_days := private.lead_days(greatest(v_qty, j.qty));
  v_due := private.lead_day_n(v_start, v_days);
  v_warn_on := private.lead_day_n(v_start, ceil(v_days * 0.8)::int);
  v_end := case when j.phase = 'done' and j.finished_at is not null then (j.finished_at at time zone 'Asia/Bangkok')::date
                else coalesce(p_today, (now() at time zone 'Asia/Bangkok')::date) end;
  select exists (select 1 from private.split_lineage(j.id) l join public.delay_reports d on d.job_id = l.job_id
                 where d.at <= l.until and (d.at at time zone 'Asia/Bangkok')::date >= v_warn_on) into v_reported;
  return jsonb_build_object(
    'lead_qty', greatest(v_qty, j.qty), 'lead_days', v_days, 'lead_start', v_start, 'lead_due', v_due,
    'lead_warn_on', v_warn_on, 'lead_used', private.lead_used(v_start, v_end),
    'lead_warn', v_end >= v_warn_on, 'lead_over', v_end > v_due, 'lead_reported', v_reported);
end $$;

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
        or exists (select 1 from public.job_material_photos m where m.path = p)
        or exists (select 1 from public.confirmation_drafts d where d.data ->> 'mockup_path' = p)
        or exists (select 1 from public.confirmation_drafts d where d.data -> 'mockups' @> jsonb_build_array(jsonb_build_object('path', p)))
        or private.my_file_upload(p_kind, p)))
      or (p_kind = 'station_photos' and not private.staff_without_station() and (
        exists (select 1 from public.station_checks c where c.photos @> array[p])
        or private.my_file_upload(p_kind, p))));
end $$;

-- รอผลิตนานเตือนแอดมินแม้ยังไม่มีรายการ (งานที่ลืมไว้) · เกินเวลาผลิตบอกวันเริ่มนับ (วันปล่อยเข้าไลน์)
create or replace function private.inbox_scan_all() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_added integer := 0;
  j record;
  v_lead jsonb;
  v_left int;
  v_qty text;
begin
  for j in
    select jb.*, pt.name as product_name
    from public.jobs jb
    join public.product_types pt on pt.code = jb.product_type_code
    where jb.phase not in ('done', 'cancelled')
  loop
    v_qty := to_char(j.qty, 'FM999,999,999');

    v_lead := private.lead_state(j.id);
    if coalesce((v_lead->>'lead_over')::boolean, false) and not coalesce((v_lead->>'lead_reported')::boolean, false) then
      if private.inbox_emit('sla_over', j.id, 'lead:' || j.id,
        'เกินเวลาผลิต ' || j.confirmation_no,
        format('%s · %s %s %s · เริ่มนับ %s · เวลาผลิต %s วันทำงาน ครบ %s · ต้องส่งรายงานสาเหตุก่อนกด QC + Packing เสร็จ',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date((v_lead->>'lead_start')::date),
          v_lead->>'lead_days', private.thai_date((v_lead->>'lead_due')::date)),
        array['production', 'admin', 'manager'])
      then v_added := v_added + 1; end if;
    end if;

    if private.uses_film(j.route_code) and j.dtf_film_received_at is null and j.dtf_film_eta is not null and v_today > j.dtf_film_eta then
      if private.inbox_emit('film_late', j.id, 'film:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        private.film_label(j.route_code) || ' เลยกำหนด ' || j.confirmation_no,
        format('%s · %s %s %s · กำหนดรับ %s · กรุณาติดตาม%s',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date(j.dtf_film_eta), private.film_label(j.route_code)),
        array['admin', 'production'])
      then v_added := v_added + 1; end if;
    end if;

    if j.phase = 'materials' and private.work_days(j.stage_entered_at, now()) > 2 then
      select count(*) into v_left from public.job_materials m where m.job_id = j.id and m.checked_at is null;
      if private.inbox_emit('materials_late', j.id, 'mat:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        'รอผลิตเกิน 2 วันทำงาน ' || j.confirmation_no,
        format('%s · %s %s %s · ยังไม่เข้าไลน์การผลิต%s · เช็ควัตถุดิบ + ถ่ายรูป แล้วกดปล่อยเข้าไลน์',
          j.customer_name, j.product_name, v_qty, j.unit,
          case when v_left > 0 then format(' · ยังไม่ได้ติ๊ก %s รายการ', v_left) else '' end),
        array['admin'])
      then v_added := v_added + 1; end if;
    end if;

    if j.due_date in (v_today, v_today + 1) then
      if private.inbox_emit('due_soon', j.id, 'due:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        case when j.due_date = v_today then 'ครบกำหนดส่งวันนี้ ' else 'ครบกำหนดส่งพรุ่งนี้ ' end || j.confirmation_no,
        format('%s · %s %s %s · กำหนดส่ง %s',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date(j.due_date)),
        array['production', 'admin', 'manager'])
      then v_added := v_added + 1; end if;
    end if;
  end loop;

  return v_added;
end $$;
