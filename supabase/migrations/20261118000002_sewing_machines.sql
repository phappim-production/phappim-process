-- จักรเย็บ (S14 · docs/แผน-1-สัปดาห์.md) · จักรทีละเครื่อง รหัสตามประเภท (OL4-01 …)
-- งานที่ถึงสถานีเย็บ = รอเย็บ · กด "เริ่มเย็บ" (start_sewing) ระบบเลือกจักรว่างครบทุกชนิดที่สินค้าต้องใช้
-- จักรใช้กับงานอื่นอยู่ / เสีย = เริ่มเย็บไม่ได้ ตามจริง (ตัดสินใจ 16 พ.ย.) · บังคับที่ฐานข้อมูลด้วย trigger บน jobs
-- จักร 1 ตัวใช้กับ 2 งานพร้อมกันไม่ได้ · จักรเสียจ่ายให้งานไม่ได้

-- ---------- 1. ข้อมูลตั้งค่า (owner แก้ได้) ----------
-- prefix = รหัสนำหน้าของประเภท · รหัสจักรทุกตัวต้องเป็น prefix-เลข เช่น OL4-01 (ตรงกับ MACHINE_PREFIX ใน app/src/proto/sewing.ts)
create table public.machine_types (
  code     text primary key,
  prefix   text not null unique check (prefix ~ '^[A-Z][A-Z0-9]{1,3}$'),
  name     text not null,
  used_for text,
  sort     int not null default 0
);
insert into public.machine_types (code, prefix, name, used_for, sort) values
  ('single',     'SN',  'เข็มเดี่ยว',        'เย็บทั่วไป ติดป้าย ติดกระเป๋า ป้ายผ้า ถุงผ้า', 10),
  ('double',     'DN',  'สองเข็ม',          'ทับตะเข็บสองแนว กางเกง เสื้อเชิ้ต', 20),
  ('ovl3',       'OL3', 'โพ้ง 3 เส้น',       'โพ้งขอบกันลุ่ย ป้ายผ้า ผ้าผืน', 30),
  ('ovl4',       'OL4', 'โพ้ง 4 เส้น',       'ประกอบเสื้อยืด/กีฬา เย็บไหล่ ข้าง ใต้แขน', 40),
  ('ovl5',       'OL5', 'โพ้ง 5 เส้น',       'ผ้าหนา ผ้าทอ กางเกง', 50),
  ('cover',      'CV',  'จักรลา',           'ลาแขน ลาชาย', 60),
  ('flat',       'FL',  'ลาคอ / ฟลัตล็อก',   'ทับคอ เสื้อกีฬาตะเข็บแบน', 70),
  ('button',     'BT',  'ติดกระดุม',         'โปโล เสื้อเชิ้ต กาวน์', 80),
  ('buttonhole', 'BH',  'เจาะรังดุม',        'โปโล เสื้อเชิ้ต กาวน์', 90),
  ('elastic',    'EL',  'ยางยืด',           'เอวกางเกง ชุดนอน กางเกงช้าง', 100),
  ('binding',    'BD',  'เข้าขอบ',          'ขอบป้าย ผ้ากันเปื้อน ริสแบนด์', 110);

-- จักรทีละเครื่อง · code คือรหัสที่ติดบนตัวจักร (หน้างานเรียกตามนี้)
create table public.sewing_machines (
  id                bigint generated always as identity primary key,
  code              text not null unique check (code ~ '^[A-Z0-9-]{1,10}$'),
  type_code         text not null references public.machine_types(code),
  status            text not null default 'ready' check (status in ('ready', 'broken', 'off')),
  note              text,
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users(id),
  sort              int not null default 0
);
create index sewing_machines_type_idx on public.sewing_machines (type_code);

-- รหัสต้องขึ้นต้นด้วย prefix ของประเภท · หน้างานดูรหัสแล้วรู้ทันทีว่าเป็นจักรอะไร
create or replace function private.check_machine_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pre text;
begin
  new.code := upper(trim(new.code));
  select prefix into pre from public.machine_types where code = new.type_code;
  if new.code !~ ('^' || pre || '-[0-9]{2,3}$') then
    raise exception 'รหัสจักร % ไม่ตรงประเภท ต้องเป็น %-เลข 2 หลัก เช่น %-01', new.code, pre, pre using errcode = '23514';
  end if;
  return new;
