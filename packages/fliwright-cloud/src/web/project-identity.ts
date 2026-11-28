import { projectRepositoryDetails } from '../project-setup.js';

export function repoPath(repository: string) {
  return repository
    .replace(/^(?:https?:\/\/|ssh:\/\/)[^/]+\/|^git@[^:]+:/, '')
    .replace(/\/?(?:\.git)?\/?$/, '');
}

export function gitLabCaseLinks(repository: string, commit: string, projectPath: string, file: string) {
  const details = projectRepositoryDetails(repository);
  if (!details || !/^[a-f0-9]{40}$/.test(commit)) return undefined;

  const url = new URL(details.repository);
  const host = url.protocol === 'ssh:' ? url.hostname : url.host;
  const base = `https://${host}${url.pathname.replace(/\.git$/, '')}/-`;
  const path = `${projectPath}/${file}`.split('/').filter(segment => segment && segment !== '.');
  if (path.includes('..')) return undefined;
  return { commit: `${base}/commit/${commit}`, file: `${base}/blob/${commit}/${path.map(encodeURIComponent).join('/')}` };
}
