/**
 * calibrate.js — Run raw_base on all expansion problems to categorize by difficulty
 */

import { callOllama } from '../cc-lib/build/providers.js';
import { extractFromResponse } from './code-extract.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPANSION_DIR = join(__dirname, 'testcases-expansion');

const CODER_PROMPT = `You are a precise code implementation agent. You receive a TaskSpec and produce complete, working code.
Rules:
- Produce code that is ready to use without modification.
- Output ONLY the code. No markdown fences, no commentary, no explanations.`;

// Python tests - use proper Python syntax, re module for regex, `is True` not `== True`
const TESTS = {
  'valid-palindrome': [
    `import re; assert is_palindrome("A man, a plan, a canal: Panama") is True`,
    `assert is_palindrome("race a car") is False`,
    `assert is_palindrome(" ") is True`,
    `assert is_palindrome("a") is True`,
    `assert is_palindrome("ab") is False`,
  ],
  'reverse-linked-list': [
    `def eq(a, b): return all(x == y for x, y in zip(a, b))`,
    `assert eq(reverse_list([1,2,3,4,5]), [5,4,3,2,1])`,
    `assert eq(reverse_list([1,2]), [2,1])`,
    `assert eq(reverse_list([]), [])`,
  ],
  'invert-binary-tree': [
    `def eq(a, b): return str(a) == str(b)`,
    `assert invert_tree([4,2,7,1,3,6,9]) == [4,7,2,9,6,3,1]`,
    `assert invert_tree([2,1,3]) == [2,3,1]`,
    `assert invert_tree([]) == []`,
  ],
  'ransom-note': [
    `assert can_construct("a", "b") is False`,
    `assert can_construct("aa", "aab") is True`,
    `assert can_construct("abc", "abc") is True`,
  ],
  'min-stack': [
    `s=MinStack();s.push(-2);s.push(0);s.push(-3);assert s.getMin()==-3;s.pop();assert s.top()==0;assert s.getMin()==-2`,
  ],
  'number-of-islands': [
    `assert num_islands([["1","1","1"],["0","1","0"],["1","1","1"]])==3`,
    `assert num_islands([["0","0"],["0","0"]])==0`,
    `assert num_islands([["1"]])==1`,
  ],
  'longest-substring-without-repeating': [
    `assert lengthOfLongestSubstring("abcabcbb")==3`,
    `assert lengthOfLongestSubstring("bbbbb")==1`,
    `assert lengthOfLongestSubstring("pwwkew")==3`,
  ],
  'maximum-subarray': [
    `assert maxSubArray([-2,1,-3,4,-1,2,1,-5,4])==6`,
    `assert maxSubArray([1])==1`,
    `assert maxSubArray([5,4,-1,7,8])==23`,
  ],
  'merge-two-sorted-lists': [
    `def eq(a, b): return all(x == y for x, y in zip(a, b))`,
    `assert eq(mergeTwoLists([1,2,4],[1,3,4]), [1,1,2,3,4,4])`,
    `assert eq(mergeTwoLists([],[]), [])`,
    `assert eq(mergeTwoLists([],[0]), [0])`,
  ],
  'path-sum': [
    `assert hasPathSum(buildTree([5,4,8,11,None,13,4,7,2,None,None,None,1]), 22) is True`,
    `assert hasPathSum(buildTree([1,2,3]), 5) is False`,
  ],
  'find-minimum-in-rotated-array': [
    `assert findMin([3,4,5,1,2])==1`,
    `assert findMin([4,5,6,7,0,1,2])==0`,
    `assert findMin([11,13,15,17])==11`,
  ],
  'excel-sheet-column-number': [
    `assert titleToNumber("A")==1`,
    `assert titleToNumber("Z")==26`,
    `assert titleToNumber("AA")==27`,
    `assert titleToNumber("AB")==28`,
    `assert titleToNumber("ZY")==701`,
  ],
};

function runTests(code, problemName) {
  const tmpDir = tmpdir();
  const moduleName = problemName.replace(/-/g, '_');
  const tmpFile = join(tmpDir, `${moduleName}.py`);
  const tests = TESTS[problemName] || [];

  writeFileSync(tmpFile, code);
  try { execSync(`python3 -m py_compile ${tmpFile}`, { timeout: 3000 }); }
  catch(e) { return { pass: false, detail: 'compile: ' + (e.message?.split('\n').pop() || '?') }; }

  try {
    for (const test of tests) {
      const cmd = `PYTHONPATH=${tmpDir} python3 -c "${test.replace(/"/g, '\\"')}"`;
      execSync(cmd, { cwd: tmpDir, timeout: 3000 });
    }
    return { pass: true };
  } catch(e) {
    return { pass: false, detail: 'assert: ' + (e.message?.split('\n').pop() || '?') };
  }
}

async function calibrateProblem(problemName) {
  const task = readFileSync(join(EXPANSION_DIR, problemName, 'task.txt'), 'utf8').trim();
  const userPrompt = `Task: ${task}\n\nWrite Python code. Output only code.`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await callOllama('minimax-m2.7:cloud', [
        { role: 'system', content: CODER_PROMPT },
        { role: 'user', content: userPrompt }
      ], { timeoutMs: 25000, maxTokens: 4000 });

      const code = extractFromResponse(response);
      if (!code || code.length < 15) continue;

      const result = runTests(code, problemName);
      if (result.pass) return { passAt1: true, errors: [] };
    } catch(e) {}

    if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
  }
  return { passAt1: false, errors: ['all attempts failed'] };
}

const problems = [
  'valid-palindrome', 'reverse-linked-list', 'invert-binary-tree', 'ransom-note',
  'min-stack', 'number-of-islands', 'longest-substring-without-repeating',
  'maximum-subarray', 'merge-two-sorted-lists', 'path-sum',
  'find-minimum-in-rotated-array', 'excel-sheet-column-number',
];

const results = {};
for (const p of problems) {
  process.stdout.write(`${p}: calibrating... `);
  const r = await calibrateProblem(p);
  results[p] = r;
  console.log(r.passAt1 ? 'PASS' : 'FAIL');
}

const easy = problems.filter(p => results[p].passAt1);
const hard = problems.filter(p => !results[p].passAt1);
console.log('\n=== EASY (raw_base first-attempt):', easy.join(', ') || 'none');
console.log('=== HARD (raw_base fail):', hard.join(', ') || 'none');
console.log('\nNOTE: If ALL are hard, the base model struggles with all 12 problems.');
console.log('In that case, expand to include easier problems from training set as sanity checks.');

writeFileSync(join(__dirname, 'calibration-results.json'), JSON.stringify({ results, easy, hard }, null, 2));
