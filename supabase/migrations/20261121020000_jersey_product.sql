-- สินค้าใหม่ เสื้อเจอร์ซีย์ (แขนสั้น / แขนยาว) · code ต้องตรงกับ PRODUCTS ในฟอร์มใบยืนยัน
-- สูตรจักรเหมือนเสื้อกีฬา (เสื้อยืดผ้าโพลี เย็บแบบเดียวกัน)
insert into public.product_types (code, name, category, unit, sort)
values ('jersey', 'เสื้อเจอร์ซีย์', 'garment', 'ตัว', 25);

insert into public.product_machine_needs (product_type_code, type_code, qty)
select 'jersey', type_code, qty from public.product_machine_needs where product_type_code = 'sport';
