import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationPageSchema, ReadAllResultSchema, TERMS_VERSION, UnreadCountSchema, type Role } from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createLogger } from '../lib/logger';
import { createTestDb } from '../test/test-db';
import { notify } from './notification-service';

// Runs against the test database. Every email carries this run's ID, so tests never collide and cleanup is exact.
const APP_URL = 'http://localhost:5173';
const EMAIL_END = `-${randomUUID().slice(0, 8)}@example.test`;
const MINUTE_MS = 60_000;

const db = createTestDb();

// A fresh app per test: the in-memory rate limits start empty each time.
const build = () =>
  createApp({ env: { APP_URL, STORAGE_BUCKET: 'test-bucket' }, logger: createLogger('silent', 'test'), db, checkDb: async () => {} });

/** A user with a live session, made straight in the database so no password has to be hashed. */
async function signedInUser(name: string, role: Role) {
  const user = await db.user.create({
    data: {
      email: `${name}${EMAIL_END}`,
      firstName: 'Ada',
      lastName: name,
      role,
      termsAcceptedAt: new Date(), // the database requires it (users_terms_required)
      termsVersion: TERMS_VERSION,
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${await createSession(db, user.id)}` };
}
type TestUser = Awaited<ReturnType<typeof signedInUser>>;

const seed = (userId: string, overrides: Partial<Prisma.NotificationUncheckedCreateInput> = {}) =>
  db.notification.create({ data: { userId, type: 'SUBMISSION_GRADED', payload: {}, link: '/assignments/a1', ...overrides } });

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE_MS);

const list = (cookie: string, query = '', app = build()) => request(app).get(`/api/notifications${query}`).set('Cookie', cookie);
const count = (cookie: string, app = build()) => request(app).get('/api/notifications/unread-count').set('Cookie', cookie);
const markOne = (cookie: string, id: string) =>
  request(build()).post(`/api/notifications/${id}/read`).set('Origin', APP_URL).set('Cookie', cookie);
const markAll = (cookie: string) => request(build()).post('/api/notifications/read-all').set('Origin', APP_URL).set('Cookie', cookie);

let made = 0;
let ada: TestUser;
let ben: TestUser;

beforeAll(async () => {
  await db.$connect();
});

// Each test starts with two users who have no notifications, so counts are exact.
beforeEach(async () => {
  ada = await signedInUser(`ada${++made}`, 'STUDENT');
  ben = await signedInUser(`ben${++made}`, 'INSTRUCTOR');
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } }); // sessions and notifications cascade
  await db.$disconnect();
});

describe('notify (the in-app half, TRD §13.1)', () => {
  it('writes one row per recipient with the link and the labels, and no email', async () => {
    await notify(db, 'ASSIGNMENT_PUBLISHED', [ada.user.id, ben.user.id], { link: '/assignments/a1', className: 'Biology 101' });

    for (const { user } of [ada, ben]) {
      const rows = await db.notification.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'ASSIGNMENT_PUBLISHED',
        link: '/assignments/a1',
        payload: { className: 'Biology 101' },
        readAt: null,
        emailStatus: 'SKIPPED',
      });
    }
  });

  it('writes nothing for nobody', async () => {
    await notify(db, 'KEY_NEEDS_ATTENTION', [], { link: '/settings/ai' });
    expect(await db.notification.count({ where: { userId: { in: [ada.user.id, ben.user.id] } } })).toBe(0);
  });

  it('joins the transaction of the event: if the event is undone, so is the notification', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await notify(tx, 'CLASS_DELETED', [ada.user.id], { link: '/classes' });
        throw new Error('the event failed');
      }),
    ).rejects.toThrow('the event failed');

    expect(await db.notification.count({ where: { userId: ada.user.id } })).toBe(0);
  });
});

describe('list notifications (API Spec NTF-01)', () => {
  it('lists the caller newest first, with the title for the type and the class name as the body', async () => {
    const old = await seed(ada.user.id, { type: 'ASSIGNMENT_PUBLISHED', payload: { className: 'Biology 101' }, createdAt: minutesAgo(30) });
    const recent = await seed(ada.user.id, {
      type: 'KEY_NEEDS_ATTENTION',
      link: '/settings/ai',
      createdAt: minutesAgo(5),
      readAt: new Date(),
    });

    const res = await list(ada.cookie);

    expect(res.status).toBe(200);
    const page = NotificationPageSchema.parse(res.body);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.id)).toEqual([recent.id, old.id]);
    expect(page.items[0]).toEqual({
      id: recent.id,
      type: 'KEY_NEEDS_ATTENTION',
      title: 'Gemini key needs attention',
      body: null,
      link: '/settings/ai',
      readAt: recent.readAt?.toISOString(),
      createdAt: recent.createdAt.toISOString(),
    });
    expect(page.items[1]).toMatchObject({ title: 'New assignment published', body: 'Biology 101', readAt: null });
  });

  it('never lists, counts or changes what belongs to someone else', async () => {
    const mine = await seed(ada.user.id);
    await seed(ben.user.id);
    await seed(ben.user.id);

    const res = await list(ada.cookie);

    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([mine.id]);
  });

  it('lists only the unread with unreadOnly=true', async () => {
    const unread = await seed(ada.user.id, { createdAt: minutesAgo(2) });
    await seed(ada.user.id, { createdAt: minutesAgo(1), readAt: new Date() });

    const only = await list(ada.cookie, '?unreadOnly=true');
    const all = await list(ada.cookie, '?unreadOnly=false');

    expect(only.body.items.map((item: { id: string }) => item.id)).toEqual([unread.id]);
    expect(all.body.items).toHaveLength(2);
  });

  it('pages with a cursor: every item once, newest first, also across items made in the same millisecond', async () => {
    const same = minutesAgo(10);
    const ids = [
      (await seed(ada.user.id, { createdAt: minutesAgo(1) })).id,
      (await seed(ada.user.id, { createdAt: minutesAgo(2) })).id,
      (await seed(ada.user.id, { createdAt: same })).id,
      (await seed(ada.user.id, { createdAt: same })).id,
      (await seed(ada.user.id, { createdAt: minutesAgo(20) })).id,
    ];
    const app = build();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await list(ada.cookie, `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, app);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((item: { id: string }) => item.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen[0]).toBe(ids[0]);
    expect(seen[1]).toBe(ids[1]);
    expect(seen[4]).toBe(ids[4]);
  });

  it.each(['?limit=0', '?limit=101', '?unreadOnly=yes', '?cursor=garbage', '?sneaky=1'])(
    'refuses the query %s with VALIDATION',
    async (query) => {
      const res = await list(ada.cookie, query);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    },
  );

  it('needs a session: UNAUTHENTICATED without one', async () => {
    const res = await request(build()).get('/api/notifications');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('is closed to a suspended account', async () => {
    await db.user.update({ where: { id: ada.user.id }, data: { suspendedAt: new Date() } });

    const res = await list(ada.cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('mark one read (API Spec NTF-02)', () => {
  it("marks the recipient's own notification read and answers 204", async () => {
    const row = await seed(ada.user.id);

    const res = await markOne(ada.cookie, row.id);

    expect(res.status).toBe(204);
    expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).not.toBeNull();
  });

  it('is idempotent: again is 204 and keeps the first read time', async () => {
    const row = await seed(ada.user.id);
    await markOne(ada.cookie, row.id);
    const first = (await db.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt;

    const again = await markOne(ada.cookie, row.id);

    expect(again.status).toBe(204);
    expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).toEqual(first);
  });

  it("answers NOT_FOUND for another user's notification, and leaves it unread", async () => {
    const theirs = await seed(ben.user.id);

    const res = await markOne(ada.cookie, theirs.id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await db.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
  });

  it('answers the same NOT_FOUND for one that does not exist', async () => {
    const res = await markOne(ada.cookie, randomUUID());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses an id that is not a UUID with VALIDATION', async () => {
    const res = await markOne(ada.cookie, 'not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('needs the app origin like every mutation: CSRF_ORIGIN without it', async () => {
    const row = await seed(ada.user.id);

    const res = await request(build()).post(`/api/notifications/${row.id}/read`).set('Cookie', ada.cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
  });
});

describe('mark all read (API Spec NTF-03)', () => {
  it('marks every unread notification of the caller, says how many, and touches nobody else', async () => {
    await seed(ada.user.id);
    await seed(ada.user.id);
    await seed(ada.user.id, { readAt: minutesAgo(5) });
    const theirs = await seed(ben.user.id);

    const res = await markAll(ada.cookie);

    expect(res.status).toBe(200);
    expect(ReadAllResultSchema.parse(res.body)).toEqual({ marked: 2 });
    expect(await db.notification.count({ where: { userId: ada.user.id, readAt: null } })).toBe(0);
    expect((await db.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
    expect((await markAll(ada.cookie)).body).toEqual({ marked: 0 });
  });

  it('needs a session', async () => {
    const res = await request(build()).post('/api/notifications/read-all').set('Origin', APP_URL);

    expect(res.status).toBe(401);
  });
});

describe('unread count (API Spec NTF-04)', () => {
  it("counts the caller's unread only", async () => {
    await seed(ada.user.id);
    await seed(ada.user.id);
    await seed(ada.user.id, { readAt: new Date() });
    await seed(ben.user.id);

    const res = await count(ada.cookie);

    expect(res.status).toBe(200);
    expect(UnreadCountSchema.parse(res.body)).toEqual({ count: 2 });
  });

  it.each<Role>(['STUDENT', 'INSTRUCTOR', 'SUPER_ADMIN'])('is open to every signed-in role: %s', async (role) => {
    const user = await signedInUser(`role${++made}`, role);

    expect((await count(user.cookie)).body).toEqual({ count: 0 });
  });

  it('sends an ETag and answers 304 to a repeat until the count changes', async () => {
    const row = await seed(ada.user.id);
    const app = build();

    const first = await count(ada.cookie, app);
    const etag = first.headers['etag'] as string;
    expect(etag).toBeTruthy();

    const same = await request(app).get('/api/notifications/unread-count').set('Cookie', ada.cookie).set('If-None-Match', etag);
    expect(same.status).toBe(304);

    await markOne(ada.cookie, row.id);
    const changed = await request(app).get('/api/notifications/unread-count').set('Cookie', ada.cookie).set('If-None-Match', etag);
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({ count: 0 });
  });

  it('needs a session', async () => {
    expect((await request(build()).get('/api/notifications/unread-count')).status).toBe(401);
  });

  it('rejects a stray query parameter', async () => {
    const res = await request(build()).get('/api/notifications/unread-count?x=1').set('Cookie', ada.cookie);

    expect(res.status).toBe(400);
  });
});

describe('rate limit (API Spec A12)', () => {
  it('gives the four notification routes one budget of 300 a minute, apart from the general 120', async () => {
    const app = build();
    const row = await seed(ada.user.id);

    const first = await list(ada.cookie, '', app);
    const second = await count(ada.cookie, app);
    const third = await request(app).post(`/api/notifications/${row.id}/read`).set('Origin', APP_URL).set('Cookie', ada.cookie);
    const other = await request(app).get('/api/me').set('Cookie', ada.cookie);

    expect(first.headers['ratelimit-limit']).toBe('300');
    expect(first.headers['ratelimit-remaining']).toBe('299');
    expect(second.headers['ratelimit-remaining']).toBe('298');
    expect(third.headers['ratelimit-remaining']).toBe('297'); // one counter shared by every notification route
    expect(other.headers['ratelimit-limit']).toBe('120'); // everything else keeps the general one, which the notification calls did not use
    expect(other.headers['ratelimit-remaining']).toBe('119');
  });
});
