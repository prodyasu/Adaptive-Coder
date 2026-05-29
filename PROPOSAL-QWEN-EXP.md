# Qwen3.6-35B-A3B Experiment Proposal
## Scalable Next Experiment for shaper-coder eval harness

**Date:** 2026-05-27  
**Author:** Hermes (orchestrator)  
**Thread:** T_SHAPER_CODER  
**Symbols:** `MOSS_eval-harness`, `RULE_PRIM`, `PERM_GRAD`, `MOSS_pgg-static` (superseded)

---

## Problem Statement

Mitch wants to test **Qwen3.6-35B-A3B** (MoE, 3B active / 35B total) in the eval harness to see if it achieves notable improvement over base best-of-5 on stress problems. The PGG-static approach is dead (finding c3eed775), and K0 kill test showed simple best-of-5 is the mandatory baseline (finding 690908d1). The harness currently runs minimax-m2.7:cloud via an Ollama Cloud shim.

**Key question:** Not just "does Qwen score better?" but **"does Qwen respond to the same intervention differently than minimax, consistent with RULE_PRIM?"** — i.e., do the installed behavior rules differ in a measurable, exploitable way?

---

## Architecture Analysis

### Provider Abstraction

Current: `providers.js` → `callOllama(model, messages, opts)`  
Environment vars: `OLLAMA_BASE_URL`, `OLLAMA_API_KEY` / `OLLAMA_CLOUD_API_KEY`  
Model routing: `getModelForStage('shaper'|'coder'|'verifier')` in `eval.js` lines 152-161 — each stage reads from `process.env.SHAPER_MODEL || 'minimax-m2.7:cloud'` etc.

**Qwen is not available via Ollama** — must use OpenRouter (`qwen/qwen3.6-35b-a3b`) or another provider.

**Proposed abstraction:**

```
providers.js        ← existing Ollama Cloud shim (unchanged)
providers-openrouter.js ← new: mirrors callOllama API surface
```

Swapping mechanism: env var `PROVIDER` = `'ollama'` | `'openrouter'`. Provider module selected at import time or via factory function. `eval.js` calls generic `callModel(model, messages, opts)` which delegates to the active provider. No changes to `eval.js` pipeline logic.

### Stress Suite Discriminativity Gap

Per Moss inbox #124: current stress suite has only **1 genuinely hard problem** (edit-distance, 0% pass@1 at 90s). Three of four problems are too easy (word-break/valid-sudoku 100% pass@1, detect-cycle 80%).

**Recommendation:** Before or alongside the Qwen experiment, replace word-break and valid-sudoku with harder candidates (longest-increasing-subsequence, course-schedule-ii, critical-connections) per Moss's recommendations. This is a prerequisite for measuring improvement — if Qwen saturates at 100% on all problems, there's no room to measure anything.

---

## Experiment Design: Two-Stage

### Stage 1: Establish Qwen Baselines (Establishes RULE_PRIM Observational Data)

Run **before** any intervention, same problems, same k=5, two baselines back-to-back:

| Arm | Model | Pipeline | k | Goal |
|-----|-------|----------|---|------|
| **A** | minimax-m2.7:cloud | gen18_evolved | 5 | Reference baseline (existing reference) |
| **B** | qwen/qwen3.6-35b-a3b | gen18_evolved | 5 | New model baseline |

This answers: **Does Qwen score differently from minimax on the same problems with the same pipeline?** The delta gives us RULE_PRIM observational data — the Qwen's installed behavior rules produce different outputs even when task/prompt is identical.

**Primary DV:** pass@1, pass@N  
**Secondary DVs:** held-out pass rate, cohAtrRisk, self-correction count (all already instrumented)

**Statistical design:** N=8, k=5, same problems as minimax baseline. Wilson CIs. If Qwen significantly outperforms minimax, go straight to Stage 2 with intervention on Qwen. If Qwen matches or underperforms, intervention hypothesis must be stronger.

### Stage 2: Intervention Test on Qwen

If Stage 1 shows Qwen ≠ minimax (whether better or worse):

| Arm | Model | Pipeline | Intervention | Goal |
|-----|-------|----------|--------------|------|
| **C** | qwen/qwen3.6-35b-a3b | gen18_evolved | Delta 3: Constraint Ordering | Does Qwen respond to constraint ordering? |
| **D** | qwen/qwen3.6-35b-a3b | gen18_evolved | Delta 4: Informed Repair (TEST_FAILURE mode) | Does Qwen use concrete failure feedback? |

**Why these interventions?**
- **Delta 3 (constraint ordering):** Acts at generation time (satisfies PERM_GRAD) — reorders spec constraints before code is written, targeting the model's attention allocation. Qwen's DeltaNet sparse attention may exhibit different sensitivity to constraint ordering than minimax.
- **Delta 4 (informed repair, TEST_FAILURE):** Provides concrete test failure feedback to the coder on retry. The earlier R4 run showed null efficacy on minimax with VERIFIER mode — but TEST_FAILURE mode was never tested, and Qwen's thinking mode may process failure feedback differently.

