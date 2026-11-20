-- งานที่ยกเลิกแล้ว: บันทึกได้รับฟิล์ม และแก้/ส่ง/อนุมัติ/ส่งกลับ/ทิ้งม็อคอัพไม่ได้ (ทุกคำสั่งม็อคอัพผ่าน mockup_lock_sheet)

create or replace function public.receive_film(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if not private.uses_film(j.route_code) then
    raise exception 'งานนี้ไม่ต้องสั่งฟิล์ม (เฉพาะงาน DTF / DTG / สกรีน)' using errcode = 'P0001';
  end if;
  if j.phase = 'cancelled' then perform private.stale('งานนี้ถูกยกเลิกแล้ว'); end if;
  if j.dtf_film_ordered_at is null then
    raise exception 'ยังไม่ได้บันทึกการสั่ง% ให้บันทึกการสั่งก่อน', private.film_label(j.route_code) using errcode = 'P0001';
  end if;
  if j.dtf_film_received_at is not null then perform private.stale('บันทึกรับฟิล์มไปแล้ว'); end if;
  update public.jobs set dtf_film_received_at = now() where id = p_job;
  perform private.log(p_job, 'film_received', j.phase, null);
end $$;

create or replace function private.mockup_lock_sheet(p_sheet uuid) returns public.mockup_sheets
language plpgsql security definer set search_path = '' as $$
declare s public.mockup_sheets;
begin
  select * into s from public.mockup_sheets where id = p_sheet for update;
  if not found then raise exception 'ไม่พบม็อคอัพฉบับนี้ (อาจถูกลบไปแล้ว) ให้โหลดหน้าใหม่' using errcode = 'P0002'; end if;
  if exists (select 1 from public.jobs where id = s.job_id and phase = 'cancelled') then
    raise exception 'งานนี้ถูกยกเลิกแล้ว แก้หรืออนุมัติม็อคอัพไม่ได้' using errcode = 'P0001';
  end if;
  return s;
end $$;
revoke all on function private.mockup_lock_sheet(uuid) from public, anon;
