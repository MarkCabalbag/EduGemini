import { defineConfig } from 'vitest/config';

// Unit tests. Integration tests that need the test database get their own project in EG-QA-02.
export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
