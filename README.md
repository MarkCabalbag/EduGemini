# EduGemini

An AI-assisted classroom app. Instructors create classes and assignments, students join with a code and upload their work, and Google Gemini (using the instructor's own API key) grades it with a score and feedback. The instructor reviews every grade.

**Stack:** React 19 + Vite + Tailwind (web), Express 5 + Prisma + pg-boss (API and grading worker in one process), Supabase Postgres and Storage, the `@google/genai` SDK. TypeScript everywhere, in a pnpm workspace.

## What lives where

```
apps/api        Express API and the grading worker (routes → services → Prisma; jobs/ for pg-boss)
apps/web        React app (pages, hooks over TanStack Query, components/ui)
apps/e2e        Playwright end-to-end tests
packages/shared Zod schemas and types shared by the API and the web app (one source for request shapes)
packages/ai     The Gemini adapter: live (Google SDK) and fake (tests only)
docs/           Product and technical docs; start at docs/README.md
```

Dependencies point one way: `apps/*` use `packages/*`, never the other way round. Side effects (database, storage, Gemini) sit in services, jobs and adapters; validation lives in `packages/shared`.

## Run it locally

Needs Node 22 or newer and pnpm 10 (`corepack enable` picks the version in `package.json`). No Docker: the API talks to a hosted Supabase project.

1. `pnpm install`
2. Copy `.env.example` to `.env` and fill it in. You need two Supabase projects (development and tests), a **private** Storage bucket in the development project, and your own `ENCRYPTION_KEY` and `SESSION_SECRET`. Every variable is explained in `.env.example` and in `docs/trd.md` Appendix A. Never commit `.env`.
3. `pnpm db:boss:init` once, to install the job queue's tables.
4. Start the API and the web app, each in its own terminal:

```powershell
pnpm dev:api
```

```powershell
pnpm dev:web
```

Open http://localhost:5173. Sign up as an instructor, save your Gemini key on **Settings > AI** (free from Google AI Studio), create a class, then sign up as a student in another browser and join with the class code.

On Windows, run `pnpm` from PowerShell. If `pnpm install` fails with `EPERM` on a Prisma file, stop `pnpm dev:api` and run it again.

## Checks

| Command                             | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `pnpm lint`                         | ESLint                                                                 |
| `pnpm typecheck`                    | TypeScript in every package (strict, no unused locals or parameters)   |
| `pnpm format` / `pnpm format:check` | Prettier                                                               |
| `pnpm knip`                         | Unused files, dependencies and exports                                 |
| `pnpm test`                         | Unit tests (Vitest), no database                                       |
| `pnpm test:int`                     | Integration tests against the test Supabase project (about 10 minutes) |
| `pnpm test:e2e`                     | Playwright end-to-end tests (below)                                    |
| `pnpm build`                        | Production build of the web app                                        |

A pre-commit hook (husky + lint-staged) lints and formats the staged files and runs the typecheck.

## End-to-end tests

`pnpm test:e2e` starts its own API (port 4100) and web app (port 5273) against the **test** Supabase project, so it can run while your dev servers are up. It refuses to start unless `E2E_DATABASE_URL` and `E2E_PROJECT_REF` in `.env` point at the test project. Grading uses a fake Gemini there (`GEMINI_MODE=fake`), so no key or quota is needed. Uploaded files go to the development Storage bucket and are deleted again when each test deletes its class.

First time only: `pnpm exec playwright install chromium` (run inside `apps/e2e`), and on a fresh test project `pnpm --filter @edugemini/e2e prepare-db`.

Useful ways to run it (from `apps/e2e`):

- `pnpm exec playwright test --ui`: watch mode with a timeline of every step.
- `pnpm exec playwright test --debug`: step through a test in the inspector.
- `pnpm exec playwright test --grep @smoke`: run a tagged subset (`@smoke`, `@critical`).
- `pnpm exec playwright codegen http://localhost:5273`: record clicks into test code (start the e2e servers first).
- `pnpm exec playwright show-trace reports/results/<test>/trace.zip`: open the trace of a failed retry; the HTML report is in `reports/html`.

Tests are grouped by feature in `tests/`; `fixtures/` creates a fresh user per test in the test database and signs them in through the API; `pages/` holds small page objects; `utils/` holds API, database and file helpers.

## Deploy

The planned setup (`docs/trd.md` §4): the web app on Vercel, which rewrites `/api/*` to the API on Render, with the Supabase projects behind both. Set every variable from `.env.example` on Render with `NODE_ENV=production` (the API refuses the fake mailer and the fake Gemini there), run `pnpm db:boss:init` against production once, and set the Vercel rewrite. The deploy has not been done yet.
