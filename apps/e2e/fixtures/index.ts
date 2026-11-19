import { randomUUID } from 'node:crypto';
import { test as base, type APIRequestContext, type Page } from '@playwright/test';
import { createClass, deleteClass, signIn, type CreatedClass } from '../utils/api';
import { deleteUsers, insertUser, openTestDb, type Role, type TestDb, type TestUser } from '../utils/db';
import { WEB_URL } from '../utils/env';

/** A signed-in person: their account, a browser page in their own context, and API access with their session. */
type Actor = { user: TestUser; page: Page; request: APIRequestContext };

type Fixtures = {
  /** Makes a fresh user, signed in through the API (not the UI), in a browser context of their own. */
  makeActor: (role: Role) => Promise<Actor>;
  instructor: Actor;
  student: Actor;
  /** Classes made by `instructor` for this test, deleted afterwards. */
  makeClass: (label?: string) => Promise<CreatedClass>;
};

export const test = base.extend<Fixtures, { db: TestDb }>({
  db: [
    async ({}, use) => {
      const db = openTestDb();
      await use(db);
      await db.$disconnect();
    },
    { scope: 'worker' },
  ],

  makeActor: async ({ browser, db }, use) => {
    const made: { email: string; close: () => Promise<void> }[] = [];
    await use(async (role) => {
      const user = await insertUser(db, role);
      const context = await browser.newContext({ baseURL: WEB_URL });
      made.push({ email: user.email, close: () => context.close() });
      await signIn(context.request, user.email);
      return { user, page: await context.newPage(), request: context.request };
    });
    for (const actor of made) await actor.close();
    await deleteUsers(
      db,
      made.map((actor) => actor.email),
    );
  },

  instructor: async ({ makeActor }, use) => use(await makeActor('INSTRUCTOR')),
  student: async ({ makeActor }, use) => use(await makeActor('STUDENT')),

  makeClass: async ({ instructor }, use) => {
    const made: CreatedClass[] = [];
    await use(async (label = 'Biology') => {
      const cls = await createClass(instructor.request, `${label} ${randomUUID().slice(0, 6)}`);
      made.push(cls);
      return cls;
    });
    for (const cls of made) await deleteClass(instructor.request, cls);
  },
});

export { expect } from '@playwright/test';
