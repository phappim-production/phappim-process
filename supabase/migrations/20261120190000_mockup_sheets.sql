-- ม็อคอัพกำกับสเปก: ภาพหลายมุม + Callout + สเปกเพิ่มเติม ต่องาน · ฉบับร่าง → รออนุมัติ → อนุมัติแล้ว (ห้ามแก้) → ถูกแทนที่
-- ของเพิ่มอย่างเดียว ไม่แก้ตาราง/ฟังก์ชัน workflow เดิม · อนุมัติ = เจ้าของ / ผู้บริหาร / ฝ่ายผลิต · แอดมินทำร่าง

create table public.mockup_sheets (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs(id) on delete cascade,
  rev             int  not null check (rev > 0),
  status          text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'superseded')),
  version         int  not null default 1,
  based_on        uuid references public.mockup_sheets(id) on delete set null,
  confirmation_rev int,
  change_reason   text,
  return_reason   text,
  approve_note    text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  submitted_by    uuid references auth.users(id) on delete set null,
  submitted_at    timestamptz,
  approved_by     uuid references auth.users(id) on delete set null,
  approved_at     timestamptz,
  unique (job_id, rev)
);
create unique index mockup_sheets_one_open on public.mockup_sheets (job_id) where status in ('draft', 'pending');
create unique index mockup_sheets_one_approved on public.mockup_sheets (job_id) where status = 'approved';
create index mockup_sheets_based_on_idx on public.mockup_sheets (based_on);
create index mockup_sheets_created_by_idx on public.mockup_sheets (created_by);
create index mockup_sheets_updated_by_idx on public.mockup_sheets (updated_by);
create index mockup_sheets_submitted_by_idx on public.mockup_sheets (submitted_by);
create index mockup_sheets_approved_by_idx on public.mockup_sheets (approved_by);

create table public.mockup_views (
  id         uuid primary key default gen_random_uuid(),
  sheet_id   uuid not null references public.mockup_sheets(id) on delete cascade,
  view       text not null check (view in ('front', 'back', 'left', 'right', 'detail')),
  image_path text not null,
  width      int  not null check (width > 0),
  height     int  not null check (height > 0),
  unique (sheet_id, view)
);

create table public.mockup_specs (
  id           uuid primary key default gen_random_uuid(),
  sheet_id     uuid not null references public.mockup_sheets(id) on delete cascade,
  code         text not null,
  name         text not null,
  kind         text not null default 'print' check (kind in ('print', 'embroidery', 'sewing', 'material', 'label', 'other')),
  position     text,
  detail       text,
  width        numeric check (width > 0),
  height       numeric check (height > 0),
  unit         text not null default 'cm' check (unit in ('cm', 'mm', 'in')),
  color        text,
  color_code   text,
  material     text,
  method       text,
  artwork_ref  text,
  note         text,
  stations     text[] not null default '{}',
  unique (sheet_id, code)
);

create table public.mockup_callouts (
  id        uuid primary key default gen_random_uuid(),
  sheet_id  uuid not null references public.mockup_sheets(id) on delete cascade,
  view_id   uuid not null references public.mockup_views(id) on delete cascade,
  no        int  not null check (no > 0),
  x         numeric not null check (x between 0 and 1),
  y         numeric not null check (y between 0 and 1),
  box_x     numeric not null check (box_x between 0 and 1),
  box_y     numeric not null check (box_y between 0 and 1),
  title     text not null,
  body      text,
  spec_ref  text check (spec_ref ~ '^(placement|field):.+$'),
  ref_value text,
  spec_id   uuid references public.mockup_specs(id) on delete set null,
  stations  text[] not null default '{}',
  unique (sheet_id, no)
);
create index mockup_callouts_view_idx on public.mockup_callouts (view_id);
create index mockup_callouts_spec_idx on public.mockup_callouts (spec_id);

