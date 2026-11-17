-- เส้นทางผลิตตามงานจริงของโรงงาน + ขึ้นตัวอย่างเฉพาะงานที่ลูกค้าจ่ายค่าตัวอย่าง (เจ้าของโปรเจกต์ยืนยัน 17 พ.ย. 2569)
-- ผ้ามาเป็นม้วน ทุกงานต้องตัดก่อน · "รีด" ในเส้นทางปกติ = รีดหมึกซับลงผ้า
-- DTF / DTG / ซิลค์สกรีน: สั่งฟิล์มเข้ามา แล้วรีดลงชิ้นผ้าที่ตัดแล้วที่สถานีรีดฟิล์มเครื่องเดียวกัน
-- งานปัก: ส่งร้านนอกหลังตัด ก่อนเย็บ · บางงานพิมพ์ + รีดก่อน จึงแยกเป็น 2 เส้นทางให้เลือกตอนรับงาน
-- ตัดงานลูกค้า: ลูกค้าส่งไฟล์มาให้ตัดอย่างเดียว แล้วผ่าน QC + แพ็ค

-- ---------- 1. สถานี ----------
update public.stations set name = 'รีดฟิล์ม (DTF / DTG / สกรีน)', substeps = '[
  {"key":"film_received","name":"ได้รับฟิล์มที่สั่ง","kind":"lock"},
  {"key":"receive_pieces","name":"รับชิ้นผ้าตัด (ยอดตรงใบนับ)","kind":"req"},
  {"key":"set_press","name":"ตั้งเครื่องรีดแบน (อุณหภูมิ °C)","kind":"num"},
  {"key":"test_press","name":"รีดทดสอบ (เมื่อตำแหน่งยังไม่ชัด)","kind":"opt"},
  {"key":"pre_press","name":"รีดไล่ความชื้น (Pre-press)","kind":"opt"},
  {"key":"place_film","name":"วางฟิล์มตามตำแหน่ง","kind":"opt"},
  {"key":"press_peel","name":"รีดและลอกฟิล์ม","kind":"opt"},
  {"key":"post_press","name":"รีดทับ (Post-press)","kind":"opt"},
  {"key":"check_adhesion","name":"ตรวจการติด","kind":"req"},
  {"key":"count","name":"นับและส่งเย็บ (จำนวนชิ้นดี)","kind":"num"}]'
where code = 'dtf_press';

-- ปักส่งร้านนอก: นับชิ้นตอนส่งและตอนรับกลับ กันชิ้นหาย · เวลาที่อยู่ร้านปักนับเป็นเวลาของสถานีนี้
-- ยังไม่ตั้งเวลามาตรฐาน (sla_days) จนกว่าจะรู้เวลาปกติของร้านปัก
update public.stations set name = 'ส่งปัก (ร้านนอก)', is_draft = false, sla_days = null, substeps = '[
  {"key":"send_out","name":"ส่งชิ้นผ้าไปร้านปัก (จำนวนชิ้นที่ส่ง)","kind":"num"},
  {"key":"receive_back","name":"รับงานปักกลับ (จำนวนชิ้นที่ได้)","kind":"num"},
  {"key":"check_emb","name":"ตรวจงานปัก (ตำแหน่ง สี ด้ายหลุด)","kind":"req"}]'
where code = 'emb';

-- ---------- 2. เส้นทาง ----------
update public.routes set name = 'ปกติ (ซับลิเมชั่น / ดิจิทัล)', description = 'พิมพ์ → รีด → ตัด → เย็บ → QC+Packing' where code = 'normal';
update public.routes set description = 'ตัด → รีดฟิล์ม → เย็บ → QC+Packing · แอดมินต้องสั่งฟิล์ม DTF' where code = 'dtf';

insert into public.routes (code, name, description) values
  ('dtg',       'DTG',              'ตัด → รีดฟิล์ม → เย็บ → QC+Packing · แอดมินต้องสั่งงาน DTG'),
  ('screen',    'ซิลค์สกรีน',         'ตัด → รีดฟิล์ม → เย็บ → QC+Packing · แอดมินต้องสั่งงานสกรีน'),
  ('emb',       'ปัก',               'ตัด → ส่งปัก → เย็บ → QC+Packing'),
  ('print_emb', 'พิมพ์ + ปัก',         'พิมพ์ → รีด → ตัด → ส่งปัก → เย็บ → QC+Packing'),
  ('cut_only',  'ตัดงานลูกค้า',        'ตัด → QC+Packing (ลูกค้าส่งไฟล์มาให้ตัดอย่างเดียว)');

