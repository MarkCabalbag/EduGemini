# TRD: EduGemini (v1.0)

| | |
|---|---|
| **Status** | Draft for review |
| **Owner** | Project owner (sole developer) |
| **Inputs** | [PRD v2.2](prd.md) (behavior; wins on conflict), [App Flow v2.2](app-flow.md) (screens) |
| **Detail docs** | [Backend Schema](backend-schema.md) (wins on stored data), [API Spec](api-spec.md) (wins on request and response shapes), [UX Brief](ux-brief.md) (look and copy), [Code Standards](code-standards.md) (how code is written) |
| **Not written yet** | AI Guardrails (prompt text, injection tests), Deployment Runbook |

---

## 1. Scope and decisions

### 1.1 Scope
This document defines how EduGemini is built and run: stack, architecture, data model, API, file handling, grading pipeline, security, and the free hosting setup. It does not restate product behavior; requirement IDs (FR-*) point to the PRD.

Constraints that shape every choice:
- One developer. The product must be buildable and maintainable by one person.
- Free to run. Hosting, database, storage, queue, and email must have free tiers that cover the portfolio scope. Each free-tier limit that matters is listed in Section 4.
- Each instructor pays for their own AI usage through their own Gemini key. The platform has no AI cost (PRD D2).

### 1.2 Decisions in this document
These were proposed and approved in the planning step.

| # | Decision | Section |
|---|---|---|
| T-D1 | Browser and API share one origin: Vercel rewrites `/api/*` to the Render API, so session cookies are first-party | 3, 4 |
| T-D2 | Authentication is custom in Express (argon2id, database sessions), not Supabase Auth | 6 |
| T-D3 | Email uses a configurable SMTP sender with no custom domain in v1 (PRD D15) | 13 |
| T-D4 | Gemini via `@google/genai`, JSON response schema, low temperature, versioned prompts | 10, 11 |
| T-D5 | Status updates by polling (TanStack Query); no server-sent events in v1 | 15 |
| T-D6 | Late, Missing, Not-yet-due, and Closed are derived at read time from `dueAt`; no due-date cron | 5 |
| T-D7 | pnpm monorepo: `apps/web`, `apps/api`, `apps/e2e`, `packages/shared`, `packages/ai` | 2 |
| T-D8 | No malware scanning in v1 (ClamAV does not fit a 512 MB free host); content sniffing and size limits instead | 9, 14 |
| T-D9 | Instructor keys encrypted with AES-256-GCM and a key version for rotation | 14 |
| T-D10 | Request and form validation uses Zod, with schemas shared by the web app and the API | 2, 8, 15 |
| T-D11 | Every library in the stack table (§2) is owner-approved (2026-11-15). A new library needs the same approval before it is added | 2 |

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) across web, API, and shared code | One language; shared Zod schemas |
| Web app | React, Vite, React Router, TanStack Query, react-hook-form, Tailwind CSS, shadcn/ui (Radix primitives), react-pdf, lucide-react icons, Inter font (self-hosted) | Static build fits Vercel's free tier; Query handles caching and polling; Radix gives accessible dialogs (WCAG, PRD Section 12) |
| API | Node.js LTS, Express 5, Zod validation, pino logging, helmet, express-rate-limit | Chosen stack; mature; small surface |
| Database | Supabase Postgres (free) | Chosen stack; pg-boss runs on it |
| ORM and migrations | Prisma | Chosen stack; typed queries and migrations |
| Job queue and scheduler | pg-boss (MIT, free) on the same Postgres | Durable jobs, retries with backoff, delayed jobs, cron, singleton keys; no Redis to host |
| File storage | Supabase Storage, private buckets; accessed only by the API with the service-role key | Chosen stack; signed URLs; no public access |
| Authentication | Custom: argon2id passwords, database sessions, Google OAuth via Arctic | PRD rules (role at sign-up, Google link clears password, generic errors) are easier to enforce in our own code |
| Email | nodemailer over SMTP to a free transactional provider (Brevo is the candidate); an in-memory fake mailer in development and tests (Section 13.5) | Free; no domain required (T-D3) |
| AI | `@google/genai` with a Gemini model | Chosen stack |
| Image and PDF | `sharp` (HEIC support, to be confirmed in spike S4) or `heic-convert` (pure JS fallback); `pdf-lib` for page count and encryption detection | Works in a 512 MB container |
| Tests | Vitest (unit), Supertest (API integration), Playwright (end-to-end UI and API), `@axe-core/playwright` (accessibility), `eslint-plugin-playwright` (lint rules) | Standard and free; Playwright covers four browser engines and mobile viewports (Section 16.2a) |
| CI | GitHub Actions | Free for public repos; ample minutes for a small project |

Exact versions are pinned in the lockfile, not in this document. Two are held back on purpose: Prisma stays on 6.x, because the schema uses `url` and `directUrl` in the datasource, which Prisma 7 and later replace with `prisma.config.ts`; and TypeScript stays on 6.0.x until typescript-eslint supports 7.

---

## 3. Architecture

```
Browser (phone or desktop)
   │  https://<app>.vercel.app
   ▼
Vercel ── static React build (apps/web)
   │  rewrite /api/* ──────────────────────────────┐
   ▼                                               ▼
                                   Render web service (free, one instance)
                                   ├─ Express API (apps/api)
                                   ├─ pg-boss worker (same process)
                                   └─ GET /healthz  ◀── UptimeRobot (every 5 min)
                                        │           │             │
                                        ▼           ▼             ▼
                              Supabase Postgres   Supabase    Gemini API
                              (Prisma + pg-boss)  Storage     (instructor's key)
                                                              
                                   SMTP provider ◀── worker (email jobs)
```

Rules that follow from this shape:
- **One API instance.** Rate-limit counters and the per-instructor grading limiter live in process memory. This is correct only for one instance. Scaling out requires moving them to Postgres (recorded as a constraint, Section 17.3).
- **The worker is inside the API process.** It starts after the HTTP server, and both shut down together. Jobs are stored in Postgres, so a restart resumes them.
- **Same origin.** The browser calls `/api/...` on the Vercel domain. Cookies are first-party and the API needs no CORS configuration. If spike S1 fails, the fallback is to have Express serve the built web app (one Render service, same origin, no Vercel).

---

## 4. Environments and hosting

### 4.1 Environments
- **Local:** no Docker and no local Postgres. The API runs on the developer's machine against a hosted Supabase Postgres. Two free Supabase projects: `edugemini` (development now, production at deploy) and `edugemini-test` (end-to-end tests and every destructive command, Section 16.2a). The Vite dev server proxies `/api` to the local API, so the browser still sees one origin. File storage uses a local-disk adapter behind the same `StorageAdapter` interface. Email uses the fake mailer (`MAIL_DRIVER=fake`, Section 13.5). Gemini runs in `GEMINI_MODE=fake` for development and CI.
- **CI:** GitHub Actions runs a plain Postgres service container, so CI never touches Supabase (Section 16.3).
- **Production:** Vercel (web), Render (API and worker), Supabase (Postgres and Storage), SMTP provider, UptimeRobot (monitoring).
- No separate staging environment in v1.

### 4.2 Free-tier constraints

| Service | Free tier limit that matters | Mitigation |
|---|---|---|
| Render web service | 512 MB RAM; spins down after about 15 minutes with no traffic; 750 instance-hours per month (enough for one always-on service) | UptimeRobot pings `/healthz` every 5 minutes. The worker stays alive with the process. Check the current terms before launch |
| Vercel (Hobby) | Intended for personal, non-commercial use; generous bandwidth for a small app | Fine for a portfolio project. Check the current terms if usage changes |
| Supabase | Projects pause after about a week with no activity; limited database and storage size (verify current figures) | `/healthz` runs a trivial query, so the database sees regular activity. Keep stored files small (Section 9) |
| SMTP provider | Daily send quota (verify current figure) | Low volume. Digests batch instructor emails (Section 13) |
| Gemini (per instructor key) | Per-minute and per-day request limits; they depend on the model (Section 11) | Per-key pacing, retry only for per-minute limits, no periodic key checks |
| UptimeRobot | Free monitor count and 5-minute interval | One monitor (`/healthz`) |

### 4.3 Supabase connection rules
Prisma and pg-boss need different connection modes:
- `DATABASE_URL`: transaction pooler (port 6543) with `?pgbouncer=true`. Used by Prisma at runtime. Prisma prepared statements are disabled for this mode.
- `DIRECT_URL`: session pooler (port 5432), owner role. Used by `prisma migrate deploy` and `db:boss:init`.
- `PGBOSS_URL`: session pooler (port 5432), runtime role. Used by pg-boss at runtime. pg-boss relies on `LISTEN/NOTIFY` and advisory locks, which need session semantics.
- Database roles and grants are in [Backend Schema](backend-schema.md) §12.
- The direct connection host on free projects has historically been IPv6-only, and Render free instances may not reach IPv6. Use the pooler host for every URL and confirm in spike S2.

### 4.4 Environment variables
Listed in Appendix A. Secrets live only in Render and local `.env` files, never in the web bundle. The Supabase service-role key and `ENCRYPTION_KEY` exist only on the API.