create table public.mockup_snapshots (
  sheet_id   uuid primary key references public.mockup_sheets(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

create table public.mockup_acks (
  id           bigint generated always as identity primary key,
  sheet_id     uuid not null references public.mockup_sheets(id) on delete cascade,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  rev          int  not null,
  user_id      uuid references auth.users(id) on delete set null,
  station_code text not null references public.stations(code),
  at           timestamptz not null default now(),
  unique (sheet_id, user_id, station_code)
);
create index mockup_acks_job_idx on public.mockup_acks (job_id);
create index mockup_acks_user_idx on public.mockup_acks (user_id);
create index mockup_acks_station_idx on public.mockup_acks (station_code);

-- ฉบับที่อนุมัติแล้วแก้/ลบตรงไม่ได้ · ลบตามงาน (cascade จากการลบงาน TEST-) ผ่านได้เพราะ trigger ซ้อนชั้น
create or replace function private.mockup_sheet_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.status in ('approved', 'superseded') then
      raise exception 'ม็อคอัพฉบับ % อนุมัติแล้ว ลบไม่ได้', old.rev using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'superseded' then
    raise exception 'ม็อคอัพฉบับ % ถูกแทนที่แล้ว แก้ไม่ได้', old.rev using errcode = '42501';
  end if;
  if old.status = 'approved' and (new.status <> 'superseded'
      or (new.job_id, new.rev, new.approved_by, new.approved_at, new.confirmation_rev, new.change_reason, new.created_by)
         is distinct from (old.job_id, old.rev, old.approved_by, old.approved_at, old.confirmation_rev, old.change_reason, old.created_by)) then
    raise exception 'ม็อคอัพฉบับ % อนุมัติแล้ว แก้ไม่ได้ ให้สร้างฉบับแก้ไขใหม่', old.rev using errcode = '42501';
  end if;
  return new;
end $$;
create trigger mockup_sheets_guard before update or delete on public.mockup_sheets
  for each row execute function private.mockup_sheet_guard();

create or replace function private.mockup_part_guard() returns trigger
language plpgsql set search_path = '' as $$
declare s text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  select status into s from public.mockup_sheets where id = coalesce(new.sheet_id, old.sheet_id);
  if s in ('approved', 'superseded') then
    raise exception 'ม็อคอัพฉบับนี้อนุมัติแล้ว แก้ภาพ / Callout / สเปกไม่ได้' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger mockup_views_guard before insert or update or delete on public.mockup_views
  for each row execute function private.mockup_part_guard();
create trigger mockup_specs_guard before insert or update or delete on public.mockup_specs
  for each row execute function private.mockup_part_guard();
create trigger mockup_callouts_guard before insert or update or delete on public.mockup_callouts
  for each row execute function private.mockup_part_guard();

create or replace function private.mockup_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  raise exception '% เป็นบันทึกแบบเพิ่มอย่างเดียว ห้ามแก้หรือลบ', tg_table_name using errcode = '42501';
end $$;
create trigger mockup_snapshots_append_only before update or delete on public.mockup_snapshots
  for each row execute function private.mockup_append_only();
create trigger mockup_acks_append_only before update or delete on public.mockup_acks
  for each row execute function private.mockup_append_only();

-- staff เห็นเฉพาะงานที่เส้นทางผ่านสถานีที่จับคู่ · QC / staff เห็นเฉพาะฉบับที่อนุมัติ
create or replace function private.mockup_visible(p_job uuid, p_status text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r text := private.my_role();
begin
  if r is null then return false; end if;
  if r in ('owner', 'manager', 'admin', 'production', 'supervisor') then return true; end if;
  if p_status not in ('approved', 'superseded') then return false; end if;
  if r = 'qc' then return true; end if;
  return r = 'staff' and exists (
    select 1 from public.jobs j
    join public.route_stations rs on rs.route_code = j.route_code
    join public.staff_stations ss on ss.station_code = rs.station_code
    where j.id = p_job and ss.user_id = (select auth.uid()));
end $$;

create or replace function private.mockup_station_ok(p_stations text[]) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is distinct from 'staff' or cardinality(p_stations) = 0 then return true; end if;
  return exists (select 1 from public.staff_stations ss
    where ss.user_id = (select auth.uid()) and ss.station_code = any (p_stations));
end $$;
revoke all on function private.mockup_visible(uuid, text) from public, anon;
revoke all on function private.mockup_station_ok(text[]) from public, anon;
grant execute on function private.mockup_visible(uuid, text) to authenticated;
grant execute on function private.mockup_station_ok(text[]) to authenticated;

alter table public.mockup_sheets enable row level security;
alter table public.mockup_views enable row level security;
alter table public.mockup_specs enable row level security;
alter table public.mockup_callouts enable row level security;
alter table public.mockup_snapshots enable row level security;
alter table public.mockup_acks enable row level security;

-- หัวฉบับ (เลขฉบับ สถานะ) เห็นได้ทุกสถานะเพื่อเตือนหน้างานว่ามีฉบับแก้ไขรออยู่ · ภาพ / Callout / สเปกของร่างเห็นเฉพาะคนทำและคนอนุมัติ
create policy mockup_sheets_read on public.mockup_sheets for select to authenticated
  using ((select private.mockup_visible(job_id, 'approved')));
create policy mockup_views_read on public.mockup_views for select to authenticated
  using (exists (select 1 from public.mockup_sheets s where s.id = sheet_id and private.mockup_visible(s.job_id, s.status)));
create policy mockup_specs_read on public.mockup_specs for select to authenticated
  using ((select private.mockup_station_ok(stations))
    and exists (select 1 from public.mockup_sheets s where s.id = sheet_id and private.mockup_visible(s.job_id, s.status)));
create policy mockup_callouts_read on public.mockup_callouts for select to authenticated
  using ((select private.mockup_station_ok(stations))
    and exists (select 1 from public.mockup_sheets s where s.id = sheet_id and private.mockup_visible(s.job_id, s.status)));
create policy mockup_snapshots_read on public.mockup_snapshots for select to authenticated
  using ((select private.my_role()) in ('owner', 'manager', 'admin', 'production', 'supervisor'));
create policy mockup_acks_read on public.mockup_acks for select to authenticated
  using ((select private.my_role()) is not null);

revoke all on public.mockup_sheets, public.mockup_views, public.mockup_specs, public.mockup_callouts,
  public.mockup_snapshots, public.mockup_acks from anon;
grant select on public.mockup_sheets, public.mockup_views, public.mockup_specs, public.mockup_callouts,
  public.mockup_snapshots, public.mockup_acks to authenticated;

-- ค่าจากใบยืนยัน: placement:<ตำแหน่ง> = เทคนิค · ขนาด · หมายเหตุ ของจุดที่ติ๊ก · field:<ช่อง> = ค่าช่องนั้นของสินค้า
create or replace function private.mockup_ref_value(p_spec jsonb, p_ref text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  base jsonb := coalesce(p_spec, '{}'::jsonb) -> 'p' -> (p_spec ->> 'product');
  x jsonb; methods text[]; tech text;
begin
  if base is null or p_ref is null then return null; end if;
  if p_ref like 'placement:%' then
    x := base -> 'placements' -> substr(p_ref, 11);
    if x is null or coalesce(x ->> 'on', 'false') <> 'true' then return null; end if;
    tech := nullif(trim(x ->> 'tech'), '');
    if tech is null and jsonb_typeof(base -> 'print_method') = 'array' then
      select array_agg(m) into methods from jsonb_array_elements_text(base -> 'print_method') m where m !~ 'ไม่มีลาย';
      if cardinality(methods) = 1 then tech := methods[1]; end if;
    end if;
    return nullif(concat_ws(' · ', tech,
      case when nullif(trim(x ->> 'size'), '') is not null then trim(x ->> 'size') || ' ซม.' end,
      nullif(trim(x ->> 'note'), '')), '');
  end if;
  if p_ref like 'field:%' then
    x := base -> substr(p_ref, 7);
    if x is null then return null; end if;
    if jsonb_typeof(x) = 'array' then
      return nullif((select string_agg(trim(v), ', ') from jsonb_array_elements_text(x) v where trim(v) <> ''), '');
    end if;
    if jsonb_typeof(x) in ('string', 'number', 'boolean') then return nullif(trim(x #>> '{}'), ''); end if;
  end if;
  return null;
end $$;
revoke all on function private.mockup_ref_value(jsonb, text) from public, anon;

create or replace function private.mockup_lock_sheet(p_sheet uuid) returns public.mockup_sheets
language plpgsql security definer set search_path = '' as $$
declare s public.mockup_sheets;
begin
  select * into s from public.mockup_sheets where id = p_sheet for update;
  if not found then raise exception 'ไม่พบม็อคอัพฉบับนี้ (อาจถูกลบไปแล้ว) ให้โหลดหน้าใหม่' using errcode = 'P0002'; end if;
  return s;
end $$;
revoke all on function private.mockup_lock_sheet(uuid) from public, anon;

create or replace function private.mockup_check_version(s public.mockup_sheets, p_version int) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_version is distinct from s.version then
    raise exception 'มีคนบันทึกม็อคอัพฉบับนี้ไปก่อนแล้ว กด "โหลดใหม่" เพื่อดูฉบับล่าสุดก่อนแก้ต่อ' using errcode = '40001';
  end if;
end $$;
revoke all on function private.mockup_check_version(public.mockup_sheets, int) from public, anon;

create or replace function public.start_mockup_sheet(p_job uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs; open_sheet public.mockup_sheets; base public.mockup_sheets;
  v_id uuid; v_rev int; v_reason text := nullif(trim(p_reason), '');
begin
  perform private.require_role('admin');
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  if j.phase = 'cancelled' then raise exception 'งานนี้ถูกยกเลิกแล้ว' using errcode = 'P0001'; end if;
  select * into open_sheet from public.mockup_sheets where job_id = p_job and status in ('draft', 'pending');
  if found then
    raise exception 'งานนี้มีม็อคอัพฉบับ % ที่ยังไม่อนุมัติอยู่แล้ว เปิดฉบับนั้นแก้ต่อ', open_sheet.rev using errcode = '23505';
  end if;
  select * into base from public.mockup_sheets where job_id = p_job and status = 'approved';
  if found and v_reason is null then
    raise exception 'ใส่เหตุผลที่ต้องแก้ม็อคอัพฉบับ % ที่อนุมัติแล้ว', base.rev using errcode = '23514';
  end if;
  select coalesce(max(rev), 0) + 1 into v_rev from public.mockup_sheets where job_id = p_job;
  insert into public.mockup_sheets (job_id, rev, based_on, change_reason, created_by, updated_by)
  values (p_job, v_rev, base.id, v_reason, (select auth.uid()), (select auth.uid()))
  returning id into v_id;
  if base.id is not null then
    with vm as (select v.id as old_id, gen_random_uuid() as new_id from public.mockup_views v where v.sheet_id = base.id),
    sm as (select sp.id as old_id, gen_random_uuid() as new_id from public.mockup_specs sp where sp.sheet_id = base.id),
    iv as (
      insert into public.mockup_views (id, sheet_id, view, image_path, width, height)
      select vm.new_id, v_id, v.view, v.image_path, v.width, v.height
      from public.mockup_views v join vm on vm.old_id = v.id
      returning id),
    isp as (
      insert into public.mockup_specs (id, sheet_id, code, name, kind, position, detail, width, height, unit, color, color_code,
        material, method, artwork_ref, note, stations)
      select sm.new_id, v_id, sp.code, sp.name, sp.kind, sp.position, sp.detail, sp.width, sp.height, sp.unit, sp.color, sp.color_code,
        sp.material, sp.method, sp.artwork_ref, sp.note, sp.stations
      from public.mockup_specs sp join sm on sm.old_id = sp.id
      returning id)
    insert into public.mockup_callouts (sheet_id, view_id, no, x, y, box_x, box_y, title, body, spec_ref, spec_id, stations)
    select v_id, vm.new_id, c.no, c.x, c.y, c.box_x, c.box_y, c.title, c.body, c.spec_ref, sm.new_id, c.stations
    from public.mockup_callouts c
    join vm on vm.old_id = c.view_id
    left join sm on sm.old_id = c.spec_id
    where c.sheet_id = base.id;
    insert into public.events (job_id, type, phase, station_code, payload, by)
    values (p_job, 'mockup_revision', j.phase, null, jsonb_build_object('rev', v_rev, 'from_rev', base.rev, 'reason', v_reason), (select auth.uid()));
  end if;
  return v_id;
end $$;

-- บันทึกทั้งชุดในครั้งเดียว: views [{view,image_path,width,height}] · specs [{key,code,name,...}] · callouts [{view,no,x,y,box_x,box_y,title,body,spec_ref,spec_key,stations}]
create or replace function public.save_mockup_draft(p_sheet uuid, p_version int, p_data jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  s public.mockup_sheets; j public.jobs; folder text;
  v jsonb; sp jsonb; c jsonb; v_view_id uuid; v_spec_id uuid; bad text;
  spec_ids jsonb := '{}'::jsonb; view_ids jsonb := '{}'::jsonb;
begin
  perform private.require_role('admin');
  s := private.mockup_lock_sheet(p_sheet);
  if s.status <> 'draft' then
    raise exception 'ม็อคอัพฉบับ % ไม่ใช่ฉบับร่างแล้ว แก้ไม่ได้', s.rev using errcode = '42501';
  end if;
  perform private.mockup_check_version(s, p_version);
  select * into j from public.jobs where id = s.job_id;
  folder := private.mockup_folder(j.confirmation_no);
  if jsonb_typeof(p_data -> 'views') is distinct from 'array' or jsonb_typeof(p_data -> 'callouts') is distinct from 'array'
     or jsonb_typeof(coalesce(p_data -> 'specs', '[]'::jsonb)) <> 'array' then
    raise exception 'ข้อมูลม็อคอัพไม่ครบ ให้โหลดหน้าใหม่แล้วลองอีกครั้ง' using errcode = '22023';
  end if;
  if jsonb_array_length(p_data -> 'views') > 5 or jsonb_array_length(p_data -> 'callouts') > 60
     or jsonb_array_length(coalesce(p_data -> 'specs', '[]'::jsonb)) > 60 then
    raise exception 'ม็อคอัพ 1 ฉบับมีภาพได้ไม่เกิน 5 มุม · Callout และสเปกไม่เกิน 60 รายการ' using errcode = '22023';
  end if;
  select string_agg(x, ', ') into bad from (
    select distinct unnest(coalesce(array(select jsonb_array_elements_text(e -> 'stations')), '{}')) x
    from jsonb_array_elements(coalesce(p_data -> 'specs', '[]'::jsonb) || (p_data -> 'callouts')) e) t
  where not exists (select 1 from public.stations st where st.code = t.x);
  if bad is not null then raise exception 'ไม่พบสถานี % ให้เลือกสถานีจากรายการ', bad using errcode = '23503'; end if;
  if exists (select 1 from jsonb_array_elements(p_data -> 'views') e where e ->> 'view' not in ('front', 'back', 'left', 'right', 'detail')) then
    raise exception 'มุมภาพต้องเป็น ด้านหน้า / ด้านหลัง / ด้านซ้าย / ด้านขวา / รายละเอียด' using errcode = '23514';
  end if;
  select string_agg(distinct e ->> 'code', ', ') into bad from jsonb_array_elements(coalesce(p_data -> 'specs', '[]'::jsonb)) e
  group by trim(e ->> 'code') having count(*) > 1;
  if bad is not null then raise exception 'รหัสสเปก % ซ้ำกัน ให้ใช้รหัสไม่ซ้ำ', bad using errcode = '23505'; end if;
  select string_agg(e ->> 'no', ', ') into bad from jsonb_array_elements(p_data -> 'callouts') e
  where jsonb_typeof(e -> 'no') <> 'number' or (e ->> 'no')::numeric < 1
     or jsonb_typeof(e -> 'x') <> 'number' or jsonb_typeof(e -> 'y') <> 'number'
     or jsonb_typeof(e -> 'box_x') <> 'number' or jsonb_typeof(e -> 'box_y') <> 'number'
     or (e ->> 'x')::numeric not between 0 and 1 or (e ->> 'y')::numeric not between 0 and 1
     or (e ->> 'box_x')::numeric not between 0 and 1 or (e ->> 'box_y')::numeric not between 0 and 1;
  if bad is not null then raise exception 'ตำแหน่ง Callout % อยู่นอกภาพ ให้ลากกลับเข้ามาในภาพ', bad using errcode = '23514'; end if;
  if (select count(*) <> count(distinct e ->> 'no') from jsonb_array_elements(p_data -> 'callouts') e) then
    raise exception 'เลข Callout ซ้ำกัน ให้โหลดหน้าใหม่แล้วลองอีกครั้ง' using errcode = '23505';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_data -> 'specs', '[]'::jsonb)) e
             where coalesce(e ->> 'kind', 'print') not in ('print', 'embroidery', 'sewing', 'material', 'label', 'other')
                or coalesce(e ->> 'unit', 'cm') not in ('cm', 'mm', 'in')
                or (e ? 'width' and jsonb_typeof(e -> 'width') not in ('number', 'null'))
                or (e ? 'height' and jsonb_typeof(e -> 'height') not in ('number', 'null'))
                or coalesce((e ->> 'width')::numeric, 1) <= 0 or coalesce((e ->> 'height')::numeric, 1) <= 0) then
    raise exception 'ประเภท หน่วย หรือขนาดของสเปกไม่ถูกต้อง (ขนาดต้องเป็นตัวเลขมากกว่า 0)' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(p_data -> 'callouts') e
             where nullif(e ->> 'spec_ref', '') is not null and e ->> 'spec_ref' !~ '^(placement|field):.+$') then
    raise exception 'Callout อ้างช่องในใบยืนยันผิดรูปแบบ ให้เลือกจากรายการ' using errcode = '23514';
  end if;

  delete from public.mockup_callouts where sheet_id = p_sheet;
  delete from public.mockup_specs where sheet_id = p_sheet;
  delete from public.mockup_views where sheet_id = p_sheet;

  for v in select * from jsonb_array_elements(p_data -> 'views') loop
    perform private.check_mockup(v ->> 'image_path');
    if split_part(v ->> 'image_path', '/', 1) <> folder then
      raise exception 'รูปนี้ไม่ใช่ของงาน % ให้อัปโหลดรูปจากหน้านี้อีกครั้ง', j.confirmation_no using errcode = '23514';
    end if;
    if view_ids ? (v ->> 'view') then
      raise exception 'มีภาพมุมเดียวกันซ้ำ ให้เหลือมุมละ 1 ภาพ' using errcode = '23505';
    end if;
    insert into public.mockup_views (sheet_id, view, image_path, width, height)
    values (p_sheet, v ->> 'view', v ->> 'image_path', (v ->> 'width')::int, (v ->> 'height')::int)
    returning id into v_view_id;
    view_ids := view_ids || jsonb_build_object(v ->> 'view', v_view_id);
  end loop;

  for sp in select * from jsonb_array_elements(coalesce(p_data -> 'specs', '[]'::jsonb)) loop
    if nullif(trim(sp ->> 'name'), '') is null or nullif(trim(sp ->> 'code'), '') is null then
      raise exception 'สเปกทุกรายการต้องมีรหัสและชื่อ' using errcode = '23514';
    end if;
    insert into public.mockup_specs (sheet_id, code, name, kind, position, detail, width, height, unit, color, color_code,
      material, method, artwork_ref, note, stations)
    values (p_sheet, trim(sp ->> 'code'), trim(sp ->> 'name'), coalesce(nullif(sp ->> 'kind', ''), 'print'),
      nullif(trim(sp ->> 'position'), ''), nullif(trim(sp ->> 'detail'), ''),
      nullif(sp ->> 'width', '')::numeric, nullif(sp ->> 'height', '')::numeric, coalesce(nullif(sp ->> 'unit', ''), 'cm'),
      nullif(trim(sp ->> 'color'), ''), nullif(trim(sp ->> 'color_code'), ''), nullif(trim(sp ->> 'material'), ''),
      nullif(trim(sp ->> 'method'), ''), nullif(trim(sp ->> 'artwork_ref'), ''), nullif(trim(sp ->> 'note'), ''),
      coalesce(array(select jsonb_array_elements_text(sp -> 'stations')), '{}'))
    returning id into v_spec_id;
    spec_ids := spec_ids || jsonb_build_object(coalesce(sp ->> 'key', sp ->> 'code'), v_spec_id);
  end loop;

  for c in select * from jsonb_array_elements(p_data -> 'callouts') loop
    if not view_ids ? (c ->> 'view') then
      raise exception 'Callout % อยู่บนภาพที่ไม่มีในฉบับนี้', c ->> 'no' using errcode = '23503';
    end if;
    if nullif(trim(c ->> 'title'), '') is null then
      raise exception 'Callout % ต้องมีชื่อจุด เช่น คอเสื้อ อกซ้าย', c ->> 'no' using errcode = '23514';
    end if;
    if c ? 'spec_key' and c ->> 'spec_key' is not null and not spec_ids ? (c ->> 'spec_key') then
      raise exception 'Callout % อ้างสเปกที่ไม่มีในฉบับนี้', c ->> 'no' using errcode = '23503';
    end if;
    insert into public.mockup_callouts (sheet_id, view_id, no, x, y, box_x, box_y, title, body, spec_ref, spec_id, stations)
    values (p_sheet, (view_ids ->> (c ->> 'view'))::uuid, (c ->> 'no')::int, (c ->> 'x')::numeric, (c ->> 'y')::numeric,
      (c ->> 'box_x')::numeric, (c ->> 'box_y')::numeric, left(trim(c ->> 'title'), 80), nullif(trim(c ->> 'body'), ''),
      nullif(c ->> 'spec_ref', ''), (spec_ids ->> (c ->> 'spec_key'))::uuid,
      coalesce(array(select jsonb_array_elements_text(c -> 'stations')), '{}'));
  end loop;

  update public.mockup_sheets set version = version + 1, updated_by = (select auth.uid()), updated_at = now(), return_reason = null
  where id = p_sheet;
  return s.version + 1;
end $$;

create or replace function public.discard_mockup_draft(p_sheet uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.mockup_sheets;
begin
  perform private.require_role('admin');
  s := private.mockup_lock_sheet(p_sheet);
  if s.status <> 'draft' then
    raise exception 'ทิ้งได้เฉพาะฉบับร่าง (ฉบับ % ส่งอนุมัติแล้ว ให้ผู้อนุมัติส่งกลับก่อน)', s.rev using errcode = '42501';
  end if;
  delete from public.mockup_sheets where id = p_sheet;
end $$;

create or replace function public.submit_mockup_sheet(p_sheet uuid, p_version int) returns int
language plpgsql security definer set search_path = '' as $$
declare s public.mockup_sheets; missing text;
begin
  perform private.require_role('admin');
  s := private.mockup_lock_sheet(p_sheet);
  if s.status <> 'draft' then
    raise exception 'ม็อคอัพฉบับ % ส่งอนุมัติไปแล้ว', s.rev using errcode = '42501';
  end if;
  perform private.mockup_check_version(s, p_version);
  if not exists (select 1 from public.mockup_views where sheet_id = p_sheet and view = 'front') then
    raise exception 'ต้องมีภาพด้านหน้าก่อนส่งอนุมัติ' using errcode = '23514';
  end if;
  select string_agg(no::text, ', ' order by no) into missing from public.mockup_callouts
  where sheet_id = p_sheet and spec_ref is null and spec_id is null and nullif(trim(body), '') is null;
  if missing is not null then
    raise exception 'Callout % ยังไม่มีสเปกหรือข้อความ ใส่ก่อนส่งอนุมัติ', missing using errcode = '23514';
  end if;
  update public.mockup_sheets set status = 'pending', version = version + 1, submitted_by = (select auth.uid()),
    submitted_at = now(), return_reason = null
  where id = p_sheet;
  return s.version + 1;
end $$;

create or replace function public.return_mockup_sheet(p_sheet uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.mockup_sheets;
begin
  perform private.require_role('manager', 'production');
  s := private.mockup_lock_sheet(p_sheet);
  if s.status <> 'pending' then
    raise exception 'ม็อคอัพฉบับ % ไม่ได้รออนุมัติ', s.rev using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'ใส่เหตุผลที่ส่งกลับให้แอดมินแก้' using errcode = '23514';
  end if;
  update public.mockup_sheets set status = 'draft', version = version + 1, return_reason = trim(p_reason) where id = p_sheet;
end $$;

create or replace function public.approve_mockup_sheet(p_sheet uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.mockup_sheets; j public.jobs; prev public.mockup_sheets; started boolean; bad text; snap jsonb;
begin
  perform private.require_role('manager', 'production');
  select * into j from public.jobs where id = (select job_id from public.mockup_sheets where id = p_sheet) for update;
  s := private.mockup_lock_sheet(p_sheet);
  if s.status <> 'pending' then
    raise exception 'ม็อคอัพฉบับ % ไม่ได้รออนุมัติ', s.rev using errcode = '42501';
  end if;
  if exists (select 1 from public.mockup_sheets where job_id = s.job_id and status in ('approved', 'superseded') and rev > s.rev) then
    raise exception 'ม็อคอัพฉบับ % เก่ากว่าฉบับที่อนุมัติแล้ว อนุมัติทับไม่ได้', s.rev using errcode = '40001';
  end if;
  select * into prev from public.mockup_sheets where job_id = s.job_id and status = 'approved';
  started := j.phase in ('production', 'done')
    or exists (select 1 from public.events e where e.job_id = j.id and e.type = 'station_start');
  if prev.id is not null and started and private.my_role() not in ('owner', 'manager') then
    raise exception 'งานนี้เริ่มผลิตแล้ว ฉบับแก้ไขต้องให้ผู้บริหารหรือเจ้าของอนุมัติ' using errcode = '42501';
  end if;
  select string_agg(c.no::text, ', ' order by c.no) into bad from public.mockup_callouts c
  where c.sheet_id = p_sheet and c.spec_ref is not null and private.mockup_ref_value(j.spec, c.spec_ref) is null;
  if bad is not null then
    raise exception 'Callout % อ้างช่องในใบยืนยันที่ไม่มีข้อมูลแล้ว ส่งกลับให้แอดมินแก้', bad using errcode = '23514';
  end if;
  update public.mockup_callouts c set ref_value = private.mockup_ref_value(j.spec, c.spec_ref)
  where c.sheet_id = p_sheet and c.spec_ref is not null;

  if prev.id is not null then
    update public.mockup_sheets set status = 'superseded' where id = prev.id;
  end if;
  update public.mockup_sheets set status = 'approved', version = version + 1, approved_by = (select auth.uid()),
    approved_at = now(), approve_note = nullif(trim(p_note), ''), confirmation_rev = j.confirmation_rev
  where id = p_sheet;

  select jsonb_build_object(
    'job', jsonb_build_object('id', j.id, 'confirmation_no', j.confirmation_no, 'confirmation_rev', j.confirmation_rev,
      'customer_name', j.customer_name, 'job_name', j.job_name, 'qty', j.qty, 'unit', j.unit, 'due_date', j.due_date),
    'rev', s.rev, 'approved_by', (select auth.uid()), 'approved_at', now(), 'note', nullif(trim(p_note), ''),
    'views', coalesce((select jsonb_agg(to_jsonb(v) order by v.view) from public.mockup_views v where v.sheet_id = p_sheet), '[]'),
    'specs', coalesce((select jsonb_agg(to_jsonb(sp) order by sp.code) from public.mockup_specs sp where sp.sheet_id = p_sheet), '[]'),
    'callouts', coalesce((select jsonb_agg(to_jsonb(c) order by c.no) from public.mockup_callouts c where c.sheet_id = p_sheet), '[]'))
  into snap;
  insert into public.mockup_snapshots (sheet_id, data) values (p_sheet, snap);
  insert into public.events (job_id, type, phase, station_code, payload, by)
  values (j.id, 'mockup_approved', j.phase, null,
    jsonb_build_object('rev', s.rev, 'sheet_id', p_sheet, 'replaced_rev', prev.rev, 'note', nullif(trim(p_note), '')),
    (select auth.uid()));
end $$;

create or replace function public.ack_mockup_sheet(p_sheet uuid, p_station text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.mockup_sheets; j public.jobs; r text;
begin
  r := private.require_role('production', 'supervisor', 'qc');
  select * into s from public.mockup_sheets where id = p_sheet;
  if not found then raise exception 'ไม่พบม็อคอัพฉบับนี้' using errcode = 'P0002'; end if;
  if s.status <> 'approved' then
    raise exception 'รับทราบได้เฉพาะม็อคอัพฉบับที่อนุมัติและใช้ผลิตอยู่' using errcode = '42501';
  end if;
  select * into j from public.jobs where id = s.job_id;
  if not exists (select 1 from public.route_stations rs where rs.route_code = j.route_code and rs.station_code = p_station) then
    raise exception 'งาน % ไม่ผ่านสถานีนี้' , j.confirmation_no using errcode = '23514';
  end if;
  if r = 'staff' and not exists (select 1 from public.staff_stations ss where ss.user_id = (select auth.uid()) and ss.station_code = p_station) then
    raise exception 'รับทราบได้เฉพาะสถานีที่จับคู่กับบัญชีคุณ' using errcode = '42501';
  end if;
  if r = 'qc' and p_station <> 'qc_pack' then
    raise exception 'ฝ่าย QC รับทราบได้เฉพาะสถานี QC + Packing' using errcode = '42501';
  end if;
  insert into public.mockup_acks (sheet_id, job_id, rev, user_id, station_code)
  values (p_sheet, j.id, s.rev, (select auth.uid()), p_station)
  on conflict (sheet_id, user_id, station_code) do nothing;
end $$;

revoke all on function public.start_mockup_sheet(uuid, text), public.save_mockup_draft(uuid, int, jsonb),
  public.discard_mockup_draft(uuid), public.submit_mockup_sheet(uuid, int), public.return_mockup_sheet(uuid, text),
  public.approve_mockup_sheet(uuid, text), public.ack_mockup_sheet(uuid, text) from public, anon;
grant execute on function public.start_mockup_sheet(uuid, text), public.save_mockup_draft(uuid, int, jsonb),
  public.discard_mockup_draft(uuid), public.submit_mockup_sheet(uuid, int), public.return_mockup_sheet(uuid, text),
  public.approve_mockup_sheet(uuid, text), public.ack_mockup_sheet(uuid, text) to authenticated;
