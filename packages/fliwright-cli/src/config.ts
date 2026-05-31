import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { createJiti } from 'jiti';

export interface FliwrightCliConfig {
  vmServiceUrl?: string;
  timeout: number;
  screenshot: 'file' | 'base64' | 'off';
  testDir: string;
  reporter: 'pretty' | 'json' | 'junit';
}

const DEFAULTS: FliwrightCliConfig = {
  timeout: 30000,
  screenshot: 'file',
  testDir: 'tests',
  reporter: 'pretty',
};

export function defineConfig(overrides: Partial<FliwrightCliConfig> = {}): FliwrightCliConfig {
  return { ...DEFAULTS, ...overrides };
}

export async function loadConfig(projectDir: string): Promise<FliwrightCliConfig> {
  const configPath = join(projectDir, 'fliwright.config.ts');

  try {
    await stat(configPath);
  } catch {
    return { ...DEFAULTS };
  }

  const jiti = createJiti(import.meta.url);
  const raw = await jiti.import(configPath) as Record<string, unknown>;
  const loaded = (raw.default ?? raw) as Partial<FliwrightCliConfig>;
  return { ...DEFAULTS, ...loaded };
}
