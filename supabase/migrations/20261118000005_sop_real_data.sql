-- =====================================================================
-- A6 · ข้อมูลจริงจาก PP-SOP-01 ร่าง 0.2 ที่หน้างานกรอกกลับมา (17 พ.ย. 2569)
-- 1) จักรเย็บจริง 21 ตัว + สูตรจักรของสินค้าที่ใช้ได้กับจักรที่มีจริง
-- 2) รหัสสาเหตุ: แยก W1 W2 F1 ตามที่หน้างานขอ
-- 3) ขั้นย่อยของ พิมพ์ · รีด · ตัด · รีด DTF · QC+แพ็ค ตาม SOP (เย็บใช้แบบย่อเดิม)
-- 4) เวลามาตรฐานตามจำนวนงาน (งานใหญ่ได้เวลามากขึ้น)
-- ข้อที่หน้างานติ๊ก "แก้" แต่ยังไม่บอกว่าแก้อะไร (พิมพ์ข้อ 13 · ตัดข้อ 1) ตั้งเป็นเช็คลิสต์ไม่บังคับไว้ก่อน
-- เพื่อไม่ให้ขั้นที่ยังเข้าใจไม่ตรงกันมาขวางการกดเสร็จ · แก้ได้ที่หน้าตั้งค่าเมื่อได้คำตอบ
-- =====================================================================

-- ---------- 1. จักรเย็บจริง (PP-SOP-01 หน้า 9) ----------
-- นับได้: เข็มเดี่ยว 14 · โพ้ง 4 เส้น 4 · จักรลา 1 · ติดกระดุม 1 · เจาะรังดุม 1 (ใช้ได้ทุกตัว) · ชนิดอื่นไม่มี
insert into public.sewing_machines (code, type_code, sort)
select t.prefix || '-' || lpad(n::text, 2, '0'), t.code, t.sort * 100 + n
from (values ('single', 14), ('ovl4', 4), ('cover', 1), ('button', 1), ('buttonhole', 1)) as c(type_code, qty)
join public.machine_types t on t.code = c.type_code
cross join lateral generate_series(1, c.qty) n;

-- สูตรจักร: หน้างานใช้จักรที่มีแทนชนิดที่ไม่มี ("อแด็ปไปใช้ได้")
-- โปโล/เชิ้ต: จักรลาแทนสองเข็ม · กางเกง: เข็มเดี่ยวแทนจักรลา
update public.product_machine_needs set type_code = 'cover'
where type_code = 'double' and product_type_code in ('polo', 'gown', 'student', 'hawaii');
update public.product_machine_needs set type_code = 'single'
where type_code = 'cover' and product_type_code in ('elephant', 'muaythai', 'pajama', 'scrub');
-- ชนิดที่โรงงานไม่มี (ลาคอ ยางยืด สองเข็ม โพ้ง 3/5 เข้าขอบ) ไม่ต้องรอ ถ้ายังอยู่ในสูตรจะเริ่มเย็บไม่ได้ตลอด
delete from public.product_machine_needs
where type_code in ('flat', 'elastic', 'double', 'ovl3', 'ovl5', 'binding');

-- ---------- 2. รหัสสาเหตุ (PP-SOP-01 หน้า 3) ----------
-- หน้างานแยก "ไม่พอ" กับ "ยังไม่มา" เพราะคนตามต่างกัน
update public.reason_codes set name = 'ผ้าไม่พอ'  where code = 'W1';
update public.reason_codes set name = 'กระดาษหมด' where code = 'W2';
update public.reason_codes set name = 'ไฟล์ผิด'    where code = 'F1';
insert into public.reason_codes (code, grp, name, sort) values
  ('W5', 'วัตถุดิบ', 'ผ้ายังไม่มา', 45),
  ('W6', 'วัตถุดิบ', 'หมึกหมด', 55),
  ('F4', 'ไฟล์และข้อมูล', 'ไฟล์ยังไม่มา', 85);

