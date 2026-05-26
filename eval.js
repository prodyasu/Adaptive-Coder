/**
 * eval.js — Single-problem evaluation with correct pipeline modeling
 *
 * Baseline definitions:
 *   raw_base:       Single coder call → code
 *   gen0_seed:     Shaper (JSON) → Coder (code), no verifier, no autorepair
 *   gen18_evolved:  Shaper → Coder → Verifier → [autorepair loop] → final
 *
 * Error taxonomy:
 *   shaper_error, coder_error, verifier_error, autorepair_exhausted, spec_validation
 *   (pipeline stage failures, tracked separately from attempt-level timeout/rate_limit)
 *
 * Retry policy:
 *   timeout/rate_limit on any stage: backoff and retry from that stage
 *   shaper/coder failures: retry from that stage (shaper cached for coder reuse)
 *   verifier failure: trigger autorepair cycle (coder gets feedback, re-verify)
 *   spec validation failure: retry coder with signature guidance (max 1 retry)
 *   gen0_seed: no autorepair (autorepair OFF by definition)
 *   gen18_evolved: autorepair ON (max MAX_AUTOREPAIR_CYCLES per attempt)
 *
 * Pipeline failure handling:
 *   gen0_seed + gen18_evolved: shaper result is cached after first success
 *   On coder failure: reuse cached shaper result, retry coder
 *   On autorepair exhaust: mark attempt failed at "autorepair_exhausted" stage
 */

import { callOllama, OllamaTimeoutError, OllamaRateLimitError, OllamaNetworkError, OllamaModelError } from "./providers.js";
import { extractFromResponse } from "./code-extract.js";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, execFileSync } from "child_process";
import { tmpdir } from "os";
import { loadReference, getPrimarySignature } from "./ref-sig.js";
import { translateSignature, formatPythonSignature } from "./ts-to-py.js";
import { validateSpec, loadExpectedSignature } from "./spec-validator.js";
import { repairSignatureName } from "./sig-repair.js";
import { applyConstraintOrdering } from "./constraint-ordering.js";
import { writeTraceLog } from "./trace-log.js";
import { classifyFailureDetail } from "./failure-metrics.js";
import { runHeldOutTests, calculateCohAtrRisk } from "./held-out-test-suites.js";
import { getDriftName, applyDrift, isDriftEnabled } from "./induced-drift.js";
import { attachSelfCorrectionToTrace } from "./self-correction-logger.js";
import { buildInformedRepairFeedback, INFORMED_REPAIR_MODES, extractTestFailure } from "./informed-repair.js";
import { applyInvariantConstrainedGeneration, formatInvariantsForCoder } from "./invariant-constrained-generation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_TRACE_DIR = join(__dirname, "run-logs");

function recordAttemptTrace({ opts, problemName, baselineKind, attempt, pass, stageFailed, errorDetail, error, failureKind, failureSubKind, failureCode, trace, reasoningOs }) {
  if (opts.traceDir === false) return undefined;
  const detail = classifyFailureDetail({
    pass,
    stageFailed,
    errorDetail,
    error,
    failureKind,
    failureSubKind,
    failureCode,
  });
  try {
    return writeTraceLog({
      dir: opts.traceDir || DEFAULT_TRACE_DIR,
      problemName,
      baselineKind,
      attempt,
      pass,
      stageFailed,
      errorDetail,
      failureKind: detail.kind,
      failureSubKind: detail.subKind,
      failureCode: detail.code,
      trace,
      reasoningOs,
      maxChars: opts.traceMaxChars || 4000,
    });
  } catch (err) {
    console.warn(`[trace-log] failed for ${problemName}/${baselineKind} attempt ${attempt}: ${err.message}`);
    return undefined;
  }
}

const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS) || 25_000;  // 25s default; override via env
const MAX_ATTEMPTS = 5;
const MAX_AUTOREPAIR_CYCLES = 2;
const TIMEOUT_BACKOFF_MS = [5_000, 10_000, 20_000];
const RATE_LIMIT_DELAY_MS = 10_000; // 10s — much shorter, Ollama rate limits clear quickly

// ---------------------------------------------------------------------------
// Pipeline prompts (from shaper-autorepair/src/pipeline.ts)
// ---------------------------------------------------------------------------

const SHAPER_PROMPT = `You are a task decomposition specialist. Analyze the given coding task and produce a structured JSON specification.

Output ONLY valid JSON with this exact schema — no markdown fences, no commentary:
{
  "objective": "Clear statement of what needs to be implemented",
  "constraints": ["List of constraints and requirements"],
  "acceptance_criteria": ["Measurable criteria that define done"],
  "target_files": ["Files that should be created or modified"],
  "context_hints": ["Relevant patterns, libraries, or architectural context"]
}

Rules:
- objective: one concise sentence
- constraints: technical or domain requirements the solution must satisfy
- acceptance_criteria: each must be independently verifiable
- target_files: best-guess file paths based on the task
- context_hints: frameworks, design patterns, or dependencies
- Output raw JSON only`;