insert into public.route_stations (route_code, seq, station_code) values
  ('dtg',       1, 'cut'),   ('dtg',       2, 'dtf_press'), ('dtg',       3, 'sew'), ('dtg', 4, 'qc_pack'),
  ('screen',    1, 'cut'),   ('screen',    2, 'dtf_press'), ('screen',    3, 'sew'), ('screen', 4, 'qc_pack'),
  ('emb',       1, 'cut'),   ('emb',       2, 'emb'),       ('emb',       3, 'sew'), ('emb', 4, 'qc_pack'),
  ('print_emb', 1, 'print'), ('print_emb', 2, 'press'),     ('print_emb', 3, 'cut'), ('print_emb', 4, 'emb'),
  ('print_emb', 5, 'sew'),   ('print_emb', 6, 'qc_pack'),
  ('cut_only',  1, 'cut'),   ('cut_only',  2, 'qc_pack');

-- พิมพ์ + รีด + ตัด ใช้เวลามาตรฐานเดียวกับเส้นทางปกติ
insert into public.sla_segments (code, name, route_code, from_station, to_station, sla_days, big_qty, big_sla_days)
select 'subli_ppc_emb', name, 'print_emb', from_station, to_station, sla_days, big_qty, big_sla_days
from public.sla_segments where code = 'subli_ppc';

-- ฟิล์มที่สั่งเข้า: แอดมินติ๊กให้อัตโนมัติเมื่อบันทึกการสั่ง (เหมือน DTF)
insert into public.material_templates (product_type_code, route_code, name, dept, sort, key) values
  (null, 'dtg',    'สั่งงาน DTG แล้ว (บันทึกวันคาดว่าได้รับ)',  'admin', 30, 'dtg_film'),
  (null, 'screen', 'สั่งงานสกรีนแล้ว (บันทึกวันคาดว่าได้รับ)', 'admin', 30, 'screen_film');

-- เส้นทางที่ต้องสั่งฟิล์มเข้ามารีด (ใช้ช่อง dtf_film_* ของงานร่วมกัน)
create or replace function private.uses_film(p_route text) returns boolean
language sql immutable set search_path = '' as $$
  select p_route in ('dtf', 'dtg', 'screen')
$$;

create or replace function private.film_label(p_route text) returns text
language sql immutable set search_path = '' as $$
  select case p_route when 'dtg' then 'งาน DTG' when 'screen' then 'งานสกรีน' else 'ฟิล์ม DTF' end
$$;

-- ---------- 3. ขึ้นตัวอย่างเฉพาะงานที่ตกลงกับลูกค้าแล้ว ----------
-- งานเดิมถือว่าขึ้นตัวอย่าง (ตรงกับกฎเดิม)
alter table public.jobs add column needs_sample boolean not null default true;

-- view เดิมเป็น select j.* ที่ตรึงคอลัมน์ไว้ตอนสร้าง จึงต้องสร้างใหม่ให้หน้าเว็บเห็น needs_sample (นิยามเดิมทุกอย่าง)
drop view public.job_live;
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
revoke all on public.job_live from anon;
grant select on public.job_live to authenticated;

