#!/usr/bin/env node
/**
 * run-model-sensitivity.mjs — Model-scale sensitivity micro-study on stress suite.
 *
 * Tests the U-curve hypothesis: OS leverage peaks in a middle capability band
 * where models fail enough for the OS to act on AND are strong enough to use feedback.
 *
 * Design:
 *   - Multiple models (env-driven, default: gemma4, minimax-m2.7, kimi-k2.5)
 *   - Each model runs both gen18_evolved (bare) and reasoning_os_v0 (OS-equipped)
 *   - Stress-suite 4 problems, k=5 per condition
 *   - Metrics: shaper JSON success, coder pass given valid shaper, pass@1, repair conversion, failure dist
 *
 * Usage:
 *   node run-model-sensitivity.mjs                          # default models, k=5
 *   node run-model-sensitivity.mjs --k=3                     # fewer trials for quick check
 *   node run-model-sensitivity.mjs --models=gemma4:31b-cloud,minimax-m2.7:cloud
 *
 * Run each model in a CHILD PROCESS to avoid ESM cache contamination (Pitfall #1).
 * Environment variables SHAPER_MODEL/CODER_MODEL/VERIFIER_MODEL override eval.js defaults.
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const DEFAULT_MODELS = 'gemma4:31b-cloud,minimax-m2.7:cloud,kimi-k2.5:cloud,deepseek-v3.2:cloud';
const models = argValue('models', DEFAULT_MODELS).split(',').map(s => s.trim()).filter(Boolean);
const k = Number(argValue('k', '5'));
const timeoutMs = Number(argValue('timeout-ms', '120000'));
const problems = argValue('problems', 'edit-distance,word-break,detect-cycle,valid-sudoku').split(',').map(s => s.trim()).filter(Boolean);
const baselines = ['gen18_evolved', 'reasoning_os_v0'];

const STUDY_DIR = join(__dirname, 'validation-runs', `model-sensitivity-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(STUDY_DIR, { recursive: true });

console.log('\n=== Model-Scale Sensitivity Micro-Study (U-Curve) ===');
console.log(`Study dir: ${STUDY_DIR}`);
console.log(`Models: ${models.join(', ')}`);
console.log(`Baselines: ${baselines.join(', ')}`);
console.log(`Problems: ${problems.join(', ')}`);
console.log(`k: ${k} trials per problem per condition`);
console.log(`Total model calls: ~${models.length * baselines.length * problems.length * k * 3} (3 stages per trial)`);
console.log();

// ---------------------------------------------------------------------------
// Per-model runner — uses a child process with env var overrides
// ---------------------------------------------------------------------------
const RUNNER_SCRIPT = join(__dirname, '_model-sens-child.mjs');

// Write a temporary child script that imports stress-runner-utils and runs
// with the env-driven model. This avoids polluting parent process ESM cache.
const CHILD_SOURCE = `#!/usr/bin/env node
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';
import { STRESS_PROBLEMS, ensureRunDir, runProblemTrials, summarizeRun, writeCompactReport, frac } from './stress-runner-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [,, _model, _baseline, _k, _timeoutMs, _problems, _runDir] = process.argv;
const k = Number(_k);
const timeoutMs = Number(_timeoutMs);
const problems = _problems.split(',').map(s => s.trim()).filter(Boolean);
const baseline = _baseline;
const modelLabel = _model;

const TRACE_DIR = join(_runDir, 'traces');
mkdirSync(TRACE_DIR, { recursive: true });

console.log('  Model: ' + modelLabel + '  Baseline: ' + baseline + '  k=' + k);

const rawResults = {};
for (const problem of problems) {
  console.log('  --- ' + problem + ' ---');
  try {
    rawResults[problem] = await runProblemTrials({ problem, baseline, k, traceDir: TRACE_DIR, timeoutMs });
    const r = rawResults[problem];
    const passAtN = r.trials.filter(t => t.eventualPass).length;
    console.log('    pass@1: ' + frac(r.passAt1Count, r.trials.length));
    console.log('    pass@N: ' + frac(passAtN, r.trials.length));
  } catch (err) {
    console.log('    ERROR: ' + err.message);
    rawResults[problem] = { passAt1Count: 0, passAt1Rate: 0, trials: [{ trial: 1, error: err.message, passAt1: false, eventualPass: false, repairEligible: false, repairConverted: false }] };
  }
}

const summary = summarizeRun({ runType: 'model-sensitivity', baseline, k, problems, rawResults });
writeFileSync(join(_runDir, 'raw-results.json'), JSON.stringify(rawResults, null, 2));
writeFileSync(join(_runDir, 'summary.json'), JSON.stringify(summary, null, 2));

// Output brief results for parent to parse
console.log('RESULT_LINE|' + modelLabel + '|' + baseline + '|' + JSON.stringify(summary));
`;

writeFileSync(RUNNER_SCRIPT, CHILD_SOURCE);

// ---------------------------------------------------------------------------
// Run each model × baseline combination
// ---------------------------------------------------------------------------
const allResults = {};

for (const model of models) {
  allResults[model] = {};
  for (const baseline of baselines) {
    const conditionLabel = `${model}+${baseline}`;
    const conditionDir = join(STUDY_DIR, model.replace(/[:.]/g, '_'), baseline);
    mkdirSync(conditionDir, { recursive: true });

    console.log(`\n[${conditionLabel}] Starting...`);

    const env = {
      ...process.env,
      SHAPER_MODEL: model,
      CODER_MODEL: model,
      VERIFIER_MODEL: model,
      EVAL_TIMEOUT_MS: '25000',
    };

    try {
      const output = execSync(
        `node ${JSON.stringify(RUNNER_SCRIPT)} ${JSON.stringify(model)} ${JSON.stringify(baseline)} ${k} ${timeoutMs} ${problems.join(',')} ${JSON.stringify(conditionDir)}`,
        { env, timeout: k * problems.length * timeoutMs + 60_000, maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const stdout = output.toString();

      // Parse RESULT_LINE from child output
      const resultLine = stdout.split('\n').find(l => l.startsWith('RESULT_LINE|'));
      if (resultLine) {
        const parts = resultLine.split('|');
        const parsedModel = parts[1];
        const parsedBaseline = parts[2];
        const parsedSummary = JSON.parse(parts.slice(3).join('|'));
        allResults[model][baseline] = parsedSummary;
        console.log(`  ✅ ${conditionLabel}: pass@1=${parsedSummary.passAt1?.rate ?? 'N/A'}, repairConv=${parsedSummary.repairConversionRate ?? 'N/A'}`);
      } else {
        console.log(`  ⚠️ ${conditionLabel}: No RESULT_LINE found in child output`);
        allResults[model][baseline] = { error: 'no_result_line', rawStdout: stdout.slice(-500) };
      }
    } catch (err) {
      console.log(`  ❌ ${conditionLabel}: ${err.message.slice(0, 200)}`);
      allResults[model][baseline] = { error: err.message.slice(0, 500), stderr: err.stderr?.toString().slice(0, 500) };
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-model analysis
// ---------------------------------------------------------------------------
console.log('\n\n========================================');
console.log('  MODEL-SCALE SENSITIVITY RESULTS');
console.log('========================================\n');

// Table header
const hdr = sprintf25('Model') + sprintf12('Baseline') + sprintf8('pass@1') + sprintf8('pass@N') + sprintf12('repairConv') + sprintf14('failureDist');
console.log(hdr);
console.log('-'.repeat(hdr.length));

for (const model of models) {
  for (const baseline of baselines) {
    const s = allResults[model]?.[baseline];
    if (!s || s.error) {
      console.log(sprintf25(model) + sprintf12(baseline) + ' ERROR: ' + (s?.error || 'unknown').slice(0, 40));
      continue;
    }
    const p1 = s.passAt1?.rate != null ? (s.passAt1.rate * 100).toFixed(1) + '%' : 'N/A';
    const pN = s.passAtN?.rate != null ? (s.passAtN.rate * 100).toFixed(1) + '%' : 'N/A';
    const rc = s.repairConversionRate != null && s.repairConversionRate !== null ? (s.repairConversionRate * 100).toFixed(1) + '%' : 'N/A';
    const fDist = Object.entries(s.failureClassBreakdown || {}).map(([k, v]) => `${k}:${v}`).join(',') || 'none';
    console.log(sprintf25(model) + sprintf12(baseline) + sprintf8(p1) + sprintf8(pN) + sprintf12(rc) + sprintf14(fDist));
  }
}

// OS leverage delta (reasoning_os_v0 - gen18_evolved per model)
console.log('\n--- OS Leverage Delta (os_v0 - gen18) ---');
for (const model of models) {
  const gen18 = allResults[model]?.gen18_evolved;
  const osv0 = allResults[model]?.reasoning_os_v0;
  if (!gen18?.passAt1?.rate || !osv0?.passAt1?.rate || gen18.error || osv0.error) {
    console.log(sprintf25(model) + ' INSUFFICIENT DATA');
    continue;
  }
  const deltaP1 = ((osv0.passAt1.rate - gen18.passAt1.rate) * 100).toFixed(1);
  const gen18PN = gen18.passAtN?.rate ?? gen18.passAt1.rate;
  const osv0PN = osv0.passAtN?.rate ?? osv0.passAt1.rate;
  const deltaPN = ((osv0PN - gen18PN) * 100).toFixed(1);
  const deltaRC = osv0.repairConversionRate != null && gen18.repairConversionRate != null
    ? ((osv0.repairConversionRate - gen18.repairConversionRate) * 100).toFixed(1)
    : 'N/A';
  console.log(sprintf25(model) + ` pass@1 delta: ${deltaP1}pp  pass@N delta: ${deltaPN}pp  repairConv delta: ${deltaRC}pp`);
}

// U-curve assessment
console.log('\n--- U-Curve Assessment ---');
const leverageDeltas = models.map(m => {
  const g = allResults[m]?.gen18_evolved;
  const o = allResults[m]?.reasoning_os_v0;
  if (!g?.passAt1?.rate || !o?.passAt1?.rate || g.error || o.error) return { model: m, delta: null };
  return { model: m, delta: (o.passAt1.rate - g.passAt1.rate) * 100 };
});

const validDeltas = leverageDeltas.filter(d => d.delta !== null);
if (validDeltas.length < 2) {
  console.log('Not enough models with valid data to assess U-curve shape.');
} else {
  const sorted = [...validDeltas].sort((a, b) => a.delta - b.delta);
  const peak = sorted[sorted.length - 1];
  const trough = sorted[0];
  console.log(`Peak OS leverage: ${peak.model} (+${peak.delta.toFixed(1)}pp)`);
  console.log(`Least OS leverage: ${trough.model} (${trough.delta >= 0 ? '+' : ''}${trough.delta.toFixed(1)}pp)`);

  // Simple U-curve test: is there a non-monotonic relationship?
  const deltas = validDeltas.map(d => d.delta);
  const hasUShape = deltas.length >= 3 && (
    (deltas[0] < deltas[1] && deltas[1] > deltas[2]) ||  // peak in middle
    (deltas[0] > deltas[1] && deltas[1] < deltas[2])     // trough in middle (inverted U)
  );
  console.log(`U-curve shape detected: ${hasUShape ? 'YES (non-monotonic)' : 'NO (monotonic)'}`);
}

// Save full results
writeFileSync(join(STUDY_DIR, 'model-sensitivity-results.json'), JSON.stringify(allResults, null, 2));
console.log(`\nFull results saved to ${STUDY_DIR}/model-sensitivity-results.json`);

// Cleanup temp child script
try { require('fs').unlinkSync(RUNNER_SCRIPT); } catch (_) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sprintf25(s) { return (s || '').padEnd(25).slice(0, 25); }
function sprintf12(s) { return (s || '').padEnd(12).slice(0, 12); }
function sprintf14(s) { return (s || '').padEnd(14).slice(0, 14); }
function sprintf8(s) { return (s || '').padEnd(8).slice(0, 8); }