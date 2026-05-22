# Reasoning OS v0 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a measurable Reasoning OS v0 on top of the existing Shaper-Coder eval harness: a mode router + criteria-vector verifier + scaffold-component mapping + persistent delta log, evaluated against frozen held-out coding tasks.

**Architecture:** Keep this as a local, testable harness extension rather than a giant agent runtime. The OS wraps existing baselines (`raw_base`, `gen0_seed`, `gen18_evolved`) with a new `reasoning_os_v0` pipeline that routes task mode, enforces explicit contracts, records verifier criteria vectors, maps failures to scaffold components, and persists accepted/rejected scaffold deltas. Measurement is pass@1/pass@N plus failure-kind/criterion/component movement on held-out tasks.

**Tech Stack:** Node.js ES modules, existing no-dependency test style (`node test-*.js`), local Ollama provider shim (`providers.js`), existing eval harness modules (`eval.js`, `failure-metrics.js`, `trace-log.js`, `result-schema.js`, `heldout-plan.js`).

---

## ERAS Design Constraints

This plan intentionally encodes the loaded ERAS findings:

- **RCR:** Improvements must form a chain from failure signature → constraint update → new measurement.
- **Discriminativity:** Binary pass/fail is insufficient; verifier output must be a multi-dimensional vector.
- **Criteria ↔ scaffold correspondence:** Every verifier criterion must map to a named scaffold/OS component.
- **PERM_GRAD / RULE_PRIM:** Reasoning mode selection and output pressure are first-class controls, not prompt afterthoughts.
- **INTR_LAYER:** Do not trust model self-report as causal explanation; trust externally logged failures and test outcomes.
- **COH_ATR warning:** No claims of improvement without held-out evaluation and persistent audit logs.

---

## Current Repo Facts

Repo path:

```bash
/home/masclaw/agent-share/shared/artifacts/shaper-coder-20260504/eval-harness
```

Existing useful files:

- `eval.js` — current problem evaluator and pipeline prompts.
- `index.js` — baseline CLI and state handling.
- `failure-metrics.js` — hierarchical-ish failure classifier.
- `trace-log.js` — bounded raw trace JSONL writer.
- `result-schema.js` — machine-readable result artifact builder/validator.
- `heldout-plan.js` / `HELDOUT-DATASET-PLAN.json` — held-out methodology.
- `stats.js` / `n4-analysis.js` — small-N stats helpers.
- `test-*.js` — no-package test suite run directly with Node.

Known caveats:

- No `package.json`; use direct `node` commands.
- Previous N4 result showed raw baseline stronger on pass@1; treat as measurement signal, not conclusion.
- `variance-run.js` still writes to old `/home/masclaw/.openclaw/...` path and should not be copied as a pattern without fixing.
- Existing baselines are not commensurable with future semantics if we change interface contracts; new results need explicit schema/version notes.

---

## New Conceptual Objects

### OS State

The OS state is per problem attempt, not global daemon state:

```js
{
  osVersion: 'reasoning-os/v0',
  route: {
    mode: 'code_generation',
    reasoningStyle: 'spec_first',
    risk: 'local_eval',
    requiredChecks: ['signature_contract', 'edge_cases', 'runtime_tests'],
    uncertaintyPolicy: 'tool_before_claim'
  },
  criteriaVector: {
    correctness: 0,
    interfaceContract: 0,
    edgeCases: 0,
    specAlignment: 0,
    formatProtocol: 0,
    repairability: 0,
    cohAtrRisk: 0
  },
  componentMapping: {
    interfaceContract: 'signature_contract',
    formatProtocol: 'structured_output_contract',
    edgeCases: 'edge_case_scaffold',
    correctness: 'algorithmic_strategy_scaffold'
  },
  deltaIds: []
}
```

### Scaffold Delta

A delta is an auditable proposed change, not merely a prompt edit:

```js
{
  id: 'delta-...',
  createdAt: 'ISO',
  trigger: {
    problemId: 'coin-change-ii',
    baselineKind: 'reasoning_os_v0',
    failureKind: 'format_protocol',
    criterion: 'formatProtocol',
    component: 'structured_output_contract'
  },
  hypothesis: 'Tightening JSON-only verifier output should reduce format/protocol failures without changing logic failures.',
  patch: {
    component: 'structured_output_contract',
    before: '...',
    after: '...'
  },
  expectedEffect: {
    decreaseFailureKinds: ['format_protocol'],
    notExpectedToChange: ['logic_assertion']
  },
  status: 'proposed|accepted|rejected',
  evidence: []
}
```

