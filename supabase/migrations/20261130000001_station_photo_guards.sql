-- รูปสถานี: อัปโหลดได้เฉพาะงานที่กำลังทำที่สถานีของผู้อัปโหลด · รูปที่เคยส่งแล้วส่งซ้ำไม่ได้ · ตัดสินชิ้นแรกได้เฉพาะงานที่ยังรออยู่และระบบรูปเปิดอยู่
-- จำนวนงานเกิน 100,000 ถือว่าพิมพ์ผิด

create or replace function private.station_photo_upload_error(p_path text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r text := private.my_role(); st public.stations; my_section smallint;
begin
  if r is null then return 'บัญชีนี้ถูกปิดหรือยังไม่ได้ล็อกอิน ให้ล็อกอินใหม่หรือแจ้งเจ้าของระบบ'; end if;
  if r not in ('staff', 'supervisor', 'production', 'qc', 'owner') then return format('บทบาทของคุณ (%s) ทำขั้นนี้ไม่ได้', r); end if;
  if coalesce(p_path, '') !~ '^[A-Za-z0-9_-]{1,200}/[a-z_]{1,20}/[0-9]{1,4}/[A-Za-z0-9]{1,64}\.jpg$' then return 'รูปจากสถานีต้องเป็นไฟล์ JPG'; end if;
  select s.* into st from public.stations s where s.code = split_part(p_path, '/', 2);
  if not exists (select 1 from public.jobs j
                 where private.mockup_folder(j.confirmation_no) = split_part(p_path, '/', 1)
                   and j.phase in ('sample', 'production') and j.station_status = 'doing'
                   and j.visit = split_part(p_path, '/', 3)::int
                   and private.station_at(j.route_code, j.station_seq) = st.code
                   and private.photo_gate_on(j)) then
    return 'รูปนี้ไม่ใช่ของงานที่กำลังทำที่สถานีนี้ ให้กด "เริ่ม" แล้วถ่ายรูปจากหน้างานนี้';
  end if;
  if r = 'qc' and st.code <> 'qc_pack' then return 'ฝ่าย QC ส่งรูปได้เฉพาะสถานี QC + Packing'; end if;
  if r = 'staff' and not exists (select 1 from public.staff_stations ss where ss.user_id = (select auth.uid()) and ss.station_code = st.code) then
    return format('งานนี้อยู่สถานี%s ซึ่งไม่ใช่สถานีของคุณ ให้เจ้าของระบบจับคู่สถานีให้ก่อน หรือให้ฝ่ายผลิตกด', st.name);
  end if;
  if r = 'supervisor' then
    select p.section into my_section from public.profiles p where p.user_id = (select auth.uid());
    if my_section is not null and st.section <> my_section then
      return format('งานนี้อยู่สถานี%s (เฟส %s) ให้ผู้ควบคุมงานเฟส %s เป็นคนกด', st.name, st.section, st.section);
    end if;
  end if;
  return null;
end $$;
revoke all on function private.station_photo_upload_error(text) from public, anon;
grant execute on function private.station_photo_upload_error(text) to authenticated;

-- เหมือน 20261129000000 เพิ่ม: รูปสถานีตรวจงาน สถานี รอบ และสถานีของผู้อัปโหลด
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

create or replace function private.staff_without_station() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'staff' and not exists (select 1 from public.staff_stations ss where ss.user_id = (select auth.uid()))
$$;
revoke all on function private.staff_without_station() from public, anon;
grant execute on function private.staff_without_station() to authenticated;

-- เหมือน 20261129000000 เพิ่ม: พนักงานที่ยังไม่จับคู่สถานีเปิดรูปสถานีไม่ได้
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
      or (p_kind = 'station_photos' and not private.staff_without_station() and (
        exists (select 1 from public.station_checks c where c.photos @> array[p])
        or private.my_file_upload(p_kind, p))));
end $$;
revoke all on function public.file_read_allowed(text, text[]) from public, anon;
grant execute on function public.file_read_allowed(text, text[]) to authenticated;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'station_photos_upload') then
    drop policy station_photos_upload on storage.objects;
    create policy station_photos_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'station_photos' and (select private.station_photo_upload_error(name)) is null);
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'station_photos_read') then
    drop policy station_photos_read on storage.objects;
    create policy station_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'station_photos' and (select private.my_role()) is not null and not (select private.staff_without_station()));
  end if;
