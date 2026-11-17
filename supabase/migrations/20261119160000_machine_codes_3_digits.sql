-- รหัสจักรเลขท้าย 3 หลัก (SN-001 … SN-014) · เจ้าของโปรเจกต์กำหนด 17 พ.ย. เผื่อเพิ่มจักรเกิน 99 ตัวต่อประเภท
-- และให้รหัสเรียงตามตัวอักษรถูกเสมอ (SN-002 มาก่อน SN-010)
-- ตารางอื่นอ้างจักรด้วย machine_id จึงเปลี่ยนรหัสได้โดยไม่กระทบ · ประวัติเดิมใน events ยังเป็นรหัสเก่า (events ห้ามแก้)

-- บังคับก่อนแปลง: เลขท้ายต้อง 3 หลักพอดี
create or replace function private.check_machine_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pre text;
begin
  new.code := upper(trim(new.code));
  select prefix into pre from public.machine_types where code = new.type_code;
  if new.code !~ ('^' || pre || '-[0-9]{3}$') then
    raise exception 'รหัสจักร % ไม่ตรงประเภทหรือรูปแบบ ต้องเป็น %-เลข 3 หลัก เช่น %-001', new.code, pre, pre using errcode = '23514';
  end if;
  return new;
end $$;

-- แปลงรหัสเดิม (เลข 2 หลัก) เป็น 3 หลัก · เลขเดิมไม่เปลี่ยน SN-01 → SN-001
update public.sewing_machines
set code = regexp_replace(code, '-([0-9]+)$', '') || '-' || lpad(substring(code from '-([0-9]+)$'), 3, '0')
where code ~ '-[0-9]{1,2}$';
