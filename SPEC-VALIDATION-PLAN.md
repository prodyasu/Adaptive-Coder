# Spec Validation — Research & Plan

## Root Cause Analysis

**coin-change-ii failure mode:**

| Component | What it says |
|-----------|-------------|
| Task description | "Given an array of coin denominations and a target amount" — parameter ORDER ambiguous |
| Reference (TypeScript) | `change(amount: number, coins: number[])` — amount first |
| Shaper spec | Describes objective/constraints but does NOT encode parameter order |
| Coder output | Freely chooses: `change(coins, target)` or `change(amount, coins)` |
| Test harness | Calls `f(5, [1,2,5])` — positional, amount-first |
| Result | If coder chose coins-first → TypeError at call site (not logic error) |

The 0/5 failures are NOT model stochasticity. They're spec underspecification: the shaper produces specs that don't constrain parameter order, and the coder picks one of two semantically plausible orderings. The test harness commits to one ordering, so the other causes immediate failure.

The original 4/4 was lucky: the coder happened to pick amount-first in those runs.

## Why the problem is in the spec, not the coder

The shaper spec format (`objective`, `constraints`, `acceptance_criteria`, `target_files`, `context_hints`) has no field for function signature or parameter names. The coder receives the raw task description and the JSON spec, but neither tells it which parameter goes first. This is a free variable in the spec.

## Design for Spec Validation Gate

### Option A: Reject specs with ambiguous signatures (recommended)

1. **Parse reference.ts** → extract expected function signature: `(amount, coins)`
2. **Parse generated Python code** → extract function signature: `(coins, target)`
3. **Compare**: if parameter names match (modulo type stripping), pass. If names conflict, reject spec and retry shaper with failure guidance: "IMPORTANT: parameter order must match `change(amount, coins)`"

**Pros:** Addresses root cause at spec level. Makes scaffold produce correct-by-construction specs.
**Cons:** Requires reference implementations for all problems. Need to handle cases where reference doesn't exist (future problems).

### Option B: Parameter-order-agnostic test harness

Dynamically generate tests by parsing generated code's function signature and matching against reference. If coder picks different names/order, adapt test calls.

**Pros:** Works without changing pipeline. More robust to signature variation.
**Cons:** More complex test harness. Doesn't actually fix spec quality.

### Option C: TypeScript reference → Python transpiler

Instead of testing Python output against TypeScript reference, transpile the TypeScript reference to Python and use that as the ground truth. Generate test cases from the Python reference.

**Pros:** Clean ground truth. Test generation becomes automatic.
**Cons:** Transpilation edge cases. Adds build complexity.

## Chosen Approach: Option A + C hybrid

1. **Reference parser**: Extract `(name, params[])` from TypeScript reference.ts
2. **Spec validator**: After coder produces code, parse its function signature
3. **Mismatch detection**: If reference expects `(amount, coins)` but coder produces `(coins, amount)`, flag as spec error
4. **Retry with guidance**: Feed spec error back to shaper with specific parameter requirement
5. **Limiting**: Max 2 spec-validation retries per attempt

Also:
- **Transpile TypeScript reference to Python** for each problem, use as ground truth test generator
- This means test cases are always derived from reference, not hardcoded

## Implementation Steps

### Step 1: Reference parser
```
parseReference(tsCode) → { fnName: string, params: [{name, type}] }
```
Handles: `export function name(param: type, ...): returnType`

### Step 2: Python signature extractor
```
extractPythonSignature(pyCode) → { fnName: string, params: [string] }
```
Handles: `def name(param1, param2):` or `class name:`

### Step 3: Signature comparator
```
compareSignatures(ref, gen) → { match: boolean, mismatch?: {expected: string, got: string} }
```
Matches by name (types stripped). Detects swapped parameters.

### Step 4: Validation gate in eval.js
After coder produces code:
1. Extract Python signature
2. Extract reference signature
3. If mismatch → return `{pass: false, stageFailed: "spec_validation", detail: "parameter mismatch"}`
4. Retry coder with failure guidance: "Spec mismatch: reference expects (amount, coins) but coder produced (coins, amount). Use exact parameter names from spec."

### Step 5: Transpile TypeScript → Python
For each reference.ts, generate a Python equivalent:
```python
# Generated from reference.ts
def change(amount, coins):
    dp = [0] * (amount + 1)
    ...
```
Use this for test case generation, so tests always match reference logic.

## Problems This Solves

- coin-change-ii parameter order issue: spec validator catches mismatch before coder runs
- Container-with-most-water, binary-search, etc.: same approach
- Any future problem with ambiguous parameter order in task description

## What This Changes About the Comparison

- gen18 vs gen0 becomes a test of spec quality, not coder luck
- A "pass" means the scaffold produced a spec that generated code matching the reference signature
- The comparison is now: does gen18 produce better-specified specs than gen0?

## Next Steps

1. Build reference parser (eval-harness/ref-parse.js)
2. Build Python signature extractor (reuse from code-extract.js)
3. Add validation gate to eval.js
4. Run variance test again with validation gate
5. Compare gen0 vs gen18 with spec validation active
