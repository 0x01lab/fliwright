import { z } from 'zod';
export const GenerateTestParamsSchema = z.object({
  mode: z.enum(['default', 'red-first']).optional().default('default')
    .describe("Generation mode. Use 'red-first' with spec for TDD-oriented tests."),
  spec: z.object({
    app: z.any().optional(),
    initialState: z.any().optional(),
    elements: z.array(z.any()),
    flows: z.array(z.any()),
    assertions: z.array(z.any()).optional(),
  }).passthrough().optional().describe('InteractionSpec from design/intention parsing for red-first TDD generation'),
  flowId: z.string().optional().describe('Flow id to generate when mode is red-first and spec contains multiple flows'),
  allFlows: z.boolean().optional().default(false)
    .describe('Generate one red-first test for every selected flow in the InteractionSpec'),
  flowIds: z.array(z.string()).optional()
    .describe('Subset of flow ids to generate when allFlows is true'),
  testNamePrefix: z.string().optional()
    .describe('Prefix to apply to generated suite test names when allFlows is true'),
  source: z.string().optional().describe('Flutter/Dart source code of the page or widget to test'),
  snapshot: z.string().optional().describe('Agent-readable snapshot text from fliwright app snapshot'),
  refs: z.array(z.object({
    role: z.string(),
    label: z.string(),
    key: z.string().optional(),
    type: z.string().optional(),
    selector: z.string().optional(),
    textField: z.boolean().optional(),
  })).optional().describe('Structured refs from fliwright app snapshot'),
  description: z.string().optional().describe('Natural language description of what the test should verify'),
  testName: z.string().optional().describe('Name for the generated test'),
  resetToHomeBeforeEach: z.boolean().optional().default(true)
    .describe('Whether to generate a beforeEach hook that navigates to the home route before each test'),
  homeRoute: z.string().optional().default('/')
    .describe('Route used by the generated beforeEach home reset hook'),
  outputFile: z.string().optional().describe('Optional path to write the generated test file'),
});