const CODER_PROMPT_TEMPLATE = `You are a precise code implementation agent. You receive a TaskSpec and produce complete, working Python code.

CRITICAL CONSTRAINTS:
- Language: Python 3
- Function signature: {{SIGNATURE}}
- Do not change parameter names or order from the signature above
- Use exact types shown in the signature

Rules:
- Implement exactly what the spec asks for. No more, no less.
- Respect every constraint listed in the spec.
- Include all necessary imports and boilerplate.
- Produce code that is ready to use without modification.
- Output ONLY the code. No markdown fences, no commentary, no explanations.`;

const VERIFIER_PROMPT = `You are a Verifier in a Shaper-Coder-Verifier pipeline. Your job is to evaluate whether a Coder's implementation satisfies its TaskSpec.

Evaluate on THREE dimensions:
1. GOAL ACHIEVEMENT: Does the implementation achieve the spec's objective?
2. COMPLETENESS: Are ALL acceptance criteria met?
3. CONSTRAINT COMPLIANCE: Does the implementation respect every constraint?

Set pass=true ONLY if ALL THREE dimensions are fully satisfied.
Set score as a percentage (0-100) of overall spec compliance.

Output ONLY valid JSON matching this schema:
{"pass":boolean,"score":number,"reasoning":"string","suggestions":["string"]|null}`;

// ---------------------------------------------------------------------------
// Model routing — per-stage to avoid rate limits on any single model
//
// MiniMax: reliable for shaper (high-token JSON output, avoid Kimi rate limits)
// Kimi: cleaner coder output, used when budget available
// Any call can be retried on alternate model if timeout/rate-limit
// ---------------------------------------------------------------------------
const SHAPER_MODEL = process.env.SHAPER_MODEL || 'minimax-m2.7:cloud';
const CODER_MODEL = process.env.CODER_MODEL || 'minimax-m2.7:cloud';
const VERIFIER_MODEL = process.env.VERIFIER_MODEL || 'minimax-m2.7:cloud';

// Resolve model for a given stage (with fallback for consistent failures)
const modelCache = { shaper: SHAPER_MODEL, coder: CODER_MODEL, verifier: VERIFIER_MODEL };

function getModelForStage(stage) {
  return modelCache[stage] || SHAPER_MODEL;
}

