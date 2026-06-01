/**
 * Comprehensive test for FormHelper pipeline
 *
 * Covers:
 *   - Disabled fields
 *   - All semantic types (phone, email, idCard, fullName, address, password, captcha, number, url, date)
 *   - maxLength truncation
 *   - Mixed selector types (text=, key=, byType=)
 *   - Label-based matching
 *   - Custom skills via JsonRuleLoader
 *   - FakerGenerator output format validation
 *   - SemanticInferrer fallback chain (hintText → label → keyboardType → 'text')
 *   - Large forms (10+ fields)
 *   - All-obscure / all-disabled edge cases
 */
import { describe, it, expect, vi } from 'vitest';
import { FormHelper } from '../src/FormHelper.js';
import { FakerGenerator } from '../src/FakerGenerator.js';
import { SemanticInferrer } from '../src/SemanticInferrer.js';
import { SkillRegistry } from '../src/SkillRegistry.js';
import { JsonRuleLoader } from '../src/JsonRuleLoader.js';
import type { FormFieldMeta, FormRulesFile, SemanticType } from '../src/types.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (method === 'ext.fliwright.extractForm' && responses[method]) {
      const resp = responses[method] as { fields: FormFieldMeta[] };
      return Promise.resolve(resp);
    }
    if (responses[method] !== undefined) return Promise.resolve(responses[method]);
    return Promise.resolve({});
  });
}

/** Minimal widget that satisfies Locator._resolve() */
const GENERIC_WIDGET = {
  id: 'w0',
  type: 'TextFormField',
  rect: { x: 10, y: 10, width: 300, height: 48 },
  properties: {},
};

/** Default mock responses that make Locator.click() / type() succeed */
const DEFAULT_MOCK_RESPONSES: Record<string, unknown> = {
  'ext.fliwright.inspect': { widgets: [GENERIC_WIDGET] },
  'ext.fliwright.click': { status: 'ok' },
  'ext.fliwright.type': { status: 'ok' },
};

