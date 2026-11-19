-- ปุ่ม "จัดจักร" ของฝ่ายผลิต (เจ้าของสั่ง 19 พ.ย. ก่อนทดลองจริง ส. 21)
-- จักรประจำไลน์ (จักรเดี่ยว) ทุกสินค้าตั้งไว้ 1 ตัว → งานใหญ่ต้องเพิ่มจักรได้ และคืนบางตัวไปช่วยงานด่วนได้
-- นิยามเดิมจาก 20261118000002_sewing_machines.sql + กฎใหม่ 3 ข้อ:
-- 1. จ่ายจักรเพิ่มได้เฉพาะงานที่กำลังเย็บ / พัก (ยังไม่เริ่ม = กดเริ่มเย็บ ระบบจ่ายชุดแรกให้เอง)
--    resume_sewing เรียกฟังก์ชันนี้ตอนงานพักอยู่ จึงยังทำงานเหมือนเดิม
-- 2. จักรใช้ร่วม (machine_types.shared) ทุกไลน์ใช้ได้อยู่แล้ว ห้ามผูกกับงาน ไม่งั้นงานอื่นเริ่มเย็บไม่ได้
-- 3. งานกำลังเย็บ คืนจักรจนเหลือไม่ครบชุดไม่ได้ (งานเย็บอยู่แต่ไม่มีจักร) · จะหยุดต้องพักงานก่อน
-- กดซ้ำ / อีกเครื่องกดไปก่อน = บอกว่าสถานะเปลี่ยนแล้ว ไม่บันทึกซ้ำ (กฎข้อ 11)

create or replace function public.assign_machines(p_job uuid, p_machine_codes text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; m public.sewing_machines; c text; busy text; codes text[]; type_name text; is_shared boolean;
begin
  perform private.require_sewing_supervisor();
  -- ตรวจสถานีก่อนล็อก เพื่อให้ข้อความบอกเรื่องจริง (ยังไม่ถึงเย็บ) ไม่ใช่เรื่องเฟส · ตรวจซ้ำหลังล็อกกันสถานะเปลี่ยนระหว่างทาง
  select * into j from public.jobs where id = p_job;
  if found and (j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew') then
    raise exception 'จ่ายจักรได้เฉพาะงานที่อยู่สถานีเย็บ' using errcode = 'P0001';
  end if;
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew' then
    perform private.stale('งานออกจากสถานีเย็บแล้ว');
  end if;
  if j.station_status is distinct from 'doing' and j.station_status is distinct from 'hold' then
    raise exception 'งานนี้ยังไม่เริ่มเย็บ กด "เริ่มเย็บ" ก่อน ระบบจ่ายจักรชุดแรกให้เอง แล้วค่อยเพิ่มจักร' using errcode = 'P0001';
  end if;
  -- รหัสเดียวกันพิมพ์ต่างกัน (ตัวเล็ก/เว้นวรรค/ซ้ำ) = จักรตัวเดียว
  select array_agg(distinct upper(trim(x))) into codes from unnest(p_machine_codes) x where trim(x) <> '';
  if coalesce(cardinality(codes), 0) = 0 then
    raise exception 'เลือกจักรอย่างน้อย 1 ตัว' using errcode = '23514';
  end if;
  foreach c in array codes loop
    select * into m from public.sewing_machines where code = c for update;
    if not found then raise exception 'ไม่พบจักรรหัส %', c using errcode = 'P0002'; end if;
    select t.name, t.shared into type_name, is_shared from public.machine_types t where t.code = m.type_code;
    if is_shared then
      raise exception 'จักร % เป็น% ที่ทุกไลน์ใช้ร่วมกันอยู่แล้ว ไม่ต้องจ่ายให้งาน', m.code, type_name using errcode = 'P0001';
    end if;
    if m.status <> 'ready' then
      raise exception 'จักร % % อยู่ จ่ายให้งานไม่ได้', m.code, case m.status when 'broken' then 'เสีย' else 'ปิดใช้งาน' end
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.job_id = p_job and a.released_at is null) then
      perform private.stale(format('จักร %s อยู่กับงานนี้แล้ว', m.code));
    end if;
    select jb.confirmation_no into busy from public.machine_assignments a join public.jobs jb on jb.id = a.job_id
      where a.machine_id = m.id and a.released_at is null;
    if found then
      raise exception 'จักร % ใช้กับงาน % อยู่ ต้องคืนจักรก่อน', m.code, busy using errcode = 'P0001';
    end if;
    busy := private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job);
    if busy is not null then
      raise exception 'จักร % จองให้ % อยู่ ใช้กับงานอื่นไม่ได้', m.code, busy using errcode = 'P0001';
    end if;
    insert into public.machine_assignments (machine_id, job_id, assigned_by) values (m.id, p_job, (select auth.uid()));
  end loop;
  perform private.log(p_job, 'machines_assigned', j.phase, 'sew', jsonb_build_object('machines', codes));
end $$;

-- คืนจักร (ไม่ระบุ = คืนทุกตัวของงานนี้)
create or replace function public.release_machines(p_job uuid, p_machine_codes text[] default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; codes text[]; short text;
begin
  perform private.require_sewing_supervisor();
  j := private.lock_job(p_job);
  with released as (
    update public.machine_assignments a set released_at = now(), released_by = (select auth.uid())
    from public.sewing_machines m
    where m.id = a.machine_id and a.job_id = p_job and a.released_at is null
      and (p_machine_codes is null or m.code = any (select upper(trim(x)) from unnest(p_machine_codes) x))
    returning m.code
  )
  select array_agg(code order by code) into codes from released;
  if codes is null and p_machine_codes is not null
     and exists (select 1 from public.machine_assignments a where a.job_id = p_job and a.released_at is null) then
    perform private.stale('จักรที่เลือกคืนไปแล้ว');
  end if;
  if codes is null then raise exception 'งานนี้ไม่มีจักรที่ต้องคืน' using errcode = 'P0001'; end if;
  -- กำลังเย็บ = ต้องเหลือจักรครบชุดของสินค้า (ยกเลิกทั้งคำขอ ไม่คืนบางตัว)
  if j.station_status = 'doing' then
    select string_agg(format('%s %s ตัว', t.name, s.short), ' · ' order by t.sort) into short
      from private.machines_short(p_job) s join public.machine_types t on t.code = s.type_code
      where s.short > 0;
    if short is not null then
      raise exception 'กำลังเย็บอยู่ คืนแล้วจักรจะไม่ครบชุด (ขาด %) · ถ้าจะหยุดเย็บให้กด "รายงานปัญหา" แล้วพักงานก่อน', short
        using errcode = 'P0001';
    end if;
  end if;
  perform private.log(p_job, 'machines_released', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('machines', codes));
end $$;