function swapModel(stage) {
  // If shaper/coder fails repeatedly on one model, swap to alternate
  const alt = { shaper: CODER_MODEL, coder: SHAPER_MODEL, verifier: CODER_MODEL };
  const current = modelCache[stage];
  if (alt[stage] !== current) modelCache[stage] = alt[stage];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Reference signature loading and coder prompt building
// ---------------------------------------------------------------------------

/**
 * Ensure generated Python code has necessary typing imports.
 * Handles cases where coder uses List[int], Dict[K,V], Optional[T] etc.
 * without explicitly importing them.
 */
function ensureTypingImports(code) {
  // If code uses List/Optional/Dict but doesn't import from typing, add the import
  const typingNeeded = [];
  if (code.includes('List[') && !code.includes('from typing import') && !code.match(/import.*List/)) {
    typingNeeded.push('List');
  }
  if (code.includes('Optional[') && !code.includes('from typing import') && !code.match(/import.*Optional/)) {
    typingNeeded.push('Optional');
  }
  if (code.includes('Dict[') && !code.includes('from typing import') && !code.match(/import.*Dict/)) {
    typingNeeded.push('Dict');
  }
  if (typingNeeded.length > 0) {
    // Add import after any existing imports
    const importLine = `from typing import ${typingNeeded.join(', ')}`;
    if (code.match(/^import /m)) {
      // Insert after first import block
      return code.replace(/^(import .*\n)(?!import )/m, `$1${importLine}\n`);
    } else if (code.match(/^from \w+ import/m)) {
      return code.replace(/^(from \w+ import.*\n)(?!from)/m, `$1${importLine}\n`);
    } else {
      // No imports found, prepend
      return `${importLine}\n${code}`;
    }
  }
  return code;
}

function buildCoderPrompt(problemName, driftName = null) {
  // Load reference signature
  const refPath = join(__dirname, "../shaper-autorepair/testcases", problemName, "reference.ts");
  let actualPath = refPath;
  if (!existsSync(refPath)) {
    // Fallback for expansion problems
    actualPath = join(__dirname, "testcases-expansion", problemName, "reference.ts");
    if (!existsSync(actualPath)) {
      // No signature available — use template without signature constraint
      return CODER_PROMPT_TEMPLATE.replace('{{SIGNATURE}}', 'to be determined from spec');
    }
  }
  
  const sigs = loadReference(actualPath);
  const primary = getPrimarySignature(sigs, problemName);
  
  if (!primary) {
    return CODER_PROMPT_TEMPLATE.replace('{{SIGNATURE}}', 'to be determined from spec');
  }
  
  // When drift is enabled, replace function name with drift name in coder prompt
  // so the model generates code using the drifted name. Sig-repair will then
  // restore the original name, testing the full detect→repair→validate cycle.
  const effectivePrimary = driftName
    ? { ...primary, name: driftName }
    : primary;
  
  const pySig = translateSignature(effectivePrimary);
  const formatted = formatPythonSignature(pySig);
  
  return CODER_PROMPT_TEMPLATE.replace('{{SIGNATURE}}', formatted);
}



export async function evalProblem(problemName, baselineKind, model, opts = {}) {
  const { signal } = opts;
  let taskPath = join(__dirname, "../shaper-autorepair/testcases", problemName, "task.txt");
  if (!existsSync(taskPath)) {
    taskPath = join(__dirname, "testcases-expansion", problemName, "task.txt");
  }
  const task = readFileSync(taskPath, "utf8").trim();

  // Route for reasoning_os_v0 baseline (used even before model calls)
  const { routeTask, attachReasoningOsToAttempt } = await import("./reasoning-os.js");
  const route = baselineKind === "reasoning_os_v0"
    ? routeTask({ problemName, baselineKind })
    : null;

  // Internal execution uses gen18 pipeline for reasoning_os_v0
  const effectiveBaselineKind = baselineKind === "reasoning_os_v0" ? "gen18_evolved" : baselineKind;

  const attempts = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let waitMs = 0;
    let autorepairCycles = 0;
    let stageFailed;

    try {
      const result = await runPipeline(problemName, task, effectiveBaselineKind, model, signal, {
        waitMs: 0,
        autorepairCycles: 0,
        originalBaselineKind: baselineKind,
        inducedDrift: opts.inducedDrift || false,
        autorepairFeedbackMode: opts.autorepairFeedbackMode || INFORMED_REPAIR_MODES.VERIFIER,
        icgEnabled: opts.icgEnabled || false,
      });

      const failureDetail = classifyFailureDetail({
        pass: result.pass,
        stageFailed: result.stageFailed,
        errorDetail: result.errorDetail,
      });
      const failureKind = failureDetail.kind;
      let attemptRecord = {
        attempt,
        pass: result.pass,
        error: result.pass ? "success" : undefined,
        errorDetail: result.errorDetail,
        waitMs: result.waitMs,
        modelMs: result.modelMs,
        autorepairCycles: result.autorepairCycles,
        stageFailed: result.stageFailed,
        failureKind,
        failureSubKind: failureDetail.subKind,
        failureCode: failureDetail.code,
        // Propagate held-out + self-correction metrics from trace to attempt record
        primaryPassRate: result.primaryPassRate ?? (result.trace?.primaryPassRate ?? undefined),
        heldOutPassRate: result.heldOutPassRate ?? (result.trace?.heldOutPassRate ?? undefined),
        heldOutPassed: result.heldOutPassed ?? (result.trace?.heldOutPassed ?? undefined),
        heldOutTotal: result.heldOutTotal ?? (result.trace?.heldOutTotal ?? undefined),
        cohAtrRisk: result.cohAtrRisk ?? (result.trace?.cohAtrRisk ?? undefined),
        selfCorrection: result.trace?.selfCorrection ?? undefined,
        sigRepair: result.trace?.sigRepair ?? undefined,
        // Propagate informed repair fields from trace to attempt record (R4 metrics)
        informedRepairFeedback: result.trace?.informedRepairFeedback ?? undefined,
        informedRepairMode: result.trace?.informedRepairMode ?? undefined,
        // Propagate ICG fields from trace to attempt record (Delta 6)
        icg: result.trace?.icg ?? undefined,
      };
      if (route) {
        attemptRecord = attachReasoningOsToAttempt({ attempt: attemptRecord, route, trace: result.trace || result });
      }
      // Self-correction: passive logger, attaches to trace
      attachSelfCorrectionToTrace(result.trace || {}, {
        pass: result.pass,
        autorepairCycles: result.autorepairCycles,
        stageFailed: result.stageFailed,
        errorDetail: result.errorDetail,
      });
      const traceLog = recordAttemptTrace({
        opts,
        problemName,
        baselineKind,
        attempt,
        pass: result.pass,
        stageFailed: result.stageFailed,
        errorDetail: result.errorDetail,
        failureKind,
        failureSubKind: failureDetail.subKind,
        failureCode: failureDetail.code,
        trace: result.trace,
        reasoningOs: attemptRecord.reasoningOs,
      });
      attemptRecord.traceLog = traceLog;
      attempts.push(attemptRecord);

      if (result.pass) break;

    } catch (err) {
      const modelMs = 0;

      if (err instanceof OllamaTimeoutError || err instanceof OllamaRateLimitError) {
        const delay = err instanceof OllamaTimeoutError
          ? (TIMEOUT_BACKOFF_MS[attempt] ?? 20_000)
          : RATE_LIMIT_DELAY_MS;
        waitMs += delay;
        await sleep(delay);
        // Continue to next attempt
        const stageFailed = err instanceof OllamaTimeoutError ? "timeout" : "rate_limit";
        const error = err instanceof OllamaTimeoutError ? "timeout" : "rate_limit";
        const failureDetail = classifyFailureDetail({ pass: false, stageFailed, error, errorDetail: `${TIMEOUT_MS}ms limit` });
        const failureKind = failureDetail.kind;
        let attemptRecord = {
          attempt, pass: false,
          error,
          errorDetail: `${TIMEOUT_MS}ms limit`,
          waitMs, modelMs, autorepairCycles: 0,
          stageFailed,
          failureKind,
          failureSubKind: failureDetail.subKind,
          failureCode: failureDetail.code,
        };
        if (route) {
          attemptRecord = attachReasoningOsToAttempt({ attempt: attemptRecord, route });
        }
        attachSelfCorrectionToTrace({ errorName: err.name, errorMessage: err.message }, {
          pass: false,
          autorepairCycles: 0,
          stageFailed,
          errorDetail: `${TIMEOUT_MS}ms limit`,
        });
        const traceLog = recordAttemptTrace({
          opts,
          problemName,
          baselineKind,
          attempt,
          pass: false,
          stageFailed,
          error,
          errorDetail: `${TIMEOUT_MS}ms limit`,
          failureKind,
          failureSubKind: failureDetail.subKind,
          failureCode: failureDetail.code,
          trace: { errorName: err.name, errorMessage: err.message },
          reasoningOs: attemptRecord.reasoningOs,
        });
        attemptRecord.traceLog = traceLog;
        attempts.push(attemptRecord);
        continue;
      }

      // Model/network errors
      const failureDetail = classifyFailureDetail({
        pass: false,
        stageFailed: "model_error",
        error: "model_error",
        errorDetail: err.message?.slice(0, 100) || "unknown",
      });
      const failureKind = failureDetail.kind;
      let attemptRecord = {
        attempt, pass: false,
        error: "model_error",
        errorDetail: err.message?.slice(0, 100) || "unknown",
        waitMs, modelMs, autorepairCycles: 0,
        stageFailed: "model_error",
        failureKind,
        failureSubKind: failureDetail.subKind,
        failureCode: failureDetail.code,
      };
      if (route) {
        attemptRecord = attachReasoningOsToAttempt({ attempt: attemptRecord, route });
      }
      attachSelfCorrectionToTrace({ errorName: err.name, errorMessage: err.message }, {
        pass: false,
        autorepairCycles: 0,
        stageFailed: 'model_error',
        errorDetail: err.message?.slice(0, 100) || 'unknown',
      });
      const traceLog = recordAttemptTrace({
        opts,
        problemName,
        baselineKind,
        attempt,
        pass: false,
        stageFailed: "model_error",
        error: "model_error",
        errorDetail: err.message?.slice(0, 100) || "unknown",
        failureKind,
        failureSubKind: failureDetail.subKind,
        failureCode: failureDetail.code,
        trace: { errorName: err.name, errorMessage: err.message },
        reasoningOs: attemptRecord.reasoningOs,
      });
      attemptRecord.traceLog = traceLog;
      attempts.push(attemptRecord);
      if (attempt === MAX_ATTEMPTS - 1) break;
    }
  }

  return attempts;
}

