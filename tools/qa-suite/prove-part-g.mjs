// ส่วน G: พิสูจน์ว่าระบบทดสอบจับบั๊กที่เคยแก้ไปแล้ว 8 ข้อได้จริง (รันบน worktree ชั่วคราวนอก repo แล้วลบทิ้ง)
import { spawnSync } from 'node:child_process'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const OLD_DIR = join(tmpdir(), 'pp142-old-part-g')
const OUT_JSON = join(tmpdir(), 'qa-suite', 'part-g-results.json')

const CASES = [
  { id: 'G1-PR245', label: 'ผ้าเพิ่มไม่กรอกจำนวน + หน่วย (ก่อน PR 245)', commit: '82e3363~1', only: 'confirmation', needBuild: true },
  { id: 'G2-PR244', label: 'ปกสำเร็จไม่ระบุสีปก (ก่อน PR 244)', commit: '284384c~1', only: 'confirmation', needBuild: true },
  { id: 'G3-PR241', label: 'บันทึกเลขที่ใบซ้ำกับงานที่รับแล้ว (ก่อน PR 241)', commit: '5cb0d3f~1', only: 'confirmation', needBuild: false },
  { id: 'G4-PR238', label: 'เพิ่มวัตถุดิบไม่มีวันคาดว่าได้รับ/ETA (ก่อน PR 238)', commit: '9f9b7b2~1', only: 'sim', needBuild: false },
  { id: 'G5-PR237', label: 'ส่งออกบริษัทภายนอกจากรอผลิต (ก่อน PR 237)', commit: '8e7a77e~1', only: 'sim', needBuild: false },
  { id: 'G6-PR235', label: 'ใบงานบริการ 4 แบบ + เส้นทางเฉพาะ (ก่อน PR 235)', commit: 'a5aca98~1', only: 'sim', needBuild: false },
  { id: 'G7-PR231', label: 'ขั้นรอผลิต + release_job (ก่อน PR 231)', commit: '6912bea~1', only: 'sim', needBuild: false },
  { id: 'G8-PR226', label: 'วันที่ infinity ผ่านได้ (ก่อน PR 226)', commit: 'f92f4ff~1', only: 'confirmation', needBuild: false },
]

function run(cmd, args, cwd, env = {}) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
}

const results = []
for (const c of CASES) {
  const t0 = Date.now()
  await rm(OLD_DIR, { recursive: true, force: true }).catch(() => {})
  run('git', ['worktree', 'prune'], ROOT)

  const add = run('git', ['worktree', 'add', '--detach', OLD_DIR, c.commit], ROOT)
  if (add.status !== 0) throw new Error(`worktree add failed for ${c.commit}: ${add.stderr}`)

  try {
    // เชื่อม node_modules และคัดลอก tools/qa-suite เข้า worktree ชั่วคราว
    run('cmd', ['/c', 'mklink', '/J', join(OLD_DIR, 'app', 'node_modules'), join(ROOT, 'app', 'node_modules')], ROOT)
    run('cmd', ['/c', 'mklink', '/J', join(OLD_DIR, 'supabase', 'tests', 'node_modules'), join(ROOT, 'supabase', 'tests', 'node_modules')], ROOT)
    await cp(join(ROOT, 'tools', 'qa-suite'), join(OLD_DIR, 'tools', 'qa-suite'), { recursive: true })

    if (c.needBuild) {
      const b = run('npm.cmd', ['--prefix', 'app', 'run', 'build'], OLD_DIR, {
        VITE_SUPABASE_URL: 'http://127.0.0.1:5244',
        VITE_SUPABASE_ANON_KEY: 'r14-local-anon-key',
        VITE_FILES_URL: 'http://127.0.0.1:5245',
      })
      if (b.status !== 0) throw new Error(`build failed on ${c.commit}: ${b.stderr}`)
    } else {
      run('cmd', ['/c', 'mklink', '/J', join(OLD_DIR, 'app', 'dist'), join(ROOT, 'app', 'dist')], ROOT)
    }

    const r = run('node', ['tools/qa-suite/run.mjs', '--only', c.only, '--days', '2', '--seed', '1', '--skip-build', '--out', join(tmpdir(), 'qa-suite', `part-g-${c.id}`)], OLD_DIR)
    const caught = r.status !== 0
    const ms = Date.now() - t0
    results.push({ ...c, caught, exitCode: r.status, durationMs: ms })
    console.log(`${caught ? 'CAUGHT' : 'MISSED'} [${c.id}] commit=${c.commit} part=${c.only} (${ms} ms)`)
  } finally {
    run('git', ['worktree', 'remove', '--force', OLD_DIR], ROOT)
    await rm(OLD_DIR, { recursive: true, force: true }).catch(() => {})
  }
}

await mkdir(join(tmpdir(), 'qa-suite'), { recursive: true })
await writeFile(OUT_JSON, JSON.stringify({ results }, null, 2))
const missed = results.filter(r => !r.caught).length
console.log(`PART G SUMMARY: ${results.length - missed}/${results.length} caught`)
process.exit(missed ? 1 : 0)
