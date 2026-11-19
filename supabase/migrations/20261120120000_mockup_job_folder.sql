-- รูปม็อคอัพต้องเป็นของงานนั้น (ตรวจโค้ด 19 พ.ย.): เดิม set_job_mockup รับ path รูปใดก็ได้ใน bucket
-- → ชี้งาน B ไปที่รูปของงาน A ได้ · หน้าเว็บเก็บรูปในโฟลเดอร์ตามเลขที่ใบ (data/mockups.ts mockupFolder) จึงตรวจโฟลเดอร์

-- โฟลเดอร์ของเลขที่ใบ: ตัวที่ไม่ใช่อังกฤษ/ตัวเลข/ขีด เป็น _ · ว่าง = job (ตรงกับ mockupFolder ในหน้าเว็บ)
create or replace function private.mockup_folder(p_no text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(regexp_replace(trim(p_no), '[^A-Za-z0-9-]', '_', 'g'), ''), 'job')
$$;
revoke all on function private.mockup_folder(text) from public, anon;

-- เหมือน 20261120110000 ทุกอย่าง เพิ่ม: รูปต้องอยู่ในโฟลเดอร์ของงานนี้
create or replace function public.set_job_mockup(p_job uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  perform private.check_mockup(p_path);
  if split_part(p_path, '/', 1) <> private.mockup_folder(j.confirmation_no) then
    raise exception 'รูปนี้ไม่ใช่ของงาน % ให้เลือกรูปจากรายละเอียดงานนี้อีกครั้ง', j.confirmation_no using errcode = '23514';
  end if;
  update public.jobs set mockup_path = p_path where id = p_job;
  perform private.log(p_job, 'mockup', j.phase, null,
    jsonb_build_object('path', p_path, 'replaced', j.mockup_path is not null));
end $$;
