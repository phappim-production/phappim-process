-- จักรเสีย 1 ตัวจากหลายตัวของงาน ไม่ต้องพักทั้งงาน (เจ้าของ 19 พ.ย. · ต่อจากจัดจักรแบบตั้งจำนวน 20261120090000)
-- เดิม: จักรที่ใช้อยู่เสีย/ปิด → พักงานทุกครั้ง · พองานใช้จักรได้หลายตัว คนหน้างานต้องกด "เย็บต่อ" ทุกครั้งที่จักรตัวเดียวเสีย
-- ใหม่: เอาจักรตัวนั้นออกจากงานเสมอ (บันทึก event พร้อมสาเหตุเหมือนเดิม) · พักงานเฉพาะเมื่อจักรที่เหลือไม่ครบชุดของสินค้า
-- นิยามเดิมจาก 20261118000002_sewing_machines.sql · เปลี่ยนเฉพาะเงื่อนไขพักงาน

create or replace function public.set_machine_status(p_machine_code text, p_status text, p_note text default null,
  p_repair_eta timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.sewing_machines; a public.machine_assignments; jb public.jobs; why text; held_job uuid; r text;
begin
  perform private.require_machine_reporter();
  r := private.my_role();
  if p_status not in ('ready', 'broken', 'off') then
    raise exception 'สถานะจักรต้องเป็น ใช้ได้ / เสีย / ปิดใช้งาน' using errcode = '23514';
  end if;
  select * into m from public.sewing_machines where code = upper(trim(p_machine_code)) for update;
  if not found then raise exception 'ไม่พบจักรรหัส %', p_machine_code using errcode = 'P0002'; end if;
  if p_status = 'broken' and coalesce(trim(p_note), '') = '' then
    raise exception 'แจ้งจักรเสียต้องบอกอาการ' using errcode = '23514';
  end if;
  if p_repair_eta is not null and p_status <> 'broken' then
    raise exception 'กรอบเวลาซ่อมใส่ได้เฉพาะตอนแจ้งเสีย' using errcode = '23514';
  end if;
  if p_repair_eta is not null and r not in ('production', 'owner') then
    raise exception 'กรอบเวลาซ่อมเป็นหน้าที่ของฝ่ายผลิต' using errcode = '42501';
  end if;
  if p_status = 'broken' and r = 'production' and p_repair_eta is null then
    raise exception 'ฝ่ายผลิตแจ้งเสียต้องกำหนดเวลาซ่อมเสร็จ' using errcode = '23514';
  end if;
  if p_repair_eta is not null then perform private.check_repair_eta(p_repair_eta); end if;
  -- กดซ้ำ / อีกคนกดไปก่อน (กฎข้อ 11)
  if m.status = p_status then
    perform private.stale(format('จักร %s %s อยู่แล้ว', m.code, case p_status when 'broken' then 'เสีย' when 'off' then 'ปิดใช้งาน' else 'ใช้ได้' end));
  end if;

  perform set_config('app.machine_status_rpc', 'on', true);
  update public.sewing_machines
    set status = p_status, note = case when p_status = 'ready' then null else nullif(trim(p_note), '') end,
        repair_eta = case when p_status = 'broken' then p_repair_eta end,
        status_changed_at = now(), status_changed_by = (select auth.uid())
    where id = m.id;
  perform set_config('app.machine_status_rpc', 'off', true);

  if p_status <> 'ready' then
    update public.machine_assignments set released_at = now(), released_by = (select auth.uid())
      where machine_id = m.id and released_at is null
      returning * into a;
    if found then
      held_job := a.job_id;
      select * into jb from public.jobs where id = a.job_id;
      perform private.log(jb.id, 'machines_released', jb.phase, 'sew',
        jsonb_build_object('machines', array[m.code], 'reason', case p_status when 'broken' then 'จักรเสีย' else 'ปิดใช้งาน' end,
                           'note', nullif(trim(p_note), '')));
      if jb.station_status = 'doing' and exists (select 1 from private.machines_short(jb.id) s where s.short > 0) then
        why := case p_status when 'broken' then format('จักร %s เสีย: %s', m.code, trim(p_note)) else format('จักร %s ปิดใช้งาน', m.code) end
          || coalesce(' · คาดว่าซ่อมเสร็จ ' || to_char(p_repair_eta at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'), '');
        perform public.open_issue(jb.id, why);
      end if;
    end if;
  end if;

  insert into public.machine_status_log (machine_id, status, note, job_id, repair_eta, by)
    values (m.id, p_status, nullif(trim(p_note), ''), held_job, p_repair_eta, (select auth.uid()));
end $$;
