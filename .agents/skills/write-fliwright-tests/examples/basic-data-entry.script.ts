import { script } from '@fliwright/vitest';

script('enter a customer profile', async ({ page, flow, logger }) => {
  await flow.step('Open customer form', async () => {
    await page.getByText('Customers').click();
    await page.getBySemantics({ label: 'New customer', role: 'button' }).click();
  });

  await flow.step('Fill required fields', async () => {
    await page.getByKey('customerNameField').fill('Ada Lovelace');
    await page.getByKey('customerEmailField').fill('ada@example.com');
  });

  await flow.step('Save profile', async () => {
    await page.getBySemantics({ label: 'Save', role: 'button' }).click();
    await page.waitFor({ text: 'Ada Lovelace' }, 5_000);
  });

  await flow.frame('Customer profile saved', { screenshot: true, snapshot: true });
  logger.success('Customer profile entered');
});
