# CollabBoard Automation Testing Framework

A hybrid UI + API automation testing suite for [CollabBoard](https://collab-board-coral.vercel.app),
built with Playwright + TypeScript, for the 5th-semester Software Testing major project.

## Why this framework

Most classmates automate login/CRUD forms. CollabBoard is a real-time collaborative
app, so its actual risk surface is **sync correctness between multiple users**, not
just single-user form validation. This framework's differentiator is the
`tests/realtime/` suite, which drives two independent, isolated browser contexts
(simulating two real users on the same board at once) and asserts that a shape drawn
by one appears live for the other — the class of bug that single-context automation
can never catch.

## Structure

```
pages/                  Page Object Model classes (HomePage, BoardPage)
tests/
  auth.setup.ts         Runs once: signs in via Clerk, saves session for reuse
  ui/                    Single-user UI flows (create/rename/delete board)
  realtime/              Multi-context real-time sync + presence tests
  api/                   Direct REST API tests against the Express backend
.github/workflows/       CI pipeline (GitHub Actions)
```

## One-time setup

1. `npm install`
2. `npx playwright install --with-deps` (downloads browser binaries — needs real
   internet access, which is why this couldn't run inside the chat sandbox)
3. Copy `.env.example` to `.env` and fill in:
   - `BASE_URL` / `API_URL` — your deployed frontend/backend
   - `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — **use your Clerk project's
     test-mode keys** (`pk_test_...` / `sk_test_...`), not production, while you're
     still building this out
   - `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` — a dedicated test account you create
     in the Clerk dashboard, with the **Email + Password** sign-in strategy enabled
     (social-login-only apps can't be signed into headlessly)

## Running

```bash
npm test              # everything
npm run test:ui       # UI flows only, all 3 browsers
npm run test:api      # API tests only
npm run test:realtime # multi-user sync tests
npm run report        # open the last HTML report
```

## Known risks / things to verify on first real run

- **Selectors are sourced from the actual CollabBoard repo**, not guessed, but the
  app has no `data-testid` attributes, so several locators fall back to text/role
  matching (e.g. board card delete button = "last button inside the card that
  contains this board name"). These are the first things to fix if a test fails on
  a selector rather than real app behavior.
- **The real-time test uses one test account for both simulated users** (two
  browser contexts, same identity) because only one dedicated test account exists
  right now. This still exercises two independent WebSocket connections on the same
  room — where sync bugs actually happen — but if you want to test cross-account
  permission boundaries too, create a second Clerk test user and parameterize
  `multi-user-sync.spec.ts`.
- **tldraw's canvas has no stable DOM testids either** — shape drawing uses the `r`
  keyboard shortcut + mouse drag, and shape count is read via `.tl-shape` node
  count. This is the most likely place to need small fixes after your first run.

## For the project report (Chapter 4)

Each `npx playwright test` run produces:
- An HTML report (`playwright-report/`) — screenshot this for your results chapter
- Screenshots/video/trace on any failure (`test-results/`) — good evidence for your
  defect log
- CI run history on GitHub Actions once pushed — good evidence of continuous testing
