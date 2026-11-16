-- =====================================================================
-- ภาพพิมพ์ 142 · ระบบติดตามการผลิต · โครงสร้างฐานข้อมูล (เฟส 0)
-- อ้างอิง DEVELOPMENT.md หัวข้อ 7
-- หลัก: อ่านได้ทุกคนที่ล็อกอินและ active · เขียนข้อมูลงานผ่าน RPC เท่านั้น (เฟส 2)
--       เจ้าของระบบ (owner) แก้ข้อมูลตั้งค่า (master) ได้โดยตรง · events แก้/ลบไม่ได้
-- =====================================================================

-- ---------- ผู้ใช้และบทบาท ----------
create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  role       text not null check (role in ('owner','supervisor','admin','qc','production','manager')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- บทบาทของผู้ใช้ปัจจุบัน (null = ไม่มีสิทธิ์ / ถูกปิด)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'owner', false)
$$;

-- ---------- ข้อมูลตั้งค่า (master) ----------
create table public.product_types (
  code          text primary key,                 -- ตรงกับรหัสในฟอร์มใบยืนยัน เช่น tshirt, polo
  name          text not null,
  category      text not null check (category in ('garment','flat','bag','hat','other')),
  unit          text not null,                    -- ตัว / ผืน / ใบ / ชุด ...
  sort          int  not null default 0,
  sew_checklist jsonb not null default '[]',      -- ["เย็บไหล่", ...] (ไม่บังคับติ๊ก)
  active        boolean not null default true
);

create table public.stations (
  code     text primary key,                      -- print, press, cut, dtf_press, emb, screen, sew, qc_pack
  name     text not null,
  sort     int  not null default 0,
  substeps jsonb not null default '[]',           -- [{key,name,kind:'req'|'num'|'appr'|'lock'|'opt'}]
  is_draft boolean not null default false         -- ขั้นย่อยยังรอยืนยันจากหน้างาน
);

create table public.routes (
  code        text primary key,                   -- normal, dtf, plain
  name        text not null,
  description text,
  active      boolean not null default true
);

create table public.route_stations (
  route_code   text not null references public.routes(code) on delete cascade,
  seq          int  not null,
  station_code text not null references public.stations(code),
  primary key (route_code, seq),
  unique (route_code, station_code)
);

create table public.material_templates (
  id                bigint generated always as identity primary key,
  product_type_code text references public.product_types(code),   -- null = ใช้กับทุกสินค้า
  route_code        text references public.routes(code),          -- null = ใช้กับทุกเส้นทาง
  name              text not null,
  dept              text not null check (dept in ('admin','qc','production')),
  sort              int  not null default 0,
  is_draft          boolean not null default true
);

-- ---------- งาน ----------
create table public.jobs (
  id                    uuid primary key default gen_random_uuid(),
  confirmation_no       text not null unique,          -- เลขที่ใบยืนยัน เช่น SC691520
  confirmation_rev      int  not null default 0,       -- แก้ไขครั้งที่
  customer_name         text not null,
  job_name              text not null,
  product_type_code     text not null references public.product_types(code),
  qty                   int  not null check (qty > 0),
  spare_qty             int  not null default 0,
  unit                  text not null,
  due_date              date not null,
  route_code            text not null references public.routes(code),
  spec                  jsonb not null default '{}',   -- คำตอบทั้งหมดจากฟอร์มใบยืนยัน (ไฟล์ .json)
  confirmation_pdf_path text not null,                 -- PDF ฉบับลูกค้าเซ็นครบ (Storage) · ไม่มี = รับงานไม่ได้
  phase                 text not null default 'materials'
                        check (phase in ('materials','sample','sample_review','production','done','cancelled')),
  station_seq           int,
  station_status        text check (station_status in ('queued','doing','hold')),
  sample_round          int  not null default 1,
  dtf_film_ordered_at   timestamptz,
  dtf_film_eta          date,
  dtf_film_received_at  timestamptz,
  cut_count             int,
  sew_count             int  not null default 0,
  first_piece_ok        boolean not null default false,
  is_rework             boolean not null default false,
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  finished_at           timestamptz
);
create index jobs_phase_idx on public.jobs (phase);
create index jobs_due_idx   on public.jobs (due_date);

