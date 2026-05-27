# Reasoning OS v0 — Project Knowledge

> Living reference. Update when deltas, runs, or conventions change.
> Last updated: 2026-05-27

## Location

```
/home/masclaw/agent-share/shared/artifacts/shaper-coder-20260504/eval-harness/
```

## What This Project Is

A **measurable adaptive coding harness** built around shaper→coder→verifier→autorepair experiments. The original "Reasoning OS v0" metadata layer was falsified by best-of-5 (K0), and static PGG assertion injection was killed in Phase 1. The project now treats best-of-N as the mandatory baseline and focuses on dynamic, failure-conditioned interventions that can beat retry at comparable cost.

**Core loop:** `failure signature → criterion → component → delta → measurement`

## Current Status (2026-05-27)

- **K0 best-of-5 kill test:** gen18 best-of-5 dominates OS v0 single-shot; simple retry is the mandatory baseline.
- **PGG Phase 1:** static Predicate-Gated Generation is killed. PGG-5 = 10/20 pass@1 (50%) vs best-of-5 = 19/20 (95%); PGG-1 = 1/4 (25%) vs single-shot = 3/4 (75%). PGG fired (46 resamples in Arm C) but hurt via timeout/spec overhead.
- **Next direction:** do not tune static PGG. Either build a dynamic Diagnostician→targeted constraint compiler loop that only acts after observed failures, or pivot benchmark domains where semantic constraints can plausibly beat retry.

## Baselines

| Baseline | Pipeline |
|----------|----------|
| `raw_base` | Coder only, no scaffold |
| `gen0_seed` | Shaper → Coder, no verifier, no autorepair |
| `gen18_evolved` | Shaper → Coder → Verifier → Autorepair (full) |
| `reasoning_os_v0` | gen18_evolved internally + OS metadata + sig-repair gate |

`reasoning_os_v0` reuses `gen18_evolved` execution but attaches route/criteria/update-target metadata and applies signature repair before spec validation.

## Problem Set (N=8)

| # | ID | Pattern | Python Signature |
|---|---|---|---|
| 1 | binary-search | binary search | `def search(nums: List[int], target: int) -> int:` |
| 2 | climbing-stairs | DP (fibonacci variant) | `def climb(n: int) -> int:` |
| 3 | container-with-most-water | two-pointers | `def maxArea(h: List[int]) -> int:` |
| 4 | coin-change-ii | DP (unbounded knapsack) | `def change(amount: int, coins: List[int]) -> int:` |
| 5 | two-sum | hash-map | `def twoSum(nums: List[int], target: int) -> Tuple[int, int]:` |
| 6 | valid-palindrome | two-pointers (string) | `def isPalindrome(s: str) -> bool:` |
| 7 | number-of-islands | DFS/BFS graph traversal | `def numIslands(grid: List[List[str]]) -> int:` |
| 8 | invert-binary-tree | tree recursion | `def invertTree(root: Optional[TreeNode]) -> Optional[TreeNode]:` |

Problems 1-4 are the original set; 5-8 added 2026-05-23 for N≥8 statistical power.

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
- `constraint-ordering.js` — Constraint ordering, deduplication, and contradiction detection for shaper specs (Delta 3)
- `decomposition-delta.js` — Multi-step decomposition: task graph creation, DAG validation, cycle detection, orphan detection, delta generation (Delta 3 — reasoning-improving)
- `informed-repair.js` — Delta 4: Feedback-aware autorepair (VERIFIER/TEST_FAILURE/SPEC_AND_TEST modes)
- `invariant-constrained-generation.js` — Delta 6: Invariant-Constrained Generation (ICG) — derives structural invariants from Shaper spec, injects into Coder prompt
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
test-decomposition.js    — 24 tests for multi-step decomposition delta (Delta 3)
test-failure-metrics.js  — Failure taxonomy classification
test-heldout-plan.js     — Held-out methodology validators
test-n4-analysis.js      — N4 analysis module
test-reasoning-os.js     — 6 tests for OS primitives
test-result-schema.js    — Result schema validation
test-sig-repair.js       — 15 tests for signature repair (Delta 2)
test-constraint-ordering.js — 41 tests for constraint ordering (Delta 3)
test-spec-validator.js   — Spec validation unit tests
test-stats.js            — Statistical module tests
test-trace-log.js        — Trace log tests
test-ts-to-py.js         — TypeScript→Python signature translation
```

Full no-model test bundle:
```bash
node test-code-extract.js && node test-basic-runner.js && node test-reasoning-os.js && node test-delta-log.js && node test-trace-log.js && node test-failure-metrics.js && node test-result-schema.js && node test-heldout-plan.js && node test-sig-repair.js && node test-constraint-ordering.js && node test-decomposition.js
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

