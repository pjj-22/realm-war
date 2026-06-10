import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5199',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--no-sandbox'] },
  },
})
