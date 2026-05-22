/**
 * eval-harness — Restart-resilient ablation runner for shaper-autorepair scaffold evaluation
 *
 * BASELINE DEFINITIONS (revised 2026-04-24):
 *
 *   raw_base       — Kimi K2.5 with no scaffold wrapper. Coder prompt only → code.
 *                    Data already collected: 2/4 (binary-search ✓, climbing-stairs ✓)
 *   gen0_seed      — Shaper + Coder two-step pipeline, autorepair OFF.
 *                    Tests: did the seed architecture (task decomposition) add value?
 *   gen18_evolved  — Full pipeline: Shaper → Coder → Verifier, autorepair ON (as trained).
 *                    Tests: did iteration + autorepair evolve the pipeline beyond seed?
 *
 * PIPELINE BEHAVIOR:
 *   raw_base:      Single call to coder
 *   gen0_seed:     Shaper (JSON spec) → Coder (code) — no verifier, no autorepair
 *   gen18_evolved:  Shaper → Coder → Verifier → [fail? → autorepair loop] → final
 *
 * AUTOREPAIR LOOP (gen18 only):
 *   On verifier fail: runCoder with feedback → runVerifier → max MAX_AUTOREPAIR cycles
 *   If all cycles fail, attempt is marked failed
 *
 * ERROR HANDLING PER STAGE:
 *   Shaper fails:     retry from shaper (exponential backoff on shaper call)
 *   Coder fails:      retry from coder (shaper result cached, reuse it)
 *   Verifier fails:   trigger autorepair (coder gets feedback, re-verify)
 *   Autorepair loops: max MAX_AUTOREPAIR per attempt; tracked separately in attempt metadata
 *
 * GEN 0 RECONSTRUCTION NOTE:
 *   "gen0_seed" is a principled proxy, not literal pre-iteration state.
 *   The original shaper-autorepair run did not persist change logs at generation boundaries.
 *   Ablation results must be reported as: "gen18_evolved vs gen0_seed (reconstructed)".
 *
 * METRICS:
 *   pass@1 strict — first-attempt pass (primary signal)
 *   pass@N lenient — any-attempt pass (secondary, inflated by retries)
 *   waitMs — backoff/wait time per attempt
 *   modelMs — model call time per attempt
 *   autorepairCycles — number of repair cycles in this attempt (gen18 only)
 */

export const HARNESS_VERSION = "0.2.0";
export const MAX_ATTEMPTS = 3;
export const MAX_AUTOREPAIR_CYCLES = 2; // per attempt
export const STATE_FILE = "./eval-harness-state.jsonl";
export const PROBLEMS_DIR = "../shaper-autorepair/testcases";

export type BaselineKind = "raw_base" | "gen0_seed" | "gen18_evolved";
export type ProblemStatus = "pending" | "running" | "done";
export type AttemptError = "timeout" | "rate_limit" | "compile_error" | "wrong_answer" | "model_error" | "success";
export type StageError = "shaper_error" | "coder_error" | "verifier_error" | "autorepair_exhausted" | "spec_validation" | "timeout" | "rate_limit" | "model_error";
export type AttemptFailureKind = "pass" | "logic_assertion" | "format_protocol" | "timeout" | "spec_validation" | "model_error";

export interface AttemptResult {
  attempt: number;
  pass: boolean;
  error?: AttemptError;
  errorDetail?: string;
  waitMs: number;
  modelMs: number;
  autorepairCycles: number;
  stageFailed?: StageError;
  failureKind?: AttemptFailureKind;
}

export interface ProblemResult {
  status: ProblemStatus;
  attempts: AttemptResult[];
  finalPass: boolean;
  passAt1: boolean;
}

export interface RunState {
  runId: string;
  baselineKind: BaselineKind;
  model: string;
  problems: Record<string, ProblemResult>;
  started: string;
  updated: string;
}