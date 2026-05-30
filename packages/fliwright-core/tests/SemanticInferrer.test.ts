import { describe, it, expect } from 'vitest';
import { SemanticInferrer } from '../src/SemanticInferrer.js';
import type { FormFieldMeta } from '../src/types.js';

describe('SemanticInferrer', () => {
  const inferrer = new SemanticInferrer();

  function makeField(overrides: Partial<FormFieldMeta> = {}): FormFieldMeta {
    return {
      id: 'widget_1',
      type: 'TextFormField',
      rect: { x: 0, y: 0, width: 300, height: 48 },
      obscureText: false,
      enabled: true,
      selector: 'text=field',
      ...overrides,
    };
  }

  it('infers phone from hintText containing 手机', () => {
    const result = inferrer.infer([makeField({ hintText: '请输入手机号' })]);
    expect(result.get('widget_1')).toBe('phone');
  });

  it('infers phone from hintText containing phone', () => {
    const result = inferrer.infer([makeField({ hintText: 'Phone number' })]);
    expect(result.get('widget_1')).toBe('phone');
  });

  it('infers email from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '请输入邮箱地址' })]);
    expect(result.get('widget_1')).toBe('email');
  });

  it('infers email from keyboardType', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'emailAddress' })]);
    expect(result.get('widget_1')).toBe('email');
  });

  it('infers idCard from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '身份证号' })]);
    expect(result.get('widget_1')).toBe('idCard');
  });

  it('infers fullName from hintText containing 姓名', () => {
    const result = inferrer.infer([makeField({ hintText: '真实姓名' })]);
    expect(result.get('widget_1')).toBe('fullName');
  });

  it('infers address from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '收货地址' })]);
    expect(result.get('widget_1')).toBe('address');
  });

  it('infers password from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '请输入密码' })]);
    expect(result.get('widget_1')).toBe('password');
  });

  it('infers password from keyboardType visiblePassword', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'visiblePassword' })]);
    expect(result.get('widget_1')).toBe('password');
  });

  it('infers captcha from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '短信验证码' })]);
    expect(result.get('widget_1')).toBe('captcha');
  });

  it('infers date from hintText containing 日期', () => {
    const result = inferrer.infer([makeField({ hintText: '选择日期' })]);
    expect(result.get('widget_1')).toBe('date');
  });

  it('infers url from keyboardType', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'url' })]);
    expect(result.get('widget_1')).toBe('url');
  });

  it('infers number from keyboardType', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'number' })]);
    expect(result.get('widget_1')).toBe('number');
  });

  it('falls back to text when no pattern matches', () => {
    const result = inferrer.infer([makeField({ hintText: '随便填' })]);
    expect(result.get('widget_1')).toBe('text');
  });

  it('falls back to text when keyboardType is text', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'text' })]);
    expect(result.get('widget_1')).toBe('text');
  });

  it('prioritizes hintText over keyboardType', () => {
    const result = inferrer.infer([makeField({ hintText: '手机号', keyboardType: 'text' })]);
    expect(result.get('widget_1')).toBe('phone');
  });

  it('uses label when hintText is absent', () => {
    const result = inferrer.infer([makeField({ label: '电子邮箱' })]);
    expect(result.get('widget_1')).toBe('email');
  });

  it('infers multiple fields at once', () => {
    const fields = [
      makeField({ id: 'a', hintText: '手机号' }),
      makeField({ id: 'b', hintText: '邮箱' }),
      makeField({ id: 'c', hintText: '备注' }),
    ];
    const result = inferrer.infer(fields);
    expect(result.get('a')).toBe('phone');
    expect(result.get('b')).toBe('email');
    expect(result.get('c')).toBe('text');
  });

  it('handles fields with no hintText, label, or keyboardType', () => {
    const result = inferrer.infer([makeField()]);
    expect(result.get('widget_1')).toBe('text');
  });
});