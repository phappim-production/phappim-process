-- ข้อมูลบริษัทภายนอกจากชีต "ข้อมูล Supplier" ของฝ่ายขาย (เจ้าของสั่ง 18 พ.ย.)
-- เก็บเบอร์โทร ที่อยู่ ลิงก์แผนที่ และประเภทงาน → แอดมินกดโทร/เปิดแผนที่ตามของได้จากหน้างานที่ส่งออก
-- kind: outsource = รับงานไปทำแทน (พิมพ์ รีด ตัด เย็บ ปัก) · supplier = ร้านขายวัตถุดิบ/ฟิล์ม (ไม่ขึ้นในรายการส่งออก)
-- ข้อมูลรายชื่อจริงลงที่ฐานข้อมูลจริงอย่างเดียว ไม่เก็บใน git (มีเบอร์มือถือส่วนตัวของช่าง)

alter table public.vendors
  add column kind      text not null default 'outsource' check (kind in ('outsource', 'supplier')),
  add column phone     text,
  add column address   text,
  add column map_url   text check (map_url is null or map_url ~ '^https://'),
  add column specialty text,       -- ประเภทงานที่รับ เช่น "ชุดนอน/เสื้อกีฬา/ผ้าเช็ดหน้า/เสื้อคอปก"
  add column note      text;
comment on column public.vendors.contact is 'ชื่อผู้ติดต่อ';