end $$;

-- เหมือน 20261129000000 เพิ่ม: รูปที่เคยส่งในรายการใดแล้ว (ชิ้นแรกที่ผ่าน/ไม่ผ่าน หรือรูปงานเสร็จ) ใช้ซ้ำไม่ได้
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
  if exists (select 1 from public.station_checks c where c.photos && clean) then
    raise exception 'มีรูปที่เคยส่งไปแล้ว ให้ถ่ายรูปใหม่' using errcode = '23514';
  end if;
  return clean;
end $$;
revoke all on function private.check_station_photos(public.jobs, text[]) from public, anon, authenticated;

-- เหมือน 20261129000000 เพิ่ม: ส่งซ้ำหลังเน็ตหลุด (รูปชุดเดิมที่บันทึกแล้ว) คืนรายการเดิม ไม่ error
create or replace function public.add_finish_photos(p_job uuid, p_station text, p_photos text[]) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; clean text[]; v_id bigint; fp text[];
begin
  j := private.station_photo_job(p_job, p_station);
  fp := array(select m from unnest(private.photo_gate_missing(p_job)) m where m <> 'ถ่ายรูปงานเสร็จอย่างน้อย 1 รูป');
  if cardinality(fp) > 0 then raise exception '%', fp[1] using errcode = 'P0001'; end if;
  select c.id into v_id from private.visit_checks(j) c
  where c.kind = 'finish' and c.sent_by is not distinct from auth.uid()
    and c.photos @> p_photos and c.photos <@ p_photos
  limit 1;
  if v_id is not null then return v_id; end if;
  clean := private.check_station_photos(j, p_photos);
  insert into public.station_checks (job_id, station_code, visit, kind, status, photos, sent_by)
  values (j.id, p_station, j.visit, 'finish', 'recorded', clean, auth.uid())
  returning id into v_id;
  perform private.log(j.id, 'finish_photo', j.phase, p_station,
    jsonb_build_object('check_id', v_id, 'visit', j.visit, 'photos', cardinality(clean)));
  return v_id;
end $$;

-- เหมือน 20261129000000 เพิ่ม: งานที่ส่งออกข้างนอกแล้ว หรือเจ้าของปิดระบบรูปแล้ว ตัดสินไม่ได้ (ตรงกับรายการที่หน้าเว็บแสดง)
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
  if not exists (select 1 from public.station_photo_settings s where s.enabled_at is not null) then
    raise exception 'เจ้าของปิดระบบรูปยืนยันงานแล้ว ไม่ต้องตัดสินรูปนี้' using errcode = 'P0001';
  end if;
  -- งานที่แบ่งออกมารอรูปของงานต้นทางด้วย · ตัดสินได้ถ้ายังมีงานในครอบครัวรออยู่ที่สถานีนี้ แม้งานต้นทางยกเลิก/ออกไปแล้ว
  if not exists (select 1 from public.jobs w cross join lateral private.split_lineage(w.id) l
                 where l.job_id = c.job_id and c.sent_at <= l.until
                   and w.phase in ('sample', 'production') and w.visit = c.visit
                   and private.station_at(w.route_code, w.station_seq) = c.station_code
                   and w.station_status in ('doing', 'hold', 'queued') and private.photo_gate_on(w)) then
    if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
    if exists (select 1 from public.jobs w cross join lateral private.split_lineage(w.id) l
               where l.job_id = c.job_id and c.sent_at <= l.until and w.station_status = 'out'
                 and private.station_at(w.route_code, w.station_seq) = c.station_code) then
      raise exception 'งานนี้ส่งออกข้างนอกแล้ว ไม่ต้องตัดสินรูปนี้' using errcode = 'P0001';
    end if;
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

create or replace function private.jobs_qty_cap() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.qty > 100000 then
    raise exception 'จำนวน % มากเกินไป ตรวจว่าพิมพ์ตัวเลขถูกไหม (ไม่เกิน 100,000)', to_char(new.qty, 'FM999,999,999,999') using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.jobs_qty_cap() from public, anon, authenticated;
create trigger jobs_qty_cap before insert or update of qty on public.jobs
  for each row execute function private.jobs_qty_cap();
