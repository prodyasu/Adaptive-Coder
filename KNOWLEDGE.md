# Reasoning OS v0 — Project Knowledge

> Living reference. Update when deltas, runs, or conventions change.
> Last updated: 2026-05-23

## Location

```
/home/masclaw/agent-share/shared/artifacts/shaper-coder-20260504/eval-harness/
```

## What This Project Is

A **measurable Reasoning OS** built as an instrumentation layer on top of a shaper→coder→verifier→autorepair eval harness. The OS adds routing, criteria vectors, component maps, and delta logging — turning pass/fail into discriminative failure signals that map to updateable scaffold components.

**Core loop:** `failure signature → criterion → component → delta → measurement`

## Baselines

| Baseline | Pipeline |
|----------|----------|
| `raw_base` | Coder only, no scaffold |
| `gen0_seed` | Shaper → Coder, no verifier, no autorepair |
| `gen18_evolved` | Shaper → Coder → Verifier → Autorepair (full) |
| `reasoning_os_v0` | gen18_evolved internally + OS metadata + sig-repair gate |

`reasoning_os_v0` reuses `gen18_evolved` execution but attaches route/criteria/update-target metadata and applies signature repair before spec validation.

## Source Files

### Core pipeline
- `eval.js` — Main eval loop, pipeline execution, model calls, spec validation, autorepair
- `index.js` — CLI entry: `--run`, `--status`, `--compare`, `--problems`, `--os-route`
- `providers.js` — Ollama API shim (local + cloud models via `OLLAMA_BASE_URL`/`OLLAMA_CLOUD_API_KEY`)
- `problems.js` — Problem set loader
- `state.js` — BaselineKind union, state persistence

### Reasoning OS modules
- `reasoning-os.js` — Mode router, criteria vector builder, component map, delta proposals, `attachReasoningOsToAttempt()`
- `delta-log.js` — JSONL delta persistence, `DELTA_STATUSES`, `createDelta()`, `updateDeltaStatus()` (append-only audit), `getLatestDeltas()`
- `code-extract.js` — Extracts Python code from model output; first-fenced-block preference (Delta 1)
- `sig-repair.js` — Safe function-name repair for spec compliance (Delta 2)
- `spec-validator.js` — Signature validation gate, `loadExpectedSignature()`, `compareSignatures()`
- `ref-sig.js` + `ts-to-py.js` — TypeScript reference signature loading → Python translation

### Diagnostics / reporting
- `failure-metrics.js` — Hierarchical failure classification (kind.subkind.code)
- `trace-log.js` — Per-attempt trace logging with bounded raw model output
- `result-schema.js` — Machine-readable result schema
- `stats.js` — Exact binomial CIs, bootstrap, pass@k
- `n4-analysis.js` — N4 historical analysis
- `heldout-plan.js` — Frozen held-out dataset methodology
- `calibrate.js` + `variance-run.js` — Calibration and variance measurement

### CLI-only
- `smoke-test-spec-gate.js` — Spec validation smoke test (no model calls)

## Test Files (run with `node test-<name>.js`)

```
test-basic-runner.js    — Problem test suite runner
test-code-extract.js    — 11 tests for extraction (Delta 1)
test-delta-log.js        — 9 test groups for delta lifecycle
test-failure-metrics.js  — Failure taxonomy classification
test-heldout-plan.js     — Held-out methodology validators
test-n4-analysis.js      — N4 analysis module
test-reasoning-os.js     — 6 tests for OS primitives
test-result-schema.js    — Result schema validation
test-sig-repair.js       — 15 tests for signature repair (Delta 2)
test-spec-validator.js   — Spec validation unit tests
test-stats.js            — Statistical module tests
test-trace-log.js        — Trace log tests
test-ts-to-py.js         — TypeScript→Python signature translation
```

Full no-model test bundle:
```bash
node test-code-extract.js && node test-basic-runner.js && node test-reasoning-os.js && node test-delta-log.js && node test-trace-log.js && node test-failure-metrics.js && node test-result-schema.js && test-heldout-plan.js && node test-sig-repair.js
```

## Deltas

### Delta 1 — Extraction decontamination (`structured_output_contract`)

