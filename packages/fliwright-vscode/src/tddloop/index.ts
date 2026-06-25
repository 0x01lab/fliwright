/**
 * Public surface of the read-only TDD Loop monitor (design spec §4.3 / §5.4 / §10 P1).
 *
 * The monitor renders a `RuntimeSnapshot` produced by the MCP-owned `TddRuntime` without ever
 * creating a second driver (design principle 4). See per-file docblocks for the data-source
 * rationale.
 */
export { TddLoopPanel, renderHtml as renderTddLoopHtml } from './TddLoopPanel.js';
export type { TddLoopPanelInbound, TddLoopPanelOutbound, TddLoopPanelOptions } from './TddLoopPanel.js';
export {
  TddLoopController,
  TDD_LOOP_OPEN_COMMAND,
  TDD_LOOP_REFRESH_COMMAND,
  TDD_LOOP_TAKE_OVER_COMMAND,
  TDD_LOOP_TAKE_OVER_ENABLED_CONFIG,
} from './TddLoopController.js';
export type { TddLoopControllerOptions } from './TddLoopController.js';
export {
  FileTddLoopStatusSource,
  DEFAULT_TDD_STATUS_RELATIVE_PATH,
  normalizeSnapshot,
} from './TddLoopStatusSource.js';
export type { TddLoopStatusSource } from './TddLoopStatusSource.js';
export { toTddLoopViewModel } from './TddLoopViewModel.js';
export type { TddLoopSnapshot, TddLoopViewModel } from './TddLoopViewModel.js';
