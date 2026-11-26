// ขั้นรอผลิต: แอดมินพิมพ์รายการวัตถุดิบ ติ๊กครบ ถ่ายรูป แล้วปล่อยเข้าไลน์ · ระบบจำลองในเครื่องเท่านั้น
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'
import { createFixtures } from './fixtures.mjs'
import { readFile } from 'node:fs/promises'

const stack = await startLocalStack()
if (!/^http:\/\/127\.0\.0\.1:/.test(stack.origin)) throw new Error('ต้องเป็นระบบในเครื่องเท่านั้น')
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const h = chrome.wrap(chrome.main)
const logs = () => chrome.main.logs.filter(e => !String(e.text ?? '').startsWith("Blocked attempt to show a 'beforeunload'"))
const results = []

const sql = async (q, params = []) => {
  const r = await (await fetch(stack.origin + '/__qa/sql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: q, params }) })).json()
  if (r.message) throw new Error(r.message)
  return r.rows
}
const as = (user, call, args) => sql(`with c as materialized (select set_config('request.jwt.claim.sub', $1, false) x) select ${call} from c`, [user, ...args])

async function step(id, fn) {
  const before = logs().length
  try {
    const d = await fn()
    const errs = logs().slice(before)
    if (errs.length) throw new Error('console: ' + JSON.stringify(errs).slice(0, 400))
    results.push(true)
    console.log(`PASS ${id} ${d ?? ''}`)
  } catch (e) {
    results.push(false)
    console.log(`FAIL ${id} · ${e?.message ?? e}`)
  }
}
const dialogText = () => h.ev(() => document.querySelector('[role="dialog"]')?.innerText.replace(/\s+/g, ' ') ?? '')
const releaseButton = () => h.ev(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent.trim() === 'ปล่อยเข้าไลน์การผลิต')
  return b ? { disabled: b.disabled, reason: b.nextElementSibling?.textContent ?? '' } : null
})
const waitDialog = (re, what, ms = 10000) => waitFor(async () => re.test(await dialogText()), what, ms)

