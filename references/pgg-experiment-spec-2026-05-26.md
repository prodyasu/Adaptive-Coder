# PGG Experiment Spec — Predicate-Gated Generation

This is a design doc, not implementation. After K0 killed v0, the only thing that matters is: **does PGG beat best-of-5 at comparable cost?** Everything below is structured around making that question answerable.

---

## A. PGG Implementation Design

### A.1 Assertion extraction (deterministic, no model)

Source the assertions from **three layers**, in order of trust:

1. **Curated I/O pairs per problem** (`problem-assertions.js`) — hand-authored, frozen, source of truth. These are 3–5 input/output pairs per problem distinct from the test suite (to avoid COH_ATR contamination).
2. **Shaper `acceptance_criteria` parsed for input/output statements** — regex-based extraction of patterns like `"f([1,2,3]) returns 6"` or `"input X should produce Y"`.
3. **Problem-pattern defaults** — for known problem families (sort, search, DP), template assertions with `?` slots filled from the spec's example section.

Layer 1 dominates. Layer 2/3 are fallback for problems without curated assertions. This is the opposite of ICG, where everything was inferred. PGG ships with a frozen, problem-keyed assertion table.

```javascript
// problem-assertions.js
export const PGG_ASSERTIONS = {
  "climbing-stairs": [
    { input: "1", expected: "1", expr: "f(1) == 1" },
    { input: "2", expected: "2", expr: "f(2) == 2" },
    { input: "5", expected: "8", expr: "f(5) == 8" },
  ],
  "binary-search": [
    { input: "[1,3,5,7,9], 5", expected: "2", expr: "f([1,3,5,7,9], 5) == 2" },
    { input: "[1,3,5], 4", expected: "-1", expr: "f([1,3,5], 4) == -1" },
    { input: "[], 1", expected: "-1", expr: "f([], 1) == -1" },
  ],
  // ... K=3-5 assertions per problem, distinct from primary + held-out test data
};

export function extractAssertions(problemName, spec) {
  // Layer 1: curated
  if (PGG_ASSERTIONS[problemName]) return PGG_ASSERTIONS[problemName];
  // Layer 2: parse acceptance_criteria (returns [] if none)
  return parseAcceptanceCriteria(spec.acceptance_criteria || []);
}
```

**Critical:** PGG assertions MUST be disjoint from `runBasicTest` test suite. Otherwise PGG trivially boosts pass@1 by leaking test data into the prompt. Audit this with a `test-pgg-disjointness.js` precommit check.

### A.2 Injection point

After Shaper, before Coder. The coder system prompt gains a section:

```
--- VERIFIABLE ASSERTIONS (your code MUST satisfy these) ---
After implementation, your function `f` must pass:
    assert f(1) == 1
    assert f(2) == 2
    assert f(5) == 8
These will be executed against your code before any further evaluation.
A failing assertion = rejection, no scoring.
--- END ASSERTIONS ---
```

This is different from ICG-style prose. The model sees executable Python it must satisfy. This is verifiable at low cost (no model call).

### A.3 The rejection filter (the whole point)

After the Coder produces code and before the Verifier:

```javascript
// pgg-filter.js
export async function pggFilter(code, problemName, assertions, fnName) {
  const tmpFile = join(tmpdir(), `pgg_${problemName}_${Date.now()}.py`);
  writeFileSync(tmpFile, code);

  const moduleName = problemName.replace(/-/g, '_');
  const modulePath = join(tmpdir(), `${moduleName}.py`);
  writeFileSync(modulePath, code);

  const results = [];
  for (const a of assertions) {
    const testScript = `from ${moduleName} import ${fnName} as f\n${a.expr.replace(/^.*?assert /, 'assert ')}`;
    try {
      execFileSync("python3", ["-c", testScript], {
        cwd: tmpdir(), timeout: 2000, stdio: "pipe",
        env: { ...process.env, PYTHONPATH: tmpdir() },
      });
      results.push({ ...a, passed: true });
    } catch (e) {
      results.push({ ...a, passed: false, error: e.stderr?.toString()?.slice(0,200) });
    }
  }

  const allPassed = results.every(r => r.passed);
  return {
    accepted: allPassed,
    results,
    failedCount: results.filter(r => !r.passed).length,
    totalCount: results.length,
  };
}
```

