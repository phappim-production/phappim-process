-- ขนาดลายพิมพ์ในใบยืนยันเลือกหน่วยได้ (placements__unit = ซม. / นิ้ว) · ค่าที่ม็อคอัพอ้างต้องต่อหน่วยตามที่เลือก

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
      case when nullif(trim(x ->> 'size'), '') is null then null
        when trim(x ->> 'size') ~ '^[0-9 .,xX×*/-]+$' then trim(x ->> 'size') || case when base ->> 'placements__unit' = 'นิ้ว' then ' นิ้ว' else ' ซม.' end
        else trim(x ->> 'size') end,
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
