/**
 * diagnostician.js — Minimal failure classifier for PGG-integrated eval
 *
 * Takes a trace JSONL entry and classifies the failure into:
 *   - timeout.execution
 *   - format_protocol
 *   - logic_assertion
 *   - wrong_data_structure
 *   - off_by_one
 *   - unknown
 *
 * Uses deterministic rules from failureKind, failureSubKind, testDetail.
 * Logs classification but doesn't route — routing is deferred to analysis phase.
 *
 * This is the v0 diagnostician from the spec section C.
 * It extends the existing failure-metrics classification with PGG-specific classes.
 *
 * Module exports:
 *   - classifyFailure(trace) — returns { class, route, details }
 *   - DIAGNOSTIC_CLASSES — enum of failure classes
 *   - FAILURE_ROUTES — mapping of classes to route names
 */

import { classifyFailureDetail } from './failure-metrics.js';

// ---------------------------------------------------------------------------
// Diagnostic classes (from spec Section C)
// ---------------------------------------------------------------------------

export const DIAGNOSTIC_CLASSES = Object.freeze({
  TIMEOUT_EXECUTION: 'timeout.execution',
  FORMAT_PROTOCOL: 'format_protocol',
  LOGIC_ASSERTION: 'logic.assertion_failed',
  WRONG_DATA_STRUCTURE: 'wrong_data_structure',
  OFF_BY_ONE: 'off_by_one',
  PGG_REJECTION: 'pgg.rejection',
  PGG_TYPE_ERROR: 'pgg.type_error',
  PGG_OFF_BY_ONE: 'pgg.off_by_one',
  UNKNOWN: 'unknown',
});

// ---------------------------------------------------------------------------
// Route names (for future routing — v0 only logs)
// ---------------------------------------------------------------------------

export const FAILURE_ROUTES = Object.freeze({
  COMPLEXITY: 'COMPLEXITY',           // timeout → complexity hint injection
  EXTRACT_REPAIR: 'EXTRACT_REPAIR',    // format/protocol → code-extract / sig-repair
  PGG: 'PGG',                          // logic assertion → PGG
  PGG_TYPE: 'PGG_TYPE',                // wrong data structure → PGG-Type variant
  PGG_BOUNDARY: 'PGG_BOUNDARY',        // off-by-one → boundary assertion injection
  NONE: 'NONE',                        // unknown — no routing yet
});

// ---------------------------------------------------------------------------
// Deterministic classification rules
// ---------------------------------------------------------------------------

/**
 * Classify a failure from a trace entry.
 *
 * @param {Object} trace - Trace object with failureKind, failureSubKind, testDetail, errorDetail
 * @returns {{ class: string, route: string, details: Object }}
 */
