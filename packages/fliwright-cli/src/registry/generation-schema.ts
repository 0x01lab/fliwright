import { z } from 'zod';
export const GenerateTestParamsSchema = z.object({
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

