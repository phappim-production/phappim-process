-- =====================================================================
-- A1 · Workflow ของงาน (17 พ.ย. 2569) · ดู docs/แผน-1-สัปดาห์.md หัวข้อ 3 (กฎ 12 ข้อ)
-- 1) ตั้งค่าเพิ่ม: เวลามาตรฐานสถานี/ช่วง · รหัสสาเหตุ · คีย์ของวัตถุดิบ
-- 2) ข้อมูลงานเพิ่ม: รอบการเข้าสถานี (visit) · เวลาเริ่มสถานี · รายงานปัญหา
-- 3) ฟังก์ชันช่วย (schema private) · 4) RPC ที่หน้าเว็บเรียก (ทุกการเขียนข้อมูลงานต้องผ่านที่นี่)
-- 5) view สำหรับหน้าจอ · 6) สิทธิ์ + realtime
-- ค่าที่เป็นร่าง (รอ PP-SOP-01): sla_days ของสถานี · ช่วงพิมพ์+รีด+ตัด 3 วัน · รหัสสาเหตุ
-- =====================================================================

-- ---------- 1. ตั้งค่าเพิ่ม ----------
alter table public.stations
  add column sla_days numeric check (sla_days is null or sla_days > 0),          -- เวลามาตรฐานต่อ 1 งาน (วันทำงาน) · null = ไม่จับเวลา
  add column warn_pct int not null default 80 check (warn_pct between 1 and 100); -- ใช้เวลาถึง % นี้ = การ์ดสีส้ม
update public.stations set sla_days = 1 where code in ('print', 'press', 'cut');  -- ร่าง

-- เวลามาตรฐานของ "ช่วง" (หลายสถานีรวมกัน) เช่น พิมพ์ + รีด + ตัด ≤ 3 วัน
create table public.sla_segments (
  code         text primary key,
  name         text not null,
  route_code   text not null references public.routes(code),
  from_station text not null references public.stations(code),
  to_station   text not null references public.stations(code),
  sla_days     numeric not null check (sla_days > 0),
  warn_pct     int not null default 80 check (warn_pct between 1 and 100)
);
create index sla_segments_route_idx on public.sla_segments (route_code);
create index sla_segments_from_idx  on public.sla_segments (from_station);
create index sla_segments_to_idx    on public.sla_segments (to_station);
insert into public.sla_segments (code, name, route_code, from_station, to_station, sla_days) values
  ('subli_ppc', 'พิมพ์ + รีด + ตัด', 'normal', 'print', 'cut', 3);

-- รหัสสาเหตุมาตรฐาน (ใช้ทั้งรายงานงานเกินเวลา และรายงานผล) · ตาม PP-SOP-01 หัวข้อ 1.2
create table public.reason_codes (
  code   text primary key,
  grp    text not null,
  name   text not null,
  active boolean not null default true,
  sort   int not null default 0
);
insert into public.reason_codes (code, grp, name, sort) values
  ('M1','เครื่องจักร','เครื่องเสีย / รอซ่อม',10), ('M2','เครื่องจักร','หัวพิมพ์ตัน / ต้องล้างหัว',20), ('M3','เครื่องจักร','ไฟดับ / ระบบล่ม',30),
  ('W1','วัตถุดิบ','ผ้าไม่พอ / ผ้ายังไม่มา',40), ('W2','วัตถุดิบ','กระดาษ / หมึกหมด',50), ('W3','วัตถุดิบ','ฟิล์ม DTF ยังไม่มา',60),
  ('W4','วัตถุดิบ','อุปกรณ์ (ซิป ป้าย ด้าย) ไม่ครบ',70),
  ('F1','ไฟล์และข้อมูล','ไฟล์ผิด / ไฟล์ยังไม่มา',80), ('F2','ไฟล์และข้อมูล','ข้อมูลใบยืนยันไม่ชัด',90), ('F3','ไฟล์และข้อมูล','ลูกค้าขอแก้ระหว่างผลิต',100),
  ('P1','คนและคิวงาน','คนไม่พอ / ลา',110), ('P2','คนและคิวงาน','มีงานด่วนแทรก',120), ('P3','คนและคิวงาน','รองานจากสถานีก่อนหน้า',130),
  ('Q1','คุณภาพ','สีเพี้ยน ต้องทำใหม่',140), ('Q2','คุณภาพ','งานเสีย ต้องผลิตเพิ่ม',150), ('Q3','คุณภาพ','ชิ้นทดสอบ / ตัวแรกไม่ผ่าน',160),
  ('O1','อื่นๆ','ร้านนอกส่งช้า (ปัก / ฟิล์ม / อื่นๆ)',170), ('O9','อื่นๆ','อื่นๆ (ระบุในรายงาน)',180);

-- วัตถุดิบที่ระบบต้องรู้จัก (เช่น ฟิล์ม DTF ติ๊กให้อัตโนมัติเมื่อแอดมินบันทึกการสั่ง)
alter table public.material_templates add column key text unique;
update public.material_templates set key = 'dtf_film' where route_code = 'dtf' and dept = 'admin';

-- ---------- 2. ข้อมูลงานเพิ่ม ----------
alter table public.jobs
  add column visit              int not null default 0,       -- นับทุกครั้งที่งานเข้าสถานี (แยกขั้นย่อยของแต่ละรอบ: ตัวอย่าง/ผลิต/งานแก้)
  add column station_started_at timestamptz,                   -- กดเริ่มสถานีปัจจุบันเมื่อไร (null = ยังรอคิว)
  add column stage_entered_at   timestamptz not null default now(), -- เข้าขั้น/สถานีปัจจุบันเมื่อไร (ใช้คิดเวลารอคิว)
  add column rework_qty         int check (rework_qty is null or rework_qty > 0);