### 4.5 Deploy steps (summary)
- Vercel builds `apps/web` and serves `vercel.json` with the `/api/*` rewrite to the Render URL.
- Render builds `apps/api` and runs `prisma migrate deploy` before starting the server.
- Health check path: `/healthz`.
- Full runbook is written later (Deployment Runbook).

---

## 5. Data model

### 5.1 Entities
Tables, columns, constraints, indexes, and the Prisma schema are in [Backend Schema](backend-schema.md), which wins on anything stored. This section keeps only the rules the rest of this document relies on:

- **User:** one role per account (A6). Roles: `STUDENT`, `INSTRUCTOR`, `SUPER_ADMIN`. Accounts are **never hard-deleted**; deletion turns the row into a tombstone (below), so foreign keys stay valid.
- **Enrollment:** `PENDING`, `ACTIVE` (shown as "Approved"), `DECLINED`, `REMOVED`. Unique per class and student.
- **Assignment:** `DRAFT`, `PUBLISHED`, `ARCHIVED`. `criteriaVersion` increments when criteria or reference files change (FR-ASG-04). Due date changes do not increment it.
- **Submission:** one per student per assignment (FR-SUB-07). `state` is null until the first version is stored. It holds the pointer to the grade students see (`activeGradeId`) and attempt counters.
- **SubmissionVersion / SubmissionFile:** each resubmission is a new version. Files are stored only after validation (Section 9). Only the current version keeps files: finalizing a new version deletes the previous version's files and `SubmissionFile` rows, and the version record stays (Backend Schema §10.2a).
- **GradeResult:** every AI or instructor result. Status `ACTIVE`, `PENDING_REVIEW` (a re-grade of an approved submission, FR-REV-10), `SUPERSEDED`, or `DISCARDED`. At most one `ACTIVE` and one `PENDING_REVIEW` per submission, enforced by partial unique indexes.
- **ReviewAction:** instructor actions for the audit trail: approvals (with edit classification, FR-REV-08), reopens, grants, late allowances, and re-grade decisions.
- **GradingAttempt:** one row per Gemini call. Source of the platform health metrics and the "instrumentation" list in PRD Section 14.
- **Announcement / AnnouncementFile / ReferenceFile:** attachments in private storage.
- **Notification / NotificationPreference / AuditLog:** Section 13 and 14.
- **StorageDeletion:** outbox of object paths to delete after a commit (Section 5.5).

### 5.2 Derived states (computed in the query layer, never stored)

| Display state | Rule |
|---|---|
| Late | `latestSubmittedAt > assignment.dueAt` |
| Missing | No stored version, and `now > dueAt` |
| Not yet due | No stored version, and `now <= dueAt` |
| Closed (student row) | Past due, `acceptLate = false`, and `lateAllowed = false` |
| Criteria changed since approval | `state = INSTRUCTOR_APPROVED` and the active grade's `criteriaVersion < assignment.criteriaVersion` |
| Grading in progress | `state` is `QUEUED` or `GRADING` |
| Turned in | Has a stored version (Late and Needs manual review are subsets) |

Storing none of these means a due-date edit recomputes Late for every submission with no backfill (FR-ASG-05).

### 5.3 Attempts
- `remaining = (maxResubmissions ?? Infinity) + extraAttempts - resubmissionsUsed`.
- `resubmissionsUsed` increases only when a version beyond the first is **finalized** (uploads that are abandoned or fail never count, FR-AI-05).
- Re-grades, manual re-runs, and instructor-triggered jobs never change the counters (FR-SUB-05).
- "Give attempt back" (after a system-caused manual review) increases `extraAttempts` by 1 and writes a `GRANT_ATTEMPTS` ReviewAction (D7). Nothing is refunded automatically.
- Lowering the limit below what was used leaves `remaining` at 0 or below, shown as 0 (edge case in PRD Section 13).

### 5.4 Grade visibility
- Students see only `Submission.activeGradeId`.
- Re-grade of an approved submission (FR-REV-10): create a `GradeResult` with `PENDING_REVIEW`. `activeGradeId` does not change. Approving swaps `activeGradeId` to the pending result and marks the old one `SUPERSEDED`. "Keep previous grade" marks the pending one `DISCARDED`.
- Re-grade of an unapproved submission: set `activeGradeId` to null (the old AI result is hidden, app-flow F24), then the new result becomes active on completion.

### 5.5 Tombstones and deletion

| Event | What is removed | What is kept |
|---|---|---|
| Student deletes account or Super Admin deletes it (A14) | Sessions, auth identities, email tokens, notifications, preferences, all submission files in storage, feedback text, instructor comments | Submission row with score, letter, state, timestamps, and the tombstone User row (name "Deleted student", email replaced with `deleted-<id>@tombstone.invalid`, no password) so the gradebook shows "Deleted student" |
| Instructor deletes account (FR-AUTH-10) | Instructor sessions, identities, tokens, the encrypted key | Classes are archived (`archivedAt`), students are notified. Tombstone User row. Class data follows the retention job (Section 12) |
| Instructor or Super Admin deletes a class (FR-CLS-11) | All enrollments, assignments, submissions, grades, announcements, and their DB rows, in one transaction | Nothing. A `storage.cleanup` job removes the files after commit. Access is already revoked because the rows are gone |
| Assignment deleted (FR-ASG-09) | Submissions and grades for that assignment, files | Nothing |
| Announcement deleted (FR-ANN-03) | The row and its attachment rows, at once; files removed by job | Nothing. Notification links show "This item is no longer available" |

### 5.6 Constraints
- `Class.joinCode` unique. Codes are 8 characters from a 32-character alphabet (A to Z without I and O, digits 2 to 9; FR-CLS-02). The rate limit in Section 6.7 is what protects the code.
- `Enrollment (classId, studentId)` unique. `Submission (assignmentId, studentId)` unique. `SubmissionVersion (submissionId, versionNo)` unique. `SubmissionFile (versionId, clientFileId)` unique (idempotent upload retries).
- Scores are `Decimal(6,2)`, never floats.
- Timestamps are UTC. `Assignment.timezone` (IANA name) is stored to display the due date in the instructor's chosen zone; students see the viewer's local time (F13).

---

## 6. Authentication and sessions

### 6.1 Passwords and sign-up
- Hashing: argon2id with the OWASP minimum parameters (library: `@node-rs/argon2`).
- Minimum 10 characters, checked against a bundled common-password list (FR-AUTH-01).
- Sign-up collects first name, last name, role, and terms acceptance in one request. The terms version and time are stored (FR-AUTH-09).
- Duplicate email on sign-up returns a clear message (PRD FR-AUTH-01). This is the one place where account existence is revealed, because the PRD requires it. Sign-in and reset never reveal it (F22).

