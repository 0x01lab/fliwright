import { CliJsonAdapter } from './CliJsonAdapter.js';
import type { AiCliAdapterOptions } from '../types.js';

export class ClaudeCliAdapter extends CliJsonAdapter {
  constructor(options: Omit<AiCliAdapterOptions, 'provider'> = { command: 'claude' }) {
    super({ inputMode: 'stdin-json', ...options, provider: 'claude' });
  }
}
