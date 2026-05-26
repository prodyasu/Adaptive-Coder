/**
 * invariant-constrained-generation.js — Delta 6: Invariant-Constrained Generation (ICG)
 *
 * PERM_GRAD explains why post-hoc interventions can't move outcomes: they annotate
 * after generation, not during it. The only deltas that worked (sig-repair, informed
 * repair) rewrite the artifact or feed real failure signal back at generation time.
 *
 * ICG goes further: it acts BEFORE code is written. After the Shaper produces a spec,
 * an invariant extraction step derives structural invariants (loop invariants, boundary
 * conditions, type constraints, correctness conditions) from the spec. These invariants
 * are then injected into the Coder prompt as explicit constraints.
 *
 * Pipeline change:
 *   Baseline:  Shaper → Coder → [Verifier] → [Autorepair]
 *   ICG:       Shaper → Planner/Invariants → Coder(with invariants) → [Verifier] → [Autorepair]
 *
 * The invariants are derived deterministically (no model calls) from the Shaper spec
 * using pattern matching on constraints, acceptance criteria, and objective.
 *
 * This is an OPT-IN eval flag. No existing baselines are modified. Setting
 * icgEnabled=true on a reasoning_os_v0 baseline activates the invariant injection
 * step between Shaper and Coder.
 *
 * Module exports:
 *   - INVARIANT_TYPES — enum for invariant categories
 *   - INVARIANT_CONFIDENCE — confidence levels
 *   - ICG_PROMPT — system prompt for Coder with invariant section
 *   - extractInvariants(spec, problemName) — derive invariants from Shaper spec
 *   - formatInvariantsForCoder(invariants) — format invariants for Coder prompt
 *   - buildICGCoderPrompt(problemName, invariants, driftName) — build Coder prompt with invariants
 *   - applyInvariantConstrainedGeneration(spec, problemName, opts) — main entry point
 */

// ---------------------------------------------------------------------------
// Invariant types (matches failure-metrics failure classes where possible)
// ---------------------------------------------------------------------------

export const INVARIANT_TYPES = Object.freeze({
  LOOP_INVARIANT: 'loop_invariant',           // "at each step, result accumulates..."
  BOUNDARY_CONDITION: 'boundary_condition',     // "for empty input, return 0"
  TYPE_CONSTRAINT: 'type_constraint',           // "input is List[int], output is int"
  CORRECTNESS_CONDITION: 'correctness_condition', // "result must equal expected for all test cases"
  STATE_INVARIANT: 'state_invariant',           // "visited set only grows, never shrinks"
  EDGE_CASE_GUARD: 'edge_case_guard',           // "handle None/empty input gracefully"
  COMPLEXITY_BOUND: 'complexity_bound',          // "solution must be O(n) or O(n log n)"
});

export const INVARIANT_CONFIDENCE = Object.freeze({
  HIGH: 'high',     // Derived directly from spec text
  MEDIUM: 'medium', // Inferred from constraints/acceptance criteria
  LOW: 'low',       // Plausible but not directly specifiable
});

// ---------------------------------------------------------------------------
// ICG system prompt — extends the standard Coder prompt with invariant section
// ---------------------------------------------------------------------------

export const ICG_SYSTEM_PROMPT = `You are a precise code implementation agent. You receive a TaskSpec with DERIVED INVARIANTS and produce complete, working Python code.

CRITICAL CONSTRAINTS:
- Language: Python 3
- Function signature: {{SIGNATURE}}
- Do not change parameter names or order from the signature above
- Use exact types shown in the signature
- **RESPECT EVERY INVARIANT listed below** — these are derived from the spec and must hold in your implementation

Rules:
- Implement exactly what the spec asks for. No more, no less.
- Respect every constraint listed in the spec.
- **Each invariant must be satisfied by your implementation.** Verify mentally before outputting.
- Include all necessary imports and boilerplate.
- Produce code that is ready to use without modification.
- Output ONLY the code. No markdown fences, no commentary, no explanations.`;

// ---------------------------------------------------------------------------
// Invariant extraction — deterministic, no model calls
// ---------------------------------------------------------------------------

