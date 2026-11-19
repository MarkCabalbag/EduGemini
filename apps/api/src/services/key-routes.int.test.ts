import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KeyStatusSchema, TERMS_VERSION, type Role } from '@edugemini/shared';
import { createApp } from '../app';
import { createSession, SESSION_COOKIE } from '../auth/session';
import { createLogger } from '../lib/logger';
import { keyRouter } from '../routes/key';
import { createTestDb } from '../test/test-db';

// The key routes over HTTP (API Spec KEY-01 to KEY-03), against the test database. The service itself is in key.int.test.ts.
// Every email carries this run's ID, so tests never collide and cleanup is exact (the key rows go with their user).
const APP_URL = 'http://localhost:5173';
const EMAIL_END = `-${randomUUID().slice(0, 8)}@example.test`;
const ENV = { ENCRYPTION_KEY: randomBytes(32).toString('base64'), ENCRYPTION_KEY_VERSION: 1 };

const db = createTestDb();

// A fresh app per request: the in-memory rate limits start empty each time.
const build = () =>
  createApp({
    env: { APP_URL, STORAGE_BUCKET: 'test-bucket' },
    logger: createLogger('silent', 'test'),
    db,
    checkDb: async () => {},
    routers: [keyRouter({ db, env: ENV })],
  });

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

const newApiKey = () => `AIza${randomBytes(18).toString('hex')}`;
const read = (cookie?: string) =>
  cookie ? request(build()).get('/api/me/key').set('Cookie', cookie) : request(build()).get('/api/me/key');
const put = (cookie: string, body: unknown) =>
  request(build())
    .put('/api/me/key')
    .set('Origin', APP_URL)
    .set('Cookie', cookie)
    .send(body as object);
const remove = (cookie: string) => request(build()).delete('/api/me/key').set('Origin', APP_URL).set('Cookie', cookie);
const rowOf = (user: TestUser) => db.instructorKey.findUnique({ where: { instructorId: user.user.id } });

let made = 0;
let ada: TestUser; // an instructor
let ben: TestUser; // another instructor
let sam: TestUser; // a student

beforeAll(async () => {
  await db.$connect();
});

beforeEach(async () => {
  ada = await signedInUser(`ada${++made}`, 'INSTRUCTOR');
  ben = await signedInUser(`ben${++made}`, 'INSTRUCTOR');
  sam = await signedInUser(`sam${++made}`, 'STUDENT');
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_END } } });
  await db.$disconnect();
});