### 6.2 Sessions
- Session token: 32 random bytes, base64url. Only the SHA-256 hash is stored (`Session.tokenHash`).
- Cookie `eg_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- Timeouts (TQ2, decided): idle timeout 7 days, absolute lifetime 30 days.
- Each authenticated request checks `User.suspendedAt` against the database. There is no cache, so a suspension takes effect on the next request (app-flow Section 11).
- "Sign out of all devices" deletes every session for the user. Password reset and suspension do the same.

### 6.3 Google sign-in (FR-AUTH-02, D13)
- Authorization Code flow with PKCE via Arctic. Scopes: `openid email profile`. The issuer is configurable (`GOOGLE_ISSUER`, default Google); the E2E environment points it at a local OIDC mock (Section 16.2a).
- The Google ID token must have `email_verified = true`, or sign-in is refused.
- Rules when the email matches an existing account:
  - Already verified: add the Google identity and keep the password.
  - Unverified: mark verified, clear `passwordHash`, add the identity, and end the account's existing sessions.
- No match: a short role-and-terms step runs first (F3). The unfinished account sits in a signed `eg_pending` cookie (10 minutes) and is created only after the step is submitted.

### 6.4 Return-to and join codes
- "Signed out, protected page" (app-flow Access Rules 1): the requested path is stored in a signed `eg_return` cookie (10 minutes) and restored after sign-in.
- The same cookie holds a pending join code, so a join link survives sign-up (F2).
- The return path must match `^/(?!/)` (relative only), must not contain `\` or a scheme, and must start with one of the allowed route prefixes. Anything else falls back to the dashboard. This blocks open redirects.

### 6.5 CSRF and cookies
- `SameSite=Lax` cookies plus an `Origin` header check on every non-GET request. Requests with a missing or foreign `Origin` are rejected.
- JSON endpoints require `Content-Type: application/json`. Reference-file and announcement uploads use `multipart/form-data`. The per-file submission upload sends raw bytes (API Spec A7).
- Cookies are set only over HTTPS. `app.set('trust proxy', 1)` lets Express see the original scheme through the Vercel rewrite.

### 6.6 Email tokens (FR-AUTH-04, FR-AUTH-05)
- 32 random bytes; only the hash is stored; single use (`usedAt`).
- Reset: 60 minutes (PRD). Verification: 24 hours (TQ1, proposed).
- A reset request always returns the same response: "If that email has an account, we sent a link."
- On a successful reset, all sessions are deleted.

### 6.7 Rate limits (in memory, one instance)
The limits and their numbers are in [API Spec A12](api-spec.md). Counters live in API memory, so they are correct for one instance only (Section 3). Gemini calls use per-instructor pacing (Section 10), not these limits.

---|---|
| Sign-in per IP | 20 failed attempts per 15 minutes (successes do not count) |
| Sign-up per IP | 60 per hour (API Spec AUTH-01; sized for a class on one network) |
| Sign-in per email | 5 failed attempts per 15 minutes, then "try again later" (app-flow Section 1, step 4) |
| Password reset request per email | 3 per hour |
| Join-code attempts per user | 10 per hour (FR-CLS-03) |
| Uploads per user | 60 per minute |
| Gemini calls | Per-instructor pacing (Section 10), not this table |

---

## 7. Authorization

### 7.1 Policy layer
- One module, `policy`, exports `can(actor, action, resource)`. Route handlers call it through `authorize(action)` middleware. No handler checks roles inline.
- The actor carries `userId`, `role`, and enrollment status per class (loaded on demand).
- When the actor has no relationship to a resource, the response is **404 `NOT_FOUND`**, not 403. This is how item existence stays hidden (app-flow Access Rules 2 and 3). A Pending student gets a distinct response so the UI can show "Pending approval" (Access Rule 3).

### 7.2 Matrix tests
- Every row of PRD Section 5.1 becomes a row in a table-driven test that runs against the API with three seeded users (student, instructor, admin) and checks allowed and denied responses. A permission change without a matching test fails CI.

### 7.3 Super Admin is metadata-only (A1)
- Admin routes live under `/api/admin` and require `SUPER_ADMIN`.
- The admin module imports only an `adminQueries` repository that selects metadata columns. It does not import `SubmissionFile`, `SubmissionVersion`, `GradeResult`, `InstructorKey`, or announcement attachment models.
- A lint rule (`no-restricted-imports` scoped to the admin folder) enforces this. A test checks that every admin response excludes content fields.

### 7.4 File access
- A file is never reached by its storage URL. The download endpoint loads the file, resolves its submission, class, and enrollment, runs `can`, then returns a signed URL that lasts 5 minutes.
- Reference files and announcement attachments follow the same path. Reference files marked not visible are returned only to instructors (PRD Section 11).

---

## 8. API design

### 8.1 Conventions
- Base path `/api`. JSON with camelCase fields. No API versioning (one client, same origin).
- Errors use one envelope:
  ```json
  { "error": { "code": "VALIDATION", "message": "Plain-language text", "fields": { "title": "Required" } } }
  ```
  Codes: the catalog in [api-spec.md](api-spec.md), A4 (42 codes; `openapi.yaml` holds the same enum).
- Zod schemas live in `packages/shared`. The API parses requests with them; the web app uses the same schemas for form validation.
- State changes that can race (approve vs. resubmit, grant vs. use) run in a transaction that locks the submission row (`SELECT ... FOR UPDATE`). The loser gets `409 CONFLICT` with the current state, which the UI shows as the locked-state message (PRD Section 13, simultaneous approve and resubmit).
- Lists use cursor pagination (queue, notifications, tracker).

### 8.2 Route groups

The full contract is in [API and Integrations Specification](api-spec.md) (every endpoint with its request, response, errors, and requirement IDs) and [`openapi.yaml`](openapi.yaml) (the machine-readable contract). The endpoint index is Appendix B of that document.

Endpoints: 102 in 16 groups.

### 8.3 CSV export
- Served as `text/csv; charset=utf-8` with a UTF-8 BOM (FR-GB-02).
- Any cell whose value starts with `=`, `+`, `-`, `@`, tab, or carriage return is prefixed with `'`. This stops spreadsheet formula injection from student names or feedback text.
- Streamed row by row, so large classes do not load into memory.

---

## 9. File pipeline

### 9.1 Upload sequence
0. **Resize in the browser.** Before upload, the browser downscales each image (long edge 2000 px, JPEG quality about 80) to save storage and mobile data. PDFs are not changed. The server's limits and checks still apply to the bytes it receives. The quality setting is verified in spike S4.
1. **Create version.** `POST /assignments/:id/versions` checks the attempt count, due date, late rule, and state. It creates the Submission row if needed (state null) and a `SubmissionVersion` with status `UPLOADING`.
2. **Upload each file.** `PUT /versions/:id/files/:clientFileId` with one file per request. The browser generates `clientFileId`, so retries are idempotent (upsert on `(versionId, clientFileId)`). Steps on the server:
   - The body is the raw file bytes (API Spec A7). Stream it to a temporary file with a hard byte limit (10 MiB). Exceeding it returns `FILE_TOO_LARGE`.
   - Check the magic bytes (not the extension): PDF `%PDF-`; JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; HEIC/HEIF `ftyp` box with `heic`, `heix`, `mif1`, or `msf1` brand. Anything else returns `FILE_TYPE`.
   - HEIC: convert to JPEG (A12). The converted JPEG is the stored file.
   - PDF: load with `pdf-lib`. Encrypted or unloadable files return `FILE_ERROR` (password-protected or corrupted, FR-AI-05). Page count above 20 returns `FILE_LIMIT`.
   - Compute SHA-256. Upload to `submissions/<classId>/<assignmentId>/<studentId>/<versionId>/<ordinal>-<fileId>.<ext>`. Storage paths are generated by the server; the original filename is kept only as display text.
   - Store a `SubmissionFile` row with status `STORED`, or `FAILED` with a code. Failed files never count toward attempts.
3. **Finalize.** `POST /versions/:id/finalize` checks that every expected file is stored (the browser sends the list), that count and total size are within limits, and re-checks the attempt count inside a transaction. It sets the version to `STORED`, sets `latestSubmittedAt`, sets `firstSubmittedAt` on the first version, increments `resubmissionsUsed` for versions beyond the first, sets the submission state to `QUEUED`, marks the previous version `REPLACED` and deletes its files and file rows (storage objects go through the `storage.cleanup` outbox), and enqueues the grading job (Section 10). Late is derived, not stored.
4. **Resubmission** is blocked while `state` is `INSTRUCTOR_APPROVED` (FR-SUB-06) or attempts are exhausted.

### 9.2 Limits
Constants live in `packages/shared/limits.ts` so the client pre-check, the API, and the tests use the same numbers.

| Limit | Value | Notes |
|---|---|---|
| Files per submission | 10 | FR-SUB-02 |
| Per file | 10 MiB | FR-SUB-02 |
| Pages per PDF | 20 | FR-SUB-02 |
| Total per submission | 15 MiB raw | FR-SUB-02; reference files count toward the same grading budget (Section 11.3) |
| Reference files | Up to 3; same per-file limit; counted in the grading budget | FR-ASG-07 |
| Announcement attachment | Same as a submission file | FR-ANN-01 |

### 9.3 Storage and retention
- Buckets are private. Only the API uses the service-role key.
- Staged versions (status `UPLOADING`) older than 24 hours are deleted with their objects by the `staged.cleanup` job (Section 12).
- Stored files follow the retention rules in Section 5.5 and Section 12.
- Downloads use signed URLs valid for 5 minutes, issued only after the authorization check (Section 7.4).

### 9.4 Memory on a 512 MB host
- Uploads stream to disk; no file is held fully in memory.
- At most two HEIC or PDF processing jobs run at once (a semaphore in the API). This is the main protection for the free host (spike S4).

### 9.5 Client
- The browser checks count, size, and type before upload (fast feedback) and shows thumbnails. The server's checks are authoritative.
- The file input uses `accept="application/pdf,image/jpeg,image/png,image/heic"`. On iPhone this opens the camera or photo library directly.
- Files can be reordered with buttons as well as dragging, so the step works with a keyboard.

---

## 10. Grading pipeline

### 10.1 Queues and jobs (pg-boss)

| Queue | Payload | Behavior |
|---|---|---|
| `grade.submission` | `{ submissionId, versionId, mode: "first" \| "resubmit" \| "regrade_criteria" \| "rerun" \| "regrade_approved" }` | One grading attempt chain (Section 10.3). Singleton key `grade:<submissionId>` so only one job runs per submission |
| `regrade.assignment` | `{ assignmentId, criteriaVersion }` | Debounced fan-out to `grade.submission` for unapproved submissions (Section 10.5) |
| `send.email` | `{ notificationId, to, template, data }` | Email with retries (`retryLimit: 5`) |
| `digest.flush` | none | Hourly digests (Section 13) |
| `retention.sweep`, `staged.cleanup`, `storage.cleanup` | none or ids | Section 12 |

### 10.2 Key pacing
- An in-process limiter keeps one token bucket per instructor. Its rate starts at a conservative default (5 requests per minute) and is set per model from the spike results (Section 11).
- If a job's bucket is empty, it is re-enqueued with `startAfter` set to the next token time. Students see "Grading in progress" (PRD Section 9.5).
- A global concurrency cap of 3 applies to all Gemini calls.
- Because the worker is one process (Section 3), an in-memory limiter is correct.

