// ใบงานบริการ 4 แบบ: กรอกฟอร์ม → ใบร่าง → รับงาน (เส้นทางล็อกตามใบ) → รอผลิต (รายการของลูกค้าตั้งต้น) → ปล่อย → สถานีเดียว · ระบบจำลองในเครื่องเท่านั้น
import { startLocalStack } from './server.mjs'
import { openChrome, waitFor } from './chrome.mjs'
import { createFixtures } from './fixtures.mjs'

const stack = await startLocalStack()
if (!/^http:\/\/127\.0\.0\.1:/.test(stack.origin)) throw new Error('ต้องเป็นระบบในเครื่องเท่านั้น')
const chrome = await openChrome({ origin: stack.origin, filesOrigin: stack.filesOrigin })
const t = chrome.wrap(chrome.main)
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
    results.push(true); console.log(`PASS ${id} ${d ?? ''}`)
  } catch (e) { results.push(false); console.log(`FAIL ${id} · ${e?.message ?? e}`) }
}
const dialogText = () => t.ev(() => document.querySelector('[role="dialog"]')?.innerText.replace(/\s+/g, ' ') ?? '')

// กรอกทุกช่องที่เห็นแบบเดียวกับ confirmation-all แล้วตั้งค่าที่กำหนดเส้นทางตามกรณี
async function fillForm(product, no, set) {
  await t.goto('admin1', '', 1440, '/confirmation')
  await t.waitText('ใบยืนยันการผลิต')
  return t.ev((k, docNo, overrides) => {
    if (document.body.classList.contains('preview')) togglePreview(false)
    state = fresh(); state.pickOpen = false; state.product = k
    Object.assign(state.h, { doc_no: docNo, job_name: 'งานบริการ ' + docNo, admin: 'น้ำ', issue_date: '2026-11-26',
      sample: 'ไม่ขึ้นตัวอย่าง', due_date: '2026-12-20', customer: 'ร้านลูกค้าส่งของ', contact: 'คุณบี', phone: '080-000-0000', delivery: 'ลูกค้ารับเองที่โรงงาน' })
    Object.assign(scope('p'), overrides)
    for (let pass = 0; pass < 5; pass++) {
      layout().filter(sec => sec.fields).forEach(sec => {
        const v = scope(sec.s)
        sec.fields.forEach(f => {
          if (!visible(f, v) || f.type === 'images') return
          const val = v[f.id]
          switch (f.type) {
            case 'text': case 'textarea': if (!String(val ?? '').trim()) v[f.id] = 'ตัวอย่าง'; break
            case 'date': if (!val) v[f.id] = '2026-12-01'; break
            case 'number': if (!(num(val) > 0)) v[f.id] = f.id === 'rev' ? '' : 5; break
            case 'radio': if (!val) v[f.id] = f.options[0]; break
            case 'check': if (!(val || []).length) v[f.id] = [f.options[0]]; break
            case 'sizeTable': { const rs = rows(v, f.id), cols = sizeCols(v); if (!rs[0].label) { rs[0].label = 'สีขาว'; cols.slice(0, 3).forEach((c, i) => { rs[0].q[c] = 20 + i * 10 }) } break }
            case 'itemTable': {
              if (f.id === 'supplied') { if (!rows(v, f.id, true).length) v[f.id] = [{ item: 'ของลูกค้าตัวอย่าง', qty: 60, unit: 'ชิ้น', note: 'สภาพดี' }]; break }
              const rs = rows(v, f.id, !!f.none)
              if (!f.none && (!rs.length || !rs[0][f.cols[0].c])) {
                const r = {}; f.cols.forEach(c => { r[c.c] = c.t === 'select' ? c.options[0] : c.t === 'img' ? '' : c.t === 'number' ? 30 : 'ตัวอย่าง' })
                if (rs.length) Object.assign(rs[0], r); else rs.push(r)
              }
              break
            }
            case 'placements': if (!Object.values(val || {}).some(x => x.on)) v[f.id] = { [f.positions[0]]: { on: true, size: '10 × 10', tech: 'สกรีน DTF' } }; break
          }
        })
      })
    }
    renderForm()
    return { ...state, imgs: [], summary: { qty: totalQty() }, ...systemCopy() }
  }, product, no, set)
}

