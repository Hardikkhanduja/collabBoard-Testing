import * as fs from 'fs';
import * as path from 'path';

const TOKEN_FILE = path.join(__dirname, '..', '.auth', 'token.json');

/**
 * Clerk session JWTs only live ~60 seconds. Rather than reusing the one saved
 * during login, ask Clerk's backend API for a brand-new token for the same
 * signed-in session each time one is needed.
 */
export async function getFreshToken(): Promise<string> {
  const { sessionId } = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  if (!sessionId) {
    throw new Error('No sessionId in .auth/token.json - re-run: npx playwright test tests/auth.setup.ts');
  }

  const res = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Clerk token request failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { jwt: string };
  return body.jwt;
}

/** Ready-to-use Authorization header with a fresh token. */
export async function authHeaders(): Promise<{ Authorization: string }> {
  return { Authorization: `Bearer ${await getFreshToken()}` };
}