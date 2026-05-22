/**
 * test-code-extract.js — Tests for code-extract.js
 *
 * Covers:
 * 1. Multiple fenced python blocks: extract only first solution block, not test code
 * 2. Leading `from typing import List` before def is preserved
 * 3. Existing simple function extraction still works
 * 4. Single fenced block works
 * 5. No code returns empty
 * 6. Response-level extractFromResponse priority
 */

import { extractCode, extractFromResponse } from './code-extract.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// --- Helper to build multi-line strings cleanly ---
function multiline(...parts) {
  return parts.join('\n');
}

// --- Test 1: Multiple fenced python blocks → only first block ---
const multiBlock = multiline(
  "Here is my solution:",
  "",
  "```python",
  "from typing import List",
  "",
  "def search(nums: List[int], target: int) -> int:",
  "    left, right = 0, len(nums) - 1",
  "    while left <= right:",
  "        mid = (left + right) // 2",
  "        if nums[mid] == target:",
  "            return mid",
  "        elif nums[mid] < target:",
  "            left = mid + 1",
  "        else:",
  "            right = mid - 1",
  "    return -1",
  "```",
  "",
  "Here is my test suite:",
  "",
  "```python",
  "import unittest",
  "from binary_search import search",
  "",
  "class TestBinarySearch(unittest.TestCase):",
  "    def test_basic(self):",
  "        self.assertEqual(search([1,2,3], 2), 1)",
  "```"
);

const result1 = extractCode(multiBlock);
assert(!result1.includes("unittest"), "should not include test code");
assert(!result1.includes("from binary_search"), "should not include test imports");
assert(!result1.includes("class TestBinarySearch"), "should not include test class");
assert(result1.includes("def search"), "should include the search function");
assert(result1.includes("from typing import List"), "should preserve typing import");
console.log("✅ Test 1: multiple fenced blocks → first block only, no test code");

// --- Test 2: Leading `from typing import List` preserved before def ---
const withImport = multiline(
  "```python",
  "from typing import List",
  "",
  "def search(nums: List[int], target: int) -> int:",
  "    left, right = 0, len(nums) - 1",
  "    while left <= right:",
  "        mid = (left + right) // 2",
  "        if nums[mid] == target:",
  "            return mid",
  "        elif nums[mid] < target:",
  "            left = mid + 1",
  "        else:",
  "            right = mid - 1",
  "    return -1",
  "```"
);

const result2 = extractCode(withImport);
assert(result2.startsWith("from typing import List"), "should start with import");
assert(result2.includes("def search"), "should include search function");
console.log("✅ Test 2: leading import preserved");

// --- Test 3: Simple function extraction still works ---
const simple = multiline(
  "```python",
  "def hello(name):",
  "    return f\"Hello, {name}!\"",
  "```"
);

const result3 = extractCode(simple);
assert(result3.includes("def hello"), "should include function");
assert(result3.includes("return f"), "should include body");
console.log("✅ Test 3: simple function extraction works");

// --- Test 4: Single fenced block without triple-python specifier ---
const simpleNoLang = multiline(
  "```",
  "def foo():",
  "    return 42",
  "```"
);

const result4 = extractCode(simpleNoLang);
assert(result4.includes("def foo"), "should extract from no-lang fence");
console.log("✅ Test 4: single fenced block without language specifier");

// --- Test 5: No code returns empty ---
assert(extractCode("no code here") === "", "empty input returns empty string");
assert(extractCode("") === "", "empty string returns empty");
assert(extractCode("short") === "", "too short returns empty");
console.log("✅ Test 5: no code returns empty string");

// --- Test 6: Class definition extraction with leading import ---
const classOnly = multiline(
  "```python",
  "from dataclasses import dataclass",
  "",
  "@dataclass",
  "class Point:",
  "    x: int",
  "    y: int",
  "",
  "    def distance_to(self, other: Point) -> float:",
  "        dx = self.x - other.x",
  "        dy = self.y - other.y",
  "        return (dx*dx + dy*dy) ** 0.5",
  "```"
);

