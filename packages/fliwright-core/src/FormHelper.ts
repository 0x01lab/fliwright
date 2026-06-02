import type {
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
        const skill = registry.match(field);
        const generatedValue = skill
          ? skill.generate(field, options?.locale ?? 'zh_CN')
          : generator.generate(semanticType, field.maxLength);
        return {
          id: field.id,
          semanticType,
          generatedValue,
          selector: field.selector,
          hintText: field.hintText,
          label: field.label,
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
      });
      result.skipped++;
      return;
    }

    if (field.obscureText && (options?.skipObscureFields ?? true)) {
      result.fields.push({
        id: field.id,
        semanticType: semanticTypes.get(field.id) ?? 'password',
        generatedValue: '',
        selector: field.selector,
        status: 'skipped',
      });
      result.skipped++;
      return;
    }

    const semanticType = semanticTypes.get(field.id) ?? 'text';
    const skill = registry.match(field);
    const generatedValue = skill
      ? skill.generate(field, options?.locale ?? 'zh_CN')
      : generator.generate(semanticType, field.maxLength);

    try {
      await this.fillWithFallback(field, generatedValue);
      result.fields.push({
        id: field.id,
        semanticType,
        generatedValue,
        selector: field.selector,
        status: 'filled',
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
      });
    }
  }

  private async fillWithFallback(field: FormFieldMeta, generatedValue: string): Promise<void> {
    const primarySelector = this.selectorForFill(field);
    try {
      await new Locator(primarySelector, this.sendRequest).fill(generatedValue);
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
        await new Locator(fallbackSelector, this.sendRequest).fill(generatedValue);
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(
          `Fill failed. primary=${primarySelectorText}: ${primaryMessage}; fallback=${fallbackSelectorText}: ${fallbackMessage}`,
        );
      }
    }
  }

  private parseSelector(selectorStr: string): SelectorInput {
    if (selectorStr.startsWith('text=')) return { text: selectorStr.slice(5) };
    if (selectorStr.startsWith('key=')) return { key: selectorStr.slice(4) };
    if (selectorStr.startsWith('byType=')) return { type: selectorStr.slice(7) };
    return { text: selectorStr };
  }

  private selectorForFill(field: FormFieldMeta): SelectorInput {
    return field.id ? `id=${field.id}` : this.parseSelector(field.selector);
  }
}
