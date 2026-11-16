-- ผู้ควบคุมงาน 2 เฟส (docs/แผน-1-สัปดาห์.md หัวข้อ 1.3)
-- เฟส 1 = พิมพ์ · รีด · ตัด (รวมรีด DTF · ปัก · สกรีน) · เฟส 2 = เย็บ · QC + Packing
-- หน้างานมีคนบอกสถานะงาน 2 คน คนละเฟส · ต้องกันกดงานของอีกฝั่ง จึงบังคับที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม

alter table public.stations
  add column section smallint not null default 1 check (section in (1, 2));
-- ปัก / สกรีน ยังไม่อยู่ในเส้นทาง · ใส่เฟส 1 ไว้ก่อน (ตกแต่งชิ้นผ้าก่อนเย็บ) แก้ได้ที่หน้าตั้งค่า
update public.stations set section = 2 where code in ('sew', 'qc_pack');

-- null = ไม่จำกัดเฟส (หัวหน้าที่คุมแทนได้ทั้ง 2 เฟส) · เฟสมีความหมายกับผู้ควบคุมงานเท่านั้น
alter table public.profiles
  add column section smallint check (section in (1, 2)),
  add constraint profiles_section_supervisor_only check (section is null or role = 'supervisor');

-- ทุก RPC ที่กดงานเรียก lock_job ก่อนเสมอ จึงตรวจเฟสที่นี่ที่เดียว (ไม่ต้องแก้ฟังก์ชัน workflow ทีละตัว)
-- ตรวจเฉพาะตอนงานอยู่ในสถานี · ขั้นวัตถุดิบ / รอผลตัวอย่าง / เสร็จ ไม่มีเฟส
create or replace function private.lock_job(p_job uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  my_section smallint;
  st public.stations;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;

  if private.my_role() = 'supervisor' and j.phase in ('sample', 'production') and j.station_seq is not null then
    select p.section into my_section from public.profiles p where p.user_id = (select auth.uid());
    if my_section is not null then
      select s.* into st
      from public.route_stations rs join public.stations s on s.code = rs.station_code
      where rs.route_code = j.route_code and rs.seq = j.station_seq;
      if found and st.section <> my_section then
        raise exception 'งานนี้อยู่สถานี% (เฟส %) ให้ผู้ควบคุมงานเฟส % เป็นคนกด', st.name, st.section, st.section
          using errcode = '42501';
      end if;
    end if;
  end if;
  return j;
end $$;

-- แก้ไขย้อนหลังเป็นงานของหัวหน้า ไม่ผูกกับสถานีปัจจุบัน (งานอาจเดินไปเฟสอื่นแล้ว) จึงล็อกแถวเองโดยไม่ตรวจเฟส
create or replace function public.correct_event(p_job uuid, p_event_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  perform private.require_role('supervisor');
  perform 1 from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  select * into e from public.events where id = p_event_id and job_id = p_job;
  if not found then raise exception 'ไม่พบรายการที่ต้องการแก้' using errcode = 'P0002'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ต้องระบุเหตุผลการแก้ไข' using errcode = '23514'; end if;
  perform private.log(p_job, 'correction', e.phase, e.station_code,
    jsonb_build_object('event_id', p_event_id, 'event_type', e.type, 'reason', trim(p_reason)));
end $$;
