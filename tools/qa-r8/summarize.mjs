import { readFile } from 'node:fs/promises'

const [currentPath, baselinePath, browserPath] = process.argv.slice(2)
if (!currentPath || !baselinePath) throw new Error('ใช้ node summarize.mjs <r8-db.log> <r6-db.log> [r8-browser.log]')

async function extract(path, prefix) {
  const file = await readFile(path, 'utf8')
  return file.split(/\r?\n/).filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)))
}

const [current] = await extract(currentPath, 'R8_MATRIX ')
const [baseline] = await extract(baselinePath, 'R5_MATRIX ')
const keyOf = ({ state, name, role }) => [state, name, role].join('/')
const previous = new Map(baseline.map(cell => [keyOf(cell), cell]))
const common = current.filter(c => previous.has(keyOf(c)))
const changes = common.flatMap(c => {
  const before = previous.get(keyOf(c))
  return c.allowed === before.allowed ? [] : [{ state: c.state, name: c.name, role: c.role,
    before: before.allowed, after: c.allowed, code: c.code, message: c.message }]
})
const rejected = current.filter(c => !c.allowed)
const errorsWithoutThai = rejected.filter(c => !/[ก-๙]/.test(c.message ?? ''))
const countsBy = (rows, key) => Object.fromEntries(
  [...Map.groupBy(rows, key)].map(([value, cells]) => [value, cells.length]),
)
console.log(JSON.stringify({
  cells: current.length, states: countsBy(current, c => c.state),
  functions: new Set(current.map(c => c.name)).size, allowed: current.length - rejected.length,
  rejected: rejected.length, overlaps: common.length, freshCells: current.length - common.length,
  changes, errorsWithoutThai: countsBy(errorsWithoutThai, c => c.role + ' ' + c.code),
  rejectedMessages: countsBy(rejected, c => c.message),
}, null, 2))
if (browserPath) {
  const results = await extract(browserPath, 'R8_BROWSER ')
  console.log(JSON.stringify({
    browser: { count: results.length, failed: results.filter(r => !r.pass),
      warnings: results.filter(r => r.console?.length).map(r => ({ label: r.label, console: r.console })) },
  }, null, 2))
}
