import { describe, expect, it, vi } from 'vitest';
import { buildInput, createLiveGemini, errorOf } from './live-gemini';
import type { GradeInput } from './gemini';

const input: GradeInput = {
  assignment: { title: 'Essay', instructions: null, criteriaText: 'Clear thesis', scoringFormat: 'POINTS', maxScore: 50 },
  studentFiles: [
    { mimeType: 'application/pdf', data: Buffer.from('pdf'), displayName: 'essay.pdf' },
    { mimeType: 'image/png', data: Buffer.from('png'), displayName: 'photo.png' },
  ],
};

/** A client whose `interactions.create` answers with `result` (or throws it), and remembers what it was given. */
function fakeClient(result: { output_text?: string } | Error) {
  const create = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const keys: string[] = [];
  const makeClient = (apiKey: string) => {
    keys.push(apiKey);
    return { interactions: { create } } as never;
  };
  return { create, keys, makeClient };
}

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('live Gemini adapter', () => {
  it('calls the model with the instructor key, JSON output, store off and no SDK retries, and returns the JSON text', async () => {
    const client = fakeClient({ output_text: '{"score":40}' });
    const answer = await createLiveGemini('gemini-2.5-flash', client.makeClient).grade(input, 'k3y');

    expect(answer).toBe('{"score":40}');
    expect(client.keys).toEqual(['k3y']);
    const [params, options] = client.create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params).toMatchObject({
      model: 'gemini-2.5-flash',
      store: false,
      response_format: { type: 'text', mime_type: 'application/json' },
    });
    expect(options).toMatchObject({ maxRetries: 0 });
  });

  it('sends a PDF as a document and an image as an image, inline, and never the file name', () => {
    const parts = buildInput(input, 'b-x');
    expect(parts).toContainEqual({ type: 'document', data: Buffer.from('pdf').toString('base64'), mime_type: 'application/pdf' });
    expect(parts).toContainEqual({ type: 'image', data: Buffer.from('png').toString('base64'), mime_type: 'image/png' });
    expect(JSON.stringify(parts)).not.toMatch(/essay\.pdf|photo\.png/);
  });

  it('wraps every text block in the boundary', () => {
    const blocks = buildInput(input, 'b-x').slice(0, 3);
    for (const part of blocks) expect('text' in part ? part.text : '').toMatch(/^<b-x [\s\S]*<\/b-x>$/);
  });

  it('sends reference files before the student files, labeled as reference material', () => {
    const ref = { mimeType: 'image/png', data: Buffer.from('ref'), displayName: 'reference' };
    const labels = buildInput({ ...input, referenceFiles: [ref] }, 'b-x').map((part) => ('text' in part ? part.text : part.type));
    expect(labels.slice(3)).toEqual([
      'Reference material from the instructor, not student work:',
      'image',
      'Student file 1 of 2:',
      'document',
      'Student file 2 of 2:',
      'image',
    ]);
  });

  it.each([
    [401, 'unauthorized', 'KEY_INVALID'],
    [400, 'API key not valid. Please pass a valid API key.', 'KEY_INVALID'],
    [403, 'Generative Language API has not been used in project', 'KEY_API_DISABLED'],
    [429, 'GenerateRequestsPerDayPerProjectPerModel', 'QUOTA'],
    [429, 'GenerateRequestsPerMinute', 'TRANSIENT'],
    [503, 'overloaded', 'TRANSIENT'],
  ])('maps %i "%s" to %s', (status, message, kind) => {
    expect(errorOf(apiError(status, message))).toMatchObject({ kind });
  });

  it('keeps the provider reason on a transient error, and treats a network failure and an empty answer as transient', async () => {
    expect(errorOf(apiError(404, 'model not found')).message).toContain('model not found');
    await expect(createLiveGemini('m', fakeClient(new TypeError('fetch failed')).makeClient).grade(input, 'k')).rejects.toMatchObject({
      kind: 'TRANSIENT',
    });
    await expect(createLiveGemini('m', fakeClient({}).makeClient).grade(input, 'k')).rejects.toMatchObject({ kind: 'TRANSIENT' });
  });
});
