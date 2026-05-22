/**
 * index.js — Main entry point for eval-harness v0.2.0
 *
 * Baseline definitions (v0.2.0):
 *   raw_base       — Coder only, no scaffold. Data already collected: 2/4.
 *   gen0_seed     — Shaper + Coder, autorepair OFF.
 *   gen18_evolved — Full pipeline (Shaper → Coder → Verifier), autorepair ON.
 *
 * Usage:
 *   node index.js --run raw_base    # (already have data — skip unless forcing re-run)
 *   node index.js --run gen0_seed   # run gen0 seed baseline
 *   node index.js --run gen18_evolved  # run gen18 evolved baseline
 *   node index.js --compare        # compare results
 *   node index.js --status          # show run status
 *   node index.js --resume          # resume interrupted run
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

import { evalProblem } from "./eval.js";
import { loadHeldOutProblems } from "./problems.js";
import { summarizeStateFailureKinds, formatFailureKindSummary } from "./failure-metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, "state.jsonl");
const PROBLEMS_DEFAULT = ["binary-search", "climbing-stairs", "container-with-most-water", "coin-change-ii"];

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function loadState(baselineKind) {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const lines = readFileSync(STATE_FILE, "utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const state = JSON.parse(lines[i]);
      if (state.baselineKind === baselineKind) return state;
    }
  } catch (e) {}
  return null;
}

function saveState(state) {
  const line = JSON.stringify({ ...state, updated: new Date().toISOString() });
  writeFileSync(STATE_FILE, line + "\n", { flag: "a" });
}

function getOrCreateState(baselineKind, model) {
  let state = loadState(baselineKind);
  if (!state) {
    const heldOut = loadHeldOutProblems();
    const problemNames = heldOut.length > 0
      ? heldOut.map(p => p.name)
      : PROBLEMS_DEFAULT;

    state = {
      runId: randomUUID(),
      baselineKind,
      model,
      problems: Object.fromEntries(problemNames.map(n => [
        n,
        { status: "pending", attempts: [], finalPass: false, passAt1: false }
      ])),
      started: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
  }
  return state;
}

// ---------------------------------------------------------------------------
// Main run loop
// ---------------------------------------------------------------------------

async function runBaseline(baselineKind, model, problemNames, signal) {
  const state = getOrCreateState(baselineKind, model);
  console.log(`\n=== ${baselineKind} — ${model} ===`);
  console.log(`Run ID: ${state.runId}`);
  console.log(`Problems: ${problemNames.join(", ")}`);
  console.log(`State file: ${STATE_FILE}\n`);

  for (const name of problemNames) {
    const result = state.problems[name];

    if (result.status === "done") {
      console.log(`  ${name}: already done (pass@1=${result.passAt1}, pass@N=${result.finalPass})`);
      continue;
    }

    state.problems[name] = { status: "running", attempts: [], finalPass: false, passAt1: false };
    saveState(state);

    console.log(`  ${name}: running...`);
    try {
      const attempts = await evalProblem(name, baselineKind, model, { signal });

      const passAt1 = attempts[0]?.pass || false;
      const finalPass = attempts.some(a => a.pass);

      state.problems[name] = {
        status: "done",
        attempts,
        finalPass,
        passAt1,
      };

      const passSymbol = finalPass ? "✓" : "✗";
      const passAt1Symbol = passAt1 ? "✓" : "✗";
      const totalModelMs = attempts.reduce((s, a) => s + (a.modelMs || 0), 0);
      const totalWaitMs = attempts.reduce((s, a) => s + (a.waitMs || 0), 0);
      const totalAR = attempts.reduce((s, a) => s + (a.autorepairCycles || 0), 0);
      console.log(`  ${name}: ${passSymbol} pass@N (pass@1 ${passAt1Symbol}) | ${attempts.length} attempts | ${totalModelMs}ms model | ${totalWaitMs}ms wait | AR:${totalAR}`);

    } catch (err) {
      if (err.name === "AbortError" || err.message?.includes("abort")) {
        console.log(`  ${name}: ABORTED (state preserved)`);
        state.problems[name].status = "pending";
      } else {
        console.log(`  ${name}: ERROR: ${err.message?.slice(0, 80)}`);
        state.problems[name].status = "done";
        state.problems[name].error = err.message?.slice(0, 100);
      }
    }

    saveState(state);
  }

  return state;
}

// ---------------------------------------------------------------------------
// Comparison report
// ---------------------------------------------------------------------------

function compareResults(states) {
  const byKind = {};
  for (const [kind, state] of Object.entries(states)) {
    byKind[kind] = state;
  }

  const kinds = Object.keys(byKind);
  if (kinds.length < 1) { console.log("No data to compare"); return; }

  const allProblems = kinds[0] ? Object.keys(byKind[kinds[0]].problems) : [];

  console.log("\n=== ABLATION RESULTS ===\n");
  console.log("Problem".padEnd(30) + kinds.map(k => k.padStart(12)).join(""));
  console.log("─".repeat(30 + kinds.length * 12));

  for (const name of allProblems) {
    let row = name.padEnd(30);
    for (const kind of kinds) {
      const res = byKind[kind]?.problems?.[name];
      const p1 = res?.passAt1 ? "✓" : "✗";
      const pN = res?.finalPass ? "✓" : "✗";
      row += (p1 + "/" + pN).padStart(12);
    }
    console.log(row);
  }

  console.log("\nSummary:");
  for (const kind of kinds) {
    const state = byKind[kind];
    const problems = state.problems;
    const p1Pass = Object.values(problems).filter(p => p.passAt1).length;
    const pNPass = Object.values(problems).filter(p => p.finalPass).length;
    const total = Object.keys(problems).length;
    const failureSummary = summarizeStateFailureKinds(state);
    console.log(`  ${kind}: pass@1=${p1Pass}/${total} | pass@N=${pNPass}/${total}`);
    console.log(`    attempt kinds: ${formatFailureKindSummary(failureSummary)}`);
  }

  console.log("\n  NOTE: gen0_seed = RECONSTRUCTED PRINCIPLED PROXY.");
  console.log("  raw_base = coder-only (no scaffold).");
  console.log("  gen18_evolved = full pipeline with autorepair (as trained).");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--status")) {
  const kinds = ["raw_base", "gen0_seed", "gen18_evolved"];
  for (const kind of kinds) {
    const state = loadState(kind);
    if (state) {
      const done = Object.values(state.problems).filter(p => p.status === "done").length;
      const total = Object.keys(state.problems).length;
      const pass1 = Object.values(state.problems).filter(p => p.passAt1).length;
      console.log(`${kind}: ${done}/${total} done | pass@1: ${pass1}/${total}`);
    } else {
      console.log(`${kind}: no run`);
    }
  }
  process.exit(0);
}

if (args.includes("--compare")) {
  const kinds = ["raw_base", "gen0_seed", "gen18_evolved"];
  const states = {};
  for (const kind of kinds) {
    const s = loadState(kind);
    if (s) states[kind] = s;
  }
  compareResults(states);
  process.exit(0);
}

const runArgIdx = args.indexOf("--run");
if (runArgIdx >= 0) {
  const baselineKind = args[runArgIdx + 1] || "gen0_seed";
  const model = "kimi-k2.5:cloud";

  (async () => {
    try {
      await runBaseline(baselineKind, model, PROBLEMS_DEFAULT, null);
      process.exit(0);
    } catch(e) {
      console.error("Fatal:", e.message);
      process.exit(1);
    }
  })();
} else {
  // Interactive / help
  console.log("eval-harness v0.2.0 — scaffold ablation runner");
  console.log("==========================================");
  console.log("\nUsage:");
  console.log("  node index.js --run raw_base      # coder-only (already have 2/4)");
  console.log("  node index.js --run gen0_seed     # shaper+coder, no autorepair");
  console.log("  node index.js --run gen18_evolved # full pipeline, autorepair ON");
  console.log("  node index.js --compare          # compare all baselines");
  console.log("  node index.js --status          # show run status");
  console.log("  node index.js --resume          # resume interrupted run");
}