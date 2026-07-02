import { describe, expect, it } from 'vitest';
import { FLIWRIGHT_FLOWS_DIR, flowFileName, flowFilePath, sanitizeFlowFileId } from '../../src/flow/FlowFile.js';

describe('flow file helpers', () => {
  it('uses the project-level .fliwright/flows convention', () => {
    expect(FLIWRIGHT_FLOWS_DIR).toBe('.fliwright/flows');
    expect(sanitizeFlowFileId('Checkout Flow!')).toBe('checkout-flow');
    expect(flowFileName('Checkout Flow!')).toBe('checkout-flow.flow.json');
    expect(flowFilePath('/repo/app', 'Checkout Flow!')).toBe('/repo/app/.fliwright/flows/checkout-flow.flow.json');
  });
});
