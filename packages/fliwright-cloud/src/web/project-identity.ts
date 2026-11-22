export function repoPath(repository: string) {
  return repository
    .replace(/^(?:https?:\/\/|ssh:\/\/)[^/]+\/|^git@[^:]+:/, '')
    .replace(/\/?(?:\.git)?\/?$/, '');
}
