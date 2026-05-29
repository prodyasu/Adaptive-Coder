# Research Scout: Mechanisms That May Beat Best-of-N for Code Generation

Date: 2026-05-28
Research agent: minimax-m2.7:cloud via Hermes delegate_task
Purpose: arm the Adaptive Coder / OP Harness with current source-backed mechanisms that may beat or improve over plain best-of-N/pass@k retry under execution/test/compiler feedback.

## Bottom line

More research is useful, but only if it targets mechanisms that can beat the current K0 bar: plain best-of-N retry.

The most relevant clusters are:

1. **Execution-feedback ranking / pass@k-optimized reranking** — strongest near-term fit. Rank a candidate pool using execution feedback instead of random/first-pass selection.
2. **In-execution trace self-debugging** — promising for hard problems because it uses intermediate runtime state, not unreliable self-generated final tests.
3. **Property/predicate-guided filtering** — useful as an evaluator and repair signal, but self-generated tests are unreliable unless constrained/validated.

Static curated PGG should not be revived as-is. The viable successor is dynamic, failure-conditioned predicates: failure trace → diagnostician → generated runnable checks/properties → repair/rerank.

## Sources and mechanisms

### Verifier-guided / execution-feedback-guided generation or reranking

#### RankEF: Sifting through the Chaff (ASE 2024)

- URL: https://dl.acm.org/doi/10.1145/3691620.3695000
- Mechanism: Multi-task execution-feedback ranker; classifies code and generates/uses feedback explaining why code is wrong.
- Evidence reported by scout: +30.97% pass@1, +31.43% pass@2, +19.51% pass@5 on APPS versus CodeRanker baseline.
- Best-of-N relevance: Yes, directly improves selection among generated candidates.
- Harness applicability: High. We already produce candidate code and execution results; a lightweight ranker can sit after generation.
- Caveat: Needs training data: task, candidate, execution feedback, pass/fail labels.

#### Top Pass: Pass@k-Maximized Code Ranking (arXiv 2024)

- URL: https://arxiv.org/html/2408.05715v1
- Mechanism: Ranking objective directly optimizes pass@k rather than binary pass/fail classification.
- Evidence reported by scout: +32.9% pass@1 relative vs CodeRanker on CodeContests; +6.8% on APPS pass@1; near 1.9x pass@1 vs standalone DeepSeek-Coder in cited setup.
- Best-of-N relevance: Yes; explicitly targets candidate ranking under pass@k.
- Harness applicability: High if we collect enough candidate pools and labels.
- Caveat: Ranking cannot rescue a pool with zero correct candidates; candidate diversity still matters.

#### EG-CFG: Execution Guided Line-by-Line Code Generation (arXiv 2025)

- URL: https://arxiv.org/html/2506.10948v1
- Mechanism: Real-time line-by-line execution signals injected as soft guidance during inference via classifier-free guidance.
- Evidence reported by scout: 96.6% on MBPP vs 82.8% baseline; 73.0% on MBPP-ET using DeepSeek-V3-0324.
- Best-of-N relevance: It is a generation-time intervention, not just reranking; plausibly beats retry by steering generation.
- Harness applicability: Medium. Conceptually valuable, but implementation likely needs logprobs/dual-distribution sampling support.
- Key steal: Line-level/intermediate execution feedback may be more useful than final pass/fail.

#### CodePRM: Execution Feedback-enhanced Process Reward Model (ACL Findings 2025)

- URL: https://aclanthology.org/2025.findings-acl.428/
- Mechanism: Process reward model trained on thought/code traces labeled with derived pass rates and execution feedback; used in Generate-Verify-Refine.
- Evidence reported by scout: Outperforms strong baselines on code generation benchmarks.
- Best-of-N relevance: Yes, if the GVR loop dynamically selects/refines candidates better than plain retry.
- Harness applicability: Medium-low for immediate work; high complexity, requires separate PRM training.
- Key steal: Process-level reward from execution traces, not just final result classification.

### Self-debugging / repair loops

