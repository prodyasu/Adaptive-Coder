# Spec Validation Integration — Complete

## What's Built

### 1. Type Translator (`ts-to-py.js`)
- TypeScript → Python type mapping: `number[]` → `List[int]`, `string` → `str`, etc.
- Handles: unions (`| null` → `Optional[]`), generics (`Map<K,V>` → `Dict[K,V]`), arrays
- Unit tested: 10/10 type tests pass, 5/5 reference fixture tests pass

### 2. Reference Signature Parser (`ref-sig.js`)
- Parses TypeScript `reference.ts` → function/class signatures
- Heuristic for primary function (matches problem name words, excludes helpers)
- Handles: classes with methods, functions, union types

### 3. Coder Prompt with Signature Constraint (`eval.js`)
- `CODER_PROMPT_TEMPLATE` with `{{SIGNATURE}}` placeholder
- `buildCoderPrompt(problemName)` function loads reference, translates to Python signature, injects into prompt
- Both raw_base and pipeline stages now use signature-constrained prompts
- Language explicitly set to "Python 3" in prompt to prevent Java output

## Key Changes to Eval Logic

**Before:**
```
Shaper: given task, produce JSON spec
Coder: given spec, produce code (free to pick language/signature)
```

**After:**
```
Shaper: given task, produce JSON spec
Coder: given spec + "Function signature: def change(amount: int, coins: List[int]) -> int", 
        produce code (must match signature exactly)
```

This eliminates:
1. Parameter order ambiguity (e.g., `coins, amount` vs `amount, coins`)
2. Language choice ambiguity (Java vs Python)
3. Parameter naming inconsistency

## Pre-registered Predictions (Fresh Eval)

Based on the signature constraint fixing the underspecification issues:

| Baseline | Predicted pass@1 (16 problems) | Rationale |
|----------|------------------------------|-----------|
| raw_base | 30-40% | Base model still struggles on hard problems; no scaffold help |
| gen0_seed | 50-60% | Shaper+coder with good specs; no verifier feedback |
| gen18_evolved | 65-75% | Full pipeline with verifier; autorepair helps on edge cases |

Gap hypothesis: gen18 - gen0 = 10-15 percentage points from verifier+autorepair.
If gap >20 points, verifier is highly effective. If gap <5, verifier adds little.

## Remaining Work Before Fresh Eval

1. **Sanity test**: Run coin-change-ii once with gen18 to verify signature constraint works
2. **Test updates**: `runBasicTest` needs signature-aware test generation (currently uses hardcoded calls)
3. **State cleanup**: Clear old state.jsonl entries, start fresh comparison
4. **Full run**: 16 problems × 3 baselines = 48 problem evaluations

## Time Estimate

- Sanity test: 2-3 minutes
- Test harness update: 30 minutes
- Full eval run: 2-3 hours (rate-limited)

## Critical Check Before Proceeding

The test harness (`runBasicTest`) currently generates tests by detecting the function name from generated code and constructing calls like `f(5, [1,2,5])`. This assumes the function name matches the reference. With signature constraints, this should be reliable, but worth verifying.

Ready to proceed with sanity test and/or full eval?