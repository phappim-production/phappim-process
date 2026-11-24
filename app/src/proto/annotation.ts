import type { StationCode } from './model'
import { thai, type Word } from '../i18n/word.ts'

export type ViewKey = 'front' | 'back' | 'left' | 'right' | 'detail'
export const VIEW_ORDER: ViewKey[] = ['front', 'back', 'left', 'right', 'detail']
export const VIEW_NAME: Record<ViewKey, string> = {
  front: 'ภาพหลัก', back: 'ด้านหลัง', left: 'ด้านซ้าย', right: 'ด้านขวา', detail: 'รายละเอียด',
}
export const viewImage = (v: ViewKey) => v === 'front' ? VIEW_NAME.front : `ภาพ${VIEW_NAME[v]}`

export type SheetStatus = 'draft' | 'pending' | 'approved' | 'superseded'
export const SHEET_STATUS: Record<SheetStatus, { text: string; tone: 'info' | 'warn' | 'ok' | 'neutral' }> = {
  draft: { text: 'ร่าง', tone: 'info' },
  pending: { text: 'รออนุมัติ', tone: 'warn' },
  approved: { text: 'อนุมัติแล้ว', tone: 'ok' },
  superseded: { text: 'ถูกแทนที่', tone: 'neutral' },
}

export type SpecKind = 'print' | 'embroidery' | 'sewing' | 'material' | 'label' | 'other'
export const SPEC_KIND_NAME: Record<SpecKind, string> = {
  print: 'งานพิมพ์', embroidery: 'งานปัก', sewing: 'งานเย็บ', material: 'วัสดุ', label: 'ป้าย', other: 'อื่นๆ',
}
export type Unit = 'cm' | 'mm' | 'in'
export const UNIT_NAME: Record<Unit, string> = { cm: 'ซม.', mm: 'มม.', in: 'นิ้ว' }

export type MockView = { view: ViewKey; path: string; width: number; height: number }
export type Spec = {
  key: string; code: string; name: string; kind: SpecKind; position: string; detail: string
  width: number | null; height: number | null; unit: Unit; color: string; colorCode: string
  material: string; method: string; artworkRef: string; note: string; stations: StationCode[]
}
export type Callout = {
  key: string; view: ViewKey; no: number; x: number; y: number; boxX: number; boxY: number
  title: string; body: string; specRef: string | null; specKey: string | null; stations: StationCode[]
  refValue?: string | null
}
export type Draft = { views: MockView[]; specs: Spec[]; callouts: Callout[] }
export const EMPTY_DRAFT: Draft = { views: [], specs: [], callouts: [] }

export const MAX_CALLOUTS = 60
export const MAX_SPECS = 60

export const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
const round4 = (v: number) => Math.round(v * 10_000) / 10_000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0))

// ขอบว่างรอบภาพไว้วางกล่องข้อความ ไม่ให้บังลาย · ต้องตรงกับ CO_MX / CO_MY ในฟอร์ม production-confirmation.html
export const MARGIN_X = 0.25
export const MARGIN_Y = 0.08
export const clampBox = (x: number, y: number) => ({ boxX: round4(clamp(x, -MARGIN_X, 1 + MARGIN_X)), boxY: round4(clamp(y, -MARGIN_Y, 1 + MARGIN_Y)) })
export const stageSize = (w: number, h: number) => ({ width: w * (1 + 2 * MARGIN_X), height: h * (1 + 2 * MARGIN_Y) })
export const onStage = (x: number, y: number) => ({ left: (x + MARGIN_X) / (1 + 2 * MARGIN_X), top: (y + MARGIN_Y) / (1 + 2 * MARGIN_Y) })
// กล่องข้อความเลื่อนตามตำแหน่ง: ชิดซ้ายสุด = ขอบซ้ายกล่องอยู่ที่จุด · ชิดขวาสุด = ขอบขวา (กล่องไม่ล้นพื้นที่ภาพ) · ตรงกับ coBoxPct ในฟอร์มใบยืนยัน
export function boxAnchor(x: number, y: number) {
  const s = onStage(x, y)
  const l = clamp(s.left, 0, 1) * 100, t = clamp(s.top, 0, 1) * 100
  return { left: `${l}%`, top: `${t}%`, transform: `translate(-${l}%, -${t}%)` }
}
export function fromStage(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: ((clientX - rect.left) / rect.width) * (1 + 2 * MARGIN_X) - MARGIN_X,
    y: ((clientY - rect.top) / rect.height) * (1 + 2 * MARGIN_Y) - MARGIN_Y,
  }
}

