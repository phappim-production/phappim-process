# ส่งงาน codex/c13-full-qa

รอบ 11 ทดสอบ workflow จากตารางว่างด้วย PGlite และทดสอบหน้าเว็บด้วย Chrome กับ API จำลองบน loopback โค้ดแอปและ migration ที่ตรวจอยู่ที่ `b9e957c` ฐานของ commit ส่งงานคือ `ab5634a` ซึ่งอัปเดตเอกสารส่งต่อ

## ไฟล์ที่ส่ง

- `supabase/tests/flow-r11.mjs` และจุดเรียก 2 บรรทัดใน `supabase/tests/run.mjs` ก่อน `flowRouteTests` สคริปต์ล้างงานของชุดเดิมอยู่ท้ายเดิม
- `app/src/proto/flow-r11.test.ts` ทดสอบเมนู สิทธิ์ ขอบเขตสถานี รายงานว่าง และข้อมูล Callout จากใบยืนยัน
- `tools/qa-r11/` ชุดทดสอบ Chrome และ API จำลองพร้อมข้อมูลที่ใช้ทำซ้ำ
- [รายงาน QA พร้อมวิธีทำซ้ำและภาพหลักฐาน](../qa/รอบ-11-codex.md)

## ผลทดสอบ

| ชุด | ผล |
| --- | --- |
| Build และ lint | ผ่าน Build มีคำเตือนเดิมเรื่อง bundle เกิน 500 kB |
| Vitest และ Node | 404/404 และ 119/119 ผ่าน |
| PGlite | 1,198 ผ่าน ล้ม 1 กรณีชื่อ `BUG:` |
| Chrome | 43 ผ่าน ล้ม 6 กรณีชื่อ `BUG:` ที่ความกว้าง 375 / 768 / 1440 px และตรวจรายการ Callout เพิ่มที่ 1920 px |

## ส่งต่อ Claude

- ระดับ 2 คีย์ลัด Ctrl+Z / Ctrl+Y ในช่องชื่อจุด และบัญชีปิดยังอ่านโปรไฟล์ตัวเองได้ตามนโยบายเดิม
- ระดับ 3 ภาพรวมมือถือซ่อนยอดรอจัดส่ง และป้ายฉบับอนุมัติล้นเนื้อหา 86 px ที่ 375 px
- ผลตรวจในขอบเขตนี้ไม่พบบั๊กระดับ 1 การแก้แอปและ migration การทดสอบด้วยสอง connection และการยืนยันกับระบบจริงยังอยู่กับ Claude ตามใบสั่งงาน

## รันซ้ำใน worktree

ใช้ PowerShell ใน `pp142-c13`

```powershell
Push-Location app
npm ci
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:5199'
$env:VITE_SUPABASE_ANON_KEY = 'r11-loopback-fixture'
npm run build
npm run lint
npm test
Pop-Location

Push-Location supabase/tests
npm ci
npm test
Pop-Location

node tools/qa-r11/browser.mjs
```

ชุด PGlite และ Chrome คืน exit code 1 เมื่อเคส `BUG:` ยังล้ม ตั้ง `QA_FOCUS` เป็น regex เพื่อรันเฉพาะกรณี Chrome และตั้ง `QA_CHROME` ถ้า Chrome อยู่คนละตำแหน่งกับค่าเริ่มต้น บัญชี ใบยืนยัน ไฟล์รูป และ API เป็นข้อมูลจำลองทั้งหมด
