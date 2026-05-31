import type { RecordedOperation } from './types.js';

export interface AssertionSuggestion {
  afterIndex: number;
  reason: string;
  template: string;
}

export class AssertionSuggester {
  suggest(operations: RecordedOperation[]): AssertionSuggestion[] {
    const suggestions: AssertionSuggestion[] = [];
    if (operations.length === 0) return suggestions;

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const prev = i > 0 ? operations[i - 1] : null;

      // Rule 1: Tap at top of screen likely navigates
      if (op.kind === 'tap' && op.position.y < 100) {
        suggestions.push({
          afterIndex: i,
          reason: 'possible navigation tap (top of screen)',
          template: '// TODO: Assert expected page content',
        });
        continue;
      }

      // Rule 2: Tap after form input sequence looks like submit
      if (op.kind === 'tap' && hasRecentTypeInput(operations, i)) {
        suggestions.push({
          afterIndex: i,
          reason: 'possible form submit after input',
          template: '// TODO: Assert submission result',
        });
        continue;
      }

      // Rule 3: Drag on list followed by tap = list item selection
      if (op.kind === 'tap' && prev?.kind === 'drag') {
        suggestions.push({
          afterIndex: i,
          reason: 'tap after scroll suggests list item selection',
          template: '// TODO: Assert detail page content',
        });
        continue;
      }

      // Rule 4: Large Y position change after tap suggests navigation
      if (op.kind === 'tap' && i + 1 < operations.length) {
        const next = operations[i + 1];
        if (next.position.y < op.position.y - 200) {
          suggestions.push({
            afterIndex: i,
            reason: 'large Y position change suggests navigation',
            template: '// TODO: Assert expected page loaded',
          });
        }
      }
    }

    return suggestions;
  }
}

function hasRecentTypeInput(
  operations: RecordedOperation[],
  currentIndex: number,
): boolean {
  for (let i = currentIndex - 1; i >= 0; i--) {
    const op = operations[i];
    if (operations[currentIndex].timestamp - op.timestamp > 10000) break;
    if (op.kind === 'type') return true;
  }
  return false;
}
