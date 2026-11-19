import type { Page } from '@playwright/test';
import type { UploadFile } from '../utils/files';

/** The student's screens: the code box on the dashboard and an assignment's upload control. */
export class StudentPages {
  constructor(private readonly page: Page) {}

  async joinWithCode(code: string) {
    await this.page.goto('/classes');
    await this.page.getByLabel('Class code').fill(code);
    await this.page.getByRole('button', { name: 'Join class' }).click();
  }

  async openAssignment(assignmentId: string) {
    await this.page.goto(`/assignments/${assignmentId}`);
  }

  async chooseFiles(files: UploadFile[]) {
    await this.page.getByLabel('Add photos or PDF').setInputFiles(files);
  }

  async submit() {
    await this.page.getByRole('button', { name: 'Submit files' }).click();
  }
}
