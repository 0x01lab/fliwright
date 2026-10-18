import { z } from 'zod';
import { CliError, type CommandRegistry } from '../CommandRegistry.js';
import { sessionOpenCommand, sessionListCommand, sessionRequest } from '../session/client.js';
import { str, bool } from './finite.js';
export function registerSessions(registry: CommandRegistry) {
  registry.add({ path: 'session.open', description: 'Open an explicit local connection host', effects: ['local-worker', 'app-connection'],
    input: z.object({ vmUrl: str, deviceId: str, target: str, config: str, projectId: str, flutterArgs: z.array(z.string()).optional(), scenario: str }),
    execute: (input, context) => {
      if (input.vmUrl && input.deviceId) throw new CliError('INVALID_INPUT', 'Choose vmUrl or deviceId.', 2);
      return sessionOpenCommand({ ...input, cwd: context.cwd }, context.signal);
    } });
  registry.add({ path: 'session.list', description: 'Probe local project connection sessions', effects: [], input: z.object({}), execute: (_input, context) => sessionListCommand(context.cwd) });
  for (const type of ['status', 'close', 'reconnect', 'cancel'] as const) registry.add({
    path: `session.${type}`, description: `Connection session ${type}`, effects: type === 'status' ? [] : ['session-state'],
    input: z.object(type === 'cancel' ? { operationId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/) } : type === 'close' ? { keepAppAlive: bool } : type === 'status' ? { operationId: str } : {}), execute: (input, context) => {
      const session = context.session ?? process.env.FLIWRIGHT_SESSION;
      if (!session) throw new CliError('SESSION_REQUIRED', 'Pass --session or FLIWRIGHT_SESSION.', 2);
      return sessionRequest(context.cwd, session, { type, ...input }, context.signal);
    },
  });
}