#### Is Self-Repair a Silver Bullet for Code Generation? (ICLR 2024)

- URL: https://openreview.net/forum?id=y0GJXRungR
- Mechanism studied: generate → execute → feedback → repair loop.
- Findings reported by scout:
  - Gains are modest/inconsistent across models and datasets.
  - Feedback quality is the bottleneck.
  - Human feedback gives much higher repair rate than GPT-4 feedback in their setting.
  - Increasing initial sample diversity matters more than increasing repair attempts; one repair attempt is often optimal.
- Best-of-N relevance: Mixed. Useful mainly on harder problems where feedback is good.
- Harness applicability: Very high as a caution. Diagnose/feedback quality matters more than adding retry loops.
- Design implication: K1 diagnostician accuracy should be treated as a hard gate.

#### Revisit Self-Debugging with Self-Generated Tests (ICLR 2025)

- URL: https://openreview.net/forum?id=hYd6BCZTzg
- Mechanisms studied:
  - Post-execution self-debugging with self-generated tests.
  - In-execution self-debugging using intermediate runtime states.
- Findings reported by scout:
  - Post-execution self-debugging can hurt on HumanEval/MBPP because self-generated tests have incorrect expected outputs and can mislead the model.
  - In-execution state feedback is more promising because it avoids false final-test oracle errors.
  - On LiveCodeBench, label-only feedback showed some positive potential on harder problems.
- Best-of-N relevance: Mixed; in-execution trace approach is the more promising part.
- Harness applicability: High. Dynamic PGG should prefer trace/state-derived predicates over unconstrained self-generated tests.

#### LeDex: Training LLMs to Better Self-Debug and Explain Code (NeurIPS 2024)

- URL: https://neurips.cc/virtual/2024/poster/94367
- Mechanism: Training models for self-debugging and explanation.
- Evidence: Scout did not extract enough concrete beat-best-of-N evidence.
- Harness applicability: Medium-low for immediate work.
- Flag: Needs deeper verification before using as evidence.

### Generated tests / assertions / property-based / metamorphic testing

#### Rethinking LLM Code Generation with Property-Based Testing (FSE 2025)

- URL: https://dl.acm.org/doi/10.1145/3696630.3728702
- Mechanism: Combine unit tests with property-based testing; generate/validate high-level properties.
- Evidence reported by scout:
  - 18–23% of solutions can pass unit tests but fail property-based tests.
  - 30–32% partially adhere to properties but fail stronger PBT checks.
- Best-of-N relevance: Primarily evaluation/reranking, not generation. It can identify false positives among unit-test passers.
- Harness applicability: High for benchmark correctness and candidate filtering.
- Key steal: Use properties as additional selection/repair signals, not as blindly trusted self-generated oracles.

#### Property-Generated Solver (PGS) (arXiv 2025)

- URL: https://arxiv.org/html/2506.18315v1
- Mechanism: Property-based testing to validate high-level program properties and filter/correct candidates.
- Evidence: Scout did not extract enough to treat it as confirmed.
- Harness applicability: Medium. Closest conceptual neighbor to dynamic PGG.
- Flag: Candidate for deeper follow-up, not yet a design anchor.

### Failure diagnosis / trace classification / routing

#### L4: Diagnosing Large-scale LLM Training Failures (FSE 2025)

- URL: https://arxiv.org/html/2503.20263v1
- Mechanism: Automated diagnosis from LLM training logs.
- Harness applicability: Low; it is training failure diagnosis, not code generation repair.
- Flag: Weak match.

### Benchmark methodology

#### LiveCodeBench (ICLR 2025)

- URL: https://livecodebench.github.io/
- Mechanism: Time-windowed coding benchmark collected from recent contest problems to reduce contamination.
- Harness relevance: Strong. Use for serious capability claims when HumanEval/MBPP are ceilinged or contaminated.

#### SWE-bench / SWE-bench Verified