---

## Task 1: Add Reasoning OS type constants and component map

**Objective:** Create the static vocabulary that later modules share: OS version, criteria names, component names, and criterion→component mapping.

**Files:**

- Create: `reasoning-os.js`
- Create: `test-reasoning-os.js`

**Step 1: Write failing test**

Create `test-reasoning-os.js`:

```js
import assert from 'node:assert/strict';
import {
  REASONING_OS_VERSION,
  CRITERIA,
  COMPONENTS,
  CRITERION_COMPONENT_MAP,
  validateCriterionComponentMap,
} from './reasoning-os.js';

assert.equal(REASONING_OS_VERSION, 'reasoning-os/v0');
assert.ok(CRITERIA.includes('interfaceContract'));
assert.ok(COMPONENTS.includes('signature_contract'));
assert.equal(CRITERION_COMPONENT_MAP.interfaceContract, 'signature_contract');

const validation = validateCriterionComponentMap(CRITERION_COMPONENT_MAP);
assert.equal(validation.valid, true, JSON.stringify(validation.errors));

const invalid = validateCriterionComponentMap({ unknownCriterion: 'missing_component' });
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.length > 0);

console.log('test-reasoning-os: PASS');
```

**Step 2: Run test to verify failure**

Run:

```bash
node test-reasoning-os.js
```

Expected: FAIL because `reasoning-os.js` does not exist.

**Step 3: Implement minimal module**

Create `reasoning-os.js`:

```js
export const REASONING_OS_VERSION = 'reasoning-os/v0';

export const CRITERIA = Object.freeze([
  'correctness',
  'interfaceContract',
  'edgeCases',
  'specAlignment',
  'formatProtocol',
  'repairability',
  'cohAtrRisk',
]);

export const COMPONENTS = Object.freeze([
  'algorithmic_strategy_scaffold',
  'signature_contract',
  'edge_case_scaffold',
  'spec_alignment_scaffold',
  'structured_output_contract',
  'repair_loop_policy',
  'coh_atr_audit_gate',
]);

export const CRITERION_COMPONENT_MAP = Object.freeze({
  correctness: 'algorithmic_strategy_scaffold',
  interfaceContract: 'signature_contract',
  edgeCases: 'edge_case_scaffold',
  specAlignment: 'spec_alignment_scaffold',
  formatProtocol: 'structured_output_contract',
  repairability: 'repair_loop_policy',
  cohAtrRisk: 'coh_atr_audit_gate',
});

export function validateCriterionComponentMap(map) {
  const errors = [];
  for (const criterion of Object.keys(map ?? {})) {
    if (!CRITERIA.includes(criterion)) {
      errors.push({ path: criterion, message: 'unknown criterion' });
    }
    if (!COMPONENTS.includes(map[criterion])) {
      errors.push({ path: criterion, message: 'unknown component' });
    }
  }
  for (const criterion of CRITERIA) {
    if (!map || typeof map[criterion] !== 'string') {
      errors.push({ path: criterion, message: 'missing component mapping' });
    }
  }
  return { valid: errors.length === 0, errors };
}
```

**Step 4: Verify pass**

Run:

```bash
node test-reasoning-os.js
```

Expected: PASS.

---

## Task 2: Add deterministic task mode router

**Objective:** Add a deterministic router that produces a structured route for coding-eval tasks before any model call.

**Files:**

- Modify: `reasoning-os.js`
- Modify: `test-reasoning-os.js`

**Step 1: Add failing tests**

Append to `test-reasoning-os.js`:

```js
import { routeTask } from './reasoning-os.js';

const route = routeTask({
  problemName: 'binary-search',
  baselineKind: 'reasoning_os_v0',
  taskKind: 'coding_eval',
});

assert.deepEqual(route.requiredChecks, [
  'signature_contract',
  'edge_cases',
  'runtime_tests',
  'structured_output_contract',
]);
assert.equal(route.mode, 'code_generation');
assert.equal(route.reasoningStyle, 'spec_first');
assert.equal(route.uncertaintyPolicy, 'tool_before_claim');
assert.equal(route.risk, 'local_eval');
```

