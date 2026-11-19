import { expect, test } from '../../fixtures';
import { AuthPages } from '../../pages/auth.page';
import { PASSWORD } from '../../utils/api';
import { deleteUsers, uniqueEmail } from '../../utils/db';

test.describe('Sign up and sign in', { tag: ['@critical', '@smoke'] }, () => {
  test('a new instructor signs up and lands on their classes', async ({ page, db }) => {
    const email = uniqueEmail('signup');
    try {
      await new AuthPages(page).signUp({ firstName: 'Nora', lastName: 'New', email, password: PASSWORD, role: 'Instructor' });
      await expect(page.getByRole('heading', { name: 'My classes' })).toBeVisible();
      await expect(page).toHaveURL(/\/classes$/);
    } finally {
      await deleteUsers(db, [email]); // made through the UI, so no fixture owns it
    }
  });

  test('a returning user signs in with their password and sees their classes', async ({ page, makeActor }) => {
    // makeActor signs in through the API for its own context; this test signs in through the form on a fresh page.
    const { user } = await makeActor('INSTRUCTOR');
    await new AuthPages(page).signIn(user.email, PASSWORD);
    await expect(page.getByRole('heading', { name: 'My classes' })).toBeVisible();
  });

  test('a wrong password is refused with a clear message and the user stays signed out', async ({ page, makeActor }) => {
    const { user } = await makeActor('STUDENT');
    await new AuthPages(page).signIn(user.email, 'not-the-right-password');
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
    await expect(page).toHaveURL(/\/signin$/);
  });
});
