#!/usr/bin/env node
/**
 * run-rank-ef.mjs — Execution-Feedback Ranker Experiment Runner (Delta 7 / OP-1)
 *
 * Runs an A/B comparison:
 *   Arm A: Best-of-5 baseline (current evalProblem, stops on first pass)
 *   Arm B: Rank-EF (generate N candidates, score all, select best via rank-ef.js)
 *
 * Usage:
 *   node run-rank-ef.mjs                          # Full run (4 stress problems × k=5)
 *   node run-rank-ef.mjs --dry-run                 # Verify wiring, no model calls
 *   node run-rank-ef.mjs --problems=edit-distance,longest-increasing-subsequence
 *   node run-rank-ef.mjs --trials=3               # Reduced trials for quick smoke
 *   node run-rank-ef.mjs --candidates=10           # 10 candidate pool per trial
 *
 * Output: validation-runs/rank-ef-<timestamp>/ with per-arm JSON + comparison report
 */

import { evalProblem } from './eval.js';
import { selectBest, rankCandidates, extractFeatures, heuristicScore, buildRankEfSummary, RANK_EF_VERSION } from './rank-ef.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Stress problems (discriminative — baseline ~40-80% pass@1)
// ---------------------------------------------------------------------------

const STRESS_PROBLEMS = [
  'edit-distance',
  'longest-increasing-subsequence',
];

// Default: use EDIT_DISTANCE and LIS only (proven discriminative, no ceiling/network issues)
// course-schedule-ii is ceiling at 100%, critical-connections has network error confounds

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const trialsArg = args.find(a => a.startsWith('--trials='));
const candidatesArg = args.find(a => a.startsWith('--candidates='));
const problemsArg = args.find(a => a.startsWith('--problems='));

const K = trialsArg ? parseInt(trialsArg.split('=')[1]) : 5;           // Independent trials
const N = candidatesArg ? parseInt(candidatesArg.split('=')[1]) : 5;   // Candidates per trial
const problems = problemsArg
  ? problemsArg.split('=')[1].split(',')
  : STRESS_PROBLEMS;

const MODEL = process.env.SHAPER_MODEL || 'minimax-m2.7:cloud';
const TIMEOUT_MS = parseInt(process.env.EVAL_TIMEOUT_MS || '120000');

// ---------------------------------------------------------------------------
// Arm A: Best-of-5 baseline (current behavior — stops on first pass)
// ---------------------------------------------------------------------------

