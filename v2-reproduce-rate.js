/**
 * V2 Quality Suite — Reproducibility Check
 * Runs aicoach-v2-quality.suite.spec.js N times and prints per-scenario pass rates.
 *
 * Usage:
 *   node v2-reproduce-rate.js [runs=5]
 */

require('dotenv').config()

const { execSync } = require('child_process')
const fs            = require('fs')
const path          = require('path')

const RUNS      = parseInt(process.argv[2] || '5', 10)
const RESULTS   = path.resolve(__dirname, 'test-results-aicoach-v2-quality.json')
const ARCHIVE   = path.resolve(__dirname, 'v2-reproduce-archive')

fs.mkdirSync(ARCHIVE, { recursive: true })

const archive = []   // [ { run, timestamp, scenarios: [{name, state}] } ]

for (let i = 1; i <= RUNS; i++) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`RUN ${i} / ${RUNS}`)
  console.log('='.repeat(60))

  try {
    execSync(
      'npx mocha test/convo/aicoach-v2-quality.suite.spec.js --timeout 120000',
      { stdio: 'inherit', cwd: __dirname }
    )
  } catch (_) {
    // mocha exits non-zero when tests fail — that's expected
  }

  if (!fs.existsSync(RESULTS)) {
    console.error(`[error] Results file not found after run ${i}`)
    continue
  }

  const data = JSON.parse(fs.readFileSync(RESULTS, 'utf8'))
  const copy = path.join(ARCHIVE, `run-${String(i).padStart(2, '0')}.json`)
  fs.copyFileSync(RESULTS, copy)

  archive.push({
    run:       i,
    timestamp: data.timestamp,
    scenarios: data.scenarios.map(s => ({
      name:  s.name.split('[')[0].trim(),
      state: s.state
    }))
  })

  const passed = data.summary.passed
  const total  = data.summary.total
  console.log(`\n[run ${i}] ${passed}/${total} passed`)
}

// ── Aggregate ───────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`REPRODUCIBILITY REPORT  (${RUNS} runs)`)
console.log('='.repeat(60))

if (archive.length === 0) {
  console.log('No results collected.')
  process.exit(1)
}

// collect all scenario names (preserve order from first run)
const names = archive[0].scenarios.map(s => s.name)

const counts = {}
for (const name of names) counts[name] = { passed: 0, failed: 0 }

for (const run of archive) {
  for (const s of run.scenarios) {
    if (!counts[s.name]) counts[s.name] = { passed: 0, failed: 0 }
    counts[s.name][s.state === 'passed' ? 'passed' : 'failed']++
  }
}

const colW = 52
console.log(`\n${'Scenario'.padEnd(colW)} Pass   Fail   Rate`)
console.log('-'.repeat(colW + 22))

const N = archive.length
for (const name of names) {
  const { passed, failed } = counts[name]
  const rate  = ((passed / N) * 100).toFixed(0).padStart(3)
  const label = passed === N ? '✓ always' : failed === N ? '✗ never ' : `~ flaky `
  console.log(`${name.padEnd(colW)} ${String(passed).padStart(3)}/${N}  ${String(failed).padStart(3)}/${N}  ${rate}%  ${label}`)
}

const totalPassed = archive.reduce((s, r) => s + r.scenarios.filter(x => x.state === 'passed').length, 0)
const totalTests  = N * names.length
console.log('-'.repeat(colW + 22))
console.log(`${'TOTAL'.padEnd(colW)} ${totalPassed}/${totalTests}  (${((totalPassed / totalTests) * 100).toFixed(1)}% overall pass rate)`)

// save summary JSON
const summary = {
  runs:       N,
  timestamps: archive.map(r => r.timestamp),
  scenarios:  names.map(name => ({
    name,
    passed:      counts[name].passed,
    failed:      counts[name].failed,
    pass_rate:   `${((counts[name].passed / N) * 100).toFixed(0)}%`,
    verdict:     counts[name].passed === N ? 'always' : counts[name].failed === N ? 'never' : 'flaky'
  }))
}
const summaryFile = path.resolve(__dirname, 'v2-reproduce-summary.json')
fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8')
console.log(`\n[saved] ${summaryFile}`)
console.log(`[saved] per-run archives in ${ARCHIVE}/`)