end $$;
create trigger sewing_machines_code before insert or update of code, type_code on public.sewing_machines
  for each row execute function private.check_machine_code();
create index sewing_machines_changed_by_idx on public.sewing_machines (status_changed_by);

-- สินค้า 1 งานต้องใช้จักรชนิดใด กี่ตัวพร้อมกัน (ร่างจาก PP-SOP-01 ST-05 · ตรงกับ app/src/proto/sewing.ts)
-- สินค้าที่ไม่มีแถว = ยังไม่รู้ หน้าเว็บจะบอกว่า "ยังไม่มีข้อมูลจักร" ไม่เดา
create table public.product_machine_needs (
  product_type_code text not null references public.product_types(code) on delete cascade,
  type_code         text not null references public.machine_types(code),
  qty               int  not null default 1 check (qty > 0),
  primary key (product_type_code, type_code)
);
create index product_machine_needs_type_idx on public.product_machine_needs (type_code);
insert into public.product_machine_needs (product_type_code, type_code, qty)
select p.code, n.type_code, n.qty
from (values
  ('tee', 'ovl4', 2), ('tee', 'cover', 1), ('tee', 'flat', 1), ('tee', 'single', 1),
  ('shirt', 'ovl4', 1), ('shirt', 'single', 1), ('shirt', 'double', 1), ('shirt', 'button', 1), ('shirt', 'buttonhole', 1),
  ('jacket', 'ovl4', 1), ('jacket', 'single', 1), ('jacket', 'cover', 1), ('jacket', 'elastic', 1),
  ('pants', 'ovl4', 1), ('pants', 'elastic', 1), ('pants', 'cover', 1),
  ('flat', 'ovl3', 1), ('flat', 'single', 1),
  ('edge', 'single', 1), ('edge', 'binding', 1),
  ('bag', 'single', 1), ('bag', 'ovl4', 1), ('bag', 'double', 1),
  ('spun', 'single', 1)
) as n(grp, type_code, qty)
join (values
  ('tshirt','tee'),('sport','tee'),('running','tee'),('worker','tee'),('pe','tee'),('mourning','tee'),('kids','tee'),('pet','tee'),
  ('polo','shirt'),('gown','shirt'),('student','shirt'),('hawaii','shirt'),
  ('jacket','jacket'),
  ('elephant','pants'),('muaythai','pants'),('pajama','pants'),('scrub','pants'),
  ('banner','flat'),('yan','flat'),('cheer','flat'),('scarf','flat'),('glasses','flat'),('blanket','flat'),
  ('apron','edge'),('wristband','edge'),('lanyard','edge'),
  ('bag','bag'),('foldable','bag'),('sachet','bag'),('spunbond','spun')
) as p(code, grp) on p.grp = n.grp;

-- ---------- 2. การจ่ายจักร (เขียนผ่าน RPC เท่านั้น) ----------
create table public.machine_assignments (
  id          bigint generated always as identity primary key,
  machine_id  bigint not null references public.sewing_machines(id),
  job_id      uuid   not null references public.jobs(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id),
  released_at timestamptz,
  released_by uuid references auth.users(id)
);
-- จักร 1 ตัวผูกกับงานได้ทีละ 1 งาน
create unique index machine_assignments_active_uq on public.machine_assignments (machine_id) where released_at is null;
create index machine_assignments_machine_idx on public.machine_assignments (machine_id);
create index machine_assignments_job_idx on public.machine_assignments (job_id) where released_at is null;
create index machine_assignments_job_all_idx on public.machine_assignments (job_id);
create index machine_assignments_by_idx on public.machine_assignments (assigned_by);
create index machine_assignments_released_by_idx on public.machine_assignments (released_by);

-- ---------- 3. ฟังก์ชัน ----------
create or replace function private.my_section() returns smallint
language sql stable security definer set search_path = '' as $$
  select p.section from public.profiles p where p.user_id = (select auth.uid()) and p.active
$$;

