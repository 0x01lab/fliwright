import type {
  FormFieldOption,
  FormFieldMeta,
  FormFillResult,
  FormAnalyzeResult,
  FormHelperOptions,
  SemanticType,
  SelectorInput,
  SendRequest,
} from './types.js';
import { SemanticInferrer } from './SemanticInferrer.js';
import { FakerGenerator } from './FakerGenerator.js';
import { SkillRegistry } from './SkillRegistry.js';
import { JsonRuleLoader } from './JsonRuleLoader.js';
import { Locator } from './Locator.js';

type RuleMatchField = FormFieldMeta & { semanticType?: SemanticType };

export class FormHelper {
  private sendRequest: SendRequest;

  constructor(sendRequest: SendRequest) {
    this.sendRequest = sendRequest;
  }

  async fill(options?: FormHelperOptions): Promise<FormFillResult> {
    const fields = await this.extractFields(options?.scope);
    const { inferrer, generator, registry } = this.buildPipeline(options);

    const result: FormFillResult = { filled: 0, skipped: 0, errors: [], fields: [] };
    const semanticTypes = inferrer.infer(fields);

    for (const field of fields) {
      await this.fillOneField(field, result, semanticTypes, generator, registry, options);
    }

    return result;
  }

  async analyze(options?: FormHelperOptions): Promise<FormAnalyzeResult> {
    const fields = await this.extractFields(options?.scope);
    const { inferrer, generator, registry } = this.buildPipeline(options);
    const semanticTypes = inferrer.infer(fields);

    return {
      fields: fields.map((field) => {
        const semanticType = semanticTypes.get(field.id) ?? 'text';
        const matchField: RuleMatchField = { ...field, semanticType };
        const skill = registry.match(matchField);
        const generatedValue = this.generateFieldValue(field, semanticType, generator, skill, options);
        return {
          id: field.id,
          semanticType,
          generatedValue,
          selector: field.selector,
          controlType: field.controlType,
          options: field.options,
          hintText: field.hintText,
          label: field.label,
          key: field.key,
          ancestorKey: field.ancestorKey,
          name: field.name,
          semanticsId: field.semanticsId,
          semanticsLabel: field.semanticsLabel,
          semanticsHint: field.semanticsHint,
          role: field.role,
        };
      }),
    };
  }

  async fillFields(fieldHints: string[], options?: FormHelperOptions): Promise<FormFillResult> {
    const fields = await this.extractFields(options?.scope);
    const { inferrer, generator, registry } = this.buildPipeline(options);
    const semanticTypes = inferrer.infer(fields);
    const matchingIds = new Set(
      fields
        .filter((field) => {
          const text = field.hintText ?? field.label ?? '';
          return fieldHints.some((hint) => text.includes(hint));
        })
        .map((f) => f.id),
    );

    const result: FormFillResult = { filled: 0, skipped: 0, errors: [], fields: [] };
    for (const field of fields) {
      if (!matchingIds.has(field.id)) {
        result.fields.push({
          id: field.id,
          semanticType: semanticTypes.get(field.id) ?? 'text',
          generatedValue: '',
          selector: field.selector,
          status: 'skipped',
          reason: 'not selected',
          ...this.resultMetadata(field),
        });
        result.skipped++;
      } else {
        await this.fillOneField(field, result, semanticTypes, generator, registry, options);
      }
    }
    return result;
  }

  private async extractFields(scope?: string): Promise<FormFieldMeta[]> {
    const params: Record<string, unknown> = {};
    if (scope) params.scope = scope;
    const response = (await this.sendRequest('ext.fliwright.extractForm', params)) as {
      fields: FormFieldMeta[];
      count: number;
    };
    return response.fields ?? [];
  }

  private buildPipeline(options?: FormHelperOptions) {
    const inferrer = new SemanticInferrer();
    const generator = new FakerGenerator({ locale: options?.locale });
    const registry = new SkillRegistry();
    const loader = new JsonRuleLoader();

    if (options?.rulesFile) {
      const skills = loader.loadFromFile(options.rulesFile);
      for (const skill of skills) registry.register(skill);
    } else if (options?.rulesDir) {
      const skills = loader.loadFromDir(options.rulesDir);
      for (const skill of skills) registry.register(skill);
    } else {
      const skills = loader.autoDiscover();
      for (const skill of skills) registry.register(skill);
    }

    return { inferrer, generator, registry };
  }

