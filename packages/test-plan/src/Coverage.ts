import { dirname, join, resolve } from 'node:path';
import { readJson, replaceFile, type InputOptions } from './files.js';
import { testPlanSchema, type TestPlan } from './schema.js';

const cell = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

/** Render authored coverage from the plan, without inventing execution results. */
export function renderCoverage(plan: TestPlan): string {
  const validated = testPlanSchema.parse(plan);
  const lines = ['# 测试计划覆盖索引', '', '由 plan.json 生成；覆盖状态不表示测试运行通过，执行结果以真实 run 产物为准。', ''];
  for (const item of validated.items) {
    const counts = { pending: 0, partial: 0, blocked: 0, complete: 0 };
    for (const entry of item.cases) counts[entry.automation.status]++;
    lines.push(`## ${cell(item.source.title)}`, '', `来源：${item.source.url}`, '',
      `依据：${item.basis}；源更新时间：${item.source.updatedAt}；读取时间：${item.source.fetchedAt}。`, '',
      `用例 ${item.cases.length}：${Object.entries(counts).map(([status, count]) => `${status} ${count}`).join('，')}。`, '',
      '| 验收标准 | 内容 | 来源原文 | 用例 ID |', '| --- | --- | --- | --- |');
    for (const criterion of item.acceptanceCriteria) {
      const cases = item.cases.filter(entry => entry.acceptanceCriteria.includes(criterion.id)).map(entry => entry.id);
      const origin = criterion.source.kind === 'comment' ? `评论 ${criterion.source.commentId}` : '描述';
      lines.push(`| ${cell(criterion.id)} | ${cell(criterion.text)} | ${cell(origin)}：${cell(criterion.source.quote)} | ${cases.map(cell).join('<br>') || '无对应用例'} |`);
    }
    lines.push('', '| 用例 ID | 用例 | 验收标准 | 覆盖状态 | 脚本 / 测试名 | 缺口 |', '| --- | --- | --- | --- | --- | --- |');
    for (const entry of item.cases) {
      const refs = entry.binding ? [entry.binding] : 'tests' in entry.automation ? entry.automation.tests ?? [] : [];
      const tests = refs.map(ref => `${cell(ref.file)}：${cell(ref.name)}`).join('<br>');
      const reason = 'reason' in entry.automation ? entry.automation.reason ?? '' : '';
      lines.push(`| ${cell(entry.id)} | ${cell(entry.title)} | ${entry.acceptanceCriteria.map(cell).join(', ')} | ${entry.automation.status} | ${tests} | ${cell(reason)} |`);
    }
    lines.push('', '待确认事项：', '', ...(item.openQuestions.length ? item.openQuestions.map(question => `- ${cell(question)}`) : ['无。']), '');
  }
  return lines.join('\n');
}

/** Regenerate the single derived coverage view, or return Markdown for stdout with output '-'. */
export async function generateCoverage(options: InputOptions & { plan: string; output?: string }) {
  const planPath = resolve(options.cwd ?? process.cwd(), options.plan);
  const content = renderCoverage(testPlanSchema.parse(await readJson(options.plan, options)));
  if (options.output === '-') return { output: '-', content };
  const output = options.output ? resolve(options.cwd ?? process.cwd(), options.output) : join(dirname(planPath), 'coverage.md');
  if (output === planPath) throw new Error('Coverage output must differ from the source plan.');
  await replaceFile(output, content, { signal: options.signal });
  return { output, content };
}
