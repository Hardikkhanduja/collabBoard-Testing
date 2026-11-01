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
  // `||` (not `??`) so an empty value, e.g. a missing CI secret, also falls back to the default.
  email: process.env.TEST_USER2_EMAIL || 'collab.tester2+clerk_test@example.com',
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

// Records every canvas save (PUT /api/rooms/:id/canvas) the browsers send, so tests can report
// what really happened instead of guessing.
const canvasSaves: string[] = [];
function trackSaves(page: Page, who: string) {
  page.on('response', (r) => {
    if (r.request().method() === 'PUT' && /\/api\/rooms\/[^/]+\/canvas\/?$/.test(new URL(r.url()).pathname)) {
      canvasSaves.push(`${who}:${r.status()}`);
    }
  });
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
    trackSaves(pageA, 'A');
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
    trackSaves(pageB, 'B');
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

  test('shapes drawn in a two-user session stay on both canvases', async ({ playwright }) => {
    // KNOWN DEFECT (DEF-03): in a two-user session, drawn shapes disappear from BOTH canvases
    // about 2 seconds after being drawn, even though the app's saves return 200 (the saved
    // snapshot is empty). Marked test.fail() so the suite stays green while it is open; when
    // the app is fixed Playwright reports "expected to fail, but passed" and this line can go.
    test.fail(true, 'DEF-03: shapes drawn in a two-user session disappear within seconds');

    // This test draws its own shape, so it does not depend on earlier tests' timing.
    const aBase = await boardA.shapeCount();
    const bBase = await boardB.shapeCount();
    await boardA.drawRectangle(150, 450, 100, 60);
    await boardA.waitForShapeCount(aBase + 1);
    await boardB.waitForShapeCount(bBase + 1); // live sync works...

    // ...but do the shapes stay? Sample both canvases every 0.5s for 4s.
    const timeline: string[] = [];
    for (let i = 0; i <= 8; i++) {
      timeline.push(`${i * 0.5}s A=${await boardA.shapeCount()} B=${await boardB.shapeCount()}`);
      await pageB.waitForTimeout(500);
    }
    await pageA.screenshot({ path: 'test-results/DEF-03-A-after-wait.png' });
    await pageB.screenshot({ path: 'test-results/DEF-03-B-after-wait.png' });

    // Did the app's own saved snapshot receive any shapes?
    const roomId = pageA.url().match(/\/board\/([^/?#]+)/)![1];
    const api = await playwright.request.newContext({ extraHTTPHeaders: await authHeaders() });
    const res = await api.get(`${API_URL}/api/rooms/${roomId}/canvas`, { timeout: 60_000 });
    const snapshot = await res.json();
    await api.dispose();
    const records = Object.values((snapshot?.document?.store ?? snapshot?.store ?? {}) as Record<string, any>);
    const savedShapes = records.filter((r) => r?.typeName === 'shape').length;

    const aEnd = await boardA.shapeCount();
    const bEnd = await boardB.shapeCount();
    const note =
      `baseline A=${aBase} B=${bBase}; timeline: ${timeline.join(' | ')}; ` +
      `saved in snapshot: ${savedShapes} (GET ${res.status()}); browser saves sent: ${canvasSaves.join(',') || 'none'}`;
    console.log(note);
    test.info().annotations.push({ type: 'DEF-03 evidence', description: note });

    expect(aEnd).toBeGreaterThanOrEqual(aBase + 1);
    expect(bEnd).toBeGreaterThanOrEqual(bBase + 1);
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
    // KNOWN DEFECT (DEF-02): a change made in the 2 seconds before the user leaves is lost.
    // The browser saves a snapshot 2s after the last change and leaving cancels that pending
    // save; the server also forgets the live board when the last user disconnects. This test
    // draws and leaves straight away, so the new shape is not saved. Must stay the LAST test
    // because it closes every page. The exact mechanism is proven in persistence-timing.spec.ts.
    test.fail(true, 'DEF-02: a drawing made within 2s of leaving is lost (pending save cancelled)');

    const roomUrl = pageA.url();
    await boardA.drawRectangle(200, 200, 100, 80);
    await boardA.waitForShapeCount(1);
    const expected = await boardA.shapeCount();

    await pageA.close();
    if (!pageB.isClosed()) await pageB.close();
    await new Promise((r) => setTimeout(r, 5_000)); // let the server forget the empty board

    const fresh = await contextA.newPage();
    const boardFresh = new BoardPage(fresh);
    await fresh.goto(roomUrl);
    await boardFresh.waitForConnected();
    await fresh.waitForTimeout(3_000);
    expect(await boardFresh.shapeCount()).toBeGreaterThanOrEqual(expected);
  });
});