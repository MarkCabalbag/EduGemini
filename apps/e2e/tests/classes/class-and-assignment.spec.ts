import { randomUUID } from 'node:crypto';
import { expect, test } from '../../fixtures';
import { ClassPages } from '../../pages/class.page';
import { deleteClass } from '../../utils/api';

test.describe('Class and assignment', { tag: '@critical' }, () => {
  test('an instructor creates a class and publishes an assignment', async ({ instructor }) => {
    const { page, request } = instructor;
    const pages = new ClassPages(page);
    const name = `Chemistry ${randomUUID().slice(0, 6)}`;

    await test.step('create the class', async () => {
      await pages.createClass(name);
      await expect(page.getByRole('heading', { name })).toBeVisible();
    });
    const classId = new URL(page.url()).pathname.split('/').pop()!;

    try {
      await test.step('publish an assignment through the wizard', async () => {
        await pages.publishNewAssignment(classId, 'Lab report 1', 'A clear hypothesis, method and conclusion.');
        await expect(page.getByText('Lab report 1 is published. Approved students can see it now.')).toBeVisible();
      });
    } finally {
      await deleteClass(request, { id: classId, name, joinCode: '' }); // made through the UI, so no fixture owns it
    }
  });

  test('a class cannot be created without a name', async ({ instructor }) => {
    const { page } = instructor;
    await new ClassPages(page).createClass('');
    await expect(page.getByLabel('Class name')).toHaveAccessibleDescription('Required');
    await expect(page).toHaveURL(/\/classes\/new$/);
  });
});