**Alternative intervention (if thinking mode is the bet):**
Run Qwen in `think: true` mode (OpenRouter supports `reasoning` parameter). Arm D': Qwen with reasoning enabled vs Qwen without. This tests whether Qwen's built-in self-correction through thinking traces improves pass@1 on hard problems.

---

## Infrastructure Requirements

### 1. OpenRouter Provider Shim (`providers-openrouter.js`)

Tasks:
- [ ] Write `providers-openrouter.js` exporting `callOpenRouter(model, messages, opts)` with same signature as `callOllama`
- [ ] Handle OpenRouter-specific: `Authorization: Bearer $OPENROUTER_API_KEY`, base URL `https://openrouter.ai/api/v1`, model string `qwen/qwen3.6-35b-a3b`
- [ ] Handle `think: false` / `reasoning` parameter for thinking mode variant
- [ ] Map response to same `{ content, model, usage }` shape as `callOllama`
- [ ] Handle errors: 429 → `OllamaRateLimitError`, timeouts → `OllamaTimeoutError`, HTTP errors → `OllamaNetworkError`
- [ ] Add test file with same pattern as other test files

### 2. Provider Swapping Mechanism

Tasks:
- [ ] Env var `PROVIDER=ollama|openrouter`
- [ ] Entry point script (`run-qwen-experiment.mjs`) sets `PROVIDER=openrouter` before importing eval modules
- [ ] OR: factory function in `providers.js` that returns the appropriate caller based on env
- [ ] Document the swappable provider pattern in KNOWLEDGE.md

### 3. Stress Suite Harder Problems (Preferrable before Stage 1)

Tasks:
- [ ] Add longest-increasing-subsequence problem to stress suite
- [ ] Add course-schedule-ii or critical-connections to stress suite  
- [ ] Remove or deprioritize word-break and valid-sudoku (too easy)
- [ ] Verify new problems have meaningful failure distribution at 90s

### 4. OpenRouter Credentials

- [ ] Mitch needs an OpenRouter account (free tier: $1 on signup, no card required apparently — verify)
- [ ] Set `OPENROUTER_API_KEY` env var
- [ ] Set `PROVIDER=openrouter`
- [ ] Set `QWN_MODEL=qwen/qwen3.6-35b-a3b` or use env var for model

---

## Proposed Scripts

### `run-qwen-baseline.mjs` — Stage 1

```js
// Arms: minimax Bo5 (A) vs Qwen Bo5 (B)
// MODEL arg: node run-qwen-baseline.mjs --arms=a,b --model=minimax-m2.7:cloud
// Dry run: node run-qwen-baseline.mjs --dry-run
```

### `run-qwen-intervention.mjs` — Stage 2

```js
// Arms: Qwen Bo5 (C) vs Qwen + constraint ordering (D)
// Runs only after Stage 1 results analyzed
```

---

## Scalability Considerations

The provider abstraction is the key to scalability. Once `providers-openrouter.js` exists:

1. **Any OpenRouter model** can be tested by changing the model string env var
2. **Groq** is another candidate provider (has free tier, fast inference) — would need a `providers-groq.js` shim following the same API
3. **Local models** via Ollama remain as-is — provider shim factory lets harness switch between local/cloud/remote without code changes
4. **New provider format** only requires adding a new provider file, not modifying eval.js

This makes the harness a **multi-model evaluation platform**, not a single-model experiment-specific tool.

---

## Coordination with Claude (Inbox msg #126)

Sent question to Claude asking for input on:
1. OpenRouter provider abstraction architecture
2. Best intervention hypothesis for Qwen consistent with RULE_PRIM
3. One-shot vs two-shot experiment design
4. Concerns about stress suite discriminativity for a potentially stronger model

**Awaiting response before finalizing the experiment script.**

---

## Success Criteria

- Stage 1 arm comparison: real delta detected (either direction) OR established equivalence with narrow CIs
- Stage 2 arms: Delta 3 or Delta 4 shows statistically detectable improvement over Qwen Bo5 baseline — target: +10pp pass@1 on hard problems
- Provider abstraction: works with $0 new credentials (OpenRouter free tier sufficient for initial smoke test)
- Scalability: new model provider added with <1 new file + env var change

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-------------|
| OpenRouter free tier insufficient for run (rate limits) | Medium | Use Groq as fallback provider (also has free tier, different rate limit pool) |
| OpenRouter pricing > $1 on new account | Low | Smoke test with 20 trials before full run |
| Qwen is worse than minimax on these problems | Medium | Stop, don't run intervention arms — Qwen is not the lever |
| Qwen saturates at 100% (no room to measure) | Low if harder problems added | Add harder problems first |
| Provider abstraction changes introduce bugs | Medium | 100% test coverage on new provider shim; parallel run with minimax validates no regression |

---

## Filing Decision

After Claude's response and any revisions, file as a status=proposed entry in Section VII (T_SHAPER_CODER successor thread TBD). Target next state change: when Stage 1 results land and Stage 2 is greenlighted.