-- ---------- 3. ขั้นย่อยตาม SOP ----------
-- คีย์เดิมที่ระบบใช้คำนวณ (check_print, check_color, sort_count, film_received, check_adhesion, inspect, count, boxed) คงไว้
update public.stations set substeps = '[
  {"key":"receive_job","name":"รับใบงานและไฟล์ (ตรงใบยืนยันฉบับเซ็น)","kind":"req"},
  {"key":"check_file","name":"ตรวจไฟล์ (ขนาดจริง · bleed · ชื่อ/เบอร์)","kind":"req"},
  {"key":"nesting","name":"จัดเลย์เอาต์และบันทึกไฟล์ .TIF","kind":"req"},
  {"key":"rip","name":"ตั้งค่า RIP (โปรไฟล์สี · กลับด้าน)","kind":"req"},
  {"key":"check_ink","name":"ตรวจหมึก","kind":"opt"},
  {"key":"check_head","name":"ตรวจหัวพิมพ์ (Nozzle check)","kind":"req"},
  {"key":"pick_roll","name":"เลือกม้วนกระดาษ","kind":"opt"},
  {"key":"load_roll","name":"นำม้วนกระดาษเข้าเครื่อง","kind":"opt"},
  {"key":"take_up","name":"ตั้งม้วนเก็บ (Take-up)","kind":"opt"},
  {"key":"test_print","name":"พิมพ์ทดสอบ เทียบตัวอย่างที่ผ่าน","kind":"appr"},
  {"key":"print","name":"พิมพ์งานจริงและเฝ้าเครื่อง","kind":"opt"},
  {"key":"check_print","name":"ตรวจงานพิมพ์","kind":"req"},
  {"key":"split_roll","name":"ตัดแยกม้วน ติดป้าย บันทึก","kind":"opt"}]'
where code = 'print';

update public.stations set substeps = '[
  {"key":"receive_roll","name":"รับม้วนกระดาษพิมพ์","kind":"req"},
  {"key":"receive_fabric","name":"รับผ้า (ชนิด สี ความยาวตรงใบยืนยัน)","kind":"req"},
  {"key":"heat","name":"อุ่นเครื่องรีดโรล (อุณหภูมิ °C)","kind":"num"},
  {"key":"speed","name":"ตั้งความเร็ว / เวลาสัมผัส / แรงกด (ความเร็ว)","kind":"num"},
  {"key":"test_press","name":"รีดทดสอบ เทียบสีกับชิ้นที่ผ่าน","kind":"appr"},
  {"key":"feed","name":"ป้อนผ้า + กระดาษพิมพ์ + กระดาษรอง","kind":"opt"},
  {"key":"press","name":"รีดทั้งม้วน","kind":"opt"},
  {"key":"rewind","name":"ม้วนเก็บผ้าและลอกกระดาษ","kind":"opt"},
  {"key":"check_color","name":"ตรวจสีและการติด","kind":"req"},
  {"key":"record_label","name":"บันทึกและติดป้าย (เมตรผ้าที่ใช้)","kind":"num"}]'
where code = 'press';

update public.stations set substeps = '[
  {"key":"receive_fabric","name":"รับผ้า","kind":"opt"},
  {"key":"pattern","name":"รับแพทเทิร์น / ไฟล์ตัดจากแอดมิน","kind":"opt"},
  {"key":"spread","name":"ปูผ้า (ตัดมือ: ปูทีละชั้น · เลเซอร์: ปูให้เรียบ)","kind":"opt"},
  {"key":"cut","name":"ตัดตามขอบลาย / แพทเทิร์น","kind":"opt"},
  {"key":"check_cut","name":"ตรวจชิ้นตัด (ขนาด · ขอบ · ลาย)","kind":"req"},
  {"key":"bundle","name":"คัดแยกและมัดชุด","kind":"opt"},
  {"key":"sort_count","name":"นับชิ้น (จำนวนชิ้นดี)","kind":"num"},
  {"key":"handoff","name":"ส่งต่อพร้อมใบนับ","kind":"req"}]'
where code = 'cut';

-- รีด DTF: หน้างานยืนยันแล้ว · รีดทดสอบไม่จำเป็นเมื่อตำแหน่งระบุชัด
update public.stations set is_draft = false, substeps = '[
  {"key":"film_received","name":"ได้รับฟิล์ม DTF","kind":"lock"},
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

-- แยกงานไม่ผ่าน: บังคับเฉพาะเมื่อมีงานไม่ผ่าน ซึ่ง send_rework บังคับจำนวน+สาเหตุ+สถานีอยู่แล้ว จึงไม่บังคับติ๊กซ้ำ
update public.stations set substeps = '[
  {"key":"receive","name":"รับงานจากเย็บ (ยอดตรงใบนับ)","kind":"req"},
  {"key":"inspect","name":"ตรวจทีละชิ้น (ผ่าน / ไม่ผ่าน)","kind":"num"},
  {"key":"separate","name":"แยกงานไม่ผ่าน","kind":"opt"},
  {"key":"clean","name":"รีด / ทำความสะอาดก่อนแพ็ค","kind":"opt"},
  {"key":"fold","name":"พับตามมาตรฐาน","kind":"opt"},
  {"key":"bag_label","name":"บรรจุถุงและติดป้ายไซซ์","kind":"opt"},
  {"key":"count","name":"นับยอดรวม","kind":"num"},
  {"key":"boxed","name":"ลงลังและติดใบปะหน้า","kind":"req"},
  {"key":"photo","name":"ถ่ายรูปก่อนปิดลัง","kind":"opt"}]'
where code = 'qc_pack';

