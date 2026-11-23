-- ล้างข้อมูลทดสอบก่อนเปิดใช้จริง (อา. 22 พ.ย. 2569) · รันครั้งเดียว ไม่ใช่ migration
-- วิธีใช้: เจ้าของวางทั้งไฟล์ใน Supabase → SQL Editor แล้วกด Run · ผลสรุปขึ้นเป็นตารางท้ายสุด
-- ทดสอบใน supabase/tests/golive-cleanup.mjs (สร้างงาน TEST + งานจริงจำลอง แล้วตรวจว่าลบเฉพาะ TEST)
--
-- ทำอะไร
-- 1. ลบงานที่เลขใบยืนยันขึ้นต้น "TEST-" ทั้งงานพร้อมประวัติ (รวมงานแบ่ง TEST-…-2)
--    ตารางลูกทุกตาราง (events, issues, qc_results, outsource_runs, inbox_messages, …) ลบตามเองด้วย ON DELETE CASCADE
--    events ปกติห้ามลบ → ปิด trigger กันลบเฉพาะในธุรกรรมนี้ แล้วเปิดคืนก่อนจบ (ถ้ามี error ทุกอย่างย้อนกลับ trigger ยังเปิดอยู่)
-- 2. ลบใบร่างใบยืนยันของงานทดสอบ · ล้างบันทึกกันคำขอซ้ำ (private.rpc_requests ไม่มีข้อมูลงาน เก็บไว้ไม่มีประโยชน์)
-- 3. ปิดบัญชีทดสอบ @pp142.test (ไม่ลบ เพราะงานจริงอาจอ้างผู้ใช้เหล่านี้)
-- ไม่แตะ: งานจริง (รวมงานวันทดลอง ส. 21 ที่ใช้เลขใบจริง · เลขคิวเดิมทุกแถว) · บริษัทภายนอก · จักร · ตั้งค่า
-- ไฟล์ PDF ใน Storage ลบด้วย SQL ไม่ได้ → ตารางผลบอกชื่อไฟล์ที่ไม่มีงานใดใช้แล้ว ให้ลบเองที่ Storage → confirmations
-- 4. ไฟล์ใน R2 ที่ไม่มีงาน/ใบร่าง/ม็อคอัพอ้างแล้ว (อัปโหลดเกิน 1 ชม. กันไฟล์ที่กำลังกรอกฟอร์มอยู่) → ลบแถวจาก private.file_objects
--    แล้วตารางผลขั้น 7 ให้คำสั่ง wrangler ลบไฟล์จริงใน R2 (รันในเครื่องที่ล็อกอิน wrangler · ไม่ลบก็ได้ ไม่มีใครเปิดไฟล์นั้นได้แล้ว)

begin;

-- SQL Editor ของ Supabase ทิ้งตาราง on commit drop ก่อนแสดงผล → เก็บไว้จนจบ session แล้ว select หลัง commit
create temp table if not exists golive_summary (step int, item text, value text);
truncate golive_summary;

do $$
declare
  n_test int;
  n_real_before int;
  n_real_events_before int;
  n_drafts int;
  n_rpc int;
  n_users int;
  n_files int;
