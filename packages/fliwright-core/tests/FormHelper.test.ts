import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiRuntime, FormHelper, MockAiAdapter } from '../src/index.js';

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (responses[method] !== undefined) return Promise.resolve(responses[method]);
    return Promise.resolve({});
  });
}

const inspectWidget = {
  id: 'w1',
  type: 'TextFormField',
  rect: { x: 20, y: 100, width: 360, height: 48 },
  properties: {},
};

const sampleFields = {
  'ext.fliwright.extractForm': {
    fields: [
      {
        id: 'w1',
        type: 'TextFormField',
        rect: { x: 20, y: 100, width: 360, height: 48 },
        hintText: '请输入手机号',
        keyboardType: 'phone',
        maxLength: 11,
        obscureText: false,
        enabled: true,
        selector: 'text=请输入手机号',
      },
      {
        id: 'w2',
        type: 'TextFormField',
        rect: { x: 20, y: 200, width: 360, height: 48 },
        hintText: '请输入密码',
        label: 'Login password',
        name: 'password',
        keyboardType: 'visiblePassword',
        obscureText: true,
        enabled: true,
        selector: 'text=请输入密码',
      },
      {
        id: 'w3',
        type: 'TextFormField',
        rect: { x: 20, y: 300, width: 360, height: 48 },
        name: 'email',
        ancestorKey: 'loginForm',
        hintText: '邮箱地址',
        keyboardType: 'emailAddress',
        obscureText: false,
        enabled: true,
        selector: 'text=邮箱地址',
      },
    ],
    count: 3,
  },
  'ext.fliwright.resolve': { matches: [inspectWidget], widgets: [inspectWidget], count: 1 },
  'ext.fliwright.action': { success: true, currentText: '' },
};

function fillCalls(sendRequest: ReturnType<typeof createMockSendRequest>) {
  return sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.action' && (c[1] as any).action === 'fill');
}

function tapCalls(sendRequest: ReturnType<typeof createMockSendRequest>) {
  return sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.action' && (c[1] as any).action === 'tap');
}

function selectorAst(params: unknown) {
  return JSON.parse((params as Record<string, string>).selector);
}

