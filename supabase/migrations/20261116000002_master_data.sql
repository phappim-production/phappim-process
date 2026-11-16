-- =====================================================================
-- ข้อมูลตั้งค่าเริ่มต้น (master) · เฟส 0
-- อ้างอิง DEVELOPMENT.md หัวข้อ 2–3 และฟอร์มใบยืนยัน (production-confirmation.html)
-- รายการที่ is_draft = true ยังต้องยืนยันกับหน้างาน (ดู docs/เช็คลิสต์ยืนยันหน้างาน.md)
-- kind: req = ต้องติ๊กก่อนกดเสร็จ · num = ต้องกรอกตัวเลข · appr = ต้องมีคนอนุมัติ · lock = รอเงื่อนไข · opt = เช็คลิสต์ไม่บังคับ
-- =====================================================================

insert into public.stations (code, name, sort, is_draft, substeps) values
  ('print', 'พิมพ์งาน', 10, false, '[
    {"key":"prep_file","name":"เตรียมไฟล์","kind":"opt"},
    {"key":"prep_machine","name":"เตรียมเครื่อง","kind":"opt"},
    {"key":"print","name":"พิมพ์","kind":"opt"},
    {"key":"check_print","name":"ตรวจงานพิมพ์","kind":"req"}]'),
  ('press', 'รีดงาน', 20, false, '[
    {"key":"set_temp","name":"ตั้งอุณหภูมิ","kind":"opt"},
    {"key":"press","name":"รีด","kind":"opt"},
    {"key":"check_color","name":"ตรวจสีและการติด","kind":"req"}]'),
  ('cut', 'ตัดงาน', 30, false, '[
    {"key":"layout","name":"วางแพทเทิร์น","kind":"opt"},
    {"key":"cut","name":"ตัด","kind":"opt"},
    {"key":"sort_count","name":"คัดแยกชิ้นและนับ (จำนวนชิ้น)","kind":"num"}]'),
  ('dtf_press', 'รีด DTF', 40, true, '[
    {"key":"film_received","name":"ได้รับฟิล์ม","kind":"lock"},
    {"key":"set_temp","name":"ตั้งอุณหภูมิ","kind":"opt"},
    {"key":"place_film","name":"วางฟิล์มตามตำแหน่ง","kind":"opt"},
    {"key":"press","name":"รีด","kind":"opt"},
    {"key":"peel","name":"ลอกฟิล์ม","kind":"opt"},
    {"key":"check_adhesion","name":"ตรวจการติด","kind":"req"}]'),
  ('emb', 'งานปัก', 50, true, '[
    {"key":"prep_file","name":"เตรียมไฟล์ปัก / ตั้งเครื่อง / เตรียมด้ายตามสีที่ระบุ","kind":"opt"},
    {"key":"test_piece","name":"ปักชิ้นทดสอบ","kind":"appr"},
    {"key":"embroider","name":"ปักทั้งก้อน","kind":"opt"},
    {"key":"check_emb","name":"ตรวจงานปัก (ตำแหน่ง สี ด้ายหลุด)","kind":"req"}]'),
  ('screen', 'ซิลค์สกรีน', 60, true, '[
    {"key":"make_screen","name":"ทำบล็อกสกรีน","kind":"opt"},
    {"key":"mix_ink","name":"ผสมสีตามที่ระบุ","kind":"opt"},
    {"key":"test_print","name":"สกรีนชิ้นทดสอบ","kind":"appr"},
    {"key":"print","name":"สกรีนทั้งก้อน","kind":"opt"},
    {"key":"cure","name":"อบ / รีดให้สีติด","kind":"opt"},
    {"key":"check_screen","name":"ตรวจงานสกรีน","kind":"req"}]'),
  ('sew', 'เย็บงาน', 70, false, '[
    {"key":"issue_to_sew","name":"จ่ายงานเข้าเย็บ","kind":"req"},
    {"key":"first_piece","name":"ตัวแรก (First piece)","kind":"appr"},
    {"key":"sew_count","name":"เย็บทั้งก้อน (ยอดสะสม)","kind":"num"},
    {"key":"finishing","name":"เก็บงานปลายไลน์","kind":"req"}]'),
  ('qc_pack', 'QC + Packing', 80, false, '[
    {"key":"inspect","name":"ตรวจ (ผ่าน / ไม่ผ่าน)","kind":"num"},
    {"key":"count","name":"นับ","kind":"num"},
    {"key":"fold_pack","name":"พับ / แพ็ค","kind":"opt"},
    {"key":"label","name":"ติดป้าย","kind":"opt"},
    {"key":"boxed","name":"ลงลัง","kind":"req"}]');

