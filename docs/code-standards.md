# Code Standards: EduGemini

| | |
|---|---|
| **Status** | Approved |
| **Owner** | Project owner (sole developer) |
| **Inputs** | [TRD](trd.md) (stack, architecture), [Backend Schema](backend-schema.md), [API Spec](api-spec.md), [UX Brief](ux-brief.md) |

> **Scope.** How code is written: layout, naming, patterns, lint, tests. It does not restate behavior (PRD), data (Backend Schema), request and response shapes (API Spec) or look (UX Brief). When a doc and this file disagree, the doc that owns the fact wins and this file is fixed. A new library needs owner approval first (TRD T-D11).

---

## 1. Repository layout

pnpm workspace (TRD T-D7):

| Path | Holds |
|---|---|
| `apps/web` | React app (Vite). Folders: `pages`, `components`, `hooks`, `lib` |
| `apps/api` | Express API and the pg-boss worker, one process. Folders: `routes`, `services`, `jobs`, `policy`, `admin`, `middleware`, `lib` |
| `apps/e2e` | Playwright (layout in TRD §16.2a) |
| `packages/shared` | Zod schemas, error codes, limits (`limits.ts`). No runtime dependency except Zod |
| `packages/ai` | Gemini adapter, fake adapter, versioned prompts (`prompts/`) |

Folder names inside each app are set by this file. Imports go one way: apps import packages. `shared` imports nothing from the repo. `ai` may import `shared`. `web` never imports `api` or `ai`, and `api` never imports `web`. `apps/api/src/admin` imports only the `adminQueries` repository (TRD §7.3).

## 2. TypeScript

- `strict` on in every package. No `any`: use `unknown` and narrow.
- Types come from Zod: `export type Assignment = z.infer<typeof AssignmentSchema>`. Never write a type next to a schema that covers the same shape.
- `type` over `interface`. `satisfies` to check a literal without widening it.
- No TypeScript `enum`. An enum is `z.enum([...])` in `packages/shared` with `UPPER_SNAKE_CASE` values identical to the Prisma enum (Backend Schema §5). `RoleSchema` gives `Role`. A unit test compares each shared enum with its Prisma enum.
- Dates are UTC ISO strings in JSON (API Spec A2). Scores are JSON numbers with at most two decimals; the mapper converts Prisma `Decimal` to `number`.