### A.4 Interaction with k-budget (rejection sampling)

This is where PGG earns its name. **Failed assertions burn a generation but NOT a k-slot.**

```javascript
// Modified outer loop in evalProblem (k=5 case)
const K_TRIALS = 5;
const MAX_PGG_RESAMPLES = 10;  // safety cap on resamples per trial

const trials = [];
for (let trial = 0; trial < K_TRIALS; trial++) {
  let resamples = 0;
  let accepted = null;

  while (resamples < MAX_PGG_RESAMPLES) {
    const code = await runPipelineThroughCoder(...);
    const filterResult = await pggFilter(code, problemName, assertions, fnName);

    if (filterResult.accepted) {
      accepted = { code, filterResult, resamples };
      break;
    }
    resamples++;
    // log rejected attempt; do NOT count toward k
  }

  if (!accepted) {
    // PGG exhausted resamples → record as failure for this trial
    trials.push({ pass: false, pggExhausted: true, resamples });
    continue;
  }

  // Run through verifier + autorepair as normal
  const result = await runVerifierAndAutorepair(accepted.code, ...);
  trials.push({ ...result, pggResamples: accepted.resamples });
}
```

**Cost accounting**: log `pggResamples` per trial. The fair comparison vs best-of-5 is total Coder calls, not k. If PGG averages 3 resamples per trial × 5 trials = 15 Coder calls, it must beat best-of-5 (5 Coder calls + autorepair) decisively — otherwise it's just retry with extra steps and worse economics.

### A.5 Interaction with autorepair

PGG runs **before** autorepair, after Coder. If autorepair fires (verifier rejected), the autorepair loop should re-run the PGG filter on the repaired code too. Code that survived PGG but failed Verifier, then got repaired, must re-pass PGG. Otherwise autorepair can silently break invariants.

```
Coder → [PGG filter] → Verifier → (fail) → Coder(feedback) → [PGG filter] → ...
```

---

## B. Experiment Design

### B.1 Arms

| Arm | Pipeline | k | Cost (Coder calls) |
|-----|----------|---|---------------------|
| **A: single-shot** | Shaper→Coder | 1 | ~1 |
| **B: best-of-5** (gen18) | Shaper→Coder→Verifier→[autorepair]×5 trials | 5 | ~5–15 |
| **C: PGG-5** | Shaper→Asserts→Coder→[PGG filter] (with resample)→Verifier→[autorepair]×5 trials | 5 | ~5–25 |
| **D (optional): PGG-1** | PGG with k=1 (single trial, allows resamples within trial) | 1 | ~1–5 |

Arm D is critical — it isolates whether PGG's advantage comes from rejection sampling (within-trial resamples) vs from k=5 (between-trial retries). If PGG-1 beats single-shot, the rejection filter has signal. If only PGG-5 beats best-of-5, the gain may just be more attempts.

### B.2 Problem set

Stay on stress suite as primary (edit-distance, word-break, detect-cycle, valid-sudoku) where best-of-5 hits 80%. Headroom exists.

Add 4 new **constraint-flavored** problems where assertions can encode hard constraints:
- `n-queens` (backtracking with adjacency constraints)
- `sudoku-solver` (CSP — different from valid-sudoku validator)
- `course-schedule` (cycle detection in DAG)
- `meeting-rooms-ii` (interval scheduling)

These are LeetCode-tier but lean toward problems where I/O assertions concretely constrain behavior. **Total N=8.**

### B.3 Sample size

To detect +10pp pass@1 with 80% power, α=0.05, two-sided binomial: need ~200 trials per arm.

