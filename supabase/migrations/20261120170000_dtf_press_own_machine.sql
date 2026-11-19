-- รีดฟิล์มมีเครื่องของตัวเอง 2 เครื่อง ไม่ใช้เครื่องรีดร้อนร่วมกับรีด
update public.stations set machine_pool = 'dtf_press', machines = 2 where code = 'dtf_press';