## 3. Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `class-service.ts`, `use-class.ts` |
| React component files | PascalCase | `StatusChip.tsx` |
| Components, services, classes | PascalCase; services end in `Service` | `SubmissionPanel`, `ClassService` |
| Hooks | `use` + PascalCase | `useAssignment` |
| Zod schemas | PascalCase + `Schema`; the type has no suffix | `CreateClassSchema` gives `CreateClass` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_FILE_BYTES` |
| Error codes | The API Spec A4 strings | `ATTEMPTS_EXHAUSTED` |
| JSON fields | camelCase (API Spec A2) | `nextCursor` |
| Job files | `<name>.job.ts`; the queue is the dotted name from TRD §10.1 | `grade-submission.job.ts` runs `grade.submission` |
| Query-key factories | camelCase + `Keys` | `classKeys` |
| Database names | snake_case in the database, camelCase in code, mapped with `@map` and `@@map` (Backend Schema §2) | `submission_versions` / `submissionVersion` |
| Tests | Next to the code: `.test.ts`, or `.test.tsx` when the test renders React. E2E specs in `apps/e2e/specs/` | `class-service.test.ts` |

## 4. Shared package

- Every request and response body has a Zod schema here. The API parses with it; the web app uses the same schema for forms (TRD §8.1, §15.4).
- `ErrorCodeSchema` lists exactly the codes in [API Spec A4](api-spec.md) and the `ErrorCode` enum in `openapi.yaml`. `ERROR_STATUS` maps each code to its HTTP status. A test fails if any of the three lists differ.
- `limits.ts` holds file and page limits. The client pre-check, the API and the tests all import it (TRD §9.2).

## 5. API server

**Responses and errors** follow [API Spec A2 and A4](api-spec.md). In code:
- Success returns the object, `{ items, nextCursor }`, or `204`. Handlers never build an error response. They throw `AppError(code, { fields?, details? })`, and one error-handler middleware turns it into the envelope with `requestId`, using `ERROR_STATUS`.
- The `validate` middleware parses body, query and path with the Zod schema and rejects unknown query parameters. Zod issues become `fields`, keyed by JSON path.
- Errors never carry stack traces, SQL, provider payloads or key material.

**Layers**
- **Routes are thin:** `validate`, then `authorize(action)`, then one service call, then respond. No database calls and no business logic.
- **Authorization is central** (TRD §7.1): the `policy` module's `can(actor, action, resource)`. No handler or service checks a role inline. No relationship to the item means `NOT_FOUND`, the same response as a missing item.
- **Services own business logic.** They take the actor, run in a transaction when they write, and return `shared` types through a mapper, never raw Prisma rows.
- **Race-prone writes** (approve, reopen, grant, finalize, re-grade, the worker's grade write) lock the submission row with the one shared lock helper (`SELECT ... FOR UPDATE`; it also locks an instructor's key row on a save) and rely on state checks for idempotency (API Spec A11).
- **Every route behind the session has a rate limit.** The general per-user limit ([API Spec A12](api-spec.md), "everything else") is mounted once in `createApp`, after the session loads, so no route can forget it. A route with its own row adds that limiter on the route; a route whose row allows more than the general limit (notifications) is excluded from the general one when it is added. The public join-link preview is mounted before it, because it has a row of its own and a class opens the same link together on one network. A limit on creating something goes after validation, so a request with errors does not use it up.
- **A role that may not use a route gets `NOT_FOUND` before anything else runs.** Put `requireAction(action)` right after `requireAuth`, ahead of validation (API Spec A3).
- **Adapters** for outside services (`Mailer`, `StorageAdapter`, the Gemini adapter) are interfaces with a real and a fake implementation, chosen by environment (`STORAGE_DRIVER`, `GEMINI_MODE`).

**Middleware order** (set by this file; the checks themselves are in TRD §6 and §14): request ID, helmet, `trust proxy`, `Origin` check on non-GET (before the body is read, API Spec A3), JSON body (100 KB limit), session load (suspension checked on every request), rate limit, routes, 404, error handler.

**Logging:** pino with the redaction list in TRD §14. Never log request bodies, tokens, keys or file contents. Product events are named lines such as `grading.attempt` (TRD §16.1).

## 6. Jobs and AI

- Jobs live in `apps/api/src/jobs`, one file per queue in TRD §10.1, and each is added to the list in `jobs/index.ts`, which creates its queue, worker and schedule. A handler is safe to run twice and checks the submission version before and after the Gemini call (TRD §10.3).
- Gemini generation is called only from the `grade.submission` job, never from a route. The key check (model list) runs on save and goes through the same adapter (TRD §11.5).
- The model name and prompt version are single constants (`GEMINI_MODEL`, `PROMPT_VERSION`) stored with every result. Prompts live in `packages/ai/prompts`, are versioned, and treat student and reference content as data (TRD §10.4).
- AI tests use only the fake adapter.

## 7. Database

- Prisma parameterized queries. Raw SQL appears in only three places: migration files, the pg-boss schema, and the row-lock helper.
- Migrations follow [Backend Schema §13](backend-schema.md): forward-only, expand then contract, review the generated SQL, and never accept a `DROP` of an object listed in Backend Schema §7 or Appendix B.
- Columns that record who acted have no foreign key. Every other foreign key has an index (Backend Schema §2).
- Secrets and tokens are stored only in the forms listed in Backend Schema §12.6.

## 8. Web app

- **Data:** TanStack Query, one hook per resource (`useClass`, `useCreateClass`). Mutations invalidate the affected keys. Never call `fetch` outside `lib/api.ts`.
- **`lib/api.ts`:** uses a relative `/api` base (same origin). It parses the error envelope into an `ApiRequestError` with `code`, `fields`, `details` and `requestId`, and returns `undefined` for `204`. A file goes through `api` too, by `XMLHttpRequest` instead of `fetch`, because only that reports upload progress; tests replace it with `test/fake-xhr.ts`, which hands the request to the stubbed `fetch`.
- **Retries** (this file; TRD §15.3 sets no count): none for 4xx; at most twice for anything else. No per-query `retry` unless a doc says so.
- **Polling** intervals are constants taken from [API Spec A13](api-spec.md), kept in one file. Polling pauses when the tab is hidden (TRD §15.3).
- **Error text:** one lookup from error `code` to the UX Brief §11.2 string. Components never show `message`.
- **Forms:** react-hook-form with the shared Zod schema.
- **Components:** render and forward events. Domain rules stay on the server and in `shared`. The client does not infer roles: access is decided by the API response (TRD §15.2). Every data view handles loading (`Skeleton`), empty (`EmptyState`) and error (`ErrorState`). Keep a component file under about 150 lines. Use the components in UX Brief §7. `StatusChip` is the only place a status label or color is chosen.
- **Styling:** tokens from UX Brief §5, never literal colors. Feedback is rendered as plain text, never HTML or Markdown (TRD §14).
- **Accessibility:** every screen passes the UX Brief §12 checklist.

## 9. Security in code

The controls are in [TRD §14](trd.md). Rules for code: Zod on every body and query; storage paths built from IDs, never file names; file type checked by magic bytes; every CSV cell goes through the one formula-prefix helper (TRD §8.3); only `last4` of a key leaves the server; no secret in the web bundle.

## 10. Environment variables

- Variables are defined in [TRD Appendix A](trd.md). This file does not copy them.
- The API reads configuration through one `env` module that validates with Zod at startup and crashes on a missing or invalid value. Nothing else reads `process.env`.
- `.env.example` lists every variable and passes that validation, so a fresh clone starts. The web build has no secrets.

## 11. Lint rules

Each rule is enforced in CI (TRD §16.3 step 3).

| Rule | Source |
|---|---|
| `apps/api/src/admin` may import only `adminQueries` (no content models) | TRD §7.3 |
| No literal colors in `apps/web` components | UX Brief §15 |
| `waitForTimeout` banned in `apps/e2e`; Playwright lint plugin on | TRD §16.2a |
| No `any`; no `process.env` outside `env`; no `fetch` outside `lib/api.ts`; no `$queryRaw` outside the row-lock helper | This file |

## 12. Testing

Levels and what each covers: [TRD §16.2](trd.md). Rules for writing tests:
- Vitest for unit and worker tests, Supertest for API integration, Playwright for end to end.
- **Real database, no mocks of our own code.** Only outside services are replaced: Gemini (fake adapter), SMTP (fake mailer).
- Destructive database commands (`prisma migrate reset`, the e2e global setup, demo seeding) run only against the test project, checked by the safety guard (TRD §16.2a; Backend Schema §13.1).
- Each test creates its own data with a unique suffix and does not depend on order.
- A permission change comes with a row in the authorization matrix test (TRD §7.2).
- E2E titles start with the requirement ID they verify. Accessible selectors come first; `data-testid` is used only from the registry file.
- Lint, typecheck and tests pass before a ticket is marked done in the [Progress Tracker](progress-tracker.md).

## 13. Readability

- Write the plain version first. Add a helper, option or layer only at the second real use.
- One responsibility per file and function. Components pass about 150 lines and services about 250 only when there is no seam to split on.
- Name by meaning, not mechanism. Comments say why, not what.
- No dead code and no duplicated logic: extract at the second copy.