### Delta 3 — Constraint ordering for reasoning flow (`spec_alignment_scaffold`)

- **id:** `delta-constraint-ordering-v3`
- **Status:** `proposed`
- **What:** `constraint-ordering.js` reorder, deduplicate, and detect contradictions in shaper spec constraints before passing to coder. Signature/interface constraints prioritized first, style last, negative constraints colocated near their positive counterpart. Near-duplicates removed (Jaccard>0.7). Contradictions flagged in acceptance_criteria.
- **Trigger:** LLM coders attend more strongly to early constraints. Shaper output has arbitrary constraint order, near-duplicates, and sometimes contradictions, diluting attention on critical signature/interface constraints.
- **Target criterion:** `specAlignment` → `spec_alignment_scaffold`
- **Wiring in `eval.js`:** After shaper spec parsing (line ~464), applied only for `reasoning_os_v0` baseline. Trace includes `constraintOrdering` field with rationale, contradiction count, and duplicates removed count.
- **Evidence:** 41 unit tests in `test-constraint-ordering.js` (classifyConstraint, deduplicate, contradiction detection, full pipeline, spec integration, trace quality)
- **Not yet:** `validated_local` — needs live eval with model calls to measure improvement in pass@1

### Delta 4 — Multi-step decomposition (`algorithmic_strategy_scaffold`)

- **Status:** `proposed` (tests passing, not yet wired into eval pipeline)
- **What:** `decomposition-delta.js` breaks complex problems into structured task graphs (DAGs) with analysis→planning→implementation→verification sub-tasks, parent-child dependencies, and topological ordering. Three decomposition strategies: design pipeline (linear), planning fork (parallel-then-merge), and analysis refinement (iterative feedback loop).
- **Trigger:** Current deltas are error-correction only; decomposition enables reasoning-improving deltas that restructure problem solving rather than patching extraction/signature failures
- **Evidence:** 24 TDD tests covering sub-task creation, graph creation, cycle detection, self-dependency rejection, unknown-dep rejection, duplicate-ID rejection, orphaned-node detection, topological order verification, all 3 strategies produce valid DAGs, delta-log integration, and end-to-end create→validate→store→read pipeline
- **Not yet:** `validated_local` — needs wired integration into `eval.js` pipeline and measured impact on pass@k

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
|| N=8 k=5 OS v0 (R2) | 2026-05-23 | reasoning_os_v0 | 5 | 28/40 (70.0%) | Code-extract fix applied; 0 sigRepairs |
|| N=8 k=5 gen18 (R2) | 2026-05-23 | gen18_evolved | 5 | 29/40 (72.5%) | A/B control; CIs overlap |

## Replication R2 A/B Comparison (2026-05-23, code-extract fix)

| Problem | OS v0 | gen18 | Delta |
|---|---|---|---|
| binary-search | 4/5 (80%) | 5/5 (100%) | -20% |
| climbing-stairs | 2/5 (40%) | 2/5 (40%) | 0% |
| coin-change-ii | 0/5 (0%) | 2/5 (40%) | -40% |
| container-with-most-water | 5/5 (100%) | 4/5 (80%) | +20% |
| two-sum | 4/5 (80%) | 4/5 (80%) | 0% |
| valid-palindrome | 4/5 (80%) | 4/5 (80%) | 0% |
| number-of-islands | 5/5 (100%) | 3/5 (60%) | **+40%** |
| invert-binary-tree | 4/5 (80%) | 5/5 (100%) | -20% |
| **Aggregate** | **28/40 (70.0%)** | **29/40 (72.5%)** | **-2.5%** |

Wilson 95% CI: OS v0 [54.6%, 81.9%], Gen18 [57.2%, 83.9%] — **CIs overlap**.

