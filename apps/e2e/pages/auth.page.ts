import type { Page } from '@playwright/test';

/** The sign-in and sign-up forms. Locators only: assertions stay in the tests. */
export class AuthPages {
  constructor(private readonly page: Page) {}

  async signIn(email: string, password: string) {
    await this.page.goto('/signin');
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password', { exact: true }).fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }

  async signUp(details: { firstName: string; lastName: string; email: string; password: string; role: 'Student' | 'Instructor' }) {
    await this.page.goto('/signup');
    await this.page.getByLabel('First name').fill(details.firstName);
    await this.page.getByLabel('Last name').fill(details.lastName);
    await this.page.getByLabel('Email').fill(details.email);
    await this.page.getByLabel('Password', { exact: true }).fill(details.password);
    await this.page.getByLabel(details.role === 'Instructor' ? 'I am an Instructor' : 'I am a Student').check();
    await this.page.getByLabel(/I accept the Terms/).check();
    await this.page.getByRole('button', { name: 'Create account' }).click();
  }
}
