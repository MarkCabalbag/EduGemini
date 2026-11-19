import type { Page } from '@playwright/test';

/** The instructor's class screens: the create form and the assignment wizard. */
export class ClassPages {
  constructor(private readonly page: Page) {}

  async createClass(name: string, { attest = true } = {}) {
    await this.page.goto('/classes/new');
    // Ticked before the name: the form checks a field when it loses focus, so an empty name shows "Required" on blur and
    // shifts the checkbox down under a click that came after it.
    if (attest) await this.page.getByLabel(/I have the authority to collect/).check();
    await this.page.getByLabel('Class name').fill(name);
    await this.page.getByRole('button', { name: 'Create class' }).click();
  }

  /** Walks the five wizard steps with the defaults, except the title and criteria, then publishes. */
  async publishNewAssignment(classId: string, title: string, criteria: string) {
    await this.page.goto(`/classes/${classId}?tab=assignments`);
    await this.page.getByRole('link', { name: 'New assignment' }).first().click();
    await this.page.getByLabel('Title').fill(title);
    await this.page.getByRole('button', { name: 'Continue' }).click();
    await this.page.getByLabel('Grading criteria').fill(criteria);
    await this.page.getByRole('button', { name: 'Continue' }).click(); // to Due date and scoring
    await this.page.getByRole('button', { name: 'Continue' }).click(); // to Rules
    await this.page.getByRole('button', { name: 'Continue' }).click(); // to Review
    await this.page.getByRole('button', { name: 'Publish assignment' }).click();
  }
}