  private async fillOneField(
    field: FormFieldMeta,
    result: FormFillResult,
    semanticTypes: Map<string, SemanticType>,
    generator: FakerGenerator,
    registry: SkillRegistry,
    options?: FormHelperOptions,
  ): Promise<void> {
    if (field.enabled === false) {
      result.fields.push({
        id: field.id,
        semanticType: semanticTypes.get(field.id) ?? 'text',
        generatedValue: '',
        selector: field.selector,
        status: 'skipped',
        reason: 'disabled',
        ...this.resultMetadata(field),
      });
      result.skipped++;
      return;
    }

    const semanticType = semanticTypes.get(field.id) ?? 'text';
    const matchField: RuleMatchField = { ...field, semanticType };
    const skill = registry.match(matchField);

    if (field.obscureText && (options?.skipObscureFields ?? true) && !skill) {
      result.fields.push({
        id: field.id,
        semanticType,
        generatedValue: '',
        selector: field.selector,
        status: 'skipped',
        reason: 'obscure field',
        ...this.resultMetadata(field),
      });
      result.skipped++;
      return;
    }

    if (options?.requireRuleMatch && !skill) {
      result.fields.push({
        id: field.id,
        semanticType,
        generatedValue: '',
        selector: field.selector,
        status: 'skipped',
        reason: 'no matching form rule',
        ...this.resultMetadata(field),
      });
      result.skipped++;
      return;
    }
    const generatedValue = this.generateFieldValue(field, semanticType, generator, skill, options);

    try {
      await this.fillWithFallback(field, generatedValue);
      result.fields.push({
        id: field.id,
        semanticType,
        generatedValue,
        selector: field.selector,
        status: 'filled',
        ...this.resultMetadata(field),
      });
      result.filled++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({ fieldId: field.id, error: errorMsg });
      result.fields.push({
        id: field.id,
        semanticType,
        generatedValue,
        selector: field.selector,
        status: 'error',
        ...this.resultMetadata(field),
      });
    }
  }

  private resultMetadata(field: FormFieldMeta) {
    return {
      key: field.key,
      controlType: field.controlType,
      options: field.options,
      ancestorKey: field.ancestorKey,
      name: field.name,
      semanticsId: field.semanticsId,
      semanticsLabel: field.semanticsLabel,
      semanticsHint: field.semanticsHint,
      role: field.role,
    };
  }

  private generateFieldValue(
    field: FormFieldMeta,
    semanticType: SemanticType,
    generator: FakerGenerator,
    skill: { generate: (field: FormFieldMeta, locale: string) => string } | null,
    options?: FormHelperOptions,
  ): string {
    if (skill) return skill.generate(field, options?.locale ?? 'zh_CN');

    if (field.controlType === 'checkbox') {
      const option = this.firstFillableOption(field);
      return option?.value ?? option?.label ?? 'true';
    }

    if (field.controlType === 'radio' || field.controlType === 'select') {
      const option = this.firstFillableOption(field);
      return option?.value ?? option?.label ?? generator.generate(semanticType, field.maxLength);
    }

    return generator.generate(semanticType, field.maxLength);
  }

  private async fillWithFallback(field: FormFieldMeta, generatedValue: string): Promise<void> {
    const primarySelector = this.selectorForFill(field);
    try {
      await this.applyFieldValue(field, primarySelector, generatedValue);
      return;
    } catch (primaryError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const fallbackSelector = this.parseSelector(field.selector);
      const primarySelectorText = typeof primarySelector === 'string'
        ? primarySelector
        : new Locator(primarySelector, this.sendRequest).selectorString;
      const fallbackSelectorText = new Locator(fallbackSelector, this.sendRequest).selectorString;

      if (primarySelectorText === fallbackSelectorText) {
        throw primaryError;
      }

      try {
        await this.applyFieldValue(field, fallbackSelector, generatedValue);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(
          `Fill failed. primary=${primarySelectorText}: ${primaryMessage}; fallback=${fallbackSelectorText}: ${fallbackMessage}`,
        );
      }
    }
  }

