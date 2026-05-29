import type { FliwrightPlugin, PluginContext } from '@fliwright/core';
import { RiverpodStateAdapter } from './RiverpodStateAdapter.js';

export function riverpodPlugin(): FliwrightPlugin {
  return {
    name: 'riverpod',
    async onInit(context: PluginContext): Promise<void> {
      const adapter = new RiverpodStateAdapter((method, params) => context.sendRequest(method, params));
      context.registerStateAdapter('riverpod', adapter);

      // Wire up event pipeline: VM Service events -> adapter.handleEvent
      context.onEvent((event) => {
        if (event.kind === 'riverpod.stateChanged' && event.data) {
          adapter.handleEvent(
            event.data.providerKey as string,
            event.data.oldValue,
            event.data.newValue,
          );
        }
      });
    },
  };
}