export function toNormalized(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return { x: round4(clamp01((clientX - rect.left) / rect.width)), y: round4(clamp01((clientY - rect.top) / rect.height)) }
}

export function toPixels(x: number, y: number, size: { width: number; height: number }) {
  return { left: x * size.width, top: y * size.height }
}

// กล่องข้อความวางในขอบว่างฝั่งที่ใกล้จุด ไม่บังลาย
export function defaultBox(x: number, y: number) {
  return clampBox(x < 0.5 ? -MARGIN_X / 2 : 1 + MARGIN_X / 2, y)
}

export const nextNo = (callouts: Callout[]) => callouts.reduce((n, c) => Math.max(n, c.no), 0) + 1

export function renumber(callouts: Callout[]): Callout[] {
  return [...callouts].sort((a, b) => a.no - b.no).map((c, i) => (c.no === i + 1 ? c : { ...c, no: i + 1 }))
}

export function nextSpecCode(specs: Spec[]): string {
  const used = new Set(specs.map(s => s.code))
  for (let i = 1; ; i++) {
    const code = `S-${String(i).padStart(2, '0')}`
    if (!used.has(code)) return code
  }
}

export function blankSpec(key: string, specs: Spec[], from?: Partial<Spec>): Spec {
  return {
    key, code: nextSpecCode(specs), name: '', kind: 'print', position: '', detail: '', width: null, height: null, unit: 'cm',
    color: '', colorCode: '', material: '', method: '', artworkRef: '', note: '', stations: [], ...from,
  }
}

export type Edit =
  | { type: 'add_callout'; key: string; view: ViewKey; x: number; y: number }
  | { type: 'update_callout'; key: string; patch: Partial<Omit<Callout, 'key' | 'no'>> }
  | { type: 'remove_callout'; key: string }
  | { type: 'reorder_callout'; key: string; dir: -1 | 1 }
  | { type: 'add_spec'; spec: Spec; linkTo?: string }
  | { type: 'update_spec'; key: string; patch: Partial<Omit<Spec, 'key'>> }
  | { type: 'remove_spec'; key: string }
  | { type: 'set_view'; view: MockView }
  | { type: 'remove_view'; view: ViewKey }

export function applyEdit(d: Draft, e: Edit): Draft {
  switch (e.type) {
    case 'add_callout': {
      if (d.callouts.length >= MAX_CALLOUTS) return d
      const x = round4(clamp01(e.x)), y = round4(clamp01(e.y))
      return { ...d, callouts: [...d.callouts, {
        key: e.key, view: e.view, no: nextNo(d.callouts), x, y, ...defaultBox(x, y),
        title: '', body: '', specRef: null, specKey: null, stations: [],
      }] }
    }
    case 'update_callout': {
      const patch = { ...e.patch }
      for (const k of ['x', 'y'] as const) if (patch[k] !== undefined) patch[k] = round4(clamp01(patch[k]))
      if (patch.boxX !== undefined) patch.boxX = clampBox(patch.boxX, 0).boxX
      if (patch.boxY !== undefined) patch.boxY = clampBox(0, patch.boxY).boxY
      return { ...d, callouts: d.callouts.map(c => (c.key === e.key ? { ...c, ...patch } : c)) }
    }
    case 'remove_callout':
      return { ...d, callouts: renumber(d.callouts.filter(c => c.key !== e.key)) }
    case 'reorder_callout': {
      const list = renumber(d.callouts)
      const i = list.findIndex(c => c.key === e.key)
      const j = i + e.dir
      if (i < 0 || j < 0 || j >= list.length) return d
      const a = list[i]!, b = list[j]!
      return { ...d, callouts: renumber(list.map(c => (c.key === a.key ? { ...c, no: b.no } : c.key === b.key ? { ...c, no: a.no } : c))) }
    }
    case 'add_spec': {
      if (d.specs.length >= MAX_SPECS) return d
      const callouts = e.linkTo ? d.callouts.map(c => (c.key === e.linkTo ? { ...c, specKey: e.spec.key } : c)) : d.callouts
      return { ...d, specs: [...d.specs, e.spec], callouts }
    }
    case 'update_spec':
      return { ...d, specs: d.specs.map(s => (s.key === e.key ? { ...s, ...e.patch } : s)) }
    case 'remove_spec':
      return { ...d, specs: d.specs.filter(s => s.key !== e.key), callouts: d.callouts.map(c => (c.specKey === e.key ? { ...c, specKey: null } : c)) }
    case 'set_view':
      return { ...d, views: [...d.views.filter(v => v.view !== e.view.view), e.view].sort((a, b) => VIEW_ORDER.indexOf(a.view) - VIEW_ORDER.indexOf(b.view)) }
    case 'remove_view':
      return { ...d, views: d.views.filter(v => v.view !== e.view), callouts: renumber(d.callouts.filter(c => c.view !== e.view)) }
  }
}

