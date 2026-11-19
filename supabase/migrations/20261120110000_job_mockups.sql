-- รูปม็อคอัพบนการ์ดงาน (เจ้าของขอ 19 พ.ย.: "คนส่วนใหญ่ดูงานผ่านรูปแทนรหัสงาน")
-- ฟอร์มใบยืนยันบังคับแนบภาพม็อคอัพอยู่แล้ว แต่เดิมตัดภาพทิ้งตอนบันทึกเข้าระบบ (ภาพอยู่แค่ใน PDF)
-- ใหม่: ฟอร์มย่อภาพแรกเป็นรูปเล็ก → หน้าระบบอัปโหลดเข้า Storage 'mockups' → ใบร่างเก็บแค่ path (data.mockup_path)
--       ส่งงานเข้า = งานได้รูปจากใบร่างเลขเดียวกัน · แอดมินเพิ่ม/เปลี่ยนรูปทีหลังได้ (set_job_mockup)
-- กฎโปรเจกต์: ไม่เก็บรูปในตาราง เก็บแค่ path

alter table public.jobs add column mockup_path text check (char_length(mockup_path) <= 300);
comment on column public.jobs.mockup_path is 'รูปม็อคอัพของงาน (Storage mockups) · ว่าง = ยังไม่มีรูป · เปลี่ยนด้วย set_job_mockup';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    -- รูปย่อจากฟอร์มราว 100 KB · เผื่อแอดมินแนบรูปจากมือถือเอง 5 MB · ไม่เปิดสาธารณะ (งานลูกค้า)
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('mockups', 'mockups', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    -- ทุกบทบาทดูรูปได้ (คนหน้างานจำงานจากรูป) · อัปโหลดได้เฉพาะแอดมิน / เจ้าของ (คนบันทึกใบยืนยัน)
    -- ไม่มีสิทธิ์แก้/ลบ: เปลี่ยนรูป = อัปโหลดไฟล์ใหม่แล้วชี้ path ใหม่
    execute $p$create policy mockups_read on storage.objects for select to authenticated
      using (bucket_id = 'mockups' and (select private.my_role()) is not null)$p$;
    execute $p$create policy mockups_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'mockups' and (select private.my_role()) in ('admin', 'owner'))$p$;
  end if;
end $$;

