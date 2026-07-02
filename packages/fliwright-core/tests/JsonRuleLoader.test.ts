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

  it('treats ordinary data strings as fixed values even when they contain colons', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { hintText: 'url' }, type: 'PRESET_SKILL', data: ['https://example.com/login'] },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].generate({} as any, 'zh_CN')).toBe('https://example.com/login');
  });

  it('supports regex data DSL entries', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { hintText: '订单号' }, type: 'PRESET_SKILL', data: ['re:ORD-[0-9]{6}'] },
        { match: { hintText: '客户号' }, type: 'PRESET_SKILL', data: [{ regex: 'CUST-[A-Z]{3}' }] },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].generate({} as any, 'zh_CN')).toMatch(/^ORD-\d{6}$/);
    expect(skills[1].generate({} as any, 'zh_CN')).toMatch(/^CUST-[A-Z]{3}$/);
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

  it('loads find query rules and matches by semantic identifier', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        {
          find: { match: { semanticIdentifier: 'login.email' } },
          type: 'PRESET_SKILL',
          data: ['test@example.com'],
        },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].find).toEqual({ match: { semanticIdentifier: 'login.email' } });
    expect(skills[0].match({ semanticsId: 'login.email' } as any)).toBe(true);
    expect(skills[0].match({ semanticsId: 'login.password' } as any)).toBe(false);
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

  it('autoDiscover finds files in .fliwright/forms/ directory', () => {
    const formsDir = path.join(tmpDir, '.fliwright', 'forms');
    fs.mkdirSync(formsDir, { recursive: true });
    fs.writeFileSync(path.join(formsDir, 'login.json'), JSON.stringify({
      version: 1,
      rules: [{ find: { match: { semanticIdentifier: 'login.username' } }, type: 'PRESET_SKILL', data: ['qa@example.com'] }],
    }));
    const discoverLoader = new JsonRuleLoader(tmpDir);
    const skills = discoverLoader.autoDiscover();
    expect(skills).toHaveLength(1);
    expect(skills[0].match({ semanticsId: 'login.username' } as any)).toBe(true);
  });

  it('autoDiscover keeps legacy paths compatible with .fliwright/forms/', () => {
    const formsDir = path.join(tmpDir, '.fliwright', 'forms');
    fs.mkdirSync(formsDir, { recursive: true });
    fs.writeFileSync(path.join(formsDir, 'login.json'), JSON.stringify({
      version: 1,
      rules: [{ match: { hintText: 'new' }, type: 'LLM_GENERATE', data: ['current'] }],
    }));
    writeRuleFile('fliwright.form-rules.json', {
      version: 1,
      rules: [{ match: { hintText: 'legacy-file' }, type: 'LLM_GENERATE', data: ['file'] }],
    });
    const legacyDir = path.join(tmpDir, 'fliwright.form-rules');
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, 'legacy-dir.json'), JSON.stringify({
      version: 1,
      rules: [{ match: { hintText: 'legacy-dir' }, type: 'LLM_GENERATE', data: ['dir'] }],
    }));

    const discoverLoader = new JsonRuleLoader(tmpDir);
    const skills = discoverLoader.autoDiscover();

    expect(skills).toHaveLength(3);
    expect(skills.map((skill) => skill.name)).toEqual([
      'rule:hintText=new',
      'rule:hintText=legacy-file',
      'rule:hintText=legacy-dir',
    ]);
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

  describe('dataIndex', () => {
    it('picks data[0] when dataIndex is 0', () => {
      writeRuleFile('rules.json', {
        version: 1,
        rules: [
          { match: { hintText: 'test' }, type: 'PRESET_SKILL', data: ['first', 'second'] },
        ],
      });
      const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'), 0);
      expect(skills[0].generate({} as any, 'zh_CN')).toBe('first');
      // Same index every time (no auto-cycling)
      expect(skills[0].generate({} as any, 'zh_CN')).toBe('first');
    });

    it('picks data[1] when dataIndex is 1', () => {
      writeRuleFile('rules.json', {
        version: 1,
        rules: [
          { match: { hintText: 'test' }, type: 'PRESET_SKILL', data: ['first', 'second'] },
        ],
      });
      const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'), 1);
      expect(skills[0].generate({} as any, 'zh_CN')).toBe('second');
    });

    it('wraps around with modulo when dataIndex exceeds data length', () => {
      writeRuleFile('rules.json', {
        version: 1,
        rules: [
          { match: { hintText: 'test' }, type: 'PRESET_SKILL', data: ['a', 'b'] },
        ],
      });
      const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'), 5);
      // 5 % 2 === 1
      expect(skills[0].generate({} as any, 'zh_CN')).toBe('b');
    });

    it('still auto-cycles when dataIndex is omitted', () => {
      writeRuleFile('rules.json', {
        version: 1,
        rules: [
          { match: { hintText: 'test' }, type: 'PRESET_SKILL', data: ['a', 'b', 'c'] },
        ],
      });
      const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
      expect(skills[0].generate({} as any, 'zh_CN')).toBe('a');
      expect(skills[0].generate({} as any, 'zh_CN')).toBe('b');
      expect(skills[0].generate({} as any, 'zh_CN')).toBe('c');
      expect(skills[0].generate({} as any, 'zh_CN')).toBe('a');
    });

    it('works with LLM_GENERATE rules', () => {
      writeRuleFile('rules.json', {
        version: 1,
        rules: [
          { match: { hintText: 'test' }, type: 'LLM_GENERATE', data: ['val1', 'val2'] },
        ],
      });
      const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'), 1);
      expect(skills[0].generate({} as any, 'zh_CN')).toBe('val2');
    });

    it('all PRESET_SKILL rules in one file use the same dataIndex', () => {
      writeRuleFile('rules.json', {
        version: 1,
        rules: [
          { match: { hintText: 'username' }, type: 'PRESET_SKILL', data: ['user_a', 'user_b'] },
          { match: { hintText: 'password' }, type: 'PRESET_SKILL', data: ['pass_a', 'pass_b'] },
        ],
      });
      const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'), 1);
      const username = skills.find(s => s.name.includes('username'))!;
      const password = skills.find(s => s.name.includes('password'))!;
      expect(username.generate({} as any, 'zh_CN')).toBe('user_b');
      expect(password.generate({} as any, 'zh_CN')).toBe('pass_b');
    });

    it('picks named formData scenarios by dataIndex for matching rules', () => {
      writeRuleFile('rules.json', {
        version: 1,
        formData: [
          {
            name: 'primary qa account',
            note: 'happy path',
            values: {
              'login.username': 'user_a',
              'login.password': 'pass_a',
            },
          },
          {
            name: 'kyc pending account',
            description: 'requires manual review',
            values: {
              'login.username': 'user_b',
              'login.password': 'pass_b',
            },
          },
        ],
        rules: [
          {
            find: { match: { semanticIdentifier: 'login.username' } },
            type: 'PRESET_SKILL',
          },
          {
            find: { match: { semanticIdentifier: 'login.password' } },
            type: 'PRESET_SKILL',
          },
        ],
      });
      const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'), 1);
      const username = skills.find(s => s.find?.match?.semanticIdentifier === 'login.username')!;
      const password = skills.find(s => s.find?.match?.semanticIdentifier === 'login.password')!;

      expect(username.generate({} as any, 'zh_CN')).toBe('user_b');
      expect(password.generate({} as any, 'zh_CN')).toBe('pass_b');
    });

    it('does not fall back to legacy rule data when formData is present', () => {
      writeRuleFile('rules.json', {
        version: 1,
        formData: [
          {
            name: 'only username override',
            values: {
              'login.username': 'user_from_scenario',
            },
          },
        ],
        rules: [
          {
            find: { match: { semanticIdentifier: 'login.username' } },
            type: 'PRESET_SKILL',
            data: ['legacy_user'],
          },
          {
            find: { match: { semanticIdentifier: 'login.password' } },
            type: 'PRESET_SKILL',
            data: ['legacy_pass'],
          },
        ],
      });
      const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'), 0);
      const username = skills.find(s => s.find?.match?.semanticIdentifier === 'login.username')!;

      expect(username.generate({} as any, 'zh_CN')).toBe('user_from_scenario');
      expect(skills[1].generate({} as any, 'zh_CN')).toBe('');
    });
  });
});
