# Reasoning OS v0 — k=5 Validation Run

## Scope

Approved live validation batch for Reasoning OS v0 after the first RCR delta.

- baseline: `reasoning_os_v0`
- model argument: `kimi-k2.5:cloud`
- stage routing in harness: `minimax-m2.7:cloud` for shaper/coder/verifier
- repetitions: `k = 5`
- problems:
  - `binary-search`
  - `climbing-stairs`
  - `container-with-most-water`
  - `coin-change-ii`
- primary metric: `pass@1`
- guard metrics: `pass@N`, timeout attempts, failure-kind distribution
- trace dir: `validation-runs/reasoning-os-v0-k5-2026-05-22T22-52-13-695Z/traces`
- summary JSON: `validation-runs/reasoning-os-v0-k5-2026-05-22T22-52-13-695Z/summary.json`

## Preflight

No-model checks passed before the live run:

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

## Results

Aggregate:

- pass@1: `16/20` = 80.0%; Wilson 95% CI `[58.4%, 91.9%]`
- pass@N: `19/20` = 95.0%; Wilson 95% CI `[76.4%, 99.1%]`
- timeout attempts: `0`

By problem:

- `binary-search`: pass@1 `4/5`; pass@N `5/5`; timeout attempts `0`
- `climbing-stairs`: pass@1 `2/5`; pass@N `4/5`; timeout attempts `0`
- `container-with-most-water`: pass@1 `5/5`; pass@N `5/5`; timeout attempts `0`
- `coin-change-ii`: pass@1 `5/5`; pass@N `5/5`; timeout attempts `0`

Failure codes:

- `spec_validation.name_mismatch`: `5`
- `logic_assertion.autorepair_exhausted`: `1`
- `format_protocol.missing_code`: `1`

Failure stages:

- `spec_validation`: `5`
- `autorepair_exhausted`: `1`
- `coder_error`: `1`

## Interpretation

This run supports a modest stability claim for the current Reasoning OS v0 harness state, not a broad capability-improvement claim.

Allowed claims:

- Current Reasoning OS v0 completed a 20-row k-replicate live validation batch.
- `pass@1` was 16/20 and `pass@N` was 19/20.
- The previous container timeout did not reproduce in this run: timeout attempts were 0.
- The dominant remaining failure surface is `climbing-stairs` function-name/spec adherence.

Not yet allowed:

- Do not claim the extraction delta is broadly accepted as a capability gain yet, because this run measured the patched/current behavior only. A true acceptance comparison still needs frozen previous behavior vs current behavior under matched conditions.

## Trace Spot-Check

A no-model trace spot-check confirmed the `climbing-stairs` name-mismatch failures are mostly protocol/signature adherence issues:

- generated `def climbStairs(...)` when expected `def climb(n)`
- one generated `def test_climb()` wrapper instead of solution function
- one separate `autorepair_exhausted` row used the correct `def climb(...)`, so not every climbing-stairs failure is the same bug

## RCR Implications

### RCR Loop 2: container timeout

The earlier `container-with-most-water` coder-stage timeout looks transient under this batch:

- current run: `container-with-most-water` pass@1 `5/5`, pass@N `5/5`
- timeout attempts: `0`

Decision: keep no-patch decision. Do not create a repair-loop delta from the previous singleton timeout.

### Candidate RCR Loop 3: climbing-stairs name mismatch

`climbing-stairs` produced 5 `spec_validation.name_mismatch` failures across the k=5 batch. Common signature mismatch:

- expected: `climb(n)`
- generated: `climbStairs(...)` or test wrapper names

Candidate update target:

- `structured_output_contract` / `signature_adherence_contract`

Candidate hypothesis:

- Add a stronger coder-stage function-name contract and/or local post-extraction signature correction gate for known reference signature names.

Expected effect:

- Improve `climbing-stairs` pass@1 and pass@N without degrading the other three problems.

Recommended next step:

1. Inspect `climbing-stairs` traces from this validation run.
2. Confirm whether failures are pure naming/protocol issues vs logic failures.
3. If pure naming, create Delta 2 with TDD replay tests against captured raw outputs.
4. Validate locally, then scoped live on `climbing-stairs`, then guard with the same four-problem set.

## Delta 1 Status Recommendation

Keep Delta 1 as `validated_scoped` for now.

Rationale:

- The k=5 run shows patched/current behavior is stable enough to continue.
- But acceptance requires a matched previous-vs-current comparison or a stronger preregistered comparison design.
- The binary-search first-attempt result was `4/5`, so the extraction delta did not make binary-search perfectly deterministic; one run had `format_protocol.missing_code` at coder stage but recovered at pass@N.