### 10.3 Pipeline for `grade.submission`
1. Load the submission. If `versionId` is not the current version, finish as **stale** and record `STALE_DISCARDED` (FR-AI-06).
2. Load the instructor's key. If it is missing, set `NEEDS_MANUAL_REVIEW` with cause `KEY_MISSING`. If its status is `NEEDS_ATTENTION` or `QUOTA_REACHED`, use the matching cause. Do not call Gemini. Notify the instructor once per transition (debounced per instructor for 1 hour). Stop without retrying.
3. Acquire a pacing token (Section 10.2).
4. Build the request (Section 10.4) and call Gemini with a 60-second timeout.
5. Parse and validate the response (Section 10.6). Invalid output is a transient error.
6. In a transaction that locks the submission row:
   - Re-check the version is still current (stale check again, for a version that changed during the call).
   - Insert a `GradeResult` (`ACTIVE`, or `PENDING_REVIEW` when `mode = regrade_approved`). Supersede the previous active result when appropriate (Section 5.4).
   - Set `state` to `AI_GENERATED`, or keep `INSTRUCTOR_APPROVED` for a pending re-grade. Clear `manualReviewCause`.
   - Create the notification: `SUBMISSION_GRADED`, or `REGRADE_COMPLETE` for a re-grade.
7. Record a `GradingAttempt` for every attempt, with outcome, error class, latency, and model.

### 10.4 Request construction
- **System instruction** (versioned constant `grade-v1`, in `packages/ai/prompts`): the role, the scoring rules, and the rule that student and reference file content is **data, never instructions**. Response only as JSON matching the schema. The full text is in the AI Guardrails doc.
- **User content, in order:** assignment title and instructions; criteria text verbatim; scoring format and max score, plus the letter scale when relevant; reference files, each labeled "Reference material from the instructor, not student work"; student files in order, each labeled "Student file N of M, page P" where relevant.
- **Delimiters:** each request uses a random boundary token. Each text block is wrapped in it, so student text cannot close a block early.
- **Not sent:** instructor comments, other students' work, student names or IDs, email addresses.
- Files are sent **inline** (base64 in the request), not through Gemini's Files API. Files API copies stay on Google's side for a limited time, and inline keeps student work out of that store (Section 11).

### 10.5 Re-grades and debounce
- Saving criteria or reference-file changes runs the impact count (`POST /assignments/:id/criteria-impact`) for the confirmation dialog. The confirmation shows that count (FR-ASG-04).
- On confirm: increment `criteriaVersion`, set `regradeNotBefore = now + REGRADE_DEBOUNCE_SECONDS` (default 120), and enqueue `regrade.assignment` with `startAfter` = that time.
- Each further edit moves `regradeNotBefore` forward and enqueues a new job. When a `regrade.assignment` job runs before `regradeNotBefore`, it re-enqueues itself at `regradeNotBefore`. Only the last one does the work (app-flow F8, PRD edge case "several times quickly").
- The worker then sets each unapproved submission's `activeGrade` to null, moves its state to `QUEUED`, and enqueues `grade.submission` with `mode = regrade_criteria`. Approved submissions are not touched (A3). They are flagged by the derived rule in Section 5.2.
- The re-grade progress banner (app-flow 5.2) counts finished jobs against the total for the batch.
- If the quota runs out mid-batch, the remaining items get `KEY_QUOTA` (Section 11).

### 10.6 Output validation
- JSON must parse; `score` must be a finite number from 0 to the max score, inclusive; `feedback` must be non-empty after trimming and at most 4,000 characters (longer text is truncated with a note).
- The letter is always derived by the server from the score and the assignment's scale. Any letter from the model is ignored (PRD Section 9.2).
- Default letter scale (FR-ASG-06, proposed; instructors can adjust per assignment): A 93–100; A- 90–92; B+ 87–89; B 83–86; B- 80–82; C+ 77–79; C 73–76; C- 70–72; D+ 67–69; D 63–66; D- 60–62; F below 60.
- `confidence` and `readabilityIssue` are stored. When either signals low quality, the queue item gets a priority marker (PRD Section 9.2).

### 10.7 Error classes and behavior

| Class | Examples | Retry? | Result |
|---|---|---|---|
| **Transient** | timeout, 5xx, network error, per-minute 429, invalid output | Yes: pg-boss `retryLimit: 2` (three attempts in total), exponential backoff with jitter, base 5 s, cap 60 s. Honor `retry-after` when present | After the last failure: `NEEDS_MANUAL_REVIEW`, cause `AI_FAILED`; count in platform metrics |
| **Key invalid** | invalid key, revoked key, API not enabled (401/403 variants) | No | Cause `KEY_INVALID`; key status `NEEDS_ATTENTION`; instructor notified immediately |
| **Quota** | daily limit reached (classification in TQ3) | No | Cause `KEY_QUOTA`; key status `QUOTA_REACHED`; instructor notified immediately |
| **File quality** | unreadable file reached grading (should be caught at upload) | No | Cause `FILE_QUALITY`; student sees "awaiting instructor review"; instructor sees the reason |
| **Stale** | version changed during the call | No | Discarded; no state change |

### 10.8 Manual actions
- **Re-run AI (FR-REV-06, FR-KEY-05):** one `grade.submission` job with `mode = rerun`. It does not consume attempts. Bulk re-run enqueues one job per item and the limiter spaces them.
- **Manual grade:** the instructor enters score and feedback and approves in one step (API Spec INS-11). Creates an `INSTRUCTOR` GradeResult and sets the state to `INSTRUCTOR_APPROVED`. No unapproved instructor grade ever exists.

### 10.9 Concurrency and idempotency
- Singleton key per submission (Section 10.1) prevents two grading jobs at once.
- The version check (steps 1 and 6) prevents a late result from overwriting a newer submission (FR-AI-06).
- Re-grade of an approved submission is rejected with 409 if a `PENDING_REVIEW` result already exists.

---

## 11. Gemini model and limits

### 11.1 Decision
- Client: `@google/genai`. Model name in one constant (`GEMINI_MODEL`). Prompt version in another (`PROMPT_VERSION`). Both are stored with every result (PRD Section 9.6).
- Selection: the current stable model in the Flash class that accepts PDF and image input with JSON response schemas on the free tier. The candidate at the time of writing is **Gemini 2.5 Flash**. It must be confirmed against Google's current model list and free-tier limit table during spike S3. Record the final model ID, date, and limits here before building the pacing numbers.
- Temperature: 0.2 (PRD "low temperature"). Top-p and top-k left at SDK defaults.

### 11.2 Limits to record at spike S3

| Item | Value | Source |
|---|---|---|
| Requests per minute (free tier, chosen model) | To be recorded | Google's rate-limit page at spike time |
| Requests per day | To be recorded | Same |
| Tokens per minute | To be recorded | Same |
| Inline request payload limit | To be recorded (expected about 20 MB total; base64 adds about 33%) | Google's docs |
| PDF page limit per request | To be recorded | Google's docs |
| Key validation call | A model-list call, which uses no generation quota (confirm) | Spike test |

### 11.3 Derived constraints (revisit at S3)
- **Inline budget:** `GRADING_INPUT_BYTES = 15 MiB` of raw file bytes per grading call, reference files included. Base64 expansion puts the request near 20 MB, which keeps it under the inline limit with margin.
- This is the 15 MB total in PRD FR-SUB-02 (D16). It can rise if S3 shows a larger inline limit.
- Alternative considered: Files API. Rejected for v1 because uploaded files are copied to Google's file store for a limited period. Inline keeps the disclosure in FR-KEY-04 accurate and avoids an extra storage copy.

### 11.4 Free-tier data use
Google may use free-tier content to improve its products (disclosed to instructors, FR-KEY-04). The TRD does not change that. The app stores the key's paid or free status only if the instructor declares it; it does not detect it. Paid-tier keys are accepted and recommended for any real student data.

### 11.5 Key validation and status
- Saving a key runs the model-list call (no generation quota). Success sets `CONNECTED`. Failures map to `KEY_INVALID`, `KEY_API_DISABLED`, `KEY_QUOTA`, or `PROVIDER_UNAVAILABLE` (FR-KEY-02; API Spec KEY-02).
- There is **no periodic Gemini call** for key status. Status updates on the next grading call or on a manual "Test connection" (app-flow Section 13). This protects the instructor's quota.

---

## 12. Scheduled jobs and retention

| Job | Schedule | Purpose | Idempotency |
|---|---|---|---|
| `digest.flush` | Hourly | Send batched emails: instructor digests for new submissions, manual-review items, and join requests (Could, FR-NTF-03), and announcement digests for students (FR-ANN-04) | Each digest row is marked sent in the same transaction |
| `retention.sweep` | Daily, 03:00 UTC | (a) For classes with `archivedAt <= now - 335 days` and no `retentionNoticeAt`: send the 30-day notice (A15) and set `retentionNoticeAt`. (b) For classes with `archivedAt <= now - 365 days`: delete through the class-deletion path (Section 5.5) | Notice flag set once; delete is a no-op if the class is gone. (c) Delete `AuditLog` rows older than 12 months | Notice flag set once; delete is a no-op if the class is gone |
| `staged.cleanup` | Hourly | Delete versions in `UPLOADING` older than 24 hours and their files | Checks status before deleting |
| `storage.cleanup` | Queued after commits | Delete storage objects listed by a finished delete | Missing objects are ignored |
| `token.cleanup` | Daily | Delete expired email tokens and sessions | Idempotent by definition |

- Instructor deletion archives the classes at that moment, so the 12-month clock starts then (A10).
- Notices for an instructor whose account is a tombstone are not sent (PRD Section 10).

