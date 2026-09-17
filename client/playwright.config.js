import process from 'node:process'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  // One retry on CI only: the shared GitHub runners occasionally miss a
  // 4s-lifetime toast under load. Locally, a flake should stay visible.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5199',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--no-sandbox'] },
  },
})
