import { test as setup, Page } from '@playwright/test';
import { clerkSetup, clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_FILE = path.join(__dirname, '..', '.auth', 'user.json');
const TOKEN_FILE = path.join(__dirname, '..', '.auth', 'token.json');

// Clerk's own `clerk.loaded()` helper only waits 10 seconds, which is not always
// enough for the live site, so wait for it ourselves with a more generous limit.
async function waitForClerk(page: Page) {
  await page.waitForFunction(() => !!(window as any).Clerk?.loaded, null, { timeout: 60_000 });
}

setup('authenticate with Clerk', async ({ page }) => {
  setup.setTimeout(180_000);

  // Fetches a Clerk "testing token" so Clerk's bot protection lets automated
  // browsers through during sign-in.
  await clerkSetup({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
    secretKey: process.env.CLERK_SECRET_KEY!,
  });
  await setupClerkTestingToken({ page });

  await page.goto('/');
  await waitForClerk(page);

  // Ticket-based sign-in: Clerk's backend API finds the test user by email and
  // issues a one-time sign-in token. This is Clerk's recommended approach for
  // E2E tests because it skips password / new-device verification steps that
  // can silently stop a normal password sign-in from creating a session.
  await clerk.signIn({
    page,
    emailAddress: process.env.TEST_USER_EMAIL!,
  });

  // Wait until the browser really has an active session before saving anything.
  await page.waitForFunction(() => !!(window as any).Clerk?.session, null, {
    timeout: 15_000,
  });

  // Reload to confirm the session survives a fresh page load, then wait for
  // Clerk to finish loading again before touching it (it loads asynchronously).
  await page.goto('/');
  await waitForClerk(page);
  await page.waitForFunction(() => !!(window as any).Clerk?.session, null, {
    timeout: 15_000,
  });
  await page.context().storageState({ path: AUTH_FILE });

  // Pull the live session JWT so API tests can reuse the same identity as a
  // Bearer token without signing in a second time.
  const token = await page.evaluate(async () => {
    return await (window as any).Clerk?.session?.getToken();
  });

  if (!token) {
    throw new Error(
      'Signed in, but could not read a session token. Check that TEST_USER_EMAIL is the ' +
        'email of the account you created on the live site, and that CLERK_SECRET_KEY / ' +
        'CLERK_PUBLISHABLE_KEY belong to the SAME Clerk app the live site uses.'
    );
  }

  // Clerk session tokens expire after ~60 seconds, so API tests must not reuse
  // this one. We also save the session id, which lets tests ask Clerk's backend
  // for a fresh token whenever they need one (see utils/clerkToken.ts).
  const sessionId = await page.evaluate(() => (window as any).Clerk?.session?.id);

  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, sessionId }, null, 2));
});