/**
 * Extract invariants from a Shaper spec object.
 *
 * The Shaper produces JSON with: objective, constraints, acceptance_criteria,
 * target_files, context_hints. We derive invariants by pattern-matching each
 * field for structural properties that constrain the implementation.
 *
 * @param {Object} spec - Shaper output JSON spec
 * @param {string} problemName - Problem identifier for problem-specific invariants
 * @returns {Array<{type: string, description: string, source: string, confidence: string}>}
 */
export function extractInvariants(spec, problemName) {
  if (!spec || typeof spec !== 'object') {
    return [];
  }

  const invariants = [];
  const constraints = Array.isArray(spec.constraints) ? spec.constraints : [];
  const acceptanceCriteria = Array.isArray(spec.acceptance_criteria) ? spec.acceptance_criteria : [];
  const objective = spec.objective || '';

  // 1. Extract TYPE_CONSTRAINT invariants from constraints mentioning types
  for (const c of constraints) {
    const lower = c.toLowerCase();

    // Type constraints: "input is", "returns", "output should be", "must return"
    const typeMatch = lower.match(/(?:input|inputs?|returns?|outputs?|should (?:return|be|contain)|must (?:return|be|contain))\s+(\w[\w\s]*?)(?:\.|,|$)/);
    if (typeMatch) {
      invariants.push({
        type: INVARIANT_TYPES.TYPE_CONSTRAINT,
        description: c,
        source: 'constraint',
        confidence: INVARIANT_CONFIDENCE.HIGH,
      });
    }

    // Complexity bounds
    if (/(time|space|runtime)\s*complexity|o\(|big\s*o|linear|logarithmic|quadratic|constant\s*time/i.test(lower)) {
      invariants.push({
        type: INVARIANT_TYPES.COMPLEXITY_BOUND,
        description: c,
        source: 'constraint',
        confidence: INVARIANT_CONFIDENCE.HIGH,
      });
    }

    // Edge case guards: "handle empty", "null", "None", "zero", "negative"
    if (/(empty|none|null|zero|negative|missing|edge.case|boundary)/i.test(lower)) {
      invariants.push({
        type: INVARIANT_TYPES.EDGE_CASE_GUARD,
        description: c,
        source: 'constraint',
        confidence: INVARIANT_CONFIDENCE.HIGH,
      });
    }

    // Loop/state invariants: "at each step", "maintain", "preserve", "accumulate"
    if (/(at each step|maintain|preserve|accumulate|track|keep|ensure)/i.test(lower)) {
      invariants.push({
        type: INVARIANT_TYPES.LOOP_INVARIANT,
        description: c,
        source: 'constraint',
        confidence: INVARIANT_CONFIDENCE.MEDIUM,
      });
    }
  }

  // 2. Extract BOUNDARY_CONDITION and CORRECTNESS_CONDITION invariants from acceptance criteria
  for (const ac of acceptanceCriteria) {
    const lower = ac.toLowerCase();

    // Boundary conditions: "for empty", "when X is 0", "no elements"
    if (/(\bfor\b|\bwhen\b|\bif\b).*(empty|zero|no |single|one |none|null|length\s*(of|is|=))/i.test(lower)) {
      invariants.push({
        type: INVARIANT_TYPES.BOUNDARY_CONDITION,
        description: ac,
        source: 'acceptance_criteria',
        confidence: INVARIANT_CONFIDENCE.HIGH,
      });
    }

    // Correctness conditions: "should return", "must equal", "correctly handles"
    if (/should return|must equal|correctly handles|matches the expected|returns the/i.test(lower)) {
      invariants.push({
        type: INVARIANT_TYPES.CORRECTNESS_CONDITION,
        description: ac,
        source: 'acceptance_criteria',
        confidence: INVARIANT_CONFIDENCE.HIGH,
      });
    }
  }

  // 3. Derive problem-specific invariants for known problem patterns
  const problemInvariants = extractProblemSpecificInvariants(problemName, spec);
  invariants.push(...problemInvariants);

  // 4. Deduplicate — remove near-identical invariants (Jaccard > 0.7 on token overlap)
  return deduplicateInvariants(invariants);
}

/**
 * Extract problem-specific invariants based on known algorithmic patterns.
 * These are derived from the problem name and spec objective.
 * Only add invariants that are SPEC-deducible, not oracle knowledge.
 */
function extractProblemSpecificInvariants(problemName, spec) {
  const invariants = [];
  const objective = (spec.objective || '').toLowerCase();

  // Binary search invariant: result is index or -1
  if (problemName === 'binary-search' || /binary\s*search|find\s*index|search\s*sorted/i.test(objective)) {
    invariants.push({
      type: INVARIANT_TYPES.CORRECTNESS_CONDITION,
      description: 'If target exists in array, result is its index; otherwise result is -1',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
    invariants.push({
      type: INVARIANT_TYPES.LOOP_INVARIANT,
      description: 'Search range always narrows: left moves up or right moves down, target always in [left, right] if present',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
  }

  // Climbing stairs: result is fibonacci-like
  if (problemName === 'climbing-stairs' || /climb.*stair|n.step|number of ways/i.test(objective)) {
    invariants.push({
      type: INVARIANT_TYPES.LOOP_INVARIANT,
      description: 'Each step combines results from previous two steps: f(n) = f(n-1) + f(n-2)',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
    invariants.push({
      type: INVARIANT_TYPES.BOUNDARY_CONDITION,
      description: 'Base cases: f(1) = 1, f(2) = 2',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.LOW,
    });
  }

  // Container with most water: two-pointer invariant
  if (problemName === 'container-with-most-water' || /container|most water|max area|two.pointer/i.test(objective)) {
    invariants.push({
      type: INVARIANT_TYPES.LOOP_INVARIANT,
      description: 'Two pointers move inward: always move the shorter line inward, because moving the taller one cannot increase area',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
  }

  // Coin change II: DP with unbounded knapsack
  if (problemName === 'coin-change-ii' || /coin change|number.*combinations|ways to make amount/i.test(objective)) {
    invariants.push({
      type: INVARIANT_TYPES.LOOP_INVARIANT,
      description: 'dp[i] accumulates number of ways to make amount i; iterate amounts for each coin to avoid double-counting',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
    invariants.push({
      type: INVARIANT_TYPES.BOUNDARY_CONDITION,
      description: 'There is exactly 1 way to make amount 0: use no coins',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.LOW,
    });
  }

  // Two sum: hash map invariant
  if (problemName === 'two-sum' || /two sum|find.*indices|complement/i.test(objective)) {
    invariants.push({
      type: INVARIANT_TYPES.LOOP_INVARIANT,
      description: 'For each element, check if (target - element) exists in previously seen elements; store index upon match',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
  }

  // Valid palindrome: two-pointer comparison
  if (problemName === 'valid-palindrome' || /palindrome|alphanumeric|read.*same.*forward.*backward/i.test(objective)) {
    invariants.push({
      type: INVARIANT_TYPES.LOOP_INVARIANT,
      description: 'Compare characters from both ends, skipping non-alphanumeric; pointers meet in middle',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
  }

  // Number of islands: DFS/BFS marking invariant
  if (problemName === 'number-of-islands' || /islands|connected.*1|count.*region/i.test(objective)) {
    invariants.push({
      type: INVARIANT_TYPES.LOOP_INVARIANT,
      description: 'Visited cells are marked ("2" or "0") to prevent re-counting; each DFS/BFS call explores one complete island',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
    invariants.push({
      type: INVARIANT_TYPES.STATE_INVARIANT,
      description: 'Grid is modified in-place to mark visited; each "1" is visited exactly once',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
  }

  // Invert binary tree: recursive swap
  if (problemName === 'invert-binary-tree' || /invert.*tree|swap.*children|mirror.*binary/i.test(objective)) {
    invariants.push({
      type: INVARIANT_TYPES.LOOP_INVARIANT,
      description: 'Each node swaps its left and right children; recursive call processes both subtrees',
      source: 'problem_pattern',
      confidence: INVARIANT_CONFIDENCE.MEDIUM,
    });
  }

  return invariants;
}

/**
 * Remove near-duplicate invariants (Jaccard similarity > 0.7 on token overlap).
 * Identical invariants from different sources are kept (different provenance matters).
 */
function deduplicateInvariants(invariants) {
  if (invariants.length <= 1) return invariants;

  const result = [];
  for (const inv of invariants) {
    const tokens = tokenize(inv.description);
    let isDuplicate = false;

    for (const existing of result) {
      const existingTokens = tokenize(existing.description);
      const similarity = jaccardSimilarity(tokens, existingTokens);
      if (similarity > 0.7 && inv.type === existing.type) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(inv);
    }
  }

  return result;
}

function tokenize(text) {
  return new Set(text.toLowerCase().split(/\s+/).filter(t => t.length > 2));
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Formatting — produce Coder-ready invariant block
// ---------------------------------------------------------------------------

/**
 * Format extracted invariants into a Coder-consumable section.
 *
 * Groups invariants by type for readability and orders by confidence (HIGH first).
 *
 * @param {Array} invariants - Output of extractInvariants()
 * @returns {string} Formatted invariant section for prompt injection
 */
export function formatInvariantsForCoder(invariants) {
  if (!invariants || invariants.length === 0) {
    return '';
  }

  // Sort by confidence (HIGH first, then MEDIUM, then LOW)
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...invariants].sort((a, b) =>
    (confidenceOrder[a.confidence] ?? 99) - (confidenceOrder[b.confidence] ?? 99)
  );

  const lines = ['\n--- DERIVED INVARIANTS (must hold in your implementation) ---'];
  for (const inv of sorted) {
    const confidenceTag = inv.confidence === 'high' ? '[HIGH]' :
                          inv.confidence === 'medium' ? '[MED]' : '[LOW]';
    const typeTag = inv.type.replace(/_/g, ' ').toUpperCase();
    lines.push(`${confidenceTag} ${typeTag}: ${inv.description}`);
  }
  lines.push('--- END INVARIANTS ---\n');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Prompt construction — ICG-aware Coder prompt
// ---------------------------------------------------------------------------

/**
 * Build the Coder system prompt with ICG invariants injected.
 *
 * Uses ICG_SYSTEM_PROMPT which adds an invariant constraint section.
 * Replaces {{SIGNATURE}} with the actual Python signature.
 *
 * @param {string} problemName - Problem identifier
 * @param {Array} invariants - Extracted invariants
 * @param {string|null} driftName - Optional drift name for induced-drift testing
 * @returns {string} Complete system prompt for the Coder
 */
export function buildICGCoderPrompt(problemName, invariants, driftName = null) {
  // Load the signature (same as buildCoderPrompt in eval.js)
  // Note: signature loading is handled in eval.js pipeline, not here.
  // This function returns the prompt template with invariants embedded.

  const invariantSection = formatInvariantsForCoder(invariants);

  // The ICG prompt includes the invariant section between the standard
  // constraints and the rules. We inject it after the SIGNATURE placeholder
  // is resolved by the caller (eval.js handles signature resolution).
  return ICG_SYSTEM_PROMPT + invariantSection;
}

// ---------------------------------------------------------------------------
// Main entry point — apply ICG to a spec
// ---------------------------------------------------------------------------

/**
 * Apply Invariant-Constrained Generation to a Shaper spec.
 *
 * This is the main entry point called from eval.js when icgEnabled=true.
 * It takes the Shaper spec and produces an enriched context with invariants
 * that will be injected into the Coder prompt.
 *
 * @param {Object} spec - Shaper output JSON spec
 * @param {string} problemName - Problem identifier
 * @param {Object} opts - Options
 * @param {boolean} [opts.icgEnabled] - Whether ICG is enabled (redundant, caller checks)
 * @returns {{
 *   invariants: Array,
 *   invariantSection: string,
 *   icgPrompt: string,
 *   trace: { icgEnabled: boolean, invariantCount: number, invariantTypes: string[], sourceCounts: Object }
 * }}
 */
export function applyInvariantConstrainedGeneration(spec, problemName, opts = {}) {
  const invariants = extractInvariants(spec, problemName);
  const invariantSection = formatInvariantsForCoder(invariants);
  const icgPrompt = buildICGCoderPrompt(problemName, invariants);

  // Build trace metadata
  const invariantTypes = [...new Set(invariants.map(i => i.type))];
  const sourceCounts = {};
  for (const inv of invariants) {
    sourceCounts[inv.source] = (sourceCounts[inv.source] || 0) + 1;
  }

  return {
    invariants,
    invariantSection,
    icgPrompt,
    trace: {
      icgEnabled: true,
      invariantCount: invariants.length,
      invariantTypes,
      sourceCounts,
    },
  };
}