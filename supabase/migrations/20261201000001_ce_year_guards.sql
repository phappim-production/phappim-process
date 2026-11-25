-- ข้อความแจ้งเตือนกำหนดส่ง/ฟิล์มแสดงปี พ.ศ. เหมือนข้อความอื่น · ปฏิเสธวันที่ที่ปีอยู่นอก ค.ศ. 2000–2399 (พิมพ์ปี พ.ศ. ลงช่องวันที่)

create or replace function private.inbox_scan_all() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_added integer := 0;
  j record;
  v_lead jsonb;
  v_depts text[];
  v_qty text;
begin
  for j in
    select jb.*, pt.name as product_name
    from public.jobs jb
    join public.product_types pt on pt.code = jb.product_type_code
    where jb.phase not in ('done', 'cancelled')
  loop
    v_qty := to_char(j.qty, 'FM999,999,999');

    v_lead := private.lead_state(j.id);
    if coalesce((v_lead->>'lead_over')::boolean, false) and not coalesce((v_lead->>'lead_reported')::boolean, false) then
      if private.inbox_emit('sla_over', j.id, 'lead:' || j.id,
        'เกินเวลาผลิต ' || j.confirmation_no,
        format('%s · %s %s %s · รับงาน %s · เวลาผลิต %s วันทำงาน ครบ %s · ต้องส่งรายงานสาเหตุก่อนกด QC + Packing เสร็จ',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date((v_lead->>'lead_start')::date),
          v_lead->>'lead_days', private.thai_date((v_lead->>'lead_due')::date)),
        array['production', 'admin', 'manager'])
      then v_added := v_added + 1; end if;
    end if;

    if private.uses_film(j.route_code) and j.dtf_film_received_at is null and j.dtf_film_eta is not null and v_today > j.dtf_film_eta then
      if private.inbox_emit('film_late', j.id, 'film:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        private.film_label(j.route_code) || ' เลยกำหนด ' || j.confirmation_no,
        format('%s · %s %s %s · กำหนดรับ %s · กรุณาติดตาม%s',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date(j.dtf_film_eta), private.film_label(j.route_code)),
        array['admin', 'production'])
      then v_added := v_added + 1; end if;
    end if;

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

    if j.due_date in (v_today, v_today + 1) then
      if private.inbox_emit('due_soon', j.id, 'due:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        case when j.due_date = v_today then 'ครบกำหนดส่งวันนี้ ' else 'ครบกำหนดส่งพรุ่งนี้ ' end || j.confirmation_no,
        format('%s · %s %s %s · กำหนดส่ง %s',
          j.customer_name, j.product_name, v_qty, j.unit, private.thai_date(j.due_date)),
        array['production', 'admin', 'manager'])
      then v_added := v_added + 1; end if;
    end if;
  end loop;

  return v_added;
end $$;

-- ช่องวันที่ของเบราว์เซอร์เก็บปี ค.ศ. · พิมพ์ปี พ.ศ. (เช่น 2569) ลงไปจะได้ปีที่ไกลเกินจริงโดยไม่มีอะไรเตือน
create or replace function private.guard_ce_year() returns trigger
language plpgsql set search_path = '' as $$
declare col text; y int; rec jsonb := to_jsonb(new);
begin
  foreach col in array tg_argv loop
    y := (regexp_match(rec ->> col, '^(\d+)-'))[1]::int;
    if y is not null and y not between 2000 and 2399 then
      raise exception 'ปี % ไม่ถูกต้อง · ระบบใช้ปี ค.ศ. (พ.ศ. 2569 = ค.ศ. 2026) เลือกวันจากปฏิทินใหม่', y using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.guard_ce_year() from public, anon, authenticated;

create trigger jobs_ce_year before insert or update of due_date, dtf_film_eta on public.jobs
  for each row execute function private.guard_ce_year('due_date', 'dtf_film_eta');
create trigger sample_results_ce_year before insert or update of customer_confirmed_at on public.sample_results
  for each row execute function private.guard_ce_year('customer_confirmed_at');
create trigger delay_reports_ce_year before insert or update of new_eta on public.delay_reports
  for each row execute function private.guard_ce_year('new_eta');
create trigger sewing_machines_ce_year before insert or update of repair_eta on public.sewing_machines
  for each row execute function private.guard_ce_year('repair_eta');
create trigger machine_status_log_ce_year before insert or update of repair_eta on public.machine_status_log
  for each row execute function private.guard_ce_year('repair_eta');
create trigger machine_bookings_ce_year before insert or update of starts_at, ends_at on public.machine_bookings
  for each row execute function private.guard_ce_year('starts_at', 'ends_at');
create trigger outsource_runs_ce_year before insert or update of arrive_at, back_at on public.outsource_runs
  for each row execute function private.guard_ce_year('arrive_at', 'back_at');
