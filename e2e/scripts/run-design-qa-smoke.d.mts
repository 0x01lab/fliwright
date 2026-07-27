export type DesignQaSmokeRunnerOptions = {
  fetchImpl?: (input: URL, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

export type DesignQaSmokeCommandOptions = {
  vmUrl?: string;
  capture: boolean;
  openPairing: boolean;
  help?: boolean;
};

export function resolveDesignQaVmServiceUrl(
  value: string,
  options?: DesignQaSmokeRunnerOptions,
): Promise<string>;

export function parseArguments(args: string[]): DesignQaSmokeCommandOptions;

export function buildSmokeEnvironment(
  environment: NodeJS.ProcessEnv,
  vmServiceUrl: string,
  capture: boolean,
  openPairing: boolean,
): NodeJS.ProcessEnv;

export function main(options?: {
  args?: string[];
  environment?: NodeJS.ProcessEnv;
}): Promise<void>;
