/**
 * code-extract.js — Extract Python code from model response content or thinking field
 *
 * Handles class definitions, function definitions, and full module-level code.
 * Returns the complete Python module from first top-level definition to end.
 * If response has a class with no functions, returns the full class definition.
 * If response has functions, returns from first def to end of module.
 */

export function extractCode(rawText) {
  if (!rawText || rawText.length < 10) return "";

  // Strip markdown code fences
  let text = rawText.replace(/^```python\n?|```\n?$/gm, "").trim();

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
  // Remove any leading explanation text before the first definition
  const moduleLines = lines.slice(firstDefIdx);
  
  return moduleLines.join("\n");
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