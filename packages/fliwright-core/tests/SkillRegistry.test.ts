import { describe, it, expect, beforeEach } from 'vitest';
import { SkillRegistry } from '../src/SkillRegistry.js';
import type { FormSkill, FormFieldMeta } from '../src/types.js';

function makeField(overrides: Partial<FormFieldMeta> = {}): FormFieldMeta {
  return {
    id: 'f1',
    type: 'TextFormField',
    rect: { x: 0, y: 0, width: 300, height: 48 },
    obscureText: false,
    enabled: true,
    selector: 'text=field',
    ...overrides,
  };
}

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it('returns null when no skills registered', () => {
    const result = registry.match(makeField());
    expect(result).toBeNull();
  });

  it('returns matching skill when one is registered', () => {
    const skill: FormSkill = {
      name: 'cn-phone',
      type: 'PRESET_SKILL',
      match: (f) => f.hintText?.includes('手机') ?? false,
      generate: () => '13812345678',
    };
    registry.register(skill);
    const result = registry.match(makeField({ hintText: '请输入手机号' }));
    expect(result).toBe(skill);
  });

  it('returns null when no skill matches', () => {
    const skill: FormSkill = {
      name: 'cn-phone',
      type: 'PRESET_SKILL',
      match: (f) => f.hintText?.includes('手机') ?? false,
      generate: () => '13812345678',
    };
    registry.register(skill);
    const result = registry.match(makeField({ hintText: '邮箱' }));
    expect(result).toBeNull();
  });

  it('returns first matching skill in registration order', () => {
    const skill1: FormSkill = {
      name: 'phone-a',
      type: 'PRESET_SKILL',
      match: (f) => f.hintText?.includes('手机') ?? false,
      generate: () => '11111111111',
    };
    const skill2: FormSkill = {
      name: 'phone-b',
      type: 'PRESET_SKILL',
      match: (f) => f.hintText?.includes('手机') ?? false,
      generate: () => '22222222222',
    };
    registry.register(skill1);
    registry.register(skill2);
    const result = registry.match(makeField({ hintText: '手机号' }));
    expect(result!.name).toBe('phone-a');
  });

  it('clear removes all registered skills', () => {
    const skill: FormSkill = {
      name: 's',
      type: 'PRESET_SKILL',
      match: () => true,
      generate: () => 'x',
    };
    registry.register(skill);
    registry.clear();
    expect(registry.match(makeField())).toBeNull();
  });
});