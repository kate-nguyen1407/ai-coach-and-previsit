/**
 * Elfie Stress Test — burst + arrival rate modes
 *
 * BURST mode (default):
 *   Launches all sessions simultaneously in waves. Finds absolute concurrency ceiling.
 *   Usage: node stress-test.js [scenario] [env] burst [maxConcurrency]
 *   Example: node stress-test.js 09_closing staging burst 100
 *
 * ARRIVAL mode:
 *   Launches N new sessions per second for D seconds, sessions overlap naturally.
 *   Simulates real users arriving at a clinic over time.
 *   Usage: node stress-test.js [scenario] [env] arrival [rate/sec] [duration_sec] [think_time_sec]
 *   Example: node stress-test.js 09_closing staging arrival 5 60 10
 *            (5 new sessions/sec for 60s, 10s think time between turns)
 */
const https = require('https')
const fs    = require('fs')
const path  = require('path')

const SCENARIO = process.argv[2] || '09_closing'
const ENV      = (process.argv[3] || 'staging').toLowerCase()
const MODE     = (process.argv[4] || 'burst').toLowerCase()

const ENVS = {
  staging: { host: 'care.stg.elfie.co', slug: 'kate-practice-2f3h' },
  prod:    { host: 'care.elfie.co',      slug: 'trang-elfie-n5h8'  }
}
const { host: API_HOST, slug: API_SLUG } = ENVS[ENV] || ENVS.staging

// burst params
const MAX_CONCURRENCY  = parseInt(process.argv[5] || '100', 10)
const RAMP_STEPS       = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200].filter(n => n <= MAX_CONCURRENCY)
const WAVE_COOLDOWN_MS = 3000

// arrival params
const ARRIVAL_RATE     = parseInt(process.argv[5] || '5',  10)  // new sessions per second
const ARRIVAL_DURATION = parseInt(process.argv[6] || '60', 10)  // seconds to keep launching
const THINK_TIME_SEC   = parseFloat(process.argv[7] || '10')    // seconds between turns

const CONVO_FILE    = path.join(__dirname, 'test/convo/elfie/en', `${SCENARIO}.convo.txt`)
const API_TIMEOUT   = 90000
const RESULTS_FILE  = `stress-test-results-${ENV}-${MODE}.json`

// ─── Convo parser ──────────────────────────────────────────────────────────────

function parseConvo(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n')
  const turns = []
  let type = null, buf = []
  function flush() {
    const c = buf.join('\n').trim()
    if (type && c) turns.push({ type, content: c })
  }
  for (const line of lines) {
    if (line.trim() === '#bot')      { flush(); type = 'bot'; buf = [] }
    else if (line.trim() === '#me')  { flush(); type = 'me';  buf = [] }
    else if (type) buf.push(line)
  }
  flush()
  return turns
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

function apiPost(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const t0 = Date.now()
    const req = https.request({
      hostname: API_HOST, path: apiPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': '',
                 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        let parsed
        try { parsed = JSON.parse(data) } catch { parsed = { raw: data } }
        resolve({ status: res.statusCode, body: parsed, elapsed: Date.now() - t0 })
      })
    })
    req.on('error', reject)
    req.setTimeout(API_TIMEOUT, () => req.destroy(new Error('timeout')))
    req.write(payload)
    req.end()
  })
}

