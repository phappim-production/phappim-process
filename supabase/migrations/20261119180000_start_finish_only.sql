-- สถานีเหลือแค่ เริ่ม → เสร็จ (+ รายงานปัญหา / พักงาน) · เจ้าของโปรเจกต์ตัดสินใจ 17 พ.ย.
-- คนหน้างานรู้ขั้นตอนอยู่แล้ว เช็คลิสต์ขั้นย่อยทำให้เสียเวลาและบังคับวิธีทำงานเกินไป
-- จึงไม่บังคับติ๊กขั้นย่อยก่อนกดเสร็จอีก · เหลือเฉพาะเงื่อนไขที่ระบบใช้จริง:
--   1) ขั้นแบบ lock (ได้รับฟิล์ม DTF / DTG / สกรีน) · แอดมินบันทึกรับของ ไม่ใช่คนหน้างานติ๊ก
--   2) QC + Packing (ผลิตจริง): จำนวนที่ QC ผ่านต้องครบ · ชิ้นไม่ผ่านส่งกลับแก้ (งานแก้ + รายงานสาเหตุ)
-- เกินเวลามาตรฐานยังต้องรายงานก่อนกดเสร็จ (อยู่ใน finish_station ไม่เปลี่ยน)
-- ขั้นย่อยใน stations.substeps และ check_substep ยังอยู่ เผื่อกลับมาใช้ภายหลัง

create or replace function private.missing_substeps(p_job uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare j public.jobs; cur text; sub jsonb; k text; kind text; ok boolean; miss text[] := '{}';
begin
  select * into j from public.jobs where id = p_job;
  cur := private.station_at(j.route_code, j.station_seq);
  if cur = 'sew' or (j.is_rework and cur <> 'qc_pack') then return miss; end if;
  for sub in select s from public.stations st, jsonb_array_elements(st.substeps) s where st.code = cur loop
    k := sub->>'key'; kind := sub->>'kind';
    if kind = 'lock' then
      ok := j.dtf_film_received_at is not null;
    elsif cur = 'qc_pack' and k = 'inspect' and j.phase = 'production' then
      ok := coalesce((select sum(q.passed) from public.qc_results q where q.job_id = j.id), 0) >= j.qty;
    else
      continue;
    end if;
    if not ok then miss := miss || (sub->>'name'); end if;
  end loop;
  return miss;
end $$;