begin
  select count(*) into n_test from public.jobs where confirmation_no like 'TEST-%';
  select count(*) into n_real_before from public.jobs where confirmation_no not like 'TEST-%';
  select count(*) into n_real_events_before from public.events e
    where not exists (select 1 from public.jobs j where j.id = e.job_id and j.confirmation_no like 'TEST-%');

  -- 2. ใบร่างของงานทดสอบ (ลบก่อนลบงาน เพราะลบงานแล้ว job_id กลายเป็น null)
  delete from public.confirmation_drafts d
    where d.confirmation_no like 'TEST-%'
       or exists (select 1 from public.jobs j where j.id = d.job_id and j.confirmation_no like 'TEST-%');
  get diagnostics n_drafts = row_count;

  -- 1. งานทดสอบ
  alter table public.events disable trigger events_append_only;
  delete from public.jobs where confirmation_no like 'TEST-%';
  alter table public.events enable trigger events_append_only;

  -- ตรวจซ้ำ: ต้องไม่เหลืองาน TEST และงานจริง/ประวัติงานจริงต้องครบเท่าเดิม ไม่งั้นย้อนกลับทั้งหมด
  if exists (select 1 from public.jobs where confirmation_no like 'TEST-%') then
    raise exception 'ยังเหลืองาน TEST- · ยกเลิกการล้างทั้งหมด';
  end if;
  if (select count(*) from public.jobs) <> n_real_before then
    raise exception 'จำนวนงานจริงเปลี่ยน · ยกเลิกการล้างทั้งหมด';
  end if;
  if (select count(*) from public.events) <> n_real_events_before then
    raise exception 'ประวัติงานจริงเปลี่ยน · ยกเลิกการล้างทั้งหมด';
  end if;

  -- 2. บันทึกกันคำขอซ้ำ
  delete from private.rpc_requests;
  get diagnostics n_rpc = row_count;

  -- 3. บัญชีทดสอบ
  update public.profiles p set active = false
    from auth.users u
    where u.id = p.user_id and u.email like '%@pp142.test' and p.active;
  get diagnostics n_users = row_count;

  -- 4. ไฟล์ R2 ที่ไม่มีอะไรอ้าง
  with gone as (
    delete from private.file_objects f
    where f.uploaded_at < now() - interval '1 hour'
      and not (f.kind = 'confirmations' and exists (select 1 from public.jobs j where j.confirmation_pdf_path = f.path))
      and not (f.kind = 'mockups' and (
            exists (select 1 from public.jobs j where j.mockup_path = f.path)
            or exists (select 1 from public.mockup_views v where v.image_path = f.path)
            or exists (select 1 from public.jobs j where j.spec -> 'mockups' @> jsonb_build_array(jsonb_build_object('path', f.path)))
            or exists (select 1 from public.confirmation_drafts d where d.data ->> 'mockup_path' = f.path)
            or exists (select 1 from public.confirmation_drafts d where d.data -> 'mockups' @> jsonb_build_array(jsonb_build_object('path', f.path)))))
    returning f.kind, f.path
  )
  insert into golive_summary
  select 7, 'ลบไฟล์ใน R2 (คำสั่ง)', format('npx wrangler@4 r2 object delete "pp142-files/%s/%s" --remote', kind, path)
  from gone;
  get diagnostics n_files = row_count;

  insert into golive_summary values
    (1, 'ลบงานทดสอบ TEST- (งาน)', n_test::text),
    (1, 'งานจริงที่เหลือ (งาน)', n_real_before::text),
    (2, 'ลบใบร่างใบยืนยันทดสอบ (ใบ)', n_drafts::text),
    (2, 'ล้างบันทึกกันคำขอซ้ำ (แถว)', n_rpc::text),
    (4, 'ปิดบัญชี @pp142.test (บัญชี)', n_users::text),
    (4, 'ลบรายการไฟล์ R2 ที่ไม่มีงานอ้าง (ไฟล์)', n_files::text),
    (5, 'trigger กันลบประวัติ (events)',
       case when exists (select 1 from pg_trigger
                         where tgname = 'events_append_only' and tgrelid = 'public.events'::regclass
                           and tgenabled = 'O')
            then 'เปิดอยู่ (ถูกต้อง)' else 'ปิดอยู่ · ต้องแจ้ง Claude' end);

  -- ไฟล์ PDF ที่ไม่มีงานใดอ้างแล้ว (มีเฉพาะระบบจริง · ฐานทดสอบไม่มี storage)
  if to_regclass('storage.objects') is not null then
    execute $q$
      insert into golive_summary
      select 6, 'ลบเองที่ Storage → confirmations', o.name
      from storage.objects o
      where o.bucket_id = 'confirmations'
        and not exists (select 1 from public.jobs j where j.confirmation_pdf_path = o.name)
      order by o.name
    $q$;
    -- รูปม็อคอัพของงานทดสอบ (20261120110000) · รูปที่ใบร่างยังใช้อยู่ไม่นับ
    execute $q$
      insert into golive_summary
      select 6, 'ลบเองที่ Storage → mockups', o.name
      from storage.objects o
      where o.bucket_id = 'mockups'
        and not exists (select 1 from public.jobs j where j.mockup_path = o.name)
        and not exists (select 1 from public.confirmation_drafts d where d.data->>'mockup_path' = o.name)
        and not exists (select 1 from public.mockup_views v where v.image_path = o.name)
      order by o.name
    $q$;
  end if;
end $$;

commit;

select step as ขั้น, item as รายการ, value as ผล from golive_summary order by step, item, value;
