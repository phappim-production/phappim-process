-- กล่องข้อความ Callout วางในขอบว่างรอบภาพได้ (นอกภาพ -0.5 ถึง 1.5) ไม่บังลาย · จุดยังต้องอยู่บนภาพ
-- save_mockup_draft เหมือน 20261120190000 ทุกอย่าง ยกเว้นช่วงพิกัดกล่อง

alter table public.mockup_callouts drop constraint mockup_callouts_box_x_check;
alter table public.mockup_callouts drop constraint mockup_callouts_box_y_check;
alter table public.mockup_callouts add constraint mockup_callouts_box_x_check check (box_x between -0.5 and 1.5);
alter table public.mockup_callouts add constraint mockup_callouts_box_y_check check (box_y between -0.5 and 1.5);

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
     or (e ->> 'box_x')::numeric not between -0.5 and 1.5 or (e ->> 'box_y')::numeric not between -0.5 and 1.5;
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
