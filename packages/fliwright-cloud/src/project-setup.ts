/** Derive a clone URL and project name from a GitLab project/clone address. */
export function projectRepositoryDetails(value: string): { repository: string; name: string } | null {
  const input = value.trim();
  const scp = /^git@([^/:\s]+):([^\s]+)$/.exec(input);
  try {
    const url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : input);
    if (!['https:', 'ssh:'].includes(url.protocol) || url.password || (url.protocol === 'https:' && url.username) || url.search || url.hash) return null;
    const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (segments.length < 2 || segments.includes('-')) return null;
    const name = decodeURIComponent(segments.at(-1)!).replace(/\.git$/, '');
    if (!name || name.length > 100 || /[/\\\x00-\x1f]/.test(name)) return null;
    url.pathname = `/${segments.join('/')}`;
    return { repository: url.href, name };
  } catch { return null; }
}

export const projectSetupDefaults = {
  defaultBranch: 'main',
  projectPath: '.',
  entry: 'lib/main.dart',
  suites: { smoke: '.fliwright/tests/**/*.test.ts' },
  scenarios: ['clean'],
  install: [],
  flutterArgs: [],
  requiredCapabilities: [],
  timeoutMs: 1800000,
  repositoryCredentialRef: null,
};