-- จักรเย็บเป็นงานของเฟส 2 · ผู้ควบคุมงานเฟส 1 ดูได้ แต่จ่าย/คืน/เปลี่ยนสถานะจักรไม่ได้
create or replace function private.require_sewing_supervisor() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role('supervisor');
  if private.my_role() = 'supervisor' and private.my_section() = 1 then
    raise exception 'จักรเย็บเป็นงานของเฟส 2 ให้ผู้ควบคุมงานเฟส 2 เป็นคนจ่ายจักร' using errcode = '42501';
  end if;
end $$;

-- แจ้งเสีย / ซ่อมเสร็จ: ฝ่ายผลิตแจ้งได้ด้วย เพราะคนหน้างานเจอจักรเสียก่อน (ตัดสินใจ 16 พ.ย.)
-- ผู้ควบคุมงานเฟส 1 ยังทำไม่ได้ (จักรเย็บเป็นของเฟส 2) · จ่าย/คืนจักรและเริ่มเย็บยังเป็นของผู้ควบคุมงานเฟส 2
create or replace function private.require_machine_reporter() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role('supervisor', 'production');
  if private.my_role() = 'supervisor' and private.my_section() = 1 then
    raise exception 'จักรเย็บเป็นงานของเฟส 2 ให้ผู้ควบคุมงานเฟส 2 หรือฝ่ายผลิตแจ้ง' using errcode = '42501';
  end if;
end $$;

