import type { RecordedOperation } from './types.js';

/** Names are positional and contain neither entered values nor app identifiers. */
export function recordingInputParameters(operations: readonly RecordedOperation[]): Map<number, string> {
  const parameters = new Map<number, string>();
  operations.forEach((operation, index) => {
    if (operation.status !== 'ignored' && operation.kind === 'type' && operation.sensitive) {
      parameters.set(index, recordingInputParameterName(index));
    }
  });
  return parameters;
}

export function recordingInputParameterName(operationIndex: number): string {
  return `FLIWRIGHT_INPUT_${operationIndex + 1}`;
}
