import { describe, expect, it } from 'vitest';
import { Uri, __setConfiguration } from 'vscode';
import { FormHelperService, formRuleSnippetForField, formatFormFillDebug } from '../src/form/FormHelperService.js';

describe('FormHelperService', () => {
  it('masks sensitive preview values', () => {
    const service = new FormHelperService();

    const fields = service.previewFields({
      fields: [
        {
          id: 'password',
          label: '密码',
          semanticType: 'password',
          generatedValue: 'secret-value',
          selector: 'key=password',
        },
        {
          id: 'email',
          label: '邮箱',
          semanticType: 'email',
          generatedValue: 'test@example.com',
          selector: 'key=email',
        },
      ],
    });

    expect(fields[0]).toMatchObject({ masked: true, generatedValue: '************' });
    expect(fields[1]).toMatchObject({ masked: false, generatedValue: 'test@example.com' });
  });

  it('passes selected rules file to FormHelper analyze', async () => {
    const service = new FormHelperService();
    const analyze = async (options: unknown) => ({
      fields: [
        {
          id: JSON.stringify(options),
          semanticType: 'text' as const,
          generatedValue: 'value',
          selector: 'key=name',
        },
      ],
    });
    const result = await service.analyze({ page: { formHelper: { analyze } } } as any, Uri.file('/workspace'), {
      kind: 'formRulesFile',
      uri: Uri.file('/workspace/.fliwright/forms/login.json'),
      rulesFile: { version: 1, locale: 'en_US', rules: [] },
    });

    expect(result.fields[0]?.id).toContain('/workspace/.fliwright/forms/login.json');
    expect(service.getLastSummary()).toMatchObject({ action: 'analyze', total: 1 });
    expect(service.getLastAnalyze()).toBe(result);
  });

  it('uses stable field names for preview labels when text labels are absent', () => {
    const service = new FormHelperService();

    const fields = service.previewFields({
      fields: [
        {
          id: 'position',
          semanticType: 'text',
          generatedValue: 'Engineer',
          selector: 'name=jobPosition',
          name: 'jobPosition',
        },
      ],
    });

    expect(fields[0]).toMatchObject({ label: 'jobPosition' });
  });

  it('fills selected fields through FormHelper.fillFields', async () => {
    const service = new FormHelperService();
    let receivedOptions: Record<string, unknown> | undefined;
    const fillFields = async (hints: string[], options: unknown) => {
      receivedOptions = options as Record<string, unknown>;
      return ({
      filled: hints.length,
      skipped: 1,
      errors: [],
      fields: [
        {
          id: JSON.stringify(options),
          semanticType: 'text' as const,
          generatedValue: 'value',
          selector: 'key=name',
          status: 'filled' as const,
        },
      ],
      });
    };

    const result = await service.fillSelected(
      { page: { formHelper: { fillFields } } } as any,
      Uri.file('/workspace'),
      ['Name'],
      {
        kind: 'formRulesFile',
        uri: Uri.file('/workspace/.fliwright/forms/login.json'),
        rulesFile: { version: 1, locale: 'en_US', rules: [] },
      },
    );

    expect(result.filled).toBe(1);
    expect(receivedOptions).toMatchObject({ requireRuleMatch: true });
    expect(service.getLastSummary()).toMatchObject({ action: 'fill', filled: 1, skipped: 1 });
    expect(service.getLastAnalyze()).toBeUndefined();
  });

  it('writes form debug logs when enabled', async () => {
    __setConfiguration({ formDebug: true, formOperationTimeoutMs: 1000 });
    const service = new FormHelperService();
    const logs: string[] = [];
    service.setDebugLogger((message) => logs.push(message));

    try {
      const result = await service.analyze({ page: { formHelper: { analyze: async () => ({ fields: [] }) } } } as any, Uri.file('/workspace'));

      expect(result.fields).toEqual([]);
      expect(logs.join('\n')).toContain('[FormHelperDebug]');
      expect(logs.join('\n')).toContain('analyze started');
      expect(logs.join('\n')).toContain('analyze finished');
    } finally {
      __setConfiguration({});
    }
  });

  it('times out hung form helper operations', async () => {
    __setConfiguration({ formOperationTimeoutMs: 1000 });
    const service = new FormHelperService();

    try {
      await expect(service.fillSelected(
        { page: { formHelper: { fillFields: async () => new Promise(() => undefined) } } } as any,
        Uri.file('/workspace'),
        ['Name'],
      )).rejects.toThrow('FormHelper fillSelected timed out after 1000ms');
    } finally {
      __setConfiguration({});
    }
  });

  it('creates rule snippets with find wrapper and structured match keys', () => {
    expect(formRuleSnippetForField({
      id: 'country',
      semanticType: 'text',
      generatedValue: 'CN',
      selector: 'name=resAddrCountry',
      name: 'resAddrCountry',
    })).toEqual({
      find: { match: { name: 'resAddrCountry' } },
      type: 'PRESET_SKILL',
      data: ['CN'],
    });

    expect(formRuleSnippetForField({
      id: 'fallback',
      semanticType: 'text',
      generatedValue: 'value',
      selector: 'byType=TextFormField',
    })).toMatchObject({
      find: { match: { id: 'fallback' } },
    });
  });

  it('formats fill debug lines with field errors', () => {
    const lines = formatFormFillDebug({
      filled: 0,
      skipped: 1,
      errors: [{ fieldId: 'username', error: 'No widget found debug={"selector":"id=username"}' }],
      fields: [
        {
          id: 'username',
          semanticType: 'email',
          generatedValue: 'test@example.com',
          selector: 'text=Username / Email',
          status: 'error',
        },
        {
          id: 'password',
          semanticType: 'password',
          generatedValue: '',
          selector: 'text=Login password',
          status: 'skipped',
        },
      ],
    });

    expect(lines[0]).toBe('Form fill debug:');
    expect(lines[1]).toContain('id=username');
    expect(lines[1]).toContain('selector=text=Username / Email');
    expect(lines[1]).toContain('status=error');
    expect(lines[1]).toContain('No widget found');
    expect(formatFormFillDebug({
      filled: 0,
      skipped: 1,
      errors: [],
      fields: [{
        id: 'unmatched',
        semanticType: 'email',
        generatedValue: '',
        selector: 'text=Username / Email',
        status: 'skipped',
        reason: 'no matching form rule',
      }],
    })[1]).toContain('reason=no matching form rule');
    expect(lines[2]).toContain('status=skipped');
  });
});