// ---------------------------------------------------------------------------
// Pipeline execution per baseline
// ---------------------------------------------------------------------------

async function runPipeline(problemName, task, baselineKind, model, signal, ctx) {
  const trace = {};
  let waitMs = ctx.waitMs || 0;
  let autorepairCycles = ctx.autorepairCycles || 0;

  // Compute drift name for coder prompt injection.
  // When drift is enabled, the coder prompt uses the drifted function name
  // so the model generates code with that name. Sig-repair then restores
  // the original name — testing the full detect→repair→validate cycle.
  const driftName = isDriftEnabled(ctx) ? getDriftName(problemName) : null;

  if (baselineKind === "raw_base") {
    // Single coder call → code
    const t0 = Date.now();
    const response = await callOllama(getModelForStage('coder'), [
      { role: "system", content: buildCoderPrompt(problemName, driftName) },
      { role: "user", content: `Task: ${task}\n\nWrite Python code to solve this. Output only code, no markdown.` }
    ], { timeoutMs: TIMEOUT_MS, signal, maxTokens: 800 });

    const modelMs = Date.now() - t0;
    trace.coderRaw = response.content || "";
    const code = ensureTypingImports(extractFromResponse(response));
    trace.code = code;

    if (!code || code.length < 15) {
      return { pass: false, errorDetail: "empty response", waitMs, modelMs, autorepairCycles, stageFailed: "coder_error", trace };
    }

    // Spec validation gate (warning for raw_base)
    const specValidation = validateSpec(problemName, code);
    if (!specValidation.match) {
      console.warn(`[raw_base] spec mismatch for ${problemName}: ${specValidation.guidance}`);
    }

    const testResult = runBasicTest(problemName, code);
    trace.testDetail = testResult.detail;
    if (testResult.primaryPassRate !== undefined) trace.primaryPassRate = testResult.primaryPassRate;
    if (testResult.heldOutPassRate !== undefined) trace.heldOutPassRate = testResult.heldOutPassRate;
    if (testResult.cohAtrRisk !== undefined) trace.cohAtrRisk = testResult.cohAtrRisk;
    return { pass: testResult.pass, errorDetail: testResult.detail, waitMs, modelMs, autorepairCycles, trace };
  }

  // ---- gen0_seed and gen18_evolved both use shaper + coder ----

  // Step 1: Shaper → JSON spec (maxTokens=1200 sufficient for JSON spec)
  let spec = null;

  const tShaper = Date.now();
  let shaperResponse;
  try {
    shaperResponse = await callOllama(getModelForStage('shaper'), [
      { role: "system", content: SHAPER_PROMPT },
      { role: "user", content: task }
    ], { timeoutMs: 25_000, signal, maxTokens: 1200 }); // 1200 tokens = ~500-800 words JSON, enough for spec
  } catch (err) {
    if (err instanceof OllamaTimeoutError || err instanceof OllamaRateLimitError) {
      const delay = err instanceof OllamaTimeoutError ? TIMEOUT_BACKOFF_MS[0] : RATE_LIMIT_DELAY_MS;
      waitMs += delay;
      await sleep(delay);
    }
    trace.shaperError = err.message || String(err);
    return { pass: false, errorDetail: "shaper failed: " + err.message?.slice(0, 80), waitMs, modelMs: 0, autorepairCycles: 0, stageFailed: "shaper_error", trace };
  }
  const shaperMs = Date.now() - tShaper;
  trace.shaperRaw = shaperResponse.content || "";

  // Extract JSON spec from shaper response
  const raw = shaperResponse.content || "";
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    return { pass: false, errorDetail: "shaper produced no JSON", waitMs, modelMs: shaperMs, autorepairCycles, stageFailed: "shaper_error", trace };
  }

  try {
    spec = JSON.parse(raw.substring(firstBrace, lastBrace + 1));
    trace.spec = JSON.stringify(spec, null, 2);
  } catch {
    return { pass: false, errorDetail: "shaper JSON parse failed", waitMs, modelMs: shaperMs, autorepairCycles, stageFailed: "shaper_error", trace };
  }

  // ── Delta 6: Invariant-Constrained Generation (ICG) ──
  // PERM_GRAD principle: interventions that act at generation time can move outcomes.
  // ICG derives structural invariants from the Shaper spec and injects them into
  // the Coder prompt BEFORE code is written. Opt-in flag; no effect on existing baselines.
  let icgResult = null;
  let icgInvariantSection = null;
  if (ctx.icgEnabled) {
    icgResult = applyInvariantConstrainedGeneration(spec, problemName, { icgEnabled: true });
    icgInvariantSection = icgResult.invariantSection;
    trace.icg = icgResult.trace;
  }

  // Step 2: Coder → code
  let feedback = null;
  let code = null;

  for (let coderAttempt = 0; coderAttempt < 2; coderAttempt++) {
    const userPrompt = feedback
      ? `Implement the following specification:\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n[Previous attempt feedback: ${feedback}]`
      : `Implement the following specification:\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\``;

    const tCoder = Date.now();
    let coderResponse;
    try {
      coderResponse = await callOllama(getModelForStage('coder'), [
        { role: "system", content: buildCoderPrompt(problemName, driftName) + (icgInvariantSection || '') },
        { role: "user", content: userPrompt }
      ], { timeoutMs: 25_000, signal, maxTokens: 4000 }); // 4000 tokens enough for code solutions
    } catch (err) {
      if (err instanceof OllamaTimeoutError || err instanceof OllamaRateLimitError) {
        const delay = err instanceof OllamaTimeoutError ? (TIMEOUT_BACKOFF_MS[coderAttempt] ?? 20_000) : RATE_LIMIT_DELAY_MS;
        waitMs += delay;
        await sleep(delay);
      }
      trace.coderError = err.message || String(err);
      return { pass: false, errorDetail: "coder failed: " + err.message?.slice(0, 80), waitMs, modelMs: shaperMs, autorepairCycles, stageFailed: "coder_error", trace };
    }
    const coderMs = Date.now() - tCoder;
    trace.coderRaw = coderResponse.content || "";

    code = extractFromResponse(coderResponse);
    code = ensureTypingImports(code); // Add typing imports if missing

    // Signature repair for reasoning_os_v0 baseline
    const effectiveOriginalBaseline = ctx.originalBaselineKind || baselineKind;
    if (effectiveOriginalBaseline === 'reasoning_os_v0') {
      let expectedSig = loadExpectedSignature(problemName);

      // Induced drift: remap expected name to non-idiomatic for deterministic capability test
      if (isDriftEnabled(ctx)) {
        expectedSig = applyDrift(expectedSig, problemName);
        if (expectedSig?.driftApplied) {
          trace.inducedDrift = { originalName: expectedSig.originalName, driftName: expectedSig.name };
        }
      }

      // When drift is applied, sig-repair should RESTORE the original name,
      // not propagate the drifted name. Repair = restore to spec, not adapt to drift.
      const repairTargetName = (isDriftEnabled(ctx) && expectedSig?.originalName)
        ? expectedSig.originalName   // drift mode: restore to spec name (e.g., "search")
        : expectedSig.name;         // normal mode: rename to expected name

      if (expectedSig && repairTargetName) {
        const { repaired, repairedName, originalName } = repairSignatureName(code, repairTargetName);
        if (repairedName) {
          trace.sigRepair = { originalName, repairedName };
          code = repaired;
        }
      }
    }

    trace.code = code;

    if (!code || code.length < 15) {
      return { pass: false, errorDetail: "coder produced no code", waitMs, modelMs: shaperMs + coderMs, autorepairCycles, stageFailed: "coder_error", trace };
    }

    // Basic compile check
    const tmpFile = join(tmpdir(), `eval_${problemName}.py`);
    writeFileSync(tmpFile, code);
    try {
      execSync(`python3 -m py_compile ${tmpFile}`, { timeout: 3000 });
    } catch (err) {
      trace.compileError = err.stderr?.toString() || err.message || String(err);
      return { pass: false, errorDetail: "compile error", waitMs, modelMs: shaperMs + coderMs, autorepairCycles, stageFailed: "coder_error", trace };
    }

    // Spec validation gate
    const specValidation = validateSpec(problemName, code);
    if (!specValidation.match) {
      feedback = specValidation.guidance;
      trace.specValidation = specValidation.guidance;
      // Retry with feedback if we haven't exhausted coder attempts
      if (coderAttempt < 1) {
        continue; // Will loop to coderAttempt 1 with feedback
      }
      // Exhausted coder attempts, spec still mismatched
      return {
        pass: false,
        errorDetail: `spec validation failed: ${specValidation.guidance}`,
        waitMs,
        modelMs: shaperMs + coderMs,
        autorepairCycles,
        stageFailed: "spec_validation",
        trace,
      };
    }

    // gen0_seed: stop after coder, no verifier
    if (baselineKind === "gen0_seed") {
      const testResult = runBasicTest(problemName, code);
      trace.testDetail = testResult.detail;
      if (testResult.primaryPassRate !== undefined) trace.primaryPassRate = testResult.primaryPassRate;
      if (testResult.heldOutPassRate !== undefined) trace.heldOutPassRate = testResult.heldOutPassRate;
      if (testResult.cohAtrRisk !== undefined) trace.cohAtrRisk = testResult.cohAtrRisk;
      return {
        pass: testResult.pass,
        errorDetail: testResult.detail,
        waitMs,
        modelMs: shaperMs + coderMs,
        autorepairCycles,
        trace,
      };
    }

    // gen18_evolved: run verifier
    const tVerifier = Date.now();
    let verifierResponse;
    try {
      verifierResponse = await callOllama(getModelForStage('verifier'), [
        { role: "system", content: VERIFIER_PROMPT },
        { role: "user", content: `TaskSpec:\n${JSON.stringify(spec, null, 2)}\n\nCode:\n${code}` }
      ], { timeoutMs: 25_000, signal, maxTokens: 1000 }); // 1000 tokens enough for JSON verdict
    } catch (err) {
      if (err instanceof OllamaTimeoutError || err instanceof OllamaRateLimitError) {
        const delay = err instanceof OllamaTimeoutError ? (TIMEOUT_BACKOFF_MS[coderAttempt] ?? 20_000) : RATE_LIMIT_DELAY_MS;
        waitMs += delay;
        await sleep(delay);
      }
      trace.verifierError = err.message || String(err);
      return { pass: false, errorDetail: "verifier failed: " + err.message?.slice(0, 80), waitMs, modelMs: shaperMs + coderMs, autorepairCycles, stageFailed: "verifier_error", trace };
    }
    const verifierMs = Date.now() - tVerifier;

    // Parse verifier response
    const vRaw = verifierResponse.content || "";
    trace.verifierRaw = vRaw;
    const vFirstBrace = vRaw.indexOf("{");
    const vLastBrace = vRaw.lastIndexOf("}");
    if (vFirstBrace === -1 || vLastBrace === -1) {
      // Could not parse verifier response — treat as failure, attempt autorepair
      feedback = "Verifier could not parse your output. Ensure you output valid JSON with pass/score/reasoning fields.";
      trace.verifierFeedback = feedback;
    } else {
      try {
        const vResult = JSON.parse(vRaw.substring(vFirstBrace, vLastBrace + 1));
        if (vResult.pass) {
          // Verification passed — run basic test before final pass
          const testResult = runBasicTest(problemName, code);
          trace.testDetail = testResult.detail;
          if (testResult.primaryPassRate !== undefined) trace.primaryPassRate = testResult.primaryPassRate;
          if (testResult.heldOutPassRate !== undefined) trace.heldOutPassRate = testResult.heldOutPassRate;
          if (testResult.cohAtrRisk !== undefined) trace.cohAtrRisk = testResult.cohAtrRisk;
          return {
            pass: testResult.pass,
            errorDetail: testResult.detail,
            waitMs,
            modelMs: shaperMs + coderMs + verifierMs,
            autorepairCycles,
            trace,
          };
        } else {
          feedback = (vResult.suggestions || []).join("; ");
          trace.verifierFeedback = feedback;
        }
      } catch (err) {
        feedback = "Verifier response parse failed. try again";
        trace.verifierParseError = err.message || String(err);
      }
    }

    // ── Informed repair: inject concrete test failure into autorepair feedback ──
    // PERM_GRAD principle: interventions must act at generation time or rewrite
    // the artifact. Verifier suggestions are vague — "doesn't handle edge cases".
    // Running the code and feeding back the actual error (e.g. "your function
    // returned [0,1] but expected [1,2]") gives the model real failure signal.
    const repairMode = ctx.autorepairFeedbackMode || INFORMED_REPAIR_MODES.VERIFIER;
    if (repairMode !== INFORMED_REPAIR_MODES.VERIFIER && !feedback?.includes('[Previous attempt feedback:')) {
      // Run tests to get concrete failure info
      const repairTestResult = runBasicTest(problemName, code);
      const repairTestOutput = repairTestResult.detail || '';

      feedback = buildInformedRepairFeedback(problemName, code, repairTestOutput, repairMode, {
        verifierFeedback: feedback,
        specGuidance: trace.specValidation || null,
      });
      trace.informedRepairFeedback = feedback;
      trace.informedRepairMode = repairMode;
    }

    // Autorepair loop (gen18 only)
    autorepairCycles++;
    if (autorepairCycles >= MAX_AUTOREPAIR_CYCLES) {
      return {
        pass: false,
        errorDetail: "autorepair exhausted",
        waitMs,
        modelMs: shaperMs + coderMs + verifierMs,
        autorepairCycles,
        stageFailed: "autorepair_exhausted",
        trace,
      };
    }

    // Loop continues: coder gets feedback, re-run
  }

  return { pass: false, errorDetail: "coder loop exited unexpectedly", waitMs, modelMs: 0, autorepairCycles, stageFailed: "coder_error", trace };
}

