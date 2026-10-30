import { test, expect, APIRequestContext } from '@playwright/test';
import { authHeaders } from '../../utils/clerkToken';

type Room = { id: string; name: string; inviteCode: string };

/**
 * Creates a room through the API for tests that need one to already exist.
 * If creation fails, the error includes the real HTTP status and response body
 * so a failure points at the cause (e.g. a 500 from the server) rather than a
 * confusing "cannot read property of undefined" further down.
 */
async function createRoom(request: APIRequestContext, name: string): Promise<Room> {
  const res = await request.post('/api/rooms', {
    headers: await authHeaders(),
    data: { name },
  });
  if (res.status() !== 201) {
    throw new Error(`Setup failed: POST /api/rooms returned ${res.status()}: ${await res.text()}`);
  }
  return (await res.json()).room as Room;
}

test.describe('Rooms API', () => {
  // The backend sleeps on the free hosting tier; wake it once before the tests
  // so the first real test doesn't pay for the cold start.
  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      baseURL: process.env.API_URL ?? 'https://collabboard-7xlz.onrender.com',
    });
    await ctx.get('/health', { timeout: 90_000 });
    await ctx.dispose();
  });

  test('rejects requests with no auth token', async ({ request }) => {
    const res = await request.get('/api/rooms');
    expect(res.status()).toBe(401);
  });

  test('rejects requests with an invalid token', async ({ request }) => {
    const res = await request.get('/api/rooms', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status()).toBe(401);
  });

  test('creates a room and returns its metadata + invite code', async ({ request }) => {
    const res = await request.post('/api/rooms', {
      headers: await authHeaders(),
      data: { name: `API Test Room ${Date.now()}` },
    });
    expect(res.status(), await res.text()).toBe(201);

    const body = await res.json();
    expect(body.room).toMatchObject({
      id: expect.any(String),
      name: expect.stringContaining('API Test Room'),
      inviteCode: expect.any(String),
    });
    expect(body.inviteCode).toBe(body.room.inviteCode);
  });

  test('rejects room creation with an empty name', async ({ request }) => {
    const res = await request.post('/api/rooms', {
      headers: await authHeaders(),
      data: { name: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('lists rooms the authenticated user is a member of', async ({ request }) => {
    const room = await createRoom(request, `List Test ${Date.now()}`);

    const res = await request.get('/api/rooms', {
      headers: await authHeaders(),
    });
    expect(res.status()).toBe(200);
    const rooms = await res.json();
    expect(rooms.some((r: { id: string }) => r.id === room.id)).toBe(true);
  });

  test('joining by invite code returns the room (idempotent for an existing member)', async ({
    request,
  }) => {
    const room = await createRoom(request, `Join Test ${Date.now()}`);

    const joinRes = await request.get(`/api/rooms/join/${room.inviteCode}`, {
      headers: await authHeaders(),
    });
    expect(joinRes.status()).toBe(200);
    const joined = await joinRes.json();
    expect(joined.id).toBe(room.id);
  });

  test('joining with a bogus invite code returns 404', async ({ request }) => {
    const res = await request.get('/api/rooms/join/not-a-real-code', {
      headers: await authHeaders(),
    });
    expect(res.status()).toBe(404);
  });

  test('the owner can rename a room', async ({ request }) => {
    const room = await createRoom(request, `Rename Test ${Date.now()}`);

    const renameRes = await request.patch(`/api/rooms/${room.id}`, {
      headers: await authHeaders(),
      data: { name: 'Renamed via API' },
    });
    expect(renameRes.status()).toBe(200);
    const updated = await renameRes.json();
    expect(updated.name).toBe('Renamed via API');
  });

  test('canvas state round-trips through PUT then GET', async ({ request }) => {
    const room = await createRoom(request, `Canvas Test ${Date.now()}`);

    const snapshot = { shapes: [{ id: 'shape:1', type: 'rectangle' }] };
    const putRes = await request.put(`/api/rooms/${room.id}/canvas`, {
      headers: await authHeaders(),
      data: snapshot,
    });
    expect(putRes.status()).toBe(200);

    const getRes = await request.get(`/api/rooms/${room.id}/canvas`, {
      headers: await authHeaders(),
    });
    expect(getRes.status()).toBe(200);
    expect(await getRes.json()).toEqual(snapshot);
  });

  test('deleting a room removes it (subsequent GET returns 403/404)', async ({ request }) => {
    const room = await createRoom(request, `Delete Test ${Date.now()}`);

    const delRes = await request.delete(`/api/rooms/${room.id}`, {
      headers: await authHeaders(),
    });
    expect(delRes.status()).toBe(204);

    const getRes = await request.get(`/api/rooms/${room.id}`, {
      headers: await authHeaders(),
    });
    expect([403, 404]).toContain(getRes.status());
  });
});

test.describe('Health check', () => {
  test('GET /health returns ok', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});