try {
  await fetch(stack.origin + '/__qa/reset', { method: 'POST' })
  await sql('update public.production_settings set materials_check = true')
  await createFixtures(t)
  const accounts = await (await fetch(stack.origin + '/__qa/accounts')).json()
  const id = k => accounts.find(a => a.key === k).id
  const cases = [
    { no: 'SC889001', product: 'svc_sew', set: { garment: 'เสื้อโปโล' }, route: 'เย็บอย่างเดียว', job: 'polo', station: 'sew', short: 'เย็บอย่างเดียว' },
    { no: 'SC889002', product: 'svc_print', set: { print_output: 'ส่งกระดาษให้ลูกค้า (ลูกค้ารีดเอง)' }, route: 'พิมพ์อย่างเดียว (ส่งกระดาษ)', job: 'svc_print', station: 'print', short: 'พิมพ์อย่างเดียว' },
    { no: 'SC889003', product: 'svc_print', set: { print_output: 'พิมพ์แล้วรีดลงผ้าของลูกค้า' }, route: 'พิมพ์ + รีดลงผ้าลูกค้า', job: 'svc_print', station: 'print', short: 'พิมพ์+รีด' },
    { no: 'SC889004', product: 'svc_press', set: {}, route: 'รีดอย่างเดียว', job: 'svc_press', station: 'press', short: 'รีดอย่างเดียว' },
    { no: 'SC889005', product: 'svc_dtf', set: { film_source: 'ลูกค้าส่งฟิล์มมาเอง' }, route: 'DTF อย่างเดียว', job: 'svc_dtf', station: 'dtf_press', short: 'DTF อย่างเดียว', film: true },
    { no: 'SC889006', product: 'svc_dtf', set: { film_source: 'โรงงานสั่งฟิล์ม' }, route: 'DTF อย่างเดียว', job: 'svc_dtf', station: 'dtf_press', short: 'DTF อย่างเดียว', film: false },
  ]

  for (const c of cases) {
    await step(`${c.no}-form-to-draft`, async () => {
      const data = await fillForm(c.product, c.no, c.set)
      const missing = (await t.ev(() => validate())).filter(m => m.id !== 'fld_p_images')
      if (missing.length) throw new Error('ฟอร์มยังขาด ' + JSON.stringify(missing).slice(0, 200))
      if (c.product === 'svc_sew' && data.p.svc_sew.garment_code !== c.job) throw new Error('garment_code ' + data.p.svc_sew.garment_code)
      await as(id('admin1'), 'public.save_confirmation_draft($2::jsonb)', [JSON.stringify(data)])
      return `${c.product} · ยอด ${data.summary.qty}`
    })

    await step(`${c.no}-receive-route-locked`, async () => {
      await t.goto('admin1', '#/', 1440)
      await t.clickButton('รับงานใหม่')
      await t.waitText('รับงานเข้าโรงงาน')
      await waitFor(() => t.ev(no => [...document.querySelectorAll('[role="dialog"] select option')].some(o => o.textContent.includes(no)), c.no), 'ใบร่างในรายการ', 10000)
      await t.ev(no => {
        const sel = [...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.textContent.includes(no)))
        sel.value = [...sel.options].find(o => o.textContent.includes(no)).value
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      }, c.no)
      await t.waitText('ใบงานบริการกำหนดเส้นทางเอง')
      const route = await t.ev(() => {
        const sel = [...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.value === 'sew_only'))
        return { disabled: sel?.disabled, text: sel?.selectedOptions[0]?.textContent }
      })
      if (!route.disabled || route.text !== c.route) throw new Error(JSON.stringify(route))
      if (c.no === 'SC889001') await t.screenshot('service-receive-1440')
      await t.clickButton(/^รับงาน$/, { exact: true, inside: '[role="dialog"]' })
      await t.waitText(`ส่งงาน ${c.no} เข้าโรงงานแล้ว`, 12000)
      return route.text
    })

    await step(`${c.no}-waiting-with-checklist`, async () => {
      const [j] = await sql(`select id, phase, product_type_code, route_code, dtf_film_received_at from public.jobs where confirmation_no = $1`, [c.no])
      if (j.phase !== 'materials' || j.product_type_code !== c.job) throw new Error(JSON.stringify(j))
      if (c.film !== undefined && !!j.dtf_film_received_at !== c.film) throw new Error('ฟิล์ม ' + j.dtf_film_received_at)
      const rows = await sql("select name, to_char(eta at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') eta from public.job_materials where job_id = $1 order by id", [j.id])
      if (rows.some(r => r.eta !== '2026-12-01 17:00')) throw new Error('วันคาดว่าได้รับ ' + JSON.stringify(rows))
      const items = rows.map(r => r.name)
      const want = ['ของลูกค้าตัวอย่าง 60 ชิ้น (สภาพดี)', ...(c.film ? ['ฟิล์ม DTF ของลูกค้า'] : [])]
      if (JSON.stringify(items) !== JSON.stringify(want)) throw new Error(JSON.stringify(items))
      c.id = j.id
      return items.join(' · ') + ' · ของถึง 1 ธ.ค. 17:00'
    })
  }

  await step('customer-fabric-hint-on-receive', async () => {
    const fabric = 'ลูกค้าส่งผ้ามาเอง (ไม่มีลายที่ต้องพิมพ์ · ตัด/เย็บอย่างเดียว)'
    for (const [no, method] of [['SC889101', fabric], ['SC889102', 'DTF']]) {
      const data = await fillForm('tshirt', no, { print_method: [method] })
      await as(id('admin1'), 'public.save_confirmation_draft($2::jsonb)', [JSON.stringify(data)])
    }
    const hintFor = async no => {
      await t.goto('admin1', '#/', 1440)
      await t.clickButton('รับงานใหม่')
      await t.waitText('รับงานเข้าโรงงาน')
      await waitFor(() => t.ev(n => [...document.querySelectorAll('[role="dialog"] select option')].some(o => o.textContent.includes(n)), no), 'ใบร่างในรายการ', 10000)
      await t.ev(n => {
        const sel = [...document.querySelectorAll('[role="dialog"] select')].find(s => [...s.options].some(o => o.textContent.includes(n)))
        sel.value = [...sel.options].find(o => o.textContent.includes(n)).value
        sel.dispatchEvent(new Event('change', { bubbles: true }))
      }, no)
      await waitFor(() => t.ev(n => [...document.querySelectorAll('[role="dialog"] input')].some(i => i.value === n), no), 'เปิดใบ ' + no, 10000)
      return (await dialogText()).includes('ผ้าที่ตัดมาแล้วเย็บอย่างเดียว ให้ทำใบ "เย็บอย่างเดียว"')
    }
    if (!(await hintFor('SC889101'))) throw new Error('ใบลูกค้าส่งผ้ามาเอง ไม่มีคำแนะนำ')
    await t.screenshot('receive-customer-fabric-hint-1440')
    if (await hintFor('SC889102')) throw new Error('ใบ DTF มีคำแนะนำผ้าลูกค้า')
    return 'ลูกค้าส่งผ้ามาเอง = แนะนำใบเย็บอย่างเดียว · DTF = ไม่แนะนำ'
  })

  await step('board-badges-and-drawer', async () => {
    await t.goto('admin1', '#/board', 1440)
    await t.waitText('SC889006')
    const text = await t.ev(() => document.body.innerText)
    for (const s of ['เย็บอย่างเดียว', 'พิมพ์อย่างเดียว', 'พิมพ์+รีด', 'รีดอย่างเดียว', 'DTF อย่างเดียว']) if (!text.includes(s)) throw new Error('ไม่มีป้าย ' + s)
    await t.goto('admin1', `#/board?job=${cases[0].id}`, 375)
    await waitFor(async () => /ของลูกค้าตัวอย่าง 60 ชิ้น/.test(await dialogText()), 'รายการของลูกค้าในแผงรอผลิต', 10000)
    await t.screenshot('service-drawer-375', { fullPage: true })
    return 'ป้ายเส้นทางครบ 5 แบบ · แผงรอผลิตมีรายการของลูกค้า'
  })

  await step('release-goes-to-single-station', async () => {
    for (const [i, c] of cases.entries()) {
      for (const m of await sql('select id from public.job_materials where job_id = $1', [c.id])) await as(id('admin1'), 'public.check_material($2::bigint, true)', [m.id])
      const [{ f }] = await sql('select private.mockup_folder($1) f', [c.no])
      const photo = `${f}/beef${i}.jpg`
      await sql("insert into private.file_objects (kind, path, size, content_type) values ('mockups', $1, 40, 'image/jpeg')", [photo])
      await as(id('admin1'), 'public.add_material_photos($2::uuid, $3::text[])', [c.id, [photo]])
      await as(id('admin1'), 'public.release_job($2::uuid)', [c.id])
      const [j] = await sql('select phase, current_station from public.job_live where id = $1', [c.id])
      if (j.phase !== 'production' || j.current_station !== c.station) throw new Error(`${c.no} ${JSON.stringify(j)}`)
    }
    return 'ทุกงานเข้าสถานีที่ถูกต้อง'
  })

  await step('work-through-to-qc', async () => {
    const prod = id('prod1')
    const sew = cases[0]
    await as(prod, 'public.start_sewing($2::uuid)', [sew.id])
    await as(prod, 'public.finish_sewing($2::uuid)', [sew.id])
    const fab = cases[2]
    await as(prod, 'public.start_in_queue($2::uuid, $3)', [fab.id, 'ทดสอบงานบริการ'])
    await as(prod, 'public.finish_station($2::uuid, $3)', [fab.id, 'print'])
    const own = cases[4]
    await as(prod, 'public.start_in_queue($2::uuid, $3)', [own.id, 'ทดสอบงานบริการ'])
    let blocked = ''
    try { await as(prod, 'public.start_in_queue($2::uuid, $3)', [cases[5].id, 'ทดสอบงานบริการ']) } catch (e) { blocked = e.message }
    if (!/ฟิล์ม/.test(blocked)) throw new Error('DTF โรงงานสั่งฟิล์มเริ่มได้ทั้งที่ยังไม่ได้รับฟิล์ม: ' + blocked)
    const where = Object.fromEntries((await sql('select confirmation_no, current_station from public.job_live where id = any($1::uuid[])', [[sew.id, fab.id]])).map(r => [r.confirmation_no, r.current_station]))
    if (where.SC889001 !== 'qc_pack' || where.SC889003 !== 'press') throw new Error(JSON.stringify(where))
    return 'เย็บ → QC · พิมพ์ → รีด · DTF ลูกค้าส่งฟิล์มเริ่มได้ · DTF รอฟิล์มเริ่มไม่ได้'
  })

  await step('normal-product-hides-service-routes', async () => {
    await t.goto('admin1', '#/', 1440)
    await t.clickButton('รับงานใหม่')
    await t.waitText('รับงานเข้าโรงงาน')
    const opts = await t.ev(() => {
      const dlg = document.querySelector('[role="dialog"]')
      const prod = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'tshirt'))
      prod.value = 'tshirt'; prod.dispatchEvent(new Event('change', { bubbles: true }))
      const route = [...dlg.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'normal'))
      return [...route.options].map(o => o.value)
    })
    if (opts.includes('sew_only') || !opts.includes('normal')) throw new Error(opts.join(','))
    return 'เสื้อยืดไม่มีเส้นทางงานบริการให้เลือก'
  })

  await step('form-size-other-columns', async () => {
    await t.goto('admin1', '', 1440, '/confirmation')
    await t.waitText('ใบยืนยันการผลิต')
    await t.ev(() => { if (document.body.classList.contains('preview')) togglePreview(false); state = fresh(); state.pickOpen = false; state.product = 'svc_sew'; scope('p').size_sets = ['ไซซ์เด็ก']; renderForm() })
    await t.ev(() => [...document.querySelectorAll('input[type=checkbox][data-k="size_sets"]')].find(c => c.value === 'อื่นๆ').click())
    await t.fillInput('input[data-k="size_sets__other"]', 'เด็ก 2XL, 10 ปี')
    await t.ev(() => document.querySelector('input[data-k="size_sets__other"]').dispatchEvent(new Event('change', { bubbles: true })))
    await waitFor(() => t.ev(() => [...document.querySelectorAll('th input.sizename')].some(h => h.value === '10 ปี')), 'คอลัมน์ไซซ์ที่พิมพ์เอง', 8000)
    const heads = await t.ev(() => [...new Set([...document.querySelectorAll('th input.sizename')].map(h => h.value))].filter(x => /เด็ก|ปี/.test(x)))
    if (!heads.includes('เด็ก 2XL') || !heads.includes('เด็ก XL')) throw new Error(heads.join(','))
    await t.ev(() => document.querySelector('input[data-k="size_sets__other"]').scrollIntoView({ block: 'center' }))
    await t.screenshot('service-size-other-1440')
    return heads.join(' · ')
  })

  await step('form-size-rename', async () => {
    const change = (sel, value) => t.ev((s, v) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })) }, sel, value)
    const read = () => t.ev(() => ({
      heads: [...document.querySelectorAll('th input.sizename')].map(i => i.value),
      plain: [...document.querySelectorAll('table.ft th')].map(h => h.textContent.trim()).filter(x => x.startsWith('เด็ก SS')),
      q12: document.querySelector('input[data-c="q:1-2"]')?.value ?? null,
      qSS: document.querySelector('input[data-c="q:เด็ก SS"]')?.value ?? null,
    }))
    const otherBox = () => t.ev(() => [...document.querySelectorAll('input[type=checkbox][data-k="size_sets"]')].find(c => c.value === 'อื่นๆ').click())
    await t.ev(() => { window.__alerts = []; window.alert = m => window.__alerts.push(m) })
    await change('input[data-c="q:เด็ก SS"]', '5')
    await change('input[data-rename="เด็ก SS"]', '1-2')
    let r = await read()
    if (!r.heads.includes('1-2') || r.heads.includes('เด็ก SS') || r.q12 !== '5' || r.qSS !== null) throw new Error('เปลี่ยนชื่อ ' + JSON.stringify(r))
    await change('input[data-rename="เด็ก S"]', '1-2')
    const dup = await t.ev(() => window.__alerts.join(' | '))
    r = await read()
    if (!/มีไซซ์ชื่อ "1-2" ในตารางแล้ว/.test(dup) || !r.heads.includes('เด็ก S')) throw new Error('ชื่อซ้ำ ' + dup + JSON.stringify(r))
    await otherBox()
    r = await read()
    if (r.heads.length || r.qSS !== '5' || r.q12 !== null || !r.plain.length) throw new Error('เอา "อื่นๆ" ออก ' + JSON.stringify(r))
    await otherBox()
    r = await read()
    if (r.q12 !== '5' || !r.heads.includes('1-2')) throw new Error('เลือก "อื่นๆ" อีกครั้ง ' + JSON.stringify(r))
    await change('input[data-k="size_sets__other"]', '')
    const sent = await t.ev(() => {
      const p = systemCopy().p.svc_sew
      return { names: p.size_names, q: p.sizes[0].q, sizeIssue: validate().filter(m => m.id === 'fld_p_size_sets').map(m => m.why) }
    })
    if (JSON.stringify(sent.names) !== '{"เด็ก SS":"1-2"}' || sent.q['1-2'] !== '5' || 'เด็ก SS' in sent.q || sent.sizeIssue.length) throw new Error('ส่งเข้าระบบ ' + JSON.stringify(sent))
    await change('input[data-rename="เด็ก SS"]', '')
    r = await read()
    if (r.qSS !== '5' || !r.heads.includes('เด็ก SS')) throw new Error('ลบชื่อ = กลับชื่อเดิม ' + JSON.stringify(r))
    const empty = await t.ev(() => validate().filter(m => m.id === 'fld_p_size_sets').map(m => m.why).join())
    if (!/แก้ชื่อไซซ์ที่หัวตาราง/.test(empty)) throw new Error('เลือกอื่นๆ แต่ไม่ได้เพิ่ม/แก้ชื่อ ควรเตือน: ' + empty)
    await change('input[data-rename="เด็ก SS"]', '1-2')
    await t.ev(() => document.querySelector('input.sizename').scrollIntoView({ block: 'center' }))
    await t.screenshot('service-size-rename-1440')
    return 'เด็ก SS → 1-2 จำนวนตามไป · ชื่อซ้ำเตือน · เอา/ใส่ "อื่นๆ" จำนวนไม่หาย · ระบบได้ชื่อ 1-2'
  })

  for (const w of [375, 768]) {
    await step(`form-${w}`, async () => {
      await fillForm('svc_dtf', 'SC889099', { film_source: 'ลูกค้าส่งฟิล์มมาเอง' })
      await t.goto('admin1', '', w, '/confirmation')
      await t.waitText('ใบยืนยันการผลิต')
      const wide = await t.ev(() => document.documentElement.scrollWidth)
      if (wide > w + 1) throw new Error('ล้นขวา ' + wide)
      await t.screenshot(`service-form-${w}`, { fullPage: true })
      return `ไม่ล้นที่ ${w}`
    })
  }
} finally {
  await chrome.close()
  await stack.close?.()
}
const failed = results.filter(r => !r).length
console.log(failed ? `ไม่ผ่าน ${failed}` : `ผ่านทั้งหมด ${results.length}`)
process.exit(failed ? 1 : 0)
