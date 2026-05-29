/**
 * problems.js — Load held-out test problems from the testcases directory
 *
 * Each problem lives in:
 *   ../shaper-autorepair/testcases/<name>/
 *     task.txt      — task description (the prompt)
 *     reference.ts — reference solution (not used for pass/fail in ablation,
 *                    but available if we want to add reference-based checks)
 *
 * Also reads _generation/ directory for training-set problems when needed.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROBLEMS_DIR = join(__dirname, "../shaper-autorepair/testcases");
const EXPANSION_DIR = join(__dirname, "testcases-expansion");

/**
 * Find the actual directory containing a problem.
 * Problems may be in either the main testcases dir or the expansion dir.
 */
function findProblemDir(name) {
  const mainPath = join(PROBLEMS_DIR, name);
  const expansionPath = join(EXPANSION_DIR, name);
  if (existsSync(join(mainPath, "task.txt"))) return mainPath;
  if (existsSync(join(expansionPath, "task.txt"))) return expansionPath;
  return null;
}

export function loadProblem(name) {
  const dir = findProblemDir(name);
  if (!dir) {
    throw new Error(`Problem ${name} not found in ${PROBLEMS_DIR} or ${EXPANSION_DIR}`);
  }

  const taskPath = join(dir, "task.txt");
  const refPath = join(dir, "reference.ts");

  const task = readFileSync(taskPath, "utf8").trim();
  const hasReference = existsSync(refPath);

  return { name, task, hasReference };
}

/**
 * Load all problems from a directory (not just top-level).
 * Subdirectories under _generation/ are also included.
 */
export function listProblems(dir = PROBLEMS_DIR) {
  const { readdirSync } = require("fs");
  const problems = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === "_generation" || name === "_held-out") {
        // Recurse into special directories
        const subDir = join(dir, name);
        const subProblems = listProblems(subDir);
        problems.push(...subProblems.map(p => ({ ...p, category: name.replace("_", "") })));
      } else {
        const taskPath = join(dir, name, "task.txt");
        if (existsSync(taskPath)) {
          problems.push({ name, category: "training" });
        }
      }
    }
  } catch (e) {
    // Directory may not exist
  }

  return problems;
}

/**
 * Load held-out problems specifically.
 * Problems may be in either the main testcases dir or the expansion dir.
 * The eval harness explicitly filters for them via problem name list rather than directory structure.
 */
export function loadHeldOutProblems() {
  // Held-out problems: explicitly named rather than directory-based
  const heldOutNames = [
    // Original 4
    "binary-search",
    "climbing-stairs",
    "container-with-most-water",
    "coin-change-ii",
    // New 4 (expansion to N=8)
    "two-sum",                // hash-map pattern
    "valid-palindrome",       // two-pointers pattern
    "number-of-islands",      // graph traversal / DFS pattern
    "invert-binary-tree",     // tree recursion pattern
    // Stress-suite v2 — discriminative problems (replaced ceiling-hitting v1 suite)
    "edit-distance",                    // DP 2D — base case + recurrence complexity
    "longest-increasing-subsequence",   // DP binary search — optimal structure
    "course-schedule-ii",                // topological sort — cycle detection + ordering
    "critical-connections",              // Tarjan's bridge — dfs, low-link, articulation
  ];
  const heldOut = [];

  for (const name of heldOutNames) {
    const dir = findProblemDir(name);
    if (dir) {
      heldOut.push(loadProblem(name));
    }
  }

  return heldOut;
}