export function classifyFailure(trace) {
  if (!trace) {
    return { class: DIAGNOSTIC_CLASSES.UNKNOWN, route: FAILURE_ROUTES.NONE, details: {} };
  }

  const { failureKind, failureSubKind, testDetail, errorDetail } = trace;

  // Rule 1: timeout
  if (failureKind === 'timeout' || failureSubKind === 'timeout' || failureSubKind === 'pgg_execution') {
    return {
      class: DIAGNOSTIC_CLASSES.TIMEOUT_EXECUTION,
      route: FAILURE_ROUTES.COMPLEXITY,
      details: { reason: 'execution_timeout', rawKind: failureKind, rawSubKind: failureSubKind },
    };
  }

  // Rule 2: format_protocol (compile error, import error, no function def)
  if (failureKind === 'format_protocol' || failureKind === 'coder_error') {
    return {
      class: DIAGNOSTIC_CLASSES.FORMAT_PROTOCOL,
      route: FAILURE_ROUTES.EXTRACT_REPAIR,
      details: { reason: 'format_protocol_error', rawKind: failureKind, rawSubKind: failureSubKind },
    };
  }

  // Rule 3: PGG-specific failures
  if (failureSubKind === 'pgg_execution') {
    return {
      class: DIAGNOSTIC_CLASSES.TIMEOUT_EXECUTION,
      route: FAILURE_ROUTES.COMPLEXITY,
      details: { reason: 'pgg_timeout', rawKind: failureKind, rawSubKind: failureSubKind },
    };
  }

  if (failureSubKind === 'pgg_type_error') {
    return {
      class: DIAGNOSTIC_CLASSES.WRONG_DATA_STRUCTURE,
      route: FAILURE_ROUTES.PGG_TYPE,
      details: { reason: 'pgg_type_mismatch', rawKind: failureKind, rawSubKind: failureSubKind },
    };
  }

  if (failureSubKind === 'pgg_off_by_one') {
    return {
      class: DIAGNOSTIC_CLASSES.OFF_BY_ONE,
      route: FAILURE_ROUTES.PGG_BOUNDARY,
      details: { reason: 'pgg_boundary_error', rawKind: failureKind, rawSubKind: failureSubKind },
    };
  }

  if (failureSubKind === 'pgg_rejection' || failureSubKind === 'assertion_failed') {
    return {
      class: DIAGNOSTIC_CLASSES.LOGIC_ASSERTION,
      route: FAILURE_ROUTES.PGG,
      details: { reason: 'pgg_assertion_failed', rawKind: failureKind, rawSubKind: failureSubKind },
    };
  }

  // Rule 4: wrong_data_structure (TypeError, AttributeError, list vs tuple)
  if (testDetail) {
    const td = testDetail.toLowerCase();
    if (td.includes('typeerror') || td.includes('attributeerror') ||
        /expected.*tuple.*got.*list/i.test(td) ||
        /expected.*list.*got.*tuple/i.test(td) ||
        /got.*instead/i.test(td)) {
      return {
        class: DIAGNOSTIC_CLASSES.WRONG_DATA_STRUCTURE,
        route: FAILURE_ROUTES.PGG_TYPE,
        details: { reason: 'data_structure_mismatch', rawKind: failureKind, rawSubKind: failureSubKind },
      };
    }
  }

  // Rule 5: off_by_one (numerical assertion fails with diff ±1)
  if (testDetail) {
    // Look for "assert X == Y" where |X - Y| == 1
    const m = testDetail.match(/assert\s+(-?\d+)\s*==\s*(-?\d+)/);
    if (m) {
      const got = parseInt(m[1], 10);
      const expected = parseInt(m[2], 10);
      if (!isNaN(got) && !isNaN(expected) && Math.abs(got - expected) === 1) {
        return {
          class: DIAGNOSTIC_CLASSES.OFF_BY_ONE,
          route: FAILURE_ROUTES.PGG_BOUNDARY,
          details: { reason: 'off_by_one_error', got, expected, diff: expected - got },
        };
      }
    }

    // Also check errorDetail
    if (errorDetail) {
      const ed = errorDetail.toLowerCase();
      if (ed.includes('off by one') || /diff.*?1|expected.*1.*got/i.test(ed)) {
        return {
          class: DIAGNOSTIC_CLASSES.OFF_BY_ONE,
          route: FAILURE_ROUTES.PGG_BOUNDARY,
          details: { reason: 'off_by_one_in_error', rawKind: failureKind, rawSubKind: failureSubKind },
        };
      }
    }
  }

  // Rule 6: logic_assertion_failed (general)
  if (failureKind === 'logic' || failureSubKind === 'assertion_failed' || failureKind === 'autorepair_exhausted') {
    return {
      class: DIAGNOSTIC_CLASSES.LOGIC_ASSERTION,
      route: FAILURE_ROUTES.PGG,
      details: { reason: 'logic_assertion_failed', rawKind: failureKind, rawSubKind: failureSubKind },
    };
  }

  // Rule 7: PGG rejection (PGG filter rejected the code)
  if (failureSubKind === 'pgg_filter' || trace.pggRejected) {
    return {
      class: DIAGNOSTIC_CLASSES.PGG_REJECTION,
      route: FAILURE_ROUTES.PGG,
      details: { reason: 'pgg_filter_rejected', rawKind: failureKind, rawSubKind: failureSubKind },
    };
  }

  // Rule 8: unknown
  return {
    class: DIAGNOSTIC_CLASSES.UNKNOWN,
    route: FAILURE_ROUTES.NONE,
    details: { reason: 'unclassified', rawKind: failureKind, rawSubKind: failureSubKind, testDetail },
  };
}

/**
 * Classify a failure and log the result.
 * The logging is passive — doesn't affect control flow.
 *
 * @param {Object} trace - Trace object
 * @param {string} problemName - Problem name (for logging context)
 * @param {string} baselineKind - Baseline kind (for logging context)
 * @returns {{ class: string, route: string, details: Object }}
 */
export function diagnoseAndLog(trace, problemName, baselineKind) {
  const result = classifyFailure(trace);

  // Passive logging — format for readability
  const logLine = [
    `[diagnostician]`,
    `problem=${problemName}`,
    `baseline=${baselineKind}`,
    `class=${result.class}`,
    `route=${result.route}`,
    Object.entries(result.details).map(([k, v]) => `${k}=${v}`).join(' '),
  ].join(' ');

  if (result.class === DIAGNOSTIC_CLASSES.UNKNOWN) {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }

  return result;
}

/**
 * Aggregate failure classifications from multiple traces.
 * Returns a summary of failure class distribution.
 *
 * @param {Array<Object>} traces - Array of trace objects
 * @returns {Object} Summary { [className]: count }
 */
export function aggregateClassifications(traces) {
  const summary = {};
  for (const trace of traces) {
    const { class: cls } = classifyFailure(trace);
    summary[cls] = (summary[cls] || 0) + 1;
  }
  return summary;
}