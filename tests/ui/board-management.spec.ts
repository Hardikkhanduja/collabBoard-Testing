import { test, expect } from '@playwright/test';
import { HomePage } from '../../pages/HomePage';
import { BoardPage } from '../../pages/BoardPage';

// The backend is on a free hosting tier (slow, occasionally asleep), so give
// each UI test more headroom than Playwright's 30s default.
test.setTimeout(90_000);

test.describe('Board management', () => {
  test('creates a board and lands on its canvas', async ({ page }) => {
    const home = new HomePage(page);
    const board = new BoardPage(page);
    const boardName = `QA Board ${Date.now()}`;

    await home.goto();
    await home.expectSignedIn();

    const roomId = await home.createBoard(boardName);
    expect(roomId).toBeTruthy();

    await board.waitForConnected();
    await expect(page).toHaveURL(new RegExp(`/board/${roomId}`));
    await expect(page.getByText(boardName)).toBeVisible();
  });

  test('renamed board persists after reload', async ({ page }) => {
    const home = new HomePage(page);
    const board = new BoardPage(page);
    const originalName = `Rename Me ${Date.now()}`;
    const newName = `Renamed ${Date.now()}`;

    await home.goto();
    await home.createBoard(originalName);
    await board.waitForConnected();

    await board.rename(newName);

    await page.reload();
    await expect(page.getByText(newName)).toBeVisible({ timeout: 45_000 });
  });

  test('deleting a board removes it from the dashboard', async ({ page }) => {
    const home = new HomePage(page);
    const boardName = `Delete Me ${Date.now()}`;

    await home.goto();
    await home.createBoard(boardName);

    await home.goto(); // back to dashboard
    await home.deleteBoard(boardName);

    // The board's card must be gone from the dashboard. (Counting cards avoids matching
    // the same name elsewhere on the page, such as inside the delete confirmation popup.)
    await expect(home.boardCard(boardName)).toHaveCount(0, { timeout: 15_000 });
  });
});