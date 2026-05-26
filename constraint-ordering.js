/**
 * constraint-ordering.js — Delta 3: Constraint ordering for reasoning flow
 *
 * Problem: LLM coders attend more strongly to early constraints than later ones.
 * Shaper output constraints arrive in arbitrary order, sometimes with contradictions,
 * suboptimal grouping, or redundant items that dilute attention on critical constraints.
 *
 * Solution: Reorder and restructure constraints before passing them to the coder:
 *   1. Prioritize signature/interface constraints (function name, param types)
 *   2. Deprioritize stylistic/formatting constraints
 *   3. Move "do not X" constraints adjacent to the positive version they constrain
 *   4. Deduplicate overlapping constraints
 *   5. Detect contradictions and flag them in the spec
 *
 * Target component: spec_alignment_scaffold
 * Target criterion: specAlignment
 */

// ---------------------------------------------------------------------------
// Constraint classification taxonomy
// ---------------------------------------------------------------------------

export const CONSTRAINT_CATEGORIES = Object.freeze({
  signature: 'signature',      // function name, param types, return type
  interface: 'interface',      // API contract, input/output shape
  algorithmic: 'algorithmic',  // core logic constraints (time/space complexity)
  edge_case: 'edge_case',      // boundary conditions, empty inputs, etc.
  style: 'style',              // formatting, naming conventions, code style
  negative: 'negative',       // "do not X" constraints
  redundant: 'redundant',     // duplicates or near-duplicates of earlier constraints
  ambiguous: 'ambiguous',     // unclear or contradictory constraints
});

// Priority order for constraint categories (higher = placed earlier)
const CATEGORY_PRIORITY = {
  [CONSTRAINT_CATEGORIES.signature]: 100,
  [CONSTRAINT_CATEGORIES.interface]: 90,
  [CONSTRAINT_CATEGORIES.algorithmic]: 80,
  [CONSTRAINT_CATEGORIES.edge_case]: 70,
  [CONSTRAINT_CATEGORIES.negative]: 60,
  [CONSTRAINT_CATEGORIES.style]: 30,
  [CONSTRAINT_CATEGORIES.redundant]: 0,    // will be deduplicated
  [CONSTRAINT_CATEGORIES.ambiguous]: 50,    // flagged but kept
};

// ---------------------------------------------------------------------------
// Constraint classification heuristics
// ---------------------------------------------------------------------------

/**
 * Classify a single constraint string into a category.
 * Uses keyword and pattern matching — no LLM calls.
 */