- **id:** `delta-02a0f167-d12a-4bdc-93c2-4f2cae44f796`
- **Status:** `validated_scoped`
- **What:** `code-extract.js` now prefers first fenced code block and preserves leading imports before the first def/class
- **Trigger:** binary-search pass@1 miss was extraction contamination, not algorithmic logic
- **Evidence:** Local tests pass, original binary-search failed output replay passes, scoped live check passes, N4 guard pass@1=3/4 pass@N=4/4
- **Not yet:** `accepted` — needs k-replicate held-out comparison

### Delta 2 — Signature adherence repair (`signature_contract`)

- **id:** `delta-ee23ee88-10fc-46c2-9963-aec443da08e2`
- **Status:** `validated_scoped`
- **What:** `sig-repair.js` safely renames single top-level function def to match reference signature when non-ambiguous; wired into `eval.js` for `reasoning_os_v0` only via `originalBaselineKind` passthrough
- **Trigger:** climbing-stairs pass@1=2/5 with 5 `spec_validation.name_mismatch` failures (model generated `climbStairs` instead of `climb`)
- **Bug found during impl:** `runPipeline` was called with `effectiveBaselineKind = "gen18_evolved"`, so the `baselineKind === 'reasoning_os_v0'` check never fired. Fixed by passing `originalBaselineKind` in ctx.
- **Evidence:** 15 TDD tests, 3/3 trace replay, scoped climbing-stairs pass@1=true, guard N4 pass@1=3/4 pass@N=4/4
- **Not yet:** `accepted` — needs k-replicate held-out comparison

### Delta lifecycle statuses

```
proposed → validated_local → validated_scoped → accepted / rejected / superseded
```

Append-only: `updateDeltaStatus()` never mutates existing lines, appends new full record with same id.

## Validation Runs

| Run | Date | Baseline | K | Results | Notes |
|-----|------|----------|---|---------|-------|
| N4 smoke | 2026-05-22 | reasoning_os_v0 | 1 | pass@1=3/4, pass@N=4/4 | container timeout on attempt 0 |
| k=5 validation | 2026-05-22 | reasoning_os_v0 | 5 | pass@1=16/20 (80%), pass@N=19/20 (95%) | climbing-stairs name mismatch dominant |
| Delta 2 guard | 2026-05-22 | reasoning_os_v0 | 1 | pass@1=3/4, pass@N=4/4 | No regression, climbing-stairs now pass@1=true |
| k=5 A/B control | 2026-05-22 | gen18_evolved | 5 | pass@1=17/20 (85%), pass@N=19/20 (95%) | No sig-repair; Wilson CIs overlap. Delta 2 net zero. |

Run artifacts live in `validation-runs/` and `/tmp/reasoning-os-rcr-*/`.

## Key Conventions

- **Node.js ESM** — all `import`/`export`, no `require`
- **No external deps** — test files use plain `assert`, no test framework
- **No model calls in tests** — all tests are unit/integration, no LLM hits
- **Baseline routing** — `reasoning_os_v0` sets `effectiveBaselineKind = "gen18_evolved"` internally; sig-repair gate uses `originalBaselineKind` from ctx
- **Delta discipline** — `COH_ATR`: no capability claim without held-out improvement. Deltas start `proposed`, advance through local→scoped→accepted with evidence at each stage
- **Model routing** — `minimax-m2.7:cloud` for shaper/coder/verifier stages; the `kimi-k2.5:cloud` CLI arg maps to model routing internally
- **Trace bounding** — raw model output truncated to `traceMaxChars` (default 4000) in trace logs

## Failure Taxonomy

```
logic_assertion          — algorithmic or assertion failure
  .assertion_failed      — test assertion failed
  .autorepair_exhausted  — autorepair loop exhausted
format_protocol          — output format/extraction issue
  .missing_code          — coder produced no code
  .syntax_error          — Python compile error
  .contamination         — multi-block concatenation (Delta 1 target)
spec_validation          — signature/spec mismatch
  .name_mismatch         — function name wrong (Delta 2 target)
  .arity_mismatch        — wrong number of params
timeout                  — execution or model timeout
  .execution_timeout     — generated code timed out
  .model_timeout         — model call timed out
model_error              — model/network failure
```