export type History = { past: Draft[]; present: Draft; future: Draft[]; tag?: string | undefined }
const HISTORY_LIMIT = 50

export const historyOf = (present: Draft): History => ({ past: [], present, future: [] })

// พิมพ์ต่อเนื่องในช่องเดียวกัน (tag เดียวกัน) = ย้อนกลับครั้งเดียวทั้งคำ ไม่ใช่ทีละตัวอักษร
export function historyEdit(h: History, e: Edit, tag?: string): History {
  const next = applyEdit(h.present, e)
  if (next === h.present) return h
  if (tag && tag === h.tag && !h.future.length) return { ...h, present: next }
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], tag }
}
export function undo(h: History): History {
  const prev = h.past.at(-1)
  return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h
}
export function redo(h: History): History {
  const next = h.future[0]
  return next ? { past: [...h.past, h.present], present: next, future: h.future.slice(1) } : h
}

const FIELD_LABEL: Record<string, string> = {
  fit: 'ทรง', neck: 'คอเสื้อ', neck_fabric: 'ผ้าคอ', neck_color: 'สีคอ', sleeve: 'แขน', sleeve_end: 'ปลายแขน',
  fabric: 'ชนิดผ้า', fabric_color: 'สีผ้าพื้น', gsm: 'น้ำหนักผ้า', fabric_width: 'หน้าผ้า', print_method: 'เทคนิคพิมพ์', side_seam: 'ตะเข็บข้าง',
  hem: 'ชายเสื้อ', thread: 'สีด้าย', neck_label: 'ป้ายคอ', size_label: 'ป้ายไซซ์', color_match: 'การเทียบสี',
  art_file: 'ไฟล์งาน', notes: 'หมายเหตุ', edge: 'ริม', sew_style: 'รูปแบบการเย็บ', logo_pos: 'ตำแหน่งโลโก้', print_pos: 'ตำแหน่งและขนาดโลโก้',
  bag: 'ใส่ถุง', fold: 'การพับ', box_note: 'การแพ็ค',
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')

function productPart(spec: unknown): Obj | null {
  if (!isObj(spec) || !isObj(spec.p) || typeof spec.product !== 'string') return null
  const part = spec.p[spec.product]
  return isObj(part) ? part : null
}

// ต้องให้ผลตรงกับ private.mockup_ref_value ในฐานข้อมูล (ค่าที่แช่ไว้ตอนอนุมัติ)
export function refValue(spec: unknown, ref: string | null): string | null {
  const base = productPart(spec)
  if (!base || !ref) return null
  if (ref.startsWith('placement:')) {
    const all = base.placements
    const x = isObj(all) ? all[ref.slice(10)] : undefined
    if (!isObj(x) || x.on !== true) return null
    let tech = text(x.tech)
    if (!tech && Array.isArray(base.print_method)) {
      const methods = base.print_method.map(text).filter(m => m && !m.includes('ไม่มีลาย'))
      if (methods.length === 1) tech = methods[0]!
    }
    const size = text(x.size)
    const unit = base.placements__unit === 'นิ้ว' ? 'นิ้ว' : 'ซม.'
    return [tech, size && (/^[0-9 .,xX×*/-]+$/.test(size) ? `${size} ${unit}` : size), text(x.note)].filter(Boolean).join(' · ') || null
  }
  if (ref.startsWith('field:')) {
    const v = base[ref.slice(6)]
    if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ') || null
    return text(v) || null
  }
  return null
}

export function confirmationRefs(spec: unknown): { ref: string; label: string; value: string }[] {
  const base = productPart(spec)
  if (!base) return []
  const out: { ref: string; label: string; value: string }[] = []
  if (isObj(base.placements)) {
    for (const pos of Object.keys(base.placements)) {
      const ref = `placement:${pos}`
      const value = refValue(spec, ref)
      if (value) out.push({ ref, label: `ตำแหน่ง ${pos}`, value })
    }
  }
  for (const [key, label] of Object.entries(FIELD_LABEL)) {
    const ref = `field:${key}`
    const value = refValue(spec, ref)
    if (value) out.push({ ref, label, value })
  }
  return out
}

export function refLabel(ref: string): string {
  return thai(refLabelWord(ref))
}

export function refLabelWord(ref: string): Word {
  if (ref.startsWith('placement:')) return { th: 'ตำแหน่ง {pos}', vars: { pos: { th: ref.slice(10) } } }
  if (ref.startsWith('field:')) return { th: FIELD_LABEL[ref.slice(6)] ?? ref.slice(6) }
  return { th: ref }
}

export function parseSize(input: string): number | null | undefined {
  if (!input.trim()) return null
  const n = Number(input.trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function submitProblems(d: Draft): string[] {
  const out: string[] = []
  if (!d.views.some(v => v.view === 'front')) out.push('ยังไม่มีภาพหลัก')
  const noTitle = d.callouts.filter(c => !c.title.trim()).map(c => c.no)
  if (noTitle.length) out.push(`Callout ${noTitle.join(', ')} ยังไม่มีชื่อจุด`)
  const empty = d.callouts.filter(c => !c.specRef && !c.specKey && !c.body.trim()).map(c => c.no)
  if (empty.length) out.push(`Callout ${empty.join(', ')} ยังไม่มีสเปกหรือข้อความ`)
  const unnamed = d.specs.filter(s => !s.name.trim() || !s.code.trim()).map(s => s.code || '(ไม่มีรหัส)')
  if (unnamed.length) out.push(`สเปก ${unnamed.join(', ')} ยังไม่มีชื่อ`)
  return out
}

export function saveProblems(d: Draft): string[] {
  const out: string[] = []
  const noTitle = d.callouts.filter(c => !c.title.trim()).map(c => c.no)
  if (noTitle.length) out.push(`ตั้งชื่อจุดให้ Callout ${noTitle.join(', ')} ก่อนบันทึก (เช่น คอเสื้อ อกซ้าย)`)
  const unnamed = d.specs.filter(s => !s.name.trim()).map(s => s.code)
  if (unnamed.length) out.push(`ตั้งชื่อสเปก ${unnamed.join(', ')} ก่อนบันทึก`)
  const codes = d.specs.map(s => s.code.trim())
  const dup = codes.filter((c, i) => codes.indexOf(c) !== i)
  if (dup.length) out.push(`รหัสสเปก ${[...new Set(dup)].join(', ')} ซ้ำกัน`)
  const bad = d.specs.filter(s => (s.width !== null && !(s.width > 0)) || (s.height !== null && !(s.height > 0))).map(s => s.code)
  if (bad.length) out.push(`ขนาดของสเปก ${bad.join(', ')} ต้องมากกว่า 0`)
  return out
}

export function toPayload(d: Draft) {
  return {
    views: d.views.map(v => ({ view: v.view, image_path: v.path, width: v.width, height: v.height })),
    specs: d.specs.map(s => ({
      key: s.key, code: s.code.trim(), name: s.name.trim(), kind: s.kind, position: s.position, detail: s.detail,
      width: s.width, height: s.height, unit: s.unit, color: s.color, color_code: s.colorCode, material: s.material,
      method: s.method, artwork_ref: s.artworkRef, note: s.note, stations: s.stations,
    })),
    callouts: renumber(d.callouts).map(c => ({
      view: c.view, no: c.no, x: c.x, y: c.y, box_x: c.boxX, box_y: c.boxY, title: c.title.trim(), body: c.body,
      spec_ref: c.specRef, spec_key: c.specKey, stations: c.stations,
    })),
  }
}

export function forStation(callouts: Callout[], station: StationCode | null): Callout[] {
  return station ? callouts.filter(c => c.stations.length === 0 || c.stations.includes(station)) : callouts
}

export function specOf(d: Pick<Draft, 'specs'>, c: Pick<Callout, 'specKey'>): Spec | undefined {
  return c.specKey ? d.specs.find(s => s.key === c.specKey) : undefined
}

export function specSize(s: Pick<Spec, 'width' | 'height' | 'unit'>): string {
  const u = UNIT_NAME[s.unit]
  if (s.width && s.height) return `${s.width} × ${s.height} ${u}`
  if (s.width) return `กว้าง ${s.width} ${u}`
  if (s.height) return `สูง ${s.height} ${u}`
  return ''
}

export function specLine(s: Spec): string {
  return [s.detail, specSize(s), s.color && `สี ${s.color}${s.colorCode ? ` (${s.colorCode})` : ''}`, s.material, s.method]
    .filter(Boolean).join(' · ')
}

export function calloutLines(c: Callout, d: Pick<Draft, 'specs'>, jobSpec?: unknown): string[] {
  return calloutWords(c, d, jobSpec).map(thai)
}

// ชื่อช่องแปลได้ · ค่าที่แอดมินกรอกแปลเฉพาะคำที่มีในตารางคำแปล
export function calloutWords(c: Callout, d: Pick<Draft, 'specs'>, jobSpec?: unknown): Word[] {
  const out: Word[] = []
  if (c.specRef) {
    const v = c.refValue !== undefined && c.refValue !== null ? c.refValue : refValue(jobSpec, c.specRef)
    const label = refLabelWord(c.specRef)
    out.push(v ? { th: '{label}: {value}', vars: { label, value: { th: v } } } : { th: '{label}: (ใบยืนยันไม่มีข้อมูลแล้ว)', vars: { label } })
  }
  const s = specOf(d, c)
  if (s) out.push({ th: `${s.code} ${s.name}${specLine(s) ? ` · ${specLine(s)}` : ''}` })
  if (c.body.trim()) out.push({ th: c.body.trim() })
  return out
}

// จุดที่แอดมินวางไว้ในฟอร์มใบยืนยัน (state.callouts · co_sizes / co_size) → ร่างม็อคอัพแต่ละมุมภาพ
export function confirmationDraft(spec: unknown, mockupPath: string | null): Draft | null {
  if (!isObj(spec) || !Array.isArray(spec.callouts)) return null
  const paths = Array.isArray(spec.mockups) ? spec.mockups.map(m => (isObj(m) ? text(m.path) : '')) : []
  const frontPath = mockupPath || paths[0] || ''
  if (!frontPath) return null
  paths[0] = frontPath
  const readSize = (v: unknown) => {
    if (!isObj(v)) return null
    const w = Number(v.w), h = Number(v.h)
    return w > 0 && h > 0 ? { width: w, height: h } : null
  }
  const sizeAt = (idx: number) =>
    (Array.isArray(spec.co_sizes) ? readSize(spec.co_sizes[idx]) : null) ?? readSize(spec.co_size)
  const frontSize = sizeAt(0)
  if (!frontSize) return null

  const views: MockView[] = [{ view: 'front', path: frontPath, ...frontSize }]
  const viewByImg = new Map<number, ViewKey>([[0, 'front']])
  const callouts: Callout[] = []
  for (const raw of spec.callouts.slice(0, MAX_CALLOUTS)) {
    if (!isObj(raw)) continue
    const x = Number(raw.x), y = Number(raw.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const rawImg = Number(raw.img)
    const imgIdx = Number.isInteger(rawImg) && rawImg >= 0 ? rawImg : 0
    if (!viewByImg.has(imgIdx) && imgIdx > 0 && paths[imgIdx] && views.length < VIEW_ORDER.length) {
      const vKey = VIEW_ORDER[views.length]!
      views.push({ view: vKey, path: paths[imgIdx]!, ...(sizeAt(imgIdx) ?? frontSize) })
      viewByImg.set(imgIdx, vKey)
    }
    const no = callouts.length + 1
    const ref = text(raw.ref)
    const box = clampBox(Number(raw.bx), Number(raw.by))
    callouts.push({
      key: `confirmation-${no}`, view: viewByImg.get(imgIdx) ?? 'front', no,
      x: round4(clamp01(x)), y: round4(clamp01(y)), ...box,
      title: (text(raw.title) || `จุด ${no}`).slice(0, 80), body: text(raw.body),
      specRef: /^(placement|field):.+$/.test(ref) ? ref : null, specKey: null, stations: [],
    })
  }
  if (!callouts.length) return null
  return { views, specs: [], callouts }
}