describe('FormHelper', () => {
  let sendRequest: ReturnType<typeof createMockSendRequest>;
  let helper: FormHelper;

  beforeEach(() => {
    sendRequest = createMockSendRequest(sampleFields);
    helper = new FormHelper(sendRequest);
  });

  describe('fill()', () => {
    it('extracts fields, generates data, and types into each non-obscure field', async () => {
      const result = await helper.fill({ skipObscureFields: true });
      expect(result.filled).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.fields).toHaveLength(3);

      const phoneField = result.fields.find(f => f.id === 'w1');
      expect(phoneField?.semanticType).toBe('phone');
      expect(phoneField?.status).toBe('filled');
      expect(phoneField?.generatedValue).toMatch(/^1[3-9]\d{9}$/);

      const emailField = result.fields.find(f => f.id === 'w3');
      expect(emailField?.semanticType).toBe('email');
      expect(emailField?.status).toBe('filled');
      expect(emailField?.generatedValue).toContain('@');

      const passField = result.fields.find(f => f.id === 'w2');
      expect(passField?.status).toBe('skipped');
    });

    it('fills obscure fields when skipObscureFields is false', async () => {
      const result = await helper.fill({ skipObscureFields: false });
      expect(result.filled).toBe(3);
    });

    it('skips unmatched fields when requireRuleMatch is true', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { label: '邮箱' },
            type: 'PRESET_SKILL',
            data: ['test.user@example.com'],
          }],
        }));

        const result = await helper.fill({ rulesFile, requireRuleMatch: true });
        expect(result.filled).toBe(0);
        expect(result.skipped).toBe(3);
        expect(result.fields.find(f => f.id === 'w1')?.reason).toBe('no matching form rule');
        expect(result.fields.find(f => f.id === 'w3')?.reason).toBe('no matching form rule');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('uses matching rule values when requireRuleMatch is true', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { hintText: '邮箱地址' },
            type: 'PRESET_SKILL',
            data: ['test.user@example.com'],
          }],
        }));

        const result = await helper.fill({ rulesFile, requireRuleMatch: true });
        expect(result.filled).toBe(1);
        expect(result.skipped).toBe(2);
        expect(result.fields.find(f => f.id === 'w3')?.generatedValue).toBe('test.user@example.com');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('fills matched obscure fields from explicit rules', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'password' },
            type: 'PRESET_SKILL',
            data: ['Password123!'],
          }],
        }));

        const result = await helper.fill({ rulesFile, requireRuleMatch: true, skipObscureFields: true });
        expect(result.filled).toBe(1);
        expect(result.skipped).toBe(2);
        expect(result.fields.find(f => f.id === 'w2')).toMatchObject({
          semanticType: 'password',
          status: 'filled',
          generatedValue: 'Password123!',
        });
        const typeCalls = fillCalls(sendRequest);
        expect(typeCalls).toHaveLength(1);
        expect(selectorAst(typeCalls[0][1])).toEqual({ match: { name: 'password' } });
        expect(typeCalls[0][1]).toMatchObject({ replaceAll: 'true' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('fills fields from named formData scenarios with explicit dataKey rules', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      sendRequest = createMockSendRequest({
        ...sampleFields,
        'ext.fliwright.extractForm': {
          fields: [
            {
              id: 'username-field',
              type: 'TextFormField',
              semanticsId: 'login.username',
              selector: JSON.stringify({ match: { semanticIdentifier: 'login.username' } }),
              obscureText: false,
              enabled: true,
            },
            {
              id: 'password-field',
              type: 'TextFormField',
              semanticsId: 'login.password',
              selector: JSON.stringify({ match: { semanticIdentifier: 'login.password' } }),
              obscureText: true,
              enabled: true,
            },
          ],
          count: 2,
        },
      });
      helper = new FormHelper(sendRequest);
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          formData: [
            {
              name: 'default login',
              values: {
                username: 'user@example.com',
                password: 'Password123!',
              },
            },
            {
              name: 'alternate login',
              values: {
                username: 'alt@example.com',
                password: 'Alternate123!',
              },
            },
          ],
          rules: [
            {
              find: { match: { semanticIdentifier: 'login.username' } },
              type: 'PRESET_SKILL',
              dataKey: 'username',
            },
            {
              find: { match: { semanticIdentifier: 'login.password' } },
              type: 'PRESET_SKILL',
              dataKey: 'password',
            },
          ],
        }));

        const result = await helper.fill({
          rulesFile,
          dataIndex: 1,
          requireRuleMatch: true,
          skipObscureFields: true,
        });

        expect(result.filled).toBe(2);
        expect(result.skipped).toBe(0);
        expect(result.fields.find(f => f.id === 'username-field')?.generatedValue).toBe('alt@example.com');
        expect(result.fields.find(f => f.id === 'password-field')?.generatedValue).toBe('Alternate123!');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('fills selected fields from named formData scenarios using stable field hints', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      sendRequest = createMockSendRequest({
        ...sampleFields,
        'ext.fliwright.extractForm': {
          fields: [
            {
              id: 'username-field',
              type: 'TextFormField',
              semanticsId: 'login.username',
              selector: JSON.stringify({ match: { semanticIdentifier: 'login.username' } }),
              obscureText: false,
              enabled: true,
            },
            {
              id: 'password-field',
              type: 'TextFormField',
              semanticsId: 'login.password',
              selector: JSON.stringify({ match: { semanticIdentifier: 'login.password' } }),
              obscureText: true,
              enabled: true,
            },
          ],
          count: 2,
        },
      });
      helper = new FormHelper(sendRequest);
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          formData: [
            {
              name: 'default login',
              values: {
                username: 'user@example.com',
                password: 'Password123!',
              },
            },
          ],
          rules: [
            {
              find: { match: { semanticIdentifier: 'login.username' } },
              type: 'PRESET_SKILL',
              dataKey: 'username',
            },
            {
              find: { match: { semanticIdentifier: 'login.password' } },
              type: 'PRESET_SKILL',
              dataKey: 'password',
            },
          ],
        }));

        const result = await helper.fillFields(
          [
            JSON.stringify({ match: { semanticIdentifier: 'login.username' } }),
            JSON.stringify({ match: { semanticIdentifier: 'login.password' } }),
          ],
          {
            rulesFile,
            requireRuleMatch: true,
            skipObscureFields: true,
          },
        );

        expect(result.filled).toBe(2);
        expect(result.skipped).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('matches rules by stable field name and fills using name selector first', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'email' },
            type: 'PRESET_SKILL',
            data: ['stable@example.com'],
          }],
        }));

        const result = await helper.fill({ rulesFile, requireRuleMatch: true });
        expect(result.filled).toBe(1);
        expect(result.fields.find(f => f.id === 'w3')).toMatchObject({
          generatedValue: 'stable@example.com',
          name: 'email',
          ancestorKey: 'loginForm',
        });
        const typeSelectors = sendRequest.mock.calls
          .filter(c => c[0] === 'ext.fliwright.action' && (c[1] as any).action === 'fill')
          .map(c => selectorAst(c[1]));
        expect(typeSelectors).toContainEqual({ match: { name: 'email' } });
        expect(typeSelectors).not.toContainEqual({ kind: 'id', value: 'w3' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('fills fields from regex data DSL entries', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { hintText: '邮箱地址' },
            type: 'PRESET_SKILL',
            data: ['regex:qa[0-9]{4}@example\\.com'],
          }],
        }));

        const result = await helper.fill({ rulesFile, requireRuleMatch: true });
        expect(result.filled).toBe(1);
        expect(result.fields.find(f => f.id === 'w3')?.generatedValue).toMatch(/^qa\d{4}@example\.com$/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('fills fields from AI prompt data DSL entries', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      const adapter = new MockAiAdapter((request) => {
        expect(request.prompt).toContain('Generate a QA email address');
        expect(request.prompt).toContain('"hintText":"邮箱地址"');
        return { text: '{"value":"ai.user@example.com"}', json: { value: 'ai.user@example.com' } };
      });
      const aiRuntime = new AiRuntime({ adapter });
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { hintText: '邮箱地址' },
            type: 'LLM_GENERATE',
            data: [{ prompt: 'Generate a QA email address' }],
          }],
        }));

        const result = await helper.fill({ rulesFile, requireRuleMatch: true, aiRuntime });
        expect(result.filled).toBe(1);
        expect(result.fields.find(f => f.id === 'w3')?.generatedValue).toBe('ai.user@example.com');
        expect(fillCalls(sendRequest)[0][1]).toMatchObject({ text: 'ai.user@example.com' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('uses AI data DSL fallback when no runtime is provided', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { hintText: '邮箱地址' },
            type: 'LLM_GENERATE',
            data: [{ prompt: 'Generate a QA email address', fallback: 'fallback@example.com' }],
          }],
        }));

        const result = await helper.analyze({ rulesFile, requireRuleMatch: true });
        expect(result.fields.find(f => f.id === 'w3')?.generatedValue).toBe('fallback@example.com');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('calls type for each filled field', async () => {
      await helper.fill({ skipObscureFields: true });
      const extractCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.extractForm');
      const clickCalls = tapCalls(sendRequest);
      const typeCalls = fillCalls(sendRequest);
      expect(extractCalls).toHaveLength(1);
      expect(clickCalls).toHaveLength(0);
      expect(typeCalls).toHaveLength(2);
      expect(typeCalls.every((call) => (call[1] as Record<string, unknown>).replaceAll === 'true')).toBe(true);
    });

    it('opens composite select fields and clicks the selected bottom sheet option', async () => {
      const selectField = {
        id: 'select1',
        type: 'FormBuilderField<String>',
        controlType: 'select',
        rect: { x: 20, y: 100, width: 360, height: 48 },
        name: 'employmentStatus',
        label: 'Employment status',
        obscureText: false,
        enabled: true,
        selector: 'name=employmentStatus',
        options: [
          {
            label: 'Employed',
            value: 'employed',
            semanticsId: 'kyc.personalInfo.employmentStatus.option.employed',
          },
          { label: 'Retired', value: 'retired' },
        ],
      };
      const fieldWidget = {
        id: 'select1',
        type: 'FormBuilderField<String>',
        rect: { x: 20, y: 100, width: 360, height: 48 },
        properties: {},
      };
      const optionWidget = {
        id: 'option1',
        type: 'Semantics',
        text: 'Employed',
        rect: { x: 20, y: 500, width: 360, height: 48 },
        properties: {},
      };
      const send = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve({ fields: [selectField], count: 1 });
        }
        if (method === 'ext.fliwright.action') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(send).fill();
      expect(result.filled).toBe(1);
      expect(result.fields[0]).toMatchObject({
        controlType: 'select',
        semanticType: 'option',
        generatedValue: 'employed',
        status: 'filled',
      });
      const inspectSelectors = send.mock.calls
        .filter((call) => call[0] === 'ext.fliwright.action')
        .map((call) => selectorAst(call[1]));
      expect(inspectSelectors).toEqual([
        { match: { name: 'employmentStatus' } },
        { match: { semanticIdentifier: 'kyc.personalInfo.employmentStatus.option.employed' } },
      ]);
    });

    it('runs form action scripts for select rules', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'employmentStatus' },
            find: { match: { semanticIdentifier: 'kyc.personalInfo.employmentStatus.select' } },
            type: 'PRESET_SKILL',
            data: ['FULL_TIME'],
            action: {
              script: 'select.byOptionSemantics',
              args: {
                open: { match: { semanticIdentifier: 'kyc.personalInfo.employmentStatus.select' } },
                optionSemanticId: 'kyc.personalInfo.employmentStatus.option.${value}',
              },
            },
          }],
        }));
        const selectField = {
          id: 'select1',
          type: 'FormBuilderField<String>',
          controlType: 'select',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'employmentStatus',
          semanticsId: 'kyc.personalInfo.employmentStatus.select',
          label: 'Employment status',
          obscureText: false,
          enabled: true,
          selector: 'name=employmentStatus',
          options: [
            {
              label: 'Employed',
              value: 'FULL_TIME',
              semanticsId: 'kyc.personalInfo.employmentStatus.option.FULL_TIME',
            },
          ],
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [selectField], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        });

        const result = await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(result.filled, JSON.stringify(result.errors)).toBe(1);
        const tapSelectors = tapCalls(send as ReturnType<typeof createMockSendRequest>).map((call) => selectorAst(call[1]));
        expect(tapSelectors).toEqual([
          { match: { semanticIdentifier: 'kyc.personalInfo.employmentStatus.select' } },
          { match: { semanticIdentifier: 'kyc.personalInfo.employmentStatus.option.FULL_TIME' } },
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('runs reusable select recipes from form rules', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'resAddrCountry' },
            find: { match: { semanticIdentifier: 'kyc.personalInfo.resAddrCountry.select' } },
            type: 'PRESET_SKILL',
            data: ['HK'],
            action: {
              script: 'select.recipe',
              args: {
                recipe: 'countryPicker',
                search: { match: { key: 'kyc.countrySelect.searchField', type: 'EditableText' } },
                searchText: 'Hong Kong',
                optionSemanticsId: 'kyc.personalInfo.resAddrCountry.option.${value}',
              },
            },
          }],
        }));
        const selectField = {
          id: 'country1',
          type: 'FormBuilderField<String>',
          controlType: 'select',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'resAddrCountry',
          semanticsId: 'kyc.personalInfo.resAddrCountry.select',
          label: 'Place of residence',
          obscureText: false,
          enabled: true,
          selector: 'name=resAddrCountry',
          options: [
            { label: 'Hong Kong', value: 'HK', semanticsId: 'kyc.personalInfo.resAddrCountry.option.HK' },
          ],
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [selectField], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: true });
          }
          if (method === 'ext.fliwright.resolve') {
            return Promise.resolve({ matches: [], widgets: [], count: 0 });
          }
          if (method === 'ext.fliwright.settle') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        });

        const result = await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(result.filled).toBe(1);
        const actions = send.mock.calls
          .filter((call) => call[0] === 'ext.fliwright.action')
          .map((call) => call[1] as Record<string, unknown>);
        expect(actions.map((action) => action.action)).toEqual(['tap', 'fill', 'tap']);
        expect(selectorAst(actions[0])).toEqual({ match: { semanticIdentifier: 'kyc.personalInfo.resAddrCountry.select' } });
        expect(actions[0]).not.toHaveProperty('waitForAnimations');
        expect(selectorAst(actions[1])).toEqual({ match: { key: 'kyc.countrySelect.searchField', type: 'EditableText' } });
        expect(actions[1]).toMatchObject({ text: 'Hong Kong', replaceAll: 'true' });
        expect(selectorAst(actions[2])).toEqual({ match: { semanticIdentifier: 'kyc.personalInfo.resAddrCountry.option.HK' } });
        expect(actions[2]).not.toHaveProperty('waitForAnimations');
        expect(send).toHaveBeenCalledWith('ext.fliwright.settle', {
          timeout: '500',
          stableFrames: '2',
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('runs tap action scripts for custom checkbox and radio rows', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'relatedParticipantYes' },
            type: 'PRESET_SKILL',
            data: ['No'],
            action: {
              script: 'tap.bySelector',
              args: { target: { match: { key: 'kyc.personalInfo.relatedParticipant.noRadio' } } },
            },
          }],
        }));
        const field = {
          id: 'radio1',
          type: 'FormBuilderField<bool>',
          controlType: 'radio',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'relatedParticipantYes',
          label: 'SFC associated',
          obscureText: false,
          enabled: true,
          selector: 'name=relatedParticipantYes',
          options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }],
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [field], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        });

        const result = await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(result.filled).toBe(1);
        const tapSelectors = tapCalls(send as ReturnType<typeof createMockSendRequest>).map((call) => selectorAst(call[1]));
        expect(tapSelectors).toEqual([{ match: { key: 'kyc.personalInfo.relatedParticipant.noRadio' } }]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('uses setCheckbox when a single checkbox rule requests false', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'marketingOptIn' },
            type: 'PRESET_SKILL',
            data: ['false'],
          }],
        }));
        const field = {
          id: 'checkbox1',
          type: 'FliwrightFormControl',
          controlType: 'checkbox',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'marketingOptIn',
          semanticsId: 'settings.marketingOptIn',
          value: true,
          label: 'Marketing opt-in',
          obscureText: false,
          enabled: true,
          selector: 'semanticsId=settings.marketingOptIn',
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [field], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        });

        const result = await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(result.filled, JSON.stringify(result.errors)).toBe(1);
        const checkboxCalls = send.mock.calls
          .filter((call) => call[0] === 'ext.fliwright.action' && (call[1] as any).action === 'setCheckbox')
          .map((call) => call[1] as Record<string, unknown>);
        expect(checkboxCalls).toHaveLength(1);
        expect(checkboxCalls[0]).toMatchObject({ checked: 'false' });
        expect(selectorAst(checkboxCalls[0])).toEqual({
          match: { semanticIdentifier: 'settings.marketingOptIn' },
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('scopes text tap action scripts to a specific form field', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'usPerson' },
            type: 'PRESET_SKILL',
            data: ['Non-US person'],
            action: {
              script: 'tap.byText',
              args: {
                optionText: 'No',
                within: { match: { name: 'usPerson' } },
              },
            },
          }],
        }));
        const field = {
          id: 'fatca-radio',
          type: 'FormBuilderField<bool>',
          controlType: 'radio',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'usPerson',
          label: 'FATCA',
          obscureText: false,
          enabled: true,
          selector: 'name=usPerson',
          options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }],
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [field], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        });

        const result = await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(result.filled).toBe(1);
        const tapSelectors = tapCalls(send as ReturnType<typeof createMockSendRequest>).map((call) => selectorAst(call[1]));
        expect(tapSelectors).toEqual([{
          match: { text: 'No' },
          within: { match: { name: 'usPerson' } },
        }]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('uses short timeouts for form action script taps', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'usPerson' },
            type: 'PRESET_SKILL',
            data: ['Non-US person'],
            action: {
              script: 'tap.byText',
              args: {
                optionText: 'No',
                within: { match: { name: 'usPerson' } },
              },
            },
          }],
        }));
        const field = {
          id: 'fatca-radio',
          type: 'FormBuilderField<bool>',
          controlType: 'radio',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'usPerson',
          label: 'FATCA',
          obscureText: false,
          enabled: true,
          selector: 'name=usPerson',
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [field], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        });

        await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(tapCalls(send as ReturnType<typeof createMockSendRequest>)[0][1]).toMatchObject({
          timeout: '1500',
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('does not retry action scripts with fallback selectors after action failure', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'employmentStatus' },
            find: { match: { semanticIdentifier: 'kyc.personalInfo.employmentStatus.select' } },
            type: 'PRESET_SKILL',
            data: ['FULL_TIME'],
            action: {
              script: 'select.byOptionSemantics',
              args: {
                open: { match: { semanticIdentifier: 'kyc.personalInfo.employmentStatus.select' } },
                optionSemanticId: 'kyc.personalInfo.employmentStatus.option.${value}',
              },
            },
          }],
        }));
        const field = {
          id: 'select1',
          type: 'FormBuilderField<String>',
          controlType: 'select',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'employmentStatus',
          semanticsId: 'kyc.personalInfo.employmentStatus.select',
          label: 'Employment status',
          obscureText: false,
          enabled: true,
          selector: 'name=employmentStatus',
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [field], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: false, error: 'not found' });
          }
          return Promise.resolve({});
        });

        const result = await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(result.filled).toBe(0);
        expect(result.errors[0].error).toContain('Form action select.byOptionSemantics failed');
        expect(tapCalls(send as ReturnType<typeof createMockSendRequest>)).toHaveLength(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('runs checkbox ensure action scripts without toggling an already selected value', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'sameAsResidentialAddress' },
            type: 'PRESET_SKILL',
            data: ['true'],
            action: {
              script: 'checkbox.ensure',
              args: { target: { match: { key: 'kyc.personalInfo.sameAddressCheckbox' } } },
            },
          }],
        }));
        const field = {
          id: 'same-address-checkbox',
          type: 'FormBuilderField<bool>',
          controlType: 'checkbox',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'sameAsResidentialAddress',
          key: 'kyc.personalInfo.sameAddressCheckbox',
          value: true,
          label: 'Same as residential address',
          obscureText: false,
          enabled: true,
          selector: 'key=kyc.personalInfo.sameAddressCheckbox',
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [field], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        });

        const result = await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(result.filled).toBe(1);
        expect(tapCalls(send as ReturnType<typeof createMockSendRequest>)).toHaveLength(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('runs multi-select action scripts and confirms the sheet', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'sofJurisdictions' },
            find: { match: { semanticIdentifier: 'kyc.personalInfo.sofJurisdictions.select' } },
            type: 'PRESET_SKILL',
            data: ['HK,US'],
            action: {
              script: 'multiSelect.byOptionSemantics',
              args: {
                optionSemanticId: 'kyc.personalInfo.sofJurisdictions.option.${value}',
                done: { match: { text: 'Done' } },
              },
            },
          }],
        }));
        const multiField = {
          id: 'multi1',
          type: 'FormBuilderField<List<String>>',
          controlType: 'select',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'sofJurisdictions',
          semanticsId: 'kyc.personalInfo.sofJurisdictions.select',
          label: 'Origin of source of funds',
          obscureText: false,
          enabled: true,
          selector: 'name=sofJurisdictions',
          options: [
            { label: 'Hong Kong', value: 'HK', semanticsId: 'kyc.personalInfo.sofJurisdictions.option.HK' },
            { label: 'United States', value: 'US', semanticsId: 'kyc.personalInfo.sofJurisdictions.option.US' },
          ],
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [multiField], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        });

        const result = await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(result.filled).toBe(1);
        const tapSelectors = tapCalls(send as ReturnType<typeof createMockSendRequest>).map((call) => selectorAst(call[1]));
        expect(tapSelectors).toEqual([
          { match: { semanticIdentifier: 'kyc.personalInfo.sofJurisdictions.select' } },
          { match: { semanticIdentifier: 'kyc.personalInfo.sofJurisdictions.option.HK' } },
          { match: { semanticIdentifier: 'kyc.personalInfo.sofJurisdictions.option.US' } },
          { match: { text: 'Done' } },
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('runs multi-select action scripts from array fixed data DSL entries', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fliwright-rules-'));
      const rulesFile = join(dir, 'rules.json');
      try {
        writeFileSync(rulesFile, JSON.stringify({
          version: 1,
          rules: [{
            match: { name: 'sofJurisdictions' },
            find: { match: { semanticIdentifier: 'kyc.personalInfo.sofJurisdictions.select' } },
            type: 'PRESET_SKILL',
            data: [{ fixed: ['HK', 'US'] }],
            action: {
              script: 'multiSelect.byOptionSemantics',
              args: {
                optionSemanticId: 'kyc.personalInfo.sofJurisdictions.option.${value}',
              },
            },
          }],
        }));
        const multiField = {
          id: 'multi1',
          type: 'FormBuilderField<List<String>>',
          controlType: 'select',
          rect: { x: 20, y: 100, width: 360, height: 48 },
          name: 'sofJurisdictions',
          semanticsId: 'kyc.personalInfo.sofJurisdictions.select',
          label: 'Origin of source of funds',
          obscureText: false,
          enabled: true,
          selector: 'name=sofJurisdictions',
          options: [
            { label: 'Hong Kong', value: 'HK', semanticsId: 'kyc.personalInfo.sofJurisdictions.option.HK' },
            { label: 'United States', value: 'US', semanticsId: 'kyc.personalInfo.sofJurisdictions.option.US' },
          ],
        };
        const send = vi.fn().mockImplementation((method: string) => {
          if (method === 'ext.fliwright.extractForm') {
            return Promise.resolve({ fields: [multiField], count: 1 });
          }
          if (method === 'ext.fliwright.action') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        });

        const result = await new FormHelper(send).fill({ rulesFile, requireRuleMatch: true });

        expect(result.filled).toBe(1);
        const tapSelectors = tapCalls(send as ReturnType<typeof createMockSendRequest>).map((call) => selectorAst(call[1]));
        expect(tapSelectors).toEqual([
          { match: { semanticIdentifier: 'kyc.personalInfo.sofJurisdictions.select' } },
          { match: { semanticIdentifier: 'kyc.personalInfo.sofJurisdictions.option.HK' } },
          { match: { semanticIdentifier: 'kyc.personalInfo.sofJurisdictions.option.US' } },
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('clicks inline radio options within the field scope', async () => {
      const radioField = {
        id: 'radio1',
        type: 'FormBuilderField<bool>',
        controlType: 'radio',
        rect: { x: 20, y: 100, width: 360, height: 48 },
        name: 'usPerson',
        label: 'US person',
        obscureText: false,
        enabled: true,
        selector: 'name=usPerson',
        options: [
          { label: 'Yes', value: 'true' },
          { label: 'No', value: 'false' },
        ],
      };
      const optionWidget = {
        id: 'radio-option',
        type: 'Text',
        text: 'Yes',
        rect: { x: 20, y: 100, width: 120, height: 48 },
        properties: {},
      };
      const send = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve({ fields: [radioField], count: 1 });
        }
        if (method === 'ext.fliwright.action') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(send).fill();
      expect(result.filled).toBe(1);
      expect(result.fields[0]).toMatchObject({
        controlType: 'radio',
        generatedValue: 'true',
        status: 'filled',
      });
      expect(send).toHaveBeenCalledWith('ext.fliwright.action', expect.objectContaining({
        action: 'tap',
        selector: JSON.stringify({
          match: { text: 'Yes' },
          within: { match: { name: 'usPerson' } },
        }),
      }));
    });

    it('scopes extraction when scope option is provided', async () => {
      await helper.fill({ scope: 'text=注册表单' });
      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.extractForm', { scope: 'text=注册表单' });
    });
  });

  describe('analyze()', () => {
    it('returns field analysis without filling', async () => {
      const result = await helper.analyze();
      expect(result.fields).toHaveLength(3);
      expect(result.fields[0].semanticType).toBe('phone');
      expect(result.fields[0].hintText).toBe('请输入手机号');
      const clickCalls = tapCalls(sendRequest);
      const typeCalls = fillCalls(sendRequest);
      expect(clickCalls).toHaveLength(0);
      expect(typeCalls).toHaveLength(0);
    });

    it('preserves precise extracted metadata for field count, selector, key, labels, and controls', async () => {
      const metadataSend = vi.fn().mockImplementation((method: string) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve({
            fields: [
              {
                id: 'email-field',
                type: 'TextFormField',
                rect: { x: 20, y: 100, width: 360, height: 48 },
                hintText: '邮箱地址',
                label: '邮箱',
                key: 'emailInput',
                keyboardType: 'emailAddress',
                controlType: 'textInput',
                obscureText: false,
                enabled: true,
                selector: 'key=emailInput',
              },
              {
                id: 'country-field',
                type: 'FormBuilderField<String>',
                rect: { x: 20, y: 200, width: 360, height: 48 },
                label: '国家',
                name: 'country',
                controlType: 'select',
                obscureText: false,
                enabled: true,
                selector: 'name=country',
                options: [{ label: '中国', value: 'CN' }],
              },
            ],
            count: 2,
          });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(metadataSend).analyze();

      expect(result.fields).toHaveLength(2);
      expect(result.fields[0]).toMatchObject({
        id: 'email-field',
        semanticType: 'email',
        selector: 'key=emailInput',
        key: 'emailInput',
        hintText: '邮箱地址',
        label: '邮箱',
        controlType: 'textInput',
      });
      expect(result.fields[1]).toMatchObject({
        id: 'country-field',
        semanticType: 'option',
        selector: 'name=country',
        label: '国家',
        controlType: 'select',
        options: [{ label: '中国', value: 'CN' }],
      });
    });
  });

  describe('fillFields()', () => {
    it('fills only fields matching the given hints', async () => {
      const result = await helper.fillFields(['手机号']);
      expect(result.filled).toBe(1);
      expect(result.skipped).toBe(2);
      const phoneField = result.fields.find(f => f.id === 'w1');
      expect(phoneField?.status).toBe('filled');

      const clickCalls = tapCalls(sendRequest);
      const typeCalls = fillCalls(sendRequest);
      expect(clickCalls).toHaveLength(0);
      expect(typeCalls).toHaveLength(1);
      expect(selectorAst(typeCalls[0][1])).toEqual({ match: { id: 'w1' } });
      expect(typeCalls[0][1]).toMatchObject({ replaceAll: 'true' });
    });

    it('matches by hintText substring', async () => {
      const result = await helper.fillFields(['邮箱']);
      expect(result.filled).toBe(1);
      const emailField = result.fields.find(f => f.id === 'w3');
      expect(emailField?.status).toBe('filled');

      const typeCalls = fillCalls(sendRequest);
      expect(typeCalls).toHaveLength(1);
      expect(selectorAst(typeCalls[0][1])).toEqual({ match: { name: 'email' } });
      expect(typeCalls[0][1]).toMatchObject({ replaceAll: 'true' });
    });

    it('prefers exact field hint matches over substring collisions', async () => {
      const collisionSend = vi.fn().mockImplementation((method: string) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve({
            fields: [
              {
                id: 'email',
                type: 'TextFormField',
                rect: { x: 20, y: 100, width: 360, height: 48 },
                hintText: '邮箱地址',
                obscureText: false,
                enabled: true,
                selector: 'text=邮箱地址',
              },
              {
                id: 'address',
                type: 'TextFormField',
                rect: { x: 20, y: 200, width: 360, height: 48 },
                hintText: '地址',
                obscureText: false,
                enabled: true,
                selector: 'text=地址',
              },
            ],
            count: 2,
          });
        }
        if (method === 'ext.fliwright.action') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(collisionSend).fillFields(['地址']);

      expect(result.filled).toBe(1);
      expect(result.fields.find(f => f.id === 'address')?.status).toBe('filled');
      expect(result.fields.find(f => f.id === 'email')?.status).toBe('skipped');
      const typeCalls = fillCalls(collisionSend as ReturnType<typeof createMockSendRequest>);
      expect(typeCalls).toHaveLength(1);
      expect(selectorAst(typeCalls[0][1])).toEqual({ match: { id: 'address' } });
    });

    it('matches selected fields by stable name when label and hint are absent', async () => {
      const send = vi.fn().mockImplementation((method: string) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve({
            fields: [
              {
                id: 'position',
                type: 'EditableText',
                rect: { x: 20, y: 100, width: 360, height: 48 },
                name: 'jobPosition',
                obscureText: false,
                enabled: true,
                selector: 'name=jobPosition',
              },
            ],
            count: 1,
          });
        }
        if (method === 'ext.fliwright.action') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(send).fillFields(['jobPosition']);

      expect(result.filled).toBe(1);
      expect(result.skipped).toBe(0);
      const typeCalls = send.mock.calls.filter(c => c[0] === 'ext.fliwright.action' && (c[1] as any).action === 'fill');
      expect(typeCalls).toHaveLength(1);
      expect(selectorAst(typeCalls[0][1])).toEqual({ match: { name: 'jobPosition' } });
      expect(typeCalls[0][1]).toMatchObject({ replaceAll: 'true' });
    });
  });

  describe('error handling', () => {
    it('reports error when type extension fails', async () => {
      const errorSend = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve(sampleFields['ext.fliwright.extractForm']);
        }
        if (method === 'ext.fliwright.action') {
          return Promise.reject(new Error('No focused EditableText'));
        }
        return Promise.resolve({});
      });
      const errorHelper = new FormHelper(errorSend);
      const result = await errorHelper.fill({ skipObscureFields: true });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.fields.some(f => f.status === 'error')).toBe(true);
    });

    it('reports error when type extension returns success false', async () => {
      const errorSend = vi.fn().mockImplementation((method: string) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve(sampleFields['ext.fliwright.extractForm']);
        }
        if (method === 'ext.fliwright.action') {
          return Promise.resolve({ success: false, error: 'No focused EditableText found after click' });
        }
        return Promise.resolve({});
      });
      const errorHelper = new FormHelper(errorSend);
      const result = await errorHelper.fill({ skipObscureFields: true });
      expect(result.filled).toBe(0);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].error).toContain('No focused EditableText');
      expect(result.fields.every(f => f.status !== 'filled')).toBe(true);
    });

    it('falls back to the extracted selector when id lookup fails', async () => {
      const send = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve(sampleFields['ext.fliwright.extractForm']);
        }
        if (method === 'ext.fliwright.action') {
          if ((params?.selector as string).includes('"id":"w1"')) {
            return Promise.resolve({ success: false, error: 'No widget found for selector: id=w1' });
          }
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(send).fillFields(['手机号']);
      expect(result.filled).toBe(1);
      const typeSelectors = send.mock.calls
        .filter((call) => call[0] === 'ext.fliwright.action')
        .map((call) => selectorAst(call[1]));
      expect(typeSelectors).toContainEqual({ match: { id: 'w1' } });
      expect(typeSelectors).toContainEqual({ match: { text: '请输入手机号' } });
    });

    it('uses legacy type with extracted selector when action fill cannot resolve the field', async () => {
      const fields = [{
        id: 'login-username',
        type: 'TextField',
        rect: { x: 16, y: 214, width: 408, height: 48 },
        controlType: 'textInput',
        name: 'username',
        semanticsId: 'login.username',
        hintText: 'Username / Email',
        obscureText: false,
        enabled: true,
        selector: '{"match":{"semanticIdentifier":"login.username"}}',
      }];
      const send = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve({ fields, count: fields.length });
        }
        if (method === 'ext.fliwright.action') {
          return Promise.resolve({ success: false, error: 'No widget found matching selector' });
        }
        if (method === 'ext.fliwright.type') {
          expect(params).toMatchObject({
            selector: fields[0].selector,
            replaceAll: 'true',
          });
          return Promise.resolve({ success: true, currentText: params?.text });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(send).fillFields(['Username / Email']);
      expect(result.filled).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(send.mock.calls.some((call) => call[0] === 'ext.fliwright.type')).toBe(true);
    });

    it('reports both primary and fallback errors when both lookups fail', async () => {
      const send = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve(sampleFields['ext.fliwright.extractForm']);
        }
        if (method === 'ext.fliwright.action') {
          return Promise.resolve({ success: false, error: `No widget found for selector: ${params?.selector}` });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(send).fillFields(['手机号']);
      expect(result.filled).toBe(0);
      expect(result.errors[0].error).toContain('primary=id=w1');
      expect(result.errors[0].error).toContain('fallback=text=请输入手机号');
    });

    it('handles empty form gracefully', async () => {
      const emptySend = createMockSendRequest({
        'ext.fliwright.extractForm': { fields: [], count: 0 },
      });
      const emptyHelper = new FormHelper(emptySend);
      const result = await emptyHelper.fill();
      expect(result.filled).toBe(0);
      expect(result.fields).toHaveLength(0);
    });
  });
});
