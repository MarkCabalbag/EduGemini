import { expect, test } from '../../fixtures';
import { StudentPages } from '../../pages/student.page';

test.describe('Join a class', { tag: '@critical' }, () => {
  test('a student joins a class with its code', async ({ student, makeClass }) => {
    const cls = await makeClass('History');
    await new StudentPages(student.page).joinWithCode(cls.joinCode);
    await expect(student.page.getByText(`You joined ${cls.name}.`)).toBeVisible();
  });

  test('a wrong code is refused with a clear message', async ({ student }) => {
    await new StudentPages(student.page).joinWithCode('ZZZZZZZZ');
    await expect(student.page.getByText("That code didn't work. Check it and try again.")).toBeVisible();
  });
});
