import { CliJsonAdapter } from './CliJsonAdapter.js';
import type { AiCliAdapterOptions } from '../types.js';

export class CodexCliAdapter extends CliJsonAdapter {
  constructor(options: Omit<AiCliAdapterOptions, 'provider'> = { command: 'codex', args: ['exec', '--json'] }) {
    super({ inputMode: 'stdin-json', ...options, provider: 'codex' });
  }
}