insert into public.routes (code, name, description) values
  ('normal', 'ปกติ (ซับลิเมชั่น / ดิจิทัล)', 'พิมพ์ → รีด → ตัด → เย็บ → QC+Packing'),
  ('dtf',    'DTF',                         'ตัด → รีด DTF → เย็บ → QC+Packing · แอดมินต้องสั่งฟิล์ม'),
  ('plain',  'ไม่มีงานพิมพ์',                 'ตัด → เย็บ → QC+Packing');

insert into public.route_stations (route_code, seq, station_code) values
  ('normal', 1, 'print'), ('normal', 2, 'press'), ('normal', 3, 'cut'), ('normal', 4, 'sew'), ('normal', 5, 'qc_pack'),
  ('dtf',    1, 'cut'),   ('dtf',    2, 'dtf_press'), ('dtf', 3, 'sew'), ('dtf', 4, 'qc_pack'),
  ('plain',  1, 'cut'),   ('plain',  2, 'sew'),   ('plain', 3, 'qc_pack');
-- หมายเหตุ: สถานี emb / screen ยังไม่ได้ใส่ในเส้นทาง · รอหน้างานตอบว่าอยู่ลำดับไหน (DEVELOPMENT.md หัวข้อ 10 ข้อ 9)

-- 37 สินค้า (สร้างจาก PRODUCTS ในฟอร์มใบยืนยัน · code ต้องตรงกัน)
insert into public.product_types (code, name, category, unit, sort) values
('tshirt','เสื้อยืด (คอกลม / คอวี)','garment','ตัว',10),
  ('sport','เสื้อกีฬา / เสื้อองค์กรพิมพ์ลาย','garment','ตัว',20),
  ('running','เสื้อวิ่ง / ชุดงานวิ่ง','garment','ตัว',30),
  ('polo','เสื้อโปโล','garment','ตัว',40),
  ('worker','เสื้อคนงาน / เสื้อปุ๋ย','garment','ตัว',50),
  ('pe','เสื้อพละ / ชุดพละนักเรียน','garment','ตัว',60),
  ('jacket','เสื้อวอร์ม / แจ็คเก็ต / ฮู้ด','garment','ตัว',70),
  ('hawaii','เสื้อฮาวาย / เสื้อสงกรานต์','garment','ตัว',80),
  ('gown','เสื้อกาวน์ทางการแพทย์','garment','ตัว',90),
  ('scrub','ชุดสครับ / ชุดผ่าตัด','garment','ชุด',100),
  ('student','เสื้อนักศึกษา','garment','ตัว',110),
  ('mourning','เสื้อดำ / เสื้อไว้ทุกข์','garment','ตัว',120),
  ('kids','ชุดเด็ก / เสื้อผ้าเด็กอ่อน','garment','ตัว',130),
  ('pajama','ชุดนอน','garment','ชุด',140),
  ('elephant','กางเกงช้าง','garment','ตัว',150),
  ('muaythai','กางเกงมวยไทย','garment','ตัว',160),
  ('pet','เสื้อผ้าสัตว์เลี้ยง','garment','ชิ้น',170),
  ('banner','ป้ายผ้า / ฉากผ้า','flat','ผืน',180),
  ('yan','ผ้ายันต์ / ธงกฐิน','flat','ผืน',190),
  ('scarf','ผ้าคลุมไหล่ / ผ้าพันคอ / ผ้าเช็ดหน้า / ผ้าโพกหัว','flat','ผืน',200),
  ('cheer','ผ้าเชียร์กีฬา','flat','ผืน',210),
  ('glasses','ผ้าเช็ดแว่น','flat','ผืน',220),
  ('blanket','ผ้านาโน / ผ้าห่ม','flat','ผืน',230),
  ('apron','ผ้ากันเปื้อน','flat','ผืน',240),
  ('wristband','ริสแบนด์ผ้า (Wristband)','flat','เส้น',250),
  ('lanyard','สายคล้องคอ / สายคล้องบัตร','flat','เส้น',260),
  ('bag','ถุงผ้า / กระเป๋าผ้า / ถุงยังชีพ / ของชำร่วย','bag','ใบ',270),
  ('spunbond','ถุงสปันบอนด์','bag','ใบ',280),
  ('foldable','ถุงผ้าร่มพับได้ / ถุงช้อปปิ้งพกพา','bag','ใบ',290),
  ('sachet','ถุงหอม','bag','ถุง',300),
  ('kajood','กระเป๋ากระจูด / กระเป๋าสาน','bag','ใบ',310),
  ('hat','หมวก (แก๊ป / ตาข่าย / บักเก็ต)','hat','ใบ',320),
  ('pillow','หมอน / พวงกุญแจหมอน','other','ใบ',330),
  ('medal','เหรียญรางวัล','other','เหรียญ',340),
  ('plaque','โล่รางวัล','other','ชิ้น',350),
  ('premium','ของพรีเมียมอื่นๆ (แก้ว ปฏิทิน ร่ม สมุด ฯลฯ)','other','ชิ้น',360),
  ('service','งานบริการ (ลูกค้าส่งวัสดุ / ชิ้นงานมาเอง)','other','ชิ้น',370);

