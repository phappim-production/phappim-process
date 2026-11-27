# Handoff: Antigravity G17 — ระบบทดสอบถาวร (`tools/qa-suite`) + ผลทดสอบรอบ 21

- **Branch:** `antigravity/g17-test-system` (ใน `../pp142-g17` · commit ในเครื่อง ไม่ push)
- **สภาพแวดล้อม:** ทดสอบในเครื่องเท่านั้น (`127.0.0.1:5244` / `5245`) · `externalAttempts = 0` ทุกรอบ

## สร้างอะไร
- `tools/qa-suite/run.mjs` + `README.md`: ตัวรันคำสั่งเดียว (`--quick` ~50 วิ · `--full` ~3 นาที · `--only` · `--seed` · `--days` · `--out` · `--compare` · `--skip-build`) พร้อม `assertSafeDist` และ `assertNoExternalAttempts`
- `tools/qa-suite/lib/{rng,safety,client,report}.mjs`: PRNG seedable, `ActionRecorder` (`actions.jsonl`), `shrinkTrace`, รายงาน `report.md`/`report.json` นอก repo (`$TEMP/qa-suite`)
- `tools/qa-suite/checks/{invariants,rpc-policy}.mjs`: ข้อตรวจข้อมูล 10 ข้อ (`B1`–`B10`) + `runInvariantSelfTests` + ตารางสิทธิ์ RPC 74 ฟังก์ชัน
- `tools/qa-suite/parts/{sim,ui,security,confirmation}.mjs`: จำลองโรงงาน จ.–ส. (รวมใบงานบริการ 4 แบบ, ส่งออกจากรอผลิต, วัตถุดิบ ETA, 2 คนพร้อมกัน), ไล่หน้าจอ, ตรวจ `pg_proc` + REST + XSS, สุ่มตรวจฟอร์มใบยืนยัน
- `tools/qa-suite/prove-part-g.mjs`: พิสูจน์จับบั๊กเก่า 8 คอมมิตบน worktree ชั่วคราว

## ทดสอบอะไร (ผลจริง)
- **Baseline (ไม่ตั้ง `VITE_*`):** `app` lint `0/0`, Vitest `624/624`, node `--test` `203/203`, `workers/files` `26/26`, `supabase/tests` `run.mjs` + `live-check` `106/106` ผ่านทั้งหมด
- **`invariants-selftest`:** ผ่าน **10/10**
- **ส่วน G (`prove-part-g.mjs`):** จับบั๊กเก่าได้ **8/8** (`82e3363~1`, `284384c~1`, `5cb0d3f~1`, `9f9b7b2~1`, `8e7a77e~1`, `a5aca98~1`, `6912bea~1`, `f92f4ff~1`)
- **ส่วน H (`--full` 3 seeds × 20 วัน + `--quick` 3 รอบ):** ผ่าน **100%** ทุกรอบ (`externalAttempts=0`)
- **ชุดเดิม `tools/qa-r14/`:** ผ่าน 9/11 (`qa-service` 26/26, `qa-materials` 19/19, `confirmation-all` 42/42 ฯลฯ) · ล้ม 2 ไฟล์เพราะสคริปต์เดิมล้าสมัย (`server.test.mjs` คาด 9 routes แทน 14; `qa-part-a.mjs` A1.1 ยังไม่กรอก qty ใน `fabric_rows` หลัง PR 245)

## สิ่งที่ยังไม่ได้ทำ / หมายเหตุ
- ไม่ได้แก้ `tools/qa-r14/server.test.mjs` และ `tools/qa-r14/qa-part-a.mjs` (อยู่นอกขอบเขตไฟล์ที่แก้ได้) — บันทึกเป็น `R21-01`, `R21-02`
