# Phase 1 Statistics Pass — Shaper-Coder Eval Harness

**Date:** 2026-05-21  
**Scope:** bounded statistics-only pass over the existing N=4 held-out results. No new model evals were run.

## What changed

Added `stats.js` with small-N eval statistics helpers:

- `passRate(values)` — boolean / 0-1 pass rate with input validation.
- `exactBinomialCI(successes, n, confidence)` — Clopper-Pearson exact binomial CI.
- `bootstrapCI(values, options)` — percentile bootstrap CI with seedable RNG for reproducible reports.
- `passAtK({ n, c, k })` — Codex-style unbiased pass@k estimator.
- `exactPermutationTest(a, b, options)` — exact unpaired binary permutation test.
- `exactMcNemarTest(a, b, options)` — exact paired McNemar/sign test for same-problem N=4 comparisons.
- `summarizeBinaryRun(label, values, options)` — combines counts, rate, exact CI, and bootstrap CI.

Added `n4-analysis.js` as a reproducible analysis helper/CLI that parses `N4-RESULTS.md`, computes stats from the tables, and can write `N4-STATS-REPRODUCIBLE.md`.

Added `test-stats.js` with focused tests for:

- Pass-rate validation and boolean / numeric input handling.
- N=4 Clopper-Pearson reference values for 0/4, 2/4, and 4/4.
- Seeded bootstrap reproducibility.
- pass@k behavior at k=1, k=2, and the all-covered case.
- Exact small-N unpaired permutation comparison.
- Exact paired McNemar/sign comparison for same held-out problems.
- Summary output shape and interval attachment.

The existing trace/failureKind tests were inspected and already passed; no fix was needed there.

## Commands run

```bash
# Existing suite before changes
node --version && for f in test-*.js; do node "$f" || true; done

# RED: focused new stats test before stats.js existed
node test-stats.js
# Expected failure: ERR_MODULE_NOT_FOUND for ./stats.js

# GREEN: after implementing stats.js
node test-stats.js

# RED for paired comparison addition
node test-stats.js
# Expected failure: stats.js did not export exactMcNemarTest

# GREEN after exactMcNemarTest
node test-stats.js

# Re-analysis of existing N4-RESULTS.md data only
node n4-analysis.js N4-RESULTS.md N4-STATS-REPRODUCIBLE.md

# Final full suite verification
set -e
for f in test-*.js; do
  echo "=== $f ==="
  node "$f"
done
```

## Test results

Initial existing tests all passed before stats work:

- `test-basic-runner.js`: 5/5 passed
- `test-failure-metrics.js`: 3/3 passed
- `test-spec-validator.js`: 9/9 passed
- `test-trace-log.js`: passed
- `test-ts-to-py.js`: 10/10 and 5/5 passed

New focused stats/analysis tests:

- `node test-stats.js` → `🎉 stats tests passed.`
- `node test-n4-analysis.js` → `🎉 n4-analysis tests passed.`

## Re-analysis of existing N=4 results

Data source: `N4-RESULTS.md` only.

### Pass@1

- `raw_base`: 2/4 = 0.500
  - Exact 95% CI: [0.0676, 0.9324]
  - Bootstrap 95% CI: [0.0000, 1.0000]
  - pass@2 estimator: 0.833
- `gen0_seed`: 2/4 = 0.500
  - Exact 95% CI: [0.0676, 0.9324]
  - Bootstrap 95% CI: [0.0000, 1.0000]
  - pass@2 estimator: 0.833
- `gen18_evolved`: 4/4 = 1.000
  - Exact 95% CI: [0.3976, 1.0000]
  - Bootstrap 95% CI: [1.0000, 1.0000]
  - pass@2 estimator: 1.000

Paired same-problem exact tests, alternative = later pipeline is better:

- `raw_base → gen18_evolved`: +2 discordant wins, p = 0.2500
- `gen0_seed → gen18_evolved`: +2 discordant wins, p = 0.2500

Unpaired exact permutation p-values for those same 2/4 vs 4/4 comparisons are p = 0.2143, but the paired McNemar/sign result is the better primary test because all pipelines were evaluated on the same four problems.

### Pass@N

- `raw_base`: 2/4 = 0.500
  - Exact 95% CI: [0.0676, 0.9324]
  - Bootstrap 95% CI: [0.0000, 1.0000]
  - pass@2 estimator: 0.833
- `gen0_seed`: 4/4 = 1.000
  - Exact 95% CI: [0.3976, 1.0000]
  - Bootstrap 95% CI: [1.0000, 1.0000]
  - pass@2 estimator: 1.000
- `gen18_evolved`: 4/4 = 1.000
  - Exact 95% CI: [0.3976, 1.0000]
  - Bootstrap 95% CI: [1.0000, 1.0000]
  - pass@2 estimator: 1.000

Paired exact tests, alternative = later pipeline is better:

- `raw_base → gen0_seed`: +2 discordant wins, p = 0.2500
- `raw_base → gen18_evolved`: +2 discordant wins, p = 0.2500
- `gen0_seed → gen18_evolved`: 0 discordant wins, p = 1.0000

## Statistical interpretation

The N=4 result is directionally interesting but not statistically decisive.

What the data supports:

- `gen18_evolved` has a real observed Pass@1 lift in this sample: 4/4 versus 2/4 for both `raw_base` and `gen0_seed`.
- The lift is concentrated on the two harder problems where the baselines failed first attempt.
- `gen0_seed` shows retry / any-attempt recovery versus `raw_base`: Pass@N moves from 2/4 to 4/4.
- `gen18_evolved` and `gen0_seed` are identical on Pass@N in this sample, consistent with the note that autorepair did not fire for gen18.

What the data does **not** support yet:

- It does not justify a strong generalization claim. Exact CIs are extremely wide at N=4: even 4/4 has a lower 95% bound of only ~0.398.
- It does not show conventional statistical significance. The paired exact p-value for 2/4 → 4/4 with two discordant improvements is p = 0.25 one-sided.
- It does not isolate autorepair value. Existing data show zero autorepair cycles for gen18 and no independent autorepair ablation.

Bottom line: keep the qualitative claim as **promising directional evidence** and the quantitative claim as **high uncertainty / needs expanded held-out set**. The harness now has the Phase 1 stats primitives needed to report that uncertainty honestly before running larger evals.

## Safety / bounds

- No secrets were accessed or printed.
- No destructive commands were run.
- No expensive model loops or new model evals were run.
- Analysis used only the already-existing `N4-RESULTS.md` data.
