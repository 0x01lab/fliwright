import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { FormHelperService } from '../src/form/FormHelperService.js';

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
  });

  it('fills selected fields through FormHelper.fillFields', async () => {
    const service = new FormHelperService();
    const fillFields = async (hints: string[], options: unknown) => ({
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

    const result = await service.fillSelected(
      { page: { formHelper: { fillFields } } } as any,
      Uri.file('/workspace'),
      ['Name'],
    );

    expect(result.filled).toBe(1);
    expect(service.getLastSummary()).toMatchObject({ action: 'fill', filled: 1, skipped: 1 });
  });
});