-- จ่ายจักรให้งานที่อยู่สถานีเย็บ · จักรต้องใช้ได้และว่าง
create or replace function public.assign_machines(p_job uuid, p_machine_codes text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; m public.sewing_machines; c text; busy text;
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
  if coalesce(cardinality(p_machine_codes), 0) = 0 then
    raise exception 'เลือกจักรอย่างน้อย 1 ตัว' using errcode = '23514';
  end if;
  foreach c in array p_machine_codes loop
    select * into m from public.sewing_machines where code = upper(trim(c)) for update;
    if not found then raise exception 'ไม่พบจักรรหัส %', c using errcode = 'P0002'; end if;
    if m.status <> 'ready' then
      raise exception 'จักร % % อยู่ จ่ายให้งานไม่ได้', m.code, case m.status when 'broken' then 'เสีย' else 'ปิดใช้งาน' end
        using errcode = 'P0001';
    end if;
    select jb.confirmation_no into busy from public.machine_assignments a join public.jobs jb on jb.id = a.job_id
      where a.machine_id = m.id and a.released_at is null;
    if found then
      raise exception 'จักร % ใช้กับงาน % อยู่ ต้องคืนจักรก่อน', m.code, busy using errcode = 'P0001';
    end if;
    insert into public.machine_assignments (machine_id, job_id, assigned_by) values (m.id, p_job, (select auth.uid()));
  end loop;
  perform private.log(p_job, 'machines_assigned', j.phase, 'sew', jsonb_build_object('machines', p_machine_codes));
end $$;

-- คืนจักร (ไม่ระบุ = คืนทุกตัวของงานนี้)
create or replace function public.release_machines(p_job uuid, p_machine_codes text[] default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; codes text[];
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
  if codes is null then raise exception 'งานนี้ไม่มีจักรที่ต้องคืน' using errcode = 'P0001'; end if;
  perform private.log(p_job, 'machines_released', j.phase, private.station_at(j.route_code, j.station_seq),
    jsonb_build_object('machines', codes));
end $$;

-- ประวัติสถานะจักร (ใครแจ้ง เมื่อไร อาการอะไร) · เพิ่มอย่างเดียวผ่าน set_machine_status · ใช้ดูว่าจักรตัวไหนเสียบ่อย
create table public.machine_status_log (
  id         bigint generated always as identity primary key,
  machine_id bigint not null references public.sewing_machines(id) on delete cascade,
  status     text   not null check (status in ('ready', 'broken', 'off')),
  note       text,
  job_id     uuid references public.jobs(id) on delete set null,   -- งานที่ใช้จักรอยู่ตอนแจ้ง (ถ้ามี)
  by         uuid references auth.users(id),
  at         timestamptz not null default now()
);
create index machine_status_log_machine_idx on public.machine_status_log (machine_id, at);
create index machine_status_log_job_idx on public.machine_status_log (job_id);
create index machine_status_log_by_idx on public.machine_status_log (by);

-- แจ้งจักรเสีย / ปิดใช้งาน / ซ่อมเสร็จ (ใช้ได้) · ผู้ควบคุมงานเฟส 2 · ทุกเฟส · ฝ่ายผลิต · owner
-- จักรที่เสียระหว่างเย็บ: คืนจากงานอัตโนมัติ และถ้างานกำลังเย็บอยู่ → พักงานอัตโนมัติพร้อมสาเหตุ (เย็บต่อได้เมื่อจักรครบ)
create or replace function public.set_machine_status(p_machine_code text, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.sewing_machines; a public.machine_assignments; jb public.jobs; why text; held_job uuid;
begin
  perform private.require_machine_reporter();
  if p_status not in ('ready', 'broken', 'off') then
    raise exception 'สถานะจักรต้องเป็น ใช้ได้ / เสีย / ปิดใช้งาน' using errcode = '23514';
  end if;
  select * into m from public.sewing_machines where code = upper(trim(p_machine_code)) for update;
  if not found then raise exception 'ไม่พบจักรรหัส %', p_machine_code using errcode = 'P0002'; end if;
  if p_status = 'broken' and coalesce(trim(p_note), '') = '' then
    raise exception 'แจ้งจักรเสียต้องบอกอาการ' using errcode = '23514';
  end if;
  -- กดซ้ำ / อีกคนกดไปก่อน (กฎข้อ 11)
  if m.status = p_status then
    perform private.stale(format('จักร %s %s อยู่แล้ว', m.code, case p_status when 'broken' then 'เสีย' when 'off' then 'ปิดใช้งาน' else 'ใช้ได้' end));
  end if;

  perform set_config('app.machine_status_rpc', 'on', true);
  update public.sewing_machines
    set status = p_status, note = case when p_status = 'ready' then null else nullif(trim(p_note), '') end,
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
      if jb.station_status = 'doing' then
        why := case p_status when 'broken' then format('จักร %s เสีย: %s', m.code, trim(p_note)) else format('จักร %s ปิดใช้งาน', m.code) end;
        perform public.open_issue(jb.id, why);
      end if;
    end if;
  end if;

  insert into public.machine_status_log (machine_id, status, note, job_id, by)
    values (m.id, p_status, nullif(trim(p_note), ''), held_job, (select auth.uid()));
end $$;

-- สถานะจักรเปลี่ยนได้ทางฟังก์ชันเท่านั้น (owner แก้ตารางตรงได้เฉพาะรหัส/ประเภท/ลำดับ)
-- ไม่อย่างนั้นแก้ตรงเป็น "เสีย" จะข้ามการคืนจักร พักงาน และประวัติ
create or replace function private.guard_machine_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('app.machine_status_rpc', true), '') <> 'on' then
    raise exception 'เปลี่ยนสถานะจักรผ่านปุ่ม "แจ้งเสีย" / "ซ่อมเสร็จ" เท่านั้น' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger sewing_machines_status_guard before update of status on public.sewing_machines
  for each row execute function private.guard_machine_status();

-- ---------- จองจักรเป็นวัน-เวลา (ตัดสินใจ 16 พ.ย.) ----------
-- เลือกงาน + ช่วงเวลา → ระบบจองจักรครบทุกชนิดตามสินค้า · จักรตัวเดียวกันจองทับช่วงเวลากันไม่ได้
-- ช่วงที่งานอื่นจองไว้ งานอื่นกดเริ่มเย็บด้วยจักรนั้นไม่ได้ · ยกเลิกได้ · งานออกจากเย็บ = คืนช่วงที่เหลือ
create table public.machine_bookings (
  id           bigint generated always as identity primary key,
  machine_id   bigint not null references public.sewing_machines(id) on delete cascade,
  job_id       uuid   not null references public.jobs(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  booked_by    uuid references auth.users(id),
  booked_at    timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  check (ends_at > starts_at)
);
create index machine_bookings_machine_idx on public.machine_bookings (machine_id, starts_at);
create index machine_bookings_job_idx on public.machine_bookings (job_id);
create index machine_bookings_by_idx on public.machine_bookings (booked_by);
create index machine_bookings_cancel_by_idx on public.machine_bookings (cancelled_by);

-- ช่วงเวลาที่จองอยู่ (ไม่ยกเลิก) ของจักรตัวนี้ ทับกับ [p_from, p_to) ไหม · ไม่นับการจองของงาน p_except
create or replace function private.booked_by_other(p_machine bigint, p_from timestamptz, p_to timestamptz, p_except uuid)
returns text language sql stable security definer set search_path = '' as $$
  select jb.confirmation_no || ' ' || to_char(b.starts_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI')
         || '–' || to_char(b.ends_at at time zone 'Asia/Bangkok', 'HH24:MI')
  from public.machine_bookings b join public.jobs jb on jb.id = b.job_id
  where b.machine_id = p_machine and b.cancelled_at is null and b.job_id is distinct from p_except
    and b.starts_at < p_to and b.ends_at > p_from
  order by b.starts_at limit 1
$$;

create or replace function public.book_machines(p_job uuid, p_starts timestamptz, p_ends timestamptz) returns text[]
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n record; got bigint[]; picked text[] := '{}'; why text; problems text[] := '{}'; now_start boolean;
begin
  perform private.require_sewing_supervisor();
  -- ล็อกแถวงานตรงๆ (ไม่ใช้ lock_job) เพราะงานที่จองล่วงหน้ามักยังอยู่สถานีเฟส 1
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase in ('done', 'cancelled') then raise exception 'งานนี้เสร็จแล้ว จองจักรไม่ได้' using errcode = 'P0001'; end if;
  -- ผลิตจริงที่ผ่านเย็บไปแล้ว (อยู่ QC) ไม่ต้องใช้จักรอีก · ตัวอย่างที่อยู่ QC ยังต้องเย็บตอนผลิตจริง จึงจองได้
  if j.phase = 'production' and private.station_at(j.route_code, j.station_seq) = 'qc_pack' then
    raise exception 'งานนี้เย็บเสร็จแล้ว จองจักรไม่ได้' using errcode = 'P0001';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    raise exception 'เวลาจบต้องหลังเวลาเริ่ม' using errcode = '23514';
  end if;
  if p_ends <= now() then raise exception 'ช่วงเวลานี้ผ่านไปแล้ว เลือกเวลาใหม่' using errcode = '23514'; end if;
  if p_ends - p_starts > interval '14 days' then raise exception 'จองได้ครั้งละไม่เกิน 14 วัน' using errcode = '23514'; end if;
  if extract(isodow from p_starts at time zone 'Asia/Bangkok') = 7 then
    raise exception 'วันอาทิตย์โรงงานหยุด เลือกวันเริ่มใหม่' using errcode = '23514';
  end if;
  if exists (select 1 from public.machine_bookings where job_id = p_job and cancelled_at is null and ends_at > now()) then
    raise exception 'งานนี้จองจักรไว้แล้ว ยกเลิกการจองเดิมก่อนจองใหม่' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.product_machine_needs where product_type_code = j.product_type_code) then
    raise exception 'ยังไม่มีข้อมูลว่าสินค้านี้ใช้จักรอะไร ให้เจ้าของระบบใส่ในหน้าตั้งค่า' using errcode = 'P0001';
  end if;
  now_start := p_starts <= now();

  for n in select pmn.type_code, pmn.qty, mt.name from public.product_machine_needs pmn
           join public.machine_types mt on mt.code = pmn.type_code
           where pmn.product_type_code = j.product_type_code order by mt.sort loop
    select array_agg(id order by code) into got from (
      select m.id, m.code from public.sewing_machines m
      where m.type_code = n.type_code and m.status = 'ready'
        and private.booked_by_other(m.id, p_starts, p_ends, null) is null
        -- จองเริ่มทันที: จักรต้องไม่ติดงานอื่นอยู่ตอนนี้
        and not (now_start and exists (select 1 from public.machine_assignments a
                                      where a.machine_id = m.id and a.released_at is null and a.job_id <> p_job))
      order by m.code limit n.qty for update of m) free;
    if coalesce(cardinality(got), 0) < n.qty then
      select string_agg(m.code || ' ' || coalesce(
               case when m.status = 'broken' then 'เสีย' when m.status = 'off' then 'ปิด' end,
               'จองให้ ' || private.booked_by_other(m.id, p_starts, p_ends, null),
               'ใช้กับ ' || (select jb.confirmation_no from public.machine_assignments a join public.jobs jb on jb.id = a.job_id
                             where a.machine_id = m.id and a.released_at is null)), ', ' order by m.code)
        into why
        from public.sewing_machines m
        where m.type_code = n.type_code
          and (m.status <> 'ready' or private.booked_by_other(m.id, p_starts, p_ends, null) is not null
               or (now_start and exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null and a.job_id <> p_job)));
      problems := problems || format('%s ขาด %s ตัว%s', n.name, n.qty - coalesce(cardinality(got), 0),
                                     case when why is null then ' (ยังไม่มีจักรประเภทนี้)' else ' (' || why || ')' end);
    else
      insert into public.machine_bookings (machine_id, job_id, starts_at, ends_at, booked_by)
        select unnest(got), p_job, p_starts, p_ends, (select auth.uid());
      picked := picked || (select array_agg(code order by code) from public.sewing_machines where id = any (got));
    end if;
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'จองไม่ได้ ช่วงเวลานี้จักรไม่พอ: %', array_to_string(problems, ' · ') using errcode = 'P0001';
  end if;
  -- กันจองชนจากการกดพร้อมกัน 2 เครื่อง: ตรวจซ้ำหลังบันทึก (กฎข้อ 11)
  if exists (select 1 from public.machine_bookings b
             where b.job_id = p_job and b.cancelled_at is null
               and private.booked_by_other(b.machine_id, b.starts_at, b.ends_at, p_job) is not null) then
    perform private.stale('มีคนจองจักรช่วงนี้ไปก่อน');
  end if;
  picked := (select array_agg(c order by c) from unnest(picked) c);
  perform private.log(p_job, 'machines_booked', j.phase, 'sew',
    jsonb_build_object('machines', picked, 'starts_at', p_starts, 'ends_at', p_ends));
  return picked;
end $$;

-- ยกเลิกการจองที่ยังไม่หมดเวลา · ช่วงที่กำลังใช้อยู่ = ตัดจบที่ตอนนี้ (ประวัติไม่หาย)
create or replace function public.cancel_booking(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n int;
begin
  perform private.require_sewing_supervisor();
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  update public.machine_bookings set cancelled_at = now(), cancelled_by = (select auth.uid())
    where job_id = p_job and cancelled_at is null and starts_at > now();
  get diagnostics n = row_count;
  update public.machine_bookings set ends_at = now()
    where job_id = p_job and cancelled_at is null and starts_at <= now() and ends_at > now();
  if n = 0 and not found then raise exception 'งานนี้ไม่มีการจองที่ยกเลิกได้' using errcode = 'P0001'; end if;
  perform private.log(p_job, 'booking_cancelled', j.phase, null, '{}'::jsonb);
end $$;

-- จักรที่งานนี้ยังขาด (ชนิด → จำนวน) เทียบสูตรของสินค้ากับจักรที่จ่ายให้งานอยู่
create or replace function private.machines_short(p_job uuid) returns table (type_code text, short int)
language sql stable security definer set search_path = '' as $$
  select n.type_code, n.qty - coalesce((
    select count(*)::int from public.machine_assignments a join public.sewing_machines m on m.id = a.machine_id
    where a.job_id = p_job and a.released_at is null and m.type_code = n.type_code), 0)
  from public.jobs j join public.product_machine_needs n on n.product_type_code = j.product_type_code
  where j.id = p_job
$$;

-- กด "เริ่มเย็บ": เลือกจักรว่างตามรหัสให้ครบทุกชนิดที่สินค้าต้องใช้ แล้วเริ่มสถานีเย็บในคำสั่งเดียว
-- ขาดจักร = ปฏิเสธทั้งคำสั่ง บอกว่าติดที่จักรตัวไหน (ใช้กับงานอื่น / เสีย / ปิด)
create or replace function public.start_sewing(p_job uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n record; got bigint[]; picked text[] := '{}'; why text; problems text[] := '{}';
begin
  perform private.require_sewing_supervisor();
  select * into j from public.jobs where id = p_job;
  if found and (j.phase not in ('sample', 'production') or private.station_at(j.route_code, j.station_seq) is distinct from 'sew') then
    raise exception 'งานนี้ยังไม่ถึงสถานีเย็บ' using errcode = 'P0001';
  end if;
  j := private.lock_job(p_job);
  if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อนเริ่มต่อ' using errcode = 'P0001'; end if;
  if j.station_status = 'doing' then perform private.stale('เริ่มเย็บไปแล้ว'); end if;
  if not exists (select 1 from public.product_machine_needs where product_type_code = j.product_type_code) then
    raise exception 'ยังไม่มีข้อมูลว่าสินค้านี้ใช้จักรอะไร ให้เจ้าของระบบใส่ในหน้าตั้งค่า' using errcode = 'P0001';
  end if;

  for n in select pmn.type_code, pmn.qty, mt.name from public.product_machine_needs pmn
           join public.machine_types mt on mt.code = pmn.type_code
           where pmn.product_type_code = j.product_type_code order by mt.sort loop
    select array_agg(id order by code) into got from (
      select m.id, m.code from public.sewing_machines m
      where m.type_code = n.type_code and m.status = 'ready'
        and not exists (select 1 from public.machine_assignments a where a.machine_id = m.id and a.released_at is null)
        and private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is null
      -- จักรที่งานนี้จองไว้มาก่อน
      order by exists (select 1 from public.machine_bookings b where b.machine_id = m.id and b.job_id = p_job
                       and b.cancelled_at is null and b.ends_at > now()) desc, m.code
      limit n.qty for update of m) free;
    if coalesce(cardinality(got), 0) < n.qty then
      select string_agg(m.code || case when m.status = 'broken' then ' เสีย' when m.status = 'off' then ' ปิด'
                                       when a.id is not null then ' ใช้กับ ' || coalesce(jb.confirmation_no, 'งานอื่น')
                                       else ' จองให้ ' || private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) end,
                        ', ' order by m.code)
        into why
        from public.sewing_machines m
        left join public.machine_assignments a on a.machine_id = m.id and a.released_at is null
        left join public.jobs jb on jb.id = a.job_id
        where m.type_code = n.type_code
          and (m.status <> 'ready' or a.id is not null
               or private.booked_by_other(m.id, now(), now() + interval '1 minute', p_job) is not null);
      problems := problems || format('%s ขาด %s ตัว%s', n.name, n.qty - coalesce(cardinality(got), 0),
                                     case when why is null then ' (ยังไม่มีจักรประเภทนี้)' else ' (' || why || ')' end);
    else
      insert into public.machine_assignments (machine_id, job_id, assigned_by)
        select unnest(got), p_job, (select auth.uid());
      picked := picked || (select array_agg(code order by code) from public.sewing_machines where id = any (got));
    end if;
  end loop;

  if cardinality(problems) > 0 then
    raise exception 'จักรไม่ว่าง เริ่มเย็บไม่ได้: %', array_to_string(problems, ' · ') using errcode = 'P0001';
  end if;
  picked := (select array_agg(c order by c) from unnest(picked) c);
  perform private.log(p_job, 'machines_assigned', j.phase, 'sew', jsonb_build_object('machines', picked));
  perform public.start_station(p_job);
  return picked;
end $$;

-- บังคับ "ตามจริง": สถานีเย็บจะเป็น "กำลังทำ" ได้ต่อเมื่อจักรที่จ่ายให้งานครบตามสูตร (ทุกทางที่เปลี่ยนสถานะ รวมกดแก้แล้วหลังพักงาน)
-- ยังไม่ได้ใส่จักรเข้าระบบเลย = ไม่บังคับ (ช่วงเริ่มใช้งานก่อนนับจักรเสร็จ งานยังเดินได้)
create or replace function private.require_machines_to_sew() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lack text;
begin
  if new.station_status = 'doing' and old.station_status is distinct from 'doing'
     and new.phase in ('sample', 'production') and private.station_at(new.route_code, new.station_seq) = 'sew'
     and exists (select 1 from public.sewing_machines) then
    if not exists (select 1 from public.product_machine_needs where product_type_code = new.product_type_code) then
      if not exists (select 1 from public.machine_assignments where job_id = new.id and released_at is null) then
        raise exception 'เริ่มเย็บต้องมีจักรอย่างน้อย 1 ตัว ให้จ่ายจักรก่อน' using errcode = 'P0001';
      end if;
    else
      select string_agg(mt.name || ' ' || s.short || ' ตัว', ' · ') into lack
        from private.machines_short(new.id) s join public.machine_types mt on mt.code = s.type_code where s.short > 0;
      if lack is not null then
        raise exception 'จักรไม่ครบ เย็บต่อไม่ได้: ขาด % · กด "เริ่มเย็บ" ให้ระบบเลือกจักรว่าง หรือรอจักรว่าง', lack
          using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger jobs_require_machines before update of station_status on public.jobs
  for each row execute function private.require_machines_to_sew();

-- งานออกจากสถานีเย็บ (เสร็จ · ส่งต่อ QC) → คืนจักรทุกตัวอัตโนมัติ ไม่ต้องรอคนกดคืน
-- พักงานไม่คืน (ช่างยังอยู่กับงาน) · ถ้าจะย้ายจักรไปงานอื่นให้กดคืนเอง
create or replace function private.release_machines_on_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.station_at(old.route_code, old.station_seq) = 'sew'
     and (new.phase not in ('sample', 'production') or private.station_at(new.route_code, new.station_seq) is distinct from 'sew') then
    update public.machine_assignments set released_at = now(), released_by = (select auth.uid())
      where job_id = new.id and released_at is null;
    -- เย็บเสร็จก่อนเวลาที่จอง = คืนช่วงที่เหลือให้งานอื่นจองต่อ
    update public.machine_bookings set ends_at = now()
      where job_id = new.id and cancelled_at is null and starts_at <= now() and ends_at > now();
    update public.machine_bookings set cancelled_at = now(), cancelled_by = (select auth.uid())
      where job_id = new.id and cancelled_at is null and starts_at > now();
  end if;
  return new;
end $$;
create trigger jobs_release_machines after update of station_seq, phase on public.jobs
  for each row execute function private.release_machines_on_leave();

-- ---------- 4. สิทธิ์ ----------
alter table public.machine_types         enable row level security;
alter table public.sewing_machines       enable row level security;
alter table public.product_machine_needs enable row level security;
alter table public.machine_assignments   enable row level security;
alter table public.machine_status_log    enable row level security;
alter table public.machine_bookings      enable row level security;
do $$
declare t text;
begin
  foreach t in array array['machine_types', 'sewing_machines', 'product_machine_needs', 'machine_assignments', 'machine_status_log', 'machine_bookings'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.my_role()) is not null)', t||'_read', t);
  end loop;
  -- จักรแต่ละตัว (เพิ่ม/ลบ/แก้รหัส) และสูตรจักรของสินค้า เป็นข้อมูลตั้งค่าของ owner · สถานะจักรเปลี่ยนผ่าน set_machine_status
  foreach t in array array['machine_types', 'sewing_machines', 'product_machine_needs'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_owner()))', t||'_owner_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()))', t||'_owner_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_owner()))', t||'_owner_delete', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.book_machines(uuid,timestamptz,timestamptz)', 'public.cancel_booking(uuid)', 'public.start_sewing(uuid)', 'public.assign_machines(uuid,text[])', 'public.release_machines(uuid,text[])',
                           'public.set_machine_status(text,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.my_section() from public, anon;
revoke all on function private.require_sewing_supervisor() from public, anon;
revoke all on function private.require_machine_reporter() from public, anon;
revoke all on function private.release_machines_on_leave() from public, anon;
revoke all on function private.check_machine_code() from public, anon;
revoke all on function private.guard_machine_status() from public, anon;
revoke all on function private.booked_by_other(bigint,timestamptz,timestamptz,uuid) from public, anon;
revoke all on function private.machines_short(uuid) from public, anon;
revoke all on function private.require_machines_to_sew() from public, anon;

-- ---------- 5. Realtime ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sewing_machines, public.machine_assignments, public.machine_status_log, public.machine_bookings;
  end if;
end $$;
