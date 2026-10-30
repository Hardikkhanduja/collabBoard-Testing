import { Page, Locator, expect } from '@playwright/test';

/**
 * Selectors here are matched against CollabBoard's current source
 * (client/src/pages/Home.jsx on the master branch). The app has no data-testid
 * attributes, so we anchor on placeholder text, titles and accessible
 * role/name, which are the most stable things it exposes. If the UI copy
 * changes, these are the first things to update.
 *
 * Important: the Create Board / Join buttons are always rendered, but clicking
 * them while Clerk is still loading opens a "Sign in to continue" popup instead
 * of the real modal. So every action first waits until the page knows the user
 * is signed in (the Clerk user button is visible).
 */
export class HomePage {
  readonly page: Page;
  readonly createBoardButton: Locator;
  readonly joinWithCodeButton: Locator;
  readonly userButton: Locator;

  // Create Board modal
  readonly boardNameInput: Locator;
  readonly createBoardSubmit: Locator;

  // Join with Code modal
  readonly inviteCodeInput: Locator;
  readonly joinBoardSubmit: Locator;

  // Delete confirmation modal
  readonly confirmDeleteButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createBoardButton = page.getByRole('button', { name: 'Create Board', exact: true });
    this.joinWithCodeButton = page.getByRole('button', { name: 'Join with Code', exact: true });
    this.userButton = page.getByRole('button', { name: 'Open user menu' }); // Clerk's <UserButton />

    this.boardNameInput = page.getByPlaceholder('e.g. Brainstorming Session');
    this.createBoardSubmit = page.getByRole('button', { name: 'Create Board', exact: true });

    this.inviteCodeInput = page.getByPlaceholder('Paste invite code');
    this.joinBoardSubmit = page.getByRole('button', { name: 'Join Board', exact: true });

    this.confirmDeleteButton = page.getByRole('button', { name: 'Delete Board', exact: true });
  }

  async goto() {
    await this.page.goto('/');
  }

  async expectSignedIn() {
    await expect(this.userButton).toBeVisible({ timeout: 30_000 });
  }

  /** Creates a board and waits for navigation to /board/:roomId. Returns the roomId. */
  async createBoard(name: string): Promise<string> {
    await this.expectSignedIn();
    await this.createBoardButton.click();
    await this.boardNameInput.fill(name);
    // The modal's submit button has the same label as the page button; the modal one is last in the DOM.
    // Capture the server's answer to the create request so a failure reports the real
    // HTTP status (e.g. a 500 from the backend) instead of just "navigation timed out".
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/api\/rooms\/?$/.test(new URL(r.url()).pathname),
        { timeout: 60_000 }
      ),
      this.createBoardSubmit.last().click(),
    ]);
    if (response.status() !== 201) {
      throw new Error(
        `Create board failed: POST /api/rooms returned ${response.status()}: ${await response.text()}`
      );
    }
    await this.page.waitForURL(/\/board\/[^/]+/, { timeout: 30_000 });
    const match = this.page.url().match(/\/board\/([^/]+)/);
    if (!match) throw new Error(`Unexpected URL after board creation: ${this.page.url()}`);
    return match[1];
  }
  /** Joins a board via its invite code, using the "Join with Code" modal on Home. */
  async joinBoardByCode(inviteCode: string): Promise<void> {
    await this.expectSignedIn();
    await this.joinWithCodeButton.click();
    await this.inviteCodeInput.fill(inviteCode);
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.request().method() === 'GET' && /\/api\/rooms\/join\//.test(new URL(r.url()).pathname),
        { timeout: 60_000 }
      ),
      this.joinBoardSubmit.last().click(),
    ]);
    if (response.status() !== 200) {
      throw new Error(
        `Join board failed: GET /api/rooms/join/:code returned ${response.status()}: ${await response.text()}`
      );
    }
    await this.page.waitForURL(/\/board\/[^/]+/, { timeout: 30_000 });
  }

  /** The "Recent Boards" card (a div with the `group` class) for a board name. */
  boardCard(boardName: string): Locator {
    return this.page.locator('div.group').filter({ hasText: boardName }).first();
  }

  /** Hovers a board card, clicks its trash icon, then confirms in the Delete modal. */
  async deleteBoard(boardName: string): Promise<void> {
    await this.expectSignedIn();
    const card = this.boardCard(boardName);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.hover(); // the trash icon only fades in on hover
    await card.getByTitle('Delete board').click();
    // Wait for the server's answer to the delete request (the backend can be slow),
    // then for the confirmation popup to close, so callers can assert on a settled page.
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.request().method() === 'DELETE' && /\/api\/rooms\/[^/]+\/?$/.test(new URL(r.url()).pathname),
        { timeout: 60_000 }
      ),
      this.confirmDeleteButton.click(),
    ]);
    if (response.status() !== 204) {
      throw new Error(
        `Delete board failed: DELETE /api/rooms/:id returned ${response.status()}: ${await response.text()}`
      );
    }
    await expect(this.confirmDeleteButton).toBeHidden({ timeout: 15_000 });
  }
}