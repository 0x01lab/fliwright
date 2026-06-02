import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { FormRuleService } from '../src/form/FormRuleService.js';
import { createWorkspace, readText, writeJson } from './helpers/workspace.js';

describe('FormRuleService', () => {
  it('discovers valid rules files', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/forms/login.json', rulesFile());

    const result = await new FormRuleService().discover(Uri.file(root));

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.rulesFile.rules[0]?.type).toBe('REGEXP_MOCK');
    expect(result.invalid).toHaveLength(0);
  });

  it('reports invalid rule types', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/forms/bad.json', {
      version: 1,
      rules: [{ match: { label: '手机号' }, type: 'UNKNOWN' }],
    });

    const result = await new FormRuleService().discover(Uri.file(root));

    expect(result.invalid[0]?.error).toContain('type must be PRESET_SKILL');
  });

  it('accepts stable selector match keys', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/forms/login.json', {
      version: 1,
      rules: [{
        match: { name: 'email', ancestorKey: 'loginForm' },
        type: 'PRESET_SKILL',
        data: ['test@example.com'],
      }],
    });

    const result = await new FormRuleService().discover(Uri.file(root));

    expect(result.files).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });

  it('reports unsupported match keys', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/forms/bad.json', {
      version: 1,
      rules: [{ match: { unknownSelector: 'email' }, type: 'PRESET_SKILL', data: ['x'] }],
    });

    const result = await new FormRuleService().discover(Uri.file(root));

    expect(result.invalid[0]?.error).toContain('match.unknownSelector is not supported');
  });

  it('requires regexp pattern for REGEXP_MOCK', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/forms/bad.json', {
      version: 1,
      rules: [{ match: { label: '手机号' }, type: 'REGEXP_MOCK' }],
    });

    const result = await new FormRuleService().discover(Uri.file(root));

    expect(result.invalid[0]?.error).toContain('pattern is required');
  });

  it('creates form rule templates under .fliwright/forms', async () => {
    const root = await createWorkspace();

    const uri = await new FormRuleService().createTemplate(Uri.file(root), '../unsafe');
    const raw = await readText(root, '.fliwright/forms/unsafe.json');

    expect(uri.fsPath).toBe(path.join(root, '.fliwright/forms/unsafe.json'));
    expect(JSON.parse(raw)).toMatchObject({
      version: 1,
      rules: expect.any(Array),
    });
  });
});

function rulesFile() {
  return {
    version: 1,
    locale: 'zh-CN',
    rules: [
      {
        match: { label: '手机号' },
        type: 'REGEXP_MOCK',
        pattern: '1[3-9][0-9]{9}',
      },
    ],
  };
}
