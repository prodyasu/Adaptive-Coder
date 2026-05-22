# Reasoning OS v0 Report

## Status

Reasoning OS v0 is implemented as an instrumentation/control-plane layer around the existing Shaper-Coder eval harness.

This is **not yet a capability claim**. v0 currently proves that we can:

- route a coding-eval task into a structured OS state,
- attach a criteria vector to attempts,
- map failures to scaffold components,
- preserve OS metadata in trace logs,
- propose scaffold deltas as auditable records,
- expose a no-model dry-run route via CLI.

The first live model smoke run is allowed only after local tests pass.

## What v0 Adds

### 1. Mode route

`routeTask(...)` emits a deterministic route:

- mode: `code_generation`
- reasoning style: `spec_first`
- risk: `local_eval`
- required checks:
  - `signature_contract`
  - `edge_cases`
  - `runtime_tests`
  - `structured_output_contract`
- uncertainty policy: `tool_before_claim`

### 2. Criteria vector

Each attempt can carry a vector over:

- correctness
- interface contract
- edge cases
- spec alignment
- format/protocol
- repairability
- COH_ATR risk

Failure kinds map to criteria, e.g.:

- `logic_assertion` → `correctness`
- `format_protocol` → `formatProtocol`
- `spec_validation` → `interfaceContract`
- `timeout` / `model_error` → `repairability`

### 3. Criteria → component mapping

Each failed criterion maps to an actionable scaffold component:

- correctness → `algorithmic_strategy_scaffold`
- interfaceContract → `signature_contract`
- edgeCases → `edge_case_scaffold`
- specAlignment → `spec_alignment_scaffold`
- formatProtocol → `structured_output_contract`
- repairability → `repair_loop_policy`
- cohAtrRisk → `coh_atr_audit_gate`

This is the RCR discriminativity requirement: failures must point to updateable structure, not just generate critique prose.

### 4. Delta log

`delta-log.js` provides JSONL persistence for scaffold-delta proposals:

- `createDelta`
- `validateDelta`
- `appendDelta`
- `readDeltas`

Deltas are proposed/accepted/rejected artifacts. v0 does **not** auto-apply them.

### 5. CLI dry run

```bash
node index.js --os-route binary-search
```

Prints the route JSON and exits without model calls.

## Baseline Semantics

`reasoning_os_v0` is a new baseline kind.

Current v0 execution intentionally reuses `gen18_evolved` behavior internally, then attaches Reasoning OS metadata to attempts/traces. This means:

- It is fair for instrumentation testing.
- It is **not yet evidence** that the OS improves code generation.
- Future versions must introduce actual scaffold/component updates and then compare held-out results.

Old baselines remain semantically unchanged:

- `raw_base`
- `gen0_seed`
- `gen18_evolved`

## Metrics to Track

Minimum metrics:

- pass@1
- pass@N
- failure-kind counts
- criterion-vector failure counts
- component-target counts
- proposed delta count
- accepted/rejected delta count, when acceptance is implemented
- trace metadata completeness

## Claim Gates

### Gate 1 — Instrumentation Claim

Allowed claim:

> Reasoning OS metadata is generated, validated, and logged.

Evidence required:

- local tests pass
- `--os-route` works without model calls
- trace rows preserve `reasoningOs`

### Gate 2 — Diagnosis Claim

Allowed claim:

> Failures map to stable criteria and updateable scaffold components.

Evidence required:

- multiple failed attempts with non-null `failureCriterion`
- update targets correspond to expected failure kinds
- no broad “fix prompt” bucket swallowing everything

### Gate 3 — Capability Claim

Allowed claim:

> Reasoning OS improves AI capability on this task domain.

Evidence required:

- frozen held-out set
- same model budget and comparable pipeline semantics
- `reasoning_os_v0` beats selected baseline on pass@1 or a pre-registered primary metric
- uncertainty intervals/statistical caveats reported
- change/delta logs show predictive, not merely explanatory, updates

## COH_ATR Warning

A coherent OS architecture does not count as improvement.

Reasoning OS can easily become a beautiful wrapper that explains failures more elegantly while leaving task performance unchanged. The core safety rule is:

> No held-out improvement, no capability claim.

## Suggested Next Steps

1. Run one tiny smoke eval:

```bash
node index.js --run reasoning_os_v0 --problems binary-search
```

If the CLI does not support `--problems`, use the smallest safe equivalent or temporarily inspect/adjust before running. Do not run the full N4 set until the smoke confirms traces contain `reasoningOs` metadata.

2. Inspect the trace log for the smoke problem and verify:

- baseline label is `reasoning_os_v0`
- route is present
- criteriaVector is present
- updateTarget is present

3. Only then consider N4.

## Current Interpretation

v0 is an **OS instrumentation milestone**, not the finished reasoning OS.

The useful next capability move is to close the RCR loop:

failure signature → criterion → component → proposed delta → accepted patch → held-out result.