---

## 13. Notifications and email

### 13.1 Fan-out
- Domain code calls `notify(type, recipients, payload)` in the same transaction as the event where possible.
- `notify` writes one `Notification` row per recipient (in-app, source of truth) and, when the channel applies, enqueues `send.email`.
- Email is sent only if the recipient's address is verified, except the exceptions listed below. It is also skipped if the user disabled that category (FR-NTF-04).
- Digest types (new submission, Needs manual review, and join request for instructors; announcements for students) go to `digest.flush`, not to `send.email`.

### 13.2 Notification types
The Prisma enum `NotificationType` has the 19 notifiable events in PRD Section 10. File errors are shown on screen and do not create notifications.

`SUBMISSION_GRADED`, `GRADE_APPROVED`, `SUBMISSION_AWAITING_REVIEW`, `NEEDS_MANUAL_REVIEW_INSTRUCTOR`, `NEEDS_MANUAL_REVIEW_STUDENT`, `KEY_NEEDS_ATTENTION`, `REGRADE_COMPLETE`, `SUBMISSION_REOPENED`, `JOIN_REQUEST_RECEIVED`, `JOIN_DECIDED`, `ATTEMPTS_GRANTED`, `LATE_ALLOWED`, `ASSIGNMENT_PUBLISHED`, `DUE_DATE_CHANGED`, `CLASS_DELETED`, `INSTRUCTOR_ACCOUNT_DELETED`, `ACCOUNT_STATUS_CHANGED`, `RETENTION_NOTICE`, `ANNOUNCEMENT_POSTED`.

### 13.3 Exceptions to "verified only"
- Verification emails and password-reset emails are transactional. They go to the address on file (the verification email is the reason the account is unverified).
- Account suspension and reinstatement notices go to the address on file, even if unverified (PRD Section 10).

### 13.4 Content rules
- Emails contain a short description and an absolute deep link built from `APP_URL`. They never contain scores, feedback, or file names (privacy; FR-NTF-02 "includes a deep link").
- Plain text and HTML versions. No tracking pixels or third-party analytics.
- Links open the in-app target after sign-in (Section 6.4).

### 13.5 Mailer
- A `Mailer` interface with `send({ to, subject, text, html })`, chosen by `MAIL_DRIVER`.
- `smtp`: nodemailer over a free SMTP provider (Brevo is the candidate; verify its daily quota and terms at spike S5). Used in production.
- `fake`: keeps messages in memory. `GET /api/dev/outbox?to=<address>` returns them, so tests read verification and reset links from it. The route is registered only when `MAIL_DRIVER=fake`, and the API refuses to start with `fake` when `NODE_ENV=production`.
- Deliverability without a custom domain is lower. In-app notifications remain the source of truth (PRD Section 15 mitigation). Moving to a custom domain later needs only configuration changes.

---

## 14. Security

| Area | Control |
|---|---|
| Transport | HTTPS enforced by Vercel and Render. `Strict-Transport-Security` set by helmet |
| Headers | helmet defaults. Content-Security-Policy for the SPA: `script-src 'self'`, `frame-ancestors 'none'`. The pdf.js worker is bundled and served from the same origin |
| Cookies | `HttpOnly`, `Secure`, `SameSite=Lax`, short-lived signed cookies for pending state (Section 6) |
| Passwords | argon2id; a dummy hash is checked when the email does not exist, so response time does not reveal accounts |
| Instructor keys | AES-256-GCM. A random 12-byte IV per record and an auth tag stored with the ciphertext. `ENCRYPTION_KEY` (32 bytes, base64) comes from the environment; `keyVersion` allows rotation (re-encrypt on read with the old version, then write with the new one). Only `last4` is ever returned. Never logged |
| Logs | pino redaction: `authorization`, `cookie`, `password`, `token`, `key`, `ciphertext`, file contents. Request bodies are not logged |
| Input | Zod on every request body and query. Size limits on JSON (100 KB) and multipart (per file limits, Section 9) |
| SQL | Prisma parameterized queries. No raw SQL except the pg-boss schema and the row-lock helper (Section 8.1) |
| Files | Storage paths generated by the server. Content sniffed by magic bytes. No public buckets. Signed URLs 5 minutes. Original names are never used in paths |
| XSS | React escapes all output. Feedback is rendered as plain text, not HTML or Markdown |
| CSV | Formula-injection prefix (Section 8.3) |
| Authorization | Central `policy` module; 404 for inaccessible items; table-driven tests (Section 7.2) |
| Admin | Metadata-only repository and lint rule (Section 7.3). Every admin action is written to `AuditLog` with actor, target, and reason |
| Overrides | Attempt grants, late allowances, and give-backs are `ReviewAction` rows and notify the student (FR-SUB-10) |
| Rate limits | Section 6.7 |
| Dependencies | `pnpm audit --prod` in CI (advisory; reviewed by the owner before release) |
| Secrets | Service-role key and `ENCRYPTION_KEY` only in the API environment. Gemini eval key only on the owner's machine, never in CI or production |
| Account deletion | Section 5.5 (tombstones keep the gradebook consistent without personal data) |
| Malware | Not scanned in v1 (T-D8). The PRD does not require it |

---

## 15. Frontend architecture

### 15.1 Routes
Routes follow the App Flow screen inventory.

| Route | Screen (app-flow) | Guard |
|---|---|---|
| `/` | Landing | Public; signed-in users go to `/classes` |
| `/signup`, `/signup/role` | Sign up; first Google role step | Public |
| `/signin`, `/forgot`, `/reset/:token`, `/verify/:token` | Auth screens | Public |
| `/join/:code` | Join-link landing | Public (preserves code) |
| `/terms`, `/privacy` | Legal | Public |
| `/classes` | Dashboard (instructor and student views) | Signed in |
| `/classes/new` | Create class | Instructor |
| `/classes/:classId` | Class page; tabs `overview`, `assignments`, `people`, `gradebook`, `announcements` | Member (approved) or instructor owner |
| `/classes/:classId/assignments/new` | Assignment wizard (create) | Instructor owner |
| `/assignments/:id` | Student assignment detail (upload and result) | Approved student |
| `/assignments/:id/edit` | Assignment wizard (edit) | Instructor owner |
| `/assignments/:id/tracker` | Tracker | Instructor owner |
| `/submissions/:id` | Submission screen (single target for queue, tracker, gradebook, and notification links, F19) | Instructor owner, or the student for their own result view |
| `/review` | Review queue (all classes; `?classId=` for per-class) | Instructor |
| `/notifications` | Notifications center | Signed in |
| `/settings/account`, `/settings/ai` | Account settings; Gemini key (instructor only) | Signed in; `ai` instructor only |
| `/admin/*` | Admin area (separate layout) | Super Admin |
| `/no-access`, `/account-suspended`, `/not-found`, `/error`, `/maintenance` | Error and access screens | Public |

### 15.2 Guards
- `RequireAuth` stores the requested path as the return-to target (Section 6.4).
- `RequireRole` shows the no-access screen for wrong roles.
- Membership is decided by the API (404 for no access; a Pending response for pending students). The UI does not infer membership itself.

### 15.3 Data and polling
- TanStack Query with one query key per resource. Mutations invalidate the affected keys.
- Grading status: `refetchInterval` of 5 seconds only while the visible submission is `QUEUED` or `GRADING`; polling pauses when the tab is hidden.
- Notification unread count and review-queue badge: every 60 seconds, paused when hidden.
- Loss of connection shows the shared error component with Retry. Typed text stays in the form (app-flow Section 11).

### 15.4 Forms and shared components
- react-hook-form with Zod resolvers from `packages/shared`.
- Shared components for empty, loading, and error states (app-flow Section 11), and for the "This item is no longer available" page.
- Dialogs use Radix focus management. Destructive actions require typing the name or DELETE, as specified in the PRD.

### 15.5 Viewers
- PDF: react-pdf with the pdf.js worker bundled from the same origin. Page navigation, zoom, and fit-to-width.
- Images: `<img>` with zoom controls.
- Both viewers take signed URLs from the API and are placed beside the score and feedback on the Submission screen (FR-REV-02). On narrow screens, they stack.

### 15.6 Mobile and accessibility
- Mobile-first layout; tested at 360 px width with no horizontal scroll.
- Keyboard-operable file reorder, tabs, and dialogs. Colour is never the only status signal (chips include text).
- Target WCAG 2.1 AA for core flows (PRD Section 12).
- **Theming:** light and dark themes (PRD D14). Tailwind `darkMode: 'class'` with tokens as CSS variables; default follows the system setting; manual choice stored in `localStorage` (non-sensitive, with a fallback to the system setting on read failure); an inline head script prevents a flash of the wrong theme. Component files may not use literal colors (lint rule). Token values and contrast results are in the UX Brief (Section 5). The accessibility suite in Section 16.2a runs in both themes.

---

## 16. Observability, testing, and CI

### 16.1 Observability
- Structured JSON logs (pino) with a request ID. Product events are logged as structured lines (for example `grading.attempt`, `key.status_changed`, `notification.sent`), not sent to a third-party analytics service (data minimization).
- Platform health (FR-ADM-03) is computed from `GradingAttempt` and `Submission` (success rate, manual-review rate by cause, queue depth from pg-boss). No separate metrics store.
- Alerts: UptimeRobot notifies the owner when `/healthz` fails. Failed-job counts are checked in the admin health view. Daily error emails are out of scope for v1.

