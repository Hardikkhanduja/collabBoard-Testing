import { Page, Locator, expect } from '@playwright/test';

/**
 * The canvas itself is tldraw (client/src/components/canvas/CanvasWrapper.jsx) —
 * it renders to an HTML canvas-backed DOM tree, not simple form elements, so
 * shape drawing is done via keyboard shortcuts + pointer drag rather than
 * fill()/click() on inputs. Shape count is read from tldraw's own DOM nodes
 * (`.tl-shape`), which is more reliable across renders than reaching into
 * the editor's internal store from outside the app.
 */
export class BoardPage {
  readonly page: Page;
  readonly canvas: Locator;
  /** Room name in the top bar. Only has this title for the board's owner. */
  readonly roomNameLabel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.canvas = page.locator('.tl-canvas');
    this.roomNameLabel = page.getByTitle('Click to rename');
  }

  async gotoRoom(roomId: string) {
    await this.page.goto(`/board/${roomId}`);
  }

  /** Waits until the Yjs/Socket.io connection reports "connected". */
  async waitForConnected(timeout = 30_000) {
    await expect(this.page.locator('div[title="connected"]')).toBeVisible({ timeout });
  }

  /** Renames the board via the top-bar name (owner only) and confirms with Enter. */
  async rename(newName: string) {
    await this.roomNameLabel.click();
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.type(newName);
    // Pressing Enter sends the rename to the backend. Wait for the server to confirm it,
    // otherwise a page reload right after could cancel the request before it is saved.
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && /\/api\/rooms\/[^/]+\/?$/.test(new URL(r.url()).pathname),
        { timeout: 60_000 }
      ),
      this.page.keyboard.press('Enter'),
    ]);
    if (response.status() !== 200) {
      throw new Error(
        `Rename failed: PATCH /api/rooms/:id returned ${response.status()}: ${await response.text()}`
      );
    }
  }

  /** An avatar in the top-bar "who is here" list (its title is the user's display name). */
  avatar(displayName: string): Locator {
    return this.page.getByTitle(displayName, { exact: true });
  }

  /** Draws a small rectangle at a fixed canvas position using tldraw's rectangle tool. */
  async drawRectangle(x = 300, y = 300, w = 120, h = 90) {
    await this.canvas.waitFor({ state: 'visible' });
    // Click an empty spot first so the canvas has keyboard focus (tldraw shortcuts need it).
    await this.page.mouse.click(x - 100, y - 100);
    await this.page.keyboard.press('r'); // tldraw shortcut: rectangle tool
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + w, y + h, { steps: 8 });
    await this.page.mouse.up();
  }

  /** Number of shapes currently rendered on the canvas. */
  async shapeCount(): Promise<number> {
    return this.page.locator('.tl-shape').count();
  }

  /** Polls until the shape count reaches `expected`, or times out — used to assert real-time sync. */
  async waitForShapeCount(expected: number, timeout = 15_000) {
    await expect
      .poll(() => this.shapeCount(), { timeout, message: `expected ${expected} shape(s) to sync` })
      .toBeGreaterThanOrEqual(expected);
  }

  /**
   * Persistence check: reloads the page on EVERY attempt until `expected` shapes are
   * rendered. A single reload can land before the server has saved (or before the
   * initial sync finishes), so one empty load must not fail the test on its own.
   */
  async reloadUntilShapeCount(
    expected: number,
    { timeout = 45_000, interval = 3_000 }: { timeout?: number; interval?: number } = {}
  ) {
    await expect
      .poll(
        async () => {
          try {
            await this.page.reload();
            await this.waitForConnected(15_000);
            await this.canvas.waitFor({ state: 'visible', timeout: 15_000 });
            // Let the initial Yjs sync deliver existing shapes before counting.
            await this.page.waitForTimeout(1_500);
            return await this.shapeCount();
          } catch {
            return -1; // this attempt failed to load; try again on the next poll
          }
        },
        {
          timeout,
          intervals: [interval],
          message: `expected ${expected} shape(s) to still be there after reloading`,
        }
      )
      .toBeGreaterThanOrEqual(expected);
  }
}