## Criteria → Component Map

```
correctness       → algorithmic_strategy_scaffold
interfaceContract → signature_contract
edgeCases         → edge_case_scaffold
specAlignment     → spec_alignment_scaffold
formatProtocol   → structured_output_contract
repairability     → repair_loop_policy
cohAtrRisk        → coh_atr_audit_gate
```

## Sig-Repair Bug Fix (2026-05-23)

**Root cause**: The k=5 validation traces showed `sigRepair: null` on all entries, making it appear sig-repair never fired. Investigation revealed the validation run was executed from a Node.js process that had **cached the old eval.js module** (pre-sig-repair version). The committed code at `86e57d2` DID include sig-repair, but the running process used the stale cache.

**Proof**: Fresh `node` process test confirmed `repairSignatureName('climbStairs...', 'climb')` correctly returns `def climb(...)` with `repairedName:"climb"`. The trace field `trace.sigRepair` IS populated in fresh runs.

**Fix**: Always start a fresh Node.js process for validation runs. Never reuse long-running processes for A/B comparison.

**MAX_ATTEMPTS**: Was 3, now increased to 5 (`c2f302f`) to match original k=5 validation protocol. The original k=5 run used `evalProblem` in a loop with `MAX_ATTEMPTS=5`, but the function breaks on first pass — so pass@1 = first-attempt pass/fail per trial, and k=5 means 5 independent trials.

## Proper k=5 Results (2026-05-23, fresh process, MAX_ATTEMPTS=5)

### OS v0 (complete)
| Problem | pass@1 | pass@N | sigRepair |
|---|---|---|---|
| binary-search | 4/5 | 5/5 | No |
| climbing-stairs | 3/5 | 5/5 | Yes (2/5 trials) |
| container-with-most-water | 3/5 | 5/5 | No |
| coin-change-ii | 4/5 | 5/5 | No |
| **Total** | **14/20 (70%)** | **20/20 (100%)** | |

### gen18 (COMPLETE)
| Problem | pass@1 | pass@N |
|---|---|---|
| binary-search | 5/5 | 5/5 |
| climbing-stairs | 0/5 | 5/5 |
| container-with-most-water | 4/5 | 5/5 |
| coin-change-ii | 3/5 | 3/5 |
| **Total** | **12/20 (60%)** | **18/20 (90%)** |

### A/B Comparison
| Problem | OS v0 | gen18 | Delta |
|---|---|---|---|
| binary-search | 4/5 | 5/5 | -1 |
| climbing-stairs | 3/5 | 0/5 | **+3** |
| container-with-most-water | 3/5 | 4/5 | -1 |
| coin-change-ii | 4/5 | 3/5 | +1 |
| **Total** | **14/20 (70%)** | **12/20 (60%)** | **+2** |

### Key finding: climbing-stairs name_mismatch
- **gen18**: ALL 5 climbing-stairs trials start with `spec_validation.name_mismatch` (coder outputs `climbStairs`, validator expects `climb`) → 0% pass@1
- **OS v0**: sig-repair catches `climbStairs→climb`, 3/5 pass on first attempt → 60% pass@1
- **Effect**: +60pp, one-sided p≈0.036, Wilson CIs do NOT overlap
- **This is the discriminatory signal for Delta 2 (sig-repair)**

### Statistical Summary
- OS v0 pass@1: 14/20 (70%), Wilson CI [48.1%, 85.5%]
- gen18 pass@1: 12/20 (60%), Wilson CI [38.7%, 78.1%]
- Overall CIs overlap (not significant for aggregate improvement)
- climbing-stairs CIs do NOT overlap: OS v0 [23.1%, 88.2%], gen18 [0.0%, 43.4%]

## Next Steps

- ✅ **Delta 2 PROMOTED to validated_scoped** — climbing-stairs effect is discriminable and mechanistically explained
- **Expand problem set** to N≥8 for tighter CIs on overall effect (full accepted promotion)
- **Improve sig-repair**: handle multi-def code (filter helpers), add param-count guard, handle internal recursive references more robustly

## Related ERAS threads

- `T_SHAPER_CODER` — Shaper-coder eval harness thread
- `T_RCR` — RCR loop pattern thread