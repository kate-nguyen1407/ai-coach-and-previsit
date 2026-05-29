# Elfie AI Agent Test Suite — User Guide

This repo contains the Botium-based regression and quality test suite for two Elfie AI agents:

- **Pre-Visit Agent** — collects patient information before a doctor's appointment
- **AI Coach** — health coaching assistant for logging vitals, tracking habits, and escalating medical concerns

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Configuration — `.env`](#2-configuration--env)
3. [Pre-Visit Agent Suites](#3-pre-visit-agent-suites)
   - [3.1 Backend Regression Suite](#31-backend-regression-suite)
   - [3.2 Quality Validation Suite (BE-337)](#32-quality-validation-suite-be-337)
   - [3.3 Care UI — Live Regression Suite](#33-care-ui--live-regression-suite)
   - [3.4 Care UI — End-to-End Suite with Summary Validation](#34-care-ui--end-to-end-suite-with-summary-validation)
4. [AI Coach Suites](#4-ai-coach-suites)
   - [4.1 Backend Regression Suite](#41-backend-regression-suite)
   - [4.2 Quality Validation Suite (AI Coach V1)](#42-quality-validation-suite-ai-coach-v1)
   - [4.3 Quality Validation Suite (AI Coach V2)](#43-quality-validation-suite-ai-coach-v2)
5. [Conversation Files](#5-conversation-files)
6. [Hooks](#6-hooks)
7. [AI Judge](#7-ai-judge)
8. [Utility Scripts](#8-utility-scripts)
9. [Stress Testing](#9-stress-testing)
10. [GitHub Actions CI](#10-github-actions-ci)
11. [Reading Test Reports](#11-reading-test-reports)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

- Node.js 20+
- npm

```bash
npm install
```

Create a `.env` file in the repo root (see section 2). All test scripts load it automatically.

---

## 2. Configuration — `.env`

```dotenv
# Which environment to test against
ELFIE_ENV=staging           # staging (default) | prod

# API keys
ELFIE_API_KEY=<your-key>    # x-api-key header for backend API
ANTHROPIC_API_KEY=<key>     # Claude API key for the AI judge

# Care UI clinic slug (pre-visit E2E tests only)
CARE_PREVISIT_SLUG=jk-clinic-4k2q

# AI judge override (optional — leave blank to use Anthropic Claude)
AI_JUDGE_BASE_URL=          # e.g. http://localhost:11434/v1 for local Ollama
AI_JUDGE_MODEL=             # e.g. llama3.1 or claude-haiku-4-5-20251001
```

**Environments**

| `ELFIE_ENV` | Backend API | Care UI |
|---|---|---|
| `staging` | `api.stg.elfie.co` | `care.stg.elfie.co` |
| `prod` | `api.elfie.co` | `care.elfie.co` |

---

## 3. Pre-Visit Agent Suites

The pre-visit agent guides patients through a structured intake covering nine domains: visit context, symptoms, medical history, medications, monitoring metrics, lifestyle, mental/emotional health, exposure risk, and administrative details.

### 3.1 Backend Regression Suite

**File:** `test/convo/previsit.suite.spec.js`

Runs 10 per-domain conversation scenarios against the backend API (`api.elfie.co`). Each scenario covers one domain in isolation so failures point directly to the broken domain.

**Languages:** English (`en`), French (`fr`), Vietnamese (`vi`)

```bash
# English (default)
npx mocha test/convo/previsit.suite.spec.js --timeout 90000

# French
TEST_LANGUAGE=fr npx mocha test/convo/previsit.suite.spec.js --timeout 90000

# Vietnamese
TEST_LANGUAGE=vi npx mocha test/convo/previsit.suite.spec.js --timeout 90000

# Against prod
ELFIE_ENV=prod TEST_LANGUAGE=en npx mocha test/convo/previsit.suite.spec.js --timeout 90000

# Include optional post-summary scenario (scenario 11)
TEST_POST_SUMMARY=1 npx mocha test/convo/previsit.suite.spec.js --timeout 120000
```

**Output:** `test-results-<lang>.json`

**Scenarios (EN):**

| # | File | Domain |
|---|---|---|
| 01 | `01_opening.convo.txt` | Greeting and consent |
| 02 | `02_identity.convo.txt` | Name, gender, date of birth |
| 03 | `03_visit_context.convo.txt` | Reason for visit |
| 04 | `04_symptoms.convo.txt` | Symptom description |
| 05 | `05_medical_history.convo.txt` | Past conditions, surgery, family history |
| 06 | `06_medication.convo.txt` | Current medications, adherence, allergies |
| 07 | `07_lifestyle.convo.txt` | Smoking, alcohol, exercise, diet, sleep |
| 08 | `08_mental_emotional.convo.txt` | Stress and emotional well-being |
| 09 | `09_closing.convo.txt` | Administrative and summary |
| 10 | `10_uncertain_answers.convo.txt` | Handling vague or uncertain patient responses |
| 11 | `11_post_summary.convo.txt` | Post-completion summary (optional, slow) |

Arabic scenarios (`test/convo/previsit/ar/`) follow the same structure and are run manually — they are not included in the CI matrix.

---

### 3.2 Quality Validation Suite (BE-337)

**File:** `test/convo/previsit-quality.suite.spec.js`

Validates conversational quality improvements from Linear issue BE-337 ("Probabilistic Conversation Agent Prompt"). These tests check *how* the bot communicates, not just *what* it says. They use the AI judge (`AI_RESPONSE_ASSERTER`) on key turns.

```bash
ELFIE_API_KEY=<key> npx mocha test/convo/previsit-quality.suite.spec.js --timeout 120000
```

**Scenarios:**

| # | File | What it checks |
|---|---|---|
| 12 | `12_broad_symptom_prompt.convo.txt` | Bot asks one grouped question (description + onset + severity) instead of three separate ones |
| 13 | `13_natural_transition.convo.txt` | Bot acknowledges the previous domain before introducing the next |
| 14 | `14_submission_format.convo.txt` | Closing message is collaborative (clinic copy + patient copy + next steps), not transactional |
| 15 | `15_patient_redirect.convo.txt` | Off-topic question handled gracefully with a choice offered |

> **Note:** These tests are expected to fail against the old backend prompt and pass once the BE-337 prompt is deployed to staging.

---

### 3.3 Care UI — Live Regression Suite

**File:** `test/convo/previsit-care-live.suite.spec.js`

Runs the full James Nguyen (knee pain) journey through the Care UI frontend API (`care.stg.elfie.co`). Runs two tests:

- **flow** — verifies the conversation follows every expected turn end-to-end
- **quality** — adds AI judge criteria on 6 key turns (urgency, symptoms, onset, severity, medications, summary)

```bash
npx mocha test/convo/previsit-care-live.suite.spec.js --timeout 180000

# Against a specific clinic slug
CARE_PREVISIT_SLUG=my-clinic-xxxx npx mocha test/convo/previsit-care-live.suite.spec.js --timeout 180000
```

**Output:** `test-results-care-live.json`

**Convo files used:**

| Test | File |
|---|---|
| flow | `test/convo/previsit/en/20_live_regression.convo.txt` |
| quality | `test/convo/previsit-care/en/20_live_regression_quality.convo.txt` |

The quality convo overrides the flow convo for the same scenario — the suite checks `test/convo/previsit-care/<lang>/` first and falls back to `test/convo/previsit/<lang>/`.

---

### 3.4 Care UI — End-to-End Suite with Summary Validation

**File:** `test/convo/previsit-care.suite.spec.js`

The most comprehensive pre-visit test. Runs full patient journeys (all 9 domains, one session) through the Care UI API. After each conversation reaches completion, the bot returns a structured `suggestActions` payload containing the patient summary. This suite captures that summary and validates it against expected field values.

```bash
npx mocha test/convo/previsit-care.suite.spec.js --timeout 180000

# Run against prod
ELFIE_ENV=prod npx mocha test/convo/previsit-care.suite.spec.js --timeout 180000
```

**Output:** `test-results-care-e2e.json`

**Scenarios:**

| Scenario | File | Chief complaint | Summary checks |
|---|---|---|---|
| James Nguyen | `20_live_regression.convo.txt` | Right knee pain (acute) | Name contains "James", complaint mentions knee, ibuprofen, ligament/MRI/physio in patient questions |
| Sarah Johnson | `21_e2e_migraines.convo.txt` | Recurring migraines (chronic) | Name contains "Sarah", migraine/headache, sumatriptan, penicillin allergy, neurologist/preventive in patient questions |

**How summary validation works:**

The `botium-hook-care-response.js` response hook fires on every bot reply. When `suggestActions[0].extractedData.summary` is present (only at the completion turn), it writes it to a temp file. After the conversation finishes, `validateSummary()` reads that file and performs case-insensitive substring checks across the full serialized summary JSON.

The report includes a `summary_validation` block per scenario:

```json
{
  "name": "James Nguyen — Right Knee Pain (EN)",
  "state": "passed",
  "summary_validation": {
    "captured": true,
    "sessionId": 9139,
    "summary": { "user_info": {...}, "key_signals": {...}, ... },
    "checks": [
      { "label": "patient name contains James", "matched": true },
      { "label": "complaint mentions knee",      "matched": true }
    ]
  }
}
```

**Adding a new E2E scenario:**

1. Create a convo file in `test/convo/previsit/en/` with `.+` on every intermediate bot turn and a strict completion regex on the final turn.
2. Add an entry to `E2E_SCENARIOS` in `previsit-care.suite.spec.js` with `expect` fields that should appear in the summary.

---

## 4. AI Coach Suites

The AI coach is a health coaching assistant that handles food logging, vitals tracking, exercise, sleep, emotional support, and medical escalation.

### 4.1 Backend Regression Suite

**File:** `test/convo/aicoach.suite.spec.js`

Runs 10 core AI coach scenarios against the backend API.

```bash
npx mocha test/convo/aicoach.suite.spec.js --timeout 90000
```

**Output:** `test-results-aicoach-en.json`

**Scenarios:**

| # | File | What it covers |
|---|---|---|
| 01 | `01_food_logging.convo.txt` | Logging a meal |
| 02 | `02_calorie_query.convo.txt` | Asking about calorie content |
| 03 | `03_fatigue_report.convo.txt` | Reporting fatigue |
| 04 | `04_exercise_logging.convo.txt` | Logging exercise |
| 05 | `05_hydration_tracking.convo.txt` | Logging water intake |
| 06 | `06_sleep_concern.convo.txt` | Reporting poor sleep |
| 07 | `07_stress_emotional.convo.txt` | Expressing stress |
| 08 | `08_goal_setting.convo.txt` | Setting a health goal |
| 09 | `09_dietary_advice.convo.txt` | Asking for dietary advice |
| 10 | `10_medical_concern.convo.txt` | Reporting a medical concern |

---

### 4.2 Quality Validation Suite (AI Coach V1)

**File:** `test/convo/aicoach-quality.suite.spec.js`

Validates coaching tone, clarity, and escalation behaviour using the AI judge. Covers 4 additional quality scenarios:

| # | File | What it checks |
|---|---|---|
| 11 | `11_coaching_tone.convo.txt` | Warm, motivating tone (not clinical) |
| 12 | `12_clarification_style.convo.txt` | Bot asks one clarifying question at a time |
| 13 | `13_off_topic_redirect.convo.txt` | Off-topic question redirected gracefully |
| 14 | `14_medical_escalation_quality.convo.txt` | Medical concern escalated with empathy and urgency |

```bash
npx mocha test/convo/aicoach-quality.suite.spec.js --timeout 120000
```

**Output:** `test-results-aicoach-quality.json`

---

### 4.3 Quality Validation Suite (AI Coach V2)

**File:** `test/convo/aicoach-v2-quality.suite.spec.js`

Validates the V2 architecture principles (Linear: ELF-24578). Each scenario maps to a specific V2 capability.

```bash
npx mocha test/convo/aicoach-v2-quality.suite.spec.js --timeout 120000
```

**Output:** `test-results-aicoach-v2-quality.json`

**Scenarios:**

| # | File | V2 Principle |
|---|---|---|
| v2_01 | `v2_01_emotional_handling.convo.txt` | Validates feelings before pivoting to data |
| v2_02 | `v2_02_non_repetitive_flow.convo.txt` | Varied natural language across multi-item session |
| v2_03 | `v2_03_dual_mode_arbitration.convo.txt` | Emotional content + health data handled by both pathways |
| v2_04 | `v2_04_time_horizon_awareness.convo.txt` | Immediate concern and long-term goal addressed in one turn |
| v2_05 | `v2_05_coaching_behavior_support.convo.txt` | Streak recognised with progression coaching |
| v2_06 | `v2_06_safety_escalation.convo.txt` | Worsening cardiac symptoms trigger escalation |
| v2_07 | `v2_07_mode_switching.convo.txt` | Data log → advice → data log: each turn routed correctly |
| v2_08 | `v2_08_context_retention.convo.txt` | Bot recalls specific values from earlier in the session |
| v2_09 | `v2_09_clarification_exploration.convo.txt` | Vague symptom probed with open-ended empathetic question |
| v2_10 | `v2_10_user_resistance.convo.txt` | User declines advice; bot respects boundary |
| v2_11 | `v2_11_medication_safety.convo.txt` | Accidental double dose escalated to pharmacist/doctor |

---

## 5. Conversation Files

All conversation scripts live under `test/convo/`.

### Format

Botium `.convo.txt` files use a simple turn-based format:

```
<Test name>

#bot
<expected bot response pattern>

#me
<user message to send>
```

**Matching modes** (controlled by `SCRIPTING_MATCHING_MODE: 'regexpIgnoreCase'`):

| Pattern | Meaning |
|---|---|
| `.+` | Any non-empty response (used for intermediate turns in E2E tests) |
| `(?=.*word)` | Response must contain "word" (case-insensitive lookahead) |
| `(?=.*(?:a\|b\|c))` | Response must contain at least one of a, b, or c |
| `AI_RESPONSE_ASSERTER criterion1\|criterion2` | AI judge evaluates the response against the listed criteria |

### Shared opening template

Pre-visit convos share a common opening (name collection + consent). It lives in `_opening.pconvo.txt` and is injected with `#include _opening` at the top of each convo file.

### Directory layout

```
test/convo/
├── previsit/
│   ├── en/          # English — 01–21
│   ├── fr/          # French  — 01–11
│   ├── vi/          # Vietnamese — 01–11
│   └── ar/          # Arabic — 01–10
├── previsit-care/
│   └── en/          # Care UI overrides — quality convo for live regression
├── aicoach/
│   └── en/          # AI coach — 01–14 + v2_01–v2_11
├── previsit.suite.spec.js
├── previsit-quality.suite.spec.js
├── previsit-care.suite.spec.js
├── previsit-care-live.suite.spec.js
├── aicoach.suite.spec.js
├── aicoach-quality.suite.spec.js
└── aicoach-v2-quality.suite.spec.js
```

---

## 6. Hooks

Hooks run before/after each conversation to create sessions and capture data.

### `botium-hook-previsit.js` — Pre-Visit (Backend API)

Calls `POST /agent/api/v1/ai-coach/create-session` on the backend API with all 9 domains enabled. Sets `context.sessionId` and `context.languageCode` for use in subsequent turns.

**Used by:** `previsit.suite.spec.js`, `previsit-quality.suite.spec.js`

### `botium-hook-care-previsit.js` — Pre-Visit (Care UI)

Calls `POST /api/v1/ai-chat/create-session` on the Care UI API. Creates a unique `userId` per test run. Also writes `{ sessionId, userId, lang, slug, host }` to a temp file (`/tmp/botium-care-previsit-session.json`) for debugging.

**Used by:** `previsit-care.suite.spec.js`, `previsit-care-live.suite.spec.js`

### `botium-hook-care-response.js` — Summary Capture (Care UI)

Fires on every bot response. When `suggestActions[0].extractedData.summary` is present (the conversation's completion turn), it writes the full summary JSON to `/tmp/botium-care-summary.json`.

**Used by:** `previsit-care.suite.spec.js`

### `botium-hook-ai-coach.js` — AI Coach

Calls `POST /agent/api/v1/ai-coach/create-session` for the AI coach. Generates a unique `userId` per test run (format: `botium-test-<timestamp>`) to prevent accumulated history on staging from affecting routing behaviour across runs.

**Used by:** `aicoach.suite.spec.js`, `aicoach-quality.suite.spec.js`, `aicoach-v2-quality.suite.spec.js`

---

## 7. AI Judge

The AI judge (`AI_RESPONSE_ASSERTER`) evaluates bot responses against natural-language criteria. It is powered by Claude (or a local Ollama model) and returns a `PASS`/`FAIL` verdict with a reason for each criterion.

### How to write criteria

In a `.convo.txt` file, replace a `#bot` pattern with:

```
#bot
AI_RESPONSE_ASSERTER the bot asks about the onset of the pain|the question is specific and not generic|the tone is warm and patient-friendly
```

Criteria are separated by `|`. Each is evaluated independently. The turn fails if any criterion returns `FAIL`.

### Tips

- Keep each criterion as one clear, testable statement.
- Avoid em dashes (`—`) in criteria text — they can cause the judge to split criteria unexpectedly.
- Use 3 criteria per turn when possible; the test fails only if the overall verdict is `FAIL`, so more criteria give the judge more room to pass.
- For intermediate turns where you only want to check flow, use `.+` instead of the AI judge to keep the suite fast.

### Local Ollama judge

```dotenv
AI_JUDGE_BASE_URL=http://localhost:11434/v1
AI_JUDGE_MODEL=llama3.1
```

Ollama responds in ~7 seconds per call. Use it for local development; use Claude for CI.

---

## 8. Utility Scripts

### `full-test-runner.js` — Multi-language, multi-run test runner

Runs all 11 pre-visit scenarios across EN/FR/VI for N consecutive runs without Botium — direct HTTPS calls. Useful for measuring response times and detecting flaky behaviour.

```bash
# 5 runs on staging (default)
node full-test-runner.js

# 10 runs on prod
node full-test-runner.js 10 prod
```

**Output:** `full-test-report.txt`, `full-test-results-<env>.json`

### `reproduce-rate.js` — Reproduction rate calculator

Runs a single scenario multiple times and reports how often a specific behaviour is observed. Useful when investigating non-deterministic failures.

```bash
node reproduce-rate.js
```

### `previsit-report.js` — Summary report formatter

Formats `test-results-<lang>.json` into a human-readable text report.

```bash
node previsit-report.js
```

### `aicoach-test-runner.js` — AI coach direct runner

Direct HTTPS runner for AI coach scenarios (no Botium). Useful for quick manual verification.

```bash
node aicoach-test-runner.js
```

**Output:** `aicoach-results.json`, `aicoach-report.txt`

### Bug evidence scripts

| Script | Purpose |
|---|---|
| `generate-bug-evidence.js` | Captures bot responses to document a specific bug |
| `capture-bug-evidence.js` | Variant that captures evidence for language contamination bugs |
| `capture-bug-evidence-v2.js` | V2 version for the quality regression bugs |
| `generate-bug-report.js` | Formats captured evidence into a markdown bug report |
| `reproduce-lang-mix.js` | Reproduces the language contamination bug |
| `reproduce-lang-mix-evidence.js` | Captures evidence of language contamination |
| `v2-reproduce-rate.js` | Measures reproduction rate for V2 quality regressions |

Bug reports and evidence:
- `bug-report-lang-contamination.md` — language contamination bug report
- `bug-report-v2-quality.md` — V2 quality regression report
- `bug-evidence-v2.txt`, `bug-evidence-v2-full.json` — captured evidence

---

## 9. Stress Testing

**File:** `stress-test.js`

Tests the Care UI API under concurrent load. Two modes:

### Burst mode (default)

Launches all sessions simultaneously in waves. Use this to find the absolute concurrency ceiling.

```bash
# 20 concurrent sessions, staging
node stress-test.js 09_closing staging burst 20

# 100 concurrent sessions
node stress-test.js 09_closing staging burst 100
```

### Arrival rate mode

Simulates real users arriving at a clinic. Launches N new sessions per second for D seconds with configurable think time between turns.

```bash
# 5 new sessions/second for 60 seconds, 10s think time between turns
node stress-test.js 09_closing staging arrival 5 60 10
```

**Parameters:**

```
node stress-test.js [scenario] [env] [mode] [param1] [param2] [param3]
```

| Param | Burst | Arrival |
|---|---|---|
| param1 | max concurrency | sessions per second |
| param2 | — | duration (seconds) |
| param3 | — | think time between turns (seconds) |

**Output:** `stress-test-results-<env>.json`, `stress-test-results-<env>-arrival.json`

---

## 10. GitHub Actions CI

**File:** `.github/workflows/pre-visit-agent.yml`

Runs automatically on push/PR to `main`/`master`. Can also be triggered manually with environment selection.

**Jobs:**

- `test (en)`, `test (fr)`, `test (vi)` — run in parallel, one per language
- `summary` — aggregates results; fails the workflow if any language suite failed

**Triggers:**

```yaml
on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]
  workflow_dispatch:       # manual trigger with env dropdown
    inputs:
      elfie_env:
        options: [staging, prod]
```

**Required secrets** (set in repo Settings → Secrets):

| Secret | Used for |
|---|---|
| `ELFIE_API_KEY` | Backend API authentication |
| `ANTHROPIC_API_KEY` | AI judge |

**Artifacts:** Each language job uploads `test-results-<lang>.json` as a workflow artifact (available for 90 days under the Actions run).

---

## 11. Reading Test Reports

All suites write a JSON report file after the run.

### Structure

```json
{
  "suite":       "Pre-Visit Agent [EN] [staging]",
  "environment": "staging",
  "language":    "en",
  "timestamp":   "2026-05-26T03:40:53.775Z",
  "ai_judge":    "anthropic / claude-haiku-4-5-20251001",
  "summary": {
    "total":       10,
    "passed":      9,
    "failed":      1,
    "duration_ms": 45231
  },
  "scenarios": [
    {
      "name":        "04_symptoms",
      "state":       "failed",
      "duration_ms": 4821,
      "error":       "AssertionError: ...",
      "transcript": [
        { "role": "bot",  "text": "What are your symptoms?" },
        { "role": "user", "text": "I have a headache" },
        {
          "role": "bot",
          "text": "Thank you.",
          "failed": true,
          "ai_judge": [
            {
              "criterion": "the bot asks about onset",
              "verdict":   "FAIL",
              "reason":    "The bot did not ask when the headache started"
            }
          ]
        }
      ]
    }
  ]
}
```

**Key fields:**
- `state: "failed"` + `transcript` — the transcript shows exactly which turn failed and why
- `ai_judge[].verdict` — `PASS` or `FAIL` per criterion with a plain-English reason
- `summary_validation` (E2E suite only) — per-field checks against the captured patient summary

### Report files

| File | Suite |
|---|---|
| `test-results-en.json` | Pre-visit backend EN |
| `test-results-fr.json` | Pre-visit backend FR |
| `test-results-vi.json` | Pre-visit backend VI |
| `test-results-ar.json` | Pre-visit backend AR |
| `test-results-quality.json` | Pre-visit quality (BE-337) |
| `test-results-care-en.json` | Care UI per-domain |
| `test-results-care-live.json` | Care UI live regression |
| `test-results-care-e2e.json` | Care UI E2E with summary validation |
| `test-results-aicoach-en.json` | AI coach backend |
| `test-results-aicoach-quality.json` | AI coach quality V1 |
| `test-results-aicoach-v2-quality.json` | AI coach quality V2 |

---

## 12. Troubleshooting

### "No sessionId in response"

The hook failed to create a session. Check:
- `ELFIE_API_KEY` is set correctly in `.env`
- `ELFIE_ENV` points to the right environment
- The backend is reachable (try `curl` to the create-session endpoint)

### "No summary file found" in E2E suite

The conversation did not reach the completion turn. Check the transcript in the report for the last successful turn and compare it to the convo file. The completion regex `(?=.*(?:completed|finished|download|summary|...))` on the second-to-last `#bot` turn may need updating if the bot's completion message wording has changed.

### AI judge timeout

Each AI judge call has a 30-second timeout. If using Ollama locally, ensure the model is loaded (`ollama run llama3.1` at least once before running tests). If timeouts are frequent, switch to `claude-haiku-4-5-20251001` via `ANTHROPIC_API_KEY`.

### Tests fail sporadically with the same inputs

Non-determinism from the LLM. Use `.+` for intermediate turns and reserve the AI judge for turns where quality is critical. For the V2 quality suite, the `v2_06_safety_escalation` scenario is the most sensitive — run it in isolation with `TEST_SCENARIO=v2_06` if it intermittently fails.

### Wrong number of sessions in output

Each Botium test (each `it(...)` block) creates exactly one session. If you see N session IDs in the log, N tests ran. This is expected. Each scenario is a separate test to allow independent pass/fail reporting.

### Care UI vs backend API

| | Backend API | Care UI |
|---|---|---|
| Hook | `botium-hook-previsit.js` | `botium-hook-care-previsit.js` |
| Session endpoint | `/agent/api/v1/ai-coach/create-session` | `/api/v1/ai-chat/create-session` |
| Chat endpoint | `/agent/api/v1/ai-coach/chat` | `/api/v1/ai-chat/chat` |
| Auth | `x-api-key` header | No auth header |
| Session fields | `user_id`, `language_code`, `config.domains` | `userId`, `languageCode`, `config.slug` |
| Response field | `$.message` | `$.message` |
| Summary data | Not available | `suggestActions[0].extractedData.summary` |
