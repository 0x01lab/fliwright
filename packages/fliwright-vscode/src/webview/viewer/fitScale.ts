// packages/fliwright-vscode/src/webview/viewer/fitScale.ts

/**
 * Scale a [naturalW x naturalH] image to fit inside [containerW x containerH],
 * never upscaling beyond 1x. Returns 1 when dimensions are missing/invalid.
 */
export function computeFitScale(
  containerW: number,
  containerH: number,
  naturalW: number,
  naturalH: number,
): number {
  if (containerW <= 0 || containerH <= 0 || naturalW <= 0 || naturalH <= 0) return 1;
  return Math.min(containerW / naturalW, containerH / naturalH, 1);
}
