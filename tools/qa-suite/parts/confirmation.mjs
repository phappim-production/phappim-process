// ส่วน F: ฟอร์มใบยืนยัน (ตรวจด้วย validate() ของฟอร์มเอง) + สุ่มสินค้าเทียบฉบับลูกค้า/ฉบับโรงงาน + กฎฝั่งฐาน
import { createRng } from '../lib/rng.mjs'

export async function runConfirmationTests(client, browser, fixtures, { seed = 1, quick = false } = {}) {
  const rng = createRng(seed)
  await client.reset(true)
  const tested = []
  const failures = []
  const fail = msg => { throw new Error(msg) }
  const check = async (name, fn) => {
    try { await fn(); tested.push(name) } catch (e) { failures.push(e.message) }
  }

  await browser.goto('admin1', '', 1440, '/confirmation')
  await browser.waitText('ใบยืนยันการผลิต')
  const issuesFor = () => browser.ev(() => validate().map(m => m.id))
  const reset = product => browser.ev(p => {
    if (document.body.classList.contains('preview')) togglePreview(false)
    state = fresh()
    state.product = p
    state.pickOpen = false
    renderForm()
  }, product)
  const setP = (key, value) => browser.ev((k, v) => { scope('p')[k] = v; rerender() }, key, value)

  await check('PR244-collar-color', async () => {
    await reset('tshirt')
    await setP('collar', 'ปกสำเร็จ')
    if (!(await issuesFor()).includes('fld_p_collar_color')) fail('PR244: ปกสำเร็จไม่ใส่สีปกแล้ว validate ไม่ฟ้อง fld_p_collar_color')
    await setP('collar_color', 'ดำ')
    if ((await issuesFor()).includes('fld_p_collar_color')) fail('PR244: ใส่สีปกแล้วยังฟ้อง')
    await setP('collar', 'ไม่มีปก')
    if ((await issuesFor()).includes('fld_p_collar_color')) fail('PR244: ไม่มีปกแต่ยังบังคับสีปก')
  })

  await check('PR245-fabric-qty-unit', async () => {
    await reset('tshirt')
    await setP('fabric_rows', [{ part: 'แขน', fabric: 'ตาข่าย', color: 'ขาว' }])
    if (!(await issuesFor()).includes('fld_p_fabric_rows')) fail('PR245: ผ้าเพิ่มไม่มีจำนวนแล้ว validate ไม่ฟ้อง')
    await setP('fabric_rows', [{ part: 'แขน', fabric: 'ตาข่าย', color: 'ขาว', qty: '2.5', unit: 'หลา' }])
    if ((await issuesFor()).includes('fld_p_fabric_rows')) fail('PR245: ผ้าเพิ่มกรอกครบแล้วยังฟ้อง')
    await setP('fabric_rows', [{ part: 'แขน', fabric: 'ตาข่าย', color: 'ขาว', qty: '0', unit: 'หลา' }])
    if (!(await issuesFor()).includes('fld_p_fabric_rows')) fail('PR245: ผ้าเพิ่มจำนวน 0 แล้วไม่ฟ้อง')
  })

  let copies = ''
  await check('copies', async () => {
    const leaks = []
    let fieldsFilled = 0
    const products = await browser.ev(() => Object.keys(PRODUCTS))
    const sample = quick ? rng.shuffle(products).slice(0, 6) : products
    for (const code of sample) {
      const res = await browser.ev(p => {
        state = fresh()
        state.product = p
        state.pickOpen = false
        Object.assign(state.h, { doc_no: 'QA-DOC', customer: 'ลูกค้า', job_name: 'งาน', due_date: '2099-01-20' })
        const filled = []
        for (const sec of layout().filter(s => s.s === 'p' && s.fields)) {
          for (const f of sec.fields) {
            const v = scope('p')
            if (!['text', 'textarea'].includes(f.type) || !visible(f, v)) continue
            v[f.id] = `QAX${f.id}QAX`
            filled.push({ id: f.id, customer: customerSees(f, sec) })
          }
        }
        const was = viewOnly
        viewOnly = false
        renderDoc()
        const customer = document.querySelector('#doc').innerText
        viewOnly = true
        renderDoc()
        const factory = document.querySelector('#doc').innerText
        viewOnly = was
        let errors = []
        try { errors = validate().filter(m => m.hard).map(m => m.id) } catch (e) { errors = ['validate-crash: ' + e.message] }
        return {
          leaks: filled.filter(x => !x.customer && customer.includes(`QAX${x.id}QAX`)).map(x => x.id),
          missingFactory: filled.filter(x => !factory.includes(`QAX${x.id}QAX`)).map(x => x.id),
          crash: errors.filter(e => e.startsWith('validate-crash')),
          filled: filled.length,
        }
      }, code)
      fieldsFilled += res.filled
      if (res.leaks.length) leaks.push(`${code}: ฉบับลูกค้าแสดงช่องภายใน ${res.leaks.join(', ')}`)
      if (res.missingFactory.length) leaks.push(`${code}: ฉบับโรงงานไม่แสดง ${res.missingFactory.join(', ')}`)
      if (res.crash.length) leaks.push(`${code}: ${res.crash.join(', ')}`)
    }
    if (leaks.length) fail(`ใบยืนยัน ${leaks.length} สินค้า: ${leaks.slice(0, 6).join(' ; ')}`)
    copies = `copies-${sample.length}-products-${fieldsFilled}-fields`
  })

  await check('hem-images', async () => {
    const res = await browser.ev(() => {
      const out = []
      for (const [product, sec] of Object.entries(PRODUCTS)) {
        for (const s of sec.sections) for (const f of s.fields ?? []) {
          if (f.type !== 'radio') continue
          for (const o of f.options) if (OPT_IMG[o]) out.push({ product, field: f.id, option: o })
        }
      }
      const broken = Object.entries(OPT_IMG).filter(([, src]) => !/^data:image\/webp;base64,/.test(src)).map(([o]) => o)
      const unused = Object.keys(OPT_IMG).filter(o => !out.some(x => x.option === o))
      state = fresh()
      state.product = 'scarf'
      state.pickOpen = false
      Object.assign(scope('p'), { item: 'ผ้าพันคอ', sew_mode: SEW_CUSTOM, edge: 'พับริมเย็บ' })
      renderForm()
      const formImgs = document.querySelectorAll('.opt .optimg').length
      const was = viewOnly
      viewOnly = true
      renderDoc()
      const factory = document.querySelectorAll('#doc .optimg').length
      viewOnly = false
      renderDoc()
      const customer = document.querySelectorAll('#doc .optimg').length
      viewOnly = was
      return { used: out.length, broken, unused, formImgs, factory, customer }
    })
    if (res.broken.length || res.unused.length) fail(`รูปเย็บขอบ: รูปเสีย ${res.broken.join(', ')} · ไม่ตรงตัวเลือกใด ${res.unused.join(', ')}`)
    if (res.formImgs < 2) fail(`รูปเย็บขอบ: ฟอร์มแสดงรูป ${res.formImgs} รูป (ควรมีม้วนริม + พับริมเย็บ)`)
    if (res.factory !== 1) fail(`รูปเย็บขอบ: ฉบับโรงงานแสดงรูป ${res.factory} รูป (ควร 1 รูปของแบบที่เลือก)`)
    if (res.customer !== 1) fail(`รูปเย็บขอบ: ฉบับลูกค้าแสดงรูป ${res.customer} รูป (ควร 1 รูป ลูกค้าเห็นรูปแบบการเย็บขอบ)`)
  })

  await check('hem-size', async () => {
    const res = await browser.ev(() => {
      state = fresh()
      state.product = 'scarf'
      state.pickOpen = false
      const v = scope('p')
      Object.assign(v, { item: 'ผ้าพันคอ', sew_mode: SEW_CUSTOM, edge: 'พับริมเย็บ' })
      const ids = () => validate().map(m => m.id)
      const askedWhenFold = ids().includes('fld_p_edge_size')
      v.edge_size = '0.6 ซม.'
      const doneWhenFilled = !ids().includes('fld_p_edge_size')
      const was = viewOnly
      viewOnly = true
      renderDoc()
      const factory = document.querySelector('#doc').innerText
      viewOnly = was
      v.edge = 'โพ้งริม (ริมเล็ก)'
      delete v.edge_size
      const notAskedWhenOverlock = !ids().includes('fld_p_edge_size')
      return { askedWhenFold, doneWhenFilled, printed: /ขนาดพับ \/ ม้วนริม\s*0\.6 ซม\./.test(factory), notAskedWhenOverlock }
    })
    const bad = Object.entries(res).filter(([, ok]) => !ok).map(([k]) => k)
    if (bad.length) fail(`ขนาดพับ/ม้วนริม: ${bad.join(', ')}`)
  })

  await check('mockup-fit-page', async () => {
    const res = await browser.ev(() => {
      const keep = state, wasView = viewOnly, out = {}
      viewOnly = true
      const dot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const g4 = mockupGrid([1, 1, 1, 1], 120)
      out.fourSquaresTwoByTwo = g4.cols === 2 && g4.h >= MOCK_MIN_H
      out.oneImageCapped = mockupGrid([1], 400).h <= 110
      out.wideImageFitsWidth = mockupGrid([3], 400).h <= 190 / 3
      out.tooManyForRoomIsSmall = mockupGrid([1, 1, 1, 1, 1, 1, 1, 1, 1], 60).h < MOCK_MIN_H
      state = fresh()
      state.product = 'scarf'
      state.pickOpen = false
      Object.assign(state.h, { doc_no: 'FIT-1', customer: 'ลูกค้า', job_name: 'ผ้าเช็ดหน้า' })
      Object.assign(scope('p'), { item: 'ผ้าเช็ดหน้า' })
      state.imgs = [1, 2, 3, 4].map(i => ({ name: `ลาย${i}.png`, src: dot, w: 3000, h: 3000 }))
      renderDoc()
      const figs = [...document.querySelectorAll('#doc .fd-mock .d-imgs figure')]
      const widths = new Set(figs.map(f => f.style.width))
      const mh = document.querySelector('#doc .fd-mock .d-imgs')?.style.getPropertyValue('--mh')
      out.allSameSize = figs.length === 4 && widths.size === 1 && !!mh
      out.notOldFixedHeight = mh !== '95mm' && parseFloat(mh) >= MOCK_MIN_H
      viewOnly = wasView
      state = keep
      renderForm()
      return out
    })
    const bad = Object.entries(res).filter(([, ok]) => !ok).map(([k]) => k)
    if (bad.length) fail(`จัดภาพม็อคอัพให้พอดีหน้า: ${bad.join(', ')}`)
  })

  await check('factory-mixed-shapes', async () => {
    const res = await browser.ev(() => {
      const keep = state, wasView = viewOnly, out = {}
      viewOnly = true
      const dot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const longSides = dims => {
        state = fresh()
        state.product = 'scarf'
        state.pickOpen = false
        Object.assign(state.h, { doc_no: 'FIT-2', customer: 'ลูกค้า', job_name: 'สายคล้อง' })
        Object.assign(scope('p'), { item: 'ผ้าเช็ดหน้า' })
        state.imgs = dims.map(([w, h], i) => ({ name: `รูป${i}.png`, src: dot, w, h }))
        renderDoc()
        const d = document.querySelector('#doc'), t = d.querySelector('table.pg')
        d.style.display = 'block'
        t.style.width = '190mm'
        const mm = docMM()
        const sides = [...d.querySelectorAll('.fd-mock .d-imgs figure img')].map((im, i) => {
          const b = im.getBoundingClientRect(), a = dims[i][0] / dims[i][1], w = Math.min(b.width, b.height * a) / mm
          return { long: Math.max(w, w / a), gap: b.height / mm - w / a }
        })
        d.style.display = ''
        t.style.width = ''
        return sides
      }
      const strip = longSides([[6000, 1000], [3000, 3000]])
      out.closeUpBesideStripIsBig = strip[1].long >= 89
      out.stripUsesFullWidth = strip[0].long >= 150
      out.stripHasNoEmptyBand = strip[0].gap < 1
      out.portraitBesideStripIsBig = longSides([[8000, 1000], [3000, 4000], [3000, 4000]]).slice(1).every(s => s.long >= 89)
      out.sameShapesStillBig = longSides([[800, 600], [800, 600], [800, 600], [800, 600]]).every(s => s.long >= 89)
      viewOnly = wasView
      state = keep
      renderForm()
      return out
    })
    const bad = Object.entries(res).filter(([, ok]) => !ok).map(([k]) => k)
    if (bad.length) fail(`ฉบับโรงงานภาพรูปทรงต่างกัน: ${bad.join(', ')}`)
  })

  await check('customer-fields-all-products', async () => {
    const res = await browser.ev(() => {
      const keep = state, wasView = viewOnly, out = []
      const fill = (f, v) => {
        if (['text', 'textarea'].includes(f.type)) v[f.id] = 'QV' + f.id + 'QV'
        else if (f.type === 'number') v[f.id] = '7'
        else if (f.type === 'dims') f.parts.forEach((p, i) => { v[f.id + '_' + i] = '9' })
        else if (f.type === 'radio' && f.options?.length) v[f.id] = f.options[f.options.length > 1 ? 1 : 0]
        else if (f.type === 'checkbox' && f.options?.length) v[f.id] = [f.options[0]]
      }
      const label = f => f.label.replace(/ \(.*\)$/, '')
      const groupName = t => / \/ /.test(String(t).replace(/\([^)]*\)/g, ''))
      viewOnly = false
      for (const k of Object.keys(PRODUCTS)) {
        state = fresh()
        state.product = k
        state.pickOpen = false
        Object.assign(state.h, { doc_no: 'AUD-1', customer: 'ลูกค้า', job_name: 'งาน', admin: 'น้ำ', delivery: 'ลูกค้ามารับสินค้าเอง' })
        const v = scope('p')
        if (k === 'svc_sew') v.garment = 'เสื้อกีฬา / เสื้อองค์กรพิมพ์ลาย'
        for (let pass = 0; pass < 3; pass++) for (const sec of allSecs()) for (const f of sec.fields) if (visible(f, v) && v[f.id] === undefined) fill(f, v)
        renderDoc()
        const doc = document.querySelector('#doc'), text = doc.innerText
        const shownLabels = new Set([...doc.querySelectorAll('.cd-info .kv span')].map(s => s.textContent))
        const customerLabels = new Set(allSecs().flatMap(sec => sec.fields.filter(f => visible(f, v) && customerSees(f, sec)).map(label)))
        const problems = []
        for (const sec of allSecs()) for (const f of sec.fields) {
          if (!visible(f, v) || ['images', 'sizeTable', 'itemTable', 'placements'].includes(f.type)) continue
          const sees = customerSees(f, sec) && f.id !== TYPE_FIELD[k] && !(k === 'svc_sew' && f.id === 'garment')
          if (!sees && (text.includes('QV' + f.id + 'QV') || (shownLabels.has(label(f)) && !customerLabels.has(label(f))))) problems.push('ภายในหลุด ' + f.id)
          if (sees && valText(f, v) && !shownLabels.has(label(f)) && !text.includes('QV' + f.id + 'QV')) problems.push('ไม่แสดง ' + f.id)
        }
        const head = (doc.innerHTML.match(/<small>([^<]*)<\/small>/) || [])[1]
        if (groupName(productType(v)) || groupName(head)) problems.push('ประเภทสินค้าเป็นชื่อกลุ่ม ' + head)
        if (/undefined|NaN|\[object/.test(text)) problems.push('undefined/NaN')
        if (validate().some(m => m.hard)) problems.push('กรอกครบแล้วยังติด ' + validate().filter(m => m.hard).map(m => m.id).join(','))
        if (problems.length) out.push(k + ': ' + problems.join(', '))
      }
      viewOnly = wasView
      state = keep
      renderForm()
      return out
    })
    if (res.length) fail(`ฉบับลูกค้า ${res.length} สินค้า: ${res.slice(0, 6).join(' ; ')}`)
  })

  await check('customer-one-page', async () => {
    const res = await browser.ev(() => {
      const keep = state, wasView = viewOnly, out = {}
      const dot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      const pages = () => +(document.getElementById('pageNote')?.textContent.match(/ประมาณ (\d+) หน้า/)?.[1] ?? 0)
      viewOnly = false
      state = fresh()
      state.product = 'scarf'
      state.pickOpen = false
      Object.assign(state.h, { doc_no: 'ONE-1', customer: 'ลูกค้า', job_name: 'ผ้าเช็ดหน้า 6 ลาย', admin: 'น้ำ', delivery: 'ลูกค้ามารับสินค้าเอง' })
      Object.assign(scope('p'), { item: 'ผ้าเช็ดหน้า', fabric: 'ผ้าคอตตอน', sew_style: 'พับริมเย็บ', edge_size: '1 ซม.', pack: 'พับใส่ถุงแยกผืน',
        items: [1, 2, 3, 4, 5, 6].map(i => ({ name: 'ลาย ' + i, w: '50', h: '50', qty: '50', img: String(i) })) })
      state.imgs = [1, 2, 3, 4, 5, 6].map(i => ({ name: `ลาย${i}.png`, src: dot, w: 3000, h: 3000 }))
      state.callouts = [{ img: 0, x: 0.5, y: 0.5, bx: 1.1, by: 0.2, title: 'QAXCALLOUTQAX', body: 'QAXBODYQAX' }]
      const std = { ...scope('p'), sew_mode: SEW_STD, sew_style: undefined }
      out.sewStyleShownInStandardMode = ['sew_style', 'edge_size'].every(id => visible(allFields().find(f => f.id === id), { ...std, sew_style: id === 'edge_size' ? 'พับริมเย็บ' : undefined }))
      renderDoc()
      const doc = document.querySelector('#doc')
      const text = doc.innerText
      out.onePage = pages() === 1
      out.allImagesPlain = doc.querySelectorAll('.cd-mock figure img').length === 6 && !doc.querySelector('.d-co, .co-box, .co-stage')
      out.noCalloutText = !text.includes('QAXCALLOUTQAX') && !text.includes('QAXBODYQAX')
      out.showsSpec = ['ผ้าคอตตอน', 'พับริมเย็บ', '1 ซม.', 'พับใส่ถุงแยกผืน', '300 ผืน', 'ผ้าเช็ดหน้า'].every(s => text.includes(s))
      out.signAtBottom = !!doc.querySelector('.close .sign') && doc.querySelector('.close').compareDocumentPosition(doc.querySelector('.cd-mock')) === Node.DOCUMENT_POSITION_PRECEDING
      state.product = 'banner'
      Object.assign(scope('p'), { fabric: 'ผ้าไวนิล', edge: 'พับริมเย็บ 4 ด้าน', edge_w: '2', rail: ['ด้านบน'], rail_w: '5', eyelet: '4 มุม', pack: 'ม้วนใส่ถุง' })
      renderDoc()
      const banner = document.querySelector('#doc').innerText
      out.bannerShowsRailEyelet = ['รางสอด', 'ด้านบน', 'ตาไก่', '4 มุม', 'ม้วนใส่ถุง'].every(s => banner.includes(s))
      viewOnly = true
      state.product = 'scarf'
      renderDoc()
      out.factoryKeepsCallouts = document.querySelector('#doc').innerText.includes('QAXCALLOUTQAX') && !!document.querySelector('#doc .fd-mock .co-fig')
      viewOnly = wasView
      state = keep
      renderForm()
      return out
    })
    const bad = Object.entries(res).filter(([, ok]) => !ok).map(([k]) => k)
    if (bad.length) fail(`ฉบับลูกค้าหน้าเดียว: ${bad.join(', ')}`)
  })

  await check('service-lock-terms-banner', async () => {
    const res = await browser.ev(() => {
      const keep = state, wasView = viewOnly
      const out = {}
      state = fresh()
      state.product = 'svc_uvdtf'
      state.pickOpen = false
      Object.assign(scope('p'), { uv_unit: 'ชิ้น' })
      state.h.doc_no = 'UV-LOCK-1'
      renderForm()
      out.uvEditableWhenNew = [...document.querySelectorAll('input[name="p_uv_unit"]')].every(i => !i.disabled)
      state.job_no = 'UV-LOCK-1'
      state.job_base = jobSnapshot()
      renderForm()
      const radios = [...document.querySelectorAll('input[name="p_uv_unit"]')]
      out.uvLockedInRevision = radios.length === 2 && radios.every(i => i.disabled)
      out.lockSaysWhy = /เปลี่ยนในใบแก้ไม่ได้/.test(radios[0]?.closest('.opts')?.parentElement?.innerText ?? '')
      viewOnly = true
      renderDoc()
      out.uvHasNoCustomerGoodsTerms = !document.querySelector('#doc').innerText.includes(TERMS_SERVICE[0].slice(0, 20))
      state = fresh()
      state.product = 'svc_press'
      state.pickOpen = false
      renderDoc()
      out.pressKeepsServiceTerms = document.querySelector('#doc').innerText.includes(TERMS_SERVICE[0].slice(0, 20))
      state = fresh()
      state.product = 'banner'
      state.pickOpen = false
      Object.assign(scope('p'), { edge: 'พับริมเย็บ 4 ด้าน' })
      const ids = validate().map(m => m.id)
      out.bannerAsksWidthOnce = ids.includes('fld_p_edge_w') && !ids.includes('fld_p_edge_size')
      out.optImgIgnoresProto = optImg('constructor') === '' && optImg('toString') === '' && !!optImg('พับริมเย็บ')
      viewOnly = wasView
      state = keep
      renderForm()
      return out
    })
    const bad = Object.entries(res).filter(([, ok]) => !ok).map(([k]) => k)
    if (bad.length) fail(`ใบงานบริการ / ป้ายผ้า: ${bad.join(', ')}`)
  })

  await check('PR241-taken-doc-no', async () => {
    const dupNo = `F-TAKEN-${seed}`
    const taken = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: dupNo, p_customer_name: 'ลูกค้าเดิม', p_job_name: 'งานรับแล้ว',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: '2099-01-20',
      p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_needs_sample: false,
    })
    if (!taken.ok) fail(`รับงาน ${dupNo} ไม่ได้: ${JSON.stringify(taken.body)}`)
    const save = await client.rpc('admin1', 'save_confirmation_draft', {
      p_data: { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: dupNo }, p: {} },
    })
    if (save.ok || !/เปลี่ยน "?เลขที่ใบ/.test(String(save.body?.message))) fail(`PR241: บันทึกใบด้วยเลขของงานที่รับแล้ว ข้อความไม่บอกให้เปลี่ยนเลขที่ใบ: ${JSON.stringify(save.body)}`)
  })

  await check('PR226-infinity-date', async () => {
    const inf = await client.rpc('admin1', 'receive_job', {
      p_confirmation_no: `F-INF-${seed}`, p_customer_name: 'Inf', p_job_name: 'Inf',
      p_product_type_code: 'tshirt', p_qty: 10, p_unit: 'ตัว', p_due_date: 'infinity',
      p_route_code: 'cut_only', p_confirmation_pdf_path: null, p_needs_sample: false,
    })
    if (inf.ok) fail('PR226: รับวันที่ infinity')
  })

  if (failures.length) {
    const err = new Error(`${failures.length} ข้อ: ${failures.join(' ; ')}`)
    err.details = failures
    throw err
  }
  return { tested: [...tested.filter(t => t !== 'copies'), copies] }
}