### Key findings from R2 replication

1. **Sig-repair NEVER FIRED** in this run (0/40 trials). Model generated correct function names throughout. Delta 2's climbing-stairs advantage (name_mismatch repair) is stochastic and depends on the model generating wrong names, which varies between runs.

2. **coin-change-ii collapsed to 0%** in OS v0, down from 60% in R1. Pervasive execution timeouts. Same model, same pipeline — confirms high model variance at k=5.

3. **Aggregate OS v0 is NOT significantly different from gen18** at N=8 k=5. The 2.5pp gap is within noise for this sample size.

4. **Per-problem variation is large**: number-of-islands favors OS v0 by +40pp, coin-change-ii favors gen18 by +40pp. These are likely model variance, not real effects.

5. **Code-extract fix helped**: binary-search went from 60%→80% (R1→R2 for OS v0), container 60%→100%. Confirms pytest contamination was real.

6. **Run-to-run instability**: coin-change-ii flipped from 60%→0% (OS v0) and 80%→40% (gen18) between R1 and R2. Single-problem k=5 measurements have ~±20-30pp noise.

### Delta 2 promotion assessment

**Delta 2 (sig-repair) CANNOT be promoted to accepted** based on R2 data:
- The per-problem statistical signal (climbing-stairs +60pp, p≈0.036) was based on R1 data where name_mismatch occurred 5/5 times in gen18
- In R2, name_mismatch occurred 0/40 times across both baselines — sig-repair was never triggered
- The effect is **stochastic and model-dependent**, not a reliable improvement
- Delta 2 remains `validated_scoped` — it works when the model generates wrong names, but the model doesn't always do that
- **Reframed**: sig-repair should be tested as a **deterministic capability test** (engineer induced naming drift) rather than a stochastic efficacy test. See t_f37d5ae7.

## DV Reframing (2026-05-23, Claude brainstorm)

**pass@k is the wrong primary DV at N≈40.** Detecting ~5pp on a binary outcome needs hundreds of trials. Switch primary DV to **per-trial continuous metrics**: held-out pass-rate delta, self-correction count, graded criterion scores. Keep pass@k as secondary confirmatory only.

**PERM_GRAD explains the null result:** The OS layer is a post-hoc annotation overlay; the trained generation attractor sits underneath unchanged. An overlay that annotates output post-hoc cannot move the shape. **Interventions must act at generation time or rewrite the artifact, never just annotate it.** This is why sig-repair was the only thing that moved pass@k — it rewrites code before scoring.

**Priority tiers (Claude brainstorm):**
1. **Tier 1 (parallel):** #3 held-out discriminativity + #1 graded vectors (infra)
2. **Tier 2:** #5 RCR closure (only after Tier 1 gives real signals)
3. **Tier 3:** #2 rule tagging + #4 self-correction rate → cheap passive loggers

