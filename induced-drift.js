/**
 * induced-drift.js — Deterministic sig-repair capability test
 *
 * PERM_GRAD lesson: sig-repair didn't fire in R2 because the model
 * happened to generate correct names 40/40 times. This module converts
 * sig-repair from a stochastic efficacy test into a deterministic
 * capability test by inducing name mismatches on purpose.
 *
 * How it works:
 *   Instead of using the reference signature's expected name, we remap
 *   to a "drift name" (e.g., binary_search → compute_result). The model
 *   generates its own idiomatic name, creating a guaranteed mismatch.
 *   Sig-repair must then rename the model's function to match the drift name.
 *
 * This is NOT about whether sig-repair helps pass@k — that's an efficacy
 * question. This tests CAN sig-repair rename correctly when triggered?
 * The answer should be YES deterministically.
 *
 * Drift name mapping:
 *   - Uses functionally equivalent but non-idiomatic names
 *   - Each problem gets a unique drift name to prevent false positives
 *   - The drift name is substituted in the `expectedSignature` that
 *     spec-validator and sig-repair use
 */

export const DRIFT_NAME_MAP = Object.freeze({
  'binary-search': 'compute_result',
  'climbing-stairs': 'calculate_ways',
  'container-with-most-water': 'find_max_area',
  'coin-change-ii': 'count_combinations',
  'two-sum': 'find_indices',
  'valid-palindrome': 'check_palindrome',
  'number-of-islands': 'count_islands',
  'invert-binary-tree': 'flip_tree',
  // Extended problems (may not have reference signatures yet)
  'min-stack': 'create_min_stack',
  'lru-cache': 'create_lru_cache',
  'regular-expression-matching': 'match_pattern',
  'merge-intervals': 'merge_overlapping',
  'rotting-oranges': 'oranges_rotting',
  'serialize-binary-tree': 'serialize_tree',
  'substring-with-concatenation': 'find_substring',
  'trapping-rain-water': 'trap_water',
  'median-of-two-sorted': 'find_median',
  'meeting-rooms-ii': 'min_meeting_rooms',
  'valid-sudoku': 'check_sudoku',
  'word-break-ii': 'word_break',
  'excel-sheet-column-number': 'title_to_number',
  'find-minimum-in-rotated-array': 'find_min',
  'longest-substring-without-repeating': 'length_of_longest_substring',
  'maximum-subarray': 'max_sub_array',
  'merge-two-sorted-lists': 'merge_lists',
  'path-sum': 'has_path_sum',
  'ransom-note': 'can_construct',
  'reverse-linked-list': 'reverse_list',
});

/**
 * Get the drift name for a problem (induced name mismatch).
 * Returns null if no drift name is defined.
 */
export function getDriftName(problemName) {
  return DRIFT_NAME_MAP[problemName] ?? null;
}

/**
 * Apply induced drift to a reference signature.
 * Replaces the function name with the drift name, leaving
 * parameters and return type unchanged.
 *
 * @param {Object} expectedSignature - The real expected signature { name, params, returnType }
 * @param {string} problemName - Problem name for drift lookup
 * @returns {Object} Drift-shifted signature with non-idiomatic name
 */
export function applyDrift(expectedSignature, problemName) {
  const driftName = getDriftName(problemName);
  if (!driftName || !expectedSignature) return expectedSignature;
  return {
    ...expectedSignature,
    name: driftName,
    originalName: expectedSignature.name, // preserve original for comparison
    driftApplied: true,
  };
}

/**
 * Check if induced drift mode is enabled for a given run configuration.
 * In the eval harness, this would be set via opts.inducedDrift.
 */
export function isDriftEnabled(opts = {}) {
  return opts.inducedDrift === true;
}