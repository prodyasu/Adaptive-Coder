# Phase 2C Held-Out Dataset Plan Report

## Goal

Create the next concrete artifact after Phase 2B/2A: an expanded held-out dataset plan with explicit category balance, contamination controls, freeze rules, and preregistered predictions — without running any model evals.

This phase is planning/freeze infrastructure only. It does **not** create the final held-out problem set and does **not** call models.

## Why this matters

The N=4 report already warned that quick expansion from the on-disk `testcases/` directory was an illusion: some remaining candidates were co-listed with training material. A real expansion therefore needs a separate held-out construction protocol before any benchmark run.

## Subagent use

Two subagents handled token-heavy design review:

1. **Dataset taxonomy draft**
   - Proposed categories, difficulty buckets, N target, and preregistered claims.
   - Noted that the existing disk corpus must be excluded from new held-out sourcing.

2. **Contamination/manifest review**
   - Proposed manifest fields and invariants inspired by lm-eval-style decontamination.
   - Emphasized exact content hashes, n-gram overlap, solution-code overlap, non-empty provenance, and frozen-state rules.

I merged those proposals, corrected one arithmetic issue in the draft balance table, then had a review subagent check the implementation. That review found two non-blocking validator laxities (`minimumN=0` and two documented contamination checks not being enforced); I added regression tests for both and fixed them before commit.

## Delivered files

- `heldout-plan.js`
  - `HELDOUT_PLAN_SCHEMA_VERSION = 'heldout-plan/v1'`
  - `buildRecommendedHeldOutPlan(...)`
  - `computePlanHash(...)`
  - `validateHeldOutPlan(...)`
  - `formatHeldOutPlanErrors(...)`

- `test-heldout-plan.js`
  - TDD coverage for target N, category/difficulty balance, contamination controls, freeze rules, preregistered predictions, and stale-hash rejection.

- `HELDOUT-DATASET-PLAN.json`
  - Machine-readable plan artifact.
  - Current plan hash:
    `sha256:1c0b37c273583800ac2026fcc7ef0dd5fd5b62e8b3440d44dadd36201e97fde1`

## Plan summary

- Target N: 36
- Minimum N: 24
- Categories: 6 problem-structure buckets
- Difficulty buckets:
  - Easy: 8
  - Medium: 18
  - Hard: 10
- Existing `testcases/` problems are excluded from expanded held-out construction.
- Incomplete disk dirs are tracked separately and not silently included:
  - `coin-change`
  - `regular-expression-matching`
  - `serialize-binary-tree`

## Required contamination controls

The plan requires at least:

- `exact_content_hash`
- `ngram_overlap`
- `solution_code_overlap`
- `source_date_before_freeze`
- `reviewer_not_freezer`

Training/source exclusions must be non-empty. Current plan lists:

- `current-shaper-training-set`
- `existing-testcases-corpus`
- `N4-heldout-results`

## Freeze rules

The plan records these freeze requirements:

- Compute a SHA-256 hash over the sorted final problem-list hashes.
- Treat any task/reference/test edit after freeze as a new dataset version.
- Tag the freeze commit before any model eval.
- Require pipeline alignment between manifest and result artifacts.

## Preregistered predictions

The plan stores five preregistered claims:

- `P1`: `gen18_evolved` pass@1 exceeds `raw_base`.
- `P2`: `gen18_evolved` exceeds `gen0_seed`, but by less than the N=4 apparent 50-point gap.
- `P3`: the gen18 advantage is larger on medium+hard than easy.
- `P4`: `gen0_seed` improves pass@N recovery more than pass@1.
- `P5`: failures cluster in `logic_assertion`, `spec_validation`, and `format_protocol`; `model_error` remains low.

## TDD record

### RED

```bash
node test-heldout-plan.js
```

Expected failure:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module './heldout-plan.js'
```

### GREEN

Implemented `heldout-plan.js`, then reran:

```bash
node test-heldout-plan.js
```

Result:

```text
🎉 heldout-plan tests passed.
```

Full-suite verification after adding this phase:

```bash
set -euo pipefail
for test in test-*.js; do
  echo "--- $test"
  node "$test"
done
```

Result: all 9 `test-*.js` files passed, including new `test-heldout-plan.js`.

## Important boundary

This is not approval to run expanded evals. The approval gate remains hard:

- construct/freeze final problem set first
- validate manifest + hashes
- ask Mitch before any model eval run
