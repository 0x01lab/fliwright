import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FormHelper } from '../src/FormHelper.js';

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
  'ext.fliwright.inspect': { widgets: [inspectWidget], count: 1 },
  'ext.fliwright.click': { success: true },
  'ext.fliwright.type': { success: true, currentText: '' },
};

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
        const typeCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
        expect(typeCalls).toHaveLength(1);
        expect(typeCalls[0][1]).toMatchObject({ selector: 'name=password', replaceAll: 'true' });
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
          .filter(c => c[0] === 'ext.fliwright.type')
          .map(c => (c[1] as Record<string, unknown>).selector);
        expect(typeSelectors).toContain('name=email');
        expect(typeSelectors).not.toContain('id=w3');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('calls type for each filled field', async () => {
      await helper.fill({ skipObscureFields: true });
      const extractCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.extractForm');
      const clickCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.click');
      const typeCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
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
        if (method === 'ext.fliwright.inspect') {
          if (params?.selector === 'name=employmentStatus') {
            return Promise.resolve({ widgets: [fieldWidget], count: 1 });
          }
          if (params?.selector === 'semanticsId=kyc.personalInfo.employmentStatus.option.employed') {
            return Promise.resolve({ widgets: [optionWidget], count: 1 });
          }
        }
        if (method === 'ext.fliwright.click') {
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
        .filter((call) => call[0] === 'ext.fliwright.inspect')
        .map((call) => (call[1] as Record<string, unknown>).selector);
      expect(inspectSelectors).toEqual([
        'name=employmentStatus',
        'semanticsId=kyc.personalInfo.employmentStatus.option.employed',
      ]);
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
        if (method === 'ext.fliwright.inspect') {
          if (params?.selector === 'text=Yes' && params?.ancestorSelector === 'name=usPerson') {
            return Promise.resolve({ widgets: [optionWidget], count: 1 });
          }
          return Promise.resolve({ widgets: [], count: 0 });
        }
        if (method === 'ext.fliwright.click') {
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
      expect(send).toHaveBeenCalledWith('ext.fliwright.inspect', {
        selector: 'text=Yes',
        ancestorSelector: 'name=usPerson',
      });
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
      const clickCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.click');
      const typeCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
      expect(clickCalls).toHaveLength(0);
      expect(typeCalls).toHaveLength(0);
    });
  });

  describe('fillFields()', () => {
    it('fills only fields matching the given hints', async () => {
      const result = await helper.fillFields(['手机号']);
      expect(result.filled).toBe(1);
      expect(result.skipped).toBe(2);
      const phoneField = result.fields.find(f => f.id === 'w1');
      expect(phoneField?.status).toBe('filled');

      const clickCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.click');
      const typeCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
      expect(clickCalls).toHaveLength(0);
      expect(typeCalls).toHaveLength(1);
      expect(typeCalls[0][1]).toMatchObject({ selector: 'id=w1', replaceAll: 'true' });
    });

    it('matches by hintText substring', async () => {
      const result = await helper.fillFields(['邮箱']);
      expect(result.filled).toBe(1);
      const emailField = result.fields.find(f => f.id === 'w3');
      expect(emailField?.status).toBe('filled');

      const typeCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
      expect(typeCalls).toHaveLength(1);
      expect(typeCalls[0][1]).toMatchObject({ selector: 'name=email', replaceAll: 'true' });
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
        if (method === 'ext.fliwright.type') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(send).fillFields(['jobPosition']);

      expect(result.filled).toBe(1);
      expect(result.skipped).toBe(0);
      const typeCalls = send.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
      expect(typeCalls).toHaveLength(1);
      expect(typeCalls[0][1]).toMatchObject({ selector: 'name=jobPosition', replaceAll: 'true' });
    });
  });

  describe('error handling', () => {
    it('reports error when type extension fails', async () => {
      const errorSend = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve(sampleFields['ext.fliwright.extractForm']);
        }
        if (method === 'ext.fliwright.inspect') {
          return Promise.resolve(sampleFields['ext.fliwright.inspect']);
        }
        if (method === 'ext.fliwright.click') {
          return Promise.resolve({ success: true });
        }
        if (method === 'ext.fliwright.type') {
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
        if (method === 'ext.fliwright.inspect') {
          return Promise.resolve(sampleFields['ext.fliwright.inspect']);
        }
        if (method === 'ext.fliwright.type') {
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
        if (method === 'ext.fliwright.type') {
          if (params?.selector === 'id=w1') {
            return Promise.resolve({ success: false, error: 'No widget found for selector: id=w1' });
          }
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({});
      });

      const result = await new FormHelper(send).fillFields(['手机号']);
      expect(result.filled).toBe(1);
      const typeSelectors = send.mock.calls
        .filter((call) => call[0] === 'ext.fliwright.type')
        .map((call) => (call[1] as Record<string, unknown>).selector);
      expect(typeSelectors).toContain('id=w1');
      expect(typeSelectors).toContain('text=请输入手机号');
    });

    it('reports both primary and fallback errors when both lookups fail', async () => {
      const send = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
        if (method === 'ext.fliwright.extractForm') {
          return Promise.resolve(sampleFields['ext.fliwright.extractForm']);
        }
        if (method === 'ext.fliwright.type') {
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
