# Reasoning OS v0 — Measurement + Delta Acceptance Protocol

## Purpose

Turn Reasoning OS from an explanatory wrapper into a measurable capability-improvement loop.

Current allowed claims:

- instrumentation: OS metadata is generated, validated, and logged;
- diagnosis: at least one failure was traced to an updateable component and fixed locally.

Not yet allowed:

- broad capability improvement claims.

Capability claims require frozen baselines, repeated measurement, and held-out improvement under comparable budget.

## Current Architecture Constraint

`reasoning_os_v0` currently reuses `gen18_evolved` internally and attaches OS metadata.

Therefore, any observed improvement must come from one of:

1. a concrete scaffold/component delta,
2. an evaluator/protocol-contract delta,
3. a repair-loop delta,
4. a selection/routing delta that changes behavior under fixed budget.

A prettier OS trace is not a capability gain.

## Primary Metric

Primary metric for v0 capability work:

- `pass@1`

Secondary metrics:

- `pass@N`
- failure-kind counts
- failure-criterion counts
- update-target/component counts
- timeout rate
- repair success rate after first failure
- trace metadata completeness

## Frozen Comparison Shape

For any candidate delta, compare:

- baseline A: previous frozen behavior
- baseline B: behavior with exactly one candidate delta applied

Minimum conditions:

- same problem set,
- same model,
- same max attempts / retry budget,
- same timeout budget,
- same evaluation harness except for the candidate delta,
- same randomization policy where applicable,
- no extra human repair during the measured run.

## Candidate Delta Lifecycle

Statuses:

1. `proposed`
   - Triggered by a failed attempt and stored in `delta-logs/reasoning-os-v0.jsonl`.
   - Must include trigger, criterion, component, hypothesis, patch target, and expected effect.

2. `validated_local`
   - No-model tests prove the patch addresses the mechanical failure or preserves invariants.
   - Example: replaying original failed binary-search output through the new extractor.

3. `validated_scoped`
   - A scoped live eval on the triggering problem succeeds under the same budget.
   - This is still not broad improvement.

4. `accepted`
   - k-replicate held-out comparison supports the expected effect without material regression.

5. `rejected`
   - Delta fails local/scoped/held-out checks, causes regression, or lacks discriminative target.

6. `superseded`
   - A later delta replaces it.

## Acceptance Criteria

A delta may be accepted only if all are true:

- It names one updateable component, not a broad "make prompt better" bucket.
- It has a pre-registered expected effect.
- No-model tests pass.
- Trace metadata remains complete.
- Held-out or at least non-triggering-problem guard set does not regress materially.
- k-replicate comparison shows directional improvement on the primary metric or a justified secondary metric.

For small N, report uncertainty plainly instead of claiming significance.

## Recommended k-Replicate Protocol

Suggested first validation batch after Mitch approval:

- model: same low-cost model used in smoke/N4 unless Mitch changes it;
- problems:
  - binary-search
  - climbing-stairs
  - container-with-most-water
  - coin-change-ii
- repetitions: `k = 5` minimum for smoke-level signal, `k = 10+` for stronger evidence;
- metric: pass@1 per problem and aggregate;
- guard: track pass@N and timeouts so first-attempt gains do not hide instability.

Do not start this batch without explicit approval because it uses live model calls.

## RCR Loop 2 Candidate

Observed after RCR loop 1:

- `container-with-most-water` had attempt 0 failure: `timeout.execution_timeout`
- attempt 1 recovered, so pass@N remained true.

Candidate investigation path:

1. Inspect temp trace for the timeout.
2. Determine whether timeout is:
   - model latency/noise,
   - generated algorithmic inefficiency,
   - test runner timeout too strict,
   - extraction contamination,
   - repair-loop policy issue.
3. If generated code is O(n²), target `algorithmic_strategy_scaffold`.
4. If model call itself timed out, target `repair_loop_policy` or infra timeout classification.
5. If extracted code is malformed/contaminated, target `structured_output_contract`.

No delta should be accepted from the label alone.

## No-Model Checks Before Any Live Eval

Run these before approval request for live validation:

```bash
node test-code-extract.js
node test-basic-runner.js
node test-reasoning-os.js
node test-delta-log.js
node test-trace-log.js
node test-failure-metrics.js
node test-result-schema.js
node test-heldout-plan.js
```

If any fail, fix locally before spending model calls.

## Approval Request Template

Use this when asking Mitch to approve live validation:

```text
Approve live k-replicate validation?

Scope:
- baseline: reasoning_os_v0 with current extraction delta
- model: <model>
- problems: <list>
- repetitions: k=<n>
- estimated calls: up to <n * problems * maxAttempts>
- primary metric: pass@1
- guard metrics: pass@N, timeout rate, failure-kind distribution

No secrets / no OpenClaw / local eval only.
```

## Current Delta 1 Status

Delta:

- id: `delta-02a0f167-d12a-4bdc-93c2-4f2cae44f796`
- component: `structured_output_contract`
- patch: first fenced block preference + leading import preservation in `code-extract.js`

Current evidence:

- local tests: pass
- original binary-search failed output replay: pass
- scoped binary-search live check: pass@1 true
- N4 temp guard: pass@1 3/4, pass@N 4/4

Recommended status:

- `validated_scoped`

Current log status:

- updated to `validated_scoped` using append-only `updateDeltaStatus(...)`
- evidence record references local tests, replay check, scoped binary-search live check, N4 guard, and `REASONING-OS-V0-RCR-LOOP-1.md`

Not yet:

- `accepted`

Reason:

- needs k-replicate held-out comparison.

## RCR Loop 2 Status

Candidate:

- problem: `container-with-most-water`
- failure: `timeout.execution_timeout`
- trace: `/tmp/reasoning-os-rcr-n4/container-with-most-water-reasoning_os_v0.jsonl`
- report: `REASONING-OS-V0-RCR-LOOP-2.md`

Trace-derived finding:

- attempt 0 failed at `stageFailed: coder_error`
- `errorDetail: coder failed: 25000ms limit`
- no generated solution reached test execution before timeout
- attempt 1 passed after retry/backoff

Interpretation:

- likely transient provider/model latency in coder stage
- not evidence of algorithmic inefficiency, extraction contamination, or verifier/autorepair failure
- update target remains `repair_loop_policy`, but current retry policy recovered

Recommended action:

- do not patch from this single event
- monitor coder-stage timeout rate during k-replicate validation
- only propose a repair-loop delta if repeated timeouts materially depress pass@1 or pass@N