- N=8 problems × k=25 trials = 200 trials/arm
- 4 arms = 800 trials total
- At ~5 Coder calls/trial avg (mixed across arms), and ~10s/call, that's ~11 hours of model time

This is heavy. Two cheaper alternatives:

**Phase 1 (cheap kill test)**: N=8 × k=5 = 40 trials/arm. MDE ≈ 25pp. If PGG doesn't beat best-of-5 by 25pp, **kill it** — the v0 standard. ~2 hours.

**Phase 2 (only if Phase 1 survives)**: scale to k=25 for the +10pp claim. ~11 hours.

### B.4 Primary DVs

| DV | Why |
|----|-----|
| **pass@1 per arm** | Apples-to-apples capability metric |
| **pass@5 per arm** | Final delivered correctness |
| **Coder calls per pass** (cost-normalized pass rate) | Fair comparison — PGG that uses 3× the Coder calls must beat best-of-5 to count |
| **PGG accept rate** (per trial, % of generations passing the filter) | Diagnostic — does the filter discriminate? |
| **PGG → Verifier survival** (% of PGG-accepted that also pass Verifier) | Calibrates whether assertions are predictive of full correctness |
| **Held-out delta** | Catches assertion-leak contamination |

### B.5 Pre-registered kill criteria

- **K1 (assertion utility)**: If PGG accept rate is >95% or <5%, the assertions are not discriminative — kill PGG.
- **K2 (cost-normalized efficacy)**: If PGG-5 pass@5 / Coder-calls ≤ best-of-5 pass@5 / Coder-calls × 1.05, kill PGG. PGG must be at least 5% more cost-efficient.
- **K3 (pass@1 dominance)**: If PGG-5 pass@1 ≤ best-of-5 pass@1 + 10pp (Phase 2) or +25pp (Phase 1), kill PGG.
- **K4 (rejection signal)**: If PGG-1 pass@1 ≤ single-shot pass@1, the rejection filter adds no within-trial value — PGG is just k=5 in disguise.
- **K5 (contamination)**: If PGG accepted code has held-out pass rate < 0.6 (cohAtrRisk ≥ 0.4), assertions are leaking into the prompt — kill or rewrite assertion set.

---

## C. Diagnostician (Minimal v0)

### C.1 Failure mode taxonomy (extends existing)

| Class | Detection rule (deterministic) | Routes to |
|-------|--------------------------------| -----------|
| `timeout.execution` | `runBasicTest` raises timeout / test process exceeds 3s | **Complexity hint injection** (future intervention) |
| `logic.assertion_failed` | Test ran, assertion failed, no exception | **PGG** (failed I/O case → can be encoded as assertion) |
| `format_protocol.*` | Compile error, import error, no function def | **code-extract / sig-repair** (already exist) |
| `wrong_data_structure` | Test fails with `TypeError`, `AttributeError`, list vs tuple mismatch | **Type-assertion injection** (PGG variant) |
| `off_by_one` | Numerical assertion fails with diff ±1 between got/expected | **Boundary assertion injection** (PGG variant with edge cases) |

### C.2 Classification implementation

```javascript
// diagnostician.js
export function classifyFailure(trace) {
  const { failureKind, failureSubKind, testDetail, errorDetail } = trace;
  
  if (failureKind === 'timeout') return { class: 'timeout.execution', route: 'COMPLEXITY' };
  if (failureKind === 'format_protocol') return { class: 'format_protocol', route: 'EXTRACT_REPAIR' };
  
  if (testDetail?.match(/TypeError|AttributeError|expected.*tuple.*got.*list/i)) {
    return { class: 'wrong_data_structure', route: 'PGG_TYPE' };
  }
  
  const m = testDetail?.match(/assert.*?(-?\d+)\s*==\s*(-?\d+)/);
  if (m && Math.abs(parseInt(m[1]) - parseInt(m[2])) === 1) {
    return { class: 'off_by_one', route: 'PGG_BOUNDARY' };
  }
  
  if (failureKind === 'logic_assertion') return { class: 'logic.assertion_failed', route: 'PGG' };
  
  return { class: 'unknown', route: 'NONE' };
}
```

