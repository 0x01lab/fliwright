/**
 * Integration test: FormHelper + SemanticInferrer + FakerGenerator + Locator → Protocol
 *
 * Exercises the full form fill pipeline through the real Driver + VMServiceConnector.
 */
import { describe, it, expect } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { createProtocolMock } from './helpers/mockVMService.js';
import type { FormFieldMeta, WidgetInfo } from '../src/types.js';

const FORM_FIELDS: FormFieldMeta[] = [
  {
    id: 'field-email',
    type: 'TextField',
    rect: { x: 10, y: 50, width: 300, height: 48 },
    hintText: 'Email address',
    keyboardType: 'emailAddress',
    obscureText: false,
    enabled: true,
    selector: 'text=Email address',
  },
  {
    id: 'field-password',
    type: 'TextField',
    rect: { x: 10, y: 120, width: 300, height: 48 },
    hintText: 'Password',
    obscureText: true,
    enabled: true,
    selector: 'text=Password',
  },
  {
    id: 'field-submit',
    type: 'ElevatedButton',
    rect: { x: 10, y: 200, width: 300, height: 48 },
    text: 'Submit',
    obscureText: false,
    enabled: true,
    selector: 'text=Submit',
  },
];

const EMAIL_WIDGET: WidgetInfo = {
  id: 'field-email',
  type: 'TextField',
  text: 'Email address',
  rect: { x: 10, y: 50, width: 300, height: 48 },
  properties: {},
};

const SUBMIT_WIDGET: WidgetInfo = {
  id: 'field-submit',
  type: 'ElevatedButton',
  text: 'Submit',
  rect: { x: 10, y: 200, width: 300, height: 48 },
  properties: {},
};

describe('FormHelper Integration', () => {
  it('full form fill: extract → infer → generate data → fill', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver();

    // Mock form extraction
    mock.mockExtension('ext.fliwright.extractForm', () => ({
      fields: FORM_FIELDS,
      count: 3,
    }));

    mock.mockExtension('ext.fliwright.action', () => ({ success: true }));

    await driver.attachMockConnector(mock.ws);

    const result = await driver.page.formHelper.fill({ skipObscureFields: true });

    // Password field should be skipped (obscureText: true, skipObscureFields: true)
    // Submit button has obscureText: false but is a button, not a text field
    // Only email should be filled (password skipped due to obscureText)
    expect(result.filled).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.fields.length).toBe(3);

    // Verify email was filled
    const emailField = result.fields.find(f => f.id === 'field-email');
    expect(emailField).toBeDefined();
    expect(emailField!.status).toBe('filled');
    expect(emailField!.semanticType).toBe('email');
    expect(emailField!.generatedValue).toBeTruthy();

    // Verify password was skipped
    const passwordField = result.fields.find(f => f.id === 'field-password');
    expect(passwordField).toBeDefined();
    expect(passwordField!.status).toBe('skipped');
    expect(passwordField!.semanticType).toBe('password');

    // Verify correct extension calls were made
    const messages = mock.sentMessages();
    const extractCalls = messages.filter(m => m.method === 'ext.fliwright.extractForm');
    expect(extractCalls).toHaveLength(1);

    // Verify fill action was called for email
    const typeCalls = messages.filter(m => m.method === 'ext.fliwright.action' && m.params?.action === 'fill');
    expect(typeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('fillFields() only fills matching fields', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver();

    mock.mockExtension('ext.fliwright.extractForm', () => ({
      fields: FORM_FIELDS,
      count: 3,
    }));

    mock.mockExtension('ext.fliwright.action', () => ({ success: true }));

    await driver.attachMockConnector(mock.ws);

    const result = await driver.page.formHelper.fillFields(['Email'], { skipObscureFields: false });

    // Only email should be filled, rest skipped
    const filled = result.fields.filter(f => f.status === 'filled');
    const skipped = result.fields.filter(f => f.status === 'skipped');
    expect(filled.length).toBeGreaterThanOrEqual(1);
    expect(skipped.length).toBeGreaterThanOrEqual(1);

    // Email should be filled
    const emailField = result.fields.find(f => f.id === 'field-email');
    expect(emailField!.status).toBe('filled');
  });

  it('analyze() returns metadata without filling', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver();

    mock.mockExtension('ext.fliwright.extractForm', () => ({
      fields: FORM_FIELDS,
      count: 3,
    }));

    await driver.attachMockConnector(mock.ws);

    const result = await driver.page.formHelper.analyze();

    expect(result.fields).toHaveLength(3);

    const emailField = result.fields.find(f => f.id === 'field-email');
    expect(emailField).toBeDefined();
    expect(emailField!.semanticType).toBe('email');
    expect(emailField!.generatedValue).toBeTruthy();

    // Verify NO action calls were made
    const messages = mock.sentMessages();
    const actionCalls = messages.filter(m => m.method === 'ext.fliwright.action');
    expect(actionCalls).toHaveLength(0);
  });
});
