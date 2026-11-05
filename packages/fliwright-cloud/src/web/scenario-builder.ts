import type { TestScenario } from '@fliwright/core';
import type { TestCatalog } from '@fliwright/cloud-protocol';

export interface ScenarioDraft {
  name: string;
  profile: string;
  route: string;
  directory: string;
  allowUnmatched: boolean;
  rules: Array<{ endpoint: string; method: string; rule: string }>;
}

/** Produce repository-owned declarations without replacing an existing config. */
export function scenarioFiles(draft: ScenarioDraft, catalog?: TestCatalog) {
  const name = draft.name.trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,99}$/u.test(name)) throw new Error('场景名称需为 1–100 个汉字、字母、数字、点、横线或下划线，并以汉字、字母或数字开头。');
  if (catalog?.scenarios.some(item => item.name === name)) throw new Error('这个版本已存在同名场景，请使用其他名称。');
  const route = draft.route.trim();
  if (route && (!route.startsWith('/') || /[\r\n]/.test(route) || route.length > 500)) throw new Error('起始页面需以 / 开头，长度不超过 500 个字符。');
  const scenario: TestScenario = { name, layers: [] };
  if (draft.directory) {
    const directory = catalog?.mocks?.find(item => item.directory === draft.directory);
    if (!directory) throw new Error('所选 Mock 目录不在当前扫描结果中，请重新选择。');
    const profiles = new Set(directory.profiles ?? directory.endpoints.flatMap(item => item.rules));
    const profile = draft.profile.trim();
    if (profile && !profiles.has(profile)) throw new Error('所选 Mock profile 已失效，请重新扫描后再选择。');
    const selected = new Set<string>();
    for (const rule of draft.rules) {
      const key = JSON.stringify([rule.endpoint, rule.method.toUpperCase()]);
      const endpoint = directory.endpoints.find(item => item.endpoint === rule.endpoint && item.method.toUpperCase() === rule.method.toUpperCase());
      if (selected.has(key) || !endpoint?.rules.includes(rule.rule)) throw new Error('Mock 规则已失效或重复，请重新选择。');
      selected.add(key);
    }
    scenario.layers.push({ kind: 'mocks', directory: draft.directory, denyUnmatchedRequests: !draft.allowUnmatched,
      ...(profile ? { profile } : {}),
      ...(draft.rules.length ? { rules: draft.rules.map(rule => ({ ...rule, method: rule.method.toUpperCase() })) } : {}),
    });
  }
  if (route) scenario.layers.push({ kind: 'navigation', route });
  return {
    filename: `${name}.ts`,
    source: `import type { TestScenario } from '@fliwright/core';\n\nexport const scenarios = ${JSON.stringify({ [name]: scenario }, null, 2)} satisfies Record<string, TestScenario>;\n`,
    integration: `import { scenarios as generatedScenarios } from './.fliwright/scenarios/${name}.js';\n\n// 将下面的属性合并到已有的 defineConfig({ ... }) 中，保留其他配置和已有场景。\nscenarios: {\n  // ...已有场景\n  ...generatedScenarios,\n},`,
  };
}