**Step 2: Run test to verify failure**

Run:

```bash
node test-reasoning-os.js
```

Expected: FAIL because `routeTask` is missing.

**Step 3: Implement router**

Add to `reasoning-os.js`:

```js
export function routeTask({ problemName, baselineKind, taskKind = 'coding_eval' } = {}) {
  if (!problemName) throw new Error('problemName is required');
  if (taskKind !== 'coding_eval') throw new Error(`unsupported taskKind: ${taskKind}`);
  return {
    osVersion: REASONING_OS_VERSION,
    problemName,
    baselineKind,
    taskKind,
    mode: 'code_generation',
    reasoningStyle: 'spec_first',
    risk: 'local_eval',
    requiredChecks: [
      'signature_contract',
      'edge_cases',
      'runtime_tests',
      'structured_output_contract',
    ],
    uncertaintyPolicy: 'tool_before_claim',
  };
}
```

**Step 4: Verify pass**

Run:

```bash
node test-reasoning-os.js
```

Expected: PASS.

---

## Task 3: Add criteria-vector builder and validator

**Objective:** Convert existing attempt outcomes/failure kinds into a normalized criteria vector with explicit failure criterion.

**Files:**

- Modify: `reasoning-os.js`
- Modify: `test-reasoning-os.js`

**Step 1: Add failing tests**

Append to `test-reasoning-os.js`:

```js
import { buildCriteriaVector, validateCriteriaVector } from './reasoning-os.js';

const passVector = buildCriteriaVector({ pass: true, failureKind: 'pass' });
assert.equal(passVector.correctness, 1);
assert.equal(passVector.interfaceContract, 1);
assert.equal(passVector.formatProtocol, 1);
assert.equal(passVector.failureCriterion, null);
assert.equal(validateCriteriaVector(passVector).valid, true);

const formatFail = buildCriteriaVector({
  pass: false,
  failureKind: 'format_protocol',
  failureCode: 'format_protocol.no_json',
});
assert.equal(formatFail.formatProtocol, 0);
assert.equal(formatFail.failureCriterion, 'formatProtocol');
assert.equal(formatFail.failureCode, 'format_protocol.no_json');
assert.equal(validateCriteriaVector(formatFail).valid, true);

const logicFail = buildCriteriaVector({ pass: false, failureKind: 'logic_assertion' });
assert.equal(logicFail.correctness, 0);
assert.equal(logicFail.failureCriterion, 'correctness');
```

**Step 2: Run test to verify failure**

Run:

```bash
node test-reasoning-os.js
```

Expected: FAIL because builder/validator are missing.

**Step 3: Implement builder**

Add to `reasoning-os.js`:

```js
const FAILURE_TO_CRITERION = Object.freeze({
  pass: null,
  logic_assertion: 'correctness',
  format_protocol: 'formatProtocol',
  timeout: 'repairability',
  spec_validation: 'interfaceContract',
  model_error: 'repairability',
});

function fullPassVector() {
  return {
    correctness: 1,
    interfaceContract: 1,
    edgeCases: 1,
    specAlignment: 1,
    formatProtocol: 1,
    repairability: 1,
    cohAtrRisk: 0,
  };
}

export function buildCriteriaVector({ pass, failureKind = 'model_error', failureCode, failureSubKind } = {}) {
  const vector = fullPassVector();
  const failureCriterion = pass ? null : (FAILURE_TO_CRITERION[failureKind] ?? 'repairability');
  if (failureCriterion) vector[failureCriterion] = 0;
  return {
    ...vector,
    failureKind: pass ? 'pass' : failureKind,
    failureSubKind,
    failureCode: pass ? 'pass' : failureCode,
    failureCriterion,
  };
}

export function validateCriteriaVector(vector) {
  const errors = [];
  for (const criterion of CRITERIA) {
    const value = vector?.[criterion];
    if (typeof value !== 'number' || value < 0 || value > 1) {
      errors.push({ path: criterion, message: 'must be number in [0,1]' });
    }
  }
  if (vector?.failureCriterion !== null && vector?.failureCriterion !== undefined && !CRITERIA.includes(vector.failureCriterion)) {
    errors.push({ path: 'failureCriterion', message: 'must be null or known criterion' });
  }
  return { valid: errors.length === 0, errors };
}
```

**Step 4: Verify pass**

