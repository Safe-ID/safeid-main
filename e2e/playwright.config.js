// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Roda contra a cópia local descrita no README desta pasta, nunca contra a produção:
// os testes criam e apagam contas, e o e-mail é lido do log da API.
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: process.env.E2E_SAIDA || 'resultado-e2e.json' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
});