// ---------------------------------------------------------------------------
// Basic test runner
// ---------------------------------------------------------------------------

export function runBasicTest(problemName, code, { includeHeldOut = true } = {}) {
  const moduleName = problemName.replace(/-/g, '_');
  const tmpDir = tmpdir();
  const modulePath = join(tmpDir, `${moduleName}.py`);
  writeFileSync(modulePath, code);

  // Detect primary top-level function or class name dynamically
  const fnMatch = code.match(/^def\s+(\w+)/m);
  const classMatch = code.match(/^class\s+(\w+)/m);
  if (!fnMatch && !classMatch) {
    return { pass: false, detail: "no function or class definition found" };
  }
  const fnName = fnMatch ? fnMatch[1] : classMatch[1];

  const testSuites = {
    "climbing-stairs": [
      `from climbing_stairs import ${fnName} as f; assert f(1) == 1`,
      `from climbing_stairs import ${fnName} as f; assert f(2) == 2`,
      `from climbing_stairs import ${fnName} as f; assert f(3) == 3`,
      `from climbing_stairs import ${fnName} as f; assert f(4) == 5`,
      `from climbing_stairs import ${fnName} as f; assert f(5) == 8`,
    ],
    "binary-search": [
      `from binary_search import ${fnName} as f; assert f([1,3,5,7], 5) == 2`,
      `from binary_search import ${fnName} as f; assert f([1,3,5,7], 4) == -1`,
      `from binary_search import ${fnName} as f; assert f([1], 1) == 0`,
    ],
    "container-with-most-water": [
      `from container_with_most_water import ${fnName} as f; assert f([1,8,6,2,5,4,8,3,7]) == 49`,
    ],
    "coin-change-ii": [
      `from coin_change_ii import ${fnName} as f; assert f(5, [1,2,5]) == 4`,
      `from coin_change_ii import ${fnName} as f; assert f(3, [2]) == 0`,
      `from coin_change_ii import ${fnName} as f; assert f(0, [1,2,5]) == 1`,
    ],
    "min-stack": [
      `import min_stack as m; s=m.MinStack(); s.push(-2); s.push(0); s.push(-3); assert s.getMin() == -3; s.pop(); assert s.top() == 0; assert s.getMin() == -2`,
    ],
    "two-sum": [
      `from two_sum import ${fnName} as f; r = f([2,7,11,15], 9); assert set(r) == {0, 1}`,
      `from two_sum import ${fnName} as f; r = f([3,2,4], 6); assert set(r) == {1, 2}`,
      `from two_sum import ${fnName} as f; r = f([3,3], 6); assert set(r) == {0, 1}`,
    ],
    "valid-palindrome": [
      `from valid_palindrome import ${fnName} as f; assert f("A man, a plan, a canal: Panama") == True`,
      `from valid_palindrome import ${fnName} as f; assert f("race a car") == False`,
      `from valid_palindrome import ${fnName} as f; assert f(" ") == True`,
      `from valid_palindrome import ${fnName} as f; assert f("ab") == False`,
    ],
    "number-of-islands": [
      `from number_of_islands import ${fnName} as f; assert f([["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]) == 1`,
      `from number_of_islands import ${fnName} as f; assert f([["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]) == 3`,
      `from number_of_islands import ${fnName} as f; assert f([["1"]]) == 1`,
      `from number_of_islands import ${fnName} as f; assert f([["0","0"],["0","0"]]) == 0`,
    ],
    "invert-binary-tree": [
      `from invert_binary_tree import ${fnName} as f, TreeNode; r = f(TreeNode(4, TreeNode(2, TreeNode(1), TreeNode(3)), TreeNode(7, TreeNode(6), TreeNode(9)))); assert r.val == 4 and r.left.val == 7 and r.right.val == 2`,
    ],
    // --- Stress-suite MVP problems (P1, P3, P4, P7) ---
    "edit-distance": [
      `from edit_distance import ${fnName} as f; assert f("horse", "ros") == 3`,
      `from edit_distance import ${fnName} as f; assert f("intention", "execution") == 5`,
      `from edit_distance import ${fnName} as f; assert f("", "abc") == 3`,
      `from edit_distance import ${fnName} as f; assert f("abc", "") == 3`,
    ],
    "word-break": [
      `from word_break import ${fnName} as f; assert f("leetcode", ["leet","code"]) == True`,
      `from word_break import ${fnName} as f; assert f("applepenapple", ["apple","pen"]) == True`,
      `from word_break import ${fnName} as f; assert f("catsandog", ["cats","dog","sand","and","cat"]) == False`,
    ],
    "detect-cycle": [
      `from detect_cycle import ListNode, ${fnName} as f; n3=ListNode(0); n2=ListNode(2); n1=ListNode(3,n2); n0=ListNode(-4,n3); n3.next=n0; n2.next=n3; assert f(n1) == True`,
      `from detect_cycle import ListNode, ${fnName} as f; assert f(None) == False`,
      `from detect_cycle import ListNode, ${fnName} as f; assert f(ListNode(1)) == False`,
    ],
    "valid-sudoku": [
      `from valid_sudoku import ${fnName} as f; b=[["5","3",".",".","7",".",".",".","."],["6",".",".","1","9","5",".",".","."],[".","9","8",".",".",".",".","6","."],["8",".",".",".","6",".",".",".","3"],["4",".",".","8",".","3",".",".","1"],["7",".",".",".","2",".",".",".","6"],[".","6",".",".",".",".","2","8","."],[".",".",".","4","1","9",".",".","5"],[".",".",".",".","8",".",".","7","9"]]; assert f(b) == True`,
      `from valid_sudoku import ${fnName} as f; b=[["8","3",".",".","7",".",".",".","."],["6",".",".","1","9","5",".",".","."],[".","9","8",".",".",".",".","6","."],["8",".",".",".","6",".",".",".","3"],["4",".",".","8",".","3",".",".","1"],["7",".",".",".","2",".",".",".","6"],[".","6",".",".",".",".","2","8","."],[".",".",".","4","1","9",".",".","5"],[".",".",".",".","8",".",".","7","9"]]; assert f(b) == False`,
      `from valid_sudoku import ${fnName} as f; b=[[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."]]; assert f(b) == True`,
    ],
  };

  const tests = testSuites[problemName];
  if (!tests) return { pass: false, detail: `no test suite for ${problemName}` };

  try {
    let passedCount = 0;
    let failedTests = [];
    for (const test of tests) {
      try {
        execFileSync("python3", ["-c", test], {
          cwd: tmpDir,
          timeout: 3000,
          stdio: "pipe",
          env: { ...process.env, PYTHONPATH: tmpDir },
        });
        passedCount++;
      } catch (e) {
        failedTests.push(test);
      }
    }

    const primaryPass = passedCount === tests.length;
    const primaryPassRate = passedCount / tests.length;

    // Run held-out discriminativity tests
    let heldOutResult = null;
    let cohAtrRisk = null;
    if (includeHeldOut) {
      heldOutResult = runHeldOutTests(problemName, fnName, tmpDir);
      cohAtrRisk = calculateCohAtrRisk(primaryPassRate, heldOutResult.passRate);
    }

    const result = {
      pass: primaryPass,
      detail: primaryPass ? undefined : (failedTests[0] ? String(failedTests[0]).slice(0, 100) : "assertion failed"),
      primaryPassRate,
      primaryPassed: passedCount,
      primaryTotal: tests.length,
    };
    if (heldOutResult) {
      result.heldOutPassRate = heldOutResult.passRate;
      result.heldOutPassed = heldOutResult.passed;
      result.heldOutTotal = heldOutResult.total;
      result.heldOutDetails = heldOutResult.details;
      result.cohAtrRisk = cohAtrRisk;
    }
    return result;
  } catch (e) {
    return { pass: false, detail: e.message?.split("\n").pop() || "assertion failed" };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}