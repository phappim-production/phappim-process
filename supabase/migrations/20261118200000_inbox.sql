-- กล่องจดหมายแจ้งเตือนในระบบ (S10 · C3 · แทน LINE)
-- หลักการ: trigger แค่เพิ่มแถว ห้ามเรียก HTTP · พังไม่ให้กระทบงานหลัก (เก็บลง inbox_errors)
-- ไม่ซ้ำด้วย dedupe_key · อ่านแล้วแยกตามผู้ใช้ (inbox_reads) · ตรวจตามรอบผ่าน inbox_scan()

create table public.inbox_messages (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in (
    'hold', 'delay_report', 'rework', 'sewing_issue', 'machine_broken',
    'sample_failed', 'sla_over', 'film_late', 'materials_late', 'due_soon'
  )),
  job_id     uuid references public.jobs(id) on delete cascade,
  dedupe_key text unique not null,
  title      text not null,
  body       text not null,
  audience   text[] not null,
  created_at timestamptz not null default now()
);
create index inbox_messages_job_idx on public.inbox_messages (job_id);
create index inbox_messages_created_idx on public.inbox_messages (created_at desc);

create table public.inbox_reads (
  message_id bigint not null references public.inbox_messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index inbox_reads_user_idx on public.inbox_reads (user_id);

create table public.inbox_errors (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  source  text not null,
  message text not null
);

create table public.inbox_settings (
  kind    text primary key,
  enabled boolean not null default true
);

insert into public.inbox_settings (kind, enabled) values
  ('hold', true),
  ('delay_report', true),
  ('rework', true),
  ('sewing_issue', true),
  ('machine_broken', true),
  ('sample_failed', true),
  ('sla_over', true),
  ('film_late', true),
  ('materials_late', true),
  ('due_soon', true);

-- ---------- RLS (เขียนผ่านฟังก์ชันเท่านั้น · ไม่มี policy อ่านซ้อนกัน) ----------
alter table public.inbox_messages enable row level security;
alter table public.inbox_reads    enable row level security;
alter table public.inbox_errors   enable row level security;
alter table public.inbox_settings enable row level security;

create policy inbox_messages_read on public.inbox_messages for select to authenticated
  using ((select private.is_owner()) or (select private.my_role()) = any(audience));

create policy inbox_reads_read on public.inbox_reads for select to authenticated
  using (user_id = (select auth.uid()) and (select private.my_role()) is not null);

create policy inbox_errors_read on public.inbox_errors for select to authenticated
  using ((select private.is_owner()));

create policy inbox_settings_read on public.inbox_settings for select to authenticated
  using ((select private.my_role()) is not null);
create policy inbox_settings_owner_insert on public.inbox_settings for insert to authenticated
  with check ((select private.is_owner()));
create policy inbox_settings_owner_update on public.inbox_settings for update to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
create policy inbox_settings_owner_delete on public.inbox_settings for delete to authenticated
  using ((select private.is_owner()));

-- ---------- ฟังก์ชันภายใน: บันทึกข้อความและข้อผิดพลาด ----------
create or replace function private.inbox_log_error(p_source text, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inbox_errors (source, message) values (p_source, coalesce(p_message, 'unknown error'));
exception when others then null;
end $$;

create or replace function private.inbox_emit(
  p_kind text, p_job_id uuid, p_dedupe_key text, p_title text, p_body text, p_audience text[]
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_enabled boolean; v_id bigint;
begin
  if p_audience is null or cardinality(p_audience) = 0 then return false; end if;
  select s.enabled into v_enabled from public.inbox_settings s where s.kind = p_kind;
  if coalesce(v_enabled, true) = false then return false; end if;
  insert into public.inbox_messages (kind, job_id, dedupe_key, title, body, audience)
  values (p_kind, p_job_id, p_dedupe_key, p_title, p_body, p_audience)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id is not null;
end $$;

-- ---------- Trigger ทันทีเมื่อเกิดเหตุการณ์ในระบบ ----------
create or replace function private.on_event_inbox() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs; pt_name text; st_name text; dr public.delay_reports;
  v_qty text; v_eta text;
begin
  if new.type not in ('hold', 'delay_report', 'rework', 'sewing_issue_reported', 'sample_result') then
    return new;
  end if;
  if new.type = 'sample_result' and coalesce((new.payload->>'pass')::boolean, true) then
    return new;
  end if;

  select * into j from public.jobs where id = new.job_id;
  if not found then return new; end if;
  select name into pt_name from public.product_types where code = j.product_type_code;
  pt_name := coalesce(pt_name, j.product_type_code);
  v_qty := to_char(j.qty, 'FM999,999,999');

  if new.station_code is not null then
    select name into st_name from public.stations where code = new.station_code;
  end if;

  if new.type = 'hold' then
    perform private.inbox_emit(
      'hold', j.id,
      'hold:' || coalesce(new.payload->>'issue_id', new.id::text),
      'งานติดปัญหา ' || j.confirmation_no,
      format('%s · %s %s %s · สถานี%s · สาเหตุ: %s',
        j.customer_name, pt_name, v_qty, j.unit, coalesce(st_name, '-'),
        coalesce(nullif(trim(new.payload->>'reason'), ''), '-')),
      array['production', 'admin', 'manager']
    );

  elsif new.type = 'delay_report' then
    if (new.payload->>'report_id') is not null then
      select * into dr from public.delay_reports where id = (new.payload->>'report_id')::bigint;
    end if;
    v_eta := coalesce(
      to_char(coalesce(dr.new_eta, (new.payload->>'new_eta')::timestamptz) at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'),
      '-'
    );
    perform private.inbox_emit(
      'delay_report', j.id,
      'delay:' || coalesce(new.payload->>'report_id', new.id::text),
      'รายงานล่าช้า ' || j.confirmation_no,
      format('%s · %s %s %s · คาดว่าเสร็จ %s · %s',
        j.customer_name, pt_name, v_qty, j.unit, v_eta, coalesce(nullif(trim(dr.detail), ''), '-')),
      array['production', 'admin', 'manager']
    );

  elsif new.type = 'rework' then
    perform private.inbox_emit(
      'rework', j.id,
      'rework:' || new.id,
      'งานส่งแก้ ' || j.confirmation_no,
      format('%s · %s %s %s · ส่งแก้ %s %s ที่%s · สาเหตุ: %s',
        j.customer_name, pt_name, v_qty, j.unit,
        coalesce(new.payload->>'qty', '?'), j.unit, coalesce(st_name, '-'),
        coalesce(nullif(trim(new.payload->>'reason'), ''), '-')),
      array['production', 'qc', 'admin']
    );

  elsif new.type = 'sewing_issue_reported' then
    perform private.inbox_emit(
      'sewing_issue', j.id,
      'sewissue:' || new.id,
      'ปัญหาที่สถานีเย็บ ' || j.confirmation_no,
      format('%s · %s %s %s · %s',
        j.customer_name, pt_name, v_qty, j.unit,
        coalesce(nullif(trim(new.payload->>'reason'), ''), '-')),
      array['production']
    );

  elsif new.type = 'sample_result' then
    perform private.inbox_emit(
      'sample_failed', j.id,
      'sample:' || new.id,
      'ตัวอย่างไม่ผ่าน ' || j.confirmation_no,
      format('%s · %s %s %s · รอบ %s · แก้ไข: %s',
        j.customer_name, pt_name, v_qty, j.unit,
        coalesce(new.payload->>'round', '1'),
        coalesce(nullif(trim(new.payload->>'note'), ''), '-')),
      array['production', 'admin']
    );
  end if;

  return new;
exception when others then
  perform private.inbox_log_error('on_event_inbox', sqlerrm);
  return new;
end $$;

create trigger events_inbox_after_insert
  after insert on public.events
  for each row execute function private.on_event_inbox();

create or replace function private.on_machine_log_inbox() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_prev text; m_code text; mt_name text; j_no text; v_eta text;
begin
  if new.status <> 'broken' then return new; end if;

  -- ไม่นับแถวกำหนด/เลื่อนเวลาซ่อม (set_repair_eta) ซึ่งสถานะก่อนหน้าเป็น broken อยู่แล้ว
  select l.status into v_prev
  from public.machine_status_log l
  where l.machine_id = new.machine_id and l.id < new.id
  order by l.id desc limit 1;
  if v_prev = 'broken' then return new; end if;

  select m.code, mt.name into m_code, mt_name
  from public.sewing_machines m
  join public.machine_types mt on mt.code = m.type_code
  where m.id = new.machine_id;
  if not found then return new; end if;

  if new.job_id is not null then
    select confirmation_no into j_no from public.jobs where id = new.job_id;
  end if;
  v_eta := case when new.repair_eta is not null
    then ' · คาดว่าซ่อมเสร็จ ' || to_char(new.repair_eta at time zone 'Asia/Bangkok', 'DD/MM HH24:MI')
    else '' end;

  perform private.inbox_emit(
    'machine_broken', new.job_id,
    'machine:' || new.id,
    'จักร ' || m_code || ' เสีย' || coalesce(' (' || j_no || ')', ''),
    format('%s · อาการ: %s%s', mt_name, coalesce(nullif(trim(new.note), ''), '-'), v_eta),
    array['production']
  );

  return new;
exception when others then
  perform private.inbox_log_error('on_machine_log_inbox', sqlerrm);
  return new;
end $$;

create trigger machine_status_log_inbox_after_insert
  after insert on public.machine_status_log
  for each row execute function private.on_machine_log_inbox();

-- ---------- ตรวจตามรอบ (เรียกจากหน้าเว็บทุก 5 นาที หรือ pg_cron) ----------
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

    -- 2. ฟิล์ม DTF เลยกำหนด
    if j.route_code = 'dtf' and j.dtf_film_received_at is null and j.dtf_film_eta is not null and v_today > j.dtf_film_eta then
      if private.inbox_emit('film_late', j.id, 'film:' || j.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
        'ฟิล์ม DTF เลยกำหนด ' || j.confirmation_no,
        format('%s · %s %s %s · กำหนดรับฟิล์ม %s · กรุณาติดตามฟิล์ม',
          j.customer_name, j.product_name, v_qty, j.unit, to_char(j.dtf_film_eta, 'DD/MM/YYYY')),
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
          format('%s · %s %s %s · กรุณาตรวจเช็กวัตถุดิบเพื่อปล่อยงานขึ้นตัวอย่าง',
            j.customer_name, j.product_name, v_qty, j.unit),
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

-- ---------- RPC สำหรับหน้าเว็บ ----------
create or replace function public.inbox_scan() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if private.my_role() is null then
    raise exception 'ไม่มีสิทธิ์เข้าใช้งาน' using errcode = '42501';
  end if;
  return private.inbox_scan_all();
end $$;

create or replace function public.inbox_mark_read(p_ids bigint[]) returns void
language plpgsql security definer set search_path = '' as $$
declare r text := private.my_role(); uid uuid := auth.uid();
begin
  if r is null or uid is null then
    raise exception 'ไม่มีสิทธิ์เข้าใช้งาน' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  insert into public.inbox_reads (message_id, user_id)
  select m.id, uid
  from public.inbox_messages m
  where m.id = any(p_ids) and (r = 'owner' or r = any(m.audience))
  on conflict (message_id, user_id) do nothing;
end $$;

create or replace function public.inbox_mark_all_read() returns void
language plpgsql security definer set search_path = '' as $$
declare r text := private.my_role(); uid uuid := auth.uid();
begin
  if r is null or uid is null then
    raise exception 'ไม่มีสิทธิ์เข้าใช้งาน' using errcode = '42501';
  end if;
  insert into public.inbox_reads (message_id, user_id)
  select m.id, uid
  from public.inbox_messages m
  where (r = 'owner' or r = any(m.audience))
    and not exists (select 1 from public.inbox_reads rd where rd.message_id = m.id and rd.user_id = uid)
  on conflict (message_id, user_id) do nothing;
end $$;

create or replace function public.inbox_unread_count() returns integer
language plpgsql stable security definer set search_path = '' as $$
declare r text := private.my_role(); uid uuid := auth.uid();
begin
  if r is null or uid is null then
    raise exception 'ไม่มีสิทธิ์เข้าใช้งาน' using errcode = '42501';
  end if;
  return (
    select count(*)::int
    from public.inbox_messages m
    where (r = 'owner' or r = any(m.audience))
      and not exists (select 1 from public.inbox_reads rd where rd.message_id = m.id and rd.user_id = uid)
  );
end $$;

revoke all on function public.inbox_scan() from public, anon;
revoke all on function public.inbox_mark_read(bigint[]) from public, anon;
revoke all on function public.inbox_mark_all_read() from public, anon;
revoke all on function public.inbox_unread_count() from public, anon;
grant execute on function public.inbox_scan() to authenticated;
grant execute on function public.inbox_mark_read(bigint[]) to authenticated;
grant execute on function public.inbox_mark_all_read() to authenticated;
grant execute on function public.inbox_unread_count() to authenticated;

-- ---------- Realtime & pg_cron (ห่อด้วยเงื่อนไข เผื่อไม่มีใน PGlite) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.inbox_messages, public.inbox_reads;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('inbox-scan-5m', '*/5 * * * *', 'select private.inbox_scan_all()');
  end if;
exception when others then null;
end $$;