**Bridge from instrumentation → improvement:** Allow a second generation pass conditioned on held-out failure (#3's signal). RCR enacted, not measured. Acts at generation time (satisfies PERM_GRAD). Delta signal from real measured phenomenon, not stochastic trigger.

Run artifacts live in `validation-runs/` and `/tmp/reasoning-os-rcr-*/`.

## Harness Bugs Fixed (2026-05-23)

1. **task.txt fallback missing** — `eval.js` line 231 only checked `shaper-autorepair/testcases/` for task.txt, not `testcases-expansion/`. Expansion problems (valid-palindrome, number-of-islands, invert-binary-tree) had task.txt only in `testcases-expansion/`, causing ENOENT crashes. **Fix:** Added `existsSync` fallback to `testcases-expansion/`.

2. **testSuites incomplete** — The `testSuites` object in `eval.js` only had entries for 5 problems (climbing-stairs, binary-search, container-with-most-water, coin-change-ii, min-stack). The 4 expansion problems (two-sum, valid-palindrome, number-of-islands, invert-binary-tree) all scored 0% with `format_protocol.missing_test_suite` because no test assertions existed. **Fix:** Added test suites for all 4 expansion problems.

These were **not model failures** — two-sum and invert-binary-tree had verifier-passing code that was never executed-tested.

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

## Progress Toward "Reasoning OS" Goal

**Honest assessment: ~15-20% of the vision (up from 10-15%).**

The vision was a constraint-selection OS that decides what to attend to, in what order, with what priority — recursive, self-improving, measurable. What we have:

| Layer | Envisioned | Built | Status |
|---|---|---|---|
| Eval harness | Frozen baselines, A/B comparison, CI discipline | ✅ Fully built | Works well |
| Shaper→Coder→Verifier pipeline | Role-separated architecture | ✅ Built | All minimax-m2.7 |
| Delta 1: Extraction decontamination | Better code extraction | ✅ validated_scoped | Narrow fix |
| Delta 2: Name repair | Fix signature mismatches | ✅ validated_scoped | +60pp on 1 problem |
| Delta 3+: Constraint ordering | Which constraints matter most | ✅ proposed (41 tests, wired into eval.js) | — |
| Delta 4+: Multi-step reasoning | Decomposition, verification loops | ❌ Not started | — |
| N≥8 expansion | Statistical power for CIs | ✅ Done | 8 problems, k=5 |
| Graded criteria vectors | Discriminative failure signals | ✅ Implemented | Continuous 0-1 per criterion |
| Rule tagging in deltas | RULE_PRIM testable predictions | 📋 Planned (Kanban t_4d12a620) | ERAS: RULE_PRIM |
| Held-out discriminativity | COH_ATR contamination detection | ✅ Implemented (all 8 suites CLEAN) | `calculateCohAtrRisk()` with <0.6 guard |
| Self-correction rate | Continuous COH_ATR risk signal | ✅ Implemented | Passive logger, wired into eval |
| RCR closure conditions | 3-gate delta promotion | 📋 Planned (Kanban t_ff43561c) | ERAS: T_RCR |
| Meta-reasoning / RCR | System improving its own constraints | ❌ Blocked on above | — |

**What's solid**: The eval methodology — frozen baselines, A/B comparison, Wilson CIs, discriminative failure signals, delta promotion with guard discipline. This is genuinely useful infrastructure.

**What's oversold**: Calling it a "Reasoning OS" implies general constraint-selection architecture. The current deltas are error-correction, not reasoning. The ERAS-driven improvements (graded vectors, rule tagging, COH_ATR checks, RCR closure) will close this gap.

**What's next (priority order)**:
1. ✅ ~~Expand problem set to N≥8~~ → Done (8 problems, k=5)
2. Delta 1 & 2 acceptance — **Delta 2 (sig-repair) capability PROVEN** ✅ (see R3 Capability Results below). Delta 1 acceptance pending.
3. ✅ Delta 2 capability arm passes: drift→detect→repair→validate cycle closes with 100% repair correctness and 85% pass@1 recovery
4. Held-out discriminativity — cohAtrRisk still 0% (benchmark too easy for both baselines)
5. Remaining: harder held-out suites, stronger interventions, RCR closure (Gate 3)

## ERAS-Driven Improvement Plan (2026-05-23)

Five concrete improvements grounded in ERAS findings:

1. **✅ IMPLEMENTED: Graded criteria vectors** — `buildGradedCriteriaVector()` in `reasoning-os.js`. Replaces binary `{0,1}` per criterion with continuous 0-1 scores. Uses `primaryPassRate` for `correctness`, `heldOutPassRate` for `edgeCases`, `cohAtrRisk` from held-out discriminativity, `interfaceContract` 0.5 on sig-repair, `repairability` 0.5 on autorepair-exhausted. Falls back to binary `buildCriteriaVector()` when held-out data unavailable.

2. **Rule tagging in deltas** (RULE_PRIM) — Pending. Each delta tags which installed behavior rule it targets.

3. **✅ IMPLEMENTED: Held-out discriminativity** — `held-out-test-suites.js` + `calculateCohAtrRisk()`. 8 problems have held-out suites (3-6 tests each). `runBasicTest()` now returns `primaryPassRate`, `heldOutPassRate`, `cohAtrRisk` alongside binary `pass`. Validates COH_ATR contamination: hardcoded binary-search passes primary 100% but held-out 50% → `cohAtrRisk = 0.5`. Difficulty-calibrated (same difficulty as primary, not harder).

4. **✅ IMPLEMENTED: Trace self-correction rate** (COH_ATR) — `self-correction-logger.js`. Passive read-only logger: `attachSelfCorrectionToTrace()` per-attempt, `computeSelfCorrectionMetrics()` per-batch. Counts mid-generation corrections (entered autorepair, self-corrected, exhausted). Wired into `eval.js` at all 3 trace recording sites.

5. **RCR closure conditions** (T_RCR) — Pending. Tier 2 after Tier 1 gives real signals.

### Implementation Details (2026-05-23)

**New files:**
- `held-out-test-suites.js` — 8 held-out test suites, `runHeldOutTests()`, `calculateCohAtrRisk()`
- `test-held-out.js` — 251 assertions for held-out module
- `test-held-out-eval-integration.js` — 16 integration tests (good/brittle/wrong/no-heldout)
- `test-graded-criteria.js` — 26 assertions for graded criteria vector
- `run-os-v0-n8-heldout.mjs` — N=8 k=5 run script with held-out reporting

**Modified files:**
- `eval.js` — `runBasicTest()` extended with held-out testing, 3 trace propagation sites, sig-repair drift integration
- `reasoning-os.js` — `buildGradedCriteriaVector()` added, `attachReasoningOsToAttempt()` accepts trace data

**Additional module:**
- `induced-drift.js` — `DRIFT_NAME_MAP`, `applyDrift()`, `getDriftName()`, `isDriftEnabled()`. Remaps expected function names to non-idiomatic names (e.g. `search`→`compute_result`), forcing guaranteed name mismatches for deterministic sig-repair capability testing. Enabled via `opts.inducedDrift=true`.
- `test-induced-drift.js` — 42 assertions for drift module

**Test status:** All 16+ test files pass (360+ total assertions)

## R3 Preparation (2026-05-23)

### Claude's decision: NO-GO until reference calibration runs

**Blocker resolved:** Reference solutions run against all 8 held-out suites → **all 8 CLEAN at 100%**. No confounds detected. Any model drop is real COH_ATR signal.

**Two-experiment design (per Claude):**
- **Efficacy arm:** OS v0 (no drift) vs gen18, both with held-out metrics. Continuous DVs. `run-r3-efficacy.mjs`
- **Capability arm:** OS v0 + drift, reported ONLY as trigger-fired/repair-success/post-repair-held-out. `run-r3-capability.mjs`. No comparison with efficacy arm.

**Pre-R3 code fixes:**
1. ✅ Held-out suite import bug fixed (climbing-stairs: `climbing_stairs_1` → `climbing_stairs`)
2. ✅ Confounded test replaced (coin-change-ii: duplicate-coins → two-ways-exact-match)
3. ✅ cohAtrRisk NaN guard: `primaryPassRate = 0` or `< 0.6` → NaN (undefined), prevents poison
4. ✅ Self-correction logger: passive, read-only, wired into eval.js at 3 trace sites
5. ✅ Expansion problems added back to `testSuites` (lost in git checkout)
6. ✅ `calibrate-heldout.mjs` — one-pass reference calibration script

**Files added this session:**
- `self-correction-logger.js` — `attachSelfCorrectionToTrace()`, `computeSelfCorrectionMetrics()`
- `test-self-correction-logger.js` — 30 assertions
- `calibrate-heldout.mjs` — reference calibration pass
- `run-r3-efficacy.mjs` — R3 efficacy arm script
- `run-r3-capability.mjs` — R3 capability arm script

## R3 Capability Arm Results (2026-05-24)

### Bug 1: sig-repair semantic (FIXED)
Sig-repair was propagating the drift name instead of restoring the original. Repair = restore, not propagate. Fix: when `isDriftEnabled(ctx)`, use `expectedSig.originalName` as the repair target instead of `expectedSig.name`.

### Bug 2: test design gap (FIXED)
Induced drift only patched the post-hoc validation signature, not the coder's input prompt. Model generated the correct name because the shaper spec told it to — drift never reached generation. Fix: `buildCoderPrompt(problemName, driftName)` injects the drifted function name into the `{{SIGNATURE}}` template so the model generates the drifted name.

### R3 Capability v2 Results (after both fixes)

| Metric | Before fixes | After fixes |
|--------|-------------|-------------|
| Drift trigger | 40/40 (100%) | 41/40 attempts (100%) |
| Repair fired | 2/40 (5%)* | 41/41 (100%) |
| Repair correctness | 0/2 (0%) | 41/41 (100%) |
| Pass@1 | 0/40 (0%) | 34/40 (85%) |

*Pre-fix triggers were organic name mismatches, not drift-induced.

Per-problem results (v2):
| Problem | Pass@1 | Drift | Repair | Example repair |
|---------|--------|-------|--------|---------------|
| binary-search | 4/5 (80%) | 5 | 5 | compute_result→search |
| climbing-stairs | 5/5 (100%) | 5 | 5 | calculate_ways→climb |
| container-with-most-water | 5/5 (100%) | 5 | 5 | find_max_area→maxArea |
| coin-change-ii | 4/5 (80%) | 5 | 5 | count_combinations→change |
| two-sum | 4/5 (80%) | 5 | 5 | find_indices→twoSum |
| valid-palindrome | 4/5 (80%) | 5 | 5 | check_palindrome→isPalindrome |
| number-of-islands | 4/5 (80%) | 6 | 6 | count_islands→numIslands |
| invert-binary-tree | 4/5 (80%) | 5 | 5 | flip_tree→invertTree |

**The 6 failures (15%) are organic model errors (logic bugs, timeouts), not drift-induced — the same problems that fail without drift.**

### RCR Capability Loop — PROVEN ✅

The full cycle closes: `drift → detect → repair → validate`

```
DRIFT (injected into coder prompt)
  → DETECT (sig-repair sees name mismatch)
  → REPAIR (rename to original spec name)
  → VALIDATE (spec validator confirms match)
  → PASS (85% pass@1 recovery)
```

### Remaining gaps
1. **Efficacy**: OS v0 metadata layer adds no measurable improvement over gen18 (R3 efficacy: 82.5% vs 87.5%, NS)
2. **Discriminativity**: cohAtrRisk = 0% everywhere (benchmark too easy)
3. **Self-correction**: Never fires (model either solves on attempt 0 or exhausts budget)
4. **RCR closure (Gate 3)**: Capability is proven, but efficacy is not — the OS layer doesn't improve through its own reasoning

## Delta 4: Informed Repair (2026-05-24)

**Motivation**: PERM_GRAD explains the null efficacy result — post-hoc annotation cannot move outcomes. Current autorepair feeds vague verifier suggestions ("doesn't handle edge cases") which are the same quality of information the model already had. The code *ran* and *failed* — we know exactly what went wrong but throw that signal away.

**Design principle**: Interventions must act at generation time or rewrite the artifact. Informed repair closes the loop: run the code, capture the actual failure (test name, expected vs got, error type), feed that concrete failure signal back into the coder prompt.

**Three modes (A/B/C test)**:
- **VERIFIER** (control): Current behavior — verifier suggestions only. "Your solution doesn't satisfy the spec."
- **TEST_FAILURE** (Delta 4a): Concrete test case failure. "Your code returned [0,1] but expected [1,2] on assert twoSum([3,2,4], 6)"
- **SPEC_AND_TEST** (Delta 4b): Dual signal — spec guidance + concrete test failure

**Implementation**:
- `informed-repair.js`: `extractTestFailure()`, `buildInformedRepairFeedback()`, `INFORMED_REPAIR_MODES`
- Wired into `eval.js` autorepair loop via `ctx.autorepairFeedbackMode`
- Trace fields: `informedRepairFeedback`, `informedRepairMode`
- `run-r4-informed-repair.mjs`: 3-mode A/B/C test (N=8, k=5)

**Key files**:
- `informed-repair.js` — Delta 4 module (36 test assertions)
test-informed-repair.js    — 36 tests for informed repair (Delta 4)
test-r4-metrics.js          — 78 assertions for R4 metrics
test-graded-criteria.js     — 26 assertions for graded criteria vector
test-invariant-constrained-generation.js — 43 tests for ICG (Delta 6)
- `run-r4-informed-repair.mjs` — R4 efficacy arm runner
- `eval.js` — Modified: imports informed-repair, threads `autorepairFeedbackMode` through ctx

**Hypothesis**: TEST_FAILURE and SPEC_AND_TEST should outperform VERIFIER because they provide concrete failure signal (acts at generation time, satisfies PERM_GRAD) rather than vague suggestions.

**If proven**: This closes efficacy Gate 3 — the OS layer would measurably improve over baseline through its own reasoning (detecting failure → generating targeted feedback → retrying with knowledge of what went wrong).

## Delta 6: Invariant-Constrained Generation (ICG) (2026-05-25)

**Motivation**: PERM_GRAD explains that interventions must act at generation time. Delta 4 (informed repair) acts at retry time (post-failure). ICG goes further: it acts BEFORE code is written. After the Shaper produces a spec, an invariant extraction step derives structural invariants (loop invariants, boundary conditions, type constraints, correctness conditions) from the spec. These invariants are injected into the Coder prompt as explicit constraints.

Pipeline change: `Shaper → Planner/Invariants → Coder(with invariants) → [Verifier] → [Autorepair]`

**Opt-in**: Behind `icgEnabled` flag in `opts`/`ctx`. No existing baselines are modified. When `icgEnabled=false` (default), the pipeline is identical to current behavior.

**Invariant types** (matches criteria/component taxonomy where possible):
- `loop_invariant` — loop progress, narrowing conditions, state accumulation
- `boundary_condition` — base cases, edge inputs (empty, zero, None)
- `type_constraint` — input/output type requirements from spec
- `correctness_condition` — "should return X when Y" specifications
- `state_invariant` — monotonicity, visited-set properties
- `edge_case_guard` — "handle empty/null/negative" from constraints
- `complexity_bound` — time/space complexity from constraints

**Deduplication**: Near-duplicate invariants (Jaccard > 0.7 token overlap) within the same type are removed. Different types are preserved even with overlapping descriptions.

**Problem-specific invariants**: Known problems (binary-search, climbing-stairs, etc.) get additional invariants from problem pattern matching — e.g., binary search gets "result is index or -1" and "search range always narrows."

**Confidence levels**: `HIGH` (directly from spec text), `MEDIUM` (inferred from constraints), `LOW` (plausible but not specifiable). Invariants sorted by confidence in Coder prompt.

**Implementation**:
- `invariant-constrained-generation.js`: Core module
  - `INVARIANT_TYPES`, `INVARIANT_CONFIDENCE`, `ICG_SYSTEM_PROMPT`
  - `extractInvariants(spec, problemName)` — deterministic, no model calls
  - `formatInvariantsForCoder(invariants)` — groups by confidence, adds section delimiters
  - `buildICGCoderPrompt(problemName, invariants, driftName)` — full system prompt with invariants
  - `applyInvariantConstrainedGeneration(spec, problemName, opts)` — main entry point, returns `{invariants, invariantSection, icgPrompt, trace}`
- Wired into `eval.js` between Shaper spec parsing and Coder call
  - Import added
  - After spec parsing: if `ctx.icgEnabled`, call `applyInvariantConstrainedGeneration`
  - Coder system prompt: `buildCoderPrompt(problemName, driftName) + (icgInvariantSection || '')`
  - Trace field: `trace.icg` propagated to attempt record
  - `opts.icgEnabled` threaded through `evalProblem()` → `ctx`
- `test-invariant-constrained-generation.js` — 43 no-model unit tests (all passing)
- `run-r6-icg.mjs` — R6 A/B test runner

**Key design decisions**:
1. Invariant section appended to standard Coder prompt (not replacing it) — minimal change to model context
2. Deterministic extraction from spec text (no model calls) — reproducible, debuggable
3. Problem-specific invariants are `MEDIUM` confidence (pattern-matched, not from spec text directly)
4. Opt-in `icgEnabled` flag — existing baselines untouched

**Hypothesis**: ICG should improve pass@1 on problems where the Shaper spec contains sufficient invariant-derivable information, because invariants constrain the solution space before generation. This is a pre-generation intervention (satisfies PERM_GRAD).

**Primary DV**: pass@1 delta on stress suite. **Secondary**: held-out/cohAtrRisk and failure-class shifts.

## Related ERAS threads

- `T_SHAPER_CODER` — Shaper-coder eval harness thread
- `T_RCR` — RCR loop pattern thread