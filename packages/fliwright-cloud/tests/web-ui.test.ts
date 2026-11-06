import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '../src/web/components/ui/button.js';
import { Card } from '../src/web/components/ui/card.js';
import { Input } from '../src/web/components/ui/input.js';
import { NativeSelect } from '../src/web/components/ui/native-select.js';
import { Slider } from '../src/web/components/ui/slider.js';
import { ResultIcon } from '../src/web/ui.js';

const h = React.createElement;

describe('cloud UI composition', () => {
  it('keeps ordinary actions from submitting forms and preserves explicit submit actions', () => {
    const markup = renderToStaticMarkup(
      h(
        'form',
        null,
        h(Button, null, 'Refresh'),
        h(Button, { type: 'submit' }, 'Submit'),
      ),
    );
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>Refresh/);
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>Submit/);
  });

  it('preserves link and section semantics when composing buttons and cards', () => {
    const markup = renderToStaticMarkup(
      h(
        Card,
        { asChild: true },
        h(
          'section',
          { 'aria-label': 'Report' },
          h(Button, { asChild: true }, h('a', { href: '/reports' }, 'Reports')),
        ),
      ),
    );
    expect(markup).toMatch(/^<section[^>]*aria-label="Report"/);
    expect(markup).toContain('href="/reports"');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('type="button"');
  });

  it('retains native field validation and select values', () => {
    const markup = renderToStaticMarkup(
      h(
        'form',
        null,
        h(Input, { name: 'commit', required: true, pattern: '[0-9a-f]{40}' }),
        h(
          NativeSelect,
          { name: 'suite', defaultValue: 'smoke' },
          h('option', { value: 'full' }, 'Full'),
          h('option', { value: 'smoke' }, 'Smoke'),
        ),
      ),
    );
    expect(markup).toContain('required=""');
    expect(markup).toContain('pattern="[0-9a-f]{40}"');
    expect(markup).toContain('name="suite"');
    expect(markup).toMatch(/<option[^>]*value="smoke"[^>]*selected=""/);
  });

  it('labels the focusable timeline thumb with the recorded time description', () => {
    const markup = renderToStaticMarkup(
      h(Slider, {
        value: [2000],
        max: 5000,
        step: 1,
        'aria-label': '定位执行时间',
        'aria-valuetext': '2s，校验欢迎文案',
      }),
    );
    expect(markup).toMatch(/<span[^>]*role="slider"[^>]*aria-valuemax="5000"/);
    expect(markup).toMatch(
      /<span[^>]*role="slider"[^>]*aria-label="定位执行时间"/,
    );
    expect(markup).toContain('aria-valuetext="2s，校验欢迎文案"');
  });

  it('renders successful and failed results as labeled status icons', () => {
    const passed = renderToStaticMarkup(h(ResultIcon, { status: 'passed' }));
    const failed = renderToStaticMarkup(h(ResultIcon, { status: 'failed' }));
    expect(passed).toContain('data-ui="result-icon result-icon-passed"');
    expect(passed).toContain('aria-label="成功"');
    expect(failed).toContain('data-ui="result-icon result-icon-failed"');
    expect(failed).toContain('aria-label="失败"');
  });
});
