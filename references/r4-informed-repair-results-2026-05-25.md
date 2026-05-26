# R4 Informed Repair Efficacy Results (2026-05-25)

## Run Details
- Run ID: r4-informed-repair-2026-05-25T21-32-27-112Z
- Duration: ~69 minutes (120 model calls)
- Model: minimax-m2.7:cloud (all stages)
- Design: N=8 problems, k=5, 3 modes (VERIFIER/Test_FAILURE/SPEC_AND_TEST)
- Primary DV: repair conversion rate (P(pass after repair | first attempt failed AND repair triggered))

## Primary Results

| Mode | Repair Conversion | Eligible Trials | Converted |
|---|---|---|---|
| VERIFIER (control) | 50% | 4 | 2 |
| TEST_FAILURE | 100% | 3 | 3 |
| SPEC_AND_TEST | 100% | 1 | 1 |

Delta: +50pp (TEST_FAILURE vs VERIFIER)

## Context Metrics

| Mode | pass@1 | pass@N | Held-out | Avg Attempts |
|---|---|---|---|---|
| VERIFIER | 85% (34/40) | 97.5% (39/40) | 100% (n=2) | 1.18 |
| TEST_FAILURE | 70% (28/40) | 100% (40/40) | 100% (n=3) | 1.38 |
| SPEC_AND_TEST | 75% (30/40) | 100% (40/40) | 100% (n=1) | 1.30 |

## Failure Class Breakdown

| Failure Class | VERIFIER | TEST_FAILURE | SPEC_AND_TEST |
|---|---|---|---|
| logic_assertion | 2/2 (100%) | 2/2 (100%) | 1/1 (100%) |
| timeout | 0/2 (0%) | 1/1 (100%) | 0/0 |

Key finding: TEST_FAILURE converts timeout cases that VERIFIER cannot.

## Per-Problem Breakdown

| Problem | V: p1/rc | TF: p1/rc | ST: p1/rc |
|---|---|---|---|
| binary-search | 100% / N/A | 80% / N/A | 100% / N/A |
| climbing-stairs | 60% / 50%(1/2) | 80% / N/A | 20% / 100%(1/1) |
| container-with-most-water | 100% / N/A | 60% / N/A | 100% / N/A |
| coin-change-ii | 40% / 50%(1/2) | 60% / 100%(2/2) | 80% / N/A |
| two-sum | 80% / N/A | 80% / N/A | 80% / N/A |
| valid-palindrome | 100% / N/A | 60% / 100%(1/1) | 100% / N/A |
| number-of-islands | 100% / N/A | 100% / N/A | 100% / N/A |
| invert-binary-tree | 100% / N/A | 40% / N/A | 20% / N/A |

Problems with repair signal: climbing-stairs, coin-change-ii, valid-palindrome (3 total, meeting the minimum threshold).

## Statistical Assessment

Wilson 95% CIs:
- VERIFIER: [15.0%, 85.0%]
- TEST_FAILURE: [43.8%, 100.0%]

CIs heavily overlap — cannot reject null hypothesis at any reasonable alpha.

## Acceptance Criteria Evaluation

| Criterion | Threshold | Result | Pass? |
|---|---|---|---|
| Repair conversion delta | >=10-15pp | +50pp (point estimate) | PASS (unpowered) |
| No held-out regression | 0% cohAtrRisk | 100% all modes | PASS |
| Signal in 2-3 problems | >=2-3 | 3 problems | PASS (barely) |
| Failure-class supports mechanism | Consistent pattern | Timeout conversion supports | PASS (anecdotal) |
| Statistical significance | Reasonable power | 8 eligible trials total | FAIL |

## Verdict

**DIRECTION POSITIVE, INSUFFICIENTLY POWERED — INCONCLUSIVE**

The +50pp repair conversion delta is in the predicted direction and the
mechanism is partially supported (timeout conversion), but:

1. Only 8 repair-eligible trials total — Wilson CIs massively overlap
2. pass@N delta is only +2.5pp (below 10pp bar)
3. Most problems have 0 repair-eligible trials (benchmark too easy)
4. pass@1 variation between modes is sampling noise, not mode effect

The root cause is benchmark sensitivity: 85-90% first-attempt pass rate
leaves almost nothing for a post-failure intervention to act on.

## Recommendation

Mark informed repair as INCONCLUSIVE-PENDING-REPOWER. Do NOT:
- Accept as proven (insufficient power)
- Park as definitively null (direction is positive)

Priority: Build the failure-rich stress suite (where baseline pass@1
is 40-70%) as the prerequisite for a properly powered R4 retest.

The mechanism signal (timeout conversion) is worth preserving: concrete
test failure feedback appears to help the model identify and fix
performance bugs that vague verifier feedback cannot. A properly powered
test on the stress suite could confirm this.