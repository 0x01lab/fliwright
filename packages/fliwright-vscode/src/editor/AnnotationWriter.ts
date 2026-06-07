import type { StepAnnotation } from './types';

const ANNOTATION_REGEX = /^(\s*)\/\/ @fliwright-step:\s*(.*)$/;

export class AnnotationWriter {
  updateAnnotation(code: string, annotationLine: number, updates: Partial<StepAnnotation>): string {
    const lines = code.split('\n');
    if (annotationLine < 0 || annotationLine >= lines.length) return code;

    const match = lines[annotationLine].match(ANNOTATION_REGEX);
    if (!match) return code;

    const [, indent, rawJson] = match;

    let existing: StepAnnotation;
    try {
      existing = JSON.parse(rawJson) as StepAnnotation;
    } catch {
      return code;
    }

    const merged = { ...existing, ...updates };
    lines[annotationLine] = `${indent}// @fliwright-step: ${JSON.stringify(merged)}`;

    return lines.join('\n');
  }

  deleteStep(code: string, range: { annotationLine: number; sourceEndLine: number }): string {
    const lines = code.split('\n');
    if (range.annotationLine < 0 || range.annotationLine >= lines.length) return code;

    const deleteCount = range.sourceEndLine - range.annotationLine;
    lines.splice(range.annotationLine, deleteCount);

    return lines.join('\n');
  }
}
