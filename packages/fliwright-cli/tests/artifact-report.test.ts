import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeCli } from '../src/index.js';
import { parseVitestOutput } from '../src/commands/run.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function fixture(status = 'passed') {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-html-')); roots.push(root);
  const runDir = join(root, 'runs', 'demo');
  const prefix = 'tests/test-1/attempts/attempt-0';
  const attempt = join(runDir, prefix);
  await mkdir(attempt, { recursive: true });
  const manifest = { schemaVersion: 1, runId: 'demo', status, evidenceStatus: 'complete',
    tests: [{ testId: 'test-1', attempts: [{ attemptId: 'attempt-0', resultPath: `${prefix}/result.json` }] }] };
  await writeFile(join(runDir, 'run.json'), JSON.stringify(manifest));
  await writeFile(join(runDir, 'report.json'), JSON.stringify({ status, passed: status === 'passed', totalTests: 1,
    passedTests: status === 'passed' ? 1 : 0, failedTests: status === 'failed' ? 1 : 0, duration: 1250,
    results: [{ name: '购物车成功结算', passed: status === 'passed', duration: 1250 }] }));
  const result = { testName: '购物车成功结算', testFile: 'checkout.test.ts', status, attemptOutcome: status,
    testOutcome: status, attemptIndex: 0, evidenceStatus: 'complete', operations: [], evidence: [] };
  await writeFile(join(attempt, 'result.json'), JSON.stringify(result));
  const timeline = { version: 2, runId: 'demo', testName: result.testName, status, mode: 'test',
    startedAt: '2026-11-03T01:00:00Z', endedAt: '2026-11-03T01:00:01.250Z',
    nodes: [{ id: 'step-1', kind: 'action', title: '点击结算', status,
      startedAt: '2026-11-03T01:00:00Z', endedAt: '2026-11-03T01:00:01Z',
      artifacts: [{ kind: 'screenshot', path: 'screen.png' }] }] };
  await writeFile(join(attempt, 'timeline.json'), JSON.stringify(timeline));
  await writeFile(join(attempt, 'screen.png'), png);
  const output = join(root, 'shared', 'report.html');
  const invoke = (...extra: string[]) => executeCli(['artifacts', 'report', 'demo', '--cwd', root, '--runs-root', join(root, 'runs'), '--output', output, '--json', ...extra]);
  return { root, runDir, attempt, manifest, result, timeline, output, invoke };
}

async function reviewFixture(status = 'passed') {
  const f = await fixture(status);
  const review = {
    runId: 'demo', release: { app: '示例 App', version: '2.8.0', build: '20800', commit: 'abc1234', platform: 'iOS', environment: '预发环境' },
    plan: 'test-plan.json',
  };
  const plan = { schemaVersion: 2, generatedAt: '2026-11-03T01:00:00Z', items: [{
    source: { id: 'gid://gitlab/WorkItem/900', iid: '128', url: 'https://gitlab.example.com/mobile/app/-/work_items/128', namespace: 'mobile/app', type: 'Task',
      title: '优惠券金额未计入实付金额', description: '结算时需将优惠券抵扣金额计入订单实付金额。',
      updatedAt: '2026-11-03T00:00:00Z', fetchedAt: '2026-11-03T01:00:00Z', comments: [] as Array<{ id: string; body: string; updatedAt: string }> },
    basis: 'acceptance-checklist', acceptanceCriteria: [{ id: 'AC-01', text: '优惠券金额计入实付金额', source: { kind: 'description', quote: '结算时需将优惠券抵扣金额计入订单实付金额。' } }],
    cases: [{ acceptanceCriteria: ['AC-01'], id: 'CHECKOUT-01', title: '优惠券结算金额', automation: { status: 'complete' }, binding: { name: '购物车成功结算', file: 'checkout.test.ts' },
      description: '已登录用户选择商品，应用满减券后提交订单。', preconditions: ['已登录且有可用优惠券'],
      steps: [{ action: '应用满减券并提交订单', expectedResult: '订单提交成功' }], expectedResult: '订单实付金额等于商品金额减去优惠金额。' }], openQuestions: [],
  }] };
  const reviewPath = join(f.root, 'release-review.json'), planPath = join(f.root, 'test-plan.json');
  await writeFile(reviewPath, JSON.stringify(review));
  await writeFile(planPath, JSON.stringify(plan));
  return { ...f, review, plan, planPath, reviewPath, generate: (...args: string[]) => f.invoke('--review', reviewPath, ...args) };
}

