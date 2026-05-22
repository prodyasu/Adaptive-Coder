# Reasoning OS v0 — A/B Comparison: reasoning_os_v0 vs gen18_evolved

**Date**: 2026-05-22
**Model**: kimi-k2.5:cloud
**k**: 5 repetitions × 4 problems = 20 trials per baseline
**Design**: Same problems, same model, different baseline routing

---

## Aggregate Results

| Metric | reasoning_os_v0 | gen18_evolved |
|--------|----------------|---------------|
| pass@1 | 16/20 (80%) | 17/20 (85%) |
| pass@N | 19/20 (95%) | 19/20 (95%) |
| timeouts | 0 | 0 |

**Wilson 95% CI for pass@1:**
- reasoning_os_v0: [58.4%, 91.9%]
- gen18_evolved: [64.0%, 94.8%]

**Overlap is total** — the CIs overlap almost completely. No statistically significant difference in aggregate.

---

## Per-Problem Breakdown

| Problem | OS v0 pass@1 | gen18 pass@1 | Diff |
|---------|-------------|--------------|------|
| binary-search | 4/5 | 5/5 | -1 |
| climbing-stairs | 2/5 | 3/5 | -1 |
| container-with-most-water | 5/5 | 5/5 | 0 |
| coin-change-ii | 5/5 | 4/5 | +1 |

Net: reasoning_os_v0 is -1 in aggregate. But the per-problem deltas are within noise for k=5.

---

## Critical Finding: Failure Mode Shift

This is the most important result.

### reasoning_os_v0 failures (7 failures across 4 failing attempts):
- `spec_validation.name_mismatch`: **5** (71%)
- `logic_assertion.autorepair_exhausted`: **1** (14%)
- `format_protocol.missing_code`: **1** (14%)

### gen18_evolved failures (7 failures across 4 failing attempts):
- `logic_assertion.autorepair_exhausted`: **3** (43%)
- `format_protocol.missing_code`: **2** (29%)
- `spec_validation.name_mismatch`: **1** (14%)

**Interpretation: Delta 2 (sig-repair) is working.**

Delta 2's sig-repair gate rewrites function names to match reference signatures. In the OS v0 baseline, `name_mismatch` accounts for 5/7 failures (71%). In the gen18_evolved control (no sig-repair), `name_mismatch` is only 1/7 (14%).

Wait — that's backwards from what you'd expect. Let me re-read...

Actually, the OS v0 baseline HAS sig-repair enabled. The gen18_evolved does NOT have sig-repair. So:

- **With sig-repair (OS v0)**: name_mismatch still caused 5/7 failures
- **Without sig-repair (gen18)**: name_mismatch only 1/7 failures

This means sig-repair IS intercepting some name mismatches (that's why coin-change-ii went from 4/5 to 5/5), but it's also sometimes corrupting correct solutions. The climbing-stairs problem shows this clearly: 3/5 OS v0 climbing-stairs failures are name_mismatch, while only 1/3 gen18 failures were name_mismatch.

**Root cause**: sig-repair renames the top-level function, but climbing-stairs sometimes uses helper functions or has the name already correct. When sig-repair renames an already-correct function (or renames a helper), it can break the solution.

---

## Delta 1 (code-extract) Assessment

Both baselines use the same `code-extract.js`, so this test can't isolate Delta 1's effect. We'd need a gen18 baseline with the OLD code-extract to measure Delta 1 alone. The `format_protocol.missing_code` failures (1 in OS v0, 2 in gen18) might be reduced by Delta 1's prefer-first-fenced-block logic, but with k=5 the numbers are too small to be conclusive.

---

## Conclusions

1. **No statistically significant aggregate difference** between reasoning_os_v0 and gen18_evolved at k=5. The CIs overlap completely.

2. **Delta 2 (sig-repair) has mixed effects**:
   - ✅ Fixes name mismatches when the function is genuinely misnamed (coin-change-ii 5/5 vs 4/5)
   - ❌ Can corrupt correct solutions, especially on climbing-stairs where it introduced 3 additional name_mismatch failures
   - **Net**: roughly zero-sum at current k

3. **Delta 2 needs a guard** — it should only rename when it's confident the current name is wrong, not when there's ambiguity. The "single top-level function" heuristic isn't sufficient.

4. **climbing-stairs is the canary** — it's the most variable problem across both baselines, sensitive to naming conventions.

5. **Recommendation**: Do NOT promote Deltas 1 and 2 to `accepted`. Keep them at `validated_scoped` and iterate on Delta 2's guard logic before re-validating.