#!/usr/bin/env node
/**
 * variance-run.js — Run coin-change-ii × gen18_evolved k times to measure within-problem variance
 *
 * Pre-registered: if outcomes are binary-stable across k runs, single-run pass@1 is reliable.
 * If outcomes flip across runs, single-run pass@1 is fundamentally noisy.
 */

import { evalProblem } from './eval.js';

const PROBLEM = 'coin-change-ii';
const BASELINE = 'gen18_evolved';
const MODEL = 'kimi-k2.5:cloud';
const K = 5;

async function main() {
  console.log(`=== Within-problem variance measurement ===`);
  console.log(`Problem: ${PROBLEM}`);
  console.log(`Baseline: ${BASELINE}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Replicates: k=${K}`);
  console.log('');

  const results = [];

  for (let run = 0; run < K; run++) {
    process.stdout.write(`Run ${run + 1}/${K}: `);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      const attempts = await evalProblem(PROBLEM, BASELINE, MODEL, { signal: controller.signal });
      clearTimeout(timeout);

      const passAt1 = attempts[0]?.pass || false;
      const finalPass = attempts.some(a => a.pass);
      const modelMs = attempts.reduce((s, a) => s + (a.modelMs || 0), 0);
      const ar = attempts.reduce((s, a) => s + (a.autorepairCycles || 0), 0);

      console.log(`${passAt1 ? 'PASS' : 'FAIL'} (${attempts.length} attempts, ${modelMs}ms model, AR:${ar})`);
      results.push({ run: run + 1, passAt1, finalPass, attempts: attempts.length, modelMs, ar });
    } catch (e) {
      console.log(`ERROR: ${e.message?.slice(0, 60)}`);
      results.push({ run: run + 1, passAt1: false, finalPass: false, error: e.message });
    }

    // Inter-run delay to avoid rate limit
    if (run < K - 1) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Summary
  const passAt1_count = results.filter(r => r.passAt1).length;
  const finalPass_count = results.filter(r => r.finalPass).length;

  console.log(`\n=== RESULTS (k=${K}) ===`);
  console.log(`pass@1: ${passAt1_count}/${K} = ${(passAt1_count/K*100).toFixed(0)}%`);
  console.log(`pass@N: ${finalPass_count}/${K} = ${(finalPass_count/K*100).toFixed(0)}%`);
  console.log(`\nOutcome distribution: ${results.map(r => r.passAt1 ? '1' : '0').join(' ')}`);

  // Interpretation
  const unique_outcomes = [...new Set(results.map(r => r.passAt1))];
  if (unique_outcomes.length === 1) {
    console.log('\nINTERPRETATION: All runs agree. Within-problem variance is LOW.');
    console.log('Single-run pass@1 appears stable for this problem/configuration.');
  } else {
    console.log('\nINTERPRETATION: Runs disagree. Within-problem variance is HIGH.');
    console.log('Single-run pass@1 is a noisy measurement. k-replicate runs needed for stable estimates.');
    console.log('The variance is large enough that single-run comparisons are unreliable.');
  }

  // Save results
  const { writeFileSync } = await import('fs');
  writeFileSync('/home/masclaw/.openclaw/workspace/eval-harness/variance-results.json',
    JSON.stringify({ problem: PROBLEM, baseline: BASELINE, model: MODEL, k: K, results }, null, 2));
}

main().catch(console.error);
