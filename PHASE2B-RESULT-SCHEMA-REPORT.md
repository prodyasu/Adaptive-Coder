# Phase 2B — Machine-Readable Result Schema

**Date:** 2026-05-21  
**Scope:** add a first stable JSON artifact shape for eval results, without running new model evals.

## Why this pass

Phase 1 made the N=4 statistics reproducible, but the result source was still a Markdown table. That is fragile for expanded evals: future runs need machine-readable records that can feed stats, reports, failure analysis, and comparisons without scraping prose.

## What changed

Added `result-schema.js`:

- `RESULT_SCHEMA_VERSION = "eval-result/v1"`
- `buildResultArtifactFromMatrix(matrix, options)`
  - Converts problem-level pass vectors into a structured JSON artifact.
  - Includes run metadata, source metadata, pipeline declarations, per-problem results, aggregate metrics, paired/unpaired comparisons, and methodology notes.
- `validateResultArtifact(artifact)`
  - Lightweight dependency-free schema validation.
  - Checks required top-level fields, pipeline/problem shape, per-problem `passAt1` / `passAtN`, and aggregate metric blocks.
- `formatValidationErrors(errors)`
  - Human-readable validation messages.

Extended `n4-analysis.js`:

- Added `analyzeN4ResultArtifact(markdown, options)` to convert existing N4 Markdown results into the new `eval-result/v1` artifact.
- CLI now emits JSON automatically when output path ends in `.json`, or when called with `--json`.

Added tests:

- `test-result-schema.js`
  - Builds an artifact from fixture pass matrices.
  - Verifies schema version, run metadata, problem-level booleans, aggregate counts, comparisons, methodology, and validation failure behavior.
- Extended `test-n4-analysis.js`
  - Verifies N4 Markdown can export an `eval-result/v1` JSON artifact.

Generated:

- `N4-RESULTS.eval-result.json`
  - Machine-readable reconstruction of the existing `N4-RESULTS.md` tables.
  - No new model calls; derived from existing data only.

## JSON artifact shape

Top-level fields:

- `schemaVersion`: currently `eval-result/v1`
- `generatedAt`: ISO timestamp
- `source`: e.g. `{ "type": "markdown", "path": "N4-RESULTS.md" }`
- `run`: run id, harness version, model/notes when available
- `pipelines`: ordered pipeline ids
- `problems`: one row per problem with per-pipeline booleans
- `metrics`: aggregate Pass@1 / Pass@N summaries and comparisons
- `methodology`: statistical methods and caveats

Problem row example:

```json
{
  "problemId": "container-with-most-water",
  "results": {
    "raw_base": { "passAt1": false, "passAtN": false },
    "gen0_seed": { "passAt1": false, "passAtN": true },
    "gen18_evolved": { "passAt1": true, "passAtN": true }
  }
}
```

## Commands run

```bash
# RED: schema module did not exist yet
node test-result-schema.js

# GREEN: schema implemented
node test-result-schema.js

# RED: n4 artifact export did not exist yet
node test-n4-analysis.js

# GREEN: n4 artifact export implemented
node test-n4-analysis.js && node test-result-schema.js

# Generate machine-readable N4 artifact
node n4-analysis.js N4-RESULTS.md N4-RESULTS.eval-result.json

# Sanity-check generated JSON
node -e "const fs=require('fs'); const x=JSON.parse(fs.readFileSync('N4-RESULTS.eval-result.json','utf8')); console.log(x.schemaVersion, x.problems.length, x.metrics.pass1.runs.gen18_evolved.successes);"
```

Sanity-check output:

```text
eval-result/v1 4 4
```

## Test status

Full suite passed after Phase 2B changes:

```text
test-basic-runner.js      passed
test-failure-metrics.js   passed
test-n4-analysis.js       passed
test-result-schema.js     passed
test-spec-validator.js    passed
test-stats.js             passed
test-trace-log.js         passed
test-ts-to-py.js          passed
```

## Interpretation

This does not change the empirical claim. It improves the harness substrate:

- Future expanded evals can write/read stable JSON instead of scraping Markdown.
- Stats and reports can be regenerated from a single structured artifact.
- The schema is intentionally small: it tracks Pass@1 / Pass@N first, while leaving room for richer attempt-level traces and failure subtypes in the next pass.

## Safety / bounds

- No model evals were run.
- No secrets were accessed or printed.
- No destructive commands were run.
- This pass only created local source/docs/tests and a JSON artifact reconstructed from existing N4 data.
