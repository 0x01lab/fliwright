import type { SendRequest } from './types.js';

export type AppEnvironment = 'dev' | 'test' | 'staging' | 'prod' | string;

export interface AppInfo {
  id: string;
  name?: string;
  environment?: AppEnvironment;
  capabilities: string[];
}

export interface AppSnapshot extends AppInfo {
  snapshot: Record<string, unknown>;
}

export interface AppCapabilityDescriptor {
  name: string;
  description?: string;
  methods: string[];
}

export interface AuthStatus {
  isAuthenticated: boolean;
  userId?: string;
  roles?: string[];
  metadata?: Record<string, unknown>;
}

export interface AuthCapability {
  getStatus(): Promise<AuthStatus>;
  signIn?(input?: unknown): Promise<void>;
  signOut?(): Promise<void>;
}

export type AppCapabilityProxy<TCapability extends object = Record<string, unknown>> =
  TCapability & {
    invoke<TInput = unknown, TOutput = unknown>(method: string, input?: TInput): Promise<TOutput>;
  };

export class AppInstance {
  constructor(private readonly sendRequest: SendRequest) {}

  async info(): Promise<AppInfo> {
    const result = unwrapExtensionPayload(
      await this.sendRequest('ext.fliwright.app.info', {}),
    ) as Partial<AppInfo>;
    return {
      id: typeof result.id === 'string' ? result.id : 'app',
      name: typeof result.name === 'string' ? result.name : undefined,
      environment: typeof result.environment === 'string'
        ? result.environment
        : undefined,
      capabilities: Array.isArray(result.capabilities)
        ? result.capabilities.filter((entry): entry is string => typeof entry === 'string')
        : [],
    };
  }

  async getSnapshot<TSnapshot extends Record<string, unknown> = Record<string, unknown>>(): Promise<AppSnapshot & { snapshot: TSnapshot }> {
    const result = unwrapExtensionPayload(
      await this.sendRequest('ext.fliwright.app.snapshot', {}),
    ) as Partial<AppSnapshot>;
    const snapshot = result.snapshot && typeof result.snapshot === 'object' && !Array.isArray(result.snapshot)
      ? result.snapshot as TSnapshot
      : {} as TSnapshot;
    return {
      id: typeof result.id === 'string' ? result.id : 'app',
      name: typeof result.name === 'string' ? result.name : undefined,
      environment: typeof result.environment === 'string'
        ? result.environment
        : undefined,
      capabilities: Array.isArray(result.capabilities)
        ? result.capabilities.filter((entry): entry is string => typeof entry === 'string')
        : [],
      snapshot,
    };
  }

  async listCapabilities(): Promise<AppCapabilityDescriptor[]> {
    const result = unwrapExtensionPayload(
      await this.sendRequest('ext.fliwright.app.capabilities', {}),
    ) as { capabilities?: unknown };
    if (!Array.isArray(result.capabilities)) return [];
    return result.capabilities
      .filter((entry): entry is Record<string, unknown> => entry != null && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name : '',
        description: typeof entry.description === 'string' ? entry.description : undefined,
        methods: Array.isArray(entry.methods)
          ? entry.methods.filter((method): method is string => typeof method === 'string')
          : [],
      }))
      .filter((entry) => entry.name.length > 0);
  }

  async hasCapability(name: string): Promise<boolean> {
    const info = await this.info();
    return info.capabilities.includes(name);
  }

  async getCapability<TCapability extends object = Record<string, unknown>>(
    name: string,
  ): Promise<AppCapabilityProxy<TCapability> | undefined> {
    return await this.hasCapability(name) ? this.capability<TCapability>(name) : undefined;
  }

  async invoke<TInput = unknown, TOutput = unknown>(
    capability: string,
    method: string,
    input?: TInput,
  ): Promise<TOutput> {
    const params: Record<string, unknown> = { capability, method };
    if (input !== undefined) params.input = JSON.stringify(input);
    const result = unwrapExtensionPayload(
      await this.sendRequest('ext.fliwright.app.invoke', params),
    ) as { success?: boolean; error?: unknown; result?: unknown };
    if (result.success === false || result.error != null) {
      const message = typeof result.error === 'string'
        ? result.error
        : `App capability ${capability}.${method} failed`;
      throw new Error(message);
    }
    return result.result as TOutput;
  }

  capability<TCapability extends object = Record<string, unknown>>(
    name: string,
  ): AppCapabilityProxy<TCapability> {
    const target = {
      invoke: <TInput = unknown, TOutput = unknown>(method: string, input?: TInput): Promise<TOutput> => (
        this.invoke<TInput, TOutput>(name, method, input)
      ),
    };
    return new Proxy(target, {
      get(capabilityTarget, property) {
        if (property === 'then') return undefined;
        if (property in capabilityTarget) {
          return capabilityTarget[property as keyof typeof capabilityTarget];
        }
        if (typeof property === 'string') {
          return (input?: unknown) => capabilityTarget.invoke(property, input);
        }
        return undefined;
      },
    }) as AppCapabilityProxy<TCapability>;
  }
}

function unwrapExtensionPayload(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const payload = value as Record<string, unknown>;
    if (
      'success' in payload ||
      'error' in payload ||
      'id' in payload ||
      'capabilities' in payload ||
      'snapshot' in payload
    ) {
      return value;
    }

    const maybeResult = payload.result;
    if (typeof maybeResult === 'string') {
      try {
        return unwrapExtensionPayload(JSON.parse(maybeResult));
      } catch {
        return value;
      }
    }
    if (maybeResult && typeof maybeResult === 'object') {
      return unwrapExtensionPayload(maybeResult);
    }
    const maybeResponse = payload.response;
    if (typeof maybeResponse === 'string') {
      try {
        return unwrapExtensionPayload(JSON.parse(maybeResponse));
      } catch {
        return value;
      }
    }
  }
  return value;
}
