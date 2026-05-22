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
| k=5 validation | 2026-05-22 | reasoning_os_v0 | 5 | pass@1=16/20 (80%), pass@N=19/20 (95%) | container timeout did not reproduce; climbing-stairs name mismatch dominant |
| Delta 2 guard | 2026-05-22 | reasoning_os_v0 | 1 | pass@1=3/4, pass@N=4/4 | No regression, climbing-stairs now pass@1=true |

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

## Next Steps

- **k-replicate held-out comparison** needed to advance Deltas 1 and 2 from `validated_scoped` to `accepted`
- **coin-change-ii** had a `format_protocol.missing_code` on one k=5 rep (coder produced no code); monitor rate during next validation
- **Expand problem set** beyond N4 for stronger statistical signal
- **Frozen baseline comparison**: run gen18_evolved baseline on same k=5 design to get a direct A/B comparison

## Related ERAS threads

- `T_SHAPER_CODER` — Shaper-coder eval harness thread
- `T_RCR` — RCR loop pattern thread