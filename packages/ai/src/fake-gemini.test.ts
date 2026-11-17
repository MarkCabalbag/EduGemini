import { describe, expect, it } from 'vitest';
import { GradeOutputSchema } from '@edugemini/shared';
import { createFakeGemini } from './fake-gemini';
import type { GradeInput } from './gemini';

const grade = (names: string[], maxScore = 100, bytes = 'work'): GradeInput => ({
  assignment: { title: 'Essay', instructions: null, criteriaText: 'Be clear.', scoringFormat: 'POINTS', maxScore },
  studentFiles: names.map((displayName, index) => ({ mimeType: 'application/pdf', data: Buffer.from(`${bytes}${index}`), displayName })),
});
const ask = (names: string[], maxScore?: number) => createFakeGemini().grade(grade(names, maxScore), 'key');

describe('the fake Gemini (TRD §16.2a)', () => {
  it('names itself as the model', () => {
    expect(createFakeGemini().model).toBe('fake');
  });

  it('gives a valid result of 85% of the maximum when no scenario is tagged', async () => {
    const output = GradeOutputSchema.parse(JSON.parse(await ask(['essay.pdf'], 50)));

    expect(output).toMatchObject({ score: 42.5, confidence: 'high', readabilityIssue: false });
    expect(output.feedback).not.toBe('');
  });

  it('gives the score in a score-N tag, wherever the tag is in the list of files', async () => {
    const output = JSON.parse(await ask(['page1.jpg', 'page2__scenario-score-42__.jpg'])) as { score: number };

    expect(output.score).toBe(42);
  });

  it('times out the first call only for timeout-then-ok, counting each set of files on its own', async () => {
    const fake = createFakeGemini();
    const first = grade(['a__scenario-timeout-then-ok__.pdf']);
    const other = grade(['a__scenario-timeout-then-ok__.pdf'], 100, 'different');

    await expect(fake.grade(first, 'key')).rejects.toMatchObject({ kind: 'TRANSIENT' });
    expect(GradeOutputSchema.safeParse(JSON.parse(await fake.grade(first, 'key'))).success).toBe(true);
    await expect(fake.grade(other, 'key')).rejects.toMatchObject({ kind: 'TRANSIENT' }); // a different upload starts at its first call
  });

  it('keeps timing out for timeout-always', async () => {
    const fake = createFakeGemini();
    const input = grade(['x__scenario-timeout-always__.pdf']);

    await expect(fake.grade(input, 'key')).rejects.toMatchObject({ kind: 'TRANSIENT' });
    await expect(fake.grade(input, 'key')).rejects.toMatchObject({ kind: 'TRANSIENT' });
  });

  it('refuses the key for key-invalid and runs out of quota for quota-daily', async () => {
    await expect(ask(['x__scenario-key-invalid__.pdf'])).rejects.toMatchObject({ kind: 'KEY_INVALID' });
    await expect(ask(['x__scenario-quota-daily__.pdf'])).rejects.toMatchObject({ kind: 'QUOTA' });
  });

  it('answers above the maximum for score-above-max, and not as JSON for malformed-json', async () => {
    const above = JSON.parse(await ask(['x__scenario-score-above-max__.pdf'], 20)) as { score: number };
    const malformed = await ask(['x__scenario-malformed-json__.pdf']);

    expect(above.score).toBe(21);
    expect(() => JSON.parse(malformed)).toThrow();
  });

  it('fails loudly for a scenario it does not know, so a typo in a test is not read as the normal case', async () => {
    await expect(ask(['x__scenario-scroe-42__.pdf'])).rejects.toThrow(/Unknown fake Gemini scenario: scroe-42/);
  });

  it('stops at once when the call was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(createFakeGemini().grade(grade(['essay.pdf']), 'key', { signal: controller.signal })).rejects.toThrow();
  });
});
