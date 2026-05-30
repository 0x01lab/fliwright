import { describe, it, expect } from 'vitest';
import { FakerGenerator } from '../src/FakerGenerator.js';

describe('FakerGenerator', () => {
  const generator = new FakerGenerator();

  it('generates a phone number for zh_CN locale', () => {
    const value = generator.generate('phone');
    expect(value).toMatch(/^1[3-9]\d{9}$/);
  });

  it('generates an email address', () => {
    const value = generator.generate('email');
    expect(value).toContain('@');
  });

  it('generates a Chinese ID card number', () => {
    const value = generator.generate('idCard');
    expect(value).toMatch(/^\d{17}[\dXx]$/);
  });

  it('generates a full name', () => {
    const value = generator.generate('fullName');
    expect(value.length).toBeGreaterThan(0);
  });

  it('generates an address', () => {
    const value = generator.generate('address');
    expect(value.length).toBeGreaterThan(0);
  });

  it('generates a password with mixed characters', () => {
    const value = generator.generate('password');
    expect(value.length).toBeGreaterThanOrEqual(8);
  });

  it('generates a captcha as digits', () => {
    const value = generator.generate('captcha');
    expect(value).toMatch(/^\d{4,6}$/);
  });

  it('generates a number string', () => {
    const value = generator.generate('number');
    expect(Number(value)).not.toBeNaN();
  });

  it('generates text content', () => {
    const value = generator.generate('text');
    expect(value.length).toBeGreaterThan(0);
  });

  it('generates a URL', () => {
    const value = generator.generate('url');
    expect(value).toMatch(/^https?:\/\//);
  });

  it('generates a date string', () => {
    const value = generator.generate('date');
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('respects maxLength truncation', () => {
    const value = generator.generate('text', 5);
    expect(value.length).toBeLessThanOrEqual(5);
  });

  it('generates phone with maxLength', () => {
    const value = generator.generate('phone', 5);
    expect(value.length).toBeLessThanOrEqual(5);
  });

  it('respects locale option', () => {
    const enGenerator = new FakerGenerator({ locale: 'en' });
    const value = enGenerator.generate('fullName');
    expect(value.length).toBeGreaterThan(0);
  });

  it('generates different values on successive calls', () => {
    const values = new Set<string>();
    for (let i = 0; i < 10; i++) {
      values.add(generator.generate('email'));
    }
    expect(values.size).toBeGreaterThan(1);
  });
});
