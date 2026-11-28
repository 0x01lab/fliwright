export type ScreenshotInteraction =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'input'; x: number; y: number; width: number; height: number };

type InteractionKind = ScreenshotInteraction['kind'];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Read only geometry from an archived screenshot interaction. */
export function parseScreenshotInteraction(value: unknown): ScreenshotInteraction | undefined {
  const { kind, x, y, width, height } = record(value) ?? {};
  if (!finiteNumber(x) || !finiteNumber(y)) return;
  if (kind === 'click') return { kind, x, y };
  if (kind === 'input' && finiteNumber(width) && width > 0 && finiteNumber(height) && height > 0) {
    return { kind, x, y, width, height };
  }
}

export function flutterInteractionKind(action: unknown): InteractionKind | undefined {
  switch (action) {
    case 'tap':
    case 'clickAt':
    case 'rightClick':
    case 'focus':
      return 'click';
    case 'type':
    case 'fill':
    case 'clear':
    case 'pressKey':
      return 'input';
  }
}

export function readFlutterInteraction(kind: InteractionKind, response: unknown): ScreenshotInteraction | undefined {
  const result = record(response);
  // The bridge may dismiss the keyboard during target resolution, moving the
  // widget after the pre-action screenshot was taken.
  if (result?.success !== true || result.keyboardDismissed === true) return;
  const target = record(result.target);
  if (kind === 'click' && target?.kind === 'coordinate') {
    return parseScreenshotInteraction({ ...target, kind });
  }
  if (kind === 'input' && target?.kind === 'selector') {
    return parseScreenshotInteraction({ ...record(target.rect), kind });
  }
}
