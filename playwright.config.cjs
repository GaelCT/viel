const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  outputDir: 'artifacts/browser/results',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node scripts/serve.cjs',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 15000
  }
});