  private async applyFieldValue(
    field: FormFieldMeta,
    fieldSelector: SelectorInput,
    generatedValue: string,
  ): Promise<void> {
    if (!field.controlType || field.controlType === 'textInput') {
      await new Locator(fieldSelector, this.sendRequest).fill(generatedValue);
      return;
    }

    switch (field.controlType) {
      case 'checkbox':
        await this.applyCheckboxValue(field, fieldSelector, generatedValue);
        return;
      case 'radio':
        await this.clickOption(field, fieldSelector, generatedValue, { openFieldFirst: false });
        return;
      case 'select':
        await this.clickOption(field, fieldSelector, generatedValue, { openFieldFirst: true });
        return;
      default:
        await new Locator(fieldSelector, this.sendRequest).fill(generatedValue);
    }
  }

  private async applyCheckboxValue(
    field: FormFieldMeta,
    fieldSelector: SelectorInput,
    generatedValue: string,
  ): Promise<void> {
    const hasMultipleOptions = (field.options?.length ?? 0) > 1;
    if (hasMultipleOptions) {
      await this.clickOption(field, fieldSelector, generatedValue, { openFieldFirst: false });
      return;
    }

    const desired = this.parseBooleanValue(generatedValue);
    if (desired === false) {
      return;
    }
    if (field.value === true) {
      return;
    }
    await new Locator(fieldSelector, this.sendRequest).click();
  }

  private async clickOption(
    field: FormFieldMeta,
    fieldSelector: SelectorInput,
    generatedValue: string,
    options: { openFieldFirst: boolean },
  ): Promise<void> {
    const option = this.resolveOption(field, generatedValue);
    const optionLabel = option?.label ?? generatedValue;

    if (options.openFieldFirst) {
      await new Locator(fieldSelector, this.sendRequest).click();
      await this.delay(50);
    }

    if (!optionLabel) {
      throw new Error(`No selectable option available for field ${field.id}`);
    }

    if (option?.semanticsId) {
      await new Locator(`semanticsId=${option.semanticsId}`, this.sendRequest).click();
      return;
    }

    const scopedOptionSelector: SelectorInput = { text: optionLabel, ancestor: fieldSelector };
    try {
      await new Locator(scopedOptionSelector, this.sendRequest).click();
    } catch (scopedError) {
      if (!options.openFieldFirst) throw scopedError;
      await new Locator({ text: optionLabel }, this.sendRequest).click();
    }
  }

  private resolveOption(field: FormFieldMeta, target: string): FormFieldOption | undefined {
    const normalizedTarget = this.normalizeOptionValue(target);
    if (!normalizedTarget) return this.firstFillableOption(field);
    return field.options?.find((option) => {
      if (option.enabled === false) return false;
      return this.normalizeOptionValue(option.value) === normalizedTarget
        || this.normalizeOptionValue(option.label) === normalizedTarget;
    });
  }

  private firstFillableOption(field: FormFieldMeta): FormFieldOption | undefined {
    return field.options?.find((option) => option.enabled !== false && option.selected !== true)
      ?? field.options?.find((option) => option.enabled !== false);
  }

  private parseBooleanValue(value: string): boolean | undefined {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '是'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', '否'].includes(normalized)) return false;
    return undefined;
  }

  private normalizeOptionValue(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseSelector(selectorStr: string): SelectorInput {
    if (selectorStr.startsWith('text=')) return { text: selectorStr.slice(5) };
    if (selectorStr.startsWith('key=')) return { key: selectorStr.slice(4) };
    if (selectorStr.startsWith('byType=')) return { type: selectorStr.slice(7) };
    return selectorStr;
  }

  private selectorForFill(field: FormFieldMeta): SelectorInput {
    if (field.semanticsId) return `semanticsId=${field.semanticsId}`;
    if (field.name) return `name=${field.name}`;
    if (field.key) return { key: field.key };
    if (field.ancestorKey) return `ancestorKey=${field.ancestorKey}`;
    return field.id ? `id=${field.id}` : this.parseSelector(field.selector);
  }
}
