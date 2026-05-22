# Reasoning OS v0 RCR Loop 1 — Binary Search Failure

## Trigger

Prior N4 run:

- baseline: `reasoning_os_v0`
- problem: `binary-search`
- failure: pass@1 miss, pass@N recovered
- automated failure code: `logic_assertion.assertion_failed`
- automated update target: `correctness → algorithmic_strategy_scaffold`

## Trace-level root cause

Deeper trace inspection showed the automated target was too shallow.

The generated solution in attempt 0 contained:

1. a correct first fenced Python solution block with `from typing import List` and `def search(...)`, then
2. a second fenced Python block containing unittest/test code.

Old `extractCode(...)` behavior:

- stripped fences globally,
- returned from first top-level `def` to end of response,
- concatenated the solution block and test block,
- dropped the leading `from typing import List` before the first `def`,
- then `ensureTypingImports(...)` did not re-add the import because the later test block still contained `from typing import List`.

So the mechanical test failure was not really algorithmic. It was an extraction/protocol contamination failure misclassified downstream as `logic_assertion`.

## Delta applied

Component corrected conceptually:

- from: `algorithmic_strategy_scaffold`
- to: `structured_output_contract` / extraction contract

Implemented changes:

- `code-extract.js`
  - now prefers the first fenced Python/code block when multiple fenced blocks are present,
  - preserves leading import/from lines before the first top-level def/class,
  - preserves decorators/comments/docstring-adjacent context needed by the definition.
- `test-code-extract.js`
  - added 11 tests covering multi-block output, import preservation, simple extraction, class/decorator extraction, content/thinking fallback, and a real binary-search output simulation.

Delta log entry:

- file: `delta-logs/reasoning-os-v0.jsonl`
- id: `delta-02a0f167-d12a-4bdc-93c2-4f2cae44f796`
- status: `proposed`

## Local validation

Commands passed:

```bash
node test-code-extract.js
node test-basic-runner.js
node test-reasoning-os.js
node test-trace-log.js
```

Replay check on the original failed coder output:

- new extraction output: first solution block only
- preserved `from typing import List`
- `runBasicTest('binary-search', extractedCode)` result: pass

## Scoped live check

Command shape used: direct `evalProblem(...)` with temp trace dir to avoid state contamination.

Result:

- problem: `binary-search`
- baseline: `reasoning_os_v0`
- pass@1: `true`
- pass@N: `true`
- attempts: `1`
- trace: `/tmp/reasoning-os-rcr-binary/binary-search-reasoning_os_v0.jsonl`

## Fresh N4 guard check

Temp-run result, not appended to `state.jsonl`:

- `binary-search`: pass@1 `✓`, pass@N `✓`, attempts `1`
- `climbing-stairs`: pass@1 `✓`, pass@N `✓`, attempts `1`, AR `1`
- `container-with-most-water`: pass@1 `✗`, pass@N `✓`, first failure `timeout.execution_timeout`, attempts `2`
- `coin-change-ii`: pass@1 `✓`, pass@N `✓`, attempts `1`, AR `1`

Summary:

- pass@1: `3/4`
- pass@N: `4/4`
- all attempts had Reasoning OS metadata

Interpretation:

- The original binary-search failure is fixed under the extraction delta.
- No correctness regression appeared in N4, but one transient timeout moved the pass@1 miss to `container-with-most-water`.
- This confirms the delta addressed the specific failure mechanism, not broad capability improvement.

## RCR lesson

The first useful RCR loop was not “make binary search reasoning better.”

It was:

> failure label says logic, but trace says protocol/extraction. Update the component map by evidence, not by first classifier output.

This is exactly why the OS needs trace-derived deltas rather than only automated update targets.