### 16.2 Testing

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest | State derivations (Section 5.2), attempt arithmetic (5.3), letter derivation (10.6), CSV escaping (8.3), return-to validation (6.4), magic-byte sniffing (9.1), score validation (10.6) |
| Integration | Supertest against the test database (the `edugemini-test` project locally, the service container in CI) | Authorization matrix (7.2); upload and finalize flow; approve vs. resubmit race; re-grade pending flow; tombstone deletion; class deletion cascade |
| Worker | Vitest with the fake Gemini adapter | Retry classes (10.7), stale discard (FR-AI-06), pacing (10.2), debounce (10.5) |
| End to end (UI and API) | Playwright, four browser engines plus mobile viewports, real app stack, `GEMINI_MODE=fake` (Section 16.2a) | Every PRD journey mapped to FR IDs; API contract, security, and authorization matrix; accessibility |
| Quality | `pnpm eval:grading` (manual) | Gold-set run (PRD Section 9.6) against real Gemini with the owner's eval key. Writes a report to `eval/reports/`. Not in CI (uses quota and cannot run without a key) |

### 16.2a End-to-end testing with Playwright (UI and API)

**Purpose.** Prove the PRD journeys work through a real browser and the real HTTP API, on the same stack as production: same-origin routing, cookies, file upload, polling, downloads, and email links. Unit and integration tests cover logic; E2E covers the seams between them.

**Principles (non-negotiable)**
1. **No mocks of our own code.** The app runs for real. Only external services are replaced: Gemini (fake adapter), SMTP (fake mailer, Section 13.5), and Google sign-in (a local OIDC mock).
2. **Independent tests.** Each test creates its own users, classes, and files with a unique suffix. No test depends on order or on another test's data.
3. **No fixed sleeps.** Assertions use web-first `expect` with explicit timeouts. `waitForTimeout` is banned by lint.
4. **Accessible selectors first.** `getByRole`, `getByLabel`, and visible text from the App Flow. `data-testid` is used only when no accessible name exists, and each one is listed in a single registry file.
5. **Zero flake budget.** A test that passes only on retry is reported in the run summary and fixed in the same sprint. Retries exist to surface flakiness, not to hide it.
6. **Traceable titles.** Each test title starts with the requirement ID it verifies (for example `FR-AUTH-05: reset link is single-use`). A script builds the FR coverage report from the titles.
7. **Safety guard.** The suite refuses to start unless `E2E_BASE_URL` is `localhost`, `127.0.0.1`, or a hostname in the CI allowlist, and the project ref in `E2E_DATABASE_URL` (the part of the Supabase username after the dot) equals `E2E_PROJECT_REF`, the test project. In CI the database host must be `localhost` (service container). Every destructive command (`prisma migrate reset`, the e2e global setup, demo seeding) applies the same check. The only production run is the read-only smoke mode (below).

**Project layout** (`apps/e2e`, a pnpm workspace package)
```
apps/e2e/
  playwright.config.ts        projects, reporters, timeouts, retries
  global-setup.ts             reset the test database, create role users, save auth state
  fixtures/
    index.ts                  extended `test`: role sessions, API client, mailbox, file helpers
    api.ts                    typed client built from packages/shared Zod schemas
    mailbox.ts                fake mailer outbox endpoint: wait for a message, extract links
    db.ts                     Prisma on the test database only (set dueAt, archivedAt for time-based cases)
    permission-matrix.ts      PRD Section 5.1 as data (role x action x expected status)
    files/                    generated by scripts/make-fixtures.ts (deterministic bytes)
    test-ids.ts               registry of every data-testid
  pages/                      page objects: SignIn, SignUp, ClassPage, AssignmentWizard, UploadPanel, SubmissionScreen, Tracker, ...
  specs/
    ui/                       browser journeys (table below)
    api/                      HTTP contract, security, authorization, idempotency
    a11y/                     axe scans and keyboard-only flows
  .auth/                      storage state per role and project (git-ignored)
  reports/                    HTML, JUnit, and blob output (git-ignored)
```

**Browser and device matrix**

| Project | Engine and device | Tags run on pull requests | Tags run on main and nightly |
|---|---|---|---|
| `chromium-desktop` | Chromium, desktop | `@smoke`, `@regression`, `@a11y` | All |
| `firefox-desktop` | Firefox, desktop | `@smoke` | All |
| `webkit-desktop` | WebKit (Safari engine), desktop | `@smoke`, `@auth` (cookie and storage rules) | All |
| `mobile-chromium` | Chromium, Pixel 7 viewport | `@smoke`, `@upload` | All |
| `mobile-webkit` | WebKit, iPhone 14 viewport | `@smoke`, `@upload` | All |
| `api` | No browser; Playwright `request` fixture | `@api` | All |

Tags: `@smoke` (fast core paths, under 5 minutes per project), `@auth`, `@upload`, `@regression`, `@a11y`, `@api`, and `@nightly` (slow time-based and rate-limit cases).

**Authentication in tests**
- Global setup signs in through the real sign-in endpoint, not by writing cookies directly. It saves storage state for `student`, `student2` (cross-student isolation), `instructor`, and `admin` for each project, under `.auth/`.
- Tests that cover sign-in itself use fresh contexts.
- Google sign-in runs against a local OIDC mock. The issuer is configurable (`GOOGLE_ISSUER`, Section 6.3). The production code path is otherwise unchanged.

**Email.** The E2E environment sets `MAIL_DRIVER=fake`. Each test uses a unique recipient address, waits for the message through the outbox endpoint, and extracts verification and reset links. No test ever sends to a real mailbox.

**Grading.** The E2E environment sets `GEMINI_MODE=fake`. The fake adapter returns deterministic results selected by a scenario tag in the uploaded file name, for example `__scenario-score-42__`. Scenarios:

| Scenario tag | Fake behavior | Expected app behavior |
|---|---|---|
| `score-42` | Valid result, score 42 | AI-generated, chip shown |
| `timeout-then-ok` | First call times out, second succeeds | Silent retry; student never sees an error |
| `timeout-always` | Every call times out | Needs manual review, cause AI failed |
| `key-invalid` | Key rejected | Needs manual review, cause key invalid; banner; no retry |
| `quota-daily` | Daily quota error | Needs manual review, cause quota; banner |
| `score-above-max` | Score greater than max | Treated as invalid output; retried; then manual review |
| `malformed-json` | Non-JSON text | Transient error; retried |

- The fake adapter refuses to start when `NODE_ENV=production` or `GEMINI_MODE=live`. Scenario parsing exists only in the fake adapter.
- Prompt-injection behavior is tested by the AI Guardrails gold set, not by E2E, because a fake cannot show how a real model responds.

**Clock and timing**
- Due dates are set explicitly through the API, in the past or future. Server-side state never depends on the wall clock in tests.
- The re-grade debounce is `REGRADE_DEBOUNCE_SECONDS`. The default is 120; the E2E environment sets 2. The `@nightly` suite also runs the real default.
- Grading waits use explicit timeouts (30 seconds). The fake finishes in seconds, so a longer wait signals a defect.
- Browser-only timing (polling, toasts) may use `page.clock`.

**Data and isolation**
- Global setup resets the test database (`prisma migrate reset --force`, allowed only by the safety guard), creates the role users through the public sign-up API, and creates the Super Admin through `pnpm admin:create` (Section 17.2).
- Each test creates a scope (unique suffix). Classes and assignments are named with it. An `afterEach` hook deletes the class through the API, which also exercises the class-deletion path.
- Workers run in parallel (`fullyParallel: true`; four workers locally and in CI).

**Files.** `scripts/make-fixtures.ts` generates deterministic test files. Each one has a fixed expected outcome:

| Fixture | Expected result |
|---|---|
| 1-page PDF, JPEG, PNG | Accepted |
| HEIC sample | Accepted, stored as JPEG (A12) |
| 20-page PDF | Accepted (boundary) |
| 21-page PDF | `FILE_LIMIT` |
| 11 MiB file | `FILE_TOO_LARGE` |
| 11 files in one submission | `FILE_LIMIT` (count) |
| Text file renamed `.pdf` | `FILE_TYPE` (magic bytes) |
| Password-protected PDF | `FILE_ERROR` (no attempt consumed) |
| Truncated PDF | `FILE_ERROR` (no attempt consumed) |

**UI journeys (`specs/ui`)**

