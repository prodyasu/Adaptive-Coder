# Phase 2A Failure Taxonomy Report

## Goal

Expand the harness from a flat five-kind failure classifier into a hierarchical taxonomy without breaking existing aggregate metrics.

The stable parent kinds remain:

- `logic_assertion`
- `format_protocol`
- `timeout`
- `spec_validation`
- `model_error`

Phase 2A adds per-attempt sub-kind detail using stable dotted codes like:

- `format_protocol.missing_json`
- `format_protocol.syntax_error`
- `spec_validation.parameter_order`
- `logic_assertion.boundary_condition`
- `timeout.rate_limit`
- `model_error.http_error`

## TDD sequence

### RED

Added tests first in `test-failure-metrics.js` for missing exports and expected hierarchical behavior:

- `classifyFailureDetail(...)`
- `summarizeFailureTaxonomy(...)`
- `formatFailureTaxonomySummary(...)`

Expected RED output:

```text
SyntaxError: The requested module './failure-metrics.js' does not provide an export named 'classifyFailureDetail'
```

Added trace-log tests in `test-trace-log.js` for persisted taxonomy fields:

- `failureSubKind`
- `failureCode`

Expected RED output:

```text
Error: FAIL: failureSubKind is recorded
```

### GREEN

Implemented the minimal support needed to satisfy those tests:

- `failure-metrics.js`
  - added `FAILURE_SUBKIND_LABELS`
  - added `classifyFailureDetail(attempt)`
  - added `summarizeFailureTaxonomy(attempts)`
  - added `summarizeStateFailureTaxonomy(state)`
  - added `formatFailureTaxonomySummary(summary)`
  - preserved `classifyFailureKind(...)` and `summarizeFailureKinds(...)` compatibility

- `trace-log.js`
  - persists optional `failureSubKind`
  - persists optional `failureCode`

- `eval.js`
  - uses `classifyFailureDetail(...)` when recording attempts and trace logs
  - stores `failureKind`, `failureSubKind`, and `failureCode` on new attempt records

- `state.js`
  - added `AttemptFailureCode`
  - added optional `failureSubKind` and `failureCode` fields to `AttemptResult`

## Behavior notes

- Parent kind totals are intentionally backward-compatible.
- Existing code that only reads `failureKind` still sees the five stable parent kinds.
- New code can inspect `failureCode` for detailed diagnosis.
- Explicit dotted codes are normalized back to their parent when using `classifyFailureKind(...)`.
- Unknown/ambiguous failures still fall back conservatively to existing broad buckets.

## Verification run so far

```bash
node test-failure-metrics.js && node test-trace-log.js && node test-basic-runner.js
```

Output:

```text
✅ classifyFailureKind covers pass/timeout/model/spec/protocol/logic cases
✅ classifyFailureDetail assigns hierarchical failure sub-kinds
✅ summarizeFailureKinds counts failures without dropping passes
✅ formatFailureKindSummary renders stable labels
✅ summarizeFailureTaxonomy preserves parent totals and sub-kind detail

🎉 failure-metrics tests passed.
🎉 trace-log tests passed.
✅ coin-change-ii good passes
✅ coin-change-ii bad fails
✅ min-stack good passes
✅ min-stack bad fails
✅ unsupported problem fails closed

🎉 runBasicTest tests passed.
```

Full-suite verification:

```bash
set -euo pipefail
for test in test-*.js; do
  echo "--- $test"
  node "$test"
done
```

Result: all 8 `test-*.js` files passed:

- `test-basic-runner.js`
- `test-failure-metrics.js`
- `test-n4-analysis.js`
- `test-result-schema.js`
- `test-spec-validator.js`
- `test-stats.js`
- `test-trace-log.js`
- `test-ts-to-py.js`
