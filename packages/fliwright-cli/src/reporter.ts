import chalk from 'chalk';

export interface CliTestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface CliFailureEntry {
  testName: string;
  assertion: {
    matcher: string;
    expected: string;
    actual: string;
    timeout: number;
  };
  widgetTree: object;
  diagnostics?: Array<{
    kind: string;
    timestamp: number;
    data: unknown;
    streamId?: string;
  }>;
  source: {
    file: string;
    line: number;
    snippet: string;
  };
  screenshot?: {
    mimeType: 'image/png';
    base64?: string;
    path?: string;
  };
  healingSuggestion?: {
    originalSelector: string;
    suggestedSelector: string;
    confidence: number;
    scores: {
      position: number;
      context: number;
      codeBinding: number;
      text: number;
      weighted: number;
    };
  };
  timestamp: string;
}

export interface CliRunArtifacts {
  runId: string;
  outputDir: string;
  reportPath?: string;
  screenshots: string[];
  timelines?: string[];
}

export interface TimelineSummary {
  path: string;
  mode?: 'script' | 'test';
  pages: number;
  stepsPassed: number;
  stepsFailed: number;
  screenshots: number;
  firstFailure?: {
    code: string;
    title: string;
    message: string;
  };
}

export interface CliRunResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: CliTestResult[];
  failures?: CliFailureEntry[];
  artifacts?: CliRunArtifacts;
  timelines?: TimelineSummary[];
  agentVisibleFailures?: Array<{
    code: string;
    title: string;
    message: string;
    timelineNodeId?: string;
  }>;
  reproduceCommand?: string;
}

export function formatPretty(result: CliRunResult): string {
  const lines: string[] = [];
  const passed = result.results.filter((r) => r.passed);
  const failed = result.results.filter((r) => !r.passed);

  for (const test of passed) {
    lines.push(chalk.green(`  ✅ ${test.name} (${test.duration}ms)`));
  }

  for (const test of failed) {
    lines.push(chalk.red(`  ❌ ${test.name} (${test.duration}ms)`));
    if (test.error) {
      lines.push(chalk.gray(`     → ${test.error.split('\n')[0]}`));
    }
  }

  lines.push('');
  const summary = `Results: ${chalk.green(`${result.passedTests} passed`)}, ${chalk.red(`${result.failedTests} failed`)} (${result.duration}ms)`;
  lines.push(summary);
  if (result.artifacts?.reportPath) {
    lines.push(chalk.gray(`Report: ${result.artifacts.reportPath}`));
  }
  if (result.artifacts?.screenshots.length) {
    lines.push(chalk.gray(`Screenshots: ${result.artifacts.screenshots.length}`));
  }
  if (result.timelines?.length) {
    const first = result.timelines[0];
    lines.push(chalk.gray(`Timelines: ${result.timelines.length}`));
    lines.push(chalk.gray(`Timeline summary: ${first.pages} page(s), ${first.stepsPassed} passed step(s), ${first.stepsFailed} failed step(s), ${first.screenshots} screenshot(s)`));
    if (first.firstFailure) {
      lines.push(chalk.gray(`First agent-visible failure: ${first.firstFailure.code} - ${first.firstFailure.message}`));
    }
  }

  return lines.join('\n');
}

export function formatJson(result: CliRunResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatJunit(result: CliRunResult): string {
  const escapeXml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const testCases = result.results.map((test) => {
    const attrs = `name="${escapeXml(test.name)}" time="${(test.duration / 1000).toFixed(3)}"`;
    if (test.passed) {
      return `  <testcase ${attrs} />`;
    }
    const errorMsg = test.error ? escapeXml(test.error.split('\n')[0]) : 'test failed';
    return `  <testcase ${attrs}>\n    <failure message="${errorMsg}" />\n  </testcase>`;
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    `<testsuite name="fliwright" tests="${result.totalTests}" failures="${result.failedTests}" time="${(result.duration / 1000).toFixed(3)}">`,
    testCases,
    '</testsuite>',
    '</testsuites>',
  ].join('\n');
}
