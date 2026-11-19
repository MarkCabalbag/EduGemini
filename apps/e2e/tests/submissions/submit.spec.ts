import { expect, test } from '../../fixtures';
import { StudentPages } from '../../pages/student.page';
import { joinClass, publishAssignment, saveGeminiKey } from '../../utils/api';
import { onePagePdf, textFile } from '../../utils/files';

test.describe('Submit work and see the grade', { tag: '@critical' }, () => {
  test.beforeEach(async ({ instructor }) => {
    await saveGeminiKey(instructor.request);
  });

  test('a student submits a PDF and sees the AI score and feedback', async ({ instructor, student, makeClass }) => {
    const cls = await makeClass('Science');
    const assignmentId = await publishAssignment(instructor.request, cls.id, 'Photosynthesis essay');
    await joinClass(student.request, cls.joinCode);
    const pages = new StudentPages(student.page);

    await test.step('upload and submit a PDF', async () => {
      await pages.openAssignment(assignmentId);
      await pages.chooseFiles([onePagePdf()]);
      await expect(student.page.getByText('Uploaded')).toBeVisible();
      await pages.submit();
    });

    await test.step('see the graded result', async () => {
      // The page asks again every 5 seconds while grading; the end-to-end run's fake Gemini gives 85% of the maximum.
      await expect(student.page.getByText('85 / 100')).toBeVisible({ timeout: 45_000 });
      await expect(student.page.getByText('AI-generated', { exact: true })).toBeVisible();
      await expect(student.page.getByText('Fake feedback: the work was read and graded.')).toBeVisible();
    });
  });

  test('a file that is not a PDF, JPG or PNG is refused when chosen', async ({ instructor, student, makeClass }) => {
    const cls = await makeClass('Science');
    const assignmentId = await publishAssignment(instructor.request, cls.id, 'Photosynthesis essay');
    await joinClass(student.request, cls.joinCode);
    const pages = new StudentPages(student.page);

    await pages.openAssignment(assignmentId);
    await pages.chooseFiles([textFile()]);
    await expect(student.page.getByText("This file type isn't supported. Use PDF, JPG, or PNG.")).toBeVisible();
    await expect(student.page.getByRole('button', { name: 'Submit files' })).toBeDisabled();
  });
});
