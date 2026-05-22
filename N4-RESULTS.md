# Ablation Results — Gen 18 vs Gen 0 Seed (N=4 Held-Out)
**Date:** 2026-04-24
**Status:** Phase 1 complete — N=4 genuine held-out data. Headline claim pending expanded run.

---

## Eval Design

**Baseline definitions (v0.2.0, corrected from v0.1):**

| Baseline | Definition | What it tests |
|----------|------------|---------------|
| raw_base | Coder-only, no scaffold | Does bare coder work? (1 call = cost baseline) |
| gen0_seed | Shaper + Coder, no autorepair | Does task decomposition add retry value? |
| gen18_evolved | Full pipeline (Shaper→Coder→Verifier), autorepair ON | Did 79 iterations produce prompts that generalize to first-attempt success? |

**IMPORTANT:** Autorepair (gen18) was not independently tested — it was OFF during gen0_seed evaluation. gen18_evolved passes all 4 problems with AR cycles=0. The 79 modifications include autorepair infrastructure, but the improvement appears to come from prompt evolution, not the repair loop firing.

**Pipeline:** MiniMax for shaper+verifier (reliable), Kimi for coder (was rate-limited; all models now MiniMax to avoid bottleneck)

**Test problems:** binary-search, climbing-stairs, container-with-most-water, coin-change-ii  
**Contamination check:** None in training set (11 training problems confirmed distinct)  
**Problem selection:** Not curated — all 4 from testcases/ were used; no selection bias toward gen18's strengths

---

## Results

### Pass@1 (first-attempt pass rate)

| Problem | raw_base | gen0_seed | gen18_evolved |
|----------|----------|-----------|---------------|
| binary-search | ✓ | ✓ | ✓ |
| climbing-stairs | ✓ | ✓ | ✓ |
| container-with-most-water | ✗ | ✗ | ✓ |
| coin-change-ii | ✗ | ✗ | ✓ |
| **pass@1** | **2/4** | **2/4** | **4/4** |

### Pass@N (any-attempt pass rate)

| Problem | raw_base | gen0_seed | gen18_evolved |
|----------|----------|-----------|---------------|
| binary-search | ✓ | ✓ | ✓ |
| climbing-stairs | ✓ | ✓ | ✓ |
| container-with-most-water | ✗ | ✓ | ✓ |
| coin-change-ii | ✗ | ✓ | ✓ |
| **pass@N** | **2/4** | **4/4** | **4/4** |

---

## Key Findings

### Finding 1: gen18 first-attempt improvement on novel problems (2/4)
gen18_evolved achieves first-attempt success on 2 problems where both raw_base and gen0_seed fail on first attempt (container-with-most-water, coin-change-ii). This is the primary signal. It is:
- Consistent with **structural evolution** (79 modifications produced prompts that generalize to novel problems)
- Inconsistent with **no contribution** (gen18 > gen0 on pass@1)
- Inconsistent with **autorepair overfit** (gen18 > gen0 despite having the same autorepair infrastructure available but not firing)

### Finding 2: Scaffold improves retry recovery, not initial framing (gen0_seed vs raw_base)
gen0_seed and raw_base have identical pass@1 (2/4) but gen0_seed recovers both hard problems on retry (pass@N=4/4) while raw_base does not (pass@N=2/4). This means:
- Task decomposition does not help the coder think better the first time
- It gives the system something more productive to do on retry
- Claim: "scaffold improves recovery, not initial framing"

### Finding 3: Scaling-with-difficulty hypothesis (within-set evidence)
Difficult problems (raw_base fails first attempt): gen18 gap = +2/2  
Easy problems (raw_base passes first attempt): gen18 gap = +0/2  

Within N=4: scaffold contribution concentrated on harder problems. Hypothesis supported — expand to confirm.

### Finding 4: Autorepair zero cycles (gen18_evolved)
AR fired 0 times on all 4 problems. gen18 succeeded via first-attempt spec quality, not repair loops. This means:
- The 79 modifications include autorepair infrastructure, but improvement appears to come from prompt evolution
- Autorepair may have shaped prompts indirectly via training signal, not via being present at eval time
- Autorepair's independent contribution is NOT tested by this eval — could be zero or could be indirect via training shaping

---

## What This Result Does NOT Claim

- **NOT "generalization" in the strong sense** — at N=4, confidence intervals are wide. Effect size could be anywhere from ~50% to ~100%. Expanded run required before headline claim.
- **NOT "autorepair adds value"** — autorepair was not tested independently; gen18 succeeded without it firing
- **NOT "prompt-evolution vs prompt-polish"** — N=4 can't distinguish these; larger N needed
- **NOT "across problem structures"** — all 4 problems are algorithmic/array; string/tree/DP/structure variety not tested

---

## Predictions for Expansion (Pre-Registered 2026-04-24)

| Metric | Prediction |
|--------|------------|
| gen18_evolved pass@1 | 50-60% (moderate generalization, smaller than 4/4 suggests) |
| gen0_seed pass@1 | 20-30% (below 30-50 band — scaffold helps on harder problems more) |
| If gen18 hits 70%+ pass@1 | Strong evidence of structural evolution, effect scales |
| If gen18 regresses to ~30% pass@1 | 4-problem signal was lucky draw; scaffold = prompt-polish |

**Difficulty-scaling bucketed analysis:** Post-expansion, analyze gap-by-difficulty-bucket (easy vs mid vs hard) to test whether scaffold contribution scales with difficulty as hypothesized.

---

## Next Steps

1. **N=4 writeup** (this doc) — logged, not yet written to project record
2. **Held-out construction** — new problems from outside testcases/, difficulty-calibrated against base, variety across problem structures, pre-registered predictions before running
3. **Full matrix** — gen0_seed vs gen18_evolved on expanded held-out with bucketed difficulty analysis

---

## Methodological Notes

- Catch-before-concluding: The "expand from testcases/" plan was blocked when training list and candidate pool were co-listed — revealed that the remaining 11 problems ARE the training set. Quick expansion from disk was an illusion; real held-out requires new construction.
- Pre-registration discipline: Predictions registered before expansion run; post-hoc explanation suppressed.
- Separation of evidential status: This writeup covers N=4 data only. Expanded run will have separate writeup with distinct evidential status — N=4 and expanded results will NOT be combined into single blurry claim.