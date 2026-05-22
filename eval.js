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
import { validateSpec } from "./spec-validator.js";
import { writeTraceLog } from "./trace-log.js";
import { classifyFailureKind } from "./failure-metrics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_TRACE_DIR = join(__dirname, "run-logs");

function recordAttemptTrace({ opts, problemName, baselineKind, attempt, pass, stageFailed, errorDetail, error, failureKind, trace }) {
  if (opts.traceDir === false) return undefined;
  const kind = failureKind || classifyFailureKind({ pass, stageFailed, errorDetail, error });
  try {
    return writeTraceLog({
      dir: opts.traceDir || DEFAULT_TRACE_DIR,
      problemName,
      baselineKind,
      attempt,
      pass,
      stageFailed,
      errorDetail,
      failureKind: kind,
      trace,
      maxChars: opts.traceMaxChars || 4000,
    });
  } catch (err) {
    console.warn(`[trace-log] failed for ${problemName}/${baselineKind} attempt ${attempt}: ${err.message}`);
    return undefined;
  }
}

const TIMEOUT_MS = 15_000;  // 15s — enough for valid calls with reduced maxTokens
const MAX_ATTEMPTS = 3;
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
const SHAPER_MODEL = 'minimax-m2.7:cloud';
const CODER_MODEL = 'minimax-m2.7:cloud';
const VERIFIER_MODEL = 'minimax-m2.7:cloud';

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

function buildCoderPrompt(problemName) {
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
  
  const pySig = translateSignature(primary);
  const formatted = formatPythonSignature(pySig);
  
  return CODER_PROMPT_TEMPLATE.replace('{{SIGNATURE}}', formatted);
}



export async function evalProblem(problemName, baselineKind, model, opts = {}) {
  const { signal } = opts;
  const taskPath = join(__dirname, "../shaper-autorepair/testcases", problemName, "task.txt");
  const task = readFileSync(taskPath, "utf8").trim();

  const attempts = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let waitMs = 0;
    let autorepairCycles = 0;
    let stageFailed;

    try {
      const result = await runPipeline(problemName, task, baselineKind, model, signal, {
        waitMs: 0,
        autorepairCycles: 0,
      });

      const failureKind = classifyFailureKind({
        pass: result.pass,
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
        trace: result.trace,
      });

      attempts.push({
        attempt,
        pass: result.pass,
        error: result.pass ? "success" : undefined,
        errorDetail: result.errorDetail,
        waitMs: result.waitMs,
        modelMs: result.modelMs,
        autorepairCycles: result.autorepairCycles,
        stageFailed: result.stageFailed,
        failureKind,
        traceLog,
      });

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
        const failureKind = classifyFailureKind({ pass: false, stageFailed, error, errorDetail: `${TIMEOUT_MS}ms limit` });
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
          trace: { errorName: err.name, errorMessage: err.message },
        });
        attempts.push({
          attempt, pass: false,
          error,
          errorDetail: `${TIMEOUT_MS}ms limit`,
          waitMs, modelMs, autorepairCycles: 0,
          stageFailed,
          failureKind,
          traceLog,
        });
        continue;
      }

      // Model/network errors
      const failureKind = classifyFailureKind({
        pass: false,
        stageFailed: "model_error",
        error: "model_error",
        errorDetail: err.message?.slice(0, 100) || "unknown",
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
        trace: { errorName: err.name, errorMessage: err.message },
      });
      attempts.push({
        attempt, pass: false,
        error: "model_error",
        errorDetail: err.message?.slice(0, 100) || "unknown",
        waitMs, modelMs, autorepairCycles: 0,
        stageFailed: "model_error",
        failureKind,
        traceLog,
      });
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

  if (baselineKind === "raw_base") {
    // Single coder call → code
    const t0 = Date.now();
    const response = await callOllama(getModelForStage('coder'), [
      { role: "system", content: buildCoderPrompt(problemName) },
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
      { role: "system", content: buildCoderPrompt(problemName) },
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

export function runBasicTest(problemName, code) {
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
  };

  const tests = testSuites[problemName];
  if (!tests) return { pass: false, detail: `no test suite for ${problemName}` };

  try {
    for (const test of tests) {
      execFileSync("python3", ["-c", test], {
        cwd: tmpDir,
        timeout: 3000,
        stdio: "pipe",
        env: { ...process.env, PYTHONPATH: tmpDir },
      });
    }
    return { pass: true };
  } catch (e) {
    return { pass: false, detail: e.message?.split("\n").pop() || "assertion failed" };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}