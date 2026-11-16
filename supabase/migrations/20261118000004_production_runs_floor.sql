-- ฝ่ายผลิตคุมหน้างานทั้งหมด ตั้งแต่พิมพ์ถึง QC + Packing (ตัดสินใจ 16 พ.ย. บ่าย)
-- เดิมผู้ควบคุมงานเฟส 1 กับฝ่ายผลิตเป็นคนเดียวกันที่หน้างาน การแยก 2 บทบาททำให้คนเดียวต้องสลับบัญชี
-- จึงเลิกใช้บทบาทผู้ควบคุมงาน: ฝ่ายผลิตได้ทุกสิทธิ์ที่เคยเป็นของผู้ควบคุมงาน (รับงาน · กดทุกสถานีทุกเฟส ·
-- อนุมัติขั้นย่อย · เย็บ · QC · แก้ไขย้อนหลัง) · ฝ่าย QC ยังบันทึกผล QC ได้เหมือนเดิม · แอดมิน/ผู้บริหารยังกดสถานีไม่ได้

-- ตรวจสิทธิ์ที่จุดเดียว: ทุกฟังก์ชันที่เคยต้องการ 'supervisor' เรียก require_role อยู่แล้ว
-- ฝ่ายผลิตผ่านในนามผู้ควบคุมงานที่ไม่จำกัดเฟส (lock_job ตรวจเฟสเฉพาะ role = supervisor จึงไม่กระทบ)
-- ถ้าฟังก์ชันระบุ 'production' เองด้วย คืน 'production' ตามเดิม เพื่อให้กฎเฉพาะฝ่ายผลิต (เช่น กรอบเวลาซ่อม) ยังทำงาน
create or replace function private.require_role(variadic p_roles text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r text := private.my_role();
begin
  if r is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  if r = 'production' and 'supervisor' = any (p_roles) and not ('production' = any (p_roles)) then
    return 'supervisor';
  end if;
  if r <> 'owner' and not (r = any (p_roles)) then
    raise exception 'บทบาทของคุณ (%) ทำขั้นนี้ไม่ได้', r using errcode = '42501';
  end if;
  return r;
end $$;
revoke all on function private.require_role(text[]) from public, anon;

-- บัญชีผู้ควบคุมงานที่มีอยู่ (บัญชีทดสอบ) ย้ายเป็นฝ่ายผลิต · เฟสไม่ใช้แล้ว (ข้อบังคับ section ใช้กับผู้ควบคุมงานเท่านั้น)
update public.profiles set role = 'production', section = null where role = 'supervisor';
