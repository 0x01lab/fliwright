const SCAN_PORTS = [8181, 9189, 54321];

export interface ResolveOptions {
  cliFlag?: string;
  configUrl?: string;
}

export async function resolveVmUrl(options: ResolveOptions = {}): Promise<string | null> {
  if (options.cliFlag) return options.cliFlag;

  const envUrl = process.env.FLIWRIGHT_VM_URL;
  if (envUrl) return envUrl;

  if (options.configUrl) return options.configUrl;

  return discoverVmServiceUrl();
}

export async function discoverVmServiceUrl(): Promise<string | null> {
  for (const port of SCAN_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return `ws://127.0.0.1:${port}/ws`;
    } catch {
      // Port unreachable — skip
    }
  }
  return null;
}