create table public.job_materials (
  id         bigint generated always as identity primary key,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  name       text not null,
  dept       text not null check (dept in ('admin','qc','production')),
  checked_by uuid references auth.users(id),
  checked_at timestamptz
);
create index job_materials_job_idx on public.job_materials (job_id);

create table public.job_substeps (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  phase        text not null,                 -- sample / production
  sample_round int,
  station_code text not null references public.stations(code),
  substep_key  text not null,
  value        jsonb,
  done_by      uuid references auth.users(id),
  done_at      timestamptz not null default now()
);
create index job_substeps_job_idx on public.job_substeps (job_id);

create table public.sample_results (
  id                    bigint generated always as identity primary key,
  job_id                uuid not null references public.jobs(id) on delete cascade,
  round                 int  not null,
  result                text not null check (result in ('pass','fail')),
  note                  text,
  customer_confirmed_at date,
  by                    uuid references auth.users(id),
  at                    timestamptz not null default now(),
  unique (job_id, round)
);

create table public.qc_results (
  id             bigint generated always as identity primary key,
  job_id         uuid not null references public.jobs(id) on delete cascade,
  passed         int  not null default 0,
  failed         int  not null default 0,
  reasons        jsonb not null default '[]',
  source_station text references public.stations(code),
  by             uuid references auth.users(id),
  at             timestamptz not null default now()
);

create table public.issues (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  station_code text references public.stations(code),
  reason       text not null check (length(trim(reason)) > 0),
  opened_by    uuid references auth.users(id),
  opened_at    timestamptz not null default now(),
  closed_by    uuid references auth.users(id),
  closed_at    timestamptz
);

-- ทุกการกด = 1 แถว (append-only) · ใช้คำนวณเวลาทุกตัว
create table public.events (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  type         text not null,
  phase        text,
  station_code text,
  payload      jsonb not null default '{}',
  by           uuid references auth.users(id),
  at           timestamptz not null default now()
);
create index events_job_idx on public.events (job_id, at);

create or replace function public.events_no_change() returns trigger
language plpgsql as $$
begin
  raise exception 'events เป็นบันทึกแบบเพิ่มอย่างเดียว ห้ามแก้หรือลบ (ใช้ event type=correction แทน)';
end $$;
create trigger events_append_only before update or delete on public.events
  for each row execute function public.events_no_change();

-- ---------- Row Level Security ----------
alter table public.profiles           enable row level security;
alter table public.product_types      enable row level security;
alter table public.stations           enable row level security;
alter table public.routes             enable row level security;
alter table public.route_stations     enable row level security;
alter table public.material_templates enable row level security;
alter table public.jobs               enable row level security;
alter table public.job_materials      enable row level security;
alter table public.job_substeps       enable row level security;
alter table public.sample_results     enable row level security;
alter table public.qc_results         enable row level security;
alter table public.issues             enable row level security;
alter table public.events             enable row level security;

-- อ่าน: ทุกคนที่ล็อกอินและมีบทบาท active
do $$
declare t text;
begin
  foreach t in array array['product_types','stations','routes','route_stations','material_templates',
                           'jobs','job_materials','job_substeps','sample_results','qc_results','issues','events']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.my_role() is not null)', t||'_read', t);
  end loop;
end $$;

-- profiles: เห็นของตัวเอง · owner เห็น/จัดการทั้งหมด
create policy profiles_read_self  on public.profiles for select to authenticated using (user_id = auth.uid() or public.is_owner());
create policy profiles_owner_all  on public.profiles for all    to authenticated using (public.is_owner()) with check (public.is_owner());

-- master: owner แก้ได้โดยตรง (หน้าตั้งค่า)
do $$
declare t text;
begin
  foreach t in array array['product_types','stations','routes','route_stations','material_templates']
  loop
    execute format('create policy %I on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t||'_owner_write', t);
  end loop;
end $$;

-- ข้อมูลงาน: ไม่มี policy เขียน = เขียนตรงไม่ได้ · เฟส 2 จะเพิ่ม RPC (security definer) ที่ตรวจบทบาท + กฎ workflow

-- ---------- Realtime (บอร์ดสด) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.jobs, public.job_materials, public.issues;
  end if;
end $$;