Run:

```bash
node test-reasoning-os.js
```

Expected: PASS.

---

## Task 4: Add component-target resolution

**Objective:** Map criteria-vector failures to named OS/scaffold components, making updates actionable rather than prose-only.

**Files:**

- Modify: `reasoning-os.js`
- Modify: `test-reasoning-os.js`

**Step 1: Add failing tests**

Append to `test-reasoning-os.js`:

```js
import { resolveUpdateTarget } from './reasoning-os.js';

const target = resolveUpdateTarget(formatFail);
assert.equal(target.criterion, 'formatProtocol');
assert.equal(target.component, 'structured_output_contract');
assert.equal(target.actionable, true);

const noTarget = resolveUpdateTarget(passVector);
assert.equal(noTarget.actionable, false);
assert.equal(noTarget.component, null);
```

**Step 2: Run test to verify failure**

Run:

```bash
node test-reasoning-os.js
```

Expected: FAIL because `resolveUpdateTarget` is missing.

**Step 3: Implement resolver**

Add to `reasoning-os.js`:

```js
export function resolveUpdateTarget(criteriaVector, map = CRITERION_COMPONENT_MAP) {
  const criterion = criteriaVector?.failureCriterion ?? null;
  if (!criterion) {
    return { actionable: false, criterion: null, component: null };
  }
  const component = map[criterion] ?? null;
  return {
    actionable: Boolean(component),
    criterion,
    component,
    failureKind: criteriaVector.failureKind,
    failureCode: criteriaVector.failureCode,
  };
}
```

**Step 4: Verify pass**

Run:

```bash
node test-reasoning-os.js
```

Expected: PASS.

---

## Task 5: Add persistent delta log module

**Objective:** Persist proposed/accepted/rejected scaffold deltas as JSONL artifacts, independent of chat/session memory.

**Files:**

- Create: `delta-log.js`
- Create: `test-delta-log.js`
- Directory runtime output: `delta-logs/` (created by code; should be gitignored if noisy)

**Step 1: Write failing test**

Create `test-delta-log.js`:

```js
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDelta,
  appendDelta,
  readDeltas,
  validateDelta,
} from './delta-log.js';

const dir = mkdtempSync(join(tmpdir(), 'delta-log-'));
const path = join(dir, 'deltas.jsonl');

const delta = createDelta({
  trigger: {
    problemId: 'binary-search',
    baselineKind: 'reasoning_os_v0',
    failureKind: 'format_protocol',
    criterion: 'formatProtocol',
    component: 'structured_output_contract',
  },
  hypothesis: 'Structured output hardening should reduce format/protocol failures.',
  patch: {
    component: 'structured_output_contract',
    before: 'loose JSON instruction',
    after: 'strict JSON instruction',
  },
  expectedEffect: {
    decreaseFailureKinds: ['format_protocol'],
    notExpectedToChange: ['logic_assertion'],
  },
});

assert.equal(validateDelta(delta).valid, true);
appendDelta(path, delta);
const raw = readFileSync(path, 'utf8').trim();
assert.ok(raw.includes(delta.id));

const deltas = readDeltas(path);
assert.equal(deltas.length, 1);
assert.equal(deltas[0].status, 'proposed');

console.log('test-delta-log: PASS');
```

**Step 2: Run test to verify failure**

Run:

```bash
node test-delta-log.js
```

Expected: FAIL because `delta-log.js` does not exist.

**Step 3: Implement module**

Create `delta-log.js`:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DELTA_SCHEMA_VERSION = 'scaffold-delta/v0';

