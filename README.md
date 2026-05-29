# Adaptive-Coder

**Constraint-Refined Generation Benchmark** — an eval harness for measuring whether adaptive interventions improve LLM code generation, with rigorous measurement discipline.

## Status

**K0 Kill Test Result (2026-05-26):** gen18 best-of-5 achieves 100% problem-level pass rate vs OS v0's 72.5% (standard) / 60% (stress). The v0 intervention stack (metadata, sig-repair, ICG, informed repair) is **dominated by simple retry**. Every future intervention must be benchmarked against best-of-N, not just single-shot.

**PGG Phase 1 Validity Revision (2026-05-27):** The apparent PGG kill run is contaminated by an assertion import alias bug: curated assertions imported `f`, but real generated code used problem-specific function names. `pggFilter()` ignored `fnName` for embedded imports, causing correct code to be rejected with `ImportError`. Treat the old PGG kill result as invalid until a post-fix smoke/rerun. See [`references/pgg-filter-alias-bug-2026-05-27.md`](references/pgg-filter-alias-bug-2026-05-27.md).

See [`references/k0-best-of-5-kill-test-2026-05-26.md`](references/k0-best-of-5-kill-test-2026-05-26.md) for full results.

## What Works

- **gen18 pipeline**: Shaper → Coder → Verifier → autorepair loop. The baseline that actually works.
- **Code-extract (Delta 1)**: Prevents pytest scaffolding leaks. Validated, accepted.
- **Sig-repair (Delta 2)**: Repairs name drift. Validated, accepted. *(Narrow fix only — not a reasoning claim.)*
- **Delta lifecycle**: proposed → validated_scoped → accepted/rejected with preregistered hypotheses.
- **COH_ATR discipline**: Frozen held-out comparisons, preregistered hypotheses.
- **Trace logging**: Full JSONL traces per attempt with failure taxonomy.
- **Best-of-N baseline**: The benchmark that actually matters.

## What Died

- **OS v0 metadata layer**: Null effect on pass@1 (-5pp delta, within noise). PERM_GRAD explains why: post-hoc annotation cannot move outcomes.
- **ICG (invariant injection)**: +0pp on stress suite. Prose invariants don't constrain generation.
- **PGG (Predicate-Gated Generation)**: Killed by Phase 1. PGG-5 50% pass@1 vs best-of-5 95%; PGG-1 25% vs single-shot 75%. Static runnable assertions + rejection sampling added overhead/timeouts and underperformed retry.
- **Informed repair (R4)**: 0% repair conversion on stress suite (only 3/20 repair-eligible trials). Right mechanism, wrong layer.
- **Constraint ordering, decomposition, spec quality**: Never validated, never wired.

## Architecture

```
spec → Shaper (JSON spec) → Coder (Python code) → Verifier (tests) → [autorepair] → result
                                  ↑                                    |
                                  └── failure trace + feedback ────────┘
```

Three baselines:
- `raw_base`: Single coder call, no spec, no verifier
- `gen0_seed`: Shaper → Coder, no verifier, no autorepair
- `gen18_evolved`: Full pipeline with autorepair (the working baseline)

Interventions are opt-in delta modules that modify the pipeline at specific stages.

## Key Concepts

### best-of-N is the baseline
Any intervention must beat `for i in range(N): if try(): break` at comparable cost. If it doesn't, it's dominated by retry.

### PERM_GRAD Principle
Interventions must **rewrite the artifact before or during generation** to affect outcomes. Post-hoc annotation (metadata, prose invariants, verifier feedback on retry) is inert.

### Measurement Discipline
- **Primary DV matches intervention timing**: pass@1 for generation-time, repair conversion for post-failure
- **Held-out tests must discriminate**: cohAtrRisk = 0% everywhere means the metric is broken
- **k ≥ 5 independent trials per condition**: MDE ≈ 25pp at k=5. Need k≥20 for 10pp detection.
- **Frozen baselines**: No retroactive changes after data collection.

## Quick Start

```bash
# Run a single problem
node index.js --run reasoning_os_v0 --problems climbing-stairs

# Run gen18 baseline control
node run-gen18-control.mjs

# Full N=8 k=5 validation
node run-gen18-n8.mjs    # gen18_evolved baseline
node run-os-v0-n8.mjs    # reasoning_os_v0 with all deltas

# Tests (360+ assertions)
node test-code-extract.js && node test-basic-runner.js && node test-reasoning-os.js
```

## Project Structure

```
eval.js                          — Core evaluation pipeline
providers.js                     — Ollama Cloud model provider
code-extract.js                  — Delta 1: code extraction (validated ✓)
reasoning-os.js                  — OS v0 instrumentation + sig-repair
informed-repair.js               — R4: concrete test-failure feedback
invariant-constrained-generation.js — Delta 6: ICG (null result)
constraint-ordering.js           — Delta 3: constraint reordering (not wired)
decomposition-delta.js           — Delta 4: task decomposition (not wired)
problems.js                      — Problem definitions (N=8 standard + N=4 stress)
testcases-expansion/             — Extended problem set (LeetCode-style)
held-out-test-suites.js           — Frozen held-out test suites
run-*.mjs                        — Runner scripts for various experiments
validation-runs/                 — Experiment results (git-ignored)
references/                       — Design docs, results, analysis
KNOWLEDGE.md                      — Full project knowledge file
```

## Pivot: OP Harness (Next Phase)

Based on the K0 and PGG Phase 1 results, the next phase moves from post-hoc annotation/static assertions to **dynamic, failure-conditioned interventions**:

1. **Dynamic constraint compiler**: Generate runnable assertions only from observed failures, not static curated examples for every problem.
2. **Diagnostician-in-the-loop**: Agent reads failure traces, classifies failure mode, generates targeted intervention per-class.
3. **Domain expansion**: Constraint satisfaction / planning problems where semantic constraints have leverage, not just LeetCode.
4. **Pre-registered kill criteria (K1-K5)**: Each experiment has a null-result threshold before proceeding.

See the OP Harness brainstorm (Claude Opus, 2026-05-26) for full architecture proposal.

## License

MIT