try {
  await fetch(stack.origin + '/__qa/reset', { method: 'POST' })
  await sql('update public.production_settings set materials_check = true')
  const fx = (await createFixtures(h)).paths
  const accounts = await (await fetch(stack.origin + '/__qa/accounts')).json()
  const id = k => accounts.find(a => a.key === k).id
  const receive = async (no, sample) => (await as(id('admin1'), `public.receive_job(p_confirmation_no => $2, p_customer_name => 'ร้านทดสอบวัตถุดิบ', p_job_name => 'เสื้อทีม', p_product_type_code => 'tshirt',
    p_qty => 120, p_unit => 'ตัว', p_due_date => (current_date + 20), p_route_code => 'cut_only', p_confirmation_pdf_path => null,
    p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => $3) as id`, [no, sample]))[0].id
  const plain = await receive('SC888001', false)
  const sample = await receive('SC888002', true)
  const earlier = await receive('SC888003', false)

  await step('received-waits-in-materials', async () => {
    const rows = await sql('select confirmation_no, phase, current_station from public.job_live where id = any($1::uuid[]) order by confirmation_no', [[plain, sample, earlier]])
    if (rows.some(r => r.phase !== 'materials' || r.current_station)) throw new Error(JSON.stringify(rows))
    return 'รับงาน 3 งาน อยู่ขั้นรอผลิต ยังไม่มีสถานี'
  })

  for (const w of [1440, 375]) {
    await step(`board-column-${w}`, async () => {
      await h.goto('admin1', '#/board', w)
      await h.waitText('SC888001')
      const col = await h.ev(() => [...document.querySelectorAll('h2, h3, button')].some(e => /^รอผลิต/.test(e.textContent.trim())))
      if (!col) throw new Error('ไม่มีคอลัมน์รอผลิต')
      await h.waitText('รอเช็ควัตถุดิบ')
      await h.screenshot(`materials-board-${w}`)
      return 'คอลัมน์รอผลิต + ป้ายรอเช็ควัตถุดิบ'
    })
  }

  await step('staff-and-qc-do-not-see-waiting-jobs', async () => {
    for (const who of ['staff_single', 'qc']) {
      await h.goto(who, '#/board', 375)
      await new Promise(r => setTimeout(r, 800))
      const text = await h.ev(() => document.body.innerText)
      if (text.includes('SC888001')) throw new Error(`${who} เห็นงานที่ยังไม่ปล่อย`)
    }
    return 'พนักงานตัด + QC ไม่เห็นงานรอผลิต'
  })

  await step('empty-list-blocks-release', async () => {
    await h.goto('admin1', `#/board?job=${plain}`, 375)
    await waitDialog(/รอผลิต · เช็ควัตถุดิบ/, 'แผงเช็ควัตถุดิบ')
    const b = await releaseButton()
    if (!b?.disabled || !/เพิ่มรายการวัตถุดิบ/.test(b.reason)) throw new Error(JSON.stringify(b))
    return b.reason
  })

  // เวลาไทยของวันพรุ่งนี้ / เมื่อวาน สำหรับช่องวันเวลา (YYYY-MM-DDTHH:mm)
  const bkk = (days, hhmm) => {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86_400_000))
    return `${d}T${hhmm}`
  }
  const addItem = async (name, { eta = '', have = false } = {}) => {
    await h.fillInput('[role="dialog"] input[placeholder^="เช่น ผ้า"]', name)
    if (eta) await h.fillInput('[role="dialog"] form input[type="datetime-local"]', eta)
    if (have) await h.ev(() => { const c = [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')].find(x => x.closest('label')?.textContent.includes('มีของแล้ว')); if (!c.checked) c.click() })
    await h.clickButton('เพิ่ม', { exact: true, inside: '[role="dialog"]' })
  }

  await step('admin-adds-items-with-eta', async () => {
    await addItem('ผ้าคอตตอน 32 สีขาว 60 หลา')
    await waitDialog(/ใส่วันเวลาที่คาดว่าจะได้รับ "ผ้าคอตตอน 32 สีขาว 60 หลา" หรือติ๊ก "มีของแล้ว"/, 'ต้องมีวันที่หรือมีของแล้ว')
    await addItem('ผ้าคอตตอน 32 สีขาว 60 หลา', { eta: bkk(1, '14:30') })
    await waitDialog(/เพิ่ม "ผ้าคอตตอน 32 สีขาว 60 หลา" แล้ว/, 'เพิ่มผ้า')
    await addItem('ด้ายสีดำ', { have: true })
    await waitDialog(/เพิ่ม "ด้ายสีดำ" \(มีของแล้ว\) แล้ว/, 'เพิ่มด้าย มีของแล้ว')
    await addItem('ป้ายคอ', { eta: bkk(-1, '09:00') })
    await waitDialog(/เพิ่ม "ป้ายคอ" แล้ว/, 'เพิ่มป้ายคอ')
    await addItem(' ด้ายสีดำ ', { eta: bkk(2, '10:00') })
    await waitDialog(/มี "ด้ายสีดำ" ในรายการแล้ว/, 'ชื่อซ้ำ')
    await waitDialog(/คาดว่าได้รับ \d+ \S+ 14:30 น\./, 'วันคาดว่าได้รับของผ้า')
    await waitDialog(/เลยกำหนดรับ \d+ \S+ 09:00 น\./, 'ป้ายคอเลยกำหนด')
    await waitDialog(/วัตถุดิบเลยกำหนดรับ 1 รายการ: ป้ายคอ/, 'แถบเตือนเลยกำหนด')
    const rows = await sql('select name, eta is not null e, checked_at is not null c from public.job_materials where job_id = $1 order by id', [plain])
    if (JSON.stringify(rows.map(r => [r.name, r.e, r.c])) !== JSON.stringify([['ผ้าคอตตอน 32 สีขาว 60 หลา', true, false], ['ด้ายสีดำ', false, true], ['ป้ายคอ', true, false]])) throw new Error(JSON.stringify(rows))
    await h.screenshot('materials-eta-375', { fullPage: true })
    return 'ต้องมีวันที่หรือมีของแล้ว · มีของแล้วติ๊กให้เลย · เลยกำหนดขึ้นแดง'
  })

  await step('late-card-then-reschedule', async () => {
    await h.goto('admin1', '#/board', 1440)
    await h.waitText('วัตถุดิบเลยกำหนดรับ')
    await h.screenshot('materials-late-card-1440')
    await h.goto('admin1', `#/board?job=${plain}`, 375)
    await waitDialog(/เลื่อนวันที่คาดว่าได้รับ/, 'ปุ่มเลื่อนวัน')
    await h.clickButton('เลื่อนวันที่คาดว่าได้รับ', { exact: true, inside: '[role="dialog"]', index: 1 })
    await h.fillInput('[role="dialog"] li form input[type="datetime-local"]', bkk(2, '11:00'))
    await h.clickButton('บันทึกวันที่', { exact: true, inside: '[role="dialog"]' })
    await waitDialog(/บันทึกวันที่คาดว่าได้รับ "ป้ายคอ" แล้ว/, 'บันทึกวันใหม่')
    await waitFor(async () => !/วัตถุดิบเลยกำหนดรับ 1 รายการ/.test(await dialogText()), 'แถบเตือนหายหลังเลื่อนวัน', 10000)
    await waitDialog(/เลื่อนวันที่คาดว่าได้รับ: ป้ายคอ/, 'ประวัติเลื่อนวัน', 10000)
    await h.goto('admin1', '#/board', 1440)
    await h.waitText('ของถึง')
    if (await h.ev(() => document.body.innerText.includes('วัตถุดิบเลยกำหนดรับ'))) throw new Error('การ์ดยังแดงหลังเลื่อนวัน')
    await h.goto('admin1', `#/board?job=${plain}`, 375)
    await waitDialog(/รอผลิต · เช็ควัตถุดิบ/, 'กลับมาที่แผง')
    return 'การ์ดแดงเมื่อเลยกำหนด · เลื่อนวันแล้วการ์ดบอกวันของถึง · ประวัติบันทึก'
  })

  await step('tick-and-remove', async () => {
    await h.clickButton(/^ผ้าคอตตอน 32 สีขาว 60 หลา/, { inside: '[role="dialog"]' })
    await waitDialog(/ติ๊ก "ผ้าคอตตอน 32 สีขาว 60 หลา" แล้ว/, 'ติ๊กผ้า')
    await waitDialog(/ติ๊กแล้ว 2\/3 รายการ/, 'ยอดติ๊ก 2/3')
    await waitDialog(/ได้รับแล้ว/, 'ได้รับแล้ว')
    const b = await releaseButton()
    if (!b?.disabled || b.reason !== 'ยังไม่ได้ติ๊กวัตถุดิบ: ป้ายคอ · เช็คของให้ครบก่อนปล่อยเข้าไลน์') throw new Error(JSON.stringify(b))
    await h.ev(() => document.querySelector('[role="dialog"] button[aria-label=\'ลบ "ป้ายคอ" ออกจากรายการ\']').click())
    await waitDialog(/ลบ "ป้ายคอ" ออกจากรายการแล้ว/, 'ลบป้ายคอ')
    await waitFor(() => h.ev(() => document.querySelectorAll('[role="dialog"] [role="checkbox"]').length === 2), 'รายการโหลดใหม่หลังลบ', 10000)
    const checked = await h.ev(() => [...document.querySelectorAll('[role="dialog"] [role="checkbox"]')].map(b => b.getAttribute('aria-checked')))
    if (checked.join() !== 'true,true') throw new Error('สถานะติ๊กหลังลบ ' + checked)
    const again = await releaseButton()
    if (!again?.disabled || !/ถ่ายรูปวัตถุดิบอย่างน้อย 1 รูป/.test(again.reason)) throw new Error(JSON.stringify(again))
    return 'ติ๊ก 2 · ลบ 1 · รายการเดิมคงติ๊ก · ยังติดรูป'
  })

  await step('admin-photographs-materials', async () => {
    await h.uploadFiles('[role="dialog"] input[type=file][multiple][accept^="image/jpeg"]', [fx.backJpg])
    await waitDialog(/เพิ่มรูปวัตถุดิบ 1 รูปแล้ว/, 'เพิ่มรูป', 15000)
    await waitFor(() => h.ev(() => { const i = document.querySelector('[role="dialog"] img[alt="รูปที่ 1"]'); return !!i && i.complete && i.naturalWidth > 0 }), 'รูปวัตถุดิบโหลด', 10000)
    const [{ path }] = await sql('select path from public.job_material_photos where job_id = $1', [plain])
    if (!path.startsWith('SC888001/')) throw new Error(path)
    await h.screenshot('materials-ready-375', { fullPage: true })
    return path
  })

  await step('release-into-line', async () => {
    const before = (await sql('select queue_seq from public.jobs where id = $1', [earlier]))[0].queue_seq
    await h.clickButton('ปล่อยเข้าไลน์การผลิต', { exact: true, inside: '[role="dialog"]' })
    await waitDialog(/ปล่อย SC888001 เข้าไลน์การผลิต: เข้าคิวสถานีตัด/, 'กล่องยืนยัน')
    await h.screenshot('materials-confirm-375')
    await h.clickButton('ยืนยันปล่อยเข้าไลน์', { exact: true, inside: '[role="dialog"]' })
    await waitFor(() => h.ev(() => document.body.innerText.includes('ปล่อย SC888001 เข้าไลน์การผลิตแล้ว')), 'ข้อความปล่อยแล้ว', 10000)
    const [j] = await sql('select phase, current_station, station_status, queue_seq from public.job_live where id = $1', [plain])
    if (j.phase !== 'production' || j.current_station !== 'cut' || j.station_status !== 'queued') throw new Error(JSON.stringify(j))
    if (!(Number(j.queue_seq) > Number(before))) throw new Error(`คิว ${j.queue_seq} ไม่ต่อท้าย ${before}`)
    const [e] = await sql("select payload from public.events where job_id = $1 and type = 'released'", [plain])
    if (e.payload.manual !== true || e.payload.materials !== 2 || e.payload.photos !== 1) throw new Error(JSON.stringify(e.payload))
    const [lead] = await sql('select sla from public.job_live where id = $1', [plain])
    const today = (await sql("select (now() at time zone 'Asia/Bangkok')::date::text d"))[0].d
    if (lead.sla?.lead_start !== today) throw new Error('เวลาผลิตเริ่ม ' + JSON.stringify(lead.sla))
    return `สถานีตัด · คิวต่อท้ายงานที่รับก่อน · เวลาผลิตเริ่ม ${today}`
  })

  await step('history-shows-release', async () => {
    await h.goto('admin1', `#/board?job=${plain}`, 1440)
    await waitDialog(/ปล่อยเข้าไลน์การผลิต/, 'ประวัติ')
    const t = await dialogText()
    for (const want of ['ตั้งรายการวัตถุดิบ', 'ถ่ายรูปวัตถุดิบ 1 รูป', 'เช็ควัตถุดิบครบ 2 รายการ · รูป 1 รูป']) if (!t.includes(want)) throw new Error('ไม่มี ' + want)
    if (t.includes('รอผลิต · เช็ควัตถุดิบ')) throw new Error('แผงเช็ควัตถุดิบยังอยู่หลังปล่อย')
    return 'ประวัติงานครบ'
  })

  await step('staff-sees-released-job', async () => {
    await h.goto('staff_single', '#/board', 375)
    await h.waitText('SC888001', 12000)
    return 'พนักงานตัดเห็นงานหลังปล่อย'
  })

  await step('production-read-only', async () => {
    for (const name of ['ผ้าโพลี', 'หมึกสีแดง']) await as(id('admin1'), "public.add_job_material($2::uuid, $3, now() + interval '2 days')", [sample, name])
    await h.goto('prod1', `#/board?job=${sample}`, 768)
    await waitDialog(/ติ๊กแล้ว 0\/2 รายการ/, 'แผงอ่านอย่างเดียว')
    const controls = await h.ev(() => ({
      input: !!document.querySelector('[role="dialog"] input[placeholder^="เช่น ผ้า"]'),
      checkbox: document.querySelectorAll('[role="dialog"] [role="checkbox"]').length,
      release: [...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.includes('ปล่อยเข้าไลน์')),
      camera: !!document.querySelector('[role="dialog"] input[type=file][multiple][accept^="image/jpeg"]'),
    }))
    if (controls.input || controls.checkbox || controls.release || controls.camera) throw new Error(JSON.stringify(controls))
    await h.screenshot('materials-readonly-768')
    return 'ฝ่ายผลิตเห็นรายการ ไม่มีปุ่มแก้/ปล่อย'
  })

  for (const w of [375, 768, 1440]) {
    await step(`drawer-ux-${w}`, async () => {
      await h.goto('admin1', `#/board?job=${sample}`, w)
      await waitDialog(/ติ๊กแล้ว 0\/2 รายการ/, 'แผงเช็ควัตถุดิบ')
      await new Promise(r => setTimeout(r, 700))
      const m = await h.ev(() => {
        const d = document.querySelector('[role="dialog"]')
        const wide = [...d.querySelectorAll('*')].filter(el => el.getClientRects().length && !el.closest('.overflow-auto,.overflow-x-auto') && el.getBoundingClientRect().right > innerWidth + 2).map(el => el.tagName + ':' + el.textContent.trim().slice(0, 30))
        const small = [...d.querySelectorAll('button')].filter(b => b.getClientRects().length && /min-h-12|size-12/.test(b.className) && b.getBoundingClientRect().height < 47.5).map(b => b.textContent.trim())
        return { scroll: document.documentElement.scrollWidth, wide: wide.slice(0, 4), small }
      })
      if (m.scroll > w + 1 || m.wide.length || m.small.length) throw new Error(JSON.stringify(m))
      await h.screenshot(`materials-drawer-${w}`)
      return `กว้าง ${w} ไม่ล้น ปุ่มสูง ≥ 48`
    })
  }

  await step('sample-job-goes-to-sample', async () => {
    const [m] = await sql("select array_agg(id) ids from public.job_materials where job_id = $1", [sample])
    for (const mid of m.ids) await as(id('admin1'), 'public.check_material($2::bigint, true)', [mid])
    const photo = 'SC888002/abcdef12.jpg'
    await sql("insert into private.file_objects (kind, path, size, content_type) values ('mockups', $1, 40, 'image/jpeg')", [photo])
    stack.r2Store.set('mockups/' + photo, { bytes: new Uint8Array(await readFile(fx.backJpg)), type: 'image/jpeg' })
    await as(id('admin1'), 'public.add_material_photos($2::uuid, $3::text[])', [sample, [photo]])
    await h.goto('admin1', `#/board?job=${sample}`, 1440)
    await waitDialog(/ติ๊กแล้ว 2\/2 รายการ · รูป 1 รูป/, 'พร้อมปล่อย')
    await h.clickButton('ปล่อยเข้าไลน์การผลิต', { exact: true, inside: '[role="dialog"]' })
    await waitDialog(/ไปขึ้นตัวอย่างที่สถานีแรก/, 'กล่องยืนยันงานตัวอย่าง')
    await h.clickButton('ยืนยันปล่อยเข้าไลน์', { exact: true, inside: '[role="dialog"]' })
    await waitFor(async () => (await sql('select phase from public.jobs where id = $1', [sample]))[0].phase === 'sample', 'งานไปขึ้นตัวอย่าง', 10000)
    return 'งานขึ้นตัวอย่างไปขั้นตัวอย่าง'
  })

  await step('outsource-from-waiting-without-check', async () => {
    const outJob = (await as(id('admin1'), `public.receive_job(p_confirmation_no => 'SC888010', p_customer_name => 'บ.ส่งออก', p_job_name => 'ผ้าเช็ดแว่น', p_product_type_code => 'glasses',
      p_qty => 500, p_unit => 'ผืน', p_due_date => (current_date + 20), p_route_code => 'outside', p_confirmation_pdf_path => null,
      p_spare_qty => 0, p_confirmation_rev => 0, p_spec => '{}'::jsonb, p_needs_sample => false) as id`, []))[0].id
    await h.goto('admin1', `#/board?job=${outJob}`, 375)
    await waitDialog(/ส่งออกได้เลยไม่ต้องเช็ควัตถุดิบ/, 'คำบอกส่งออกจากรอผลิต')
    await h.clickButton('ส่งออกบริษัทภายนอก', { exact: true, inside: '[role="dialog"]' })
    await waitDialog(/ส่ง SC888010 ออกบริษัทภายนอก/, 'ฟอร์มส่งออก')
    await h.ev(() => {
      const sel = [...document.querySelectorAll('[role="dialog"] select')].find(s => s.closest('label')?.textContent.includes('บริษัท'))
      sel.value = [...sel.options].find(o => o.value).value
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await h.screenshot('materials-outsource-375', { fullPage: true })
    await h.clickButton('บันทึกส่งออก', { exact: true, inside: '[role="dialog"]' })
    await waitFor(async () => (await sql('select station_status from public.jobs where id = $1', [outJob]))[0].station_status === 'out', 'งานอยู่ที่บริษัทภายนอก', 12000)
    const [j] = await sql('select phase, station_status, current_station from public.job_live where id = $1', [outJob])
    if (j.phase !== 'production' || j.current_station !== 'outside') throw new Error(JSON.stringify(j))
    await waitDialog(/อยู่ที่บริษัทภายนอก/, 'แผงอยู่ที่บริษัทภายนอก', 12000)
    await waitDialog(/ส่งออกบริษัทภายนอก · ไม่ต้องเช็ควัตถุดิบ/, 'ประวัติบอกไม่ต้องเช็ควัตถุดิบ', 12000)
    if (/รอผลิต · เช็ควัตถุดิบ/.test(await dialogText())) throw new Error('แผงรอผลิตยังอยู่')
    return 'งานรอผลิตส่งออกได้เลย · ไม่มีรายการ/รูปก็ได้ · ประวัติบอกไม่ต้องเช็ค'
  })
} finally {
  await chrome.close()
  await stack.close?.()
}
const failed = results.filter(r => !r).length
console.log(failed ? `ไม่ผ่าน ${failed}` : `ผ่านทั้งหมด ${results.length}`)
process.exit(failed ? 1 : 0)