describe('GET /api/me/key (KEY-01)', () => {
  it('says no key is saved when there is none', async () => {
    const res = await read(ada.cookie);

    expect(res.status).toBe(200);
    expect(KeyStatusSchema.parse(res.body)).toEqual({
      connected: false,
      status: null,
      last4: null,
      lastSuccessAt: null,
      disclosureAckAt: null,
    });
  });

  it('gives the last four characters and the acknowledgement time, never the key', async () => {
    const apiKey = newApiKey();
    await put(ada.cookie, { apiKey, disclosureAcknowledged: true });

    const res = await read(ada.cookie);

    const status = KeyStatusSchema.parse(res.body);
    expect(status).toMatchObject({ connected: true, status: null, last4: apiKey.slice(-4), lastSuccessAt: null });
    expect(status.disclosureAckAt).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(apiKey);
  });

  it('shows each instructor their own key only', async () => {
    const adaKey = newApiKey();
    await put(ada.cookie, { apiKey: adaKey, disclosureAcknowledged: true });

    expect((await read(ben.cookie)).body).toMatchObject({ connected: false, last4: null });
    expect((await read(ada.cookie)).body).toMatchObject({ connected: true, last4: adaKey.slice(-4) });
  });

  it('answers 401 with no session and NOT_FOUND to a student, who cannot tell the route exists', async () => {
    expect((await read()).status).toBe(401);
    const student = await read(sam.cookie);
    expect(student.status).toBe(404);
    expect(student.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PUT /api/me/key (KEY-02)', () => {
  it('saves a first key that comes with the acknowledgement, and answers with the status, not the key', async () => {
    const apiKey = newApiKey();

    const res = await put(ada.cookie, { apiKey, disclosureAcknowledged: true });

    expect(res.status).toBe(200);
    expect(KeyStatusSchema.parse(res.body)).toMatchObject({ connected: true, status: null, last4: apiKey.slice(-4) });
    expect(JSON.stringify(res.body)).not.toContain(apiKey);
    const row = await rowOf(ada);
    expect(row?.last4).toBe(apiKey.slice(-4));
    expect(row?.disclosureAckAt).toBeInstanceOf(Date);
  });

  it('refuses a first key without the acknowledgement, with the field named, and stores nothing', async () => {
    for (const body of [{ apiKey: newApiKey() }, { apiKey: newApiKey(), disclosureAcknowledged: false }]) {
      const res = await put(ada.cookie, body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(res.body.error.fields).toHaveProperty('disclosureAcknowledged');
    }
    expect(await rowOf(ada)).toBeNull();
  });

  it('replaces a saved key without asking again, and keeps the first acknowledgement', async () => {
    await put(ada.cookie, { apiKey: newApiKey(), disclosureAcknowledged: true });
    const first = (await rowOf(ada))?.disclosureAckAt;
    const second = newApiKey();

    const res = await put(ada.cookie, { apiKey: second });

    expect(res.status).toBe(200);
    expect(res.body.last4).toBe(second.slice(-4));
    const row = await rowOf(ada);
    expect(row?.last4).toBe(second.slice(-4));
    expect(row?.disclosureAckAt).toEqual(first);
    expect(await db.instructorKey.count({ where: { instructorId: ada.user.id } })).toBe(1);
  });

  it("trims the key, so the last four characters are the key's own", async () => {
    const apiKey = newApiKey();

    const res = await put(ada.cookie, { apiKey: `  ${apiKey}\n`, disclosureAcknowledged: true });

    expect(res.body.last4).toBe(apiKey.slice(-4));
  });

  it('refuses a key that is missing, too short or too long, with the field named', async () => {
    const tooShort = 'a'.repeat(19);
    const tooLong = 'a'.repeat(201);
    for (const body of [{}, { apiKey: '' }, { apiKey: '   ' }, { apiKey: tooShort }, { apiKey: tooLong }, { apiKey: 123 }]) {
      const res = await put(ada.cookie, { ...body, disclosureAcknowledged: true });

      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.fields).toHaveProperty('apiKey');
    }
    expect((await put(ada.cookie, { apiKey: 'a'.repeat(20), disclosureAcknowledged: true })).status).toBe(200); // the edges are in
    expect((await put(ada.cookie, { apiKey: 'a'.repeat(200) })).status).toBe(200);
  });

  it('does not echo a refused key in the error', async () => {
    const tooShort = `SECRET${'x'.repeat(5)}`;

    const res = await put(ada.cookie, { apiKey: tooShort, disclosureAcknowledged: true });

    expect(JSON.stringify(res.body)).not.toContain(tooShort);
  });

  it('answers NOT_FOUND to a student and stores nothing', async () => {
    const res = await put(sam.cookie, { apiKey: newApiKey(), disclosureAcknowledged: true });

    expect(res.status).toBe(404);
    expect(await db.instructorKey.count({ where: { instructorId: sam.user.id } })).toBe(0);
  });

  it('is refused from another origin', async () => {
    const res = await request(build())
      .put('/api/me/key')
      .set('Origin', 'http://evil.example')
      .set('Cookie', ada.cookie)
      .send({ apiKey: newApiKey(), disclosureAcknowledged: true });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
    expect(await rowOf(ada)).toBeNull();
  });

  it("leaves another instructor's key alone", async () => {
    const benKey = newApiKey();
    await put(ben.cookie, { apiKey: benKey, disclosureAcknowledged: true });

    await put(ada.cookie, { apiKey: newApiKey(), disclosureAcknowledged: true });

    expect((await rowOf(ben))?.last4).toBe(benKey.slice(-4));
  });
});

describe('DELETE /api/me/key (KEY-03)', () => {
  it('removes the key, so the status says none is saved, and asks for the acknowledgement again on the next first save', async () => {
    await put(ada.cookie, { apiKey: newApiKey(), disclosureAcknowledged: true });

    const res = await remove(ada.cookie);

    expect(res.status).toBe(204);
    expect(await rowOf(ada)).toBeNull();
    expect((await read(ada.cookie)).body).toMatchObject({ connected: false, last4: null });
    expect((await put(ada.cookie, { apiKey: newApiKey() })).status).toBe(400);
  });

  it("answers 204 when there is no key, and leaves another instructor's key alone", async () => {
    const benKey = newApiKey();
    await put(ben.cookie, { apiKey: benKey, disclosureAcknowledged: true });

    expect((await remove(ada.cookie)).status).toBe(204);

    expect((await rowOf(ben))?.last4).toBe(benKey.slice(-4));
  });

  it('answers NOT_FOUND to a student and 401 with no session', async () => {
    expect((await remove(sam.cookie)).status).toBe(404);
    expect((await request(build()).delete('/api/me/key').set('Origin', APP_URL)).status).toBe(401);
  });
});
