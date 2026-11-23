import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

export async function roleMatrix({ check, rows, rpc, point, receive, intake, walk, roster, vendor, dates, reason }) {
  const routes = await readFile(new URL('../../docs/api-workflow.md', import.meta.url), 'utf8')
  const documented = routes.slice(0, routes.indexOf('| \x60job_live\x60 (view)')).split(/\r?\n/)
    .filter(line => line.startsWith('| \x60'))
    .flatMap(line => [...line.split('|')[1].matchAll(/\x60([a-z_]+)\x60/g)].map(match => match[1]))
  const admin = ['owner', 'admin']
  const production = ['owner', 'production', 'production2']
  const plant = [...production, 'phase1', 'multi']
  const qc = [...production, 'phase2', 'qc', 'staffQc']
  const plan = [...production, 'manager', 'phase1']
  const floor = [...production, 'phase2']
  const all = Object.keys(roster).filter(actor => actor !== 'disabled')
  const result = []
  await check('A2 ตารางสิทธิ์คำสั่งตามเอกสาร', async () => {
    const queued = await receive('MATRIX-QUEUED', 'plain')
    const later = await receive('MATRIX-NEXT', 'plain')
    const doing = await receive('MATRIX-DOING', 'plain')
    await rpc('production', 'start_station', [doing])
    const hold = await receive('MATRIX-HOLD', 'cut_only')
    await rpc('admin', 'open_issue', [hold, reason])
    const out = await receive('MATRIX-OUT', 'plain')
    const outRun = await rpc('admin', 'send_out', [out, vendor, 'cut', ...dates])
    const nextVendor = await rpc('admin', 'add_vendor', ['บริษัทเย็บจำลอง C15', ['sew']])
    const film = await receive('MATRIX-FILM', 'dtf')
    const filmOrdered = await receive('MATRIX-FILM-ORDERED', 'dtf')
    await rpc('admin', 'order_film', [filmOrdered, '2099-01-06'])
    const sample = await receive('MATRIX-SAMPLE', 'cut_only', true)
    await walk(sample, ['cut', 'qc_pack'], 'sample')
    const sew = await receive('MATRIX-SEW', 'plain')
    await rpc('production', 'start_station', [sew])
    await rpc('production', 'finish_station', [sew, 'cut'])
    const sewDoing = await receive('MATRIX-SEW-DOING', 'plain')
    await rpc('production', 'start_station', [sewDoing])
    await rpc('production', 'finish_station', [sewDoing, 'cut'])
    const sewingMachines = await rpc('production', 'start_sewing', [sewDoing])
    const holding = await receive('MATRIX-SEW-HOLD', 'plain')
    await rpc('production', 'start_station', [holding])
    await rpc('production', 'finish_station', [holding, 'cut'])
    await rpc('production', 'start_sewing', [holding])
    await rpc('production', 'report_sewing_issue', [holding, reason, true])
    const [extra] = await rows("insert into public.sewing_machines(code,type_code) select prefix||'-914',code from public.machine_types where code='single' returning code")
    const [broken] = await rows("insert into public.sewing_machines(code,type_code) select prefix||'-915',code from public.machine_types where code='single' returning code")
    const qcDoing = await receive('MATRIX-QC', 'cut_only')
    await rpc('production', 'start_station', [qcDoing])
    await rpc('production', 'finish_station', [qcDoing, 'cut'])
    await rpc('staffQc', 'start_station', [qcDoing])
    const done = await receive('MATRIX-DONE', 'cut_only')
    await walk(done, ['cut', 'qc_pack'], 'production')
    const delivered = await receive('MATRIX-DELIVERED', 'cut_only')
    await walk(delivered, ['cut', 'qc_pack'], 'production')
    await rpc('admin', 'mark_delivered', [delivered, reason])
    const data = { app: 'phappim-confirm', v: 1, product: 'tshirt', h: { doc_no: 'TEST-R13-MATRIX-DRAFT' } }
    const draft = await rpc('admin', 'save_confirmation_draft', [data])
    const path = 'TEST-R13-MATRIX-QUEUED/cafe.pdf'
    await rows("insert into private.file_objects (kind,path,size,content_type) values ('confirmations',$1,40,'application/pdf')", [path])
    await rows("insert into private.file_settings(record_secret) values(repeat('r',32)) on conflict do nothing")
    const [event] = await rows('select id from public.events where job_id=$1 order by id limit 1', [queued])
    const [code] = await rows('select code from public.reason_codes where active order by code limit 1')
    const [window] = await rows("select (date_trunc('week',now() at time zone 'Asia/Bangkok') + interval '7 days 9 hours') at time zone 'Asia/Bangkok' starts," +
      "(date_trunc('week',now() at time zone 'Asia/Bangkok') + interval '7 days 10 hours') at time zone 'Asia/Bangkok' ends")
    await rpc('production', 'set_machine_status', [broken.code, 'broken', reason, window.ends])
    await rpc('production', 'book_machines', [sewDoing, window.starts, window.ends])
    const baseStep = (await rows("select value->>'key' key from public.stations s, jsonb_array_elements(s.substeps) where s.code='cut' and value->>'kind'='num' limit 1"))[0].key
    const rowsToTest = {
      save_confirmation_draft: [admin, [data]],
      cancel_confirmation_draft: [admin, [draft]],
      receive_job: [admin, intake('MATRIX-NEW', 'outside', false)],
      attach_confirmation_pdf: [admin, [queued, path]],
      revise_job_spec: [admin, [queued, { product: 'tshirt', h: { doc_no: 'TEST-R13-MATRIX-QUEUED' }, p: {} }, 1, 'ลูกค้าจำลอง', 'งานจำลอง', 10, 0, '2099-01-06', false, ['ทดสอบ']]],
      move_job_ahead: [plan, [later, queued, reason]],
      start_in_queue: [plant, [queued, null]],
      note_queue_skip: [plant, [later, reason]],
      add_vendor: [admin, ['บริษัททดสอบสิทธิ์ C15', ['outside']]],
      send_out: [admin, [queued, vendor, 'cut', ...dates]],
      forward_out: [admin, [outRun, nextVendor, 'sew', ...dates]],
      receive_back: [admin, [outRun]],
      update_out_plan: [admin, [outRun, ...dates]],
      split_job: [admin, [queued, 2]],
      cancel_job: [['owner', 'manager'], [queued, reason]],
      mark_delivered: [admin, [done, reason]],
      undo_delivery: [admin, [delivered, reason]],
      start_station: [plant, [queued]],
      finish_station: [plant, [doing, 'cut']],
      open_issue: [[...plant, 'admin', 'qc'], [queued, reason]],
      close_issue: [[...production, 'phase1', 'manager'], [hold]],
      job_sla_flags: [all, []],
      submit_delay_report: [[...plant, 'admin', 'qc'], [doing, [code.code], reason, '2099-01-03T03:00:00Z']],
      correct_event: [[...production, 'phase1', 'phase2'], [queued, event.id, reason]],
      complete_substep: [plant, [doing, baseStep, '1']],
      record_sample_result: [admin, [sample, true]],
      order_film: [admin, [film, '2099-01-06']],
      receive_film: [admin, [filmOrdered]],
      start_sewing: [[...production, 'phase2'], [sew]],
      finish_sewing: [[...production, 'phase2'], [sewDoing]],
      report_sewing_issue: [[...production, 'phase2'], [sewDoing, reason, false]],
      resume_sewing: [floor, [holding]],
      book_machines: [production, [sew, window.starts, window.ends]],
      cancel_booking: [production, [sewDoing]],
      assign_machines: [floor, [sewDoing, [extra.code]]],
      release_machines: [floor, [sewDoing, [extra.code]]],
      set_machine_status: [[...production, 'phase2'], [sewingMachines[0], 'broken', reason, window.ends]],
      set_repair_eta: [production, [broken.code, window.ends, reason]],
      record_qc: [qc, [qcDoing, 1]],
      send_rework: [qc, [qcDoing, 1, reason, 'cut']],
    }
    const probes = [...Object.keys(roster), 'anon']
    const discrepancies = []
    for (const [name, [expected, args]] of Object.entries(rowsToTest)) {
      const cells = {}
      for (const actor of probes) {
        const state = await point('r13_matrix', async () => {
          try {
            if (name === 'release_machines') await rpc('owner', 'assign_machines', [sewDoing, [extra.code]])
            const input = name === 'set_machine_status' && actor === 'phase2' ? [...args.slice(0, 3), null] : args
            await rpc(actor, name, input)
            return '✓'
          } catch (error) {
            if (['40001', '40P01'].includes(error.code)) return error.code
            if (error.code === '42501') return '–'
            if (!/[\u0e00-\u0e7f]/.test(error.message)) return error.code ?? 'ไม่ทราบ'
            return 'สถานะ'
          }
        }, true)
        cells[actor] = state
        if ((state === '✓' && !expected.includes(actor)) || ['40001', '40P01'].includes(state)) {
          discrepancies.push({ name, actor, state })
        }
      }
      result.push({ name, expected, cells })
    }
    console.log('R13_MATRIX ' + JSON.stringify({ probes, result, discrepancies }))
    assert.equal(result.length, 40)
    assert.equal(discrepancies.filter(item => ['anon', 'disabled'].includes(item.actor)).length, 0)
    assert.deepEqual(documented.sort(), Object.keys(rowsToTest).sort())
    return result.length + ' RPC × ' + probes.length + ' บัญชี'
  })
}