it('generates a portable HTML report for successful tests with embedded step screenshots', async () => {
  const f = await fixture();
  const response = await f.invoke();
  expect(response.exitCode, response.stderr + response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data).toMatchObject({ runId: 'demo', output: f.output, partial: false });
  await rm(f.runDir, { recursive: true, force: true });
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('购物车成功结算');
  expect(html).toContain('点击结算');
  expect(html).toContain(`data:image/png;base64,${png.toString('base64')}`);
  expect(html).toContain('data-status="passed"');
  expect(html).toContain('id="search"');
  expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)=/);
});

it('embeds the matching workspace app icon in a headerless offline report', async () => {
  const f = await reviewFixture();
  f.review.release.app = 'Exio App';
  await writeFile(f.reviewPath, JSON.stringify(f.review));
  const iconDir = join(f.root, 'apps/exio_app/android/app/src/main/res/mipmap-xxxhdpi');
  await mkdir(iconDir, { recursive: true });
  await writeFile(join(iconDir, 'ic_launcher.png'), png);
  expect((await f.generate()).exitCode).toBe(0);
  await rm(join(f.root, 'apps'), { recursive: true });
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain(`<img src="data:image/png;base64,${png.toString('base64')}" width="40" height="40" alt="Exio App 图标">`);
  expect(html).not.toContain('class="topbar"');
  expect(html).not.toContain('class="brand"');
  expect(html).toContain('id="theme"');
  expect(html).toContain('<footer><span>发版测试审核报告</span><button id="print"');
});

it('keeps reports qualified when a project has no icon and never uses another app icon', async () => {
  const f = await reviewFixture();
  const iconDir = join(f.root, 'apps/another_app/android/app/src/main/res/mipmap-xxxhdpi');
  await mkdir(iconDir, { recursive: true });
  await writeFile(join(iconDir, 'ic_launcher.png'), png);
  const response = await f.generate('--require-qualified');
  expect(response.exitCode).toBe(0);
  expect(await readFile(f.output, 'utf8')).toContain('<span aria-hidden="true">示</span></a>');
});

it('loads a direct Flutter project icon and skips invalid icon files', async () => {
  const f = await reviewFixture();
  const invalidDir = join(f.root, 'android/app/src/main/res/mipmap-xxxhdpi');
  const iconDir = join(f.root, 'web/icons');
  await mkdir(invalidDir, { recursive: true });
  await mkdir(iconDir, { recursive: true });
  await writeFile(join(invalidDir, 'ic_launcher.png'), '<svg onload="alert(1)"></svg>');
  await writeFile(join(iconDir, 'Icon-512.png'), png);
  expect((await f.generate()).exitCode).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain(`<img src="data:image/png;base64,${png.toString('base64')}" width="40"`);
  expect(html).not.toContain('onload=');
});

it('escapes names, errors and screenshot captions instead of allowing report content to run scripts', async () => {
  const f = await fixture('failed');
  const injection = '</script><img src=x onerror=alert(1)>';
  await writeFile(join(f.attempt, 'result.json'), JSON.stringify({ ...f.result, testName: injection, failureContextPath: 'failures.json' }));
  await writeFile(join(f.attempt, 'failures.json'), JSON.stringify([{ assertion: { actual: injection }, source: { file: 'checkout.test.ts', line: 27 } }]));
  await writeFile(join(f.attempt, 'timeline.json'), JSON.stringify({ ...f.timeline, nodes: [{ ...f.timeline.nodes[0], title: injection }] }));
  expect((await f.invoke()).exitCode).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html).not.toContain(injection);
  expect(html).toContain('&lt;/script&gt;&lt;img');
  expect(html).toContain('checkout.test.ts');
  expect(html).toContain('Content-Security-Policy');
});

it('shows attempts in numeric retry order and keeps the final test outcome separate from failed attempts', async () => {
  const f = await fixture();
  const attempts = [];
  for (const index of [10, 2, 0]) {
    const prefix = `tests/test-1/attempts/attempt-${index}`;
    await mkdir(join(f.runDir, prefix), { recursive: true });
    await writeFile(join(f.runDir, prefix, 'result.json'), JSON.stringify({ ...f.result, attemptIndex: index,
      status: index === 10 ? 'passed' : 'failed', attemptOutcome: index === 10 ? 'passed' : 'failed',
      testOutcome: 'passed', flaky: true, evidenceStatus: 'disabled' }));
    attempts.push({ attemptId: `attempt-${index}`, resultPath: `${prefix}/result.json` });
  }
  await writeFile(join(f.runDir, 'run.json'), JSON.stringify({ ...f.manifest, tests: [{ testId: 'test-1', attempts }] }));
  expect((await f.invoke()).exitCode).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html.indexOf('data-attempt="attempt-2"')).toBeLessThan(html.indexOf('data-attempt="attempt-10"'));
  expect(html).toContain('重试后通过');
});

