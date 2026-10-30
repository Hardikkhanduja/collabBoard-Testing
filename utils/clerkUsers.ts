/**
 * Creates / updates dedicated test users through Clerk's Backend API (uses the
 * CLERK_SECRET_KEY from .env). This lets the real-time tests run with TWO
 * different people in the same board, which a single test account cannot do:
 * CollabBoard tracks presence by user id, so two sessions of the same account
 * would count as one user.
 */
const CLERK_API = 'https://api.clerk.com/v1';

function headers() {
    return {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
    };
}

export interface TestUser {
    email: string;
    firstName: string;
    lastName: string;
}

/** Makes sure a Clerk user with this email exists and has the given display name. */
export async function ensureTestUser(user: TestUser): Promise<void> {
    const find = await fetch(`${CLERK_API}/users?email_address=${encodeURIComponent(user.email)}`, {
        headers: headers(),
    });
    if (!find.ok) {
        throw new Error(`Clerk user lookup failed: ${find.status} ${await find.text()}`);
    }
    const existing = (await find.json()) as Array<{
        id: string;
        first_name: string | null;
        last_name: string | null;
    }>;

    if (existing.length > 0) {
        const current = existing[0];
        if (current.first_name !== user.firstName || current.last_name !== user.lastName) {
            const update = await fetch(`${CLERK_API}/users/${current.id}`, {
                method: 'PATCH',
                headers: headers(),
                body: JSON.stringify({ first_name: user.firstName, last_name: user.lastName }),
            });
            if (!update.ok) {
                throw new Error(`Clerk user update failed: ${update.status} ${await update.text()}`);
            }
        }
        return;
    }

    const create = await fetch(`${CLERK_API}/users`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            email_address: [user.email],
            first_name: user.firstName,
            last_name: user.lastName,
            // Sign-in in tests uses a ticket, so this password is never used again.
            password: `Qa-${Math.random().toString(36).slice(2)}-Zx9!`,
            skip_password_checks: true,
        }),
    });
    if (!create.ok) {
        throw new Error(`Clerk user creation failed: ${create.status} ${await create.text()}`);
    }
}