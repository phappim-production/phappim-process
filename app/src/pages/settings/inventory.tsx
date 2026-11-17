import { useState } from 'react'
import { Pill, ViewSwitch } from '../../components/ui'
import { DEPT_NAME } from '../../proto/model'
import { MACHINE_STATUS_NAME } from '../../proto/sewing'
import {
  removeMachine, removeMaterial, retireMachine, saveMachine, saveMaterial, saveNeed, type Loaded,
} from './data'
import { Collection, SelectField, TextField, type Controls } from './editor'
import { integer, readMachineCode, requireText, type MachineDraft, type MaterialDraft } from './model'

type TabProps<T extends 'materials' | 'machines'> = { data: Loaded<T>; controls: Controls }

export function MaterialsTab({ data, controls }: TabProps<'materials'>) {
  const productNames = new Map(data.products.map(product => [product.code, product.name]))
  const routeNames = new Map(data.routes.map(route => [route.code, route.name]))
  const products = data.products.map(product => [product.code, product.name] as const)
  const routes = data.routes.map(route => [route.code, route.name] as const)
  const depts = [['admin', DEPT_NAME.admin], ['qc', DEPT_NAME.qc], ['production', DEPT_NAME.production]] as const

  return (
    <Collection controls={controls} group="materials" title="แม่แบบวัตถุดิบ"
      subtitle="เงื่อนไขที่ระบบใช้เลือกเช็กลิสต์วัตถุดิบเมื่อรับงานใหม่"
      list={data.materials} identify={item => String(item.id)} createLabel="เพิ่มแม่แบบวัตถุดิบ"
      row={item => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{item.name}</span>
            {item.key !== null && <Pill tone="neutral">ระบบติ๊กให้อัตโนมัติ</Pill>}
          </div>
          <p className="mt-1 text-muted">
            {DEPT_NAME[item.dept]} · {item.product_type_code ? productNames.get(item.product_type_code) ?? item.product_type_code : 'ทุกสินค้า'}
            {' · '}{item.route_code ? routeNames.get(item.route_code) ?? item.route_code : 'ทุกเส้นทาง'} · ลำดับ {item.sort}
          </p>
        </>
      )}
      draft={(item): MaterialDraft => ({
        name: item?.name ?? '', dept: item?.dept ?? 'admin', product: item?.product_type_code ?? '',
        route: item?.route_code ?? '', sort: String(item?.sort ?? 0),
      })}
      fields={(draft, change, item) => (
        <>
          <TextField label="ชื่อแม่แบบวัตถุดิบ" value={draft.name} onChange={name => change({ ...draft, name })} />
          {item && item.key !== null ? <p className="text-muted">แม่แบบนี้ระบบใช้ติ๊กให้อัตโนมัติ แก้ได้เฉพาะชื่อ</p> : (
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="ฝ่ายที่ตรวจ" options={depts} value={draft.dept} onChange={dept => change({ ...draft, dept })} />
              <TextField label="ลำดับ" mode="numeric" value={draft.sort} onChange={sort => change({ ...draft, sort })} />
              <SelectField label="ใช้กับสินค้า" value={draft.product} options={[[ '', 'ทุกสินค้า' ], ...products]}
                onChange={product => change({ ...draft, product })} />
              <SelectField label="ใช้กับเส้นทาง" value={draft.route} options={[[ '', 'ทุกเส้นทาง' ], ...routes]}
                onChange={route => change({ ...draft, route })} />
            </div>
          )}
        </>
      )}
      save={async (item, draft) => {
        const name = requireText(draft.name, 'ชื่อแม่แบบวัตถุดิบ')
        if (item && item.key !== null) {
          await saveMaterial(item, { ...item, name })
          return
        }
        await saveMaterial(item, {
          name, dept: draft.dept, product_type_code: draft.product || null, route_code: draft.route || null,
          sort: integer(draft.sort, 'ลำดับ', 0),
        })
      }}
      action={item => item.key !== null ? undefined : {
        label: 'ลบ', detail: `ลบแม่แบบ “${item.name}” ออกจากรายการสำหรับงานใหม่หรือไม่`, run: removeMaterial, done: 'ลบแม่แบบแล้ว',
      }} />
  )
}

const machineViews = [['list', 'รายการจักร'], ['needs', 'จำนวนจักรตามสินค้า']] as const

export function MachinesTab({ data, controls }: TabProps<'machines'>) {
  const [view, setView] = useState<typeof machineViews[number][0]>('list')
  return (
    <>
      <div className={`min-w-0 ${controls.busy ? 'opacity-60' : ''}`} inert={controls.busy}>
        <ViewSwitch label="ข้อมูลจักรเย็บ" options={machineViews} value={view} variant="sub" onChange={next => {
          if (next === view) return
          controls.confirmDiscard(() => {
            controls.close()
            setView(next)
          })
        }} />
      </div>
      {view === 'list' ? <MachineList data={data} controls={controls} /> : <ProductNeeds data={data} controls={controls} />}
    </>
  )
}