### C.3 Routing logic

For v0: **classify only**, don't route. Log the class on every failure. After Phase 1 PGG run, audit: which failure classes did PGG actually fix? That's the data that will tell us whether to build PGG-Type, PGG-Boundary, or pivot again.

---

## D. KEEP vs BUILD NEW

### Keep as-is
- `eval.js` runPipeline core (shaper→coder→verifier→autorepair)
- `code-extract.js` (Delta 1, accepted)
- `sig-repair.js` (Delta 2, accepted)
- `spec-validator.js`
- `failure-metrics.js`, `trace-log.js`
- `held-out-test-suites.js` (for contamination check K5)
- `runBasicTest` (the ground-truth oracle)

### Remove / deprecate
- `invariant-constrained-generation.js` — superseded by PGG
- `constraint-ordering.js`, `decomposition-delta.js`, `informed-repair.js` — never validated
- Sunset `reasoning_os_v0` baseline (folds back into `gen18_evolved`)

### Build new
- `problem-assertions.js` — curated assertion table per problem
- `pgg-filter.js` — runs assertions against generated code; returns accept/reject
- `pgg-prompt.js` — formats assertion section into Coder system prompt
- `diagnostician.js` — minimal failure classifier (above)
- `run-pgg-experiment.mjs` — runner for Arms A/B/C/D, Phase 1
- `test-pgg-filter.js` — unit tests (no model calls)
- `test-pgg-disjointness.js` — guards against assertion/test contamination

Wire into `eval.js` via a new opts flag `pggEnabled` and a new `baselineKind` value `"pgg_v0"`. Mirror the ICG wiring pattern at `eval.js:531` but place the filter call *after* the Coder block.

---

## E. Benchmarks

### Difficulty calibration
Target baseline (single-shot, gen18 with k=1) pass rate of **40–60%**. Current state:
- Standard N=8: gen18 single-shot ≈ 72.5%. **Too easy** — ceiling effect mutes any intervention.
- Stress suite (edit-distance, word-break, detect-cycle, valid-sudoku): gen18 single-shot ≈ 60%. **Workable**.

### Recommended benchmark composition
- Drop the standard N=8 — ceiling-bound, not informative.
- Use stress suite (N=4) + new constraint problems (N=4) → **N=8 total**.
- Constraint-satisfaction additions (n-queens, sudoku-solver, course-schedule, meeting-rooms-ii) likely sit at 30–50% single-shot for minimax-m2.7.

### Why stay on LeetCode-flavored (not pivot fully to CSP)
PGG's mechanism — assertions over function I/O — works on any deterministic function. LeetCode-style problems are the cheapest way to test the mechanism. Save the full domain pivot to CSP/planning for if PGG mechanism survives. **Validate the lever before changing the surface.**

---

## Open decisions for Mitch

1. **Phase 1 only, or commit to Phase 2 budget upfront?** Phase 1 is ~$5–10 of model spend, Phase 2 is ~$30–50. Run Phase 1 first.
2. **K=3 vs K=5 assertions per problem?** More assertions = harder filter = more rejections = more cost. K=3 for Phase 1.
3. **Do we need Arm D (PGG-1)?** It's the cleanest test of whether rejection sampling has signal independent of k. YES — same cost as Arm A.
4. **Curated assertions: who authors them?** They need to be disjoint from test suites. Either the agent drafts them now and Mitch reviews, or Mitch drafts them. Either way they get frozen + checksum'd before any run.

Tradeoff: this design is mechanically much closer to a real intervention than ICG was, but it's also a lot of new wiring. The smallest experiment that could refute it is Arm A vs Arm D on N=4 stress problems (k=5) — about 40 trials, ~$3, ~1 hour. That gates whether to build the full thing.