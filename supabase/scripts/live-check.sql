-- ตรวจระบบบนฐานจริงด้วยบัญชีทดสอบ @pp142.test ทุกบทบาท · จบด้วย error "RESULTS[...]" = ยกเลิกทุกอย่าง ไม่เหลือข้อมูล
-- วางทั้งไฟล์ใน Supabase → SQL Editor → Run · อ่านผลใน error ("ok": false = ไม่ผ่าน)
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $f$
begin perform set_config('request.jwt.claim.sub', u::text, true); end $f$;

create or replace function pg_temp.ok(t_name text, u uuid, t_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform pg_temp.as_user(u);
  begin
    execute t_sql into v;
    insert into pg_temp.res values (t_name, true, coalesce(v, ''));
  exception when others then
    insert into pg_temp.res values (t_name, false, sqlerrm);
  end;
  return v;
end $f$;

create or replace function pg_temp.err(t_name text, u uuid, t_sql text, pat text) returns void language plpgsql as $f$
begin
  perform pg_temp.as_user(u);
  begin
    execute t_sql;
    insert into pg_temp.res values (t_name, false, 'ควรถูกปฏิเสธแต่ผ่าน');
  exception when others then
    insert into pg_temp.res values (t_name, sqlerrm ~ pat, sqlerrm);
  end;
end $f$;

create or replace function pg_temp.chk(t_name text, cond boolean, info text) returns void language plpgsql as $f$
begin insert into pg_temp.res values (t_name, coalesce(cond, false), coalesce(info, '')); end $f$;

create temp table if not exists res (name text, pass boolean, info text);
truncate pg_temp.res;

do $t$
declare
  adm uuid := '63ad8527-bd2d-4ea5-8f5c-e0602d1212a7';
  mgr uuid := '60c2aa77-751b-403d-a9aa-a042caca76b9';
  prd uuid := '34d97810-626e-42c1-a961-ae0a1da8f1b9';
  qcu uuid := '088bd56e-1d95-42df-8bd9-a7667f545b72';
  spec jsonb := '{"app":"phappim-confirm","v":1,"product":"tshirt","p":{"tshirt":{"neck":"คอกลม","print_method":["DTF"],"placements":{"หน้าอกซ้าย":{"on":true,"size":"8 × 8"},"กลางหลัง":{"on":true,"tech":"ซับลิเมชั่น","size":"25"}}}}}';
  j1 uuid; j2 uuid; s1 uuid; s2 uuid; v int; st text; folder text; payload jsonb; n int;
  out json;
begin
  -- งาน A: ปกติ ไม่ขึ้นตัวอย่าง · เดินครบ 5 สถานี + พัก/ทำต่อ + QC ส่งแก้
  j1 := pg_temp.ok('รับงานเข้า (admin)', adm, format($$select public.receive_job('TEST-LIVE-A','ลูกค้าทดสอบสด','งานทดสอบสด','tshirt',10,'ตัว',current_date + 7,'normal','',0,0,%L::jsonb,false)::text$$, spec))::uuid;
  perform pg_temp.err('QC รับงานเข้าไม่ได้', qcu, $$select public.receive_job('TEST-LIVE-X','x','x','tshirt',1,'ตัว',current_date+7,'normal','',0,0,'{}',false)$$, 'บทบาท|แอดมิน');
  perform pg_temp.chk('งานใหม่อยู่สถานีพิมพ์ รอคิว', (select current_station='print' and station_status='queued' from public.job_live where id=j1), (select current_station||'/'||station_status from public.job_live where id=j1));
  perform pg_temp.err('เริ่มงานที่ไม่ใช่คิวแรกโดยไม่มีเหตุผลไม่ได้', prd, format($$select public.start_in_queue(%L, null)$$, j1), 'คิว|เหตุผล');

  -- ม็อคอัพ: ร่าง → ส่ง → ส่งกลับ → ส่ง → อนุมัติ (ก่อนเริ่มผลิต)
  folder := private.mockup_folder('TEST-LIVE-A');
  insert into storage.objects (bucket_id, name) values ('mockups', folder || '/sheet/live-front.png'), ('mockups', folder || '/sheet/live-back.png');
  perform pg_temp.err('ฝ่ายผลิตสร้างม็อคอัพไม่ได้', prd, format($$select public.start_mockup_sheet(%L)$$, j1), 'บทบาท');
  s1 := pg_temp.ok('แอดมินเริ่มม็อคอัพ', adm, format($$select public.start_mockup_sheet(%L)::text$$, j1))::uuid;
  payload := jsonb_build_object(
    'views', jsonb_build_array(jsonb_build_object('view','front','image_path',folder||'/sheet/live-front.png','width',1600,'height',2000),
                               jsonb_build_object('view','back','image_path',folder||'/sheet/live-back.png','width',1600,'height',2000)),
    'specs', jsonb_build_array(jsonb_build_object('key','k1','code','S-01','name','ขอบคอ','kind','sewing','width',2,'unit','cm','stations',jsonb_build_array('sew'))),
    'callouts', jsonb_build_array(
      jsonb_build_object('view','front','no',1,'x',0.5,'y',0.1,'box_x',0.8,'box_y',0.05,'title','คอเสื้อ','spec_ref','field:neck','spec_key','k1','stations',jsonb_build_array('sew')),
      jsonb_build_object('view','front','no',2,'x',0.62,'y',0.3,'box_x',0.9,'box_y',0.3,'title','อกซ้าย','spec_ref','placement:หน้าอกซ้าย','stations',jsonb_build_array('print','press')),
      jsonb_build_object('view','back','no',3,'x',0.5,'y',0.4,'box_x',0.1,'box_y',0.4,'title','ด้านหลัง','spec_ref','placement:กลางหลัง','stations',jsonb_build_array())));
  perform pg_temp.err('ฝ่ายผลิตบันทึกร่างไม่ได้', prd, format($$select public.save_mockup_draft(%L,1,%L::jsonb)$$, s1, payload), 'บทบาท');
  perform pg_temp.err('รูปที่ไม่มีไฟล์จริงบันทึกไม่ได้', adm, format($$select public.save_mockup_draft(%L,1,%L::jsonb)$$, s1,
    jsonb_set(payload, '{views,0,image_path}', to_jsonb(folder || '/sheet/missing.png'))), 'ยังไม่พบรูป');
  v := pg_temp.ok('แอดมินบันทึกร่าง (ภาพ 2 · จุด 3 · สเปก 1)', adm, format($$select public.save_mockup_draft(%L,1,%L::jsonb)::text$$, s1, payload))::int;
  perform pg_temp.err('บันทึกด้วยเลขฉบับเก่า = ปฏิเสธ (กันทับ)', adm, format($$select public.save_mockup_draft(%L,1,%L::jsonb)$$, s1, payload), 'มีคนบันทึก');
  v := pg_temp.ok('ส่งอนุมัติ', adm, format($$select public.submit_mockup_sheet(%L,%s)::text$$, s1, v))::int;
  perform pg_temp.err('แอดมินอนุมัติไม่ได้', adm, format($$select public.approve_mockup_sheet(%L)$$, s1), 'บทบาท');
  perform pg_temp.err('QC อนุมัติไม่ได้', qcu, format($$select public.approve_mockup_sheet(%L)$$, s1), 'บทบาท');
  perform pg_temp.ok('ฝ่ายผลิตส่งกลับ', prd, format($$select public.return_mockup_sheet(%L,'ทดสอบส่งกลับ')::text$$, s1));
  v := (select version from public.mockup_sheets where id = s1);
  perform pg_temp.ok('แอดมินส่งอนุมัติอีกครั้ง', adm, format($$select public.submit_mockup_sheet(%L,%s)::text$$, s1, v));
  perform pg_temp.ok('ฝ่ายผลิตอนุมัติ', prd, format($$select public.approve_mockup_sheet(%L,'ทดสอบสด')::text$$, s1));
  perform pg_temp.chk('อนุมัติแล้ว + แช่ค่าใบยืนยัน + snapshot', (select status from public.mockup_sheets where id=s1)='approved'
    and (select ref_value from public.mockup_callouts where sheet_id=s1 and no=2)='DTF · 8 × 8 ซม.'
    and exists (select 1 from public.mockup_snapshots where sheet_id=s1), (select ref_value from public.mockup_callouts where sheet_id=s1 and no=2));
  perform pg_temp.chk('กล่องจดหมาย: รออนุมัติ 2 · ส่งกลับ 1 · อนุมัติ 1',
    (select count(*) filter (where kind='mockup_pending')=2 and count(*) filter (where kind='mockup_returned')=1 and count(*) filter (where kind='mockup_approved')=1 from public.inbox_messages where job_id=j1),
    (select string_agg(kind, ',') from public.inbox_messages where job_id=j1));
  perform pg_temp.chk('ไม่มี error แจ้งเตือน', not exists (select 1 from public.inbox_errors where source='on_mockup_status_inbox' and at > now() - interval '1 minute'), '');
  begin
    update public.mockup_callouts set x = 0.2 where sheet_id = s1;
    perform pg_temp.chk('แก้ Callout ฉบับอนุมัติตรงๆ ไม่ได้', false, 'แก้ได้');
  exception when others then perform pg_temp.chk('แก้ Callout ฉบับอนุมัติตรงๆ ไม่ได้', sqlerrm ~ 'อนุมัติแล้ว', sqlerrm); end;
  perform pg_temp.ok('QC รับทราบสเปกที่ QC + Packing', qcu, format($$select public.ack_mockup_sheet(%L,'qc_pack')::text$$, s1));
  perform pg_temp.err('QC รับทราบแทนสถานีตัดไม่ได้', qcu, format($$select public.ack_mockup_sheet(%L,'cut')$$, s1), 'QC');

  perform pg_temp.as_user(qcu);
  execute 'set local role authenticated';
  n := (select count(*) from public.mockup_callouts where sheet_id = s1);
  perform pg_temp.chk('QC อ่าน Callout ฉบับอนุมัติได้ 3 จุด (RLS)', n = 3, n::text);
  n := (select count(*) from public.mockup_snapshots where sheet_id = s1);
  perform pg_temp.chk('QC อ่าน snapshot ไม่ได้ (RLS)', n = 0, n::text);
  execute 'reset role';

  -- เดินงาน A ทุกสถานี
  perform pg_temp.ok('พิมพ์: เริ่มก่อนคิว (มีเหตุผล)', prd, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')::text$$, j1));
  perform pg_temp.ok('พิมพ์: พักงาน', prd, format($$select public.open_issue(%L,'ทดสอบพักงาน')::text$$, j1));
  perform pg_temp.err('QC กดแก้แล้วทำต่อไม่ได้', qcu, format($$select public.close_issue(%L,null)$$, j1), 'บทบาท|ฝ่ายผลิต');
  perform pg_temp.ok('พิมพ์: แก้แล้ว ทำต่อ', prd, format($$select public.close_issue(%L,null)::text$$, j1));
  st := (select station_status from public.job_live where id=j1);
  if st = 'queued' then perform pg_temp.ok('พิมพ์: เริ่มใหม่หลังกลับเข้าคิว', prd, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')::text$$, j1)); end if;
  perform pg_temp.ok('พิมพ์: เสร็จ', prd, format($$select public.finish_station(%L,'print')::text$$, j1));
  perform pg_temp.ok('รีด: เริ่ม', prd, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')::text$$, j1));
  perform pg_temp.ok('รีด: เสร็จ', prd, format($$select public.finish_station(%L,'press')::text$$, j1));
  perform pg_temp.ok('ตัด: เริ่ม', prd, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')::text$$, j1));
  perform pg_temp.ok('ตัด: เสร็จ', prd, format($$select public.finish_station(%L,'cut')::text$$, j1));
  perform pg_temp.err('เย็บ: QC เริ่มเย็บไม่ได้', qcu, format($$select public.start_sewing(%L)$$, j1), 'บทบาท|ฝ่ายผลิต');
  perform pg_temp.ok('เย็บ: เริ่มเย็บ (ระบบเลือกจักร)', prd, format($$select public.start_sewing(%L)::text$$, j1));
  perform pg_temp.chk('เย็บ: งานได้จักร', exists (select 1 from public.machine_assignments where job_id=j1 and released_at is null), '');
  perform pg_temp.ok('เย็บ: เย็บเสร็จ', prd, format($$select public.finish_sewing(%L)::text$$, j1));
  perform pg_temp.chk('เย็บ: คืนจักรครบ', not exists (select 1 from public.machine_assignments where job_id=j1 and released_at is null), '');
  perform pg_temp.ok('QC: เริ่ม', qcu, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')::text$$, j1));
  perform pg_temp.err('QC: ผ่านไม่ครบกดเสร็จไม่ได้', qcu, format($$select public.finish_station(%L,'qc_pack')$$, j1), 'QC|ผ่าน|ครบ');
  perform pg_temp.ok('QC: ส่งแก้ 2 ชิ้นกลับเย็บ', qcu, format($$select public.send_rework(%L,2,'ทดสอบงานแก้','sew')::text$$, j1));
  perform pg_temp.chk('งานแก้กลับไปที่เย็บ', (select current_station from public.job_live where id=j1)='sew', (select current_station from public.job_live where id=j1));
  perform pg_temp.ok('เย็บแก้: เริ่ม', prd, format($$select public.start_sewing(%L)::text$$, j1));
  perform pg_temp.ok('เย็บแก้: เสร็จ', prd, format($$select public.finish_sewing(%L)::text$$, j1));
  perform pg_temp.ok('QC รอบแก้: เริ่ม', qcu, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')::text$$, j1));
  perform pg_temp.ok('QC: บันทึกผ่าน 10', qcu, format($$select public.record_qc(%L,10,gen_random_uuid())::text$$, j1));
  perform pg_temp.ok('QC: เสร็จ', qcu, format($$select public.finish_station(%L,'qc_pack')::text$$, j1));
  perform pg_temp.chk('งาน A เสร็จ (done)', (select phase from public.job_live where id=j1)='done', (select phase from public.job_live where id=j1));

  -- ม็อคอัพฉบับแก้ไขหลังเริ่มผลิต
  perform pg_temp.err('แก้ฉบับอนุมัติต้องมีเหตุผล', adm, format($$select public.start_mockup_sheet(%L)$$, j1), 'เหตุผล');
  s2 := pg_temp.ok('สร้างฉบับ 2', adm, format($$select public.start_mockup_sheet(%L,'ทดสอบแก้ฉบับ')::text$$, j1))::uuid;
  perform pg_temp.chk('ฉบับ 2 คัดลอกจุด 3 + สเปก 1 + ภาพ 2', (select count(*) from public.mockup_callouts where sheet_id=s2)=3
    and (select count(*) from public.mockup_specs where sheet_id=s2)=1 and (select count(*) from public.mockup_views where sheet_id=s2)=2, '');
  perform pg_temp.ok('ส่งฉบับ 2', adm, format($$select public.submit_mockup_sheet(%L,1)::text$$, s2));
  perform pg_temp.err('เริ่มผลิตแล้ว ฝ่ายผลิตอนุมัติฉบับแก้ไขไม่ได้', prd, format($$select public.approve_mockup_sheet(%L)$$, s2), 'ผู้บริหารหรือเจ้าของ');
  perform pg_temp.ok('ผู้บริหารอนุมัติฉบับ 2', mgr, format($$select public.approve_mockup_sheet(%L)::text$$, s2));
  perform pg_temp.chk('ฉบับ 1 ถูกแทนที่ · ฉบับ 2 ใช้ผลิต', (select status from public.mockup_sheets where id=s1)='superseded' and (select status from public.mockup_sheets where id=s2)='approved', '');
  perform pg_temp.chk('ฉบับแก้ไขแจ้ง QC ให้รับทราบใหม่', exists (select 1 from public.inbox_messages where job_id=j1 and kind='mockup_approved' and 'qc' = any(audience)), '');

  -- งาน B: DTF + ขึ้นตัวอย่าง (ไม่ผ่าน 1 รอบ → ผ่าน) + ฟิล์ม
  j2 := pg_temp.ok('รับงาน DTF ขึ้นตัวอย่าง', adm, $$select public.receive_job('TEST-LIVE-B','ลูกค้าทดสอบสด','งาน DTF','tshirt',10,'ตัว',current_date+7,'dtf','',0,0,'{}'::jsonb,true)::text$$)::uuid;
  perform pg_temp.chk('งาน B อยู่ขั้นตัวอย่างที่ตัด', (select phase='sample' and current_station='cut' from public.job_live where id=j2), (select phase||'/'||current_station from public.job_live where id=j2));
  perform pg_temp.ok('ตัวอย่าง ตัด: เริ่ม', prd, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')::text$$, j2));
  perform pg_temp.ok('ตัวอย่าง ตัด: เสร็จ', prd, format($$select public.finish_station(%L,'cut')::text$$, j2));
  perform pg_temp.err('รีดฟิล์ม: ยังไม่ได้รับฟิล์มเริ่มไม่ได้', prd, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')$$, j2), 'ยังไม่ได้รับ');
  perform pg_temp.ok('สั่งฟิล์ม', adm, format($$select public.order_film(%L,current_date+1)::text$$, j2));
  perform pg_temp.ok('ได้รับฟิล์ม', adm, format($$select public.receive_film(%L)::text$$, j2));
  perform pg_temp.ok('ตัวอย่าง รีดฟิล์ม: เริ่ม', prd, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')::text$$, j2));
  perform pg_temp.ok('ตัวอย่าง รีดฟิล์ม: เสร็จ', prd, format($$select public.finish_station(%L,'dtf_press')::text$$, j2));
  perform pg_temp.ok('ตัวอย่าง เย็บ: เริ่ม', prd, format($$select public.start_sewing(%L)::text$$, j2));
  perform pg_temp.ok('ตัวอย่าง เย็บ: เสร็จ', prd, format($$select public.finish_sewing(%L)::text$$, j2));
  perform pg_temp.ok('ตัวอย่าง QC: เริ่ม', qcu, format($$select public.start_in_queue(%L,'ทดสอบระบบสด')::text$$, j2));
  perform pg_temp.ok('ตัวอย่าง QC: เสร็จ (ส่งตัวอย่าง)', qcu, format($$select public.finish_station(%L,'qc_pack')::text$$, j2));
  perform pg_temp.chk('รอผลตัวอย่าง', (select phase from public.job_live where id=j2)='sample_review', (select phase from public.job_live where id=j2));
  perform pg_temp.ok('ตัวอย่างไม่ผ่าน', adm, format($$select public.record_sample_result(%L,false,'ทดสอบไม่ผ่าน',null)::text$$, j2));
  perform pg_temp.chk('ไม่ผ่าน = ขึ้นตัวอย่างรอบ 2', (select phase='sample' and sample_round=2 from public.job_live where id=j2), (select phase||' รอบ '||sample_round from public.job_live where id=j2));

  out := (select json_agg(json_build_object('n', name, 'ok', pass, 'i', left(info, 140))) from pg_temp.res);
  raise exception 'RESULTS%', out;
end $t$;
