import { describe, expect, it } from 'vitest';
import { figmaBindingFromUrl, parseFigmaUrl } from '../../src/flow/FigmaBinding.js';

describe('FigmaBinding helpers', () => {
  it('parses design URLs and normalizes node ids', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/ABC123/My-File?node-id=120-340')).toEqual({
      fileKey: 'ABC123',
      nodeId: '120:340',
      url: 'https://www.figma.com/design/ABC123/My-File?node-id=120-340',
      editorType: 'design',
    });
  });

  it('uses branch keys for branch design URLs', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/BASE/branch/BRANCH123/My-File?node-id=1-2')).toEqual(expect.objectContaining({
      fileKey: 'BRANCH123',
      nodeId: '1:2',
    }));
  });

  it('parses board, slides, and make URLs', () => {
    expect(parseFigmaUrl('https://figma.com/board/BOARD123/FigJam?node-id=2-4')).toEqual(expect.objectContaining({
      fileKey: 'BOARD123',
      nodeId: '2:4',
      editorType: 'figjam',
    }));
    expect(parseFigmaUrl('https://figma.com/slides/SLIDE123/Deck')).toEqual(expect.objectContaining({
      fileKey: 'SLIDE123',
      editorType: 'slides',
    }));
    expect(parseFigmaUrl('https://figma.com/make/MAKE123/App')).toEqual(expect.objectContaining({
      fileKey: 'MAKE123',
      editorType: 'make',
    }));
  });

  it('creates bindings from urls while preserving optional metadata', () => {
    expect(figmaBindingFromUrl('https://www.figma.com/design/ABC123/File?node-id=1-2', {
      componentName: 'LoginPrompt',
      codeConnectId: 'login-prompt',
    })).toEqual({
      fileKey: 'ABC123',
      nodeId: '1:2',
      url: 'https://www.figma.com/design/ABC123/File?node-id=1-2',
      componentName: 'LoginPrompt',
      codeConnectId: 'login-prompt',
    });
  });

  it('returns null for non-Figma URLs', () => {
    expect(parseFigmaUrl('https://example.com/design/ABC')).toBeNull();
    expect(figmaBindingFromUrl('not a url')).toBeNull();
  });
});
