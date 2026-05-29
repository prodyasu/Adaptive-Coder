# PGG Filter Alias Bug — Historical PGG Kill Run Invalid

Date: 2026-05-27

## Summary

The PGG Phase 1 clean rerun looked like a decisive kill versus best-of-5, but a deterministic harness bug invalidates that conclusion.

Curated PGG assertions import a generic `f` symbol directly, e.g.:

```python
from word_break import f; assert f("abcde", ["ab","c","de"]) == True
```

Real generated code keeps the problem signature name, e.g. `wordBreak`, `minDistance`, `hasCycle`, etc. In `pgg-filter.js`, when an assertion already contained an import, the filter executed the assertion as-is and ignored the supplied `fnName`.

Result: correct implementations were rejected with `ImportError: cannot import name 'f'`, causing repeated resampling and eventual runner timeouts. The historical PGG Phase 1 result should be treated as contaminated, not as a valid mechanism kill.

## Evidence

Local repro after Opus coordination attempt:

```bash
node /tmp/pgg-real-signature-check.mjs
```

Before the fix, known-good real-signature implementations failed all PGG assertions:

- `word-break` code defining `wordBreak(...)` → `ImportError: cannot import name 'f' from 'word_break'`
- `edit-distance` code defining `minDistance(...)` → `ImportError: cannot import name 'f' from 'edit_distance'`

A trace sample from historical Arm C showed a semantically correct `wordBreak` implementation rejected by PGG assertions that expected `f`.

## Fix

TDD regression added in `test-pgg-filter.js`:

- known-good `wordBreak(...)` implementation must pass curated `word-break` PGG assertions when `fnName='wordBreak'`.

Implementation in `pgg-filter.js`:

- rewrite embedded assertion imports so imported `f` aliases the real function name:

```python
from word_break import wordBreak as f; assert f(...)
```

Also handles mixed imports such as:

```python
from detect_cycle import ListNode, hasCycle as f; ...
```

## Verification

Commands run:

```bash
node test-pgg-filter.js
node /tmp/pgg-real-signature-check.mjs
node test-pgg-disjointness.js
node test-pgg-reporting.js
node run-pgg-experiment.mjs --dry-run
```

All passed after the fix.

## Implication

Do not cite the historical PGG Phase 1 run as a valid PGG kill. The safe claim is:

> The previous PGG run was invalid due to an assertion import alias bug. PGG needs a small post-fix smoke rerun before deciding whether to kill or continue.

## Post-fix smoke

Command approved by Mitch and run:

```bash
node run-pgg-experiment.mjs --arms=a,d --problems=word-break,edit-distance
```

Run dir:

```text
validation-runs/pgg-phase1-2026-05-27T14-31-33-2026-05-27T14-31-33-151Z
```

Result:

- Arm A single-shot: pass@1 0/2, pass@N 1/2
- Arm D PGG-1: pass@1 0/2, pass@N 1/2
- PGG resamples: 0
- PGG assertions accepted correctly where they ran; no `ImportError: cannot import name 'f'` alias failure observed.
- Failures were dominated by model-stage timeouts (`25000ms limit`) in shaper/coder calls, not PGG rejection behavior.

Interpretation: the alias fix works, but this smoke is **inconclusive on PGG efficacy**. It shows the historical failure mode was fixed and that current tiny-smoke variance/timeouts overwhelm signal. Do not run a full PGG rerun until timeout calibration is addressed.

## Recommended next step

Opus review after OAuth/auth recovery agreed: do **not** run full PGG Phase 1 yet. First calibrate timeouts.

Bug found: `EVAL_TIMEOUT_MS` existed but only `raw_base` honored it. The gen18/PGG shaper/coder/verifier calls still hardcoded `timeoutMs: 25_000`, so timeout-calibration env vars were silently ineffective for the relevant arms.

Local TDD fix:

- Added `test-eval-timeout-config.js` to assert all model-stage `callOllama(...)` calls use `TIMEOUT_MS` rather than hardcoded `25_000`.
- Replaced hardcoded shaper/coder/verifier timeouts in `eval.js` with `TIMEOUT_MS`.
- Verified with:

