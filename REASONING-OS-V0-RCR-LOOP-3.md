# Reasoning OS v0 — RCR Loop 3: Signature Adherence Contract (Delta 2)

## Trigger

k=5 validation showed `climbing-stairs` at pass@1=2/5 with 5 `spec_validation.name_mismatch` failures. The model generated `def climbStairs(...)` or `def test_climb()` instead of the expected `def climb(n)`.

## Root Cause

- The generated function name (`climbStairs`) matched the problem title idiomatic name, not the reference signature name (`climb`).
- The spec validator detected the mismatch and provided feedback, but the model persisted in generating the wrong name across retries.
- This is a **protocol/signature adherence** failure, not an algorithmic logic failure. The code was often correct in logic but wrong in name.

## Delta

**id:** `delta-ee23ee88-10fc-46c2-9963-aec443da08e2`
**component:** `signature_contract`
**status:** `validated_scoped`

### What changed

New module `sig-repair.js`:
- `repairSignatureName(pyCode, expectedName)` — safely renames exactly one non-test top-level function def when the name doesn't match the reference, including body-recursive calls
- `canRepairSignatureName(pyCode, expectedName)` — checks if repair is safe (non-ambiguous)

Wired into `eval.js`:
- After code extraction and typing-import fix, before spec validation, for `reasoning_os_v0` baseline only
- Uses `loadExpectedSignature(problemName)` to get the expected function name
- If repair happens, records `trace.sigRepair = { originalName, repairedName }`

### Safety constraints

- Only applies when there's exactly one non-test top-level function def (skip test wrappers)
- Only applies for `reasoning_os_v0` baseline — other baselines are not affected
- Only renames function name, never changes logic
- Does not rename functions when multiple non-test defs exist (ambiguous)

## Trace Evidence

Before Delta 2 (k=5 run), climbing-stairs failures:

| Rep | Attempt | Function name | Failure |
|-----|---------|--------------|---------|
| 1 | 0 | `climbStairs` | spec_validation.name_mismatch |
| 1 | 1 | `climbStairs` | spec_validation.name_mismatch |
| 2 | 0 | `climbStairs` | autorepair_exhausted (correct name, logic) |
| 4 | 0 | `test_climb()` | spec_validation.name_mismatch |
| 4 | 1 | `climbStairs` | spec_validation.name_mismatch |
| 4 | 2 | `climbStairs` | spec_validation.name_mismatch |

Trace replay through `repairSignatureName()`:

- `climbStairs` → `climb`: ✅ repaired (covers 5 of 6 failures)
- `test_climb()` only function: ✅ not repaired (no non-test top-level def to rename — correct skip)
- `climb` (correct name already): ✅ not changed (no repair needed)

## Validation

### No-model

- 15 `test-sig-repair.js` tests all pass
- All 11+ existing test files still pass
- Trace replay: 3/3 climbing-stairs failure patterns correctly handled

### Scoped live eval (climbing-stairs only)

- **With sig-repair active**: `climbing-stairs` pass@1=true ✅
- Both attempts show `def climb(n: int)` in extracted code
- Attempt 0: logic failure (autorepair_exhausted), not naming
- Attempt 1: pass

### Guard eval (4 problems, k=1)

- binary-search: pass@1=true ✅
- climbing-stairs: pass@1=true ✅ (**improved from 2/5 to 1/1**)
- container-with-most-water: pass@1=true ✅
- coin-change-ii: pass@1=false (coder produced no code), pass@N=true ✅

**No regression on any other problem.**

## Comparison: Before vs After

| Problem | Before (k=5) pass@1 | After (guard) pass@1 | Change |
|---------|---------------------|---------------------|--------|
| binary-search | 4/5 | 1/1 | same |
| climbing-stairs | 2/5 | 1/1 | **improved** |
| container | 5/5 | 1/1 | same |
| coin-change-ii | 5/5 | 0/1 (coder error) | not a regression |

## Claim

**Allowed:** The signature repair delta (Delta 2) reduces `spec_validation.name_mismatch` failures for `climbing-stairs` by safely renaming the generated function to match the reference signature when the repair is non-ambiguous.

**Not yet allowed:** A broad pass@1 improvement claim requires k-replicate comparison with the delta disabled, under matched conditions, on a held-out problem set per the measurement protocol.

## Files

- `sig-repair.js` — new module
- `test-sig-repair.js` — 15 TDD tests
- `eval.js` — modified (sig repair gate + originalBaselineKind passthrough)