async function runBestOf5Trial(problemName) {
  // This is exactly what evalProblem does: run trials, stop on first pass
  // But we need ALL attempts for the ranker comparison, so we simulate Bo5
  // by calling evalProblem once (which internally loops up to MAX_ATTEMPTS)
  // and recording whether it passed within 5 attempts
  
  console.log(`  [Bo5] ${problemName} — calling evalProblem (stops on first pass)`);
  
  const result = await evalProblem(problemName, 'gen18_evolved', MODEL, {
    traceMaxChars: 4000,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Arm B: Rank-EF (generate N candidates, rank all, select best)
// ---------------------------------------------------------------------------

async function runRankEfTrial(problemName) {
  // Generate N independent candidates
  // Each candidate goes through the FULL pipeline (shaper → coder → verifier → tests)
  // NO early exit — we need ALL results for ranking
  
  console.log(`  [RankEF] ${problemName} — generating ${N} candidates`);
  
  const candidates = [];
  
  for (let i = 0; i < N; i++) {
    console.log(`  [RankEF] ${problemName} — candidate ${i+1}/${N}`);
    
    try {
      // Each candidate is a fresh pipeline run
      // We use evalProblem but only take the first attempt
      // (in practice, we need a single-pipeline call per candidate)
      const result = await evalProblem(problemName, 'gen18_evolved', MODEL, {
        traceMaxChars: 4000,
      });
      
      // evalProblem returns { attempts, passed, ... }
      // Take the FIRST attempt as the candidate record
      const firstAttempt = result.attempts?.[0] || result;
      
      candidates.push({
        candidateIndex: i,
        ...firstAttempt,
        // Flatten key fields from the result
        pass: result.pass ?? firstAttempt.pass,
        primaryPassRate: result.primaryPassRate ?? firstAttempt.primaryPassRate,
        modelMs: result.modelMs ?? firstAttempt.modelMs,
        autorepairCycles: result.autorepairCycles ?? firstAttempt.autorepairCycles ?? 0,
        failureKind: result.failureKind ?? firstAttempt.failureKind,
        failureSubKind: result.failureSubKind ?? firstAttempt.failureSubKind,
        pgg: result.pgg ?? firstAttempt.pgg,
        heldOutPassRate: result.heldOutPassRate ?? firstAttempt.heldOutPassRate,
        cohAtrRisk: result.cohAtrRisk ?? firstAttempt.cohAtrRisk,
      });
      
    } catch (err) {
      console.error(`  [RankEF] ${problemName} — candidate ${i+1} failed: ${err.message}`);
      candidates.push({
        candidateIndex: i,
        pass: false,
        failureKind: 'model_error',
        failureSubKind: 'model_error.network_error',
        primaryPassRate: 0,
        modelMs: 0,
        autorepairCycles: 0,
      });
    }
  }
  
  // Rank all candidates and select the best
  const best = selectBest(candidates);
  const summary = buildRankEfSummary([{
    best,
    allCandidates: candidates,
    metadata: { problemName, baselineKind: 'gen18_evolved', N, version: RANK_EF_VERSION },
  }]);
  
  return {
    best,
    allCandidates: candidates,
    ranked: rankCandidates(candidates).map(c => ({
      candidateIndex: c.candidateIndex,
      pass: c.pass,
      score: c.rankerScore,
    })),
    summary,
  };
}

// ---------------------------------------------------------------------------
// Run experiment
// ---------------------------------------------------------------------------

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = `validation-runs/rank-ef-${timestamp}`;
  mkdirSync(runDir, { recursive: true });
  
  console.log('='.repeat(60));
  console.log(`Rank-EF Experiment (Delta 7 / OP-1)`);
  console.log(`Model: ${MODEL}`);
  console.log(`Problems: ${problems.join(', ')}`);
  console.log(`Trials (k): ${K}`);
  console.log(`Candidates (N): ${N}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms`);
  console.log(`Dry run: ${isDryRun}`);
  console.log(`Run dir: ${runDir}`);
  console.log(`RankEF version: ${RANK_EF_VERSION}`);
  console.log('='.repeat(60));
  
  if (isDryRun) {
    console.log('\n[DRY RUN] Verifying wiring...');
    
    // Test ranker with synthetic data
    const synthA = { candidateIndex: 0, pass: true, primaryPassRate: 1.0, modelMs: 3000, autorepairCycles: 0, pgg: { accepted: true, failedCount: 0, totalCount: 3, resampleNumber: 0, exhausted: false }, failureKind: undefined, failureSubKind: undefined, trace: {} };
    const synthB = { candidateIndex: 1, pass: true, primaryPassRate: 0.67, modelMs: 8000, autorepairCycles: 1, pgg: null, failureKind: 'logic_assertion', failureSubKind: 'assertion_failed', trace: {} };
    const synthC = { candidateIndex: 2, pass: false, primaryPassRate: 0.0, modelMs: 25000, autorepairCycles: 0, pgg: null, failureKind: 'timeout', failureSubKind: undefined, trace: {} };
    
    const best = selectBest([synthC, synthA, synthB]);
    console.log(`  Dry run selectBest: candidate ${best.candidateIndex} (pass=${best.pass}, score=${best.rankerScore?.toFixed(3)})`);
    console.log(`  Expected: candidate 0 (pass=true, PGG accepted)`);
    
    if (best.candidateIndex !== 0 || !best.pass) {
      console.error('  ❌ Dry run FAILED — ranker not selecting correctly');
      process.exit(1);
    }
    
    console.log('  ✅ Dry run passed — ranker wiring verified');
    console.log('\n[DRY RUN] No model calls made. Exiting.');
    return;
  }
  
  // Results storage
  const results = {
    armA: {}, // Best-of-5
    armB: {}, // Rank-EF
    metadata: {
      model: MODEL,
      problems,
      K,
      N,
      timeoutMs: TIMEOUT_MS,
      rankEfVersion: RANK_EF_VERSION,
      timestamp,
    },
  };
  
  for (const problem of problems) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`Problem: ${problem}`);
    console.log(`${'─'.repeat(40)}`);
    
    // Arm A: Best-of-5
    console.log(`\n[Arm A: Best-of-5] ${problem}`);
    const armA_trials = [];
    for (let trial = 0; trial < K; trial++) {
      console.log(`  Trial ${trial+1}/${K}...`);
      const result = await runBestOf5Trial(problem);
      armA_trials.push(result);
    }
    results.armA[problem] = armA_trials;
    
    // Arm B: Rank-EF
    console.log(`\n[Arm B: Rank-EF] ${problem}`);
    const armB_trials = [];
    for (let trial = 0; trial < K; trial++) {
      console.log(`  Trial ${trial+1}/${K}...`);
      const result = await runRankEfTrial(problem);
      armB_trials.push(result);
    }
    results.armB[problem] = armB_trials;
  }
  
  // ---------------------------------------------------------------------------
  // Compute aggregate statistics
  // ---------------------------------------------------------------------------
  
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  
  for (const problem of problems) {
    const armA = results.armA[problem];
    const armB = results.armB[problem];
    
    // Arm A: pass@1 (fraction of trials that passed on first attempt)
    const aPassAt1 = armA.filter(r => r.pass || r.attempts?.[0]?.pass).length / K;
    
    // Arm B: pass@1(selected) (fraction of trials where ranker selected a passing candidate)
    const bPassAt1Selected = armB.filter(r => r.best?.pass).length / K;
    
    // Arm B: pass@N (fraction of trials where ANY candidate passed)
    const bPassAtN = armB.filter(r => r.allCandidates?.some(c => c.pass)).length / K;
    
    // Arm B: avg rank of selected candidate
    const bAvgRank = armB.reduce((sum, r) => sum + (r.best?.ranker?.rank || 0), 0) / K;
    
    // Arm B: avg modelMs
    const bAvgMs = armB.reduce((sum, r) => sum + (r.best?.modelMs || 0), 0) / K;
    
    // Arm A: avg modelMs
    const aTotalMs = armA.reduce((sum, r) => sum + (r.modelMs || 0), 0);
    
    // Arm B: total modelMs (all N candidates)
    const bTotalMs = armB.reduce((sum, r) => sum + r.allCandidates.reduce((s, c) => s + (c.modelMs || 0), 0), 0);
    
    const delta = ((bPassAt1Selected - aPassAt1) * 100).toFixed(1);
    
    console.log(`\n  ${problem}:`);
    console.log(`    Arm A (Bo5):   pass@1 = ${aPassAt1.toFixed(3)} (${armA.filter(r => r.pass || r.attempts?.[0]?.pass).length}/${K})`);
    console.log(`    Arm B (RankEF): pass@1(selected) = ${bPassAt1Selected.toFixed(3)} (${armB.filter(r => r.best?.pass).length}/${K})`);
    console.log(`    Arm B (RankEF): pass@N(any) = ${bPassAtN.toFixed(3)}`);
    console.log(`    Delta: ${delta}pp`);
    console.log(`    Arm B avg rank: ${bAvgRank.toFixed(2)}`);
    console.log(`    Cost: A=${(aTotalMs/1000).toFixed(1)}s total, B=${(bTotalMs/1000).toFixed(1)}s total (ratio=${(bTotalMs/Math.max(aTotalMs,1)).toFixed(1)}x)`);
  }
  
  // Write results
  const resultsPath = join(runDir, 'results.json');
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults written to: ${resultsPath}`);
  
  // Write comparison report
  const report = {
    version: RANK_EF_VERSION,
    model: MODEL,
    problems,
    K,
    N,
    timestamp,
    perProblem: {},
  };
  
  for (const problem of problems) {
    const armA = results.armA[problem];
    const armB = results.armB[problem];
    
    report.perProblem[problem] = {
      armA_passAt1: armA.filter(r => r.pass || r.attempts?.[0]?.pass).length / K,
      armB_passAt1Selected: armB.filter(r => r.best?.pass).length / K,
      armB_passAtN: armB.filter(r => r.allCandidates?.some(c => c.pass)).length / K,
      armB_avgRank: armB.reduce((sum, r) => sum + (r.best?.ranker?.rank || 0), 0) / K,
      delta_pp: ((armB.filter(r => r.best?.pass).length / K) - (armA.filter(r => r.pass || r.attempts?.[0]?.pass).length / K)) * 100,
    };
  }
  
  const reportPath = join(runDir, 'comparison.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Comparison written to: ${reportPath}`);
  
  // Write human-readable report
  const lines = [];
  lines.push(`# Rank-EF vs Best-of-5 Experiment Report`);
  lines.push(`Date: ${new Date().toISOString()}`);
  lines.push(`Model: ${MODEL}`);
  lines.push(`Problems: ${problems.join(', ')}`);
  lines.push(`Trials (k): ${K}, Candidates (N): ${N}`);
  lines.push(`RankEF version: ${RANK_EF_VERSION}`);
  lines.push('');
  lines.push('| Problem | Bo5 pass@1 | RankEF pass@1(selected) | Delta (pp) | RankEF pass@N | Avg Rank |');
  lines.push('|---------|------------|--------------------------|------------|---------------|----------|');
  
  for (const problem of problems) {
    const r = report.perProblem[problem];
    lines.push(`| ${problem} | ${(r.armA_passAt1 * 100).toFixed(0)}% | ${(r.armB_passAt1Selected * 100).toFixed(0)}% | ${r.delta_pp.toFixed(1)} | ${(r.armB_passAtN * 100).toFixed(0)}% | ${r.armB_avgRank.toFixed(2)} |`);
  }
  
  lines.push('');
  lines.push('## Kill Criteria');
  lines.push(`- Pass@1 lift: ${Object.values(report.perProblem).every(r => r.delta_pp >= 5) ? 'PASS (>=5pp)' : 'FAIL (<5pp)'}`);
  lines.push(`- Avg rank: ${Object.values(report.perProblem).every(r => r.armB_avgRank <= 2.5) ? 'PASS (<=2.5)' : 'FAIL (>2.5)'}`);
  
  const reportMdPath = join(runDir, 'report.md');
  writeFileSync(reportMdPath, lines.join('\n'));
  console.log(`Report written to: ${reportMdPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});