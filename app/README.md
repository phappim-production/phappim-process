# หน้าเว็บ ภาพพิมพ์ 142 · ติดตามการผลิต

React 19 + Vite + TypeScript + Tailwind v4 · PWA (`vite-plugin-pwa`) · deploy ที่ Cloudflare Pages (https://pp142.pages.dev)
กติกาการเขียนโค้ดอยู่ที่ [`AGENTS.md`](../AGENTS.md) · ภาพรวมระบบที่ [`DEVELOPMENT.md`](../DEVELOPMENT.md)

## คำสั่ง
```bash
npm ci
npm run dev      # เปิดในเครื่อง (ต้องมี .env.local ตาม .env.example)
npm run build    # typecheck + build
npm run lint     # oxlint
npm test         # Vitest (src/**/*.test.ts) + node --test (tests/*.test.mjs)
```

ทดสอบในเบราว์เซอร์กับระบบจำลองทั้งระบบ: [`tools/qa-r14/README.md`](../tools/qa-r14/README.md) · ก่อน `npm test` ล้าง `VITE_*` ออกจาก env

## โครงสร้าง `src/`
| ที่ | คืออะไร |
|---|---|
| `App.tsx` | เข้าสู่ระบบ → เมนูตามบทบาท (`auth/menus.ts`) → หน้าตาม `#/…` |
| `auth/` | บทบาท สิทธิ์ (`access.ts`) ขอบเขตที่เห็น (`scope.ts`) เมนู · ฐานข้อมูลบังคับสิทธิ์จริงอีกชั้น |
| `pages/` | หน้าจอ · `Dashboard.tsx` = ภาพรวม/บอร์ด/คิว/ปัญหา ฯลฯ |
| `components/` | ส่วนประกอบกลาง (`ui.tsx`, `tone.ts`, `icons.tsx`) · แถบรุ่นใหม่ (`AppUpdate.tsx`) · การ์ดติดตั้งแอป (`InstallApp.tsx`) |
| `data/` | เรียก Supabase (`useFactoryData.ts`) และ Worker ไฟล์ R2 (`files.ts`) · แปลงข้อมูล |
| `proto/` | ชนิดข้อมูล (`model.ts`) + ฟังก์ชันคำนวณ (คิว เวลาผลิต `leadTime.ts` จักร งานนอก) |
| `i18n/` | ภาษาพม่าสำหรับหน้าจอพนักงานสถานี/QC (`t('…')`, `<Tr th="…" />`, คำแปลใน `my.ts`) |
| `lib/` | client ของ Supabase · ติดตั้งแอป (`install.ts`) · กันจอดับ (`wakeLock.ts`) |
