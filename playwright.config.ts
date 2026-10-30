import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.BASE_URL ?? 'https://collab-board-coral.vercel.app';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Real-time sync tests are inherently timing-sensitive (WebSocket propagation),
  // so a small CI retry budget avoids flaking on a slow network hiccup.
  // One worker: the backend is on a free hosting tier with a tiny database
  // connection pool, and parallel tests creating boards at the same time make it
  // time out. Running one test at a time tests the app, not the hosting limits.
  workers: 1,

  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ...(process.env.CI ? ([['github']] as const) : []),
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
  },

  // Auth runs once, writes storageState + a bearer token to .auth/, every other
  // project depends on it so tests never repeat the Clerk sign-in flow.
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      // Signing in depends on Clerk and the live site responding promptly; one
      // automatic retry absorbs an occasional slow response.
      retries: 1,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /api\//,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: '.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /api\//,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: '.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /api\//,
    },
    {
      name: 'api',
      use: {
        baseURL: process.env.API_URL ?? 'https://collabboard-7xlz.onrender.com',
        // The backend runs on a free tier that sleeps when idle and has a small
        // database connection pool, so give each request generous time and run
        // this project's tests one at a time instead of in parallel.
        actionTimeout: 45_000,
      },
      fullyParallel: false,
      timeout: 90_000,
      dependencies: ['setup'],
      testMatch: /api\//,
    },
  ],
});