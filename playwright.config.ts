import { chromium, defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolveChromiumExecutable } from './scripts/playwright-browser.ts';

const executablePath = resolveChromiumExecutable({
  projectRoot: fileURLToPath(new URL('.', import.meta.url)),
  defaultExecutablePath: chromium.executablePath(),
});
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1366, height: 768 },
    headless: true,
    launchOptions: {
      executablePath,
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