function MachineList({ data, controls }: TabProps<'machines'>) {
  const types = new Map(data.types.map(type => [type.code, type]))
  const options = data.types.map(type => [type.code, type.name] as const)

  return (
    <Collection controls={controls} group="machines" title="จักรเย็บ"
      subtitle="จัดการรหัสและชนิดจักร แจ้งเสียหรือซ่อมเสร็จได้ที่หน้าหน้างาน"
      list={data.machines} identify={machine => String(machine.id)} createLabel={data.types.length ? 'เพิ่มจักร' : undefined}
      row={machine => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{machine.code} · {types.get(machine.type_code)?.name ?? machine.type_code}</span>
            <Pill tone={machine.status === 'broken' ? 'danger' : 'neutral'}>{MACHINE_STATUS_NAME[machine.status]}</Pill>
          </div>
          {machine.hasHistory && <p className="mt-1 text-muted">มีประวัติการใช้งาน</p>}
        </>
      )}
      draft={(machine): MachineDraft => ({ code: machine?.code ?? '', type: machine?.type_code ?? data.types[0]?.code ?? '' })}
      fields={(draft, change) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="ชนิดจักร" options={options} value={draft.type} onChange={type => change({ ...draft, type })} />
          <TextField label="รหัสจักร" value={draft.code} onChange={code => change({ ...draft, code: code.toUpperCase() })}
            placeholder={types.has(draft.type) ? `เช่น ${types.get(draft.type)?.prefix}-001` : undefined} />
        </div>
      )}
      save={async (machine, draft) => {
        const type = types.get(draft.type)
        if (!type) throw new Error('กรุณาเลือกชนิดจักร')
        const used = new Set(data.machines.filter(item => item.id !== machine?.id).map(item => item.code))
        const code = readMachineCode(draft.code, type.prefix, used)
        await saveMachine(machine?.id ?? null, { code, type_code: type.code })
      }}
      action={machine => {
        if (!machine.hasHistory) {
          return { label: 'ลบ', detail: `ลบจักร ${machine.code} ออกจากรายการหรือไม่`, run: removeMachine, done: 'ลบจักรแล้ว' }
        }
        return machine.status === 'off' ? undefined : {
          label: 'ปิดใช้งาน', detail: `ปิดใช้งานจักร ${machine.code} หรือไม่ หากจักรกำลังเย็บ ระบบจะพักงานนั้น`,
          run: retireMachine, done: 'ปิดใช้งานจักรแล้ว',
        }
      }} />
  )
}

function ProductNeeds({ data, controls }: TabProps<'machines'>) {
  const [selection, setSelection] = useState(data.products[0]?.code ?? '')
  const product = data.products.find(item => item.code === selection)
  const options = data.products.map(item => [item.code, item.name] as const)
  const needQty = new Map(data.needs.filter(need => need.product_type_code === selection).map(need => [need.type_code, need.qty]))
  const rows = product ? data.types.map(type => ({ ...type, qty: needQty.get(type.code) ?? 0 })) : []

  return (
    <>
      {options.length > 0 && <SelectField label="เลือกสินค้า" value={selection} options={options}
        disabled={controls.busy} onChange={next => controls.confirmDiscard(() => {
          controls.close()
          setSelection(next)
        })} />}
      <Collection controls={controls} group="needs" title={product?.name ?? 'จำนวนจักรตามสินค้า'}
        subtitle="กำหนดจำนวนจักรแต่ละชนิดที่งานสินค้านี้ต้องใช้ ใส่ 0 เมื่อไม่ต้องใช้ชนิดนั้น"
        list={rows} identify={type => type.code}
        row={type => <p><strong>{type.name}</strong> · {type.qty ? `${type.qty} ตัว` : 'ไม่ใช้'}</p>}
        draft={type => ({ qty: String(type?.qty ?? 0) })}
        fields={(draft, change, type) => (
          <TextField label={`จำนวนจักร${type?.name ?? ''} (ตัว)`} value={draft.qty} mode="numeric"
            onChange={qty => change({ qty })} />
        )}
        save={async (type, draft) => {
          if (!type || !product) throw new Error('กรุณาเลือกชนิดจักรและสินค้า')
          await saveNeed({ product_type_code: product.code, type_code: type.code, qty: integer(draft.qty, 'จำนวนจักร', 0) })
        }} />
    </>
  )
}