async function createSession() {
  const r = await apiPost('/api/v1/ai-chat/create-session', {
    userId: `stress-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    languageCode: 'en',
    config: { patient_info: { name: 'Test User' }, use_case: 'pre-visit',
              domains: [], doctorLanguageCode: 'en', clinicName: '', slug: API_SLUG }
  })
  if (!r.body.sessionId) throw new Error(`create-session failed: ${JSON.stringify(r.body)}`)
  return { sessionId: r.body.sessionId, elapsed: r.elapsed }
}

async function chat(sessionId, message) {
  const r = await apiPost('/api/v1/ai-chat/chat', {
    sessionId, message, languageCode: 'en', userId: `stress-${sessionId}`
  })
  return { response: (r.body.message || '').trim(), elapsed: r.elapsed, status: r.status }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Stats ─────────────────────────────────────────────────────────────────────

function percentile(arr, p) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)]
}

function stats(arr) {
  if (!arr.length) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 }
  return {
    avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    p50: percentile(arr, 50),
    p95: percentile(arr, 95),
    p99: percentile(arr, 99),
    max: Math.max(...arr),
    min: Math.min(...arr)
  }
}

// ─── Session runner (shared) ───────────────────────────────────────────────────

async function runSession(turns, sessionIndex, thinkMs = 0) {
  const sessionStart = Date.now()
  const turnTimes = []
  let errors = 0

  try {
    const { sessionId, elapsed: createMs } = await createSession()
    turnTimes.push(createMs)

    const init = await chat(sessionId, 'start conversation')
    turnTimes.push(init.elapsed)

    for (const t of turns) {
      if (t.type !== 'me') continue
      if (thinkMs > 0) await sleep(thinkMs)
      try {
        const r = await chat(sessionId, t.content)
        turnTimes.push(r.elapsed)
      } catch (e) {
        errors++
        turnTimes.push(0)
      }
    }

    return { sessionIndex, success: errors === 0, totalMs: Date.now() - sessionStart, turnTimes, turnErrors: errors }
  } catch (e) {
    return { sessionIndex, success: false, totalMs: Date.now() - sessionStart, turnTimes, turnErrors: errors + 1, error: e.message }
  }
}

// ─── BURST mode ────────────────────────────────────────────────────────────────

async function runWave(concurrency, turns) {
  const waveStart = Date.now()
  const results   = await Promise.all(Array.from({ length: concurrency }, (_, i) => runSession(turns, i)))
  const waveMs    = Date.now() - waveStart

  const successes    = results.filter(r => r.success)
  const allTurnTimes = results.flatMap(r => r.turnTimes.filter(t => t > 0))
  const errorSamples = results.filter(r => !r.success).map(r => r.error).filter(Boolean).slice(0, 3)

  return {
    concurrency,
    successCount: successes.length,
    failCount:    concurrency - successes.length,
    successRate:  Math.round(100 * successes.length / concurrency),
    waveMs,
    turn:         stats(allTurnTimes),
    session:      stats(results.map(r => r.totalMs)),
    totalTurnErrs: results.reduce((s, r) => s + r.turnErrors, 0),
    errorSamples
  }
}

async function runBurstMode(turns) {
  const meTurns = turns.filter(t => t.type === 'me').length
  console.log('═'.repeat(80))
  console.log(`  Elfie Stress Test [BURST]  |  ${ENV.toUpperCase()}  |  ${API_HOST}`)
  console.log(`  Scenario: ${SCENARIO}  (${meTurns + 1} messages/session)`)
  console.log(`  Ramp: ${RAMP_STEPS.join(' → ')} concurrent sessions`)
  console.log('═'.repeat(80) + '\n')

  const waveResults = []
  for (const concurrency of RAMP_STEPS) {
    process.stdout.write(`  Wave ${String(concurrency).padStart(3)}: launching ${concurrency} sessions ... `)
    const w = await runWave(concurrency, turns)
    waveResults.push(w)
    const icon = w.successRate === 100 ? '✓' : w.successRate >= 80 ? '⚠' : '✗'
    console.log(`${icon}  ${w.successRate}% | p50=${w.turn.p50}ms p95=${w.turn.p95}ms p99=${w.turn.p99}ms | wall=${(w.waveMs / 1000).toFixed(1)}s`)
    if (w.errorSamples.length) w.errorSamples.forEach(e => console.log(`         error: ${e}`))
    if (concurrency < RAMP_STEPS[RAMP_STEPS.length - 1]) await sleep(WAVE_COOLDOWN_MS)
  }

  printBurstSummary(waveResults)

  fs.writeFileSync(RESULTS_FILE, JSON.stringify({
    mode: 'burst', scenario: SCENARIO, env: ENV, host: API_HOST,
    runAt: new Date().toISOString(), rampSteps: RAMP_STEPS, waves: waveResults
  }, null, 2))
  console.log(`\n  Results saved → ${RESULTS_FILE}\n`)
}

function printBurstSummary(waves) {
  console.log('\n' + '═'.repeat(80))
  console.log('  BURST MODE — SUMMARY')
  console.log('═'.repeat(80))
  console.log(`  ${'Concurrency'.padEnd(12)} ${'Pass'.padEnd(8)} ${'Rate'.padEnd(6)} ${'p50'.padEnd(9)} ${'p95'.padEnd(9)} ${'p99'.padEnd(9)} ${'Max'.padEnd(9)} Wall`)
  console.log('  ' + '─'.repeat(76))
  for (const w of waves) {
    const icon = w.successRate === 100 ? '✓' : w.successRate >= 80 ? '⚠' : '✗'
    console.log(
      `  ${icon} ${String(w.concurrency).padEnd(11)} ` +
      `${`${w.successCount}/${w.concurrency}`.padEnd(8)} ` +
      `${`${w.successRate}%`.padEnd(6)} ` +
      `${`${w.turn.p50}ms`.padEnd(9)}${`${w.turn.p95}ms`.padEnd(9)}` +
      `${`${w.turn.p99}ms`.padEnd(9)}${`${w.turn.max}ms`.padEnd(9)}` +
      `${(w.waveMs / 1000).toFixed(1)}s`
    )
  }
  console.log('═'.repeat(80))
  const firstFail = waves.find(w => w.successRate < 100)
  if (firstFail) console.log(`\n  ⚠  Degradation starts at ${firstFail.concurrency} sessions (${firstFail.successRate}% pass rate)`)
  else           console.log('\n  ✓  No failures across all concurrency levels')
  const b = waves[0], p = waves[waves.length - 1]
  if (b && p && b.turn.p50 > 0)
    console.log(`  📈 p50 growth: ${b.turn.p50}ms → ${p.turn.p50}ms (${Math.round(p.turn.p50 / b.turn.p50 * 10) / 10}× at ${p.concurrency} sessions)`)
}

// ─── ARRIVAL mode ──────────────────────────────────────────────────────────────

async function runArrivalMode(turns, ratePerSec, durationSec, thinkMs) {
  const meTurns      = turns.filter(t => t.type === 'me').length
  const totalExpected = ratePerSec * durationSec
  const sessionDurEstMs = (meTurns + 1) * (200 + thinkMs)  // rough estimate

  console.log('═'.repeat(80))
  console.log(`  Elfie Stress Test [ARRIVAL]  |  ${ENV.toUpperCase()}  |  ${API_HOST}`)
  console.log(`  Scenario  : ${SCENARIO}  (${meTurns + 1} messages/session)`)
  console.log(`  Rate      : ${ratePerSec} new sessions/sec  ×  ${durationSec}s  =  ${totalExpected} total sessions`)
  console.log(`  Think time: ${thinkMs / 1000}s between turns  (simulates human typing speed)`)
  console.log(`  Est. peak concurrency: ~${Math.min(totalExpected, Math.ceil(sessionDurEstMs / 1000) * ratePerSec)} simultaneous sessions`)
  console.log('═'.repeat(80) + '\n')

  const allResults     = []
  const activeSet      = new Set()
  const timeline       = []
  let   sessionCounter = 0
  const testStart      = Date.now()

  // Launch sessions at fixed rate for durationSec
  for (let sec = 0; sec < durationSec; sec++) {
    const secStart = Date.now()

    for (let i = 0; i < ratePerSec; i++) {
      const idx = sessionCounter++
      activeSet.add(idx)
      runSession(turns, idx, thinkMs)
        .then(r  => { allResults.push(r); activeSet.delete(idx) })
        .catch(e => {
          allResults.push({ sessionIndex: idx, success: false, totalMs: 0, turnTimes: [], turnErrors: 1, error: e.message })
          activeSet.delete(idx)
        })
    }

    const snap = {
      sec:        sec + 1,
      launched:   sessionCounter,
      active:     activeSet.size,
      completed:  allResults.length,
      errors:     allResults.filter(r => !r.success).length
    }
    timeline.push(snap)

    process.stdout.write(
      `\r  t=${String(sec + 1).padStart(3)}s | ` +
      `launched=${String(snap.launched).padStart(4)} | ` +
      `active=${String(snap.active).padStart(4)} | ` +
      `completed=${String(snap.completed).padStart(4)} | ` +
      `errors=${snap.errors}`
    )

    const elapsed = Date.now() - secStart
    if (sec < durationSec - 1) await sleep(Math.max(0, 1000 - elapsed))
  }

  // Drain remaining sessions
  console.log(`\n\n  Ramp ended. Draining ${activeSet.size} sessions still in flight...`)
  while (activeSet.size > 0) {
    await sleep(500)
    process.stdout.write(`\r  Draining: ${String(activeSet.size).padStart(4)} remaining, ${allResults.length}/${sessionCounter} complete ...`)
  }
  console.log(`\r  All ${sessionCounter} sessions complete.${' '.repeat(30)}`)

  printArrivalSummary(allResults, timeline, ratePerSec, durationSec, thinkMs, sessionCounter, Date.now() - testStart)

  fs.writeFileSync(RESULTS_FILE, JSON.stringify({
    mode: 'arrival', scenario: SCENARIO, env: ENV, host: API_HOST,
    runAt: new Date().toISOString(),
    config: { ratePerSec, durationSec, thinkSec: thinkMs / 1000 },
    timeline, summary: buildArrivalStats(allResults, sessionCounter)
  }, null, 2))
  console.log(`\n  Results saved → ${RESULTS_FILE}\n`)
}

function buildArrivalStats(results, total) {
  const successes    = results.filter(r => r.success)
  const allTurnTimes = results.flatMap(r => r.turnTimes.filter(t => t > 0))
  return {
    totalSessions:  total,
    successCount:   successes.length,
    failCount:      total - successes.length,
    successRate:    Math.round(100 * successes.length / total),
    turn:           stats(allTurnTimes),
    session:        stats(results.map(r => r.totalMs)),
    errors:         results.filter(r => !r.success).map(r => r.error).filter(Boolean).slice(0, 5)
  }
}

function printArrivalSummary(results, timeline, ratePerSec, durationSec, thinkMs, total, wallMs) {
  const s            = buildArrivalStats(results, total)
  const peakActive   = Math.max(...timeline.map(t => t.active))
  const peakSec      = timeline.find(t => t.active === peakActive)?.sec

  console.log('\n' + '═'.repeat(80))
  console.log('  ARRIVAL MODE — TIMELINE  (active sessions per second)')
  console.log('═'.repeat(80))

  // Print timeline bar chart
  const barMax = peakActive
  for (const t of timeline) {
    const barLen = barMax > 0 ? Math.round((t.active / barMax) * 40) : 0
    const bar    = '█'.repeat(barLen).padEnd(40)
    const icon   = t.errors > (timeline[t.sec - 2]?.errors ?? 0) ? '⚠' : ' '
    console.log(`  t=${String(t.sec).padStart(3)}s ${icon} ${bar} ${t.active} active  (${t.completed} done, ${t.errors} err)`)
  }

  console.log('\n' + '═'.repeat(80))
  console.log('  ARRIVAL MODE — SUMMARY')
  console.log('═'.repeat(80))
  console.log(`  Total sessions   : ${total}  (${ratePerSec}/sec × ${durationSec}s)`)
  console.log(`  Think time       : ${thinkMs / 1000}s between turns`)
  console.log(`  Success rate     : ${s.successCount}/${total}  (${s.successRate}%)`)
  console.log(`  Peak concurrency : ${peakActive} active sessions at t=${peakSec}s`)
  console.log(`  Total wall time  : ${(wallMs / 1000).toFixed(1)}s`)
  console.log('')
  console.log(`  Turn latency     : p50=${s.turn.p50}ms  p95=${s.turn.p95}ms  p99=${s.turn.p99}ms  max=${s.turn.max}ms`)
  console.log(`  Session duration : p50=${s.session.p50}ms  p95=${s.session.p95}ms  avg=${s.session.avg}ms`)
  if (s.errors.length) {
    console.log(`\n  Errors (sample):`)
    s.errors.forEach(e => console.log(`    ↳ ${e}`))
  }
  const icon = s.successRate === 100 ? '✓' : s.successRate >= 95 ? '⚠' : '✗'
  console.log(`\n  ${icon}  Overall: ${s.successRate}% success at ${ratePerSec} sessions/sec sustained for ${durationSec}s`)
  console.log('═'.repeat(80))
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CONVO_FILE)) {
    console.error(`Convo file not found: ${CONVO_FILE}`)
    process.exit(1)
  }

  const turns = parseConvo(CONVO_FILE)

  if (MODE === 'arrival') {
    await runArrivalMode(turns, ARRIVAL_RATE, ARRIVAL_DURATION, Math.round(THINK_TIME_SEC * 1000))
  } else {
    await runBurstMode(turns)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
