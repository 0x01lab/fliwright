import { AiRuntime } from './AiRuntime.js';
import { resolveAiConfig } from './config.js';
import type {
  AiCallContext,
  AiClassifyRequest,
  AiGenerateRequest,
  AiInspectRequest,
  AiRequest,
  AiResponse,
  AiRuntimeConfig,
  AiVisibleOptions,
} from './types.js';

let configuredConfig: AiRuntimeConfig | undefined;
let sharedRuntime: AiRuntime | undefined;

export function configureAi(config?: AiRuntimeConfig): void {
  configuredConfig = config;
  sharedRuntime = undefined;
}

function getSharedRuntime(): AiRuntime {
  sharedRuntime ??= new AiRuntime(resolveAiConfig(configuredConfig));
  return sharedRuntime;
}

export const ai = {
  ask(request: AiRequest, options?: AiCallContext): Promise<AiResponse> {
    return getSharedRuntime().ask(request, options);
  },

  generate<T = unknown>(request: AiGenerateRequest<T>, options?: AiCallContext): Promise<T> {
    return getSharedRuntime().generate<T>(request, options);
  },

  classify(request: AiClassifyRequest, options?: AiCallContext): Promise<string> {
    return getSharedRuntime().classify(request, options);
  },

  visible(prompt: string, options: AiVisibleOptions & AiCallContext = {}): Promise<void> {
    return getSharedRuntime().visible(prompt, options, options);
  },

  inspect<T = unknown>(request: AiInspectRequest, options: AiCallContext = {}): Promise<T> {
    return getSharedRuntime().inspect<T>(request, options);
  },
};
