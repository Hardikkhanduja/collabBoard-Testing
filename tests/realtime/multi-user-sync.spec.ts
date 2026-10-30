import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { clerkSetup, clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import { HomePage } from '../../pages/HomePage';
import { BoardPage } from '../../pages/BoardPage';
import { ensureTestUser } from '../../utils/clerkUsers';
import { authHeaders } from '../../utils/clerkToken';

/**
 * Real-time collaboration needs TWO different people in the same board.
 * - User A: your main test account (TEST_USER_EMAIL).
 * - User B: a second account this suite creates in Clerk automatically.
 * Each gets their own browser context (like two separate laptops).
 * CollabBoard counts presence per user id, so two sessions of the SAME account
 * would show as one person - that is why a second account is needed.
 */
const BASE_URL = process.env.BASE_URL ?? 'https://collab-board-coral.vercel.app';
const API_URL = process.env.API_URL ?? 'https://collabboard-7xlz.onrender.com';

const USER_B = {
  email: process.env.TEST_USER2_EMAIL ?? 'collab.tester2+clerk_test@example.com',
  firstName: 'Riya',
  lastName: 'Tester',
};
const USER_B_NAME = `${USER_B.firstName} ${USER_B.lastName}`;

async function newSignedInContext(browser: Browser, email: string): Promise<BrowserContext> {
  // Explicitly empty storage: this context must start signed out.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await clerkSetup({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
    secretKey: process.env.CLERK_SECRET_KEY!,
  });
  await setupClerkTestingToken({ page });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!(window as any).Clerk?.loaded, null, { timeout: 60_000 });

  // If a session already exists, keep it only when it is the right person; otherwise sign out first.
  const current: string | null = await page.evaluate(
    () => (window as any).Clerk?.user?.primaryEmailAddress?.emailAddress ?? null
  );
  if (current?.toLowerCase() !== email.toLowerCase()) {
    if (current) {
      await page.evaluate(() => (window as any).Clerk.signOut());
    }
    await clerk.signIn({ page, emailAddress: email });
  }
  await page.waitForFunction(() => !!(window as any).Clerk?.session, null, { timeout: 30_000 });
  await page.close();
  return context;
}

test.describe('Real-time multi-user sync', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(150_000);

  let browser: Browser;
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let boardA: BoardPage;
  let boardB: BoardPage;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(240_000);
    await ensureTestUser(USER_B);
    browser = await chromium.launch();
    contextA = await newSignedInContext(browser, process.env.TEST_USER_EMAIL!);
    contextB = await newSignedInContext(browser, USER_B.email);

    // A creates a board.
    pageA = await contextA.newPage();
    boardA = new BoardPage(pageA);
    const home = new HomePage(pageA);
    await home.goto();
    const roomId = await home.createBoard(`Sync Test ${Date.now()}`);
    await boardA.waitForConnected();

    // B joins using the invite code (the real way a collaborator gets in).
    const api = await playwright.request.newContext({ extraHTTPHeaders: await authHeaders() });
    const res = await api.get(`${API_URL}/api/rooms/${roomId}`, { timeout: 60_000 });
    const body = await res.json();
    const inviteCode: string = body.inviteCode ?? body.room?.inviteCode;
    expect(inviteCode, 'room should expose an invite code').toBeTruthy();
    await api.dispose();

    pageB = await contextB.newPage();
    boardB = new BoardPage(pageB);
    const homeB = new HomePage(pageB);
    // The app creates a new user's database row with a background GET /api/users/me right
    // after sign-in. Joining before that finishes gives "401 User not found" (a real race in
    // the app, logged as a finding), so wait for it before joining.
    const profileSynced = pageB.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/users/me' && r.ok(),
      { timeout: 90_000 }
    );
    await homeB.goto();
    await profileSynced;
    await homeB.joinBoardByCode(inviteCode);
    await boardB.waitForConnected();
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
    await browser?.close();
  });

  test('presence: A sees B in the board, B sees A', async () => {
    await expect(boardA.avatar(USER_B_NAME)).toBeVisible({ timeout: 20_000 });
  });

  test('a shape drawn by user A appears live for user B', async () => {
    await boardB.canvas.waitFor({ state: 'visible' });
    const before = await boardB.shapeCount();
    await boardA.drawRectangle();
    await boardB.waitForShapeCount(before + 1);
  });

  test('a shape drawn by user B appears live for user A (both directions)', async () => {
    const before = await boardA.shapeCount();
    await boardB.drawRectangle(500, 400, 100, 80);
    await boardA.waitForShapeCount(before + 1);
  });

  test('drawn shapes persist: a fresh reload still shows them', async () => {
    // KNOWN DEFECT (DEF-03): shapes are not restored after a reload, even with A still
    // connected and ~12 reload attempts over 20s. test.fail() keeps the suite green while the
    // bug is open; once the app is fixed this test "unexpectedly passes" and Playwright
    // flags it, which is the signal to delete this line.
    test.fail(true, 'DEF-03: canvas shapes are not restored when a client reloads the board');

    const expected = await boardA.shapeCount();
    expect(expected).toBeGreaterThanOrEqual(2);
    await boardB.reloadUntilShapeCount(expected, { timeout: 20_000 });
  });

  test('diagnostic: record what the original user sees after reloading', async () => {
    // Never fails. It records evidence for the defect report: if A also loses the shapes
    // after a reload, new clients are not receiving the existing canvas.
    const beforeReload = await boardA.shapeCount();
    await pageA.reload();
    await boardA.waitForConnected();
    await boardA.canvas.waitFor({ state: 'visible' });
    await pageA.waitForTimeout(3_000);
    const afterReload = await boardA.shapeCount();

    const note = `User A shapes before reload: ${beforeReload}, after reload: ${afterReload}`;
    console.log(note);
    test.info().annotations.push({ type: 'DEF-03 evidence', description: note });
  });

  test('presence updates when B leaves', async () => {
    await pageB.close();
    await expect(boardA.avatar(USER_B_NAME)).toHaveCount(0, { timeout: 20_000 });
  });

  test('drawn shapes survive when everyone leaves and the board is reopened', async () => {
    // KNOWN DEFECT (DEF-02): the server keeps the canvas only in an in-memory Map
    // (server yjs provider) and deletes it when the last user disconnects, so an emptied
    // board loses its drawing. Must stay the LAST test because it closes every page.
    test.fail(true, 'DEF-02: board contents are deleted when the last user leaves');

    const roomUrl = pageA.url();
    await boardA.drawRectangle(200, 200, 100, 80);
    await boardA.waitForShapeCount(1);
    const expected = await boardA.shapeCount();

    await pageA.close();
    if (!pageB.isClosed()) await pageB.close();
    await new Promise((r) => setTimeout(r, 5_000));  

    const fresh = await contextA.newPage();
    const boardFresh = new BoardPage(fresh);
    await fresh.goto(roomUrl);
    await boardFresh.waitForConnected();
    await fresh.waitForTimeout(3_000);
    expect(await boardFresh.shapeCount()).toBeGreaterThanOrEqual(expected);
  });
});