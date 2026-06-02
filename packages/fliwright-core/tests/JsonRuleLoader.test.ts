import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonRuleLoader } from '../src/JsonRuleLoader.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fliwright-rules-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeRuleFile(fileName: string, content: object) {
  fs.writeFileSync(path.join(tmpDir, fileName), JSON.stringify(content, null, 2));
}

describe('JsonRuleLoader', () => {
  const loader = new JsonRuleLoader();

  it('loads skills from a single JSON file', () => {
    writeRuleFile('rules.json', {
      version: 1,
      locale: 'zh-CN',
      rules: [
        {
          match: { hintText: '公司名称' },
          type: 'LLM_GENERATE',
          data: ['北京科技有限公司', '上海创新网络科技'],
        },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('rule:hintText=公司名称');
    expect(skills[0].type).toBe('LLM_GENERATE');
  });

  it('loaded LLM_GENERATE skill matches by hintText', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { hintText: '手机号' }, type: 'LLM_GENERATE', data: ['13800000000'] },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].match({ hintText: '手机号' } as any)).toBe(true);
    expect(skills[0].match({ hintText: '邮箱' } as any)).toBe(false);
  });

  it('loaded LLM_GENERATE skill cycles through data array', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { hintText: 'test' }, type: 'LLM_GENERATE', data: ['a', 'b', 'c'] },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].generate({} as any, 'zh_CN')).toBe('a');
    expect(skills[0].generate({} as any, 'zh_CN')).toBe('b');
    expect(skills[0].generate({} as any, 'zh_CN')).toBe('c');
    expect(skills[0].generate({} as any, 'zh_CN')).toBe('a');
  });

  it('loaded REGEXP_MOCK skill generates matching strings', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { hintText: '订单号' }, type: 'REGEXP_MOCK', pattern: 'ORD\\d{10}' },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    const value = skills[0].generate({} as any, 'zh_CN');
    expect(value).toMatch(/^ORD\d{10}$/);
  });

  it('loaded skill matches by semanticType', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { semanticType: 'address' }, type: 'LLM_GENERATE', data: ['北京市朝阳区'] },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].name).toBe('rule:semanticType=address');
    expect(skills[0].match({ semanticType: 'address' } as any)).toBe(true);
    expect(skills[0].match({ semanticType: 'email' } as any)).toBe(false);
  });

  it('matches stable form metadata fields exactly', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        {
          match: {
            name: 'email',
            ancestorKey: 'loginForm',
            semanticsId: 'login.email',
          },
          type: 'PRESET_SKILL',
          data: ['test@example.com'],
        },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].match({
      name: 'email',
      ancestorKey: 'loginForm',
      semanticsId: 'login.email',
    } as any)).toBe(true);
    expect(skills[0].match({
      name: 'backupEmail',
      ancestorKey: 'loginForm',
      semanticsId: 'login.email',
    } as any)).toBe(false);
  });

  it('does not match unknown rule keys', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { unknownSelector: 'email' }, type: 'PRESET_SKILL', data: ['test@example.com'] },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].match({ hintText: 'email' } as any)).toBe(false);
  });

  it('loads all JSON files from a directory', () => {
    writeRuleFile('rules1.json', {
      version: 1,
      rules: [{ match: { hintText: 'a' }, type: 'LLM_GENERATE', data: ['1'] }],
    });
    writeRuleFile('rules2.json', {
      version: 1,
      rules: [{ match: { hintText: 'b' }, type: 'LLM_GENERATE', data: ['2'] }],
    });
    const skills = loader.loadFromDir(tmpDir);
    expect(skills).toHaveLength(2);
  });

  it('returns empty array for non-existent file', () => {
    const skills = loader.loadFromFile(path.join(tmpDir, 'nope.json'));
    expect(skills).toEqual([]);
  });

  it('returns empty array for non-existent directory', () => {
    const skills = loader.loadFromDir(path.join(tmpDir, 'nodir'));
    expect(skills).toEqual([]);
  });

  it('autoDiscover returns empty when no rule files exist', () => {
    const discoverLoader = new JsonRuleLoader(tmpDir);
    const skills = discoverLoader.autoDiscover();
    expect(skills).toEqual([]);
  });

  it('autoDiscover finds fliwright.form-rules.json', () => {
    writeRuleFile('fliwright.form-rules.json', {
      version: 1,
      rules: [{ match: { hintText: 'x' }, type: 'LLM_GENERATE', data: ['y'] }],
    });
    const discoverLoader = new JsonRuleLoader(tmpDir);
    const skills = discoverLoader.autoDiscover();
    expect(skills).toHaveLength(1);
  });

  it('autoDiscover finds files in fliwright.form-rules/ directory', () => {
    const rulesDir = path.join(tmpDir, 'fliwright.form-rules');
    fs.mkdirSync(rulesDir);
    fs.writeFileSync(path.join(rulesDir, 'custom.json'), JSON.stringify({
      version: 1,
      rules: [{ match: { hintText: 'z' }, type: 'LLM_GENERATE', data: ['w'] }],
    }));
    const discoverLoader = new JsonRuleLoader(tmpDir);
    const skills = discoverLoader.autoDiscover();
    expect(skills).toHaveLength(1);
  });
});
