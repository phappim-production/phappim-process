-- ชื่อพนักงานสำหรับไทม์ไลน์รายละเอียดงาน (S8): ทุกการกดบันทึกผู้กด (events.by) แต่ RLS ของ profiles
-- ให้คนทั่วไปเห็นแค่ profile ตัวเอง จึงเปิดเฉพาะ "ชื่อ" ผ่านฟังก์ชันนี้ ไม่เปิดอีเมล บทบาท หรือสถานะบัญชี
-- ชื่อไฟล์อยู่ก่อน 20261119100000 ที่จองให้ C2 ไว้ เพื่อให้ลำดับไฟล์ถูกไม่ว่างานไหน merge ก่อน

create or replace function public.staff_names() returns table (user_id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'ไม่มีสิทธิ์เข้าใช้งาน' using errcode = '42501';
  end if;
  return query select p.user_id, p.name from public.profiles p;
end $$;

revoke all on function public.staff_names() from public, anon;
grant execute on function public.staff_names() to authenticated;
