import { describe, expect, it, vi } from 'vitest';
import {
  analyzeFormCapability,
  fillFormCapability,
  fillFormFieldsCapability,
  type FormCapabilityDriver,
} from '../src/capabilities/form.js';

describe('CLI form capabilities', () => {
  it('preserves FormHelper as the exact form discovery and fill path', async () => {
    const analyze = vi.fn().mockResolvedValue({ fields: [] });
    const fill = vi.fn().mockResolvedValue({
      filled: 1,
      skipped: 0,
      errors: [],
      fields: [],
    });
    const fillFields = vi.fn().mockResolvedValue({
      filled: 1,
      skipped: 0,
      errors: [],
      fields: [],
    });
    const driver: FormCapabilityDriver = {
      page: {
        formHelper: {
          analyze,
          fill,
          fillFields,
        },
      },
    };
    const options = { locale: 'zh_CN', skipObscureFields: true };

    await analyzeFormCapability(driver, options);
    await fillFormCapability(driver, options);
    await fillFormFieldsCapability(driver, ['手机号'], options);

    expect(analyze).toHaveBeenCalledWith(options);
    expect(fill).toHaveBeenCalledWith(options);
    expect(fillFields).toHaveBeenCalledWith(['手机号'], options);
  });
});
