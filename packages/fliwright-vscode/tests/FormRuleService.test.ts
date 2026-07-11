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

  it('accepts form action scripts', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/forms/kyc.json', {
      version: 1,
      rules: [{
        match: { name: 'employmentStatus' },
        find: { match: { semanticIdentifier: 'kyc.personalInfo.employmentStatus.select' } },
        type: 'PRESET_SKILL',
        data: ['FULL_TIME'],
        action: {
          script: 'select.byOptionSemantics',
          args: {
            optionSemanticId: 'kyc.personalInfo.employmentStatus.option.${value}',
          },
        },
      }],
    });

    const result = await new FormRuleService().discover(Uri.file(root));

    expect(result.files).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });

  it('accepts named form data scenarios', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/forms/login.json', {
      version: 1,
      formData: [
        {
          name: 'default qa account',
          note: 'happy path',
          values: {
            username: 'qa@example.com',
            password: 'Password123!',
          },
        },
      ],
      rules: [{
        find: { match: { semanticIdentifier: 'login.username' } },
        type: 'PRESET_SKILL',
        dataKey: 'username',
      }],
    });

    const result = await new FormRuleService().discover(Uri.file(root));

    expect(result.files).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });

  it('requires explicit dataKey for formData-backed rules', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/forms/login.json', {
      version: 1,
      formData: [
        {
          name: 'default qa account',
          values: {
            username: 'qa@example.com',
          },
        },
      ],
      rules: [{
        find: { match: { semanticIdentifier: 'login.username' } },
        type: 'PRESET_SKILL',
      }],
    });

    const result = await new FormRuleService().discover(Uri.file(root));

    expect(result.invalid[0]?.error).toContain('dataKey is required when formData is used');
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

  it('creates rules from analyzed fields', async () => {
    const root = await createWorkspace();

    const uri = await new FormRuleService().createFromAnalyzeFields(Uri.file(root), 'analyzed', [
      {
        id: 'email-field',
        semanticType: 'email',
        generatedValue: 'qa@example.com',
        selector: 'name=email',
        name: 'email',
      },
    ]);
    const raw = await readText(root, '.fliwright/forms/analyzed.json');

    expect(uri.fsPath).toBe(path.join(root, '.fliwright/forms/analyzed.json'));
    expect(JSON.parse(raw).rules).toEqual([
      {
        find: { match: { name: 'email' } },
        type: 'PRESET_SKILL',
        data: ['qa@example.com'],
      },
    ]);
  });

  it('creates action script rules for analyzed select fields', async () => {
    const root = await createWorkspace();

    await new FormRuleService().createFromAnalyzeFields(Uri.file(root), 'selects', [
      {
        id: 'employment-field',
        semanticType: 'option',
        generatedValue: 'FULL_TIME',
        selector: 'name=employmentStatus',
        name: 'employmentStatus',
        controlType: 'select',
        semanticsId: 'kyc.personalInfo.employmentStatus.select',
        options: [
          {
            label: 'Employed',
            value: 'FULL_TIME',
            semanticsId: 'kyc.personalInfo.employmentStatus.option.FULL_TIME',
          },
        ],
      },
      {
        id: 'sof-field',
        semanticType: 'option',
        generatedValue: 'HK',
        selector: 'name=sofJurisdictions',
        name: 'sofJurisdictions',
        controlType: 'select',
        semanticsId: 'kyc.personalInfo.sofJurisdictions.select',
        options: [
          {
            label: 'Hong Kong',
            value: 'HK',
            semanticsId: 'kyc.personalInfo.sofJurisdictions.option.HK',
          },
        ],
      },
    ]);
    const raw = await readText(root, '.fliwright/forms/selects.json');
    const rules = JSON.parse(raw).rules;

    expect(rules[0]).toMatchObject({
      action: {
        script: 'select.byOptionSemantics',
        args: {
          open: { match: { semanticIdentifier: 'kyc.personalInfo.employmentStatus.select' } },
          optionSemanticId: 'kyc.personalInfo.employmentStatus.option.${value}',
        },
      },
    });
    expect(rules[1]).toMatchObject({
      action: {
        script: 'multiSelect.byOptionSemantics',
        args: {
          open: { match: { semanticIdentifier: 'kyc.personalInfo.sofJurisdictions.select' } },
          optionSemanticId: 'kyc.personalInfo.sofJurisdictions.option.${value}',
          done: { match: { text: 'Done' } },
        },
      },
    });
  });

  it('appends analyzed fields and skips duplicate selectors', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/forms/login.json', {
      version: 1,
      locale: 'zh-CN',
      rules: [
        {
          find: { match: { name: 'email' } },
          type: 'PRESET_SKILL',
          data: ['old@example.com'],
        },
      ],
    });
    const service = new FormRuleService();
    const uri = Uri.file(path.join(root, '.fliwright/forms/login.json'));

    const added = await service.appendAnalyzeFields(uri, [
      {
        id: 'email-field',
        semanticType: 'email',
        generatedValue: 'new@example.com',
        selector: 'name=email',
        name: 'email',
      },
      {
        id: 'phone-field',
        semanticType: 'phone',
        generatedValue: '13800000000',
        selector: 'name=phone',
        name: 'phone',
      },
    ]);
    const raw = await readText(root, '.fliwright/forms/login.json');

    expect(added).toBe(1);
    expect(JSON.parse(raw).rules).toHaveLength(2);
    expect(JSON.parse(raw).rules[1]).toMatchObject({
      find: { match: { name: 'phone' } },
      data: ['13800000000'],
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
