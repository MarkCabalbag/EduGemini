import { createHash } from 'node:crypto';
import { GeminiError, type GeminiAdapter, type GradeInput } from './gemini';

// The fake Gemini of TRD §16.2a. A tag such as `__scenario-score-42__` in a student file's name picks what it does, so tests
// and the end-to-end run can choose the outcome with the file they upload. The tag is read here and nowhere else.
const TAG = /__scenario-([a-z0-9-]+)__/;

const answer = (score: number) =>
  JSON.stringify({ score, feedback: 'Fake feedback: the work was read and graded.', confidence: 'high', readabilityIssue: false });

const timeout = () => new GeminiError('TRANSIENT', 'The fake timed out.');

const scenarioOf = (input: GradeInput) => input.studentFiles.map((file) => TAG.exec(file.displayName)?.[1]).find(Boolean);

/** The same files give the same key, so a retry of one submission is counted as a second call. */
const filesKey = (input: GradeInput) => {
  const hash = createHash('sha256');
  for (const file of input.studentFiles) hash.update(file.data);
  return hash.digest('hex');
};

/** A fake that never calls Google. Without a tag it gives a valid result of 85% of the maximum score. */
export function createFakeGemini(): GeminiAdapter {
  const callCounts = new Map<string, number>(); // for `timeout-then-ok`, by `filesKey`

  return {
    model: 'fake',
    async grade(input, _apiKey, { signal } = {}) {
      signal?.throwIfAborted();
      const max = input.assignment.maxScore;
      const normalAnswer = answer(Math.round(max * 0.85 * 100) / 100);
      const scenario = scenarioOf(input);

      const fixedScore = scenario?.match(/^score-(\d+)$/);
      if (fixedScore) return answer(Number(fixedScore[1]));

      switch (scenario) {
        case undefined:
          return normalAnswer;
        case 'timeout-then-ok': {
          const key = filesKey(input);
          const count = (callCounts.get(key) ?? 0) + 1;
          callCounts.set(key, count);
          if (count === 1) throw timeout();
          return normalAnswer;
        }
        case 'timeout-always':
          throw timeout();
        case 'key-invalid':
          throw new GeminiError('KEY_INVALID', 'The fake rejected the key.');
        case 'quota-daily':
          throw new GeminiError('QUOTA', 'The fake ran out of daily quota.');
        case 'file-quality':
          throw new GeminiError('FILE_QUALITY', 'The fake could not read a file.');
        case 'score-above-max':
          return answer(max + 1);
        case 'malformed-json':
          return 'This is not JSON.';
        default:
          throw new Error(`Unknown fake Gemini scenario: ${scenario}`);
      }
    },
  };
}
