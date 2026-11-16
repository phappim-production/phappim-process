-- =====================================================================
-- ปรับตามคำเตือนของ Supabase Advisors (16 พ.ย. 2569)
-- 1) ย้ายฟังก์ชันตรวจสิทธิ์ไป schema private (ไม่เปิดเป็น API) · คนไม่ล็อกอินเรียกไม่ได้
-- 2) ตั้ง search_path ให้ฟังก์ชัน trigger
-- 3) RLS: เรียก auth.uid()/ฟังก์ชันผ่าน (select …) ให้คำนวณครั้งเดียวต่อคำสั่ง
--    และแยก policy เขียนของ owner เป็น insert/update/delete (ไม่ซ้อนกับ policy อ่าน)
-- 4) เพิ่ม index ให้ foreign key ทุกตัว
-- =====================================================================

-- ---------- 1. ฟังก์ชันสิทธิ์ใน schema private ----------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.user_id = (select auth.uid()) and p.active
$$;

create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'owner', false)
$$;

revoke all on function private.my_role()  from public, anon;
revoke all on function private.is_owner() from public, anon;
grant execute on function private.my_role()  to authenticated;
grant execute on function private.is_owner() to authenticated;

-- ---------- 2. trigger events ----------
alter function public.events_no_change() set search_path = '';

-- ---------- 3. policies ใหม่ ----------
do $$
declare t text;
begin
  -- ลบ policy เดิมทั้งหมดที่สร้างใน migration แรก
  foreach t in array array['product_types','stations','routes','route_stations','material_templates',
                           'jobs','job_materials','job_substeps','sample_results','qc_results','issues','events']
  loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
  end loop;
  foreach t in array array['product_types','stations','routes','route_stations','material_templates']
  loop
    execute format('drop policy if exists %I on public.%I', t||'_owner_write', t);
  end loop;
end $$;
drop policy if exists profiles_read_self on public.profiles;
drop policy if exists profiles_owner_all on public.profiles;

-- อ่าน: ผู้ใช้ที่ล็อกอินและมีบทบาท active
do $$
declare t text;
begin
  foreach t in array array['product_types','stations','routes','route_stations','material_templates',
                           'jobs','job_materials','job_substeps','sample_results','qc_results','issues','events']
  loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.my_role()) is not null)', t||'_read', t);
  end loop;
end $$;

-- เขียนข้อมูลตั้งค่า: owner เท่านั้น (แยกตามคำสั่ง ไม่รวม select)
do $$
declare t text;
begin
  foreach t in array array['product_types','stations','routes','route_stations','material_templates','profiles']
  loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_owner()))', t||'_owner_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()))', t||'_owner_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_owner()))', t||'_owner_delete', t);
  end loop;
end $$;

-- profiles: เห็นของตัวเอง · owner เห็นทุกคน (policy อ่านเดียว)
create policy profiles_read on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner()));

-- ลบฟังก์ชันเดิมใน public (ไม่มี policy ใช้แล้ว)
drop function if exists public.is_owner();
drop function if exists public.my_role();

-- ---------- 4. index ของ foreign key ----------
create index if not exists events_by_idx                    on public.events (by);
create index if not exists issues_job_idx                   on public.issues (job_id);
create index if not exists issues_station_idx               on public.issues (station_code);
create index if not exists issues_opened_by_idx             on public.issues (opened_by);
create index if not exists issues_closed_by_idx             on public.issues (closed_by);
create index if not exists job_materials_checked_by_idx     on public.job_materials (checked_by);
create index if not exists job_substeps_done_by_idx         on public.job_substeps (done_by);
create index if not exists job_substeps_station_idx         on public.job_substeps (station_code);
create index if not exists jobs_created_by_idx              on public.jobs (created_by);
create index if not exists jobs_product_type_idx            on public.jobs (product_type_code);
create index if not exists jobs_route_idx                   on public.jobs (route_code);
create index if not exists material_templates_product_idx   on public.material_templates (product_type_code);
create index if not exists material_templates_route_idx     on public.material_templates (route_code);
create index if not exists qc_results_by_idx                on public.qc_results (by);
create index if not exists qc_results_job_idx               on public.qc_results (job_id);
create index if not exists qc_results_source_station_idx    on public.qc_results (source_station);
create index if not exists route_stations_station_idx       on public.route_stations (station_code);
create index if not exists sample_results_by_idx            on public.sample_results (by);
