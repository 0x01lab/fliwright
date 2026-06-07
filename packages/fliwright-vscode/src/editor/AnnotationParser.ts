import type { StepModel, AtomicStep, StepAnnotation, ParseResult, ParseError } from './types';

const ANNOTATION_REGEX = /^\s*\/\/ @fliwright-step:\s*(.*)$/;
const TEST_NAME_REGEX = /test\s*\(\s*['"`](.+?)['"`]/;

function detectAction(line: string): AtomicStep['action'] | null {
  const trimmed = line.trim();
  if (trimmed.startsWith('await expect(')) return 'assert';
  if (/\.\bclick\s*\(/.test(trimmed)) return 'click';
  if (/\.\btap\s*\(/.test(trimmed)) return 'tap';
  if (/\.\bfill\s*\(/.test(trimmed)) return 'fill';
  if (/\.\btype\s*\(/.test(trimmed)) return 'type';
  if (/\.\bscroll\s*\(/.test(trimmed)) return 'scroll';
  if (/\.\bdrag\s*\(/.test(trimmed)) return 'drag';
  if (/\.bwaitFor\b/.test(trimmed)) return 'waitFor';
  return null;
}

function extractSelector(line: string): string {
  const match = line.match(/locator\s*\(\s*(\{[^}]+\})\s*\)/);
  return match ? match[1] : '';
}

function extractArgument(line: string, action: AtomicStep['action']): string | undefined {
  if (action === 'fill' || action === 'type') {
    const match = line.match(/\.\b(?:fill|type)\s*\(\s*['"`](.+?)['"`]\s*\)/);
    return match ? match[1] : undefined;
  }
  if (action === 'scroll') {
    const match = line.match(/\.\bscroll\s*\(\s*(\{[^}]+\})\s*\)/);
    return match ? match[1] : undefined;
  }
  return undefined;
}

export class AnnotationParser {
  parse(code: string): ParseResult {
    const lines = code.split('\n');
    const steps: StepModel[] = [];
    const errors: ParseError[] = [];
    let testName: string | undefined;

    const testNameMatch = code.match(TEST_NAME_REGEX);
    if (testNameMatch) {
      testName = testNameMatch[1];
    }

    const annotationLines: { lineIndex: number; raw: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(ANNOTATION_REGEX);
      if (match) {
        annotationLines.push({ lineIndex: i, raw: match[1] });
      }
    }

    for (let i = 0; i < annotationLines.length; i++) {
      const { lineIndex, raw } = annotationLines[i];

      let annotation: StepAnnotation;
      try {
        annotation = JSON.parse(raw) as StepAnnotation;
      } catch {
        errors.push({ line: lineIndex, message: `Invalid JSON in @fliwright-step at line ${lineIndex + 1}` });
        continue;
      }

      const sourceStartLine = lineIndex + 1;
      let rawEndLine = i + 1 < annotationLines.length
        ? annotationLines[i + 1].lineIndex
        : lines.length;

      // Trim trailing blank lines and block-closing lines (e.g. '});')
      // before the next annotation or EOF
      while (rawEndLine > sourceStartLine) {
        const prev = lines[rawEndLine - 1].trim();
        if (prev === '' || prev === '});' || prev === '})') {
          rawEndLine--;
        } else {
          break;
        }
      }

      const sourceEndLine = rawEndLine - 1; // inclusive: index of last non-blank line
      const sourceLines = lines.slice(sourceStartLine, sourceEndLine + 1);
      const sourceCode = sourceLines.join('\n');

      const atoms: AtomicStep[] = [];
      for (let j = sourceStartLine; j <= sourceEndLine; j++) {
        const action = detectAction(lines[j]);
        if (action) {
          atoms.push({
            line: j,
            action,
            selector: extractSelector(lines[j]),
            argument: extractArgument(lines[j], action),
            status: annotation.status ?? 'pending',
          });
        }
      }

      steps.push({
        annotation,
        annotationLine: lineIndex,
        atoms,
        sourceCode,
        sourceStartLine,
        sourceEndLine,
      });
    }

    return { steps, errors, testName };
  }
}
