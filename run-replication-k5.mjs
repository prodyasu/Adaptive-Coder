#!/usr/bin/env node
/**
 * run-replication-k5.mjs — k=5 replication for both baselines on N=8 problems.
 * Each baseline runs in a child process for cache isolation.
 * Produces two summary.json files for A/B comparison.
 */
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROBLEMS = ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii', 'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree'];
const K = 5;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

for (const BASELINE of ['reasoning_os_v0', 'gen18_evolved']) {
  const RUN_DIR = join('validation-runs', `${BASELINE}-replication-k5-${TIMESTAMP}`);
  const TRACE_DIR = join(RUN_DIR, 'traces');
  mkdirSync(TRACE_DIR, { recursive: true });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`=== ${BASELINE} replication k=5 ===`);
  console.log(`Run dir: ${RUN_DIR}`);
  console.log(`${'='.repeat(60)}\n`);

  // Use a fresh node process for the whole run
  const script = `
    import { evalProblem } from './eval.js';
    import { writeFileSync, mkdirSync, existsSync } from 'fs';
    import { join } from 'path';

    const PROBLEMS = ${JSON.stringify(PROBLEMS)};
    const K = ${K};
    const RUN_DIR = ${JSON.stringify(RUN_DIR)};
    const TRACE_DIR = ${JSON.stringify(TRACE_DIR)};
    const BASELINE = ${JSON.stringify(BASELINE)};

    const results = {};

    for (const problem of PROBLEMS) {
      const problemTraceDir = join(TRACE_DIR, problem);
      if (!existsSync(problemTraceDir)) mkdirSync(problemTraceDir, { recursive: true });

      let passes = 0;
      let totalAttempts = 0;
      const trialResults = [];

      for (let trial = 0; trial < K; trial++) {
        const trialTraceDir = join(problemTraceDir, 'trial-' + trial);
        if (!existsSync(trialTraceDir)) mkdirSync(trialTraceDir, { recursive: true });

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 120000);
          const result = await evalProblem(problem, BASELINE, null, {
            signal: controller.signal,
            traceDir: trialTraceDir,
          });
          clearTimeout(timeout);

          const pass = result.passAt1 !== undefined ? result.passAt1 : result.pass;
          if (pass) passes++;
          trialResults.push({
            trial: trial,
            passAt1: pass,
            passAtN: result.passAtN !== undefined ? result.passAtN : pass,
            attempts: result.attempts || 1,
            sigRepair: result.sigRepair || null,
          });
        } catch (e) {
          trialResults.push({
            trial: trial,
            passAt1: false,
            passAtN: false,
            error: e.message,
          });
        }
      }

      results[problem] = {
        passes: passes,
        total: K,
        passAt1Rate: passes + '/' + K,
        trials: trialResults,
      };
      console.log(problem + ': pass@1=' + passes + '/' + K);
    }

    const summary = {
      baseline: BASELINE,
      k: K,
      runDir: RUN_DIR,
      timestamp: new Date().toISOString(),
      results: results,
    };

    writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log('\\nSUMMARY written to ' + join(RUN_DIR, 'summary.json'));
  `;

  const scriptPath = join(RUN_DIR, '_runner.mjs');
  writeFileSync(scriptPath, script);

  console.log(`Running ${BASELINE} via child process...`);
  try {
    const output = execFileSync('node', [scriptPath], {
      cwd: process.cwd(),
      timeout: 600_000, // 10 min per baseline
      stdio: 'pipe',
      env: { ...process.env },
    });
    console.log(output.toString());
  } catch (e) {
    console.error(`Error running ${BASELINE}:`, e.stderr?.toString() || e.message);
  }
}

console.log('\n✅ Both replications complete. Check validation-runs/ for results.');