import { test, expect } from '@playwright/test';
import { authHeaders } from '../../utils/clerkToken';

const API_URL = process.env.API_URL ?? 'https://collabboard-7xlz.onrender.com';

test.describe('API: authentication and input checks', () => {
  test('TC-019: protected endpoint rejects a request without a token', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/users/me`, { timeout: 60_000 });
    expect(res.status()).toBe(401);
  });

  test('authenticated profile request succeeds', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/users/me`, {
      headers: await authHeaders(), timeout: 60_000,
    });
    expect(res.ok()).toBeTruthy();
  });

  test('TC-008: an invalid invite code is rejected', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/rooms/join/NOT-A-REAL-CODE`, {
      headers: await authHeaders(), timeout: 60_000,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });
});