| Spec | Journeys | Requirements | Projects |
|---|---|---|---|
| `auth.spec` | Sign up, duplicate email, generic sign-in error, reset request that never reveals the account, reset link expiry and single use, verification, Google link rule, first-Google role step | FR-AUTH-01 to 05, 09 | All (`@auth` on WebKit) |
| `account.spec` | Change name and password, delete own account, instructor delete consequences | FR-AUTH-07, 10; A14 | Chromium, WebKit |
| `key.spec` | Disclosure acknowledgement, invalid-key message, masked key, remove key | FR-KEY-01 to 07 | Chromium, WebKit |
| `class.spec` | Create class with attestation, copy code and link, join with approval on and off, pending screen, approve, decline, remove, archive, edit, delete with typed name | FR-CLS-01 to 11 | All |
| `assignment.spec` | Wizard autosave, draft visibility, publish warnings, resubmission and late settings | FR-ASG-01 to 03, 10, 11 | All |
| `upload.spec` | Type and size messages, thumbnails, keyboard reorder and remove, HEIC, progress, retry after a network drop (route aborted), receipt | FR-SUB-01 to 03, 08; FR-AI-05 | Mobile and desktop (`@upload`) |
| `grading.spec` | Queued to result with chip, silent retry, manual review with cause, key banner, re-run prompt after the key is fixed | FR-AI-01 to 04; FR-KEY-05 | Chromium, WebKit, mobile |
| `attempts.spec` | Attempts-left display, zero attempts blocks upload, give attempt back, reopen with grant | FR-SUB-05, 09, 10; FR-REV-05 | Chromium |
| `review.spec` | Queue order, side-by-side view, edit and approve with validation, instructor comment, chip change, keep previous, approved re-grade | FR-REV-01 to 10 | Chromium, mobile |
| `tracker.spec` | Counts, search, status filter, criteria-changed filter with bulk re-grade, CSV download (BOM, escaping) | FR-GB-01 to 06; FR-ASG-04 | Chromium |
| `late.spec` | Late flag, closed late submissions block upload, allow late unlocks upload | FR-SUB-04; FR-ASG-11 | Chromium |
| `notifications.spec` | Unread count, mark read, mark all, deep links, unavailable target, deep link from email after sign-in | FR-NTF-01, 02 | All |
| `admin.spec` | Suspend with reason (user sees "Account suspended" and gets email), admin class deletion notifies, admin cannot reach submission content | FR-ADM-01 to 04 | Chromium |
| `announcements.spec` | Post with attachment, student download, pending student cannot see, delete | FR-ANN-01 to 05 | Chromium (`@regression`) |
| `nightly.spec` | Real 120-second debounce, retention notice (archivedAt set in the database), rate-limit windows | FR-ASG-04; A15; FR-AUTH-01 | Nightly only |

Page objects expose user actions (`signIn`, `uploadFiles`, `approve`), not selectors. Specs contain no raw selectors.

**API suite (`specs/api`)** uses the `request` fixture and the shared Zod schemas, and validates every response against [`docs/openapi.yaml`](openapi.yaml).
- **Contract:** each documented route returns its schema. Errors match the envelope in Section 8.1. Strict schemas reject unknown fields.
- **Security:** sign-in cookie flags (`HttpOnly`, `Secure`, `SameSite=Lax`); a foreign `Origin` on POST returns 403; wrong content type returns 415; an oversized JSON body returns 413; helmet headers present; 500 responses contain no stack trace; `/healthz` exposes no internals.
- **Authorization:** the PRD Section 5.1 matrix as data (`permission-matrix.ts`), run for each role and action. Non-member, declined, removed, and pending users each get their defined response. Cross-tenant access (another instructor's submission, another student's file URL) returns 404.
- **Enumeration:** a nonexistent ID and an inaccessible existing ID return the same status and body.
- **Authentication:** wrong password and unknown email return identical bodies; reset requests return identical bodies for known and unknown emails; the sixth failed sign-in for one email returns 429 `RATE_LIMITED`.
- **Admin:** no admin response contains submission files, feedback, instructor comments, key ciphertext, or `last4`.
- **Idempotency:** a repeated finalize returns the same result and consumes no extra attempt. A repeated upload with the same `clientFileId` leaves one file row. A second approve returns 409.
- **Grading through the API:** enqueue, poll status, reach `AI_GENERATED`. A re-grade leaves `resubmissionsUsed` unchanged (FR-SUB-05).
- **Export:** CSV headers and content type are correct.

**Accessibility (`specs/a11y`)**
- `@axe-core/playwright` on sign-in, sign-up, class page, wizard steps 1 to 4, student upload, Submission screen, and tracker. The run fails on `serious` or `critical` violations.
- Keyboard-only specs cover sign-in, class creation, file reorder, approval, and dialog focus trapping with Escape.

**Mobile.** Mobile projects run the `@upload` tag and the core smoke path. Layout is checked at 360 px width for horizontal overflow.

**Reporting and artifacts**
- Reporters: HTML, JUnit XML, and blob (for merging CI shards).
- Traces `retain-on-failure`, screenshots and video on failure. Artifacts are kept 14 days.
- The FR coverage report lists each FR ID with its passing and failing tests across projects.

**Lint and quality gates**
- `forbidOnly` in CI, so no committed `test.only`.
- A skipped or `fixme` test needs an issue reference in its annotation. More than five `fixme` tests fails the build.
- `eslint-plugin-playwright` rules enforced: `no-wait-for-timeout`, `no-force-option`, `no-focused-test`, `no-conditional-in-test`, `prefer-web-first-assertions`, `no-element-handle`.

**Environments**
- **Local:** the API and web app start against the test project with `MAIL_DRIVER=fake` and `GEMINI_MODE=fake`, and global setup starts the OIDC mock (a small Node script). Run `pnpm --filter e2e test` (all projects) or `--project=<name>`.
- **CI:** Postgres service container, API and web built and started in the job, browsers installed with `--with-deps`, `e2e` job sharded per project with Playwright `--shard`. Pull requests run the smoke set on all projects plus the full Chromium suite. Main and nightly run everything. Superseded PR runs are cancelled.
- **Production smoke (post-deploy, read-only):** `E2E_MODE=prod-smoke` runs `@smoke` sign-in and dashboard checks against the production URL with a dedicated demo account. It performs no writes.

**Time budget.** Pull-request smoke under 5 minutes per project; full suite under 25 minutes per shard group.

**Definition of done for a feature.** Each FR ID in the feature has at least one passing test on `chromium-desktop` (or in `api` for API-only features). Features with UI on phones also pass `mobile-chromium` and `mobile-webkit`. Features that involve cookies or storage also pass `webkit-desktop`.

**Out of scope for v1:** visual regression screenshots (too flaky for the benefit at this size) and load testing (covered by the PRD 200-upload target in a separate script before M5).

### 16.3 CI (GitHub Actions)
On every push and pull request:
1. Install (pnpm, frozen lockfile).
2. Typecheck (`tsc --noEmit` for all packages).
3. Lint, including the admin import restriction.
4. Unit and integration tests with a Postgres service container (CI never uses Supabase; Section 4.1).
5. Build `apps/web` and `apps/api`.
6. `pnpm audit --prod` (advisory).
7. OpenAPI lint and breaking-change check against `docs/openapi.yaml` (API spec, A9).

End-to-end: the `e2e` job runs on pull requests (smoke on all projects, full Chromium) and on the default branch and nightly (full matrix). Details in Section 16.2a.

---

## 17. Milestones, spikes, risks, and open questions

### 17.1 Day-one spikes
These run before the features that depend on them. Each has a pass criterion. Failing a spike triggers the fallback listed.

| Spike | Test | Pass criterion | Fallback |
|---|---|---|---|
| S1 | Upload a 10 MiB file through the Vercel rewrite to Render, then sign in and reload on Chrome and Safari | Upload succeeds; session cookie persists across reload | Express serves the built web app (same origin, one service) |
| S2 | Prisma migrations and pg-boss through the Supabase session pooler from Render; redeploy the service mid-job | Job completes after restart; migrations apply | Adjust pooler mode or host choice; revisit Section 4.3 |
| S3 | Gemini call with two images and one PDF, JSON schema response, low temperature; list model limits; check key validation call | Valid JSON in 60 s; limits recorded in Section 11.2 | Choose another model in the Flash class |
| S4 | Convert a HEIC photo and a 20-page PDF on Render at 512 MB with two concurrent jobs | Peak memory under 350 MB; both finish | Switch HEIC library (TQ5); lower concurrency |
| S5 | Send a verification email to Gmail and Outlook test accounts through the chosen SMTP provider | Arrives in the inbox (not spam) for both; daily quota recorded | Try another free provider |
| S6 | Keep `/healthz` pinged every 5 minutes for 48 hours | No cold start longer than 5 seconds | Accept cold starts for the demo and say so in the README |

### 17.2 Milestones mapped to tasks

| Milestone (PRD Section 18) | Technical scope |
|---|---|
| M0 Foundations | Monorepo scaffold; Prisma schema for auth, classes, enrollments, assignments; sessions; Google OAuth; storage adapter; spikes S1 and S2 |
| M1 AI grading and keys | Instructor key storage and test call; pg-boss queues; `grade.submission` pipeline; retry classes; pacing; submission upload pipeline (Section 9); student result view; spikes S3 and S4 |
| M2 Review, tracker, gradebook | Review queue API and Submission screen; approve, reopen, overrides; re-grade flow and debounce; tracker and gradebook; CSV export |
| M3 Notifications and admin | `notify` email channel (the in-app half ships in M1); `send.email` and digests; account deletion and tombstones; retention sweep; admin area and audit log; spike S5 |
| M4 Announcements, labels (Could) | Announcement models and files; labels; bulk approve; per-assignment export; cut first |
| M5 Demo hardening | Gold-set eval; Playwright suite; seed script for demo data; README and walkthrough; keep-alive monitor (S6) |