it('requires explicit partial mode for missing evidence and reports the gap in HTML', async () => {
  const f = await fixture();
  await rm(join(f.attempt, 'screen.png'));
  expect((await f.invoke()).exitCode).not.toBe(0);
  const response = await f.invoke('--allow-partial');
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data).toMatchObject({ partial: true, missing: expect.arrayContaining([expect.stringContaining('screen.png')]) });
  expect(await readFile(f.output, 'utf8')).toContain('证据不完整');
});

it.each(['../outside.png', 'https://example.com/private.png', 'linked.png'])('never embeds evidence outside its attempt (%s)', async path => {
  const f = await fixture();
  await writeFile(join(f.root, 'outside.png'), png);
  if (path === 'linked.png') await symlink(join(f.root, 'outside.png'), join(f.attempt, path));
  await writeFile(join(f.attempt, 'timeline.json'), JSON.stringify({ ...f.timeline,
    nodes: [{ ...f.timeline.nodes[0], artifacts: [{ kind: 'screenshot', path }] }] }));
  expect((await f.invoke('--allow-partial')).exitCode).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html).not.toContain('data:image/png');
});

it('retains run-level collection errors even when there are no test attempts', async () => {
  const f = await fixture('failed');
  await writeFile(join(f.runDir, 'run.json'), JSON.stringify({ ...f.manifest, tests: [],
    runnerErrors: [{ phase: 'collection', message: 'Cannot import checkout.test.ts' }] }));
  await writeFile(join(f.runDir, 'report.json'), JSON.stringify({ results: [], duration: 0 }));
  expect((await f.invoke()).exitCode).toBe(0);
  expect(await readFile(f.output, 'utf8')).toContain('Cannot import checkout.test.ts');
});

it('does not overwrite an existing report destination', async () => {
  const f = await fixture();
  await mkdir(join(f.root, 'shared'));
  await writeFile(f.output, 'keep me');
  expect((await f.invoke()).exitCode).not.toBe(0);
  expect(await readFile(f.output, 'utf8')).toBe('keep me');
});

it('matches suite-qualified results without duplicating tests and preserves runner-only skipped cases', async () => {
  const f = await fixture();
  await writeFile(join(f.attempt, 'result.json'), JSON.stringify({ ...f.result, testPath: ['结算', f.result.testName] }));
  const report = parseVitestOutput(JSON.stringify({ success: true, testResults: [{ name: 'checkout.test.ts', assertionResults: [
    { fullName: `结算 ${f.result.testName}`, title: f.result.testName, status: 'passed', duration: 1234 },
    { fullName: '结算 暂未开放', status: 'pending' },
  ] }] }));
  await writeFile(join(f.runDir, 'report.json'), JSON.stringify(report));
  const response = await f.invoke();
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data.tests).toBe(2);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('data-status="skipped"');
  expect(html).toContain('1.23 s');
});

it('keeps expected failures passed without calling them a successful retry', async () => {
  const f = await fixture();
  await writeFile(join(f.attempt, 'result.json'), JSON.stringify({ ...f.result,
    status: 'failed', attemptOutcome: 'failed', testOutcome: 'passed', expectedFailure: true }));
  expect((await f.invoke()).exitCode).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('预期失败');
  expect(html).not.toContain('class="flaky">重试后通过');
});

it('renders interrupted runs from available attempts when the canonical report is missing', async () => {
  const f = await fixture('interrupted');
  await rm(join(f.runDir, 'report.json'));
  expect((await f.invoke()).exitCode).not.toBe(0);
  const response = await f.invoke('--allow-partial');
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data.partial).toBe(true);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('购物车成功结算');
  expect(html).toContain('data-status="interrupted"');
  expect(html).toContain('report.json (missing)');
});

it('keeps explicitly captured frames when automatic recording is disabled', async () => {
  const f = await fixture();
  await rm(join(f.attempt, 'timeline.json'));
  await writeFile(join(f.attempt, 'result.json'), JSON.stringify({ ...f.result, evidenceStatus: 'disabled',
    evidence: [{ result: { status: 'captured', artifactPaths: ['screen.png'] } }] }));
  expect((await f.invoke()).exitCode).toBe(0);
  expect(await readFile(f.output, 'utf8')).toContain(`data:image/png;base64,${png.toString('base64')}`);
});