-- มีรูปนี้ใน Storage จริงไหม · ไม่มี Storage (ฐานข้อมูลทดสอบ) = ข้ามการตรวจ
create or replace function private.mockup_uploaded(p_path text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if to_regclass('storage.objects') is null then return true; end if;
  if not exists (select 1 from storage.buckets where id = 'mockups') then return true; end if;
  return exists (select 1 from storage.objects where bucket_id = 'mockups' and name = p_path);
end $$;
revoke all on function private.mockup_uploaded(text) from public, anon;

create or replace function private.check_mockup(p_path text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(trim(p_path), '') = '' or lower(p_path) !~ '\.(jpe?g|png|webp)$' then
    raise exception 'รูปม็อคอัพต้องเป็นไฟล์ภาพ (JPG / PNG / WEBP)' using errcode = '23514';
  end if;
  if not private.mockup_uploaded(p_path) then
    raise exception 'ยังไม่พบรูปม็อคอัพในระบบ ให้เลือกรูปแล้วกดอีกครั้ง' using errcode = '23514';
  end if;
end $$;
revoke all on function private.check_mockup(text) from public, anon;

-- แอดมินเพิ่ม / เปลี่ยนรูปม็อคอัพของงาน (บันทึก 1 แถวใน events ไว้ดูย้อนหลัง)
create or replace function public.set_job_mockup(p_job uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  perform private.check_mockup(p_path);
  update public.jobs set mockup_path = p_path where id = p_job;
  perform private.log(p_job, 'mockup', j.phase, null,
    jsonb_build_object('path', p_path, 'replaced', j.mockup_path is not null));
end $$;
revoke all on function public.set_job_mockup(uuid, text) from public, anon;
grant execute on function public.set_job_mockup(uuid, text) to authenticated;

-- เหมือน 20261119230000 ทุกอย่าง เพิ่ม: งานได้รูปม็อคอัพจากใบร่างเลขเดียวกัน (ถ้ารูปอยู่ใน Storage จริง)
create or replace function public.receive_job(
  p_confirmation_no text, p_customer_name text, p_job_name text, p_product_type_code text,
  p_qty int, p_unit text, p_due_date date, p_route_code text, p_confirmation_pdf_path text,
  p_spare_qty int default 0, p_confirmation_rev int default 0, p_spec jsonb default '{}',
  p_needs_sample boolean default true   -- ไม่ระบุ = ขึ้นตัวอย่าง (ทางที่ปลอดภัยกว่า) · หน้ารับงานบังคับให้เลือกเอง
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_pdf text; v_mockup text;
begin
  -- บอกคนหน้างานตรงๆ ว่าต้องทำอะไร แทนข้อความบทบาททั่วไป
  if private.my_role() in ('production', 'supervisor') then
    raise exception 'แอดมินเป็นคนส่งงานเข้าโรงงาน ให้แจ้งแอดมินส่งใบยืนยันเข้าระบบ' using errcode = '42501';
  end if;
  perform private.require_role('admin');
  -- PDF ที่ลูกค้าเซ็นไม่บังคับแล้ว · แนบทีหลังได้ด้วย attach_confirmation_pdf · ถ้าแนบมาต้องเป็น PDF ที่อัปโหลดแล้วจริง
  v_pdf := nullif(trim(p_confirmation_pdf_path), '');
  if v_pdf is not null then
    perform private.check_confirmation_pdf(v_pdf);
  end if;
  if coalesce(trim(p_confirmation_no), '') = '' then raise exception 'ต้องระบุเลขที่ใบยืนยัน' using errcode = '23514'; end if;
  if coalesce(trim(p_customer_name), '') = '' then raise exception 'ต้องระบุชื่อลูกค้า' using errcode = '23514'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนต้องมากกว่า 0' using errcode = '23514'; end if;
  if p_due_date is null then raise exception 'ต้องระบุกำหนดส่ง' using errcode = '23514'; end if;
  if coalesce(p_spare_qty, 0) < 0 then raise exception 'จำนวนเผื่อเสียติดลบไม่ได้' using errcode = '23514'; end if;
  if p_needs_sample is null then
    raise exception 'ต้องเลือกว่างานนี้ขึ้นตัวอย่างหรือไม่ (ตามที่ตกลงกับลูกค้าในใบยืนยัน)' using errcode = '23514';
  end if;
  if not exists (select 1 from public.routes where code = p_route_code and active) then
    raise exception 'ไม่พบเส้นทางผลิต %', p_route_code using errcode = '23503';
  end if;
  if not exists (select 1 from public.product_types where code = p_product_type_code) then
    raise exception 'ไม่พบประเภทสินค้า %', p_product_type_code using errcode = '23503';
  end if;
  if exists (select 1 from public.jobs where confirmation_no = trim(p_confirmation_no)) then
    raise exception 'เลขที่ใบยืนยัน % รับเข้าระบบไปแล้ว', trim(p_confirmation_no) using errcode = '23505';
  end if;

  -- รูปม็อคอัพจากใบร่าง · รูปหาย/ผิดชนิด = ส่งงานเข้าได้ แอดมินเพิ่มรูปทีหลัง (ไม่ให้รูปขวางการรับงาน)
  select nullif(trim(d.data->>'mockup_path'), '') into v_mockup
  from public.confirmation_drafts d where d.confirmation_no = trim(p_confirmation_no) and d.status = 'draft';
  if v_mockup is not null and (lower(v_mockup) !~ '\.(jpe?g|png|webp)$' or not private.mockup_uploaded(v_mockup)) then
    v_mockup := null;
  end if;

  insert into public.jobs (confirmation_no, confirmation_rev, customer_name, job_name, product_type_code, qty, spare_qty,
                           unit, due_date, route_code, spec, confirmation_pdf_path, phase, needs_sample, created_by, mockup_path)
  values (trim(p_confirmation_no), coalesce(p_confirmation_rev, 0), trim(p_customer_name), trim(p_job_name), p_product_type_code,
          p_qty, coalesce(p_spare_qty, 0), p_unit, p_due_date, p_route_code, coalesce(p_spec, '{}'), v_pdf,
          'materials', p_needs_sample, auth.uid(), v_mockup)
  returning id into v_id;

  -- ไม่สร้างเช็คลิสต์วัตถุดิบ: แอดมินเตรียมของครบก่อนส่งงานเข้า → ปล่อยเข้าสถานีแรกทันที
  perform private.log(v_id, 'received', 'materials', null,
    jsonb_build_object('route', p_route_code, 'qty', p_qty, 'sample', p_needs_sample, 'pdf', v_pdf is not null, 'mockup', v_mockup is not null));
  -- ใบยืนยันที่บันทึกจากฟอร์มเข้าระบบไว้ (เลขที่ใบเดียวกัน) ถือว่าส่งงานเข้าแล้ว
  update public.confirmation_drafts set status = 'received', job_id = v_id, updated_at = now(), updated_by = auth.uid()
    where confirmation_no = trim(p_confirmation_no) and status = 'draft';
  perform private.release_if_ready(v_id);
  return v_id;
end $$;

-- j.* ใน view ขยายตอนสร้าง → สร้างใหม่ให้มี mockup_path (นิยามเดิมจาก 20261120000000 ไม่เปลี่ยน)
drop view public.job_live;
create view public.job_live with (security_invoker = true) as
select j.*,
  rs.station_code                                    as current_station,
  s.name                                             as current_station_name,
  private.last_seq(j.route_code)                     as last_seq,
  (select count(*) from public.job_materials m where m.job_id = j.id and m.checked_at is null)::int as materials_pending,
  (select array_agg(distinct m.dept) from public.job_materials m where m.job_id = j.id and m.checked_at is null) as materials_waiting_depts,
  (select i.reason from public.issues i where i.job_id = j.id and i.closed_at is null order by i.opened_at desc limit 1) as hold_reason,
  coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0)::int as qc_passed,
  private.sla_state_api(j.id)                        as sla
from public.jobs j
left join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq
left join public.stations s on s.code = rs.station_code;
revoke all on public.job_live from anon;
grant select on public.job_live to authenticated;