create or replace function private.release_if_ready(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  if j.phase <> 'materials' then return; end if;
  if exists (select 1 from public.job_materials m where m.job_id = p_job and m.checked_at is null) then return; end if;
  if j.needs_sample then
    update public.jobs set phase = 'sample' where id = p_job;
    perform private.enter_station(p_job, 1);
    perform private.log(p_job, 'released', 'sample', null, jsonb_build_object('round', j.sample_round));
  else
    -- ไม่ขึ้นตัวอย่าง: วัตถุดิบครบแล้วเข้าผลิตจริงเลย (เหมือนตัวอย่างผ่าน)
    update public.jobs set phase = 'production', first_piece_ok = false, sew_count = 0 where id = p_job;
    perform private.enter_station(p_job, 1);
    perform private.log(p_job, 'released', 'production', null, jsonb_build_object('sample', false));
  end if;
end $$;

-- รับงาน: ต้องบอกว่าขึ้นตัวอย่างหรือไม่ (ตามที่ตกลงกับลูกค้าในใบยืนยัน)
drop function public.receive_job(text, text, text, text, int, text, date, text, text, int, int, jsonb);
create function public.receive_job(
  p_confirmation_no text, p_customer_name text, p_job_name text, p_product_type_code text,
  p_qty int, p_unit text, p_due_date date, p_route_code text, p_confirmation_pdf_path text,
  p_spare_qty int default 0, p_confirmation_rev int default 0, p_spec jsonb default '{}',
  p_needs_sample boolean default true   -- ไม่ระบุ = ขึ้นตัวอย่าง (ทางที่ปลอดภัยกว่า) · หน้ารับงานบังคับให้เลือกเอง
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_role('supervisor');
  if coalesce(trim(p_confirmation_pdf_path), '') = '' or lower(p_confirmation_pdf_path) not like '%.pdf' then
    raise exception 'ต้องแนบ PDF ใบยืนยันที่ลูกค้าเซ็นครบก่อนรับงาน' using errcode = '23514';
  end if;
  if not private.confirmation_uploaded(p_confirmation_pdf_path) then
    raise exception 'ยังไม่พบไฟล์ PDF ใบยืนยันในระบบ ให้แนบไฟล์แล้วกดรับงานอีกครั้ง' using errcode = '23514';
  end if;
  if coalesce(trim(p_confirmation_no), '') = '' then raise exception 'ต้องระบุเลขที่ใบยืนยัน' using errcode = '23514'; end if;
  if coalesce(trim(p_customer_name), '') = '' then raise exception 'ต้องระบุชื่อลูกค้า' using errcode = '23514'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนต้องมากกว่า 0' using errcode = '23514'; end if;
  if p_due_date is null then raise exception 'ต้องระบุกำหนดส่ง' using errcode = '23514'; end if;
  if coalesce(p_spare_qty, 0) < 0 then raise exception 'จำนวนเผื่อเสียติดลบไม่ได้' using errcode = '23514'; end if;
  if p_needs_sample is null then
    raise exception 'ต้องเลือกว่างานนี้ขึ้นตัวอย่างหรือไม่ (ตามที่ตกลงกับลูกค้าในใบยืนยัน)' using errcode = '23514';
  end if;
  if not exists (select 1 from public.routes where code = p_route_code and active) then
    raise exception 'ไม่พบเส้นทางผลิต %', p_route_code using errcode = '23503';
  end if;
  if not exists (select 1 from public.product_types where code = p_product_type_code) then
    raise exception 'ไม่พบประเภทสินค้า %', p_product_type_code using errcode = '23503';
  end if;
  if exists (select 1 from public.jobs where confirmation_no = trim(p_confirmation_no)) then
    raise exception 'เลขที่ใบยืนยัน % รับเข้าระบบไปแล้ว', trim(p_confirmation_no) using errcode = '23505';
  end if;

  insert into public.jobs (confirmation_no, confirmation_rev, customer_name, job_name, product_type_code, qty, spare_qty,
                           unit, due_date, route_code, spec, confirmation_pdf_path, phase, needs_sample, created_by)
  values (trim(p_confirmation_no), coalesce(p_confirmation_rev, 0), trim(p_customer_name), trim(p_job_name), p_product_type_code,
          p_qty, coalesce(p_spare_qty, 0), p_unit, p_due_date, p_route_code, coalesce(p_spec, '{}'), p_confirmation_pdf_path,
          'materials', p_needs_sample, auth.uid())
  returning id into v_id;

  insert into public.job_materials (job_id, name, dept, key)
  select v_id, t.name, t.dept, t.key from public.material_templates t
  where (t.product_type_code is null or t.product_type_code = p_product_type_code)
    and (t.route_code is null or t.route_code = p_route_code)
  order by t.dept, t.sort;

  perform private.log(v_id, 'received', 'materials', null,
    jsonb_build_object('route', p_route_code, 'qty', p_qty, 'sample', p_needs_sample));
  perform private.release_if_ready(v_id);
  return v_id;
end $$;

revoke all on function public.receive_job(text, text, text, text, int, text, date, text, text, int, int, jsonb, boolean) from public, anon;
grant execute on function public.receive_job(text, text, text, text, int, text, date, text, text, int, int, jsonb, boolean) to authenticated;

-- ---------- 4. ฟิล์มที่สั่งเข้า (DTF / DTG / สกรีน) ----------
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
  if m.key in ('dtf_film', 'dtg_film', 'screen_film') then
    raise exception 'รายการ% ติ๊กให้อัตโนมัติเมื่อบันทึกการสั่ง', private.film_label(j.route_code) using errcode = 'P0001';
  end if;
  update public.job_materials set checked_at = case when p_checked then now() end,
                                  checked_by = case when p_checked then auth.uid() end
  where id = p_material_id;
  perform private.log(j.id, case when p_checked then 'material_checked' else 'material_unchecked' end, 'materials', null,
                      jsonb_build_object('material_id', p_material_id, 'name', m.name, 'dept', m.dept));
  perform private.release_if_ready(j.id);
end $$;

create or replace function public.order_film(p_job uuid, p_eta date) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if not private.uses_film(j.route_code) then
    raise exception 'งานนี้ไม่ต้องสั่งฟิล์ม (เฉพาะงาน DTF / DTG / สกรีน)' using errcode = 'P0001';
  end if;
  if j.phase in ('done', 'cancelled') then perform private.stale('งานปิดแล้ว'); end if;
  if j.dtf_film_received_at is not null then perform private.stale('ได้รับฟิล์มแล้ว'); end if;
  if p_eta is null then raise exception 'ต้องระบุวันคาดว่าได้รับ%', private.film_label(j.route_code) using errcode = '23514'; end if;
  update public.jobs set dtf_film_ordered_at = coalesce(dtf_film_ordered_at, now()), dtf_film_eta = p_eta where id = p_job;
  update public.job_materials set checked_at = coalesce(checked_at, now()), checked_by = coalesce(checked_by, auth.uid())
  where job_id = p_job and key in ('dtf_film', 'dtg_film', 'screen_film');
  perform private.log(p_job, 'film_ordered', j.phase, null, jsonb_build_object('eta', p_eta));
  perform private.release_if_ready(p_job);
end $$;

create or replace function public.receive_film(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform private.require_role('admin');
  j := private.lock_job(p_job);
  if not private.uses_film(j.route_code) then
    raise exception 'งานนี้ไม่ต้องสั่งฟิล์ม (เฉพาะงาน DTF / DTG / สกรีน)' using errcode = 'P0001';
  end if;
  if j.dtf_film_ordered_at is null then
    raise exception 'ยังไม่ได้บันทึกการสั่ง% ให้บันทึกการสั่งก่อน', private.film_label(j.route_code) using errcode = 'P0001';
  end if;
  if j.dtf_film_received_at is not null then perform private.stale('บันทึกรับฟิล์มไปแล้ว'); end if;
  update public.jobs set dtf_film_received_at = now() where id = p_job;
  perform private.log(p_job, 'film_received', j.phase, null);
end $$;

-- เริ่มสถานี: เหมือนเดิม เปลี่ยนเฉพาะข้อความรอฟิล์มให้ตรงกับชนิดงาน
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
    raise exception 'ยังไม่ได้รับ% เริ่มรีดฟิล์มไม่ได้', private.film_label(j.route_code) using errcode = 'P0001';
  end if;
  update public.jobs set station_status = 'doing', station_started_at = now() where id = p_job;
  perform private.log(p_job, 'station_start', j.phase, cur,
    jsonb_build_object('visit', j.visit, 'round', j.sample_round, 'rework', j.is_rework));
end $$;

-- กล่องจดหมาย: ฟิล์มเลยกำหนดใช้กับทุกงานที่สั่งฟิล์ม ไม่ใช่เฉพาะ DTF
create or replace function private.inbox_scan_all() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_added integer := 0;
  j record;
  v_sla jsonb;
  v_st_over boolean; v_seg_over boolean;
  v_depts text[];
  v_qty text;
  v_body text;
begin
  for j in
    select jb.*, pt.name as product_name
    from public.jobs jb
    join public.product_types pt on pt.code = jb.product_type_code
    where jb.phase not in ('done', 'cancelled')
  loop
    v_qty := to_char(j.qty, 'FM999,999,999');

    -- 1. เกินเวลามาตรฐาน (ผลิตจริง ยังไม่รายงาน)
    if j.phase = 'production' and j.station_seq is not null and not j.is_rework then
      v_sla := private.sla_state(j.id);
      v_st_over := coalesce((v_sla->>'station_over')::boolean, false) and not coalesce((v_sla->>'station_reported')::boolean, false);
      v_seg_over := coalesce((v_sla->>'segment_over')::boolean, false) and not coalesce((v_sla->>'segment_reported')::boolean, false);
      if v_st_over or v_seg_over then
        if v_seg_over then
          v_body := format('%s · %s %s %s · %s ใช้ไป %s จาก %s วันทำงาน · ต้องส่งรายงานปัญหาก่อนกดเสร็จ',
            j.customer_name, j.product_name, v_qty, j.unit,
            coalesce(v_sla->>'segment_name', 'ช่วงงาน'),
            coalesce(v_sla->>'segment_days', '?'),
            coalesce(v_sla->>'segment_sla_days', '?'));
        else
          v_body := format('%s · %s %s %s · สถานีนี้ใช้ไป %s จาก %s วันทำงาน · ต้องส่งรายงานปัญหาก่อนกดเสร็จ',
            j.customer_name, j.product_name, v_qty, j.unit,
            coalesce(v_sla->>'station_days', '?'),
            coalesce(v_sla->>'station_sla_days', '?'));
        end if;
        if private.inbox_emit('sla_over', j.id, 'sla:' || j.id || ':' || j.visit,
          'เกินเวลามาตรฐาน ' || j.confirmation_no, v_body, array['production', 'admin', 'manager'])
        then v_added := v_added + 1; end if;
      end if;
    end if;

    -- 2. ฟิล์มที่สั่ง (DTF / DTG / สกรีน) เลยกำหนด
    if private.uses_film(j.route_code) and j.dtf_film_received_at is null and j.dtf_film_eta is not null and v_today > j.dtf_film_eta then
      if private.inbox_emit('film_late', j.id, 'film:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        private.film_label(j.route_code) || ' เลยกำหนด ' || j.confirmation_no,
        format('%s · %s %s %s · กำหนดรับ %s · กรุณาติดตาม%s',
          j.customer_name, j.product_name, v_qty, j.unit, to_char(j.dtf_film_eta, 'DD/MM/YYYY'), private.film_label(j.route_code)),
        array['admin', 'production'])
      then v_added := v_added + 1; end if;
    end if;

    -- 3. รอวัตถุดิบเกิน 2 วันทำงาน
    if j.phase = 'materials' and private.work_days(j.stage_entered_at, now()) > 2 then
      select array_agg(distinct m.dept) into v_depts
      from public.job_materials m where m.job_id = j.id and m.checked_at is null;
      if v_depts is not null and cardinality(v_depts) > 0 then
        if private.inbox_emit('materials_late', j.id, 'mat:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
          'รอตรวจวัตถุดิบเกิน 2 วัน ' || j.confirmation_no,
          format('%s · %s %s %s · กรุณาตรวจเช็กวัตถุดิบเพื่อปล่อยงาน%s',
            j.customer_name, j.product_name, v_qty, j.unit,
            case when j.needs_sample then 'ขึ้นตัวอย่าง' else 'เข้าผลิต' end),
          v_depts)
        then v_added := v_added + 1; end if;
      end if;
    end if;

    -- 4. ใกล้กำหนดส่ง (วันนี้หรือพรุ่งนี้ เวลาไทย)
    if j.due_date in (v_today, v_today + 1) then
      if private.inbox_emit('due_soon', j.id, 'due:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        case when j.due_date = v_today then 'ครบกำหนดส่งวันนี้ ' else 'ครบกำหนดส่งพรุ่งนี้ ' end || j.confirmation_no,
        format('%s · %s %s %s · กำหนดส่ง %s',
          j.customer_name, j.product_name, v_qty, j.unit, to_char(j.due_date, 'DD/MM/YYYY')),
        array['production', 'admin', 'manager'])
      then v_added := v_added + 1; end if;
    end if;
  end loop;

  return v_added;
end $$;

-- ฟังก์ชันช่วยใหม่ไม่เปิดให้เรียกตรง (ตามกติกาเดิมของ schema private)
revoke all on function private.uses_film(text) from public, anon;
revoke all on function private.film_label(text) from public, anon;
