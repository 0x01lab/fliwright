import type {
  FormFieldOption,
  FormFieldMeta,
  FormFillResult,
  FormAnalyzeResult,
  FormRuleAction,
  FormHelperOptions,
  SemanticType,
  SelectorInput,
  SelectorQuery,
  SendRequest,
  WidgetInfo,
} from './types.js';
import { SemanticInferrer } from './SemanticInferrer.js';
import { FakerGenerator } from './FakerGenerator.js';
import { SkillRegistry } from './SkillRegistry.js';
import { JsonRuleLoader } from './JsonRuleLoader.js';
import { Locator } from './Locator.js';
import { builtInFormActionScripts } from './FormActionScripts.js';

type RuleMatchField = FormFieldMeta & { semanticType?: SemanticType };
type MatchedFormSkill = {
  find?: SelectorQuery;
  action?: FormRuleAction;
  generate: (field: FormFieldMeta, locale: string, options?: FormHelperOptions) => string | Promise<string>;
};

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
      fields: await Promise.all(fields.map(async (field) => {
        const semanticType = semanticTypes.get(field.id) ?? 'text';
        const matchField: RuleMatchField = { ...field, semanticType };
        const skill = registry.match(matchField);
        const generatedValue = await this.generateFieldValue(field, semanticType, generator, skill, options);
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
      })),
    };
  }

  async fillFields(fieldHints: string[], options?: FormHelperOptions): Promise<FormFillResult> {
    const fields = await this.extractFields(options?.scope);
    const { inferrer, generator, registry } = this.buildPipeline(options);
    const semanticTypes = inferrer.infer(fields);
    const matchingIds = this.resolveFieldHintMatches(fields, fieldHints);

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
    const dataIndex = options?.dataIndex;

    if (options?.rulesFile) {
      const skills = loader.loadFromFile(options.rulesFile, dataIndex);
      for (const skill of skills) registry.register(skill);
    } else if (options?.rulesDir) {
      const skills = loader.loadFromDir(options.rulesDir, dataIndex);
      for (const skill of skills) registry.register(skill);
    } else {
      const skills = loader.autoDiscover(dataIndex);
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
    const generatedValue = await this.generateFieldValue(field, semanticType, generator, skill, options);

    try {
      await this.fillWithFallback(field, generatedValue, skill, options);
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

  private fieldSelectionCandidates(field: FormFieldMeta): string[] {
    return [
      field.hintText,
      field.label,
      field.name,
      field.selector,
      field.key,
      field.ancestorKey,
      field.semanticsId,
      field.semanticsLabel,
      field.semanticsHint,
      field.id,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  }

  private resolveFieldHintMatches(fields: FormFieldMeta[], fieldHints: string[]): Set<string> {
    const matchingIds = new Set<string>();
    for (const hint of fieldHints) {
      const exactMatches = fields.filter((field) =>
        this.fieldSelectionCandidates(field).some((candidate) => candidate === hint),
      );
      const selectedFields = exactMatches.length > 0
        ? exactMatches
        : fields.filter((field) =>
            this.fieldSelectionCandidates(field).some((candidate) => candidate.includes(hint)),
          );
      for (const field of selectedFields) matchingIds.add(field.id);
    }
    return matchingIds;
  }

  private async generateFieldValue(
    field: FormFieldMeta,
    semanticType: SemanticType,
    generator: FakerGenerator,
    skill: MatchedFormSkill | null,
    options?: FormHelperOptions,
  ): Promise<string> {
    if (skill) return skill.generate(field, options?.locale ?? 'zh_CN', options);

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

  private async fillWithFallback(
    field: FormFieldMeta,
    generatedValue: string,
    skill?: MatchedFormSkill | null,
    options?: FormHelperOptions,
  ): Promise<void> {
    const primarySelector = skill?.find ?? this.selectorForFill(field);
    const primaryLocator = new Locator(primarySelector, this.sendRequest);

    try {
      await this.applyFieldValue(field, primarySelector, generatedValue, undefined, skill?.action, options);
      return;
    } catch (primaryError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      if (skill?.action) {
        throw new Error(
          `Form action ${skill.action.script} failed for ${primaryLocator.selectorString}: ${primaryMessage}`,
        );
      }
      const fallbackSelector = this.parseSelector(field.selector);
      const primarySelectorText = primaryLocator.selectorString;
      const fallbackSelectorText = new Locator(fallbackSelector, this.sendRequest).selectorString;

      if (primarySelectorText === fallbackSelectorText) {
        if (this.isTextInputField(field)) {
          try {
            await this.applyLegacyTextInput(field, generatedValue);
            return;
          } catch (legacyError) {
            const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
            throw new Error(
              `Fill failed. primary=${primarySelectorText}: ${primaryMessage}; legacyType=${field.selector}: ${legacyMessage}`,
            );
          }
        }
        throw primaryError;
      }

      try {
        await this.applyFieldValue(field, fallbackSelector, generatedValue, undefined, skill?.action, options);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (this.isTextInputField(field)) {
          try {
            await this.applyLegacyTextInput(field, generatedValue);
            return;
          } catch (legacyError) {
            const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
            throw new Error(
              `Fill failed. primary=${primarySelectorText}: ${primaryMessage}; fallback=${fallbackSelectorText}: ${fallbackMessage}; legacyType=${field.selector}: ${legacyMessage}`,
            );
          }
        }

        throw new Error(
          `Fill failed. primary=${primarySelectorText}: ${primaryMessage}; fallback=${fallbackSelectorText}: ${fallbackMessage}`,
        );
      }
    }
  }

  private async applyFieldValue(
    field: FormFieldMeta,
    fieldSelector: SelectorQuery,
    generatedValue: string,
    resolved?: WidgetInfo,
    action?: FormRuleAction,
    options?: FormHelperOptions,
  ): Promise<void> {
    if (action) {
      await this.applyActionScript(field, fieldSelector, generatedValue, action, options);
      return;
    }

    if (!field.controlType || field.controlType === 'textInput') {
      const locator = new Locator(field.ref ? { ref: field.ref } : fieldSelector, this.sendRequest);
      const resolvedTarget = resolved ?? this.resolvedFieldTarget(field);
      if (!field.ref && resolvedTarget) {
        await locator.fillWithResolved(generatedValue, resolvedTarget);
      } else {
        await locator.fill(generatedValue, field.ref ? { checkStable: false } : undefined);
      }
      return;
    }

    switch (field.controlType) {
      case 'checkbox':
        await this.applyCheckboxValue(field, fieldSelector, generatedValue, resolved);
        return;
      case 'radio':
        await this.clickOption(field, fieldSelector, generatedValue, { openFieldFirst: false });
        return;
      case 'select':
        await this.clickOption(field, fieldSelector, generatedValue, { openFieldFirst: true });
        return;
      default:
        const locator = new Locator(fieldSelector, this.sendRequest);
        if (resolved) {
          await locator.fillWithResolved(generatedValue, resolved);
        } else {
          await locator.fill(generatedValue);
        }
    }
  }

  private async applyCheckboxValue(
    field: FormFieldMeta,
    fieldSelector: SelectorQuery,
    generatedValue: string,
    resolved?: WidgetInfo,
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
    fieldSelector: SelectorQuery,
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
      await new Locator({ match: { semanticIdentifier: option.semanticsId } }, this.sendRequest).click();
      return;
    }

    const scopedOptionSelector: SelectorQuery = { match: { text: optionLabel }, within: fieldSelector };
    try {
      await new Locator(scopedOptionSelector, this.sendRequest).click();
    } catch (scopedError) {
      if (!options.openFieldFirst) throw scopedError;
      await new Locator({ match: { text: optionLabel } }, this.sendRequest).click();
    }
  }

  private async applyActionScript(
    field: FormFieldMeta,
    fieldSelector: SelectorQuery,
    generatedValue: string,
    action: FormRuleAction,
    options?: FormHelperOptions,
  ): Promise<void> {
    const script = options?.actionScripts?.[action.script] ?? builtInFormActionScripts[action.script];
    if (!script) {
      throw new Error(`Unknown form action script: ${action.script}`);
    }
    await script({
      field,
      value: generatedValue,
      action,
      fieldSelector,
      option: this.resolveOption(field, generatedValue),
      sendRequest: this.sendRequest,
      locator: (selector: SelectorInput) => new Locator(selector, this.sendRequest),
    });
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

  private async applyLegacyTextInput(
    field: FormFieldMeta,
    generatedValue: string,
  ): Promise<void> {
    const result = await this.sendRequest('ext.fliwright.type', {
      selector: field.selector,
      text: generatedValue,
      replaceAll: 'true',
    }) as { success?: boolean; error?: string };

    if (result.success !== true) {
      throw new Error(result.error ?? 'ext.fliwright.type did not report success');
    }
  }

  private isTextInputField(field: FormFieldMeta): boolean {
    return !field.controlType || field.controlType === 'textInput';
  }

  private resolvedFieldTarget(field: FormFieldMeta): WidgetInfo | undefined {
    if (!field.id || !field.rect) return undefined;
    return {
      id: field.id,
      type: field.type,
      rect: field.rect,
      properties: {},
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseSelector(selectorStr: string): SelectorQuery {
    if (selectorStr.trimStart().startsWith('{')) {
      try {
        return JSON.parse(selectorStr) as SelectorQuery;
      } catch {
        return { match: { text: selectorStr } };
      }
    }
    if (selectorStr.startsWith('text=')) return { match: { text: selectorStr.slice(5) } };
    if (selectorStr.startsWith('textContains=')) return { match: { textContains: selectorStr.slice(13) } };
    if (selectorStr.startsWith('key=')) return { match: { key: selectorStr.slice(4) } };
    if (selectorStr.startsWith('byType=')) return { match: { type: selectorStr.slice(7) } };
    if (selectorStr.startsWith('id=')) return { match: { id: selectorStr.slice(3) } };
    if (selectorStr.startsWith('name=')) return { match: { name: selectorStr.slice(5) } };
    if (selectorStr.startsWith('ancestorKey=')) return { match: { ancestorKey: selectorStr.slice(12) } };
    if (selectorStr.startsWith('semanticsId=')) return { match: { semanticIdentifier: selectorStr.slice(12) } };
    if (selectorStr.startsWith('semantics=')) return { match: { semanticsLabel: selectorStr.slice(10) } };
    if (selectorStr.startsWith('role=')) return { match: { role: selectorStr.slice(5) } };
    return { match: { text: selectorStr } };
  }

  private selectorForFill(field: FormFieldMeta): SelectorQuery {
    if (field.semanticsId) return { match: { semanticIdentifier: field.semanticsId } };
    if (field.name) return { match: { name: field.name } };
    if (field.key) return { match: { key: field.key } };
    if (field.ancestorKey) {
      return {
        match: { type: field.type },
        within: { match: { key: field.ancestorKey } },
      };
    }
    if (field.id) return { match: { id: field.id } };
    if (field.hintText) {
      return { match: { textContains: field.hintText }, fallback: { hintText: field.hintText } };
    }
    if (field.label) {
      return { match: { textContains: field.label }, fallback: { semanticsLabel: field.label } };
    }
    return this.parseSelector(field.selector);
  }
}
