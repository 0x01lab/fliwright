import { describe, it, expect, vi, beforeEach } from 'vitest';
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
        keyboardType: 'visiblePassword',
        obscureText: true,
        enabled: true,
        selector: 'text=请输入密码',
      },
      {
        id: 'w3',
        type: 'TextFormField',
        rect: { x: 20, y: 300, width: 360, height: 48 },
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

    it('calls click and type for each filled field', async () => {
      await helper.fill({ skipObscureFields: true });
      const extractCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.extractForm');
      const clickCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.click');
      const typeCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
      expect(extractCalls).toHaveLength(1);
      expect(clickCalls).toHaveLength(2);
      expect(typeCalls).toHaveLength(2);
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
    });

    it('matches by hintText substring', async () => {
      const result = await helper.fillFields(['邮箱']);
      expect(result.filled).toBe(1);
      const emailField = result.fields.find(f => f.id === 'w3');
      expect(emailField?.status).toBe('filled');
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