it.each(['unsupported', 'oversized'])('reports omitted %s images instead of claiming complete evidence', async reason => {
  const f = await fixture();
  if (reason === 'unsupported') await writeFile(join(f.attempt, 'screen.png'), '<svg onload="alert(1)"></svg>');
  else await truncate(join(f.attempt, 'screen.png'), 11 * 1024 * 1024);
  const response = await f.invoke('--allow-partial');
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data).toMatchObject({ partial: true,
    missing: expect.arrayContaining([expect.stringContaining(reason === 'unsupported' ? 'unsupported image format' : 'embedding limit')]) });
  const html = await readFile(f.output, 'utf8');
  expect(html).not.toContain('data:image/png');
  expect(html).not.toContain('<svg onload');
});

it('presents GitLab issues, case descriptions and results for release review without decorative copy', async () => {
  const f = await reviewFixture();
  const response = await f.generate();
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data).toMatchObject({ releaseReady: true, blockers: [] });
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain(`<h1>${f.plan.items[0].source.title}</h1>`);
  for (const text of ['发版测试审核报告', '示例 App', '2.8.0', '#128', f.plan.items[0].source.title,
    'CHECKOUT-01', f.plan.items[0].cases[0].description, f.plan.items[0].cases[0].expectedResult, '测试合格，待人工审核']) {
    expect(html.includes(text), text).toBe(true);
  }
  expect(html).toContain('href="https://gitlab.example.com/mobile/app/-/work_items/128"');
  expect(html.includes('每一次执行，清晰可见')).toBe(false);
  expect(html.includes('AUTOMATION REPORT')).toBe(false);
  expect(html.includes('通过率')).toBe(false);
});

it.each(['failed', 'skipped', 'interrupted', 'running'])('does not qualify a release containing a %s test', async status => {
  const f = await reviewFixture(status);
  const response = await f.generate('--allow-partial');
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(false);
  expect(await readFile(f.output, 'utf8')).toContain('测试未合格，禁止发版');
});

it('blocks releases when a planned test was not executed, even if every executed test passed', async () => {
  const f = await reviewFixture();
  f.plan.items[0].cases.push({ ...f.plan.items[0].cases[0], id: 'CHECKOUT-02', title: '退款金额校验', binding: { file: 'checkout.test.ts', name: '退款金额校验' } });
  await writeFile(f.planPath, JSON.stringify(f.plan));
  const response = await f.generate();
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data).toMatchObject({ releaseReady: false, blockers: expect.arrayContaining([expect.stringContaining('CHECKOUT-02')]) });
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('退款金额校验');
  expect(html).toContain('待执行');
});

it('does not qualify passed runs without issue review metadata', async () => {
  const f = await fixture();
  const response = await f.invoke();
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(false);
  expect(await readFile(f.output, 'utf8')).toContain('未提供发版审核清单');
});

it('rejects an audit checklist that belongs to a different run', async () => {
  const f = await reviewFixture();
  await writeFile(f.reviewPath, JSON.stringify({ ...f.review, runId: 'other-run' }));
  const response = await f.generate();
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(false);
  expect(await readFile(f.output, 'utf8')).toContain('审核清单与测试运行不匹配');
});

it('never treats a partial report as qualified', async () => {
  const f = await reviewFixture();
  await rm(join(f.attempt, 'screen.png'));
  const response = await f.generate('--allow-partial');
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(false);
});

it('writes the report and exits with review failure when the release gate is requested', async () => {
  const f = await reviewFixture('failed');
  const response = await f.generate('--require-qualified');
  expect(response.exitCode).toBe(1);
  expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, error: { code: 'RELEASE_NOT_QUALIFIED' }, data: { releaseReady: false, output: f.output } });
  expect(await readFile(f.output, 'utf8')).toContain('测试未合格，禁止发版');
});

it('blocks executed tests that are not linked to any GitLab issue', async () => {
  const f = await reviewFixture();
  const report = JSON.parse(await readFile(join(f.runDir, 'report.json'), 'utf8'));
  report.results.push({ name: '未关联用例', status: 'passed', passed: true, duration: 100, file: 'extra.test.ts' });
  report.totalTests = 2;
  await writeFile(join(f.runDir, 'report.json'), JSON.stringify(report));
  const response = await f.generate();
  expect(JSON.parse(response.stdout).data).toMatchObject({ releaseReady: false,
    blockers: expect.arrayContaining([expect.stringContaining('未关联用例')]) });
});

it('blocks ambiguous result matches rather than assigning a successful test arbitrarily', async () => {
  const f = await reviewFixture();
  const report = JSON.parse(await readFile(join(f.runDir, 'report.json'), 'utf8'));
  report.results.push({ name: '购物车成功结算', passed: true, status: 'passed', duration: 1, file: 'checkout.test.ts' });
  report.totalTests = 2;
  await writeFile(join(f.runDir, 'report.json'), JSON.stringify(report));
  const response = await f.generate();
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(false);
  expect(await readFile(f.output, 'utf8')).toContain('匹配不唯一');
});