-- เช็คลิสต์เย็บ (ร่าง · ไม่บังคับติ๊ก)
update public.product_types set sew_checklist = '["เย็บไหล่","ติดคอ / ทับคอ","ติดแขน","เย็บข้าง + ใต้แขน","ลาแขน / ลาชาย","ติดป้ายคอ / ป้ายไซซ์"]'
  where code in ('tshirt','sport','running','worker','mourning','kids','pet');
update public.product_types set sew_checklist = '["พับริม / โพ้งขอบ","เก็บขอบ 4 ด้าน","ทำรางสอด (ตามสเปก)","ติดตาไก่ / อุปกรณ์","ตรวจขนาดเทียบใบยืนยัน"]'
  where code in ('banner','yan','cheer');
update public.product_types set sew_checklist = '["เย็บหูหิ้ว","เย็บซับใน","ติดซิป / ช่องใน","ประกอบตัว","ติดหู + ทับขอบปาก","กลับด้าน + รีดทรง"]'
  where code in ('bag','foldable','sachet');

-- รายการวัตถุดิบแบ่งฝ่าย (ร่างทั่วไป · รอรายการจริงจากหน้างาน)
insert into public.material_templates (product_type_code, route_code, name, dept, sort) values
  (null, null,  'ผ้า / วัสดุหลักครบตามสเปกและจำนวน (รวมเผื่อเสีย)', 'admin',      10),
  (null, null,  'ไฟล์งานล่าสุดตรงกับใบยืนยันที่ลูกค้าเซ็น',          'admin',      20),
  (null, 'dtf', 'สั่งฟิล์ม DTF แล้ว (บันทึกวันคาดว่าได้รับ)',          'admin',      30),
  (null, null,  'ตรวจสี / เนื้อผ้าตรงตามใบยืนยัน',                   'qc',         10),
  (null, null,  'ด้ายสีตามสเปก',                                     'production', 10),
  (null, null,  'ป้าย / อุปกรณ์ (ป้ายคอ ซิป กระดุม ตาไก่ ฯลฯ) ครบ',   'production', 20);