```bash
node test-eval-timeout-config.js
node test-pgg-filter.js
node test-pgg-disjointness.js
node test-pgg-reporting.js
node run-pgg-experiment.mjs --dry-run
```

Next eval should be a Phase A infra ceiling check, not a full PGG rerun:

```bash
EVAL_TIMEOUT_MS=60000 node run-pgg-experiment.mjs --arms=b \
  --problems=edit-distance,word-break,detect-cycle,valid-sudoku
```

Gate before spending on Phase B:

- Arm B pass@N ≥ 90%
- stage-timeout share < 25%

If either fails, stop and investigate provider/model/timeout regression before touching PGG mechanism claims.

## Phase A timeout calibration result

Command run after timeout wiring fix:

```bash
EVAL_TIMEOUT_MS=60000 node run-pgg-experiment.mjs --arms=b \
  --problems=edit-distance,word-break,detect-cycle,valid-sudoku \
  --timeout-ms=600000
```

Run dir:

```text
validation-runs/pgg-phase1-2026-05-27T16-45-27-2026-05-27T16-45-27-853Z
```

Result:

- Arm B best-of-5 pass@1: 17/20 (85%)
- Arm B best-of-5 pass@N: 20/20 (100%)
- Held-out rate: 19/20 (95%)
- Failure classes: 3 logic_assertion first-attempt failures, all recovered by later best-of-5 trials
- Strict timeout evidence in trace records: 0/23 attempt records
- Model error records: 0

Gate verdict: **PASS**.

- pass@N gate clears: 100% ≥ 90%
- timeout-share gate clears: 0% < 25%

Interpretation: with `EVAL_TIMEOUT_MS=60000` wired into shaper/coder/verifier and `--timeout-ms=600000` as the outer trial budget, the stress-suite Arm B infra ceiling is healthy enough to proceed to Phase B PGG comparison. The next run should be a fresh full 4-arm comparison at the calibrated timeout, not a splice with historical contaminated results.

## Phase B partial run / static PGG pivot evidence

Fresh 4-arm Phase B was launched with calibrated timeout and clean guards:

```bash
EVAL_TIMEOUT_MS=60000 node run-pgg-experiment.mjs \
  --arms=a,b,c,d \
  --problems=edit-distance,word-break,detect-cycle,valid-sudoku \
  --timeout-ms=600000
```

Run dir:

```text
validation-runs/pgg-phase1-2026-05-27T17-08-51-2026-05-27T17-08-51-342Z
```

The run was intentionally terminated after stalling in Arm C / detect-cycle; partial postmortem was written to:

```text
validation-runs/pgg-phase1-2026-05-27T17-08-51-2026-05-27T17-08-51-342Z/partial-postmortem.json
```

Completed base-arm results:

- Arm A single-shot: 4/4 pass@1, 4/4 pass@N (tiny/lucky sample)
- Arm B best-of-5: 18/20 pass@1 (90%), 20/20 pass@N (100%), held-out 20/20

Completed PGG-5 log results:

- edit-distance: 3/5 pass@1, 5/5 pass@N, PGG resamples 0
- word-break: 4/5 pass@1, 5/5 pass@N, PGG resamples 0

Trace nuance from incomplete detect-cycle:

- PGG did become active on detect-cycle, but mostly as **exhaustion/cost**, not lift.
- Detect-cycle trial traces show repeated `pgg_exhausted after 10 resamples` plus 60s shaper/coder timeouts.
- Some PGG attempts generated function `f`, causing `spec_validation.name_mismatch` against required `hasCycle` / `wordBreak`, suggesting assertion alias/prompt pressure may still distort function naming even after filter-side import rewrite.
- The runner did not hard-stop promptly despite the intended outer timeout, so there is also a harness cancellation/abort issue to inspect before any future long PGG run.

Strategic interpretation: static curated PGG should not receive more full-run spend as an efficacy bet. The useful salvage is the runnable predicate/filter substrate, disjointness guard, timeout tests, and the negative result: generic static predicates either stay inactive on easy problems or explode cost on harder structural problems. Next direction should pivot to failure-conditioned/dynamic predicate generation or a new benchmark/domain, not another static PGG sweep.
