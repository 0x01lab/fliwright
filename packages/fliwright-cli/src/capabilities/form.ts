import type {
  FormAnalyzeResult,
  FormFillResult,
  FormHelperOptions,
} from '@fliwright/core';

export interface FormCapabilityDriver {
  page: {
    formHelper: {
      analyze(options?: FormHelperOptions): Promise<FormAnalyzeResult>;
      fill(options?: FormHelperOptions): Promise<FormFillResult>;
      fillFields(fieldHints: string[], options?: FormHelperOptions): Promise<FormFillResult>;
    };
  };
}

export function analyzeFormCapability(
  driver: FormCapabilityDriver,
  options?: FormHelperOptions,
): Promise<FormAnalyzeResult> {
  return driver.page.formHelper.analyze(options);
}

export function fillFormCapability(
  driver: FormCapabilityDriver,
  options?: FormHelperOptions,
): Promise<FormFillResult> {
  return driver.page.formHelper.fill(options);
}

export function fillFormFieldsCapability(
  driver: FormCapabilityDriver,
  fieldHints: string[],
  options?: FormHelperOptions,
): Promise<FormFillResult> {
  return driver.page.formHelper.fillFields(fieldHints, options);
}
