import { FliwrightDriver } from '@fliwright/core';

let driver: FliwrightDriver | null = null;

export interface SetupOptions {
  vmServiceUrl: string;
}

export async function globalSetup(options: SetupOptions): Promise<void> {
  driver = new FliwrightDriver();
  await driver.connect(options.vmServiceUrl);
}

export function getDriver(): FliwrightDriver | null {
  return driver;
}

export async function globalTeardown(): Promise<void> {
  if (driver) {
    await driver.dispose();
    driver = null;
  }
}
