# PGG Phase 1 Results — Killed by best-of-5

Date: 2026-05-27  
Run dir: `validation-runs/pgg-phase1-2026-05-27T00-14-56-2026-05-27T00-14-56-363Z`  
Model: `minimax-m2.7:cloud`  
Problems: `edit-distance`, `word-break`, `detect-cycle`, `valid-sudoku`

## Question

Does Predicate-Gated Generation (PGG) beat the simplest competent baseline: sample the same model multiple times and keep the first passing result?

PGG injected runnable assertion examples into the coder prompt and rejection-filtered generated code before verifier/autorepair. Failed assertion checks triggered free resamples that did not count against `k`.

## Arms

| Arm | Label | Baseline | k | PGG |
|---|---|---:|---:|---:|
| A | single-shot | `gen18_evolved` | 1 | off |
| B | best-of-5 | `gen18_evolved` | 5 | off |
| C | PGG-5 | `pgg_v0` | 5 | on |
| D | PGG-1 | `pgg_v0` | 1 | on |

## Results

| Arm | pass@1 | pass@N | PGG resamples | Verdict |
|---|---:|---:|---:|---|
| A single-shot | 3/4 (75.0%) | 3/4 (75.0%) | 0 | baseline context |
| B best-of-5 | 19/20 (95.0%) | 20/20 (100.0%) | 0 | dominant |
| C PGG-5 | 10/20 (50.0%) | 12/20 (60.0%) | 46 | killed |
| D PGG-1 | 1/4 (25.0%) | 2/4 (50.0%) | 8 | no rejection signal |

### Per-problem highlights

- Arm B best-of-5 hit 5/5 pass@N on all four problems and 5/5 pass@1 on three of four.
- Arm C PGG-5 degraded every problem relative to best-of-5:
  - edit-distance: 2/5 pass@1, 2/5 pass@N, 9 resamples
  - word-break: 2/5 pass@1, 3/5 pass@N, 16 resamples
  - detect-cycle: 3/5 pass@1, 3/5 pass@N, 15 resamples
  - valid-sudoku: 3/5 pass@1, 4/5 pass@N, 6 resamples

## Kill criteria

- **K3: PGG-5 must beat best-of-5 by a meaningful margin.**
  - Observed: PGG-5 50.0% vs best-of-5 95.0% pass@1.
  - Delta: **-45pp**.
  - Verdict: **KILLED**.

- **K4: PGG-1 must show rejection-sampling signal vs single-shot.**
  - Observed: PGG-1 25.0% vs single-shot 75.0% pass@1.
  - Delta: **-50pp**.
  - Verdict: **NO SIGNAL**.

## Mechanism read

This was not an inert intervention. PGG fired:

- Arm C: 46 resamples
- Arm D: 8 resamples
- `pggExhausted`: 0 cases

The failure mode is therefore stronger than “PGG did nothing.” PGG actively filtered/resampled and made outcomes worse.

Failure classes were dominated by timeout/spec overhead:

- Arm C failure classes: 41 timeout, 2 spec_validation
- Arm D failure classes: 10 timeout, 1 format_protocol

Interpretation: static curated assertions and rejection sampling add prompt/control-flow overhead and induce timeout-heavy behavior. Best-of-5 spends the same broad budget on independent clean samples and dominates.

## Conclusion

The naive PGG design is empirically and economically dominated by best-of-5 on this stress suite/model.

What is killed:

- Static assertion injection as a standalone generation-time intervention.
- Rejection sampling with curated assertions as a best-of-N replacement.
- Any efficacy story that compares PGG only to single-shot.

What survives:

- The harness discipline: best-of-N baselines, kill criteria, trace logging, contamination guards.
- The need for dynamic, failure-conditioned interventions rather than static prompts.
- A possible future Diagnostician → targeted constraint compiler loop, but only if it can beat best-of-N and avoid timeout/cost blowup.

## Reporting bug found and fixed afterward

The runner printed `report.md`, but only generated `compact-report.md`. It also generated invalid multi-arm top-level `summary.json` / compact reports with `0/0` totals because the generic `summarizeRun()` expected `problem -> trials`, while PGG comparison results are shaped as `arm -> problem -> trials`.

Fix added after this run:

- `buildMultiArmComparison()`
- `buildMultiArmSummary()`
- `multiArmReportText()` / `writeMultiArmReport()`
- regression test: `test-pgg-reporting.js`

Canonical files for this historical run remain:

- `comparison.json`
- `arm-a-summary.json`
- `arm-b-summary.json`
- `arm-c-summary.json`
- `arm-d-summary.json`