-- ---------- 4. เวลามาตรฐานตามจำนวนงาน ----------
-- big_qty: งานตั้งแต่กี่ชิ้นขึ้นไปใช้ big_sla_days แทน · big_sla_days ว่าง = งานขนาดนั้นยังไม่จับเวลา (ยังไม่มีข้อมูล)
alter table public.stations
  add column big_qty int check (big_qty is null or big_qty > 0),
  add column big_sla_days numeric check (big_sla_days is null or big_sla_days > 0),
  add constraint stations_big_sla_needs_qty check (big_sla_days is null or big_qty is not null);
alter table public.sla_segments
  add column big_qty int check (big_qty is null or big_qty > 0),
  add column big_sla_days numeric check (big_sla_days is null or big_sla_days > 0),
  add constraint sla_segments_big_sla_needs_qty check (big_sla_days is null or big_qty is not null);

-- พิมพ์ + รีด + ตัด: ปกติ ≤ 3 วัน · 700 ตัวขึ้นไป ≤ 5 วัน (เสร็จก่อนได้)
update public.sla_segments set sla_days = 3, big_qty = 700, big_sla_days = 5 where code = 'subli_ppc';
-- แต่ละสถานีในช่วงนี้ "ขึ้นอยู่กับจำนวนงาน" → คุมที่ช่วงอย่างเดียว ไม่จับเวลารายสถานี
update public.stations set sla_days = null where code in ('print', 'press', 'cut');
-- เย็บ: โปโล 1–100 ตัว 2 วัน · QC: 100 ตัว 5 คน 2 ชม. → 1 วัน · งานเกิน 100 ยังไม่มีข้อมูล จึงไม่จับเวลา
update public.stations set sla_days = 2, big_qty = 101 where code = 'sew';
update public.stations set sla_days = 1, big_qty = 101 where code = 'qc_pack';

-- เวลามาตรฐานที่ใช้กับงานนี้ (null = ไม่จับเวลา)
create or replace function private.sla_for_qty(p_days numeric, p_big_qty int, p_big_days numeric, p_qty int) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_big_qty is not null and p_qty >= p_big_qty then p_big_days else p_days end
$$;

-- เหมือนเดิมทุกอย่าง ยกเว้นใช้เวลามาตรฐานตามจำนวนงาน
create or replace function private.sla_state(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  j public.jobs; st public.stations; seg public.sla_segments;
  cur text; el numeric; seg_start timestamptz; seg_el numeric; reported boolean; seg_reported boolean;
  st_days numeric; seg_days numeric;
  res jsonb := '{}';
begin
  select * into j from public.jobs where id = p_job;
  if not found or j.phase <> 'production' or j.station_seq is null then return res; end if;
  cur := private.station_at(j.route_code, j.station_seq);
  select * into st from public.stations where code = cur;
  st_days := private.sla_for_qty(st.sla_days, st.big_qty, st.big_sla_days, j.qty);

  if j.station_started_at is not null and st_days is not null and not j.is_rework then
    el := private.work_days(j.station_started_at, now()) - private.hold_days(j.id, j.station_started_at);
    select exists (select 1 from public.delay_reports d where d.job_id = j.id and d.visit = j.visit) into reported;
    res := res || jsonb_build_object(
      'station_sla_days', st_days, 'station_days', round(greatest(el, 0), 3),
      'station_warn', el >= st_days * st.warn_pct / 100.0,
      'station_over', el > st_days, 'station_reported', reported);
  end if;

  seg := private.segment_of(j.route_code, cur);
  seg_days := private.sla_for_qty(seg.sla_days, seg.big_qty, seg.big_sla_days, j.qty);
  if seg.code is not null and seg_days is not null and not j.is_rework then
    -- เริ่มนับจากครั้งแรกที่เริ่มสถานีต้นช่วงในการผลิตจริง (งานแก้ที่ย้อนกลับมาไม่เริ่มนับใหม่)
    select min(e.at) into seg_start from public.events e
    where e.job_id = j.id and e.type = 'station_start' and e.phase = 'production' and e.station_code = seg.from_station
      and not coalesce((e.payload->>'rework')::boolean, false);
    if seg_start is not null then
      seg_el := private.work_days(seg_start, now()) - private.hold_days(j.id, seg_start);
      select exists (select 1 from public.delay_reports d where d.job_id = j.id and d.segment_code = seg.code and d.at >= seg_start)
        into seg_reported;
      res := res || jsonb_build_object(
        'segment_code', seg.code, 'segment_name', seg.name, 'segment_sla_days', seg_days,
        'segment_days', round(greatest(seg_el, 0), 3),
        'segment_warn', seg_el >= seg_days * seg.warn_pct / 100.0,
        'segment_over', seg_el > seg_days, 'segment_reported', seg_reported);
    end if;
  end if;
  return res;
end $$;