alter table public.job_materials add column key text;
alter table public.job_substeps  add column visit int not null default 0;
create index job_substeps_visit_idx on public.job_substeps (job_id, visit, station_code);
alter table public.issues add column prev_status text check (prev_status in ('queued', 'doing'));

-- รายงานปัญหาเมื่อเกินเวลามาตรฐาน (กฎข้อ 10)
create table public.delay_reports (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  visit        int  not null,
  station_code text references public.stations(code),
  segment_code text references public.sla_segments(code),
  reasons      text[] not null check (cardinality(reasons) > 0),
  detail       text not null check (length(trim(detail)) > 0),
  new_eta      timestamptz not null,
  need_help    text,
  by           uuid references auth.users(id),
  at           timestamptz not null default now()
);
create index delay_reports_job_idx     on public.delay_reports (job_id, visit);
create index delay_reports_station_idx on public.delay_reports (station_code);
create index delay_reports_segment_idx on public.delay_reports (segment_code);
create index delay_reports_by_idx      on public.delay_reports (by);

-- ---------- 3. ฟังก์ชันช่วย (ไม่เปิดเป็น API) ----------
-- ตรวจบทบาท · owner ทำได้ทุกอย่าง · คืนบทบาทของผู้เรียก
create or replace function private.require_role(variadic p_roles text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r text := private.my_role();
begin
  if r is null then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีที่ใช้งานอยู่' using errcode = '42501';
  end if;
  if r <> 'owner' and not (r = any (p_roles)) then
    raise exception 'บทบาทของคุณ (%) ทำขั้นนี้ไม่ได้', r using errcode = '42501';
  end if;
  return r;
end $$;

-- ล็อกแถวงานไว้จนจบคำสั่ง: 2 คนกดพร้อมกัน คนที่สองจะเห็นสถานะใหม่แล้วถูกปฏิเสธ (กฎข้อ 11)
create or replace function private.lock_job(p_job uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'ไม่พบงานนี้' using errcode = 'P0002'; end if;
  return j;
end $$;

-- ข้อความเมื่อสถานะไม่ตรงกับที่ปุ่มคาด (มักเกิดจากอีกคนกดไปก่อน)
create or replace function private.stale(p_what text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'สถานะงานเปลี่ยนไปแล้ว (%) กรุณาโหลดหน้าใหม่', p_what using errcode = 'P0001';
end $$;

create or replace function private.log(p_job uuid, p_type text, p_phase text, p_station text, p_payload jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.events (job_id, type, phase, station_code, payload, by)
  values (p_job, p_type, p_phase, p_station, coalesce(p_payload, '{}'), auth.uid());
$$;

create or replace function private.station_at(p_route text, p_seq int) returns text
language sql stable set search_path = '' as $$
  select station_code from public.route_stations where route_code = p_route and seq = p_seq
$$;

create or replace function private.last_seq(p_route text) returns int
language sql stable set search_path = '' as $$
  select max(seq) from public.route_stations where route_code = p_route
$$;

-- เวลาทำงานระหว่าง 2 จุด (หน่วยวัน) ไม่นับวันอาทิตย์ · เวลาไทย
create or replace function private.work_days(p_from timestamptz, p_to timestamptz) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(extract(epoch from (least(p_to, d_end) - greatest(p_from, d_start)))) / 86400, 0)::numeric
  from (
    select d::date::timestamp at time zone 'Asia/Bangkok'       as d_start,
           (d::date + 1)::timestamp at time zone 'Asia/Bangkok' as d_end,
           extract(isodow from d) as dow
    from generate_series((p_from at time zone 'Asia/Bangkok')::date,
                         (p_to   at time zone 'Asia/Bangkok')::date, interval '1 day') d
  ) days
  where p_to > p_from and dow <> 7 and least(p_to, d_end) > greatest(p_from, d_start)
$$;

-- เวลาที่พักงาน (มีสาเหตุ) ตั้งแต่ p_from ถึงตอนนี้ · ไม่นับเป็นเวลาทำงาน (กฎข้อ 9)
create or replace function private.hold_days(p_job uuid, p_from timestamptz) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(private.work_days(greatest(i.opened_at, p_from), coalesce(i.closed_at, now()))), 0)
  from public.issues i
  where i.job_id = p_job and coalesce(i.closed_at, now()) > p_from
$$;

-- ช่วงเวลามาตรฐานที่สถานีนี้อยู่ (ตามเส้นทางของงาน)
create or replace function private.segment_of(p_route text, p_station text) returns public.sla_segments
language sql stable security definer set search_path = '' as $$
  select g.* from public.sla_segments g
  join public.route_stations f on f.route_code = g.route_code and f.station_code = g.from_station
  join public.route_stations t on t.route_code = g.route_code and t.station_code = g.to_station
  join public.route_stations c on c.route_code = g.route_code and c.station_code = p_station
  where g.route_code = p_route and c.seq between f.seq and t.seq
  limit 1
$$;

-- สถานะเวลามาตรฐานของงาน (ใช้ทั้งในกฎข้อ 10 และหน้าจอ) · คิดเฉพาะการผลิตจริง ไม่คิดตอนขึ้นตัวอย่าง
create or replace function private.sla_state(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  j public.jobs; st public.stations; seg public.sla_segments;
  cur text; el numeric; seg_start timestamptz; seg_el numeric; reported boolean; seg_reported boolean;
  res jsonb := '{}';
begin
  select * into j from public.jobs where id = p_job;
  if not found or j.phase <> 'production' or j.station_seq is null then return res; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  select * into st from public.stations where code = cur;

  if j.station_started_at is not null and st.sla_days is not null and not j.is_rework then
    el := private.work_days(j.station_started_at, now()) - private.hold_days(j.id, j.station_started_at);
    select exists (select 1 from public.delay_reports d where d.job_id = j.id and d.visit = j.visit) into reported;
    res := res || jsonb_build_object(
      'station_sla_days', st.sla_days, 'station_days', round(greatest(el, 0), 3),
      'station_warn', el >= st.sla_days * st.warn_pct / 100.0,
      'station_over', el > st.sla_days, 'station_reported', reported);
  end if;

  seg := private.segment_of(j.route_code, cur);
  if seg.code is not null and not j.is_rework then
    -- เริ่มนับจากครั้งแรกที่เริ่มสถานีต้นช่วงในการผลิตจริง (งานแก้ที่ย้อนกลับมาไม่เริ่มนับใหม่)
    select min(e.at) into seg_start from public.events e
    where e.job_id = j.id and e.type = 'station_start' and e.phase = 'production' and e.station_code = seg.from_station
      and not coalesce((e.payload->>'rework')::boolean, false);
    if seg_start is not null then
      seg_el := private.work_days(seg_start, now()) - private.hold_days(j.id, seg_start);
      select exists (select 1 from public.delay_reports d where d.job_id = j.id and d.segment_code = seg.code and d.at >= seg_start)
        into seg_reported;
      res := res || jsonb_build_object(
        'segment_code', seg.code, 'segment_name', seg.name, 'segment_sla_days', seg.sla_days,
        'segment_days', round(greatest(seg_el, 0), 3),
        'segment_warn', seg_el >= seg.sla_days * seg.warn_pct / 100.0,
        'segment_over', seg_el > seg.sla_days, 'segment_reported', seg_reported);
    end if;
  end if;
  return res;
end $$;

-- ขั้นย่อยที่ยังขาดของสถานีปัจจุบัน (กฎข้อ 5) · คืนชื่อขั้นที่ขาด
--   ผลิตจริง: บังคับ req / num / appr / lock · ตัวอย่าง: บังคับเฉพาะ req (ไม่กรอกยอด ไม่มีตัวแรก) และไม่บังคับขั้นของ QC+Packing
--   งานแก้ (rework): ไม่บังคับขั้นย่อย (แก้แล้วกลับ QC)
create or replace function private.missing_substeps(p_job uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs; cur text; sub jsonb; k text; kind text; ok boolean; miss text[] := '{}';
begin
  select * into j from public.jobs where id = p_job;
  cur := private.station_at(j.route_code, j.station_seq);
  if j.is_rework and cur <> 'qc_pack' then return miss; end if;  -- สถานีที่แก้งานไม่ต้องติ๊กซ้ำ · QC ต้องตรวจครบเหมือนเดิม
  for sub in select s from public.stations st, jsonb_array_elements(st.substeps) s where st.code = cur loop
    k := sub->>'key'; kind := sub->>'kind';
    if j.phase = 'sample' and (kind <> 'req' or cur = 'qc_pack') then continue; end if;
    if kind not in ('req', 'num', 'appr', 'lock') then continue; end if;
    ok := case
      when kind = 'lock'      then j.dtf_film_received_at is not null
      when k = 'sew_count'    then j.sew_count >= j.qty
      when k = 'first_piece'  then j.first_piece_ok
      when cur = 'qc_pack' and k = 'inspect' then
        coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0) >= j.qty
      else exists (select 1 from public.job_substeps s
                   where s.job_id = j.id and s.visit = j.visit and s.station_code = cur and s.substep_key = k)
    end;
    if not ok then miss := miss || (sub->>'name'); end if;
  end loop;
  return miss;
end $$;

-- ย้ายงานไปสถานีลำดับ p_seq (รอคิว) · เริ่มรอบใหม่ของขั้นย่อย
create or replace function private.enter_station(p_job uuid, p_seq int) returns void
language sql security definer set search_path = '' as $$
  update public.jobs set station_seq = p_seq, station_status = 'queued', station_started_at = null,
    visit = visit + 1, stage_entered_at = now() where id = p_job;
$$;

-- วัตถุดิบครบทุกฝ่าย → ปล่อยงานไปขึ้นตัวอย่าง (กฎข้อ 2)
create or replace function private.release_if_ready(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  if j.phase <> 'materials' then return; end if;
  if exists (select 1 from public.job_materials m where m.job_id = p_job and m.checked_at is null) then return; end if;
  update public.jobs set phase = 'sample' where id = p_job;
  perform private.enter_station(p_job, 1);
  perform private.log(p_job, 'released', 'sample', null, jsonb_build_object('round', j.sample_round));
end $$;

-- ---------- 4. RPC ----------
-- รับงาน (กฎข้อ 1: ต้องแนบ PDF ใบยืนยันที่เซ็นครบ)
create or replace function public.receive_job(
  p_confirmation_no text, p_customer_name text, p_job_name text, p_product_type_code text,
  p_qty int, p_unit text, p_due_date date, p_route_code text, p_confirmation_pdf_path text,
  p_spare_qty int default 0, p_confirmation_rev int default 0, p_spec jsonb default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_role('supervisor');
  if coalesce(trim(p_confirmation_pdf_path), '') = '' or lower(p_confirmation_pdf_path) not like '%.pdf' then
    raise exception 'ต้องแนบ PDF ใบยืนยันที่ลูกค้าเซ็นครบก่อนรับงาน' using errcode = '23514';
  end if;
  if coalesce(trim(p_confirmation_no), '') = '' then raise exception 'ต้องระบุเลขที่ใบยืนยัน' using errcode = '23514'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนต้องมากกว่า 0' using errcode = '23514'; end if;
  if p_due_date is null then raise exception 'ต้องระบุกำหนดส่ง' using errcode = '23514'; end if;
  if coalesce(p_spare_qty, 0) < 0 then raise exception 'จำนวนเผื่อเสียติดลบไม่ได้' using errcode = '23514'; end if;
  if not exists (select 1 from public.routes where code = p_route_code) then
    raise exception 'ไม่พบเส้นทางผลิต %', p_route_code using errcode = '23503';
  end if;
  if not exists (select 1 from public.product_types where code = p_product_type_code) then
    raise exception 'ไม่พบประเภทสินค้า %', p_product_type_code using errcode = '23503';
  end if;
  if exists (select 1 from public.jobs where confirmation_no = trim(p_confirmation_no)) then
    raise exception 'เลขที่ใบยืนยัน % รับเข้าระบบไปแล้ว', trim(p_confirmation_no) using errcode = '23505';
  end if;

  insert into public.jobs (confirmation_no, confirmation_rev, customer_name, job_name, product_type_code, qty, spare_qty,
                           unit, due_date, route_code, spec, confirmation_pdf_path, phase, created_by)
  values (trim(p_confirmation_no), coalesce(p_confirmation_rev, 0), trim(p_customer_name), trim(p_job_name), p_product_type_code,
          p_qty, coalesce(p_spare_qty, 0), p_unit, p_due_date, p_route_code, coalesce(p_spec, '{}'), p_confirmation_pdf_path,
          'materials', auth.uid())
  returning id into v_id;

  insert into public.job_materials (job_id, name, dept, key)
  select v_id, t.name, t.dept, t.key from public.material_templates t
  where (t.product_type_code is null or t.product_type_code = p_product_type_code)
    and (t.route_code is null or t.route_code = p_route_code)
  order by t.dept, t.sort;

  perform private.log(v_id, 'received', 'materials', null, jsonb_build_object('route', p_route_code, 'qty', p_qty));
  perform private.release_if_ready(v_id);  -- ไม่มีรายการวัตถุดิบ = ไปขึ้นตัวอย่างทันที
  return v_id;
end $$;

-- ติ๊ก/ยกเลิกวัตถุดิบ · ฝ่ายติ๊กได้เฉพาะรายการของฝ่ายตัวเอง
create or replace function public.check_material(p_material_id bigint, p_checked boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.job_materials; j public.jobs; r text;
begin
  r := private.require_role('admin', 'qc', 'production');
  select * into m from public.job_materials where id = p_material_id;
  if not found then raise exception 'ไม่พบรายการวัตถุดิบ' using errcode = 'P0002'; end if;
  j := private.lock_job(m.job_id);
  if r <> 'owner' and r <> m.dept then
    raise exception 'รายการนี้เป็นของฝ่าย % ฝ่ายอื่นติ๊กไม่ได้', m.dept using errcode = '42501';
  end if;
  if j.phase <> 'materials' then perform private.stale('วัตถุดิบครบและปล่อยงานไปแล้ว'); end if;
  if m.key = 'dtf_film' then
    raise exception 'รายการฟิล์ม DTF ติ๊กให้อัตโนมัติเมื่อบันทึกการสั่งฟิล์ม' using errcode = 'P0001';
  end if;
  update public.job_materials set checked_at = case when p_checked then now() end,
                                  checked_by = case when p_checked then auth.uid() end
  where id = p_material_id;
  perform private.log(j.id, case when p_checked then 'material_checked' else 'material_unchecked' end, 'materials', null,
                      jsonb_build_object('material_id', p_material_id, 'name', m.name, 'dept', m.dept));
  perform private.release_if_ready(j.id);
end $$;

-- แอดมินบันทึกการสั่งฟิล์ม DTF + วันคาดว่าได้รับ
create or replace function public.order_film(p_job uuid, p_eta date) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.route_code <> 'dtf' then raise exception 'งานนี้ไม่ใช่เส้นทาง DTF' using errcode = 'P0001'; end if;
  if j.phase in ('done', 'cancelled') then perform private.stale('งานปิดแล้ว'); end if;
  if j.dtf_film_received_at is not null then perform private.stale('ได้รับฟิล์มแล้ว'); end if;
  if p_eta is null then raise exception 'ต้องระบุวันคาดว่าได้รับฟิล์ม' using errcode = '23514'; end if;
  update public.jobs set dtf_film_ordered_at = coalesce(dtf_film_ordered_at, now()), dtf_film_eta = p_eta where id = p_job;
  update public.job_materials set checked_at = coalesce(checked_at, now()), checked_by = coalesce(checked_by, auth.uid())
  where job_id = p_job and key = 'dtf_film';
  perform private.log(p_job, 'film_ordered', j.phase, null, jsonb_build_object('eta', p_eta));
  perform private.release_if_ready(p_job);
end $$;

create or replace function public.receive_film(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.route_code <> 'dtf' then raise exception 'งานนี้ไม่ใช่เส้นทาง DTF' using errcode = 'P0001'; end if;
  if j.dtf_film_ordered_at is null then raise exception 'ยังไม่ได้บันทึกการสั่งฟิล์ม' using errcode = 'P0001'; end if;
  if j.dtf_film_received_at is not null then perform private.stale('บันทึกรับฟิล์มไปแล้ว'); end if;
  update public.jobs set dtf_film_received_at = now() where id = p_job;
  perform private.log(p_job, 'film_received', j.phase, null);
end $$;

-- เริ่มสถานี (กฎข้อ 4 ข้ามไม่ได้ เพราะเริ่มได้เฉพาะสถานีปัจจุบัน · กฎข้อ 6 รีด DTF ต้องได้ฟิล์มก่อน)
create or replace function public.start_station(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; r text;
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.phase not in ('sample', 'production') then perform private.stale('งานไม่ได้อยู่ในสถานี'); end if;
  if j.station_status = 'doing' then perform private.stale('สถานีนี้เริ่มไปแล้ว'); end if;
  if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อนเริ่มต่อ' using errcode = 'P0001'; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC เริ่มได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;
  if cur = 'dtf_press' and j.dtf_film_received_at is null then
    raise exception 'ยังไม่ได้รับฟิล์ม DTF เริ่มรีด DTF ไม่ได้' using errcode = 'P0001';
  end if;
  update public.jobs set station_status = 'doing', station_started_at = now() where id = p_job;
  perform private.log(p_job, 'station_start', j.phase, cur,
    jsonb_build_object('visit', j.visit, 'round', j.sample_round, 'rework', j.is_rework));
end $$;

-- ติ๊กขั้นย่อย · ขั้น [กรอกค่า] ต้องมีตัวเลข · ขั้น [อนุมัติ] ผู้ควบคุมงานเท่านั้น
create or replace function public.complete_substep(p_job uuid, p_key text, p_value jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; sub jsonb; r text;
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.station_status is distinct from 'doing' then
    if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อน' using errcode = 'P0001'; end if;
    raise exception 'ต้องกด "เริ่ม" สถานีก่อนติ๊กขั้นย่อย' using errcode = 'P0001';
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  select s into sub from public.stations st, jsonb_array_elements(st.substeps) s where st.code = cur and s->>'key' = p_key;
  if sub is null then raise exception 'ไม่พบขั้นย่อย % ในสถานีนี้', p_key using errcode = 'P0002'; end if;
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC ติ๊กได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;
  if sub->>'kind' = 'lock' then raise exception 'ขั้นนี้ระบบติ๊กให้เมื่อเงื่อนไขครบ' using errcode = 'P0001'; end if;
  if p_key = 'sew_count' then raise exception 'ยอดเย็บใช้ปุ่ม "กรอกยอดเย็บ"' using errcode = 'P0001'; end if;
  if cur = 'qc_pack' and p_key = 'inspect' then raise exception 'ผลตรวจใช้ปุ่ม "บันทึกผล QC"' using errcode = 'P0001'; end if;
  if j.phase = 'sample' and p_key = 'first_piece' then raise exception 'ขึ้นตัวอย่างไม่มีด่านตัวแรก' using errcode = 'P0001'; end if;
  if sub->>'kind' = 'num' and (p_value is null or jsonb_typeof(p_value) <> 'number' or (p_value::text)::numeric < 0) then
    raise exception 'ขั้น "%" ต้องกรอกตัวเลข 0 ขึ้นไป', sub->>'name' using errcode = '23514';
  end if;
  if sub->>'kind' = 'appr' and r not in ('supervisor', 'owner') then
    raise exception 'ขั้น "%" ต้องให้ผู้ควบคุมงานอนุมัติ', sub->>'name' using errcode = '42501';
  end if;

  insert into public.job_substeps (job_id, phase, sample_round, station_code, substep_key, value, done_by, visit)
  values (p_job, j.phase, j.sample_round, cur, p_key, p_value, auth.uid(), j.visit);
  if p_key = 'first_piece' then update public.jobs set first_piece_ok = true where id = p_job; end if;
  if p_key = 'sort_count' then update public.jobs set cut_count = (p_value::text)::numeric::int where id = p_job; end if;
  perform private.log(p_job, 'substep_done', j.phase, cur, jsonb_build_object('key', p_key, 'value', p_value, 'visit', j.visit));
end $$;

-- กรอกยอดเย็บสะสม (กฎข้อ 7: ตัวแรกต้องผ่านก่อน)
create or replace function public.update_sew_count(p_job uuid, p_count int) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text;
begin
  perform private.require_role('supervisor');
  j := private.lock_job(p_job);
  cur := private.station_at(j.route_code, j.station_seq);
  if j.phase <> 'production' or cur is distinct from 'sew' then perform private.stale('งานไม่ได้อยู่ที่สถานีเย็บ'); end if;
  if j.station_status is distinct from 'doing' then raise exception 'ต้องกด "เริ่ม" สถานีเย็บก่อน' using errcode = 'P0001'; end if;
  if not j.first_piece_ok then raise exception 'ตัวแรกยังไม่ผ่าน กรอกยอดเย็บทั้งก้อนไม่ได้' using errcode = 'P0001'; end if;
  if p_count is null or p_count < 0 or p_count > j.qty + j.spare_qty then
    raise exception 'ยอดเย็บต้องอยู่ระหว่าง 0 ถึง %', j.qty + j.spare_qty using errcode = '23514';
  end if;
  update public.jobs set sew_count = p_count where id = p_job;
  insert into public.job_substeps (job_id, phase, sample_round, station_code, substep_key, value, done_by, visit)
  values (p_job, j.phase, j.sample_round, cur, 'sew_count', to_jsonb(p_count), auth.uid(), j.visit);
  perform private.log(p_job, 'sew_count', j.phase, cur, jsonb_build_object('count', p_count, 'qty', j.qty));
end $$;

-- บันทึกชิ้นที่ผ่าน QC (สะสม) · ชิ้นไม่ผ่านใช้ send_rework
create or replace function public.record_qc(p_job uuid, p_passed int) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text;
begin
  perform private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  cur := private.station_at(j.route_code, j.station_seq);
  if j.phase <> 'production' or cur is distinct from 'qc_pack' then perform private.stale('งานไม่ได้อยู่ที่ QC'); end if;
  if j.station_status is distinct from 'doing' then raise exception 'ต้องกด "เริ่ม" สถานี QC ก่อน' using errcode = 'P0001'; end if;
  if p_passed is null or p_passed <= 0 then raise exception 'จำนวนที่ผ่านต้องมากกว่า 0' using errcode = '23514'; end if;
  insert into public.qc_results (job_id, passed, failed, by) values (p_job, p_passed, 0, auth.uid());
  perform private.log(p_job, 'qc_result', j.phase, cur, jsonb_build_object('passed', p_passed));
end $$;

-- QC ส่งกลับแก้ (กฎข้อ 8: ต้องมีจำนวน + สาเหตุ + สถานีต้นเหตุ)
create or replace function public.send_rework(p_job uuid, p_qty int, p_reason text, p_source_station text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; src_seq int; qc_seq int;
begin
  perform private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  cur := private.station_at(j.route_code, j.station_seq);
  if j.phase <> 'production' or cur is distinct from 'qc_pack' then perform private.stale('งานไม่ได้อยู่ที่ QC'); end if;
  if j.station_status is distinct from 'doing' then raise exception 'ต้องกด "เริ่ม" สถานี QC ก่อน' using errcode = 'P0001'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'ส่งแก้ต้องระบุจำนวนมากกว่า 0' using errcode = '23514'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ส่งแก้ต้องระบุสาเหตุ' using errcode = '23514'; end if;
  select seq into src_seq from public.route_stations where route_code = j.route_code and station_code = p_source_station;
  qc_seq := j.station_seq;
  if src_seq is null or src_seq >= qc_seq then
    raise exception 'ต้องเลือกสถานีต้นเหตุที่อยู่ก่อน QC ในเส้นทางของงานนี้' using errcode = '23514';
  end if;
  insert into public.qc_results (job_id, passed, failed, reasons, source_station, by)
  values (p_job, 0, p_qty, jsonb_build_array(trim(p_reason)), p_source_station, auth.uid());
  update public.jobs set is_rework = true, rework_qty = p_qty where id = p_job;
  perform private.enter_station(p_job, src_seq);
  perform private.log(p_job, 'rework', j.phase, p_source_station,
    jsonb_build_object('qty', p_qty, 'reason', trim(p_reason), 'from', cur));
end $$;

-- กดเสร็จสถานี (กฎข้อ 5 ขั้นย่อยครบ · กฎข้อ 10 เกินเวลาต้องรายงานก่อน) แล้วส่งต่ออัตโนมัติ
create or replace function public.finish_station(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; miss text[]; sla jsonb; v_last int; next_seq int; r text;
begin
  r := private.require_role('supervisor', 'qc');
  j := private.lock_job(p_job);
  if j.station_status is distinct from 'doing' then
    if j.station_status = 'hold' then raise exception 'งานนี้พักอยู่ กด "แก้แล้ว" ก่อน' using errcode = 'P0001'; end if;
    perform private.stale('สถานีนี้ยังไม่ได้เริ่มหรือเสร็จไปแล้ว');
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  if r = 'qc' and cur <> 'qc_pack' then raise exception 'ฝ่าย QC กดเสร็จได้เฉพาะสถานี QC + Packing' using errcode = '42501'; end if;

  miss := private.missing_substeps(p_job);
  if cardinality(miss) > 0 then
    raise exception 'ยังทำขั้นย่อยไม่ครบ: %', array_to_string(miss, ', ') using errcode = 'P0001';
  end if;

  sla := private.sla_state(p_job);
  if coalesce((sla->>'station_over')::boolean, false) and not coalesce((sla->>'station_reported')::boolean, false) then
    raise exception 'เกินเวลามาตรฐานของสถานีนี้ ต้องส่งรายงานปัญหาก่อนกดเสร็จ' using errcode = 'P0001';
  end if;
  if coalesce((sla->>'segment_over')::boolean, false) and not coalesce((sla->>'segment_reported')::boolean, false) then
    raise exception 'ช่วง % เกินเวลามาตรฐาน ต้องส่งรายงานปัญหาก่อนกดเสร็จ', sla->>'segment_name' using errcode = 'P0001';
  end if;

  perform private.log(p_job, 'station_done', j.phase, cur, jsonb_build_object('visit', j.visit, 'rework', j.is_rework, 'sla', sla));

  v_last := private.last_seq(j.route_code);
  if j.is_rework and cur <> 'qc_pack' then
    next_seq := v_last;                       -- งานแก้เสร็จ กลับ QC ทันที
  elsif j.station_seq < v_last then
    next_seq := j.station_seq + 1;
  end if;

  if next_seq is not null then
    perform private.enter_station(p_job, next_seq);
  elsif j.phase = 'sample' then
    update public.jobs set phase = 'sample_review', station_seq = null, station_status = null,
      station_started_at = null, stage_entered_at = now() where id = p_job;
    perform private.log(p_job, 'sample_sent', 'sample', null, jsonb_build_object('round', j.sample_round));
  else
    update public.jobs set phase = 'done', station_seq = null, station_status = null, station_started_at = null,
      is_rework = false, rework_qty = null, finished_at = now(), stage_entered_at = now() where id = p_job;
    perform private.log(p_job, 'done', 'done', null);
  end if;
end $$;

-- แอดมินบันทึกผลตัวอย่างหลังลูกค้ายืนยัน (กฎข้อ 3: ไม่ผ่าน = ขึ้นตัวอย่างรอบใหม่ ผลิตจริงไม่ได้)
create or replace function public.record_sample_result(p_job uuid, p_pass boolean, p_note text default null,
                                                       p_customer_confirmed_at date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if j.phase <> 'sample_review' then perform private.stale('งานไม่ได้รอผลตัวอย่าง'); end if;
  if p_pass is null then raise exception 'ต้องเลือกผล ผ่าน หรือ ไม่ผ่าน' using errcode = '23514'; end if;
  if not p_pass and coalesce(trim(p_note), '') = '' then
    raise exception 'ตัวอย่างไม่ผ่าน ต้องระบุสิ่งที่ต้องแก้' using errcode = '23514';
  end if;
  insert into public.sample_results (job_id, round, result, note, customer_confirmed_at, by)
  values (p_job, j.sample_round, case when p_pass then 'pass' else 'fail' end, nullif(trim(p_note), ''), p_customer_confirmed_at, auth.uid());
  if p_pass then
    update public.jobs set phase = 'production', first_piece_ok = false, sew_count = 0 where id = p_job;
  else
    update public.jobs set phase = 'sample', sample_round = sample_round + 1 where id = p_job;
  end if;
  perform private.enter_station(p_job, 1);
  perform private.log(p_job, 'sample_result', j.phase, null,
    jsonb_build_object('round', j.sample_round, 'pass', p_pass, 'note', nullif(trim(p_note), '')));
end $$;

-- พักงาน / ติดปัญหา (กฎข้อ 9: ต้องมีสาเหตุ)
create or replace function public.open_issue(p_job uuid, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_id bigint; cur text;
begin
  perform private.require_role('supervisor', 'qc', 'admin', 'production');
  j := private.lock_job(p_job);
  if coalesce(trim(p_reason), '') = '' then raise exception 'ต้องระบุสาเหตุการพักงาน' using errcode = '23514'; end if;
  if j.phase not in ('sample', 'production') or j.station_status not in ('queued', 'doing') then
    perform private.stale('งานนี้พักไม่ได้ในขั้นนี้ หรือพักอยู่แล้ว');
  end if;
  cur := private.station_at(j.route_code, j.station_seq);
  insert into public.issues (job_id, station_code, reason, opened_by, prev_status)
  values (p_job, cur, trim(p_reason), auth.uid(), j.station_status) returning id into v_id;
  update public.jobs set station_status = 'hold' where id = p_job;
  perform private.log(p_job, 'hold', j.phase, cur, jsonb_build_object('issue_id', v_id, 'reason', trim(p_reason)));
  return v_id;
end $$;

create or replace function public.close_issue(p_job uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; i public.issues;
begin
  perform private.require_role('supervisor', 'qc', 'admin', 'production');
  j := private.lock_job(p_job);
  if j.station_status is distinct from 'hold' then perform private.stale('งานนี้ไม่ได้พักอยู่'); end if;
  select * into i from public.issues where job_id = p_job and closed_at is null order by opened_at desc limit 1;
  update public.issues set closed_at = now(), closed_by = auth.uid() where id = i.id;
  update public.jobs set station_status = coalesce(i.prev_status, 'queued') where id = p_job;
  perform private.log(p_job, 'resume', j.phase, i.station_code,
    jsonb_build_object('issue_id', i.id, 'note', nullif(trim(p_note), '')));
end $$;

-- รายงานปัญหาเมื่อเกิน/ใกล้เกินเวลามาตรฐาน (ส่งล่วงหน้าได้)
create or replace function public.submit_delay_report(p_job uuid, p_reasons text[], p_detail text, p_new_eta timestamptz,
                                                      p_need_help text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; cur text; seg public.sla_segments; bad text[]; v_id bigint;
begin
  perform private.require_role('supervisor', 'qc', 'admin', 'production');
  j := private.lock_job(p_job);
  if j.phase <> 'production' or j.station_seq is null then perform private.stale('งานไม่ได้อยู่ในการผลิต'); end if;
  if p_reasons is null or cardinality(p_reasons) = 0 then raise exception 'ต้องเลือกรหัสสาเหตุอย่างน้อย 1 ข้อ' using errcode = '23514'; end if;
  select array_agg(x) into bad from unnest(p_reasons) x
  where not exists (select 1 from public.reason_codes c where c.code = x and c.active);
  if bad is not null then raise exception 'รหัสสาเหตุไม่ถูกต้อง: %', array_to_string(bad, ', ') using errcode = '23514'; end if;
  if coalesce(trim(p_detail), '') = '' then raise exception 'ต้องอธิบายว่าเกิดอะไรขึ้น' using errcode = '23514'; end if;
  if p_new_eta is null or p_new_eta <= now() then raise exception 'ต้องระบุวันเวลาที่คาดว่าจะเสร็จใหม่ (หลังจากตอนนี้)' using errcode = '23514'; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  seg := private.segment_of(j.route_code, cur);
  insert into public.delay_reports (job_id, visit, station_code, segment_code, reasons, detail, new_eta, need_help, by)
  values (p_job, j.visit, cur, seg.code, p_reasons, trim(p_detail), p_new_eta, nullif(trim(p_need_help), ''), auth.uid())
  returning id into v_id;
  perform private.log(p_job, 'delay_report', j.phase, cur,
    jsonb_build_object('report_id', v_id, 'reasons', p_reasons, 'new_eta', p_new_eta));
  return v_id;
end $$;

-- หัวหน้าบันทึกการแก้ไขย้อนหลัง (events แก้/ลบไม่ได้ จึงบันทึกเป็น event ใหม่พร้อมเหตุผล)
create or replace function public.correct_event(p_job uuid, p_event_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  perform private.require_role('supervisor');
  perform private.lock_job(p_job);
  select * into e from public.events where id = p_event_id and job_id = p_job;
  if not found then raise exception 'ไม่พบรายการที่ต้องการแก้' using errcode = 'P0002'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ต้องระบุเหตุผลการแก้ไข' using errcode = '23514'; end if;
  perform private.log(p_job, 'correction', e.phase, e.station_code,
    jsonb_build_object('event_id', p_event_id, 'event_type', e.type, 'reason', trim(p_reason)));
end $$;

-- ---------- 5. view สำหรับหน้าจอ (ใช้สิทธิ์ของผู้เรียก → RLS ทำงาน) ----------
create or replace function private.sla_state_api(p_job uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.my_role() is null then '{}'::jsonb else private.sla_state(p_job) end
$$;

create view public.job_live with (security_invoker = true) as
select j.*,
  rs.station_code                                    as current_station,
  s.name                                             as current_station_name,
  private.last_seq(j.route_code)                     as last_seq,
  (select count(*) from public.job_materials m where m.job_id = j.id and m.checked_at is null)::int as materials_pending,
  (select array_agg(distinct m.dept) from public.job_materials m where m.job_id = j.id and m.checked_at is null) as materials_waiting_depts,
  (select i.reason from public.issues i where i.job_id = j.id and i.closed_at is null order by i.opened_at desc limit 1) as hold_reason,
  coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0)::int as qc_passed,
  private.sla_state_api(j.id)                        as sla
from public.jobs j
left join public.route_stations rs on rs.route_code = j.route_code and rs.seq = j.station_seq
left join public.stations s on s.code = rs.station_code;

-- ช่วงเวลาที่งานอยู่แต่ละสถานี (สำหรับรายงาน C4)
create view public.station_visits with (security_invoker = true) as
select e.job_id, e.station_code, e.phase, (e.payload->>'visit')::int as visit,
       min(e.at) filter (where e.type = 'station_start') as started_at,
       max(e.at) filter (where e.type = 'station_done')  as done_at,
       bool_or((e.payload->>'rework')::boolean)          as rework
from public.events e
where e.type in ('station_start', 'station_done')
group by e.job_id, e.station_code, e.phase, (e.payload->>'visit')::int;

-- ---------- 6. สิทธิ์ ----------
alter table public.sla_segments  enable row level security;
alter table public.reason_codes  enable row level security;
alter table public.delay_reports enable row level security;
do $$
declare t text;
begin
  foreach t in array array['sla_segments', 'reason_codes', 'delay_reports'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.my_role()) is not null)', t||'_read', t);
  end loop;
  foreach t in array array['sla_segments', 'reason_codes'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_owner()))', t||'_owner_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()))', t||'_owner_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_owner()))', t||'_owner_delete', t);
  end loop;
end $$;

-- RPC: เฉพาะคนที่ล็อกอิน (กฎข้อ 12) · ฟังก์ชันช่วยใน private ไม่เปิดให้เรียกตรง
do $$
declare f text;
begin
  foreach f in array array[
    'public.receive_job(text,text,text,text,int,text,date,text,text,int,int,jsonb)',
    'public.check_material(bigint,boolean)', 'public.order_film(uuid,date)', 'public.receive_film(uuid)',
    'public.start_station(uuid)', 'public.complete_substep(uuid,text,jsonb)', 'public.update_sew_count(uuid,int)',
    'public.record_qc(uuid,int)', 'public.send_rework(uuid,int,text,text)', 'public.finish_station(uuid)',
    'public.record_sample_result(uuid,boolean,text,date)', 'public.open_issue(uuid,text)', 'public.close_issue(uuid,text)',
    'public.submit_delay_report(uuid,text[],text,timestamptz,text)', 'public.correct_event(uuid,bigint,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.sla_state_api(uuid) to authenticated;
grant execute on function private.last_seq(text) to authenticated;
grant execute on function private.my_role() to authenticated;
grant execute on function private.is_owner() to authenticated;

-- ---------- 7. Realtime ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.job_substeps, public.sample_results, public.qc_results,
      public.events, public.delay_reports;
  end if;
end $$;