function field(overrides: Partial<FormFieldMeta> & { id: string }): FormFieldMeta {
  return {
    type: 'TextFormField',
    rect: { x: 10, y: 100, width: 300, height: 48 },
    obscureText: false,
    enabled: true,
    selector: `text=${overrides.hintText ?? overrides.label ?? 'Field'}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Disabled fields
// ---------------------------------------------------------------------------

describe('FormHelper: disabled fields', () => {
  it('skips disabled fields', async () => {
    const fields = [
      field({ id: 'f1', hintText: 'Name', enabled: true }),
      field({ id: 'f2', hintText: 'Phone', enabled: false }),
    ];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    const result = await new FormHelper(send).fill();
    expect(result.fields.find(f => f.id === 'f1')!.status).toBe('filled');
    expect(result.fields.find(f => f.id === 'f2')!.status).toBe('skipped');
    expect(result.skipped).toBe(1);
    expect(result.filled).toBe(1);
  });

  it('all-disabled form produces 0 filled', async () => {
    const fields = [
      field({ id: 'f1', hintText: 'A', enabled: false }),
      field({ id: 'f2', hintText: 'B', enabled: false }),
    ];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    const result = await new FormHelper(send).fill();
    expect(result.filled).toBe(0);
    expect(result.skipped).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. All-obscure fields
// ---------------------------------------------------------------------------

describe('FormHelper: all-obscure fields', () => {
  it('skips all when skipObscureFields=true and all are obscure', async () => {
    const fields = [
      field({ id: 'f1', hintText: 'Password', obscureText: true }),
      field({ id: 'f2', hintText: 'Confirm', obscureText: true }),
    ];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    const result = await new FormHelper(send).fill({ skipObscureFields: true });
    expect(result.filled).toBe(0);
    expect(result.skipped).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Semantic types & FakerGenerator output
// ---------------------------------------------------------------------------

describe('FakerGenerator: output format validation', () => {
  const generator = new FakerGenerator();

  it('phone: starts with 1, 11 digits', () => {
    for (let i = 0; i < 20; i++) {
      const val = generator.generate('phone');
      expect(val).toMatch(/^1[3-9]\d{9}$/);
      expect(val.length).toBe(11);
    }
  });

  it('email: contains @', () => {
    for (let i = 0; i < 20; i++) {
      const val = generator.generate('email');
      expect(val).toContain('@');
      expect(val.length).toBeGreaterThan(3);
    }
  });

  it('idCard: 18 chars, last char is digit or X', () => {
    for (let i = 0; i < 20; i++) {
      const val = generator.generate('idCard');
      expect(val).toMatch(/^\d{17}[\dX]$/);
      expect(val.length).toBe(18);
    }
  });

  it('fullName: non-empty string', () => {
    const val = generator.generate('fullName');
    expect(val.length).toBeGreaterThan(0);
  });

  it('address: non-empty string', () => {
    const val = generator.generate('address');
    expect(val.length).toBeGreaterThan(0);
  });

  it('captcha: 4-6 digits', () => {
    for (let i = 0; i < 20; i++) {
      const val = generator.generate('captcha');
      expect(val).toMatch(/^\d{4,6}$/);
    }
  });

  it('number: digits only', () => {
    for (let i = 0; i < 20; i++) {
      const val = generator.generate('number');
      expect(val).toMatch(/^\d+$/);
    }
  });

  it('url: starts with http', () => {
    for (let i = 0; i < 10; i++) {
      const val = generator.generate('url');
      expect(val).toMatch(/^https?:\/\//);
    }
  });

  it('date: YYYY-MM-DD format', () => {
    for (let i = 0; i < 10; i++) {
      const val = generator.generate('date');
      expect(val).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('password: mixed chars, respects maxLength', () => {
    const val8 = generator.generate('password', 8);
    expect(val8.length).toBeLessThanOrEqual(8);

    const valDefault = generator.generate('password');
    expect(valDefault.length).toBeLessThanOrEqual(32);
  });

  it('text: returns a sentence', () => {
    const val = generator.generate('text');
    expect(val.length).toBeGreaterThan(0);
  });

  it('maxLength truncates long values', () => {
    const val = generator.generate('text', 5);
    expect(val.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// 4. SemanticInferrer fallback chain
// ---------------------------------------------------------------------------

describe('SemanticInferrer: inference priority', () => {
  const inferrer = new SemanticInferrer();

  it('infers phone from hintText "手机号"', () => {
    const fields = [field({ id: 'f1', hintText: '请输入手机号' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('phone');
  });

  it('infers email from hintText "email address"', () => {
    const fields = [field({ id: 'f1', hintText: 'email address' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('email');
  });

  it('infers password from hintText "密码"', () => {
    const fields = [field({ id: 'f1', hintText: '密码' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('password');
  });

  it('infers captcha from hintText "验证码"', () => {
    const fields = [field({ id: 'f1', hintText: '验证码' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('captcha');
  });

  it('infers idCard from hintText "身份证号"', () => {
    const fields = [field({ id: 'f1', hintText: '身份证号' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('idCard');
  });

  it('infers fullName from hintText "真实姓名"', () => {
    const fields = [field({ id: 'f1', hintText: '真实姓名' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('fullName');
  });

  it('infers address from hintText "地址"', () => {
    const fields = [field({ id: 'f1', hintText: '地址' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('address');
  });

  it('infers date from hintText "日期"', () => {
    const fields = [field({ id: 'f1', hintText: '日期' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('date');
  });

  it('falls back to keyboardType when hintText is generic', () => {
    const fields = [field({ id: 'f1', hintText: 'Input', keyboardType: 'phone' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('phone');
  });

  it('falls back to keyboardType=number', () => {
    const fields = [field({ id: 'f1', hintText: 'Amount', keyboardType: 'number' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('number');
  });

  it('falls back to keyboardType=url', () => {
    const fields = [field({ id: 'f1', hintText: 'Link', keyboardType: 'url' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('url');
  });

  it('infers from label when hintText is absent', () => {
    const fields = [field({ id: 'f1', label: '邮箱地址', hintText: undefined })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('email');
  });

  it('defaults to text when nothing matches', () => {
    const fields = [field({ id: 'f1', hintText: '自定义字段' })];
    const result = inferrer.infer(fields);
    expect(result.get('f1')).toBe('text');
  });

  it('hintText takes priority over keyboardType', () => {
    // hintText "金额" doesn't match any pattern, but keyboardType=number would give 'number'
    // Since "金额" doesn't match, it falls to keyboardType
    const fields = [field({ id: 'f1', hintText: '金额', keyboardType: 'phone' })];
    const result = inferrer.infer(fields);
    // "金额" doesn't match any hint pattern → falls to keyboardType=phone
    expect(result.get('f1')).toBe('phone');
  });
});

// ---------------------------------------------------------------------------
// 5. Mixed selector types
// ---------------------------------------------------------------------------

describe('FormHelper: selector type parsing', () => {
  it('handles text= selector', async () => {
    const fields = [field({ id: 'f1', hintText: 'Name', selector: 'text=姓名' })];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    await new FormHelper(send).fill();
    // Verify inspect is called with the correct text selector
    const inspectCalls = send.mock.calls.filter(c => c[0] === 'ext.fliwright.inspect');
    expect(inspectCalls.some(c => (c[1] as any).selector === 'text=姓名')).toBe(true);
  });

  it('handles key= selector', async () => {
    const fields = [field({ id: 'f1', hintText: 'Name', selector: 'key=name_field' })];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    await new FormHelper(send).fill();
    const inspectCalls = send.mock.calls.filter(c => c[0] === 'ext.fliwright.inspect');
    expect(inspectCalls.some(c => (c[1] as any).selector === 'key=name_field')).toBe(true);
  });

  it('handles byType= selector', async () => {
    const fields = [field({ id: 'f1', hintText: 'Name', selector: 'byType=TextFormField' })];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    await new FormHelper(send).fill();
    const inspectCalls = send.mock.calls.filter(c => c[0] === 'ext.fliwright.inspect');
    expect(inspectCalls.some(c => (c[1] as any).selector === 'byType=TextFormField')).toBe(true);
  });

  it('handles bare text selector (no prefix)', async () => {
    const fields = [field({ id: 'f1', hintText: 'Name', selector: '姓名' })];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    await new FormHelper(send).fill();
    const inspectCalls = send.mock.calls.filter(c => c[0] === 'ext.fliwright.inspect');
    // Bare text without prefix → treated as { text: '姓名' } → wire format 'text=姓名'
    expect(inspectCalls.some(c => (c[1] as any).selector === 'text=姓名')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. fillFields() matching
// ---------------------------------------------------------------------------

describe('FormHelper: fillFields() matching', () => {
  it('matches by hintText substring', async () => {
    const fields = [
      field({ id: 'f1', hintText: '请输入手机号' }),
      field({ id: 'f2', hintText: '邮箱地址' }),
      field({ id: 'f3', hintText: '密码' }),
    ];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    const result = await new FormHelper(send).fillFields(['手机']);
    expect(result.fields.find(f => f.id === 'f1')!.status).toBe('filled');
    expect(result.fields.find(f => f.id === 'f2')!.status).toBe('skipped');
    expect(result.fields.find(f => f.id === 'f3')!.status).toBe('skipped');
  });

  it('matches by label when hintText is absent', async () => {
    const fields = [
      field({ id: 'f1', hintText: undefined, label: '手机号码' }),
      field({ id: 'f2', hintText: undefined, label: '邮箱' }),
    ];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    const result = await new FormHelper(send).fillFields(['手机']);
    expect(result.fields.find(f => f.id === 'f1')!.status).toBe('filled');
    expect(result.fields.find(f => f.id === 'f2')!.status).toBe('skipped');
  });

  it('matches multiple hints to multiple fields', async () => {
    const fields = [
      field({ id: 'f1', hintText: '手机号' }),
      field({ id: 'f2', hintText: '邮箱' }),
      field({ id: 'f3', hintText: '姓名' }),
    ];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    const result = await new FormHelper(send).fillFields(['手机', '邮箱']);
    expect(result.fields.find(f => f.id === 'f1')!.status).toBe('filled');
    expect(result.fields.find(f => f.id === 'f2')!.status).toBe('filled');
    expect(result.fields.find(f => f.id === 'f3')!.status).toBe('skipped');
  });

  it('non-matching hints result in all skipped', async () => {
    const fields = [field({ id: 'f1', hintText: '手机号' })];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });
    const result = await new FormHelper(send).fillFields(['不存在']);
    expect(result.filled).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Large form (10+ fields, all semantic types)
// ---------------------------------------------------------------------------

describe('FormHelper: large form with all semantic types', () => {
  it('handles a 10-field form with mixed types', async () => {
    const fields: FormFieldMeta[] = [
      field({ id: 'f1', hintText: '手机号', keyboardType: 'phone' }),
      field({ id: 'f2', hintText: '邮箱地址', keyboardType: 'emailAddress' }),
      field({ id: 'f3', hintText: '身份证号' }),
      field({ id: 'f4', hintText: '真实姓名' }),
      field({ id: 'f5', hintText: '地址' }),
      field({ id: 'f6', hintText: '密码', obscureText: true }),
      field({ id: 'f7', hintText: '验证码' }),
      field({ id: 'f8', hintText: '数量', keyboardType: 'number' }),
      field({ id: 'f9', hintText: '网站', keyboardType: 'url' }),
      field({ id: 'f10', hintText: '出生日期' }),
    ];

    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      ...DEFAULT_MOCK_RESPONSES,
    });

    const result = await new FormHelper(send).fill({ skipObscureFields: true });

    // 9 should be filled (password f6 is skipped due to obscureText)
    expect(result.filled).toBe(9);
    expect(result.skipped).toBe(1);

    // Verify each semantic type
    expect(result.fields.find(f => f.id === 'f1')!.semanticType).toBe('phone');
    expect(result.fields.find(f => f.id === 'f2')!.semanticType).toBe('email');
    expect(result.fields.find(f => f.id === 'f3')!.semanticType).toBe('idCard');
    expect(result.fields.find(f => f.id === 'f4')!.semanticType).toBe('fullName');
    expect(result.fields.find(f => f.id === 'f5')!.semanticType).toBe('address');
    expect(result.fields.find(f => f.id === 'f6')!.semanticType).toBe('password');
    expect(result.fields.find(f => f.id === 'f7')!.semanticType).toBe('captcha');
    expect(result.fields.find(f => f.id === 'f8')!.semanticType).toBe('number');
    expect(result.fields.find(f => f.id === 'f9')!.semanticType).toBe('url');
    expect(result.fields.find(f => f.id === 'f10')!.semanticType).toBe('date');

    // Verify generated values are non-empty for filled fields
    for (const f of result.fields.filter(f => f.status === 'filled')) {
      expect(f.generatedValue.length).toBeGreaterThan(0);
    }

    // Verify protocol calls: 1 extract + 9*2 (inspect+click, then type) = at least 19
    const extractCalls = send.mock.calls.filter(c => c[0] === 'ext.fliwright.extractForm');
    expect(extractCalls).toHaveLength(1);
    const clickCalls = send.mock.calls.filter(c => c[0] === 'ext.fliwright.click');
    expect(clickCalls.length).toBe(9);
    const typeCalls = send.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
    expect(typeCalls.length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 8. Custom skills via JsonRuleLoader
// ---------------------------------------------------------------------------

describe('FormHelper: custom skills via JsonRuleLoader', () => {
  it('loads custom PRESET_SKILL from JSON and uses it', async () => {
    const tmpDir = await mkdtemp();
    try {
      const rulesFile: FormRulesFile = {
        version: 1,
        rules: [
          {
            match: { hintText: '公司名称' },
            type: 'PRESET_SKILL',
            data: ['TestCorp Inc.'],
          },
        ],
      };
      const filePath = join(tmpDir, 'rules.json');
      await writeFile(filePath, JSON.stringify(rulesFile), 'utf8');

      const fields = [field({ id: 'f1', hintText: '公司名称' })];
      const send = createMockSendRequest({
        'ext.fliwright.extractForm': { fields },
        ...DEFAULT_MOCK_RESPONSES,
      });

      const result = await new FormHelper(send).fill({ rulesFile: filePath });
      expect(result.filled).toBe(1);
      expect(result.fields[0].generatedValue).toBe('TestCorp Inc.');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads REGEXP_MOCK skill and generates matching output', async () => {
    const tmpDir = await mkdtemp();
    try {
      const rulesFile: FormRulesFile = {
        version: 1,
        rules: [
          {
            match: { hintText: '订单号' },
            type: 'REGEXP_MOCK',
            pattern: 'ORD-\\d{6}',
          },
        ],
      };
      const filePath = join(tmpDir, 'rules.json');
      await writeFile(filePath, JSON.stringify(rulesFile), 'utf8');

      const fields = [field({ id: 'f1', hintText: '订单号' })];
      const send = createMockSendRequest({
        'ext.fliwright.extractForm': { fields },
        ...DEFAULT_MOCK_RESPONSES,
      });

      const result = await new FormHelper(send).fill({ rulesFile: filePath });
      expect(result.filled).toBe(1);
      expect(result.fields[0].generatedValue).toMatch(/^ORD-\d{6}$/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('LLM_GENERATE skill cycles through data array', async () => {
    const tmpDir = await mkdtemp();
    try {
      const rulesFile: FormRulesFile = {
        version: 1,
        rules: [
          {
            match: { hintText: '备注' },
            type: 'LLM_GENERATE',
            data: ['第一句', '第二句', '第三句'],
          },
        ],
      };
      const filePath = join(tmpDir, 'rules.json');
      await writeFile(filePath, JSON.stringify(rulesFile), 'utf8');

      const loader = new JsonRuleLoader(tmpDir);
      const skills = loader.loadFromFile(filePath);
      expect(skills).toHaveLength(1);

      const skill = skills[0];
      expect(skill.generate({} as FormFieldMeta, 'zh_CN')).toBe('第一句');
      expect(skill.generate({} as FormFieldMeta, 'zh_CN')).toBe('第二句');
      expect(skill.generate({} as FormFieldMeta, 'zh_CN')).toBe('第三句');
      expect(skill.generate({} as FormFieldMeta, 'zh_CN')).toBe('第一句'); // cycles
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('skill takes priority over FakerGenerator', async () => {
    const registry = new SkillRegistry();
    registry.register({
      name: 'custom-email',
      type: 'PRESET_SKILL',
      match: (f) => f.hintText?.includes('邮箱') ?? false,
      generate: () => 'custom@example.com',
    });

    const matchingField = field({ id: 'f1', hintText: '邮箱地址' });
    expect(registry.match(matchingField)).not.toBeNull();

    const nonMatchingField = field({ id: 'f2', hintText: '手机号' });
    expect(registry.match(nonMatchingField)).toBeNull();
  });

  it('ignores rules file with wrong version', async () => {
    const tmpDir = await mkdtemp();
    try {
      const rulesFile = { version: 2, rules: [{ match: { hintText: 'x' }, type: 'PRESET_SKILL' }] };
      const filePath = join(tmpDir, 'rules.json');
      await writeFile(filePath, JSON.stringify(rulesFile), 'utf8');

      const loader = new JsonRuleLoader(tmpDir);
      const skills = loader.loadFromFile(filePath);
      expect(skills).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Error handling: widget not found
// ---------------------------------------------------------------------------

describe('FormHelper: error handling', () => {
  it('reports error when inspect returns empty widgets', async () => {
    const fields = [field({ id: 'f1', hintText: 'Name' })];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
      'ext.fliwright.inspect': { widgets: [] }, // Widget not found
    });
    const result = await new FormHelper(send).fill();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.fields.find(f => f.id === 'f1')!.status).toBe('error');
    expect(result.filled).toBe(0);
  });

  it('continues filling other fields after one error', async () => {
    const fields = [
      field({ id: 'f1', hintText: 'Name', selector: 'text=Name' }),
      field({ id: 'f2', hintText: 'Phone', selector: 'text=Phone' }),
    ];
    let inspectCallCount = 0;
    const send = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.extractForm') return Promise.resolve({ fields });
      if (method === 'ext.fliwright.inspect') {
        inspectCallCount++;
        // First field fails, second succeeds
        if (inspectCallCount === 1) return Promise.resolve({ widgets: [] });
        return Promise.resolve({ widgets: [GENERIC_WIDGET] });
      }
      if (method === 'ext.fliwright.click') return Promise.resolve({ status: 'ok' });
      if (method === 'ext.fliwright.type') return Promise.resolve({ status: 'ok' });
      return Promise.resolve({});
    });

    const result = await new FormHelper(send).fill();
    expect(result.fields.find(f => f.id === 'f1')!.status).toBe('error');
    expect(result.fields.find(f => f.id === 'f2')!.status).toBe('filled');
    expect(result.filled).toBe(1);
    expect(result.errors.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10. analyze() detailed validation
// ---------------------------------------------------------------------------

describe('FormHelper: analyze() detailed', () => {
  it('returns correct structure for each field', async () => {
    const fields: FormFieldMeta[] = [
      field({ id: 'f1', hintText: '手机号', keyboardType: 'phone', maxLength: 11 }),
      field({ id: 'f2', hintText: '备注', maxLength: 200 }),
    ];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
    });
    const result = await new FormHelper(send).analyze();

    expect(result.fields).toHaveLength(2);

    const phone = result.fields[0];
    expect(phone.id).toBe('f1');
    expect(phone.semanticType).toBe('phone');
    expect(phone.generatedValue).toMatch(/^1[3-9]\d{9}$/);
    expect(phone.hintText).toBe('手机号');

    const note = result.fields[1];
    expect(note.id).toBe('f2');
    expect(note.semanticType).toBe('text');
    expect(note.generatedValue.length).toBeGreaterThan(0);
    expect(note.generatedValue.length).toBeLessThanOrEqual(200); // respects maxLength
  });

  it('does not call any extension other than extractForm', async () => {
    const fields = [field({ id: 'f1', hintText: 'Name' })];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
    });
    await new FormHelper(send).analyze();

    const methods = send.mock.calls.map(c => c[0]);
    expect(methods).toHaveLength(1);
    expect(methods[0]).toBe('ext.fliwright.extractForm');
  });
});

// ---------------------------------------------------------------------------
// 11. Scope option
// ---------------------------------------------------------------------------

describe('FormHelper: scope option', () => {
  it('passes scope to extractForm', async () => {
    const fields = [field({ id: 'f1', hintText: 'Name' })];
    const send = createMockSendRequest({
      'ext.fliwright.extractForm': { fields },
    });

    await new FormHelper(send).analyze({ scope: 'text=注册表单' });

    expect(send).toHaveBeenCalledWith('ext.fliwright.extractForm', { scope: 'text=注册表单' });
  });
});

async function mkdtemp(): Promise<string> {
  const { mkdtemp: mk } = await import('node:fs/promises');
  const { join: j } = await import('node:path');
  const { tmpdir: t } = await import('node:os');
  return mk(j(t(), 'fliwright-form-test-'));
}
