/**
 * smoke-test-spec-gate.js — Local Ollama smoke test for spec validation gate
 *
 * Calls local Ollama (qwen2.5:3b) to generate code for coin-change-ii,
 * then validates signature against reference.
 */

import { validateSpec } from './spec-validator.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROBLEM = 'coin-change-ii';
const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const MODEL = 'qwen2.5:3b';

const task = readFileSync(join('..', 'shaper-autorepair', 'testcases', PROBLEM, 'task.txt'), 'utf8').trim();

const CODER_PROMPT = `You are a precise code implementation agent.
CRITICAL CONSTRAINTS:
- Language: Python 3
- Function signature: def change(amount: int, coins: List[int]) -> int:
- Do not change parameter names or order from the signature above
- Use exact types shown in the signature

Rules:
- Implement exactly what the task asks for. No more, no less.
- Include all necessary imports and boilerplate.
- Produce code that is ready to use without modification.
- Output ONLY the code. No markdown fences, no commentary, no explanations.
`;

async function callLocalOllama(system, user) {
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${system}\n\n${user}`,
      stream: false,
      options: { temperature: 0.1, num_predict: 800 },
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return data.response;
}

async function main() {
  console.log(`🧪 Smoke test: ${PROBLEM} via ${MODEL}`);
  console.log(`Task: ${task.slice(0, 60)}...\n`);

  const userPrompt = `Task: ${task}\n\nWrite Python code to solve this. Output only code, no markdown.`;
  const response = await callLocalOllama(CODER_PROMPT, userPrompt);

  console.log('--- Generated code ---');
  console.log(response.slice(0, 300) + '...\n');

  const validation = validateSpec(PROBLEM, response);
  console.log('--- Spec validation ---');
  console.log(`Match: ${validation.match}`);
  if (!validation.match) {
    console.log(`Mismatches: ${validation.mismatches.join(', ')}`);
    console.log(`Guidance: ${validation.guidance}`);
  }

  // Also test: what if coder produces wrong order?
  console.log('\n--- Wrong order test ---');
  const wrongCode = 'def change(coins: List[int], amount: int) -> int:\n    return 0';
  const wrongValidation = validateSpec(PROBLEM, wrongCode);
  console.log(`Match: ${wrongValidation.match}`);
  console.log(`Mismatches: ${wrongValidation.mismatches.join(', ')}`);
  console.log(`Guidance: ${wrongValidation.guidance}`);

  console.log('\n✅ Smoke test complete.');
}

main().catch(err => {
  console.error('❌ Smoke test failed:', err.message);
  process.exit(1);
});
