#!/usr/bin/env node
// พิสูจน์ว่าชุดทดสอบจับบั๊กได้จริง: ต้องล้มด้วยข้อตรวจที่ตรงกับบั๊ก (ล้มเพราะเหตุอื่นไม่นับ)
// 1) ใส่บั๊กลงฐานจำลองทีละตัว (checks/mutations.mjs) 2) รันบนโค้ดก่อนแก้บั๊กจริง (worktree ชั่วคราว ลบทิ้งหลังรัน)
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUTATIONS } from './checks/mutations.mjs'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const OUT = join(tmpdir(), 'qa-suite', 'prove')
const OLD_DIR = join(tmpdir(), 'pp142-qa-prove-old')
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

const OLD_COMMITS = [
  { id: 'old-PR245', label: 'ผ้าเพิ่มไม่ต้องกรอกจำนวน + หน่วย', commit: '82e3363~1', part: 'confirmation', build: true, expect: /PR245/ },
  { id: 'old-PR244', label: 'ปกสำเร็จไม่ต้องระบุสีปก', commit: '284384c~1', part: 'confirmation', build: true, expect: /PR244/ },
  { id: 'old-PR241', label: 'บันทึกใบด้วยเลขของงานที่รับแล้ว ข้อความไม่บอกให้เปลี่ยนเลข', commit: '5cb0d3f~1', part: 'confirmation', build: false, expect: /PR241/ },
  { id: 'old-PR226', label: 'รับวันที่ infinity', commit: 'f92f4ff~1', part: 'confirmation', build: false, expect: /PR226/ },
]

const run = (cmd, args, cwd, env = {}) => spawnSync(cmd, args, {
  cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, ...env }, maxBuffer: 64 << 20,
})

async function failureText(outDir, part) {
  try {
    const rep = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'))
    const p = rep.parts.find(x => x.id === part)
    if (!p || p.status !== 'FAIL') return null
    return [p.error, ...(p.details ?? [])].join('\n')
  } catch { return null }
}

const results = []
const record = (id, label, expect, text, ms) => {
  const caught = text != null && expect.test(text)
  results.push({ id, label, caught, failedWith: text?.slice(0, 300) ?? 'ไม่ล้ม', durationMs: ms })
  console.log(`${caught ? 'จับได้' : 'จับไม่ได้'} [${id}] ${label}${caught ? '' : ` · ${text?.slice(0, 200) ?? 'ไม่ล้ม'}`}`)
}

for (const [id, m] of Object.entries(MUTATIONS)) {
  if (only && only !== id) continue
  const t0 = Date.now()
  const outDir = join(OUT, id)
  const args = ['tools/qa-suite/run.mjs', '--quick', '--skip-build', '--only', m.part, '--mutate', id, '--out', outDir]
  if (m.days) args.push('--days', String(m.days))
  run('node', args, ROOT)
  record(id, m.label, m.expect, await failureText(outDir, m.part), Date.now() - t0)
}

for (const c of OLD_COMMITS) {
  if (only && only !== c.id) continue
  const t0 = Date.now()
  await rm(OLD_DIR, { recursive: true, force: true })
  run('git', ['worktree', 'prune'], ROOT)
  const add = run('git', ['worktree', 'add', '--detach', OLD_DIR, c.commit], ROOT)
  if (add.status !== 0) throw new Error(`worktree add ${c.commit}: ${add.stderr}`)
  try {
    const link = (rel) => run('cmd', ['/c', 'mklink', '/J', join(OLD_DIR, rel), join(ROOT, rel)], ROOT)
    link('app/node_modules')
    link('supabase/tests/node_modules')
    await rm(join(OLD_DIR, 'tools', 'qa-suite'), { recursive: true, force: true })
    await cp(join(ROOT, 'tools', 'qa-suite'), join(OLD_DIR, 'tools', 'qa-suite'), { recursive: true })
    if (c.build) {
      const b = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', 'app', 'run', 'build'], OLD_DIR, {
        VITE_SUPABASE_URL: 'http://127.0.0.1:5244', VITE_SUPABASE_ANON_KEY: 'r14-local-anon-key', VITE_FILES_URL: 'http://127.0.0.1:5245',
      })
      if (b.status !== 0) throw new Error(`build ${c.commit}: ${b.stderr.slice(-500)}`)
    } else {
      link('app/dist')
    }
    const outDir = join(OUT, c.id)
    run('node', ['tools/qa-suite/run.mjs', '--quick', '--skip-build', '--only', c.part, '--out', outDir], OLD_DIR)
    record(c.id, c.label, c.expect, await failureText(outDir, c.part), Date.now() - t0)
  } finally {
    run('git', ['worktree', 'remove', '--force', OLD_DIR], ROOT)
    await rm(OLD_DIR, { recursive: true, force: true })
  }
}

await mkdir(OUT, { recursive: true })
await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
const missed = results.filter(r => !r.caught)
console.log(`สรุป: จับได้ ${results.length - missed.length}/${results.length} · ${join(OUT, 'results.json')}`)
process.exit(missed.length ? 1 : 0)
