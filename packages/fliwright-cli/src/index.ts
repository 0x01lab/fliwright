#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCommand } from './commands/run.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { recordCommand } from './commands/record.js';
import { mockStartCommand } from './commands/mock.js';
import {
  flowAgentSpecCommand,
  flowBindFigmaCommand,
  flowCleanCommand,
  flowGenerateTestCommand,
  flowGetCommand,
  flowListCommand,
  flowReviewCaptureFigmaCommand,
  flowReviewPlanCommand,
  flowReviewBundleCommand,
  flowReviewReportCommand,
  flowValidateCommand,
} from './commands/flow.js';
import type { FlowReviewArtifactInput, FlowReviewComparisonInput } from '@fliwright/core';
import { tddCycleCommand, tddStatusCommand, tddSyncCommand } from './commands/tdd.js';
import type { PackageManager } from './commands/init.js';
import {
  appInteractCommand,
  appObserveCommand,
  appScreenshotCommand,
  appStatusCommand,
} from './commands/app.js';
import {
  scenarioApplyCommand,
  scenarioListCommand,
  scenarioResetCommand,
} from './commands/scenario.js';
import {
  mockApplyCommand,
  mockCallsCommand,
  mockClearCommand,
  mockListCommand,
  mockStatusCommand,
} from './commands/mock-management.js';
import { artifactsExportCommand, artifactsShowCommand } from './commands/artifacts.js';
import { mcpConfigCommand, mcpDoctorCommand, mcpServeCommand, type McpProfile } from './commands/mcp.js';
import type { ActionName, NavigationAction } from './capabilities/interaction.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('fliwright')
    .description('AI-native testing framework for Flutter')
    .version('0.1.0');

  program
    .command('run')
    .description('Run Fliwright tests')
    .option('--test <pattern>', 'Test file or glob pattern')
    .option('--test-name <pattern>', 'Run only tests matching this name')
    .option('--vm-url <url>', 'Dart VM Service WebSocket URL')
    .option('--reporter <format>', 'Output format: pretty, json, ai-json, junit')
    .option('--timeout <ms>', 'Per-test timeout in milliseconds')
    .option('--screenshot <mode>', 'Screenshot mode: file, base64, off')
    .option('--recording-mode <mode>', 'Process recording mode: standard, full, off')
    .option('--output <file>', 'Write the AI run report JSON to this file')
    .action(async (opts) => {
      const result = await runCommand({
        testPattern: opts.test,
        testName: opts.testName,
        vmUrl: opts.vmUrl,
        reporter: opts.reporter as 'pretty' | 'json' | 'ai-json' | 'junit',
        timeout: opts.timeout === undefined ? undefined : Number(opts.timeout),
        screenshot: opts.screenshot as 'file' | 'base64' | 'off',
        recordingMode: opts.recordingMode as 'standard' | 'full' | 'off',
        output: opts.output,
      });

      process.exit(result.passed ? 0 : 1);
    });

  program
    .command('init')
    .description('Initialize Fliwright in the current project')
    .option('--no-install', 'Write files only; do not install Node or Flutter dependencies')
    .option('--no-node', 'Skip package.json, scripts, and Node dependency setup')
    .option('--no-flutter', 'Skip Flutter bridge setup')
    .option('--pm <manager>', 'Package manager for Node dependencies: npm, pnpm, yarn, bun')
    .action(async (opts) => {
      if (opts.pm && !isPackageManager(opts.pm)) {
        throw new Error(`Unsupported package manager: ${opts.pm}`);
      }
      await initCommand(process.cwd(), {
        install: opts.install,
        node: opts.node,
        flutter: opts.flutter,
        packageManager: opts.pm,
      });
    });

  program
    .command('doctor')
    .description('Check your Fliwright environment')
    .option('--vm-url <url>', 'Dart VM Service URL for runtime bridge checks')
    .action(async (opts) => {
      await doctorCommand(process.cwd(), { vmServiceUrl: opts.vmUrl });
    });

  program
    .command('record')
    .description('Record user interactions and generate test code')
    .option('--vm-url <url>', 'Dart VM Service WebSocket URL')
    .option('--output <file>', 'Output file path')
    .option('--flow-output <file>', 'Write the editable recording flow JSON to this file')
    .option('--lang <lang>', 'Output language: ts, dart', 'ts')
    .option('--dart-app-entrypoint <uri>', 'Dart app test entrypoint package URI compatible with integration_test')
    .option('--dart-verification <file>', 'Independent Dart compilation and Flutter replay evidence (JSON)')
    .option('--mode <mode>', 'Automation kind: script, test', 'script')
    .option('--scenario <name>', 'Deterministic named scenario required for test mode')
    .option('--assertions <file>', 'Confirmed assertion manifest (JSON) for test mode')
    .option('--verify', 'Replay the recording before promoting it to a verified test')
    .option('--name <name>', 'Test name', 'recorded test')
    .option('--home-route <route>', 'Route to navigate to before each generated TS test', '/')
    .option('--no-reset-home', 'Do not generate a beforeEach hook that navigates to the home route')
    .action(async (opts) => {
      try {
        await recordCommand({
          vmUrl: opts.vmUrl,
          output: opts.output,
          flowOutput: opts.flowOutput,
          lang: opts.lang as 'ts' | 'dart',
          dartAppEntrypoint: opts.dartAppEntrypoint,
          dartVerificationFile: opts.dartVerification,
          mode: opts.mode as 'script' | 'test',
          scenario: opts.scenario,
          assertions: opts.assertions,
          verify: opts.verify,
          testName: opts.name,
          resetToHomeBeforeEach: opts.lang === 'dart' ? undefined : opts.resetHome,
          homeRoute: opts.homeRoute,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program
    .command('mock:start')
    .description('Start the Fliwright tool-side mock controller')
    .option('--host <host>', 'Host to bind', '127.0.0.1')
    .option('--port <port>', 'Port to bind. Defaults to a random free port')
    .option('--mock-dir <dir>', 'Mock directory. Defaults to .fliwright/mocks')
    .action(async (opts) => {
      try {
        await mockStartCommand({
          host: opts.host,
          port: opts.port === undefined ? undefined : Number(opts.port),
          mockDir: opts.mockDir,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  const app = program
    .command('app')
    .description('Observe and interact with a running Flutter app');

  app
    .command('status')
    .description('Check the running app connection and bridge handshake')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(() => appStatusCommand({ vmUrl: opts.vmUrl, cwd: opts.cwd })));

  app
    .command('observe')
    .description('Return concise actionable widgets from the current screen')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--intent <text>', 'Optional interaction intent')
    .option('--roles <roles>', 'Comma-separated semantic roles')
    .option('--limit <count>', 'Maximum candidates', '20')
    .option('--diagnostics', 'Include lightweight diagnostics')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(() => appObserveCommand({
      vmUrl: opts.vmUrl,
      cwd: opts.cwd,
      intent: opts.intent,
      roles: opts.roles,
      limit: Number(opts.limit),
      includeDiagnostics: opts.diagnostics,
    })));

  app
    .command('interact')
    .description('Perform one intent-level app interaction')
    .argument('<operation>', 'tap, type, navigate, wait, drag, or action')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--ref <ref>', 'Snapshot reference')
    .option('--key <key>', 'Widget key fallback')
    .option('--text <text>', 'Visible text fallback')
    .option('--type <type>', 'Widget type fallback')
    .option('--value <value>', 'Text or option value')
    .option('--no-replace', 'Append instead of replacing text')
    .option('--path <path>', 'Navigation route')
    .option('--home-route <route>', 'Home route for resetToHome')
    .option('--navigation-action <action>', 'goto, resetRouteStack, or resetToHome')
    .option('--timeout <ms>', 'Wait timeout')
    .option('--delta-x <pixels>', 'Horizontal drag delta')
    .option('--delta-y <pixels>', 'Vertical drag delta')
    .option('--steps <count>', 'Drag interpolation steps')
    .option('--x <pixels>', 'Raw drag start X')
    .option('--y <pixels>', 'Raw drag start Y')
    .option('--action <name>', 'Extended action name')
    .option('--keyboard-key <key>', 'Key for pressKey')
    .option('--checked <boolean>', 'State for setCheckbox')
    .option('--snapshot', 'Include a post-action snapshot')
    .option('--json', 'Print stable JSON output')
    .action(async (operation, opts) => runJsonCommand(() => appInteractCommand({
      operation,
      vmUrl: opts.vmUrl,
      cwd: opts.cwd,
      ref: opts.ref,
      key: opts.key,
      text: opts.text,
      type: opts.type,
      value: opts.value,
      replace: opts.replace,
      path: opts.path,
      homeRoute: opts.homeRoute,
      navigationAction: opts.navigationAction as NavigationAction | undefined,
      timeout: optionalNumber(opts.timeout),
      deltaX: optionalNumber(opts.deltaX),
      deltaY: optionalNumber(opts.deltaY),
      steps: optionalNumber(opts.steps),
      x: optionalNumber(opts.x),
      y: optionalNumber(opts.y),
      action: opts.action as ActionName | undefined,
      keyboardKey: opts.keyboardKey,
      checked: optionalBoolean(opts.checked),
      includeSnapshot: opts.snapshot,
    })));

  app
    .command('screenshot')
    .description('Capture the running app to a PNG artifact')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--output <file>', 'PNG output path')
    .option('--pixel-ratio <ratio>', 'Screenshot pixel ratio')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(() => appScreenshotCommand({
      vmUrl: opts.vmUrl,
      cwd: opts.cwd,
      output: opts.output,
      pixelRatio: optionalNumber(opts.pixelRatio),
    })));

  const scenario = program
    .command('scenario')
    .description('List, apply, and reset deterministic app scenarios');

  scenario
    .command('list')
    .option('--cwd <dir>', 'Workspace root')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(() => scenarioListCommand({ cwd: opts.cwd })));

  scenario
    .command('apply')
    .argument('<name>', 'Scenario name from fliwright.config.ts')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--mode <mode>', 'attach or managed-start')
    .option('--json', 'Print stable JSON output')
    .action(async (name, opts) => runJsonCommand(() => scenarioApplyCommand({
      name,
      vmUrl: opts.vmUrl,
      cwd: opts.cwd,
      mode: opts.mode,
    })));

  scenario
    .command('reset')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--home-route <route>', 'Route to restore', '/')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(() => scenarioResetCommand({
      vmUrl: opts.vmUrl,
      cwd: opts.cwd,
      homeRoute: opts.homeRoute,
    })));

  const mock = program
    .command('mock')
    .description('Manage deterministic HTTP mock rules');

  mock
    .command('start')
    .option('--host <host>', 'Host to bind', '127.0.0.1')
    .option('--port <port>', 'Port to bind')
    .option('--mock-dir <dir>', 'Mock directory')
    .action(async (opts) => runJsonCommand(() => mockStartCommand({
      host: opts.host,
      port: optionalNumber(opts.port),
      mockDir: opts.mockDir,
    })));

  mock
    .command('list')
    .option('--cwd <dir>', 'Workspace root')
    .option('--mock-dir <dir>', 'Mock directory')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(() => mockListCommand(opts)));

  mock
    .command('status')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--mock-dir <dir>', 'Mock directory')
    .option('--endpoint <path>', 'Filter endpoint')
    .option('--method <method>', 'Filter HTTP method')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(() => mockStatusCommand(opts)));

  mock
    .command('apply')
    .argument('<endpoint>', 'Endpoint path')
    .argument('<rule-name>', 'Rule scenario name')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--mock-dir <dir>', 'Mock directory')
    .option('--method <method>', 'HTTP method')
    .option('--json', 'Print stable JSON output')
    .action(async (endpoint, ruleName, opts) => runJsonCommand(() => mockApplyCommand({
      ...opts,
      endpoint,
      ruleName,
    })));

  mock
    .command('clear')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(() => mockClearCommand(opts)));

  mock
    .command('calls')
    .option('--vm-url <url>', 'Dart VM Service URL')
    .option('--cwd <dir>', 'Workspace root')
    .option('--endpoint <path>', 'Filter endpoint')
    .option('--method <method>', 'Filter HTTP method')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(() => mockCallsCommand(opts)));

  const artifacts = program
    .command('artifacts')
    .description('Inspect and export structured Fliwright run artifacts');

  artifacts
    .command('show')
    .argument('[run-id]', 'Run id; defaults to latest')
    .option('--cwd <dir>', 'Workspace root')
    .option('--runs-root <dir>', 'Runs root override')
    .option('--json', 'Print stable JSON output')
    .action(async (runId, opts) => runJsonCommand(() => artifactsShowCommand({ ...opts, runId })));

  artifacts
    .command('export')
    .argument('[run-id]', 'Run id; defaults to latest')
    .requiredOption('--output <dir>', 'New export destination')
    .option('--cwd <dir>', 'Workspace root')
    .option('--runs-root <dir>', 'Runs root override')
    .option('--allow-partial', 'Export a partial run and list missing files')
    .option('--json', 'Print stable JSON output')
    .action(async (runId, opts) => runJsonCommand(() => artifactsExportCommand({ ...opts, runId })));

  const mcp = program
    .command('mcp')
    .description('Configure or launch the optional MCP adapter');

  mcp
    .command('config')
    .option('--profile <profile>', 'core, development, tdd, flow, or full', 'core')
    .option('--json', 'Print stable JSON output')
    .action(async (opts) => runJsonCommand(async () => mcpConfigCommand({ profile: opts.profile as McpProfile })));

  mcp
    .command('doctor')
    .option('--json', 'Print stable JSON output')
    .action(async () => runJsonCommand(() => mcpDoctorCommand()));

  mcp
    .command('serve')
    .option('--profile <profile>', 'core, development, tdd, flow, or full', 'core')
    .option('--cwd <dir>', 'Workspace root')
    .action(async (opts) => {
      try {
        process.exitCode = await mcpServeCommand({ profile: opts.profile as McpProfile, cwd: opts.cwd });
      } catch (error) {
        exitWithError(error);
      }
    });

  const flow = program
    .command('flow')
    .description('Inspect and edit Fliwright business flow diagrams');

  flow
    .command('list')
    .description('List flow files under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--json', 'Print JSON output')
    .action(async (opts) => {
      try {
        const result = await flowListCommand({ cwd: opts.cwd, json: opts.json });
        if (opts.json) {
          printJson(result);
          return;
        }
        if (result.flows.length === 0) {
          console.log('No flows found.');
          return;
        }
        for (const item of result.flows) {
          const title = item.title ? ` ${item.title}` : '';
          console.log(`${item.id}${title} (${item.nodeCount} nodes, ${item.edgeCount} edges)`);
          console.log(`  ${item.path}`);
        }
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('get')
    .description('Read a flow JSON file by id or path')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--json', 'Print JSON output')
    .action(async (id, opts) => {
      try {
        const result = await flowGetCommand({ cwd: opts.cwd, id, path: opts.path, json: opts.json });
        printJson(opts.json ? result : result.flow);
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('bind-figma')
    .description('Bind a flow node to a Figma design node')
    .argument('<flow-node-id>', 'Flow node id to bind')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--figma-url <url>', 'Figma URL. fileKey and node-id are parsed from it')
    .option('--file-key <key>', 'Figma file key when --figma-url is not provided')
    .option('--figma-node-id <id>', 'Figma node id, e.g. 120:340')
    .option('--name <name>', 'Readable Figma node or frame name')
    .option('--code-connect-id <id>', 'Figma Code Connect id or local mapping key')
    .option('--component-name <name>', 'Expected code component name')
    .option('--json', 'Print JSON output')
    .action(async (flowNodeId, id, opts) => {
      try {
        const result = await flowBindFigmaCommand({
          cwd: opts.cwd,
          id,
          path: opts.path,
          flowNodeId,
          figmaUrl: opts.figmaUrl,
          fileKey: opts.fileKey,
          figmaNodeId: opts.figmaNodeId,
          name: opts.name,
          codeConnectId: opts.codeConnectId,
          componentName: opts.componentName,
          json: opts.json,
        });
        if (opts.json) {
          printJson(result);
          return;
        }
        console.log(`Bound ${result.node.id} to Figma ${result.node.figma?.fileKey}/${result.node.figma?.nodeId}`);
        console.log(`Updated ${result.path}`);
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('agent-spec')
    .description('Build an AI-agent-ready development context spec from a flow')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--json', 'Print JSON output')
    .action(async (id, opts) => {
      try {
        const result = await flowAgentSpecCommand({ cwd: opts.cwd, id, path: opts.path, json: opts.json });
        printJson(opts.json ? result : result.spec);
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('clean')
    .description('Use AI to remove noisy recording nodes from a Fliwright business flow')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--output <file>', 'Write cleaned flow to another file. Defaults to updating the input flow')
    .option('--dry-run', 'Print the clean plan without writing the cleaned flow')
    .option('--ai-provider <provider>', 'AI provider: claude, codex, custom-cli, mock, or none')
    .option('--ai-timeout-ms <ms>', 'AI invocation timeout in milliseconds')
    .option('--protect <node-id>', 'Node id to always keep; repeatable', collectOption, [])
    .option('--instructions <text>', 'Additional cleaning instructions for the AI')
    .option('--json', 'Print JSON output')
    .action(async (id, opts) => {
      try {
        const result = await flowCleanCommand({
          cwd: opts.cwd,
          id,
          path: opts.path,
          outputPath: opts.output,
          dryRun: opts.dryRun,
          aiProvider: opts.aiProvider,
          aiTimeoutMs: opts.aiTimeoutMs === undefined ? undefined : Number(opts.aiTimeoutMs),
          protectedNodeIds: opts.protect,
          instructions: opts.instructions,
          json: opts.json,
        });
        if (opts.json) {
          printJson(result);
          return;
        }
        console.log(`Cleaned ${result.path}`);
        console.log(`Kept ${result.plan.keptNodeIds.length} node(s), removed ${result.plan.removedNodeIds.length} node(s).`);
        if (result.dryRun) {
          console.log('Dry run; no files written.');
        } else {
          console.log(`Updated ${result.outputPath}`);
        }
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('review-plan')
    .description('Build a UI review plan from Figma-bound flow nodes')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--pixel-diff-tolerance <ratio>', 'Allowed visual diff ratio, default 0.03')
    .option('--layout-px-tolerance <px>', 'Allowed layout delta in px, default 4')
    .option('--json', 'Print JSON output')
    .action(async (id, opts) => {
      try {
        const result = await flowReviewPlanCommand({
          cwd: opts.cwd,
          id,
          path: opts.path,
          pixelDiffTolerance: opts.pixelDiffTolerance === undefined ? undefined : Number(opts.pixelDiffTolerance),
          layoutPxTolerance: opts.layoutPxTolerance === undefined ? undefined : Number(opts.layoutPxTolerance),
          json: opts.json,
        });
        printJson(opts.json ? result : result.reviewPlan);
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('review-bundle')
    .description('Build and save a UI review bundle for Figma MCP and Fliwright runtime capture')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--output-dir <dir>', 'Review artifact root directory. Defaults to .fliwright/reviews/<flowId>')
    .option('--output <file>', 'Path to write the review bundle JSON')
    .option('--pixel-diff-tolerance <ratio>', 'Allowed visual diff ratio, default 0.03')
    .option('--layout-px-tolerance <px>', 'Allowed layout delta in px, default 4')
    .option('--json', 'Print JSON output')
    .action(async (id, opts) => {
      try {
        const result = await flowReviewBundleCommand({
          cwd: opts.cwd,
          id,
          path: opts.path,
          outputDir: opts.outputDir,
          outputPath: opts.output,
          pixelDiffTolerance: opts.pixelDiffTolerance === undefined ? undefined : Number(opts.pixelDiffTolerance),
          layoutPxTolerance: opts.layoutPxTolerance === undefined ? undefined : Number(opts.layoutPxTolerance),
          json: opts.json,
        });
        if (opts.json) {
          printJson(result);
          return;
        }
        console.log(`Review bundle written to ${result.outputPath}`);
        console.log(`Figma capture task(s): ${result.bundle.figmaMcp.tasks.length}`);
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('review-capture-figma')
    .description('Capture Figma screenshots for UI review targets through the Figma REST API')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--output-dir <dir>', 'Directory for Figma screenshots. Defaults to .fliwright/reviews/<flowId>/figma')
    .option('--captures-file <file>', 'Path to write figma-captures.json')
    .option('--figma-token <token>', 'Figma access token. Defaults to FIGMA_ACCESS_TOKEN or FIGMA_TOKEN')
    .option('--scale <number>', 'Figma image render scale')
    .option('--pixel-diff-tolerance <ratio>', 'Allowed visual diff ratio, default 0.03')
    .option('--layout-px-tolerance <px>', 'Allowed layout delta in px, default 4')
    .option('--json', 'Print JSON output')
    .action(async (id, opts) => {
      try {
        const result = await flowReviewCaptureFigmaCommand({
          cwd: opts.cwd,
          id,
          path: opts.path,
          outputDir: opts.outputDir,
          capturesFile: opts.capturesFile,
          accessToken: opts.figmaToken,
          scale: opts.scale === undefined ? undefined : Number(opts.scale),
          pixelDiffTolerance: opts.pixelDiffTolerance === undefined ? undefined : Number(opts.pixelDiffTolerance),
          layoutPxTolerance: opts.layoutPxTolerance === undefined ? undefined : Number(opts.layoutPxTolerance),
          json: opts.json,
        });
        if (opts.json) {
          printJson(result);
          return;
        }
        console.log(`Figma captures written to ${result.capturesFile}`);
        const failed = result.captures.filter((capture) => capture.error).length;
        console.log(`Captured ${result.captures.length - failed}/${result.captures.length} Figma screenshot(s).`);
        if (failed > 0) process.exitCode = 1;
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('review-report')
    .description('Build and save a UI review report from runtime and Figma screenshots')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--runtime-capture <node=path>', 'Runtime screenshot capture, repeatable: flowNodeId=/path/runtime.png', collectOption, [])
    .option('--figma-capture <node=path>', 'Figma screenshot capture, repeatable: flowNodeId=/path/figma.png', collectOption, [])
    .option('--runtime-captures-file <file>', 'JSON file containing runtime FlowReviewArtifactInput captures')
    .option('--figma-captures-file <file>', 'JSON file containing Figma FlowReviewArtifactInput captures')
    .option('--comparison-file <file>', 'JSON file containing an array of FlowReviewComparisonInput objects')
    .option('--output <file>', 'Path to write the review report JSON')
    .option('--pixel-diff-tolerance <ratio>', 'Allowed visual diff ratio, default 0.03')
    .option('--layout-px-tolerance <px>', 'Allowed layout delta in px, default 4')
    .option('--pixel-threshold <delta>', 'Per-pixel RGBA delta threshold used by autoCompare. Default 0')
    .option('--no-auto-compare', 'Do not automatically diff runtime/Figma PNG screenshots')
    .option('--json', 'Print JSON output')
    .action(async (id, opts) => {
      try {
        const result = await flowReviewReportCommand({
          cwd: opts.cwd,
          id,
          path: opts.path,
          runtimeCaptures: [
            ...parseCaptureOptions(opts.runtimeCapture),
            ...(opts.runtimeCapturesFile ? await readCaptures(opts.runtimeCapturesFile) : []),
          ],
          figmaCaptures: [
            ...parseCaptureOptions(opts.figmaCapture),
            ...(opts.figmaCapturesFile ? await readCaptures(opts.figmaCapturesFile) : []),
          ],
          comparisons: opts.comparisonFile ? await readComparisons(opts.comparisonFile) : undefined,
          outputPath: opts.output,
          pixelDiffTolerance: opts.pixelDiffTolerance === undefined ? undefined : Number(opts.pixelDiffTolerance),
          layoutPxTolerance: opts.layoutPxTolerance === undefined ? undefined : Number(opts.layoutPxTolerance),
          pixelThreshold: opts.pixelThreshold === undefined ? undefined : Number(opts.pixelThreshold),
          autoCompare: opts.autoCompare,
          json: opts.json,
        });
        if (opts.json) {
          printJson(result);
        } else {
          printReviewReportSummary(result.report);
          console.log(`Report written to ${result.reportPath}`);
        }
        if (result.report.summary.failed > 0 || result.report.summary.missing > 0) process.exitCode = 1;
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('generate-test')
    .description('Generate a Fliwright/Vitest test skeleton from a flow')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--output <file>', 'Write the generated test skeleton to a file')
    .option('--name <name>', 'Generated test name')
    .option('--home-route <route>', 'Route for generated beforeEach reset', '/')
    .option('--reset-home', 'Generate a beforeEach hook that navigates to the home route')
    .option('--no-flow-steps', 'Generate plain code instead of flow.step blocks')
    .option('--json', 'Print JSON output')
    .action(async (id, opts) => {
      try {
        const result = await flowGenerateTestCommand({
          cwd: opts.cwd,
          id,
          path: opts.path,
          outputFile: opts.output,
          testName: opts.name,
          resetToHomeBeforeEach: opts.resetHome,
          homeRoute: opts.homeRoute,
          useFlowSteps: opts.flowSteps,
          json: opts.json,
        });
        if (opts.json) {
          printJson(result);
          return;
        }
        if (result.outputFile) {
          console.log(`Generated test written to ${result.outputFile}`);
          return;
        }
        console.log(result.code);
      } catch (error) {
        exitWithError(error);
      }
    });

  flow
    .command('validate')
    .description('Validate graph integrity and optional Figma/code/review completeness')
    .argument('[id]', 'Flow id under .fliwright/flows')
    .option('--cwd <dir>', 'Workspace root. Defaults to the current working directory')
    .option('--path <file>', 'Direct path to a .flow.json file')
    .option('--require-code-target', 'Warn when Figma-bound nodes lack componentName/codeConnectId')
    .option('--require-review-runtime-entry', 'Warn when Figma-bound nodes lack route/selector/screenshot entry points')
    .option('--json', 'Print JSON output')
    .action(async (id, opts) => {
      try {
        const result = await flowValidateCommand({
          cwd: opts.cwd,
          id,
          path: opts.path,
          requireCodeTargetForFigmaNodes: opts.requireCodeTarget,
          requireReviewRuntimeEntryForFigmaNodes: opts.requireReviewRuntimeEntry,
          json: opts.json,
        });
        if (opts.json) {
          printJson(result);
        } else {
          printValidation(result.validation);
        }
        if (!result.validation.valid) process.exit(1);
      } catch (error) {
        exitWithError(error);
      }
    });

  const tdd = program
    .command('tdd')
    .description('Run and inspect the Fliwright TDD loop');

  tdd
    .command('cycle')
    .description('Start a temporary TDD runtime, focus one test, run one cycle, then stop')
    .requiredOption('--config <path>', 'Vitest config file or project root')
    .requiredOption('--file <path>', 'Focused test file')
    .option('--test-name <name>', 'Focused test name or regex text')
    .option('--vm-url <url>', 'Attach to an already-running Flutter VM Service WebSocket URL')
    .option('--device-id <id>', 'Flutter daemon device id to launch')
    .option('--project-id <path>', 'Flutter project directory/id for app.start')
    .option('--target <path>', 'Flutter target file, usually lib/main.dart')
    .option('--flutter-arg <arg...>', 'Extra flutter run argument(s) for app.start')
    .option('--mode <mode>', 'Flutter daemon app.start mode: run, drive')
    .option('--sync <mode>', 'App sync before the cycle: none, reload, restart, auto', 'none')
    .option('--change <path...>', 'Changed file path(s), used when --sync auto')
    .option('--full-reset', 'Force a full baseline reset')
    .option('--no-auto-escalate', 'Do not retry structural-looking reload failures with restart')
    .option('--timeout <ms>', 'Per-cycle timeout in milliseconds')
    .option('--home-route <route>', 'Scenario home route', '/')
    .option('--reset-category <category...>', 'Scenario reset categories')
    .option('--riverpod-override-json <json...>', 'Riverpod override JSON object(s): { provider | key, value }')
    .option('--mock-profile <name>', 'Mock rule profile to switch during baseline reset')
    .option('--mock-dir <path>', 'Mock rules directory used with --mock-profile')
    .option('--storage-seed-json <json>', 'JSON object passed to the storage reset adapter')
    .option('--status-file <path>', 'Path to write the RuntimeSnapshot status JSON')
    .option('--keep-app-alive', 'Do not stop the daemon-started Flutter app after the cycle')
    .option('--json', 'Print JSON output')
    .action(async (opts) => {
      try {
        const result = await tddCycleCommand({
          configRoot: opts.config,
          file: opts.file,
          testName: opts.testName,
          vmUrl: opts.vmUrl,
          deviceId: opts.deviceId,
          projectId: opts.projectId,
          target: opts.target,
          flutterArgs: opts.flutterArg,
          mode: opts.mode as 'run' | 'drive' | undefined,
          sync: opts.sync as 'none' | 'reload' | 'restart' | 'auto',
          changes: opts.change,
          fullReset: opts.fullReset,
          autoEscalate: opts.autoEscalate,
          timeoutMs: opts.timeout === undefined ? undefined : Number(opts.timeout),
          homeRoute: opts.homeRoute,
          resetCategories: opts.resetCategory,
          riverpodOverrideJson: opts.riverpodOverrideJson,
          mockProfile: opts.mockProfile,
          mockDir: opts.mockDir,
          storageSeedJson: opts.storageSeedJson,
          statusFile: opts.statusFile,
          keepAppAlive: opts.keepAppAlive,
          json: opts.json,
        });
        process.exit(result.result.status === 'green' ? 0 : 1);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  tdd
    .command('sync')
    .description('Start a temporary TDD runtime, manually sync the app, then stop')
    .requiredOption('--config <path>', 'Vitest config file or project root')
    .argument('<mode>', 'Sync mode: none, reload, restart')
    .option('--vm-url <url>', 'Attach to an already-running Flutter VM Service WebSocket URL')
    .option('--device-id <id>', 'Flutter daemon device id to launch')
    .option('--project-id <path>', 'Flutter project directory/id for app.start')
    .option('--target <path>', 'Flutter target file, usually lib/main.dart')
    .option('--flutter-arg <arg...>', 'Extra flutter run argument(s) for app.start')
    .option('--mode <mode>', 'Flutter daemon app.start mode: run, drive')
    .option('--status-file <path>', 'Path to write the RuntimeSnapshot status JSON')
    .option('--keep-app-alive', 'Do not stop the daemon-started Flutter app after the sync')
    .option('--json', 'Print JSON output')
    .action(async (mode, opts) => {
      try {
        await tddSyncCommand({
          configRoot: opts.config,
          vmUrl: opts.vmUrl,
          deviceId: opts.deviceId,
          projectId: opts.projectId,
          target: opts.target,
          flutterArgs: opts.flutterArg,
          mode: opts.mode as 'run' | 'drive' | undefined,
          sync: mode as 'none' | 'reload' | 'restart',
          statusFile: opts.statusFile,
          keepAppAlive: opts.keepAppAlive,
          json: opts.json,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  tdd
    .command('status')
    .description('Read the latest TDD runtime status file')
    .requiredOption('--config <path>', 'Vitest config file or project root')
    .option('--status-file <path>', 'Path to the RuntimeSnapshot status JSON')
    .option('--json', 'Print JSON output')
    .action(async (opts) => {
      try {
        await tddStatusCommand({
          configRoot: opts.config,
          statusFile: opts.statusFile,
          json: opts.json,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return program;
}

async function main(argv = process.argv) {
  const program = createProgram();
  await program.parseAsync(argv);
}

function isPackageManager(value: string): value is PackageManager {
  return value === 'npm' || value === 'pnpm' || value === 'yarn' || value === 'bun';
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function runJsonCommand(operation: () => Promise<unknown>): Promise<void> {
  try {
    printJson(await operation());
  } catch (error) {
    exitWithError(error);
  }
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, got: ${value}`);
  return parsed;
}

function optionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, got: ${value}`);
}

function printValidation(validation: Awaited<ReturnType<typeof flowValidateCommand>>['validation']): void {
  if (validation.issueCount === 0) {
    console.log('Flow is valid.');
    return;
  }
  console.log(`Flow has ${validation.errorCount} error(s) and ${validation.warningCount} warning(s).`);
  for (const issue of validation.issues) {
    const target = issue.nodeId ?? issue.edgeId;
    console.log(`- [${issue.severity}] ${issue.code}${target ? ` ${target}` : ''}: ${issue.message}`);
  }
}

function printReviewReportSummary(report: Awaited<ReturnType<typeof flowReviewReportCommand>>['report']): void {
  const { total, passed, failed, missing, pending } = report.summary;
  console.log(`Review report: ${total} target(s), ${passed} passed, ${failed} failed, ${missing} missing, ${pending} pending.`);
  for (const item of report.items.filter((candidate) => candidate.issues.length > 0)) {
    console.log(`- ${item.flowNodeId} ${item.status}: ${item.issues.join('; ')}`);
  }
}

function collectOption(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parseCaptureOptions(values: string[] | undefined): FlowReviewArtifactInput[] {
  if (!values || values.length === 0) return [];
  return values.map((value) => {
    const separator = value.indexOf('=');
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`Expected capture option in flowNodeId=path format, got: ${value}`);
    }
    return {
      flowNodeId: value.slice(0, separator),
      screenshotPath: value.slice(separator + 1),
    };
  });
}

async function readCaptures(path: string): Promise<FlowReviewArtifactInput[]> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Capture file must contain a JSON array.');
  }
  return parsed as FlowReviewArtifactInput[];
}

async function readComparisons(path: string): Promise<FlowReviewComparisonInput[]> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('--comparison-file must contain a JSON array.');
  }
  return parsed as FlowReviewComparisonInput[];
}

function exitWithError(error: unknown): never {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
