# Quality report: chore/quality-pass

Branch `chore/quality-pass`, started 2026-11-19 from `development` (2264f86) **with uncommitted work carried over** (owner's choice): the portfolio scope cut in the docs, the Gemini SDK adapter, resubmission (SUB-07) and the authorization tests (QA-01).

**Scope (owner's call, 2026-11-19):** a trimmed pass for a personal portfolio project. In: Playwright tests for 4 journeys (Chromium), Knip in its normal mode, Prettier with a pre-commit hook, a README. Out: Knip production mode, Firefox and WebKit, Playwright AI agents, axe checks, visual snapshots, and the GitHub Actions workflow (owner declined "the GitHub part").

**Nothing is committed** (owner's choice: the Gemini SDK files that this pass had to edit hold uncommitted work, and every install changes `pnpm-lock.yaml`, which already holds the SDK's uncommitted entries). Section 2 lists the changes as the commits they are meant to become.

## 1. Baseline (before any change)

| Command (from the repository root, PowerShell) | What it does | Result | Time |
|---|---|---|---|
| `pnpm install` | Installs every workspace; `postinstall` runs `prisma generate` | Passes (fails with `EPERM` while `pnpm dev:api` holds the Prisma engine; stop it first) | not measured |
| `pnpm dev:api`, `pnpm dev:web` | API on port 4000, web on 5173 (proxies `/api`) | Run | — |
| `pnpm build` | Builds `apps/web` (only package with a build) | Passes | 11.2 s |
| `pnpm lint` | ESLint over the repository | Passes, 0 problems | 5.9 s |
| `pnpm typecheck` | `tsc --noEmit` in every package | Passes, 0 errors | 10.1 s |
| `pnpm test` | Vitest unit project | 834 passed in 48 files | 32.2 s |
| `pnpm test:int` | Vitest integration project against the `edugemini-test` Supabase project | 543 passed, 3 todo, 12 files | 622 s |
| End-to-end | none existed (`apps/e2e` is referenced in `.gitignore` and `eslint.config.js` but absent) | — | — |
| CI | none (`.github/` absent) | — | — |
| Coverage | not configured | — | — |

Other numbers:

- **Source files** (`.ts`, `.tsx`, `.css`, `.js` under `apps/` and `packages/`): 223. **TypeScript lines:** 22,597. **Test files:** 60.
- **Dependencies** (runtime / dev): root 0 / 6, `apps/api` 12 / 9, `apps/web` 10 / 10, `packages/ai` 2 / 1, `packages/shared` 1 / 1.
- **Web bundle:** `index.js` 566.72 kB (173.83 kB gzip), `index.css` 21.20 kB (5.40 kB gzip). Vite warns that the JS chunk is over 500 kB.
- **TypeScript strictness:** already `strict`, plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` (`tsconfig.base.json`). ESLint already errors on `any` and on unused variables.
- **No root README.** Setup lives in `docs/README.md` §7.

## 2. Changes, as the commits they should become

1. **Fake Gemini for the end-to-end run only** (approved behavior change). `GEMINI_MODE` is back, default `live`, refused in production (`apps/api/src/lib/env.ts`, `create-gemini.ts`, their tests; TRD App A and §16.2a, code-standards §5). Why: grading calls Gemini from the server, so Playwright's `page.route()` cannot stub it, and a real key would make the tests slow, paid and flaky. The running app is unchanged: it still grades with the live model.
2. **Playwright safety net.** New workspace `apps/e2e` (`@playwright/test` 1.65.1, Chromium), root script `pnpm test:e2e`, and `API_PROXY_TARGET` in `apps/web/vite.config.ts` so the e2e web server can point at the e2e API (default unchanged). Two ESLint exceptions in `eslint.config.js`: the Vite config may read that variable, and Playwright fixtures may use `async ({}, use)`. See section 4 for what it covers.
3. **Unused exports removed** (Knip). See section 3.
4. **Compiler unused checks.** `noUnusedLocals` and `noUnusedParameters` in `tsconfig.base.json`. They found nothing new: ESLint's `no-unused-vars` already caught these.
5. **Prettier.** `prettier` 3.10.1 pinned exactly, `.prettierrc` matching the existing style (single quotes, 140 columns) so the reformat stays small, `.prettierignore` (lockfile, build output, migrations, `docs/`), `eslint-config-prettier` last in `eslint.config.js`. 80 files reformatted, no code changes; they include files with the carried resubmission work, so those diffs now also show formatting.
6. **Pre-commit hook.** husky 9.1.7 (`prepare: husky`, `.husky/pre-commit`) runs lint-staged 17.6.1 (ESLint `--fix` then Prettier on staged files, ESLint first as Prettier's docs advise) and `pnpm typecheck`. Scripts added: `format`, `format:check`, `knip`, `test:e2e`.
7. **README.md** at the root: what lives where, setup, every check, the e2e workflows (`--ui`, `--debug`, codegen, trace viewer), deploy.

Not done in this pass: the senior-review refactors (naming, function size, module boundaries). The codebase already has strict TypeScript, Zod at every boundary (request bodies, environment, Gemini output), one error shape (`AppError` and the error handler), and logs that redact secrets; a refactor pass without a reviewer to agree the targets would risk behavior for little gain today.

## 3. Removed, with evidence

Tool: Knip 6.46.1, `knip.json` with one entry per workspace and its plugins (Vite, Vitest, Playwright, ESLint, Prisma) finding the entry files.

| Kind | Item | Evidence | Action |
|---|---|---|---|
| Files | none | Knip reports no unused files | — |
| Dependencies | none | First run flagged `@fontsource-variable/inter`, `tailwindcss` (imported from `apps/web/src/index.css`) and `pino-pretty` (loaded by name as a pino transport, `apps/api/src/lib/logger.ts:15`). False positives: CSS added to the web project globs, `pino-pretty` listed in `ignoreDependencies` | Config fixed, nothing removed |
| Exports used only in their own file | `IDLE_TIMEOUT_MS`, `ABSOLUTE_TIMEOUT_MS` (`auth/session.ts`), `encodeCursor` (`lib/cursor.ts`), `GEMINI_CALLS_PER_MINUTE` (`lib/pacing.ts`), `JSON_BODY_LIMIT` (`middleware/json-body.ts`), `Skeleton` (`components/ui/Skeleton.tsx`), `assignmentKeys` (`hooks/use-assignments.ts`), `notificationKeys` (`hooks/use-notifications.ts`) | Knip "Unused exports", confirmed by a repository-wide search: every use is inside the same file, none in tests or docs | `export` dropped; the code stays |
| Dead code, commented-out code, flags, debug logs | none found | ESLint and the compiler report nothing unused; no feature flags exist | — |

After the change Knip exits 0 with no findings.

## 4. Coverage map: which spec protects each journey

Each test gets a fresh user written straight into the test database and signed in through the API (`fixtures/index.ts`), then deletes its classes through the API and its users afterwards. Why not one shared login from a setup project: sign-up is limited to 60 an hour per IP and class creation to 20 an hour per user (in API memory), so shared accounts trip the limits after a few repeated runs; Playwright's own auth guide recommends separate accounts when tests change server state.

| Journey | Happy path | Failure path | Spec |
|---|---|---|---|
| Sign up and sign in | A new instructor signs up and lands on their classes; a returning user signs in through the form | A wrong password shows "Email or password is incorrect." and stays on sign-in | `apps/e2e/tests/auth/auth.spec.ts` |
| Class and assignment | An instructor creates a class and publishes an assignment through the 5-step wizard | A class without a name shows "Required" on the field | `apps/e2e/tests/classes/class-and-assignment.spec.ts` |
| Join a class | A student joins with the code and sees "You joined …" | A wrong code shows "That code didn't work…" | `apps/e2e/tests/classes/join.spec.ts` |
| Submit and see the grade | A student uploads a PDF, submits, and sees "85 / 100", the AI-generated chip and the feedback (real worker, fake Gemini) | A `.txt` file is refused when chosen and Submit stays disabled | `apps/e2e/tests/submissions/submit.spec.ts` |

Stability: 9 of 9 pass; `--repeat-each=3` gave 27 of 27 (42 s).

## 5. After

| | Before | After |
|---|---|---|
| Source files (`.ts`, `.tsx`, `.css`, `.js` in `apps/`, `packages/`) | 223 | 237 (+14: the e2e package) |
| TypeScript lines | 22,597 | 23,788 (e2e suite plus Prettier's line wrapping) |
| Test files | 60 | 64 |
| Root devDependencies | 6 | 11 (knip, prettier, eslint-config-prettier, husky, lint-staged) |
| Unit tests | 834 | 836 (the two new env and adapter checks) |
| Integration tests | 543 passed, 3 todo | 543 passed, 3 todo (721 s) |
| End-to-end tests | 0 | 9 |
| Lint / type errors | 0 / 0 | 0 / 0 |
| Knip findings | 13 on a first run (3 false positives) | 0 |
| Build | 11.2 s, JS 566.72 kB (173.83 kB gzip) | 6.3 s, JS 566.72 kB (173.84 kB gzip) |

## 6. Bugs found, not fixed here

- **A 400 from Gemini is retried three times.** The live adapter maps every unknown error to `TRANSIENT`, so a request Gemini refuses as malformed (the `v1` / `document` error seen on 2026-11-19) uses three calls of quota before manual review. API Spec C.1 says a `400 INVALID_ARGUMENT` should not be retried. Needs a new error class in `packages/ai` and the grading job; left for its own fix.
- **The `v1beta` fix is unverified.** It is in `packages/ai/src/live-gemini.ts`, but no real grading run has passed with it yet.

## 7. Risks

- **E2E files go to the development bucket.** There is no test bucket; tests delete their classes, which queues the stored files for deletion by the API's `storage.cleanup` job. A test run killed mid-way can leave objects behind.
- **Production needs SMTP settings.** `NODE_ENV=production` refuses the fake mailer, but no email is sent yet (NTF-02 is cut), so a deploy must still set `MAIL_DRIVER=smtp` and the four `SMTP_*` values, or relax that check.
- **The web bundle is one 567 kB chunk** (Vite warns over 500 kB). Not measured as a real problem; code splitting by route would fix it if it becomes one.
- **Nothing is committed**, and the carried work and this pass share files, so splitting them into clean commits later takes care.

## 8. Needs a human decision

- Commit order: the Gemini SDK work, then this pass's commits as listed in section 2 (the lockfile can only be committed after the SDK's `package.json` change).
- Whether to add CI later (declined for now).

## 9. Next steps, by value

1. Run one real grading with your key to confirm the `v1beta` fix, then commit the Gemini work.
2. Commit this pass in the order of section 2.
3. Stop retrying Gemini 400 errors (section 6).
4. Build the trimmed instructor review (portfolio scope item 2) with an e2e test for it.
5. Deploy, after deciding the SMTP question (section 7).

## 10. Sources

| Decision | Source |
|---|---|
| Playwright 1.65.1, Node 22/24/26 supported | https://registry.npmjs.org/@playwright/test/latest, https://playwright.dev/docs/intro |
| Several `webServer` entries, `reuseExistingServer: !process.env.CI` | https://playwright.dev/docs/test-webserver |
| Sign in through the API in a setup project, `storageState` | https://playwright.dev/docs/auth |
| Separate accounts per test when tests change server state | https://playwright.dev/docs/auth |
| GitHub Actions shape for Playwright (read, not used: CI declined) | https://playwright.dev/docs/ci-intro |
| Knip 6.46.1, `knip.json` with `workspaces` keyed by path | https://registry.npmjs.org/knip/latest, https://knip.dev/features/monorepos-and-workspaces |
| Prettier 3.10.1 pinned exactly, `.prettierrc`, `.prettierignore`, eslint-config-prettier, lint-staged runs ESLint before Prettier | https://registry.npmjs.org/prettier/latest, https://prettier.io/docs/install |
| husky 9.1.7, `pnpm exec husky init` | https://registry.npmjs.org/husky/latest, https://typicode.github.io/husky/get-started.html |
| lint-staged 17.6.1 (Node >= 22.22.1) | https://registry.npmjs.org/lint-staged/latest |
| Gemini Interactions API needs `v1beta` for `document` input | Gemini's own 400 answer on the first real run, 2026-11-19 |
