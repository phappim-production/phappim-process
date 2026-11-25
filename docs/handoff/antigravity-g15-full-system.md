# Handoff: `antigravity/g15-full-system` (QA Round 19 — Full System & Station Photos)

- **Branch:** `antigravity/g15-full-system` (worktree `../pp142-g15`, base commit `96e4bed` = main after PR #207–#209 + R19 work order)
- **Scope:** Execute full-system QA in local simulator strictly per `docs/qa/ใบสั่งงาน-รอบ-19-antigravity.md` (Parts A 1–10, B 1–7, C 1–7, D 1–9, baseline unit/lint/DB/Worker suites, legacy `tools/qa-r14/` suites, and full reports).
- **Changes made:** **New test scripts, JSON outputs, screenshots/PDFs, QA reports, and handoff ONLY.** Zero tracked product/test/migration files modified (`git diff --stat HEAD` = empty).

---

## 1. Local Environment & Zero-Production-Contact Verification

- **Loopback build used for browser tests:**
  ```powershell
  $env:VITE_SUPABASE_URL = 'http://127.0.0.1:5234'
  $env:VITE_SUPABASE_ANON_KEY = 'r14-local-anon-key'
  $env:VITE_FILES_URL = 'http://127.0.0.1:5235'
  npm.cmd --prefix app run build
  ```
- **Local stack ports:** `QA_PORT=5234`, `QA_FILES_PORT=5235`, `QA_IMG_DIR=C:\Users\PC\Desktop\รีเสิร์ทข้อมูล\pp142-g15\docs\qa\img\r19-ag`
- **`app/dist/` bundle scan:**
  - `index-DzB0lVMz.js`: contains `127.0.0.1:5234` (1) and `127.0.0.1:5235` (1)
  - `workers.dev`: `0`
  - `supabase-DxFOITRO.js`: `supabase.co` (1 — static regex pattern check inside `@supabase/supabase-js`)
  - `LabelPage-2yGJsN-j.js`: `pp142.pages.dev` (1 — static SVG QR URL payload)
  - `confirmation.html`: `pp142.pages.dev` (1 — static `file:` warning text)
- **CDP network logs (`externalAttempts`):** `0` external requests across all JSON result files (`part-a-ui-results.json` logged 4 requests to its own local loopback proxy `http://127.0.0.1:60421` to delay `slow2.jpg` by 10s, `nonLocalExternalAttempts = []`).

---

## 2. Verification Results Summary (All Observed in Local Simulator)

- **Baseline suites (run cleanly without `VITE_*` set):**
  - `npm.cmd --prefix app run lint`: 0 warnings, 0 errors (186 files, 116 rules)
  - `npm.cmd --prefix app test`: Vitest 58 files / 560 passed + `app/tests/*.test.mjs` 165 passed
  - `npm.cmd --prefix workers\files test`: 26 passed
  - `npm.cmd --prefix supabase\tests test`: `run.mjs` 1,814 passed + `live-check.mjs` 106 passed
- **Legacy `tools/qa-r14/` suites (`5234`/`5235` → `docs/qa/img/r19-ag/`):**
  - `server.test.mjs`: 1/1 PASS
  - `e2e-photos.mjs`: 20/20 PASS
  - `qa-part-a.mjs`: 16/16 PASS
  - `qa-part-b.mjs`: 5/5 PASS (A5 label + A4/A3 artwork PDFs)
  - `qa-part-c.mjs`: 5/5 PASS
  - `confirmation-all.mjs`: 38/38 products PASS (`r14-ag-all-*.pdf`)
- **R19 comprehensive suites (`tools/qa-r19-ag/`):**
  - `test-part-a-ui.mjs`: 6/6 PASS ([part-a-ui-results.json](../../tools/qa-r19-ag/part-a-ui-results.json))
  - `test-part-a-rules-sec.mjs`: 8/8 PASS ([part-a-rules-sec-results.json](../../tools/qa-r19-ag/part-a-rules-sec-results.json))
  - `test-part-b-new.mjs`: 7/7 PASS ([part-b-new-results.json](../../tools/qa-r19-ag/part-b-new-results.json))
  - `test-part-c-e2e.mjs`: 6/6 PASS ([part-c-e2e-results.json](../../tools/qa-r19-ag/part-c-e2e-results.json))
  - `audit-manuals.mjs`: DONE ([manuals-audit-results.json](../../tools/qa-r19-ag/manuals-audit-results.json))
  - `test-part-d-security-data.mjs`: 4/4 PASS — 13×24 URL leaks=0, 67/67 `pg_proc` RPC coverage (unmapped=0, violations=0, direct REST=0), XSS escaped everywhere, SQL data audit clean ([part-d-security-data.json](../../tools/qa-r19-ag/part-d-security-data.json), [data-integrity-sql.json](../../tools/qa-r19-ag/data-integrity-sql.json))
  - `test-part-d-ux-net-load.mjs`: 6/6 PASS — `375/768/1440` sweep, 3s slow net + real offline upload/finish/confirm (0 `Failed to fetch` leaks) + SW update banner + 5 `@media print` PDFs + human-error inputs + Bangkok/LA timezone parity + 320 jobs / 3,380 events / 20 pending first-piece load benchmark (`155–494 ms`) ([part-d-ux-net-load.json](../../tools/qa-r19-ag/part-d-ux-net-load.json))

---

## 3. Confirmed Bug Index (`R19-01` .. `R19-16`) for Fix Triage

| Code | Severity | Target Location | Summary |
|---|---|---|---|
| **R19-01** | **Level 1** | `supabase/migrations/20261129000000_station_photos.sql` (`private.check_file_upload`, `public.file_read_allowed`), `station_photo_flags` | `staff_empty` (`stations=[]`) can `PUT /upload/station_photos/<any-job>/<any-station>/...` (`200 OK`) and sign/view station photos factory-wide (reported to owner mid-run; `submit_first_piece` blocks `42501` and `anon/disabled/norole` are blocked `401/403`). |
| **R19-02** | **Level 1** | `supabase/migrations/20261129000000_station_photos.sql` (`submit_first_piece`, `add_finish_photos`), `app/src/data/stationPhotos.ts` (`contentKey`) | Same file path reused from approved `first_piece` passes `add_finish_photos`, and same rejected path passes `submit_first_piece` resubmit; deterministic hash names in UI allow re-picking same photo to bypass both gates (reported to owner mid-run). |
| **R19-03** | **Level 2** | `app/src/data/history.ts` (`visitLines`), `app/src/pages/reports/metrics.ts` (`stationTimes`) | History & Reports do not subtract `first_piece_wait_days`, contradicting `private.sla_state` (`0.5` days vs displayed `2 วัน`). |
| **R19-04** | **Level 2** | `app/src/pages/Dashboard.tsx` (`JobDrawer` `sticky top-0`), `app/src/pages/JobActions.tsx` | On `375 px` mobile, sticky drawer header clips top half of `[role=alert]`, hiding Burmese error lines (`r14-ag-c5-qc-error-my-375.png`). |
| **R19-05** | **Level 2** | `app/src/pages/Dashboard.tsx` (`StationRail`) | On `375 px` mobile, `#/board` overflows horizontally to `499 px` for multi-station roles (`owner`, `manager`, `prod1`, `admin1`). |
| **R19-06** | **Level 2** | `app/src/i18n/dbErrors.ts` + `workers/files` | Fake `.jpg` HTTP 415 message (`เนื้อไฟล์ไม่ใช่ ภาพ JPG ให้บันทึกไฟล์ใหม่แล้วเลือกอีกครั้ง`) lacks Burmese translation entry. |
| **R19-07** | **Level 2** | `supabase/migrations/20261129000000_station_photos.sql` (`decide_first_piece`) | `decide_first_piece` returns `204 OK` and logs `first_piece_ok` while job is outsourced (`station_status='out'`) or after owner disables station photos globally. |
| **R19-08** | **Level 2** | `docs/คู่มือ/*.md` + `docs/คู่มือ/img/*` | `แผนอบรม.md` lacks station photos, `แอดมิน.md` has old compare UI/formula note, `ฝ่ายผลิต.md` still references red `"ด่วน n"`, 4 manuals mention `"ซิลค์สกรีน"`, and all 48 images are pre-v3. |
| **R19-09** | **Level 3** | `app/src/proto/admin.ts` (`TABLE_LABEL`, `auditChanges`) | Missing `'station_photo_settings'` entry causes raw English table/column names and UTC ISO timestamps on `#/audit`. |
| **R19-10** | **Level 3** | `app/src/pages/FirstPieceReview.tsx`, `app/src/components/PhotoViewer.tsx` | Modal bottom buttons clip on `1440×900` when worker note + missing-mockup text are both present. |
| **R19-11** | **Level 3** | Floor header in Burmese mode (`staff_multi`) | 5-station Burmese header title clips horizontally at `375 px`. |
| **R19-12** | **Level 3** | `app/src/pages/FirstPieceReview.tsx` (lines 16–17) | Second admin's `ReviewDialog` disappears silently if background refresh empties `pending` before click. |
| **R19-13** | **Level 3** | `production-confirmation.html`, `receive_job` | Confirmation form accepts decimal qty (`2.5`) and neither form nor `receive_job` caps absurdly huge qty (`999,999,999`). |
| **R19-14** | **Level 3** | `app/src/pages/StationPhotos.tsx` (lines 107, 144), `app/src/pages/WorkPanels.tsx` (line 367) | Selecting 7 photos silently drops #7 without alert; delete `X` button is `32×32 px`; `แจ้งเสีย` buttons on `#/sewing` are `44 px` (`min-h-11`). |
| **R19-15** | **Level 3** | `app/src/pages/settings/photos.tsx` | Unused `'screen'` (`ซิลค์สกรีน`) station still listed in Station Photos settings toggle. |
| **R19-16** | **Level 3** | `production-confirmation.html` | Revise mode leaves `doc_no` input enabled (hint-only until RPC blocks mismatch on save). |

---

## 4. Deliverables & New Files Added (No Tracked Files Modified)

- `docs/qa/รอบ-19-antigravity.md` — Full QA report (Part A–D matrices, evidence links, `R19-01`–`R19-16` repros, UX confusion points, undecided design-intent items)
- `docs/qa/สรุป-รอบ-19-สำหรับเจ้าของ.md` — Plain-Thai executive summary & Go/No-Go verdict
- `docs/handoff/antigravity-g15-full-system.md` — This handoff document
- `tools/qa-r19-ag/**` — Test scripts and JSON artifacts
- `docs/qa/img/r19-ag/**` — Screenshots and printed PDFs (`118` files)

**Limitations:** No physical Android/iOS phone connected over LAN; mobile rear-camera flow verified via Chrome DevTools `375 px` viewport and DOM `<input type="file" accept="image/*" capture="environment" multiple>` attribute inspection.

**Git / Push policy:** Committed locally on `antigravity/g15-full-system` only; **NOT pushed** and no PR opened per `AGENTS.md` / `docs/แบ่งงาน-Codex-Antigravity.md`.