export function createDelta({ trigger, hypothesis, patch, expectedEffect, status = 'proposed' }) {
  return {
    schemaVersion: DELTA_SCHEMA_VERSION,
    id: `delta-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    trigger,
    hypothesis,
    patch,
    expectedEffect,
    status,
    evidence: [],
  };
}

export function validateDelta(delta) {
  const errors = [];
  if (delta?.schemaVersion !== DELTA_SCHEMA_VERSION) errors.push({ path: 'schemaVersion', message: 'invalid schema' });
  if (typeof delta?.id !== 'string' || !delta.id.startsWith('delta-')) errors.push({ path: 'id', message: 'invalid id' });
  if (typeof delta?.createdAt !== 'string') errors.push({ path: 'createdAt', message: 'required' });
  if (typeof delta?.hypothesis !== 'string' || delta.hypothesis.length === 0) errors.push({ path: 'hypothesis', message: 'required' });
  if (!delta?.trigger?.criterion) errors.push({ path: 'trigger.criterion', message: 'required' });
  if (!delta?.trigger?.component) errors.push({ path: 'trigger.component', message: 'required' });
  if (!delta?.patch?.component) errors.push({ path: 'patch.component', message: 'required' });
  if (!['proposed', 'accepted', 'rejected'].includes(delta?.status)) errors.push({ path: 'status', message: 'invalid status' });
  return { valid: errors.length === 0, errors };
}

export function appendDelta(path, delta) {
  const validation = validateDelta(delta);
  if (!validation.valid) throw new Error(`invalid delta: ${JSON.stringify(validation.errors)}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(delta) + '\n', { flag: 'a' });
}