Super Admin accounts are created by a local script (`pnpm admin:create`) that reads the production database URL from the environment. There is no web sign-up for admins (app-flow Section 12).

### 17.3 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Render free sleeps and cold-starts | Slow first grading or missed scheduled jobs | UptimeRobot keep-alive (S6); jobs persist in Postgres |
| Vercel rewrite body-size or timeout limits | Uploads fail through `/api` | Spike S1; Express-served fallback |
| Gemini daily quota per instructor key | Grading stops for the day | Manual-review path, bulk re-run after reset, paced calls, clear banner |
| Inline payload limit | Large submissions rejected by Gemini | 15 MiB raw budget (Section 11.3) |
| Free Supabase pause or limits | Downtime or failed uploads | Keep-alive; file size limits; cleanup jobs |
| In-memory rate limits and pacing | Incorrect limits if the API scales out | Single-instance constraint documented (Section 3); move to Postgres before scaling |
| HEIC conversion on 512 MB | Out-of-memory crash | Streaming, concurrency of 2, S4 |
| Email lands in spam without a custom domain | Missed verification or reset emails | In-app notifications are the source of truth; SMTP provider's sender reputation; S5; custom domain later |
| Student-data privacy in free Gemini tier | Disclosure risk | FR-KEY-04 disclosure; paid key recommended; inline files only |
| Scope too large for one developer | Core flow late | Milestone order; Could items cut first (M4) |

### 17.4 Deviations from the PRD
None open. The PRD and this document agree. A future deviation is recorded here until the owner decides it.

### 17.5 Open technical questions

| # | Question | Proposed answer | Status |
|---|---|---|---|
| TQ1 | Verification link lifetime | 24 hours | Proposed; confirm |
| TQ2 | Session idle and absolute timeouts | 7 days idle, 30 days absolute | Decided |
| TQ3 | Daily versus per-minute quota | Parse the error details at S3. Fallback: any 429 whose retry delay exceeds 60 seconds is treated as daily | Open until S3 |
| TQ4 | Grading payload budget | 15 MiB raw | Decided (PRD D16); revisit at S3 |
| TQ5 | HEIC conversion library | `sharp` if its prebuilt binary works in the Render container; otherwise `heic-convert` | Decide at S4 |
| TQ6 | Circuit breaker | Not in v1. Per-key pacing, the manual-review cause counters, and the admin health view cover the same risk at this scale | Decided |
| TQ7 | Label scope (`class` or `instructor`) | Per class (labels belong to a class's assignments) | Proposed; confirm |
| TQ8 | Super Admin creation | Local script `pnpm admin:create` (Section 17.2) | Decided |
| TQ9 | Pacing delays and the "about a minute" message | When a job is delayed by pacing, the UI shows the longer-than-usual note (PRD Section 9.5) | Decided |
| TQ10 | SMTP provider | Brevo candidate; confirm free quota and terms at S5 | Open until S5 |
| TQ11 | Gemini model choice | Gemini 2.5 Flash candidate; confirm at S3 | Open until S3 |

---

## Appendix A: Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NODE_ENV` | API | `development`, `production`, or `test` |
| `APP_URL` | API | Public web origin (absolute links in email) |
| `DATABASE_URL` | API | Supabase transaction pooler, `?pgbouncer=true` |
| `DIRECT_URL` | API | Supabase session pooler, owner role (migrations, `db:boss:init`) |
| `PGBOSS_URL` | API | Supabase session pooler, runtime role (pg-boss at runtime) |
| `SUPABASE_URL` | API | Storage endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | API only | Storage access (never in the web build) |
| `STORAGE_BUCKET` | API | Private bucket name |
| `STORAGE_DRIVER` | API | `supabase` or `local` (development) |
| `STORAGE_LOCAL_DIR` | API (development) | Folder used by the `local` storage driver |
| `ENCRYPTION_KEY` | API only | 32 bytes, base64; AES-256-GCM for instructor keys |
| `ENCRYPTION_KEY_VERSION` | API | Integer; increments on rotation |
| `SESSION_SECRET` | API only | Signs the pending-role and return-to cookies |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | API | Google OAuth |
| `GOOGLE_REDIRECT_URI` | API | `<APP_URL>/api/auth/google/callback` |
| `MAIL_DRIVER` | API | `smtp` or `fake`. Production is always `smtp` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | API | Email provider (required when `MAIL_DRIVER=smtp`) |
| `MAIL_FROM` | API | Sender address |
| `GEMINI_MODE` | API | `live` or `fake`. Production is always `live` |
| `GEMINI_MODEL` | API | Model ID (Section 11) |
| `GEMINI_EVAL_KEY` | Owner's machine only | Gold-set eval; never set in CI or production |
| `LOG_LEVEL` | API | pino level |
| `GOOGLE_ISSUER` | API | OIDC issuer; default Google, local mock in E2E |
| `REGRADE_DEBOUNCE_SECONDS` | API | Re-grade debounce; default 120, E2E 2 |
| `E2E_BASE_URL` | E2E runner | Web origin under test; must pass the safety guard (Section 16.2a) |
| `E2E_API_URL` | E2E runner | API origin (same as the web origin through the rewrite, unless testing direct) |
| `E2E_DATABASE_URL` | E2E runner | Test database (the `edugemini-test` project, session pooler) |
| `E2E_PROJECT_REF` | E2E runner | Supabase project ref of the test project; the safety guard compares it with `E2E_DATABASE_URL` |
| `E2E_MODE` | E2E runner | `full` (default) or `prod-smoke` (read-only, production URL) |
| `OIDC_MOCK_URL` | E2E runner | Local OIDC mock for Google sign-in tests |

Web build (Vercel): no secrets. The rewrite target is set in `vercel.json`.

---

## Appendix B: Traceability (every PRD requirement ID)

| ID | TRD section | ID | TRD section | ID | TRD section |
|---|---|---|---|---|---|
| FR-AUTH-01 | 6 | FR-SUB-01 | 9 | FR-REV-01 | 8 |
| FR-AUTH-02 | 6 | FR-SUB-02 | 9, 11 | FR-REV-02 | 15 |
| FR-AUTH-03 | 5, 6 | FR-SUB-03 | 9 | FR-REV-03 | 5, 8 |
| FR-AUTH-04 | 6, 13 | FR-SUB-04 | 5 | FR-REV-04 | 5 |
| FR-AUTH-05 | 6 | FR-SUB-05 | 5, 10 | FR-REV-05 | 5, 8 |
| FR-AUTH-06 | 6 | FR-SUB-06 | 5, 8 | FR-REV-06 | 10 |
| FR-AUTH-07 | 8 | FR-SUB-07 | 5 | FR-REV-07 | 8 |
| FR-AUTH-08 | 15 | FR-SUB-08 | 9 | FR-REV-08 | 5 |
| FR-AUTH-09 | 6 | FR-SUB-09 | 5, 8 | FR-REV-09 | 5 |
| FR-AUTH-10 | 5, 12 | FR-SUB-10 | 5, 8 | FR-REV-10 | 5, 10 |
| FR-KEY-01 | 5, 7 | FR-AI-01 | 10, 11 | FR-GB-01 | 8 |
| FR-KEY-02 | 10, 11 | FR-AI-02 | 10 | FR-GB-02 | 8 |
| FR-KEY-03 | 14 | FR-AI-03 | 10 | FR-GB-03 | 8 |
| FR-KEY-04 | 15 | FR-AI-04 | 10 | FR-GB-04 | 8 |
| FR-KEY-05 | 10 | FR-AI-05 | 9, 10 | FR-GB-05 | 8 |
| FR-KEY-06 | 10 | FR-AI-06 | 10 | FR-GB-06 | 8 |
| FR-KEY-07 | 15 | FR-AI-07 | 15 | FR-NTF-01 | 13 |
| FR-CLS-01 | 5, 8 | FR-ASG-01 | 5, 8 | FR-NTF-02 | 13 |
| FR-CLS-02 | 5, 8 | FR-ASG-02 | 5 | FR-NTF-03 | 13 |
| FR-CLS-03 | 6, 8 | FR-ASG-03 | 5, 8 | FR-NTF-04 | 13 |
| FR-CLS-04 | 8 | FR-ASG-04 | 10 | FR-ADM-01 | 7 |
| FR-CLS-05 | 5, 8 | FR-ASG-05 | 5, 13 | FR-ADM-02 | 7, 8 |
| FR-CLS-06 | 5, 8 | FR-ASG-06 | 5, 10 | FR-ADM-03 | 16 |
| FR-CLS-07 | 5, 8 | FR-ASG-07 | 9 | FR-ADM-04 | 5, 7 |
| FR-CLS-08 | 8 | FR-ASG-08 | 5, 8 | FR-ANN-01 | 5, 9 |
| FR-CLS-09 | 8 | FR-ASG-09 | 5, 8 | FR-ANN-02 | 7 |
| FR-CLS-10 | 8 | FR-ASG-10 | 5 | FR-ANN-03 | 5, 8 |
| FR-CLS-11 | 5, 8 | FR-ASG-11 | 5, 8 | FR-ANN-04 | 13 |
| | | | | FR-ANN-05 | 5 |
