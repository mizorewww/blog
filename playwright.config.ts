import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT || 3011)
const devPort = Number(process.env.PLAYWRIGHT_DEV_PORT || 3010)
const devPreviewParity = process.env.PLAYWRIGHT_DEV_PREVIEW_PARITY === '1'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  webServer: devPreviewParity
    ? [
        {
          command: `yarn preview --no-build --port ${port}`,
          url: `http://127.0.0.1:${port}/zh/`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command: `cross-env NODE_ENV=development INIT_CWD=$PWD next dev --port ${devPort}`,
          url: `http://127.0.0.1:${devPort}/zh/`,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      ]
    : {
        command: `yarn preview --port ${port}`,
        url: `http://127.0.0.1:${port}/zh/`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