it.each(['failed-summary', 'missing-result', 'wrong-total'])('blocks a release with inconsistent canonical results (%s)', async fault => {
  const f = await reviewFixture();
  const report = JSON.parse(await readFile(join(f.runDir, 'report.json'), 'utf8'));
  if (fault === 'failed-summary') report.passed = false;
  if (fault === 'missing-result') report.results = [];
  if (fault === 'wrong-total') report.totalTests = 2;
  await writeFile(join(f.runDir, 'report.json'), JSON.stringify(report));
  const response = await f.generate();
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(false);
});

it('escapes issue and case descriptions and rejects executable issue links', async () => {
  const f = await reviewFixture();
  f.plan.items[0].source.title = '<script>alert(1)</script>';
  f.plan.items[0].cases[0].description = '<img src=x onerror=alert(1)>';
  await writeFile(f.planPath, JSON.stringify(f.plan));
  expect((await f.generate()).exitCode).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html.includes('<script>alert(1)</script>')).toBe(false);
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  f.plan.items[0].source.url = 'javascript:alert(1)';
  await writeFile(f.planPath, JSON.stringify(f.plan));
  expect((await f.invoke('--review', f.reviewPath, '--require-qualified')).exitCode).toBe(2);
});

it('qualifies the complete successful review for a CI gate', async () => {
  const f = await reviewFixture();
  const response = await f.generate('--require-qualified');
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout)).toMatchObject({ ok: true, data: { releaseReady: true } });
});

it.each(['version', 'build', 'commit', 'release'])('renders the full plan while blocking a missing %s instead of rejecting the report input', async field => {
  const f = await reviewFixture();
  const review = structuredClone(f.review) as { release?: Record<string, string>; runId: string; plan: string };
  if (field === 'release') delete review.release;
  else delete review.release![field];
  await writeFile(f.reviewPath, JSON.stringify(review));
  const response = await f.generate('--require-qualified');
  expect(response.exitCode, response.stdout).toBe(1);
  expect(JSON.parse(response.stdout)).toMatchObject({ error: { code: 'RELEASE_NOT_QUALIFIED' },
    data: { output: f.output, releaseReady: false, missingReleaseFields: expect.arrayContaining([field === 'release' ? 'app' : field]) } });
  const html = await readFile(f.output, 'utf8');
  for (const text of [f.plan.items[0].source.url, 'CHECKOUT-01', 'AC-01', '未提供', '发版信息缺失', 'data:image/png']) expect(html).toContain(text);
  expect(html).not.toContain('undefined');
});

it('creates a reusable review manifest directly from a plan and preserves all unbound cases', async () => {
  const f = await reviewFixture('failed');
  delete (f.plan.items[0].cases[0] as { binding?: unknown }).binding;
  f.plan.items[0].cases[0].automation = { status: 'pending' };
  await writeFile(f.planPath, JSON.stringify(f.plan));
  const response = await f.invoke('--plan', f.planPath, '--require-qualified');
  expect(response.exitCode, response.stdout).toBe(1);
  const data = JSON.parse(response.stdout).data;
  expect(data).toMatchObject({ plannedCases: 1, automatedCases: 0, releaseReady: false, reviewPath: join(f.root, 'shared/report.review.json') });
  const manifest = JSON.parse(await readFile(data.reviewPath, 'utf8'));
  expect(manifest).toEqual({ runId: 'demo', release: {}, plan: '../test-plan.json' });
  const html = await readFile(f.output, 'utf8');
  for (const text of [f.plan.items[0].source.url, 'CHECKOUT-01', '待编写', '购物车成功结算']) expect(html).toContain(text);
  const secondOutput = join(f.root, 'reused.html');
  const reused = await executeCli(['artifacts', 'report', 'demo', '--cwd', f.root, '--runs-root', join(f.root, 'runs'),
    '--review', data.reviewPath, '--output', secondOutput, '--json']);
  expect(reused.exitCode, reused.stdout).toBe(0);
  expect(await readFile(secondOutput, 'utf8')).toContain('CHECKOUT-01');
});

