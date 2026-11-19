import { expect, type APIRequestContext } from '@playwright/test';
import { WEB_URL } from './env';

// Test setup through the real API, as the signed-in user whose cookies the request context carries. Every write sends the
// app's own Origin, because the API refuses a non-GET request without it (CSRF check, TRD §6.5).
const ORIGIN = { Origin: WEB_URL };

export const PASSWORD = 'e2e-Correct-Horse-41';

export type CreatedClass = { id: string; name: string; joinCode: string };

async function json<T>(response: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> {
  expect(response.ok(), `${response.url()} answered ${response.status()}: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

export async function signIn(request: APIRequestContext, email: string): Promise<void> {
  await json(await request.post('/api/auth/signin', { headers: ORIGIN, data: { email, password: PASSWORD } }));
}

export async function createClass(request: APIRequestContext, name: string): Promise<CreatedClass> {
  const created = await json<{ id: string; joinCode?: string }>(
    await request.post('/api/classes', { headers: ORIGIN, data: { name, attestation: { confirmed: true } } }),
  );
  return { id: created.id, name, joinCode: created.joinCode ?? '' };
}

export async function deleteClass(request: APIRequestContext, cls: CreatedClass): Promise<void> {
  const response = await request.delete(`/api/classes/${cls.id}`, { headers: ORIGIN, data: { confirmation: cls.name } });
  expect([204, 404], `deleting class ${cls.name} answered ${response.status()}`).toContain(response.status());
}

/** A published points assignment out of 100, due in a week (the API's default due date). */
export async function publishAssignment(request: APIRequestContext, classId: string, title: string): Promise<string> {
  const draft = await json<{ id: string }>(
    await request.post(`/api/classes/${classId}/assignments`, {
      headers: ORIGIN,
      data: { title, criteriaText: 'Explain the idea clearly, with one example.', scoringFormat: 'POINTS', maxScore: 100 },
    }),
  );
  await json(await request.post(`/api/assignments/${draft.id}/publish`, { headers: ORIGIN }));
  return draft.id;
}

/** Grading needs a saved key. With the fake Gemini of the end-to-end run, any key of the right length works. */
export async function saveGeminiKey(request: APIRequestContext): Promise<void> {
  await json(
    await request.put('/api/me/key', { headers: ORIGIN, data: { apiKey: 'e2e-fake-key-0123456789abcdef', disclosureAcknowledged: true } }),
  );
}

export async function joinClass(request: APIRequestContext, code: string): Promise<void> {
  await json(await request.post('/api/join', { headers: ORIGIN, data: { code } }));
}
