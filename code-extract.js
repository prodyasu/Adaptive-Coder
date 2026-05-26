/**
 * code-extract.js — Extract Python code from model response content or thinking field
 *
 * Handles class definitions, function definitions, and full module-level code.
 * Returns the complete Python module from first top-level definition to end.
 * If response has a class with no functions, returns the full class definition.
 * If response has functions, returns from first def to end of module.
 *
 * RCR delta (binary-search failure): prefers the FIRST fenced python/code block
 * when multiple blocks are present (avoids concatenating test code), and preserves
 * leading import/from lines that precede the first top-level def/class so that
 * type annotations keep their imports.
 */

export function extractCode(rawText) {
  if (!rawText || rawText.length < 10) return "";

  // Detect multiple fenced python/code blocks BEFORE stripping fences.
  // If there is more than one ```python ... ``` or ``` ... ``` block,
  // we take only the first block to avoid including test code that the model
  // appended after the solution.
  const blockStarts = [];
  const fenceRegex = /```(\w*)\n?/g;
  let match;
  while ((match = fenceRegex.exec(rawText)) !== null) {
    blockStarts.push(match.index);
  }

  // Strip markdown code fences
  let text = rawText.replace(/^```python\n?|```\n?$/gm, "").trim();

  // If multiple blocks were present, re-extract just the first one.
  // blockStarts.length >= 2 means at least two fence openers were found.
  if (blockStarts.length >= 2) {
    // Find the first ```python or ``` line and capture until the matching close
    const firstBlockMatch = rawText.match(/^```(?:python)?\n([\s\S]*?)^```/m);
    if (firstBlockMatch) {
      text = firstBlockMatch[1].replace(/^```python\n?|```\n?$/gm, "").trim();
    }
  }

  // Find the first top-level definition: either class or def
  const lines = text.split("\n");

  // Find index of first top-level class or def (no leading whitespace)
  let firstDefIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("class ") || trimmed.startsWith("def ")) {
      firstDefIdx = i;
      break;
    }
  }

  if (firstDefIdx < 0) return "";

  // Collect all lines from first definition to end
  // BUT: also collect any leading import/from lines that appear BEFORE
  // the first top-level def/class, so type annotations keep their imports.
  // We look backwards from firstDefIdx to capture import statements.
  // We skip: blank lines, docstrings, comments, and decorator lines (@foo)
  // since they do not signal a real code boundary.
  let startIdx = firstDefIdx;
  for (let i = firstDefIdx - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("@")) continue; // decorator — skip over it
    if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
      startIdx = i;
    } else {
      // Non-import, non-blank, non-comment, non-decorator — stop here
      break;
    }
  }

  const moduleLines = lines.slice(startIdx);

  // Strip model-appended test scaffolding that appears after the main function.
  // Patterns: standalone "import pytest", "class Test...", "if __name__ == '__main__':", etc.
  // We keep everything up to (but not including) the first such line that appears
  // AFTER the initial top-level def/class.
  const cutPatterns = [
    /^import pytest\b/,
    /^from pytest\b/,
    /^class Test[A-Z]/,       // TestXxx classes
    /^class Test_/,           // test_xxx style
    /^if __name__\s*==\s*['"]__main__['"]/,
  ];

  let cutLine = moduleLines.length; // default: keep all
  // Find the first line that matches a cut pattern, but only after the main def body
  // (i.e., after a dedent back to column 0 with a cut-matching line)
  for (let i = 1; i < moduleLines.length; i++) {
    const trimmed = moduleLines[i].trimStart();
    const isAtCol0 = moduleLines[i] === trimmed || moduleLines[i].startsWith(moduleLines[i].trimStart());
    // Only cut if it's at indentation level 0 (top-level test scaffolding)
    if (isAtCol0 || trimmed === moduleLines[i]) {
      for (const pat of cutPatterns) {
        if (pat.test(trimmed)) {
          cutLine = i;
          break;
        }
      }
      if (cutLine < moduleLines.length) break;
    }
  }

  const finalLines = moduleLines.slice(0, cutLine);
  return finalLines.join("\n");
}

/**
 * Extract from content or thinking field, in that priority order.
 */
export function extractFromResponse(response) {
  const content = response?.content?.trim() || "";
  if (content && content.length > 20) {
    const code = extractCode(content);
    if (code.length > 10) return code;
  }

  const thinking = response?.thinking?.trim() || "";
  if (thinking && thinking.length > 20) {
    const code = extractCode(thinking);
    if (code.length > 10) return code;
  }

  const raw = response?.raw?.message?.content?.trim() || "";
  if (raw && raw.length > 20) {
    const code = extractCode(raw);
    if (code.length > 10) return code;
  }

  return "";
}