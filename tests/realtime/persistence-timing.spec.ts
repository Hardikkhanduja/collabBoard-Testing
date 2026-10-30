import { test } from '@playwright/test';
import { HomePage } from '../../pages/HomePage';
import { BoardPage } from '../../pages/BoardPage';

/**
 * How does CollabBoard save a drawing? (found by reading client/src/hooks/useCollaboration.js)
 *  - Live sync goes through Yjs and is held in the server's memory; the server forgets a
 *    board as soon as the last person disconnects.
 *  - The only lasting copy is a snapshot the browser sends with PUT /api/rooms/:id/canvas,
 *    2 seconds after the user's last change. Leaving the page cancels that pending save.
 * These two single-user tests check both sides of that rule. They are deterministic:
 * instead of sleeping, test 1 waits for the real save request to finish.
 */
test.setTimeout(120_000);

const isCanvasSave = (r: import('@playwright/test').Response) =>
    r.request().method() === 'PUT' && /\/api\/rooms\/[^/]+\/canvas\/?$/.test(new URL(r.url()).pathname);

test.describe('Persistence timing (single user)', () => {
    test('a drawing survives leaving and reopening once the save has completed', async ({ page }) => {
        const home = new HomePage(page);
        const board = new BoardPage(page);

        await home.goto();
        const roomId = await home.createBoard(`Persist OK ${Date.now()}`);
        await board.waitForConnected();

        const saved = page.waitForResponse(isCanvasSave, { timeout: 30_000 });
        await board.drawRectangle();
        await board.waitForShapeCount(1);
        const res = await saved; // the app's own debounced save (about 2s after the change)
        if (res.status() !== 200) throw new Error(`Canvas save returned ${res.status()}`);

        await home.goto(); // leave: the board is now empty, the server forgets it
        await board.gotoRoom(roomId); // reopen: the shape can only come from the saved snapshot
        await board.waitForConnected();
        await board.waitForShapeCount(1, 20_000);
    });

    // KNOWN DEFECT (DEF-02): leaving within the 2s save delay cancels the pending save.
    // Marked test.fail() so the suite stays green while the defect is documented; if the app is
    // fixed, Playwright will report "expected to fail, but passed" and the marker can be removed.
    test('a drawing is NOT lost when leaving right after drawing', async ({ page }) => {
        test.fail(true, 'DEF-02: pending 2s debounced save is cancelled when the user leaves');
        const home = new HomePage(page);
        const board = new BoardPage(page);

        await home.goto();
        const roomId = await home.createBoard(`Persist Fast Exit ${Date.now()}`);
        await board.waitForConnected();

        await board.drawRectangle();
        await board.waitForShapeCount(1);

        await home.goto(); // leave immediately, before the 2s save fires
        await board.gotoRoom(roomId);
        await board.waitForConnected();
        await board.waitForShapeCount(1, 15_000);
    });
});