const result6 = extractCode(classOnly);
assert(result6.startsWith("from dataclasses"), "should preserve import before class");
assert(result6.includes("class Point"), "should include class definition");
assert(result6.includes("def distance_to"), "should include method");
console.log("✅ Test 6: class definition extraction with leading import");

// --- Test 7: extractFromResponse prioritizes content over thinking ---
const responseWithContent = {
  content: multiline("```python", "def solved(): return True", "```"),
  thinking: multiline("```python", "def wrong(): return False", "```"),
};
const result7 = extractFromResponse(responseWithContent);
assert(result7.includes("def solved"), "should use content field, not thinking");
console.log("✅ Test 7: extractFromResponse respects content > thinking priority");

// --- Test 8: extractFromResponse falls back to thinking ---
const responseNoContent = {
  thinking: multiline("```python", "def from_thinking(): pass", "```"),
};
const result8 = extractFromResponse(responseNoContent);
assert(result8.includes("def from_thinking"), "should fall back to thinking");
console.log("✅ Test 8: extractFromResponse falls back to thinking");

// --- Test 9: Block detection with 3+ blocks takes only first ---
const threeBlocks = multiline(
  "```python",
  "def first():",
  "    return 1",
  "```",
  "",
  "Some text between.",
  "",
  "```python",
  "def second():",
  "    return 2",
  "```",
  "",
  "More text.",
  "",
  "```python",
  "def third():",
  "    return 3",
  "```"
);

const result9 = extractCode(threeBlocks);
assert(result9.includes("def first"), "should include first function");
assert(!result9.includes("def second"), "should not include second function");
assert(!result9.includes("def third"), "should not include third function");
console.log("✅ Test 9: three blocks → only first extracted");

// --- Test 10: Leading import with no blank lines before def ---
const importNoGap = multiline(
  "```python",
  "from typing import Optional",
  "def find(item, lst):",
  "    return item in lst",
  "```"
);

const result10 = extractCode(importNoGap);
assert(result10.startsWith("from typing import Optional"), "import at start preserved");
assert(result10.includes("def find"), "function included");
console.log("✅ Test 10: import with no blank line gap before def");

// --- Test 11: Real binary-search model output (multiple blocks + import) ---
// Mimics the actual model output that caused the binary-search failure
const binarySearchReal = multiline(
  "",
  "",
  "```python",
  "from typing import List",
  "",
  "def search(nums: List[int], target: int) -> int:",
  "    left, right = 0, len(nums) - 1",
  "    ",
  "    while left <= right:",
  "        mid = (left + right) // 2",
  "        if nums[mid] == target:",
  "            return mid",
  "        elif nums[mid] < target:",
  "            left = mid + 1",
  "        else:",
  "            right = mid - 1",
  "    ",
  "    return -1",
  "```",
  "",
  "```python",
  "import unittest",
  "from binary_search import search",
  "",
  "",
  "class TestBinarySearch(unittest.TestCase):",
  "    def test_target_at_beginning(self):",
  "        self.assertEqual(search([1, 2, 3, 4, 5], 1), 0)",
  "    ",
  "    def test_target_at_end(self):",
  "        self.assertEqual(search([1, 2, 3, 4, 5], 5), 4)",
  "```"
);

const result11 = extractCode(binarySearchReal);
assert(!result11.includes("unittest"), "should not include unittest");
assert(!result11.includes("from binary_search"), "should not include test imports");
assert(!result11.includes("class TestBinarySearch"), "should not include test class");
assert(result11.startsWith("from typing import List"), "should start with typing import");
assert(result11.includes("def search(nums: List[int]"), "should include full search signature with type annotations");
assert(result11.includes("return -1"), "should include the return -1 statement");
console.log("✅ Test 11: real binary-search output (first block only, import preserved)");

console.log("\n🎉 All code-extract tests passed.");