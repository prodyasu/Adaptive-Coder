# Reasoning OS v0 N4 Run — 2026-05-22

## Command

```bash
node index.js --run reasoning_os_v0 --problems binary-search climbing-stairs container-with-most-water coin-change-ii
```

## Result

- Model: `kimi-k2.5:cloud`
- Run ID: `ae34b1d7-d78b-42b5-b55f-e8b7c8c52d42`
- State file: `state.jsonl`
- Trace files: `run-logs/*-reasoning_os_v0.jsonl`

## Summary

- `reasoning_os_v0`: pass@1 `3/4`, pass@N `4/4`

Per problem:

- `binary-search`: pass@1 `✗`, pass@N `✓`, attempts `2`, first failure `logic_assertion.assertion_failed`, update target `algorithmic_strategy_scaffold`
- `climbing-stairs`: pass@1 `✓`, pass@N `✓`, attempts `1`
- `container-with-most-water`: pass@1 `✓`, pass@N `✓`, attempts `1`
- `coin-change-ii`: pass@1 `✓`, pass@N `✓`, attempts `1`, autorepair cycles `1`

## Comparison against existing N4 state

Existing state comparison after run:

- `raw_base`: pass@1 `4/4`, pass@N `4/4`
- `gen0_seed`: pass@1 `3/4`, pass@N `4/4`
- `gen18_evolved`: pass@1 `2/4`, pass@N `4/4`
- `reasoning_os_v0`: pass@1 `3/4`, pass@N `4/4`

Failure-kind summary:

- `raw_base`: pass `4`, logic/assertion `0`, format/protocol `0`, timeout `0`, spec_validation `0`, model_error `0`
- `gen0_seed`: pass `4`, logic/assertion `1`, format/protocol `0`, timeout `1`, spec_validation `0`, model_error `0`
- `gen18_evolved`: pass `4`, logic/assertion `0`, format/protocol `2`, timeout `0`, spec_validation `0`, model_error `0`
- `reasoning_os_v0`: pass `4`, logic/assertion `1`, format/protocol `0`, timeout `0`, spec_validation `0`, model_error `0`

## Reasoning OS metadata check

Latest `state.jsonl` entry for `reasoning_os_v0` confirms every attempt has `reasoningOs` metadata.

The only failed attempt:

```json
{
  "problem": "binary-search",
  "attempt": 0,
  "failureCode": "logic_assertion.assertion_failed",
  "updateTarget": {
    "actionable": true,
    "criterion": "correctness",
    "component": "algorithmic_strategy_scaffold",
    "failureKind": "logic_assertion",
    "failureCode": "logic_assertion.assertion_failed"
  }
}
```

## Interpretation

This is still **not a capability-improvement claim**.

Reasoning OS v0 currently executes the `gen18_evolved` pipeline internally and adds instrumentation. The N4 result shows:

- The instrumentation survives a full N4 run.
- Failure signals map to actionable OS/scaffold components.
- Current `reasoning_os_v0` pass@1 equals `gen0_seed` and beats prior `gen18_evolved` state on this run snapshot, but does not beat `raw_base`.

The meaningful next RCR step is to apply the binary-search failure signal to a concrete `algorithmic_strategy_scaffold` delta, then test whether it improves future held-out performance without harming other problems.
