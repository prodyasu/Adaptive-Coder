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

export function loadProblem(name) {
  const taskPath = join(PROBLEMS_DIR, name, "task.txt");
  const refPath = join(PROBLEMS_DIR, name, "reference.ts");

  if (!existsSync(taskPath)) {
    throw new Error(`Problem ${name} not found at ${taskPath}`);
  }

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
 * Note: The held-out problems live at the top level of testcases/ alongside training problems.
 * The eval harness explicitly filters for them via problem name list rather than directory structure.
 */
export function loadHeldOutProblems() {
  // Held-out problems: explicitly named rather than directory-based
  const heldOutNames = ["binary-search", "climbing-stairs", "container-with-most-water", "coin-change-ii"];
  const heldOut = [];

  for (const name of heldOutNames) {
    const taskPath = join(PROBLEMS_DIR, name, "task.txt");
    if (existsSync(taskPath)) {
      heldOut.push(loadProblem(name));
    }
  }

  return heldOut;
}