it('reuses release identity saved with the real run when generating a plan-linked report', async () => {
  const f = await reviewFixture();
  const reportPath = join(f.runDir, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  await writeFile(reportPath, JSON.stringify({ ...report, release: f.review.release }));
  const response = await f.invoke('--plan', f.planPath, '--require-qualified');
  expect(response.exitCode, response.stdout).toBe(0);
  const data = JSON.parse(response.stdout).data;
  expect(data).toMatchObject({ releaseReady: true, missingReleaseFields: [], plannedCases: 1, automatedCases: 1 });
  expect(JSON.parse(await readFile(data.reviewPath, 'utf8')).release).toEqual(f.review.release);
});

it('accepts confirmed partial identity with a direct plan while preserving missing build fields as blockers', async () => {
  const f = await reviewFixture();
  const release = { app: 'Exio', platform: 'iOS', environment: 'mock simulator' };
  const response = await f.invoke('--plan', f.planPath, '--release', JSON.stringify(release), '--require-qualified');
  expect(response.exitCode, response.stdout).toBe(1);
  const data = JSON.parse(response.stdout).data;
  expect(data.missingReleaseFields).toEqual(['version', 'build', 'commit']);
  expect(JSON.parse(await readFile(data.reviewPath, 'utf8')).release).toEqual(release);
  const html = await readFile(f.output, 'utf8');
  for (const text of ['Exio', 'iOS', 'mock simulator', 'CHECKOUT-01']) expect(html).toContain(text);
});

it('requires a direct plan when supplying report release metadata', async () => {
  const f = await fixture();
  const response = await f.invoke('--release', '{"app":"Exio"}');
  expect(response.exitCode).toBe(2);
  await expect(readFile(f.output)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('blocks review metadata conflicting with the saved run identity and shows the recorded identity', async () => {
  const f = await reviewFixture();
  const reportPath = join(f.runDir, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  await writeFile(reportPath, JSON.stringify({ ...report, release: { ...f.review.release, build: 'tested-build-437' } }));
  const response = await f.generate('--require-qualified');
  expect(response.exitCode).toBe(1);
  expect(JSON.parse(response.stdout).data.blockers).toContain('发版信息冲突：构建号与测试运行记录不一致。');
  expect(await readFile(f.output, 'utf8')).toContain('tested-build-437');
});

it('retains conflicting supplied identity in the auto-review manifest so reopening cannot erase its blocker', async () => {
  const f = await reviewFixture();
  const reportPath = join(f.runDir, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  await writeFile(reportPath, JSON.stringify({ ...report, release: f.review.release }));
  const response = await f.invoke('--plan', f.planPath, '--release', '{"build":"different-build"}', '--require-qualified');
  expect(response.exitCode).toBe(1);
  const data = JSON.parse(response.stdout).data;
  const review = JSON.parse(await readFile(data.reviewPath, 'utf8'));
  expect(review.release.build).toBe('different-build');
  const reopened = await executeCli(['artifacts', 'report', 'demo', '--cwd', f.root, '--runs-root', join(f.root, 'runs'),
    '--review', data.reviewPath, '--output', join(f.root, 'reopened.html'), '--require-qualified', '--json']);
  expect(reopened.exitCode).toBe(1);
  expect(JSON.parse(reopened.stdout).data.blockers).toContain('发版信息冲突：构建号与测试运行记录不一致。');
});

it('preserves an existing auto-review destination without writing a new report', async () => {
  const f = await reviewFixture();
  await mkdir(join(f.root, 'shared'));
  const path = join(f.root, 'shared/report.review.json');
  await writeFile(path, 'keep review');
  const response = await f.invoke('--plan', f.planPath);
  expect(response.exitCode).not.toBe(0);
  expect(await readFile(path, 'utf8')).toBe('keep review');
  await expect(readFile(f.output)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects competing plan and review inputs rather than silently dropping either', async () => {
  const f = await reviewFixture();
  expect((await f.generate('--plan', f.planPath)).exitCode).toBe(2);
  await expect(readFile(f.output)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([null, '', '   ', 437])('rejects malformed provided release fields (%s)', async version => {
  const f = await reviewFixture();
  await writeFile(f.reviewPath, JSON.stringify({ ...f.review, release: { ...f.review.release, version } }));
  expect((await f.generate()).exitCode).toBe(2);
  await expect(readFile(f.output)).rejects.toMatchObject({ code: 'ENOENT' });
});


it('blocks unbound generated cases and displays their planned steps even when the run passed', async () => {
  const f = await reviewFixture();
  delete (f.plan.items[0].cases[0] as { binding?: unknown }).binding;
  f.plan.items[0].cases[0].automation = { status: 'pending' };
  await writeFile(f.planPath, JSON.stringify(f.plan));
  const response = await f.generate('--require-qualified');
  expect(response.exitCode).toBe(1);
  expect(JSON.parse(response.stdout).data.blockers).toContain('CHECKOUT-01：待编写。');
  const html = await readFile(f.output, 'utf8');
  for (const text of ['应用满减券并提交订单', '订单提交成功', '已登录且有可用优惠券']) expect(html).toContain(text);
});

it('blocks unresolved requirements and Items with no generated cases', async () => {
  const f = await reviewFixture();
  f.plan.items[0].cases = [];
  f.plan.items[0].openQuestions = ['优惠券是否允许叠加？'];
  await writeFile(f.planPath, JSON.stringify(f.plan));
  const response = await f.generate();
  expect(JSON.parse(response.stdout).data).toMatchObject({ releaseReady: false, blockers: expect.arrayContaining([
    expect.stringContaining('优惠券是否允许叠加'), expect.stringContaining('没有测试用例'),
  ]) });
});

it('rejects duplicate bindings and inconsistent Item provenance', async () => {
  const f = await reviewFixture();
  f.plan.items[0].cases.push({ ...f.plan.items[0].cases[0], id: 'CHECKOUT-02' });
  await writeFile(f.planPath, JSON.stringify(f.plan));
  expect((await f.generate()).exitCode).toBe(2);
  f.plan.items[0].cases.pop();
  f.plan.items[0].source.iid = '999';
  await writeFile(f.planPath, JSON.stringify(f.plan));
  expect((await f.generate()).exitCode).toBe(2);
});


it('shows acceptance criteria and their linked cases for release review', async () => {
  const f = await reviewFixture();
  const result = await f.generate();
  expect(JSON.parse(result.stdout).data.releaseReady).toBe(true);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('验收 checklist');
  expect(html).toContain('AC-01');
  expect(html).toContain('优惠券金额计入实付金额');
});

it('keeps the GitLab link and test definitions without embedding Item descriptions, source quotes or comments', async () => {
  const f = await reviewFixture();
  f.plan.items[0].source.comments = [{ id: 'note-1', body: '仅保存在来源快照中的讨论正文', updatedAt: '2026-11-03T00:00:00Z' }];
  await writeFile(f.planPath, JSON.stringify(f.plan));
  expect((await f.generate()).exitCode).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain(`href="${f.plan.items[0].source.url}"`);
  expect(html).not.toContain(f.plan.items[0].source.description);
  expect(html).not.toContain('仅保存在来源快照中的讨论正文');
  expect(html).toContain(f.plan.items[0].cases[0].description);
  expect(html).toContain(f.plan.items[0].acceptanceCriteria[0].text);
});

it('renders the recorded device snapshot and preserves it in the generated review manifest', async () => {
  const f = await reviewFixture();
  const device = { id: 'test-simulator-01', name: 'QA iPhone', model: 'iPhone 17 Pro', platform: 'ios', kind: 'simulator', osVersion: '26.0' };
  const path = join(f.runDir, 'report.json');
  await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), device }));
  const response = await f.invoke('--plan', f.planPath, '--release', JSON.stringify(f.review.release));
  expect(response.exitCode, response.stdout).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html).toMatch(/<dl class="release-meta">[\s\S]*?<dt>设备型号<\/dt><dd>iPhone 17 Pro<\/dd>[\s\S]*?<\/dl>/);
  for (const value of ['id="device-heading"', 'class="device-section"', '设备名称', '系统版本', '设备类型', '设备标识', 'QA iPhone', device.id]) expect(html).not.toContain(value);
  expect(JSON.parse(await readFile(JSON.parse(response.stdout).data.reviewPath, 'utf8')).device).toEqual(device);
});

it('accepts verified historical device metadata from a review and escapes its values', async () => {
  const f = await reviewFixture();
  await writeFile(f.reviewPath, JSON.stringify({ ...f.review, device: { model: '<Pixel & QA>', platform: 'android', kind: 'physical', osVersion: '16' } }));
  const response = await f.generate();
  expect(response.exitCode, response.stdout).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('&lt;Pixel &amp; QA&gt;');
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(true);
});

it('uses the recorded device snapshot as a whole when review device details differ', async () => {
  const f = await reviewFixture();
  const path = join(f.runDir, 'report.json');
  await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), device: { id: 'recorded-device', model: 'iPhone 17 Pro' } }));
  await writeFile(f.reviewPath, JSON.stringify({ ...f.review, device: { id: 'another-device', model: 'Pixel 9', osVersion: '16' } }));
  expect((await f.generate()).exitCode).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('iPhone 17 Pro');
  expect(html).not.toContain('another-device');
  expect(html).not.toContain('Pixel 9');
  expect(html).not.toContain('<dt>系统版本</dt>');
});

it('shows absent historical device metadata without inventing a model or blocking a qualified run', async () => {
  const f = await reviewFixture();
  const response = await f.generate();
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(true);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('<dt>设备型号</dt><dd>未记录</dd>');
});

it('blocks an uncovered acceptance criterion even when existing bound cases passed', async () => {
  const f = await reviewFixture();
  f.plan.items[0].acceptanceCriteria.push({ ...f.plan.items[0].acceptanceCriteria[0], id: 'AC-02' });
  f.plan.items[0].openQuestions = ['AC-02：边界金额缺少定义'];
  await writeFile(f.planPath, JSON.stringify(f.plan));
  const response = await f.generate('--require-qualified');
  expect(response.exitCode).toBe(1);
  expect(JSON.parse(response.stdout).data.blockers).toContain('#128 / AC-02：验收标准未覆盖。');
});

it('rejects claimed acceptance coverage when the referenced original text does not exist', async () => {
  const f = await reviewFixture();
  f.plan.items[0].acceptanceCriteria[0].source.quote = '不存在的验收标准';
  await writeFile(f.planPath, JSON.stringify(f.plan));
  expect((await f.generate()).exitCode).toBe(2);
});

it('shows partial coverage evidence and reasons without qualifying passing subsets', async () => {
  const f = await reviewFixture();
  const plan = JSON.parse(JSON.stringify(f.plan));
  const c = plan.items[0].cases[0];
  c.automation = { status: 'partial', reason: '尚缺金额边界 <核验>', tests: [c.binding] };
  delete c.binding;
  await writeFile(f.planPath, JSON.stringify(plan));
  const response = await f.generate();
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(false);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('data-status="partial"');
  expect(html).toContain('部分覆盖');
  expect(html).toContain('尚缺金额边界 &lt;核验&gt;');
  expect(html).toContain('点击结算');
  expect(html).not.toContain('未绑定');
  expect(html).not.toContain('未关联 GitLab Item 的测试');
});

it('shows blocked requirement-derived cases without requiring a checklist', async () => {
  const f = await reviewFixture(), plan = JSON.parse(JSON.stringify(f.plan));
  plan.items[0].basis = 'requirements';
  const c = plan.items[0].cases[0];
  c.automation = { status: 'blocked', reason: '业务金额规则尚未确认' };
  delete c.binding;
  await writeFile(f.planPath, JSON.stringify(plan));
  const response = await f.generate();
  expect(response.exitCode).toBe(0);
  const html = await readFile(f.output, 'utf8');
  expect(html).toContain('根据需求推导的验收标准');
  expect(html).toContain('data-status="blocked"');
  expect(html).toContain('业务金额规则尚未确认');
  expect(JSON.parse(response.stdout).data.releaseReady).toBe(false);
});

it('qualifies complete requirement-derived scripts without an acceptance checklist', async () => {
  const f = await reviewFixture();
  f.plan.items[0].basis = 'requirements';
  await writeFile(f.planPath, JSON.stringify(f.plan));
  const response = await f.generate('--require-qualified');
  expect(response.exitCode, response.stdout).toBe(0);
  expect(JSON.parse(response.stdout).data).toMatchObject({ releaseReady: true, automatedCases: 1 });
  expect(await readFile(f.output, 'utf8')).toContain('根据需求推导的验收标准');
});

it.each([
  { automation: { status: 'complete' } },
  { automation: { status: 'pending' }, binding: { file: 'checkout.test.ts', name: '购物车成功结算' } },
  { automation: { status: 'partial', reason: '缺少视觉断言', tests: [] } },
  { automation: { status: 'blocked', reason: '' } },
])('rejects inconsistent or unexplained automation coverage (%j)', async declaration => {
  const f = await reviewFixture(), plan = JSON.parse(JSON.stringify(f.plan));
  const entry = plan.items[0].cases[0];
  delete entry.binding;
  Object.assign(entry, declaration);
  await writeFile(f.planPath, JSON.stringify(plan));
  expect((await f.generate()).exitCode).toBe(2);
  await expect(readFile(f.output)).rejects.toThrow();
});

it('keeps missing supporting evidence visible and does not claim a passing case', async () => {
  const f = await reviewFixture(), plan = JSON.parse(JSON.stringify(f.plan));
  const entry = plan.items[0].cases[0];
  delete entry.binding;
  entry.automation = { status: 'partial', reason: '缺少边界断言', tests: [{ file: 'checkout.test.ts', name: 'another test' }] };
  await writeFile(f.planPath, JSON.stringify(plan));
  const response = await f.generate('--require-qualified');
  expect(response.exitCode).toBe(1);
  expect(JSON.parse(response.stdout).data.blockers).toContain('CHECKOUT-01：部分覆盖的测试本次未执行（another test）。');
  expect(await readFile(f.output, 'utf8')).toContain('data-status="partial"');
});
