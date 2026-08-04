import { test as base, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const configuredExtensionPath = process.env.BYEBAR_EXTENSION_PATH;
if (configuredExtensionPath && !isAbsolute(configuredExtensionPath)) {
  throw new Error('BYEBAR_EXTENSION_PATH must be absolute');
}
const extensionPath =
  configuredExtensionPath || fileURLToPath(new URL('../dist/stage/chrome/', import.meta.url));

export const test = base.extend({
  context: async ({ playwright }, use, testInfo) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'byebar-playwright-'));
    let context;
    try {
      context = await playwright.chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: testInfo.project.use.headless !== false,
        viewport: { width: 1280, height: 720 },
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
      });
      await use(context);
    } finally {
      try {
        await context?.close();
      } finally {
        await rm(userDataDir, { recursive: true, force: true });
      }
    }
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const stored = await chrome.storage.local.get(null);
        if (typeof stored.enabled === 'boolean' && stored.settingsSchemaVersion) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('ByeBar settings did not initialize');
    });
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).hostname);
  },

  setSettings: async ({ serviceWorker }, use) => {
    await use(async (patch) => {
      await serviceWorker.evaluate(async (values) => {
        await chrome.storage.local.set(values);
      }, patch);
    });
  },

  page: async ({ context }, use) => {
    const page = context.pages()[0] || (await context.newPage());
    await use(page);
  }
});

export { expect };