export function readDeltas(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
```

**Step 4: Verify pass**

Run:

```bash
node test-delta-log.js
```

Expected: PASS.

---

## Task 6: Extend trace logs with Reasoning OS state

**Objective:** Ensure attempt traces can store route, criteria vector, update target, and delta id without breaking existing trace tests.

**Files:**

- Modify: `trace-log.js`
- Modify: `test-trace-log.js`

**Step 1: Inspect current trace shape**

Read:

```bash
node test-trace-log.js
```

Expected: current tests pass before editing.

**Step 2: Add failing test**

In `test-trace-log.js`, add a case that calls `writeTraceLog` with:

```js
reasoningOs: {
  route: { mode: 'code_generation', reasoningStyle: 'spec_first' },
  criteriaVector: { correctness: 1, interfaceContract: 0, failureCriterion: 'interfaceContract' },
  updateTarget: { criterion: 'interfaceContract', component: 'signature_contract', actionable: true },
  deltaId: 'delta-test',
}
```

Assert the written JSONL row preserves `reasoningOs.route.mode`, `reasoningOs.criteriaVector.failureCriterion`, and `reasoningOs.updateTarget.component`.

**Step 3: Run test to verify failure**

Run:

```bash
node test-trace-log.js
```

Expected: FAIL if extra metadata is not preserved.

**Step 4: Implement minimal preservation**

Modify `trace-log.js` so `writeTraceLog` accepts an optional `reasoningOs` field and writes it through after applying existing truncation/bounding rules to raw model text only.

Implementation rule:

- Do not truncate structured OS metadata unless it contains raw model output.
- Do not change existing trace field names.

**Step 5: Verify pass**

Run:

```bash
node test-trace-log.js
node test-reasoning-os.js
```

Expected: PASS.

---

## Task 7: Add `reasoning_os_v0` as a baseline kind without changing old baselines

**Objective:** Add the new baseline enum/string across status/compare/run code without altering old baseline semantics.

**Files:**

- Modify: `state.js`
- Modify: `index.js`
- Modify: `result-schema.js`
- Add/modify relevant tests, likely `test-result-schema.js` and optionally a new smoke test.

**Step 1: Add failing schema test**

In `test-result-schema.js`, add a matrix using pipelines:

```js
['raw_base', 'gen0_seed', 'gen18_evolved', 'reasoning_os_v0']
```

Assert `buildResultArtifactFromMatrix(..., { pipelines })` validates.

**Step 2: Run test to verify failure**

Run:

```bash
node test-result-schema.js
```

Expected: may fail if defaults or validator assume only three baselines.

**Step 3: Update baseline lists**

- In `state.js`, extend `BaselineKind` comment/type union with `reasoning_os_v0`.
- In `result-schema.js`, export default pipelines including `reasoning_os_v0` only if you want new default reports to include it. Safer v0: keep `DEFAULT_PIPELINES` unchanged and allow custom pipelines. Do not force old N4 artifacts to include the new baseline.
- In `index.js`, define a local `ALL_BASELINES = ['raw_base', 'gen0_seed', 'gen18_evolved', 'reasoning_os_v0']` for status/compare.

**Step 4: Verify pass**

Run:

```bash
node test-result-schema.js
node index.js --status
```

Expected: PASS/status prints old baselines and `reasoning_os_v0: no run`.

---

## Task 8: Wrap `evalProblem` with Reasoning OS metadata for `reasoning_os_v0`

**Objective:** Make `reasoning_os_v0` run through the existing gen18-like pipeline while adding route/criteria/update-target metadata to attempts and traces.

**Files:**

- Modify: `eval.js`
- Modify: `reasoning-os.js` if helper needed
- Add: `test-reasoning-os-eval.js` using a non-model unit seam if possible

**Design choice for v0:** `reasoning_os_v0` should initially behave like `gen18_evolved` for model calls, but with OS metadata. That isolates instrumentation before prompt/scaffold changes.

**Step 1: Add unit-level test where possible**

If `eval.js` is too model-coupled, add pure helpers in `reasoning-os.js`:

```js
export function attachReasoningOsToAttempt({ attempt, route }) {
  const criteriaVector = buildCriteriaVector(attempt);
  const updateTarget = resolveUpdateTarget(criteriaVector);
  return {
    ...attempt,
    reasoningOs: { route, criteriaVector, updateTarget },
  };
}
```

Test that a failed attempt gets `reasoningOs.updateTarget.component`.

**Step 2: Run failing test**

```bash
node test-reasoning-os.js
```

Expected: FAIL before helper exists.

**Step 3: Implement helper and integrate**

- In `evalProblem(...)`, when `baselineKind === 'reasoning_os_v0'`:
  - route with `routeTask({ problemName, baselineKind })`
  - internally use the same execution behavior as `gen18_evolved`
  - attach OS metadata to each attempt before returning
  - pass OS metadata into `recordAttemptTrace(...)`

Pseudo-pattern:

```js
const effectiveBaselineKind = baselineKind === 'reasoning_os_v0' ? 'gen18_evolved' : baselineKind;
const route = baselineKind === 'reasoning_os_v0' ? routeTask({ problemName, baselineKind }) : null;
// run existing pipeline using effectiveBaselineKind behavior
// before return: attempts.map(a => route ? attachReasoningOsToAttempt({ attempt: a, route }) : a)
```

Important:

- Trace/log/report should preserve requested baseline `reasoning_os_v0`, not silently label as `gen18_evolved`.
- Execution behavior can reuse gen18 internals.

**Step 4: Verify non-model tests**

Run:

```bash
node test-reasoning-os.js
node test-trace-log.js
node test-result-schema.js
node test-basic-runner.js
```

Expected: PASS.

---

## Task 9: Add scaffold delta proposal generation from failed attempts

**Objective:** Generate proposed deltas from failed OS attempts, but do not auto-apply them. This keeps dispatch boring and audit-friendly.

**Files:**

- Modify: `reasoning-os.js`
- Modify: `delta-log.js` if helper belongs there
- Modify: `test-reasoning-os.js` or `test-delta-log.js`

**Step 1: Add failing test**

Add test:

```js
import { proposeDeltaFromAttempt } from './reasoning-os.js';

const failedAttempt = {
  pass: false,
  failureKind: 'format_protocol',
  failureCode: 'format_protocol.no_json',
  reasoningOs: {
    route,
    criteriaVector: formatFail,
    updateTarget: target,
  },
};

const proposed = proposeDeltaFromAttempt({
  problemName: 'binary-search',
  baselineKind: 'reasoning_os_v0',
  attempt: failedAttempt,
});

assert.equal(proposed.trigger.component, 'structured_output_contract');
assert.equal(proposed.status, 'proposed');
assert.ok(proposed.hypothesis.includes('format'));
```

**Step 2: Implement simple deterministic proposal**

Rules:

- `formatProtocol` → structured output contract hypothesis.
- `interfaceContract` → signature contract hypothesis.
- `correctness` → algorithmic strategy scaffold hypothesis.
- `repairability` → repair-loop policy hypothesis.
- Pass attempts return `null`.

Do not modify prompts yet.

**Step 3: Verify pass**

Run:

```bash
node test-reasoning-os.js
node test-delta-log.js
```

Expected: PASS.

---

## Task 10: Add CLI flags for OS dry-run/status

**Objective:** Let the parent agent inspect the OS route and proposed update targets without burning model calls.

**Files:**

- Modify: `index.js`
- Add: optional `test-index-os-dry-run.js` if CLI test pattern is simple.

**CLI design:**

```bash
node index.js --os-route binary-search
node index.js --run reasoning_os_v0
node index.js --status
node index.js --compare
```

**Step 1: Implement `--os-route` no-model path**

In `index.js`, before `--run`, parse:

```js
const routeIdx = args.indexOf('--os-route');
if (routeIdx >= 0) {
  const problemName = args[routeIdx + 1];
  console.log(JSON.stringify(routeTask({ problemName, baselineKind: 'reasoning_os_v0' }), null, 2));
  process.exit(0);
}
```

**Step 2: Verify route works**

Run:

```bash
node index.js --os-route binary-search
```

Expected: prints JSON route with `mode: code_generation` and required checks.

**Step 3: Verify status/compare still work**

Run:

```bash
node index.js --status
node index.js --compare
```

Expected: both commands succeed; `reasoning_os_v0` may show no run.

---

## Task 11: Add Reasoning OS report artifact

**Objective:** Document how to interpret OS v0 results and prevent overclaiming.

**Files:**

- Create: `REASONING-OS-V0-REPORT.md`

**Content requirements:**

- State that v0 initially instruments gen18-like behavior; it does not yet prove prompt/scaffold superiority.
- List metrics:
  - pass@1
  - pass@N
  - failure-kind counts
  - criterion-vector counts
  - component-target counts
  - proposed delta count
  - accepted delta count, when implemented
- Define claim gates:
  - **Instrumentation claim:** OS metadata is logged and valid.
  - **Diagnosis claim:** failure criteria map to stable components.
  - **Capability claim:** `reasoning_os_v0` beats frozen baseline on held-out pass@1 with enough N/CI to matter.
- Explicit COH_ATR warning: coherent OS internals do not count as improvement.

**Verification:**

Read the report and check it contains all claim gates.

---

## Task 12: Final local verification bundle

**Objective:** Ensure the plan's implementation is locally stable before any model-burning eval run.

**Files:**

- No new files unless bug fixes are needed.

**Commands:**

Run:

```bash
node test-reasoning-os.js
node test-delta-log.js
node test-trace-log.js
node test-failure-metrics.js
node test-result-schema.js
node test-basic-runner.js
node test-ts-to-py.js
node test-spec-validator.js
node test-heldout-plan.js
node index.js --os-route binary-search
node index.js --status
node index.js --compare
```

Expected: all tests/commands pass.

Do **not** run `node index.js --run reasoning_os_v0` until Mitch approves burning model calls.

---

## Subagent Handoff Plan

Use bounded lanes, not one giant coding agent.

### Lane A — OS primitives

Tasks: 1–4.

Route: `delegate_task` with `terminal,file`.

Risk: local edit.

Verification:

```bash
node test-reasoning-os.js
```

Stop conditions:

- Need to change `eval.js`.
- Need model calls.
- Need large refactor.

### Lane B — Delta log + trace metadata

Tasks: 5–6.

Route: `delegate_task` with `terminal,file`.

Verification:

```bash
node test-delta-log.js
node test-trace-log.js
```

Stop conditions:

- Trace-log API requires broad rewrite.
- Any raw model output would be stored unbounded.

### Lane C — Baseline integration, no model calls

Tasks: 7–10.

Route: `delegate_task` with `terminal,file`.

Verification:

```bash
node test-reasoning-os.js
node test-trace-log.js
node test-result-schema.js
node test-basic-runner.js
node index.js --os-route binary-search
node index.js --status
node index.js --compare
```

Stop conditions:

- Would run `node index.js --run ...`.
- Existing old baselines would be relabeled or mutated.

### Lane D — Report + final review

Tasks: 11–12.

Route: `delegate_task` for report draft, then parent verifies.

Verification:

- Read `REASONING-OS-V0-REPORT.md`.
- Run full local verification bundle.
- Parent reviews git diff.

---

## Human Approval Gate

Before any live model/eval spend, ask Mitch to approve one of:

1. **No model run yet:** finish instrumentation only.
2. **Tiny smoke:** one problem × `reasoning_os_v0`.
3. **N4 run:** four held-out default problems × `reasoning_os_v0`.
4. **Full expansion:** only after smoke/N4 is sane.

Default for implementation handoff: **No model run yet.**

---

## Definition of Done for Planning Phase

- This plan exists in the repo as `REASONING-OS-V0-PLAN.md`.
- Subagent lanes are bounded and explicit.
- No code has been changed except this plan.
- No model calls have been made.
- Next step is implementation dispatch with parent verification after each lane.
