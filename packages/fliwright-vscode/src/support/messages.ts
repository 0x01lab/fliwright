import type { SupportSettingsDefinition, SupportSettingValue } from '@fliwright/core';

export interface SupportSettingsViewState {
  projects: Array<{ id: string; name: string }>;
  project?: string;
  supports: Array<{ id: string; title: string }>;
  support?: string;
  notice?: string;
  error?: string;
  form?: {
    token: string;
    definition: SupportSettingsDefinition;
    values: Record<string, SupportSettingValue>;
    issues: Record<string, string>;
  };
}

export type SupportSettingsHostMessage = { type: 'state'; state: SupportSettingsViewState; saved?: boolean }
  | { type: 'changed' }
  | { type: 'error'; message: string; field?: string }
  | { type: 'cancelled' };
