import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, 'playwright.env') });

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './playwright-results',
  timeout: 60000,
  retries: 0,
  fullyParallel: false,
  workers: 1,

  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    video: 'on',
    screenshot: 'on',
    trace: 'on',
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
});