export function classifyConstraint(constraint) {
  const c = constraint.toLowerCase().trim();

  // Signature/interface constraints (highest priority)
  if (/^(function|method|class)\s+name/i.test(c) ||
      /must (be called|return|accept|take|have)\s+/i.test(c) ||
      /signature|param(eter)?s?\s*(must|should|are)/i.test(c) ||
      /return\s+type/i.test(c)) {
    return CONSTRAINT_CATEGORIES.signature;
  }

  // Interface contract constraints
  if (/(input|output)\s*(format|type|shape)/i.test(c) ||
      /api\s*contract/i.test(c) ||
      /must (implement|match|follow|conform)/i.test(c)) {
    return CONSTRAINT_CATEGORIES.interface;
  }

  // Edge case / boundary constraints
  if (/(edge\s*case|boundary|empty|zero|null|none|undefined|minimum|maximum)/i.test(c) ||
      /(handle|consider|account\s+for)\s+(empty|zero|null|negative|missing)/i.test(c)) {
    return CONSTRAINT_CATEGORIES.edge_case;
  }

  // Algorithmic constraints
  if (/(time|space)\s*complex/i.test(c) ||
      /(o\(|big\s*o|linear|logarithmic|quadratic|constant\s*time)/i.test(c) ||
      /algorithm/i.test(c) ||
      /(sort|search|traverse|iterate|recurse)/i.test(c) && /(must|should|need)/i.test(c)) {
    return CONSTRAINT_CATEGORIES.algorithmic;
  }

  // Negative constraints ("do not", "must not", "never", "avoid")
  if (/(do\s+not|must\s+not|never|avoid|don't|should\s+not)/i.test(c)) {
    return CONSTRAINT_CATEGORIES.negative;
  }

  // Style/formatting constraints (lowest substantive priority)
  if (/(naming\s*convention|camelcase|snake_case|pep\s*8|formatting|style|readable|comment)/i.test(c) ||
      /(include|add)\s+(import|docstring|type\s*hint)/i.test(c)) {
    return CONSTRAINT_CATEGORIES.style;
  }

  // Default: algorithmic (medium priority)
  return CONSTRAINT_CATEGORIES.algorithmic;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Compute a simple string similarity between two constraints.
 * Uses Jaccard similarity on word sets.
 */
function jaccardSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Remove near-duplicate constraints (Jaccard > threshold).
 * Keeps the first occurrence and marks others as redundant.
 */
export function deduplicateConstraints(constraints, threshold = 0.7) {
  const kept = [];
  const removed = [];

  for (const c of constraints) {
    const isDuplicate = kept.some(k => jaccardSimilarity(c, k) >= threshold);
    if (isDuplicate) {
      removed.push(c);
    } else {
      kept.push(c);
    }
  }

  return { kept, removed };
}

// ---------------------------------------------------------------------------
// Contradiction detection
// ---------------------------------------------------------------------------

/**
 * Detect contradictions between constraint pairs.
 * Uses pattern matching to find opposing directives.
 */
export function detectContradictions(constraints) {
  const contradictions = [];

  // Patterns: "must X" vs "must not X" or "do X" vs "do not X"
  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      const a = constraints[i].toLowerCase();
      const b = constraints[j].toLowerCase();

      // Direct negation: "must X" vs "must not X" / "do X" vs "do not X"
      const mustMatch = a.match(/must\s+(not\s+)?(\w[\w\s]+)/);
      const otherMust = b.match(/must\s+(not\s+)?(\w[\w\s]+)/);
      if (mustMatch && otherMust) {
        const aNeg = mustMatch[1] ? true : false;
        const bNeg = otherMust[1] ? true : false;
        const aVerb = mustMatch[2].trim();
        const bVerb = otherMust[2].trim();
        if (aNeg !== bNeg && jaccardSimilarity(aVerb, bVerb) > 0.5) {
          contradictions.push({
            indices: [i, j],
            constraints: [constraints[i], constraints[j]],
            type: 'direct_negation',
            description: `"${constraints[i]}" contradicts "${constraints[j]}"`,
          });
        }
      }
    }
  }

  return contradictions;
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

/**
 * Co-locate negative constraints adjacent to their positive counterparts.
 * E.g., "must handle empty input" → "do not crash on empty input" should be adjacent.
 */
function colocateNegatives(classified) {
  const result = [];
  const placed = new Set();

  // First pass: place all non-negative constraints in priority order
  for (const item of classified) {
    if (item.category !== CONSTRAINT_CATEGORIES.negative) {
      result.push(item);
      placed.add(item.originalIndex);
    }
  }

  // Second pass: insert each negative constraint after the most similar positive constraint
  const negatives = classified.filter(c => c.category === CONSTRAINT_CATEGORIES.negative);

  for (const neg of negatives) {
    let bestIdx = -1;
    let bestSim = 0;

    for (let i = 0; i < result.length; i++) {
      const sim = jaccardSimilarity(neg.constraint, result[i].constraint);
      if (sim > bestSim && sim > 0.2) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      // Insert after the best match
      result.splice(bestIdx + 1, 0, neg);
    } else {
      // No good match — place before style constraints
      const styleStart = result.findIndex(r => r.category === CONSTRAINT_CATEGORIES.style);
      if (styleStart >= 0) {
        result.splice(styleStart, 0, neg);
      } else {
        result.push(neg);
      }
    }
    placed.add(neg.originalIndex);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main ordering function
// ---------------------------------------------------------------------------

/**
 * Reorder and restructure constraints for optimal reasoning flow.
 *
 * @param {string[]} constraints - The shaper's constraint list
 * @returns {{
 *   ordered: string[],
 *   classified: Array<{constraint: string, category: string, originalIndex: number}>,
 *   contradictions: Array,
 *   deduplication: {kept: string[], removed: string[]},
 *   orderingRationale: string[]
 * }}
 */
export function orderConstraints(constraints) {
  if (!constraints || constraints.length === 0) {
    return {
      ordered: [],
      classified: [],
      contradictions: [],
      deduplication: { kept: [], removed: [] },
      orderingRationale: ['No constraints to order'],
    };
  }

  // Step 1: Detect contradictions BEFORE dedup (full list)
  const contradictions = detectContradictions(constraints);

  // Step 2: Deduplicate
  const { kept, removed } = deduplicateConstraints(constraints);

  // Step 3: Classify each remaining constraint
  const classified = kept.map((c, idx) => ({
    constraint: c,
    category: classifyConstraint(c),
    originalIndex: constraints.indexOf(c),
  }));

  // Step 4: Sort by category priority (stable sort preserves relative order within category)
  classified.sort((a, b) => (CATEGORY_PRIORITY[b.category] || 50) - (CATEGORY_PRIORITY[a.category] || 50));

  // Step 5: Co-locate negative constraints near their positive counterparts
  const colocated = colocateNegatives(classified);

  // Step 6: Build rationales
  const orderingRationale = [];
  if (contradictions.length > 0) {
    orderingRationale.push(`${contradictions.length} contradiction(s) detected`);
  }
  if (removed.length > 0) {
    orderingRationale.push(`${removed.length} duplicate(s) removed`);
  }
  const catCounts = {};
  for (const c of colocated) {
    catCounts[c.category] = (catCounts[c.category] || 0) + 1;
  }
  const catList = Object.entries(catCounts)
    .sort((a, b) => (CATEGORY_PRIORITY[b[0]] || 50) - (CATEGORY_PRIORITY[a[0]] || 50))
    .map(([cat, count]) => `${count} ${cat}`)
    .join(', ');
  orderingRationale.push(`Ordered: ${catList}`);

  return {
    ordered: colocated.map(c => c.constraint),
    classified: colocated,
    contradictions,
    deduplication: { kept, removed },
    orderingRationale,
  };
}

/**
 * Apply constraint ordering to a shaper spec (the JSON object produced by the shaper).
 * Returns a new spec with constraints reordered and cleaned.
 *
 * @param {Object} spec - The parsed shaper JSON spec
 * @returns {{ spec: Object, orderingResult: Object }}
 */
export function applyConstraintOrdering(spec) {
  if (!spec || !Array.isArray(spec.constraints)) {
    return { spec, orderingResult: null };
  }

  const orderingResult = orderConstraints(spec.constraints);

  // Build the new spec with reordered constraints
  const newSpec = {
    ...spec,
    constraints: orderingResult.ordered,
  };

  // If contradictions found, add a note to acceptance_criteria
  if (orderingResult.contradictions.length > 0) {
    const contraNote = `CONTRADICTION WARNING: ${orderingResult.contradictions.map(c => c.description).join('; ')}`;
    const criteria = Array.isArray(newSpec.acceptance_criteria) ? newSpec.acceptance_criteria : [];
    newSpec.acceptance_criteria = [...criteria, contraNote];
  }

  return { spec: newSpec, orderingResult };
}