- URL: https://www.swebench.com/
- Mechanism: Real GitHub issue resolution tasks; Verified is human-validated subset.
- Harness relevance: Good for agentic repo work, less pure for single-function code generation.

#### BigCodeBench

- URL: https://bigcode-bench.github.io/
- Mechanism: Larger, more practical code generation tasks.
- Harness relevance: Good candidate if we need richer API/function-call tasks without full SWE-bench complexity.

## Hype / weak-evidence flags

- LeDex: potentially relevant, but no clear pass@k/best-of-N evidence extracted.
- Property-Generated Solver: conceptually relevant, but too little evidence extracted in this scout.
- Generic self-repair/code-agent blog claims: treat skeptically unless they compare against best-of-N and account for feedback quality.
- Post-execution self-generated tests: high risk of false oracle errors; can actively break correct code.

## Candidate mechanisms for OP Harness

### Candidate 1: Execution-feedback ranker

Implement a local candidate-ranker experiment.

- Generate N candidates per problem.
- Run primary/held-out/property checks.
- Build execution-feedback features: failure class, failing assertions, stderr, timeout/network flags, maybe code complexity.
- Rank candidates by a learned or heuristic score.
- Compare against random/first-passing best-of-N selection.

Primary metric:
- pass@1 of selected candidate, compared to best-of-5/first-pass selection.

Kill criteria:
- If ranker does not improve selected pass@1 over best-of-5 within confidence interval, kill.
- If overhead exceeds 2x best-of-N cost for small lift, kill or simplify.

### Candidate 2: In-execution trace diagnostic repair

Implement one-shot repair only after a genuine logic failure, not after infra failures.

- On failed candidate, capture execution trace/intermediate states for the first failing primary or generated check.
- Diagnostician classifies failure and writes a compact repair hint.
- Coder retries once with original spec + failure trace + hint.

Primary metric:
- repair conversion rate: P(pass after repair | first attempt failed and intervention fired).

Kill criteria:
- Diagnostician accuracy below 70% -> mechanism inert.
- Repair conversion lift below +10pp versus verifier-only/test-failure baseline -> kill.
- More than 2x cost per pass versus best-of-N -> kill.

### Candidate 3: Failure-conditioned dynamic predicates

This is the dynamic PGG successor.

- Do not use static curated assertions as the main bet.
- After a failure, generate 2–4 runnable predicates specifically targeting the observed failure mode.
- Validate predicates against reference solution if available, or against multiple independently generated candidates if no reference exists.
- Use predicates as rejection filters and as repair feedback.

Primary metrics:
- predicate validity rate: percentage of generated predicates passed by known reference solution.
- rejection usefulness: percentage of wrong candidates rejected without rejecting correct candidates.
- repair conversion / pass@N lift versus best-of-N.

Kill criteria:
- Predicate validity < 90% on reference solutions -> unsafe oracle.
- Rejection rate < 5% -> filter inactive.
- Correct-candidate rejection > 2% -> too destructive.
- No repair-conversion lift over baseline -> kill.

## Recommended next experiment

Build the smallest dynamic-predicate microbench:

1. Use 2 discriminative problems first: edit-distance and critical-connections.
2. Generate candidate failures under baseline with provider retries enabled.
3. For each first-failure trace, generate 2 runnable predicates using a diagnostic prompt.
4. Validate predicates against reference.py before using them.
5. Retry once with validated predicates in prompt and/or use them to filter candidates.
6. Compare against best-of-5 and a verifier-only repair baseline.

This directly tests whether dynamic PGG has teeth while avoiding the static PGG failure mode and the self-generated-test false-oracle trap.

## Methodological reminders

- Best-of-5 remains mandatory baseline.
- k=5 is noisy; treat small deltas as directional only.
- Separate model failure, timeout, network error, benchmark ceiling, and true reasoning failure.
- Pass@1 is only primary for pre-generation interventions. For post-failure mechanisms, use repair conversion/pass@N.
- Prefer LiveCodeBench/BigCodeBench-style problems for serious capability claims once the mechanism is debugged locally.
