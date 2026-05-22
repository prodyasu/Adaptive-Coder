import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  summarizeBinaryRun,
  exactPermutationTest,
  exactMcNemarTest,
  passAtK,
} from './stats.js';

const PIPELINES = ['raw_base', 'gen0_seed', 'gen18_evolved'];
const METRIC_HEADINGS = {
  pass1: /###\s+Pass@1\b/i,
  passN: /###\s+Pass@N\b/i,
};

function parseTableRows(section) {
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4)
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell.replace(/:/g, ''))));
}

function cellToBit(cell) {
  if (cell.includes('✓')) return 1;
  if (cell.includes('✗')) return 0;
  return null;
}

function extractSection(markdown, metricKey) {
  const heading = METRIC_HEADINGS[metricKey];
  const match = heading.exec(markdown);
  if (!match) throw new Error(`Missing ${metricKey} section`);
  const start = match.index;
  const rest = markdown.slice(start);
  const nextHeading = rest.slice(match[0].length).search(/\n###\s+/);
  return nextHeading === -1 ? rest : rest.slice(0, match[0].length + nextHeading);
}

function extractMetric(markdown, metricKey) {
  const rows = parseTableRows(extractSection(markdown, metricKey));
  if (rows.length < 2) throw new Error(`No result rows found for ${metricKey}`);
  const header = rows[0];
  const indexes = Object.fromEntries(PIPELINES.map((name) => [name, header.indexOf(name)]));
  for (const [name, index] of Object.entries(indexes)) {
    if (index === -1) throw new Error(`Missing ${name} column in ${metricKey}`);
  }

  const problemRows = rows.slice(1).filter((cells) => {
    const label = cells[0].replace(/[*_]/g, '').trim().toLowerCase();
    return !label.startsWith('pass@') && PIPELINES.every((p) => cellToBit(cells[indexes[p]]) !== null);
  });
  if (problemRows.length === 0) throw new Error(`No problem rows found for ${metricKey}`);

  const metric = Object.fromEntries(PIPELINES.map((p) => [p, []]));
  const problems = [];
  for (const cells of problemRows) {
    problems.push(cells[0]);
    for (const pipeline of PIPELINES) {
      metric[pipeline].push(cellToBit(cells[indexes[pipeline]]));
    }
  }
  return { problems, metric };
}

export function extractResultMatrix(markdown) {
  const pass1 = extractMetric(markdown, 'pass1');
  const passN = extractMetric(markdown, 'passN');
  return {
    problems: pass1.problems,
    pass1: pass1.metric,
    passN: passN.metric,
  };
}

function compareAll(metric) {
  const pairs = [
    ['raw_base', 'gen0_seed'],
    ['raw_base', 'gen18_evolved'],
    ['gen0_seed', 'gen18_evolved'],
  ];
  const comparisons = {};
  for (const [aName, bName] of pairs) {
    comparisons[`${aName}→${bName}`] = {
      paired: exactMcNemarTest(metric[aName], metric[bName], { alternative: 'greater' }),
      unpairedPermutation: exactPermutationTest(metric[aName], metric[bName], { alternative: 'greater' }),
    };
  }
  return comparisons;
}

function summarizeMetric(metric, options) {
  return {
    runs: Object.fromEntries(PIPELINES.map((pipeline) => {
      const s = summarizeBinaryRun(pipeline, metric[pipeline], options);
      return [pipeline, {
        ...s,
        passAt2: passAtK({ n: s.n, c: s.successes, k: Math.min(2, s.n) }),
      }];
    })),
    comparisons: compareAll(metric),
  };
}

export function analyzeN4Results(markdown, options = {}) {
  const matrix = extractResultMatrix(markdown);
  const statsOptions = {
    bootstrapIterations: options.bootstrapIterations ?? 10000,
    seed: options.seed ?? 20260521,
  };
  return {
    problems: matrix.problems,
    options: statsOptions,
    metrics: {
      pass1: summarizeMetric(matrix.pass1, statsOptions),
      passN: summarizeMetric(matrix.passN, statsOptions),
    },
  };
}

function fmtCI(ci) {
  return `[${ci.lower.toFixed(4)}, ${ci.upper.toFixed(4)}]`;
}

function metricTitle(metricKey) {
  return metricKey === 'pass1' ? 'Pass@1' : 'Pass@N';
}

export function formatAnalysisMarkdown(analysis) {
  const lines = [];
  lines.push('## Reproducible N=4 statistics');
  lines.push('');
  lines.push(`Problems: ${analysis.problems.join(', ')}`);
  lines.push(`Bootstrap: ${analysis.options.bootstrapIterations} iterations, seed ${analysis.options.seed}`);
  lines.push('');

  for (const metricKey of ['pass1', 'passN']) {
    const metric = analysis.metrics[metricKey];
    lines.push(`### ${metricTitle(metricKey)}`);
    lines.push('');
    for (const pipeline of PIPELINES) {
      const run = metric.runs[pipeline];
      lines.push(`- ${pipeline}: ${run.successes}/${run.n} = ${run.rate.toFixed(3)}; exact 95% CI ${fmtCI(run.exactCI)}; bootstrap 95% CI ${fmtCI(run.bootstrapCI)}; pass@2 ${run.passAt2.toFixed(3)}`);
    }
    lines.push('');
    lines.push('Paired exact comparisons, alternative = later pipeline greater:');
    for (const [label, comparison] of Object.entries(metric.comparisons)) {
      const paired = comparison.paired;
      lines.push(`- ${label}: bWins=${paired.bWins}, aWins=${paired.aWins}, discordant=${paired.discordant}, p = ${paired.pValue.toFixed(4)}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function main() {
  const input = process.argv[2] ?? 'N4-RESULTS.md';
  const output = process.argv[3];
  const markdown = fs.readFileSync(input, 'utf8');
  const analysis = analyzeN4Results(markdown);
  const report = formatAnalysisMarkdown(analysis);
  if (output) fs.writeFileSync(output, report);
  else process.stdout.write(report);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
