import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from '../App';

/** An API error answer, in the envelope shape of API Spec A4. */
export const failure = (status: number, code: string, fields?: object) =>
  Response.json({ error: { code, message: code, requestId: 'r', ...(fields ? { fields } : {}) } }, { status });

/** Renders the whole app at an address. Queries never retry, so a failure shows at once. */
export function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}
