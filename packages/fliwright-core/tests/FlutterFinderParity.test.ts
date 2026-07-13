import { describe, expect, it, vi } from 'vitest';
import { Page } from '../src/Page.js';
import type { Locator } from '../src/Locator.js';

function createPage() {
  const sendRequest = vi.fn().mockResolvedValue({ matches: [], count: 0 });
  return { page: new Page(sendRequest), sendRequest };
}

async function queryOf(locator: Locator, sendRequest: ReturnType<typeof vi.fn>) {
  await locator.count();
  const [, params] = sendRequest.mock.lastCall as [string, { selector: string }];
  return JSON.parse(params.selector);
}

describe('Flutter finder parity', () => {
  it('maps text, textContaining, regex text, key, type, and subtype finders', async () => {
    const { page, sendRequest } = createPage();

    expect(await queryOf(page.getByText('Sign in'), sendRequest)).toEqual({
      match: { text: 'Sign in' },
    });
    expect(await queryOf(page.getByText('Sign', { match: 'contains' }), sendRequest)).toEqual({
      match: { textContains: 'Sign' },
    });
    expect(await queryOf(page.getByText(/sign in/i), sendRequest)).toEqual({
      match: { textRegex: 'sign in' },
    });
    expect(await queryOf(page.getByKey('submit'), sendRequest)).toEqual({
      match: { key: 'submit' },
    });
    expect(await queryOf(page.getByType('ElevatedButton'), sendRequest)).toEqual({
      match: { type: 'ElevatedButton' },
    });
    expect(await queryOf(page.getBySubtype('StatelessWidget'), sendRequest)).toEqual({
      match: { subtype: 'StatelessWidget' },
    });
  });

  it('maps semantics, icon, and tooltip finders', async () => {
    const { page, sendRequest } = createPage();

    expect(await queryOf(page.getBySemantics({
      identifier: 'settings.save',
      label: 'Save settings',
      hint: 'Persists changes',
      role: 'button',
    }), sendRequest)).toEqual({
      match: {
        semanticIdentifier: 'settings.save',
        semanticsLabel: 'Save settings',
        semanticsHint: 'Persists changes',
        role: 'button',
      },
    });
    expect(await queryOf(page.locator({
      icon: {
        codePoint: 0xe161,
        fontFamily: 'MaterialIcons',
      },
    }), sendRequest)).toEqual({
      match: {
        type: 'Icon',
        iconCodePoint: 0xe161,
        iconFontFamily: 'MaterialIcons',
      },
    });
    expect(await queryOf(page.getByTooltip('Save'), sendRequest)).toEqual({
      match: { tooltip: 'Save' },
    });
  });

  it('provides Fliwright-style helpers for common Flutter finder patterns', async () => {
    const { page, sendRequest } = createPage();
    const saveIcon = {
      codePoint: 0xe161,
      fontFamily: 'MaterialIcons',
    };

    expect(await queryOf(page.getByTextContaining('Sign'), sendRequest)).toEqual({
      match: { textContains: 'Sign' },
    });
    expect(await queryOf(page.getByTextContaining(/sign in/i), sendRequest)).toEqual({
      match: { textRegex: 'sign in' },
    });
    expect(await queryOf(page.getByIcon(saveIcon), sendRequest)).toEqual({
      match: {
        type: 'Icon',
        iconCodePoint: 0xe161,
        iconFontFamily: 'MaterialIcons',
      },
    });
    expect(await queryOf(page.getBySemanticsLabel('Save settings'), sendRequest)).toEqual({
      match: { semanticsLabel: 'Save settings' },
    });
    expect(await queryOf(page.getBySemanticsIdentifier('settings.save'), sendRequest)).toEqual({
      match: { semanticIdentifier: 'settings.save' },
    });
    expect(await queryOf(page.getByWidgetWithText('ListTile', 'Settings'), sendRequest)).toEqual({
      match: { type: 'ListTile' },
      containing: { match: { text: 'Settings' } },
    });
    expect(await queryOf(page.getByWidgetWithIcon('IconButton', saveIcon), sendRequest)).toEqual({
      match: { type: 'IconButton' },
      containing: {
        match: {
          type: 'Icon',
          iconCodePoint: 0xe161,
          iconFontFamily: 'MaterialIcons',
        },
      },
    });
    expect(await queryOf(
      page.getByKey('menu').getByWidgetWithText('ListTile', 'Settings'),
      sendRequest,
    )).toEqual({
      match: { type: 'ListTile' },
      within: { match: { key: 'menu' } },
      containing: { match: { text: 'Settings' } },
    });
  });

  it('scopes each Fliwright-style finder helper to its parent locator', async () => {
    const { page, sendRequest } = createPage();
    const saveIcon = {
      codePoint: 0xe161,
      fontFamily: 'MaterialIcons',
    };

    expect(await queryOf(page.getByKey('menu').getByTextContaining('Sign'), sendRequest)).toEqual({
      match: { textContains: 'Sign' },
      within: { match: { key: 'menu' } },
    });
    expect(await queryOf(page.getByKey('menu').getByIcon(saveIcon), sendRequest)).toEqual({
      match: {
        type: 'Icon',
        iconCodePoint: 0xe161,
        iconFontFamily: 'MaterialIcons',
      },
      within: { match: { key: 'menu' } },
    });
    expect(await queryOf(page.getByKey('menu').getBySemanticsLabel('Save settings'), sendRequest)).toEqual({
      match: { semanticsLabel: 'Save settings' },
      within: { match: { key: 'menu' } },
    });
    expect(await queryOf(page.getByKey('menu').getBySemanticsIdentifier('settings.save'), sendRequest)).toEqual({
      match: { semanticIdentifier: 'settings.save' },
      within: { match: { key: 'menu' } },
    });
    expect(await queryOf(page.getByKey('menu').getByWidgetWithText('ListTile', 'Settings'), sendRequest)).toEqual({
      match: { type: 'ListTile' },
      within: { match: { key: 'menu' } },
      containing: { match: { text: 'Settings' } },
    });
    expect(await queryOf(page.getByKey('menu').getByWidgetWithIcon('IconButton', saveIcon), sendRequest)).toEqual({
      match: { type: 'IconButton' },
      within: { match: { key: 'menu' } },
      containing: {
        match: {
          type: 'Icon',
          iconCodePoint: 0xe161,
          iconFontFamily: 'MaterialIcons',
        },
      },
    });
  });

  it('maps descendant, widgetWithText, and ancestor relationships', async () => {
    const { page, sendRequest } = createPage();

    expect(await queryOf(page.getByType('Form').getByText('Submit'), sendRequest)).toEqual({
      match: { text: 'Submit' },
      within: { match: { type: 'Form' } },
    });
    expect(await queryOf(page.getByType('ListTile').containing({ text: 'Settings' }), sendRequest)).toEqual({
      match: { type: 'ListTile' },
      containing: { match: { text: 'Settings' } },
    });
    expect(await queryOf(page.getByText('Settings').ancestor({ type: 'ListTile' }), sendRequest)).toEqual({
      match: { type: 'ListTile' },
      containing: { match: { text: 'Settings' } },
    });
  });

  it('maps positional finder selection', async () => {
    const { page, sendRequest } = createPage();

    expect(await queryOf(page.getByType('ListTile').first(), sendRequest)).toEqual({
      match: { type: 'ListTile' },
      position: { nth: 0 },
    });
    expect(await queryOf(page.getByType('ListTile').nth(2), sendRequest)).toEqual({
      match: { type: 'ListTile' },
      position: { nth: 2 },
    });
    expect(await queryOf(page.getByType('ListTile').last(), sendRequest)).toEqual({
      match: { type: 'ListTile' },
      position: { last: true },
    });
  });
});
