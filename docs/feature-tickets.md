# EduGemini: Feature Ticket List

Status: approved · Date: 2026-11-15
Built from: `prd.md` (v2.2) and `trd.md` (v1.0). The PRD and TRD remain the source of truth. Where this list and they disagree, the ticket notes the gap.

## How to read this

- **ID:** `EG-<EPIC>-nn`. Epics group related work. Tickets are listed in build order within each epic.
- **Pri:** `Must`, `Should`, or `Could` from PRD §7. `Infra` means technical work with no PRD priority. Where the PRD gives no priority, the cell says so.
- **Size:** rough effort for one developer, not taken from the docs. `S` is up to a day, `M` is 2 to 3 days, `L` is about a week. Split any `L` ticket that turns out bigger.
- **MS:** milestone from PRD §18 (`M0` to `M5`). `M4` holds Could items and is cut first.
- **Refs:** FR IDs, PRD or TRD sections, and A/TQ numbers. `A` = assumed default (PRD §16.2). `TQ` = open technical question (TRD §17.5).
- **Depends on:** ticket IDs. Spikes (`SPK`) are listed as dependencies where they gate a feature.
- **Coverage:** every FR ID in PRD §7 appears in at least one ticket's Refs.

## Epic index

| Epic | Scope | Milestones |
|---|---|---|
| FND | Foundations, scaffolding, deployment | M0 |
| SPK | Day-one spikes S1 to S6 | M0, M1, M3, M5 |
| AUTH | Accounts, sessions, account deletion | M0, M3 |
| KEY | Instructor Gemini key | M1 |
| CLS | Classes, join codes, join approval, roster, archive, delete | M0 |
| ASG | Assignments, scoring, due dates, reference files, labels | M0, M1, M2, M4 |
| SUB | Submissions, uploads, limits, late, resubmission, overrides | M0 to M2 |
| AI | Grading queue, pacing, pipeline, retries, re-grades, student result | M1, M2 |
| REV | Review queue, approval, manual grading, re-grades | M2, M4 |
| GB | Tracker, gradebook, CSV, class stats | M2, M4 |
| NTF | Notifications and email | M1, M3, M4 |
| ADM | Super Admin, admin script, retention jobs | M3 |
| ANN | Class announcements (Could) | M4 |
| QA | Test harnesses, authorization tests, grading evaluation, security | M0 to M5 |
| DEMO | Seed data, README, onboarding, usability test, Terms wording, monitor | M0, M5 |
| FE | Frontend shell, themes, forms, polling, accessibility | M0, M1 |

---

## FND: Foundations and scaffolding

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-FND-01 | **Monorepo scaffold.** pnpm workspace with `apps/web`, `apps/api`, `packages/shared`, `packages/ai`. Strict TypeScript. `tsc --noEmit` passes for every package. Lint rules in `code-standards.md` §11 are configured. | TRD §2, §3 | Infra | S | M0 | — |
| EG-FND-02 | **Local dev environment.** No Docker (TRD §4.1). Two Supabase projects, `edugemini` and `edugemini-test`. Vite proxies `/api` to the local API. `.env.example` from TRD App A. `GEMINI_MODE=fake` lets the app run without a Gemini key; storage is always a private Supabase bucket (there is no local-disk storage, decided 2026-11-17), so a dev bucket and its keys are part of the setup. The fake mailer and the dev outbox route come with NTF-02, the first ticket that sends mail. | TRD §4, App A | Infra | S | M0 | FND-01 |
| EG-FND-03 | **Prisma schema and first migration.** Auth, classes, enrollments, and assignments per `backend-schema.md` Appendix A (Prisma) and Appendix B (raw SQL). Record a decision for each of the 8 open questions in `backend-schema.md` §16.2 before the migration is merged. | backend-schema App A, App B, §16.2 | Infra | M | M0 | FND-02 |
| EG-FND-04 | **API baseline.** Express 5 with Zod validation middleware, pino structured logs, helmet, one shared error format, and `/healthz`. | TRD §8, §16.1 | Infra | M | M0 | FND-01 |
| EG-FND-05 | **Rate limits.** express-rate-limit on sign-in, sign-up, and join endpoints. The reset endpoint's limit comes with AUTH-06. Document that limits are in memory and only valid for one instance. | TRD §6.7, §3; FR-CLS-03 | Infra | S | M0 | FND-04 |
| EG-FND-06 | **Storage adapter.** Private buckets, 5-minute signed URLs. Supabase Storage implementation, plus an in-memory fake for the tests. Every file request checks role and class membership. | TRD §7.4, §9.3; PRD §11 | Infra | M | M0 | FND-02 |
| EG-FND-07 | **CI skeleton.** GitHub Actions steps 1 to 5 (install with frozen lockfile, typecheck, lint, tests with a Postgres service container, build). | TRD §16.3 | Infra | S | M0 | FND-01, FND-03 |
| EG-FND-08 | **Authorization policy module.** One policy layer that every route calls. Super Admin is metadata-only and cannot read submissions. | TRD §7.1, §7.3; PRD §5.1, §11 | Infra | M | M0 | FND-04 |
| EG-FND-09 | **Job queue.** pg-boss on Postgres, with the worker in the same process. Queue names and singleton keys as in TRD §10.1. | TRD §10.1, §3 | Infra | M | M0 | FND-03, SPK-02 |
| EG-FND-10 | **Deployment.** Vercel serves `apps/web` and rewrites `/api/*` to Render (API plus worker). Supabase pooler configured, env vars set. Deployment runbook written (the runbook doc is referenced by the TRD but does not exist yet). | TRD §4, §4.5 | Infra | M | M0 | FND-04 |

## SPK: Day-one spikes

Each spike has a pass criterion and a fallback (TRD §17.1). Run a spike before the features that depend on it. S6 takes 48 hours of calendar time, so start it early.

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-SPK-01 | **S1: upload path.** Upload 10 MiB through the Vercel rewrite to Render, then sign in and reload on Chrome and Safari. Pass: upload succeeds and the session cookie persists. Fallback: Express serves the built web app from one origin. | TRD §17.1 | Infra | S | M0 | FND-10 |
| EG-SPK-02 | **S2: database and queue through the pooler.** Prisma migrations and pg-boss through the Supabase session pooler from Render. Redeploy mid-job. Pass: the job completes after restart and migrations apply. Fallback: change pooler mode or host (TRD §4.3). | TRD §17.1, §4.3 | Infra | S | M0 | FND-03, FND-10 |
| EG-SPK-03 | **S3: Gemini model and limits.** Two images and one PDF, JSON schema response, temperature 0.2, and the key-validation model-list call. Pass: valid JSON within 60 s. Record limits in TRD §11.2. Closes TQ3 and TQ11. Its results set the pacing numbers in AI-02. Fallback: another Flash-class model. | TRD §11, §17.1 | Infra | M | M1 | FND-01 |
| EG-SPK-04 | **S4: HEIC and PDF memory.** Convert a HEIC photo and a 20-page PDF on Render at 512 MB, with two concurrent jobs. Also checks that the browser resize setting (TRD §9.1 step 0) keeps handwriting readable. Pass: peak memory under 350 MB and both finish. Closes TQ5. Fallback: another HEIC library, lower concurrency. | TRD §9.4, §17.1 | Infra | M | M1 | FND-10 |
| EG-SPK-05 | **S5: email deliverability.** Send a verification email to Gmail and Outlook test accounts through the chosen SMTP provider. Pass: both land in the inbox, not spam. Record the daily quota. Closes TQ10. Fallback: another free provider. | TRD §13.5, §17.1 | Infra | S | M3 | FND-10 |
| EG-SPK-06 | **S6: keep-alive.** Ping `/healthz` every 5 minutes for 48 hours. Pass: no cold start longer than 5 s. Fallback: accept cold starts and say so in the README. | TRD §17.1, §17.2 | Infra | S | M5 | FND-10, DEMO-06 |

## AUTH: Accounts and sessions

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-AUTH-02 | **Sessions and password hashing.** argon2id hashing. Database sessions in cookies. CSRF protection. Idle and absolute timeouts (TQ2: 7 days idle, 30 days absolute). | TRD §6.1, §6.2, §6.5; TQ2 | Infra | M | M0 | FND-03, FND-04 |
| EG-AUTH-01 | **Email and password sign-up and sign-in.** Role chosen once at sign-up. First and last name collected. Password of at least 10 characters with a strength check. Duplicate emails get a clear message. | FR-AUTH-01, FR-AUTH-03; A6 | Must | M | M0 | AUTH-02 |
| EG-AUTH-04 | **Terms and privacy acceptance.** Required tick at sign-up. Text says submissions go to Google Gemini and are reviewed by the instructor. Placeholder wording until DEMO-05. | FR-AUTH-09; PRD §11 | Must | S | M0 | AUTH-01 |
| EG-AUTH-05 | **Email verification.** Verification link (24-hour lifetime, TQ1 proposal). Unverified users can use the app. A banner offers to resend. | FR-AUTH-04; A2; TRD §6.6 | Should | M | M3 | AUTH-01, NTF-02 |
| EG-AUTH-06 | **Password reset.** Link expires after 60 minutes and is single use. The request endpoint has its own rate limit (API Spec A12). Pri is Must, but it needs email, so it is in M3 unless the mailer moves earlier. | FR-AUTH-05; TRD §6.6 | Must | S | M3 | AUTH-01, NTF-02 |
| EG-AUTH-07 | **Session management.** Idle expiry shown to the user. Sign out of all devices. | FR-AUTH-06 | Should | S | M3 | AUTH-02 |
| EG-AUTH-08 | **Account settings.** Change display name. Change password (current password required). Manual theme choice goes here (see FE-02). | FR-AUTH-07 | Should | S | M3 | AUTH-03 |
| EG-AUTH-09 | **First-run guidance.** Short, role-specific "how to get started" steps on the home page. Dismissible. | FR-AUTH-08 | Could | S | M3 | AUTH-01 |
| EG-AUTH-10 | **Delete own account.** Consequence screen first. Re-enter password, then type DELETE. Instructor: classes archived, key deleted, students notified. Student: personal data and files deleted, gradebook keeps an anonymized "Deleted student" row. | FR-AUTH-10; TRD §5.5; A14 | Must | L | M3 | AUTH-02, CLS-10, NTF-03 |

## KEY: Instructor Gemini key

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-KEY-01 | **Encrypted key storage.** Encrypted at rest. Only the last 4 characters are shown after saving. Never logged, never in notifications, never visible to students or Super Admin. | FR-KEY-03; TRD §14 | Must | M | M1 | FND-03, AUTH-02 |
| EG-KEY-02 | **Add, replace, and remove key.** Instructor-only settings page and API. One active key per instructor. Removing the key disables AI grading for that instructor's assignments. | FR-KEY-01 | Must | S | M1 | KEY-01 |
| EG-KEY-03 | **Validate on save.** Model-list call (no generation quota). Success shows "Connected". Failures give a plain reason: invalid key, API not enabled, quota reached, or network problem. | FR-KEY-02; TRD §11.5 | Must | M | M1 | KEY-02, SPK-03 |
| EG-KEY-04 | **Data-use disclosure gate.** Before the first save, a plain-language notice: student work goes to Gemini under the instructor's key, and free-tier content may be used by Google. Saving requires ticking "I understand". | FR-KEY-04; PRD §11 | Must | S | M1 | KEY-02 |
| EG-KEY-05 | **Key status.** Shows Connected, Needs attention, or Quota reached, plus the time of the last successful grading. Updates on the next grading call or a manual "Test connection". No periodic Gemini calls. | FR-KEY-06; TRD §11.5 | Should | S | M1 | KEY-03, AI-03 |
| EG-KEY-06 | **Setup help.** Inline steps with a link to Google AI Studio for a free key. Target: a first-time user completes setup in under 3 minutes. | FR-KEY-07 | Should | S | M1 | KEY-02 |
| EG-KEY-07 | **Missing, invalid, or exhausted key.** AI calls stop. Persistent banner with fix steps. Affected submissions go to Needs manual review. Students see "Submitted, awaiting instructor review". Instructor can re-run after the fix. | FR-KEY-05; TRD §10.3 step 2 | Must | M | M1 | KEY-03, AI-03, AI-06 |

## CLS: Classes

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-CLS-01 | **Create class.** Name required. Description, section, subject, and room optional. The class is usable right away with no admin approval step. | FR-CLS-01; FR-ADM-02 | Must | S | M0 | AUTH-01 |
| EG-CLS-02 | **Instructor attestation.** Required confirmation at class creation: the instructor has authority to collect the work, and students or guardians have been told it is processed by AI. | FR-CLS-09; PRD §11 | Must | S | M0 | CLS-01 |
| EG-CLS-03 | **Class code and join link.** 8 characters, excluding look-alikes (0, O, 1, I). Case-insensitive on entry. One-click copy for the code and for the join link. | FR-CLS-02 | Must | S | M0 | CLS-01 |
| EG-CLS-04 | **Join by code.** Joining twice is idempotent. Invalid code gives a clear error. Repeated invalid attempts are rate-limited. **Join link:** `/join/:code` shows the class name and the instructor's first name. A signed-out visitor can sign up (Student preselected) or sign in, the code is kept, and the join continues after sign-in. A signed-in instructor sees "Instructor accounts can't join classes". | FR-CLS-03; App Flow §6 step 1, F2 | Must | M | M0 | CLS-03, FND-05 |
| EG-CLS-05 | **Join approval.** Per-class toggle, off by default. When on, new joiners are Pending. Instructor can approve, decline, reverse, or remove. People view shows counts. "Approve all pending" offered when the toggle is turned off. States follow PRD §8.3. | FR-CLS-07; PRD §8.3 | Should | M | M0 | CLS-04 |
| EG-CLS-06 | **Student Enrolled page.** Lists every class with its status (Approved, Pending, Declined). | FR-CLS-08 | Should | S | M0 | CLS-05 |
| EG-CLS-07 | **Edit class details.** Name, description, section, subject, and room can change at any time. Code and members unaffected. | FR-CLS-10 | Should | S | M0 | CLS-01 |
| EG-CLS-08 | **Regenerate or disable code.** The join link follows the code. Existing members are unaffected. | FR-CLS-04 | Should | S | M0 | CLS-03 |
| EG-CLS-09 | **Roster and removal.** View the roster. Remove a student: hidden from the active gradebook, history kept, and the class leaves their Enrolled list. Reinstating restores them. Queue and tracker effects are verified in REV-01 and GB-03. | FR-CLS-05 | Should | M | M0 | CLS-05 |
| EG-CLS-10 | **Archive and restore class.** Archived classes are read-only. Students still see them in Enrolled, can view assignments and feedback, and cannot submit. | FR-CLS-06 | Should | S | M0 | CLS-06 |
| EG-CLS-11 | **Delete class.** Confirmation offers "Archive instead" and a gradebook CSV download. Shows counts of students, assignments, and submissions. Requires typing the class name. Deletes all class data and files immediately. Approved students are notified. The PRD release plan puts delete in M0; the CSV link and notification depend on GB-02 and NTF-05, which land later (hide or defer those parts until then). | FR-CLS-11; TRD §5.5 | Should | L | M0 | CLS-10, NTF-05, GB-02 |

## ASG: Assignments

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-ASG-01 | **Create assignment.** Title, optional instructions, required free-text criteria, due date and time with timezone, scoring format, and max score. Can be saved as a draft or published. | FR-ASG-01 | Must | M | M0 | CLS-01 |
| EG-ASG-02 | **Scoring formats.** Points/max (42/50), percentage (84%), or letter + numeric (B+ / 87). The format locks once any submission exists (A13). | FR-ASG-02; A13 | Must | M | M0 | ASG-01 |
| EG-ASG-03 | **Draft and publish.** Drafts are invisible to students. Publishing makes the assignment visible and emits the publish event. Notification delivery arrives with NTF-05. | FR-ASG-03 | Should | S | M0 | ASG-01, CLS-05 |
| EG-ASG-04 | **Edit criteria or reference files after publish.** Confirmation dialog shows how many unapproved submissions will be re-graded, that their AI scores will be replaced, and that quota is used. Rapid edits combine into one confirmation. Approved submissions are flagged "Criteria changed since approval". Other edits do not re-grade. | FR-ASG-04; A3; TRD §10.5 | Must | L | M2 | ASG-01, AI-09, REV-03 |
| EG-ASG-05 | **Due-date changes.** Recompute the Late flag for all submissions. No re-grade. Notification follows with NTF-05. | FR-ASG-05 | Must | S | M0 | ASG-01, SUB-06 |
| EG-ASG-06 | **Letter-grade scale.** Default A to F ranges (TRD §10.6 proposal). Instructor can adjust per assignment. The server uses the scale to derive letters. | FR-ASG-06; TRD §10.6 | Should | S | M1 | ASG-02 |
| EG-ASG-07 | **Reference files.** Up to 3 PDF, JPG, or PNG files. "Visible to students" toggle, off by default. Always sent to Gemini, labeled as reference material. Size limits follow SUB-02. | FR-ASG-07; TRD §10.4 | Should | M | M0 | SUB-02, FND-06 |
| EG-ASG-08 | **Resubmission limit.** 0 to 10, or Unlimited. Default 3 (A9). Applies only before approval. Lowering the limit never removes attempts already used. | FR-ASG-10; A9 | Must | S | M0 | ASG-01 |
| EG-ASG-09 | **Late policy.** "Accept late submissions" toggle, on by default. When off, uploads after the due date are blocked unless the instructor overrides it for one student (SUB-10). | FR-ASG-11 | Should | S | M0 | ASG-01 |
| EG-ASG-10 | **Archive and delete assignment.** Archive hides it from students and keeps submissions and grades (restorable, the recommended default). Delete is permanent and removes submissions and grades. Confirmation states the count. | FR-ASG-09 | Should | M | M2 | ASG-03 |
| EG-ASG-11 | **Labels.** Create and delete custom labels (for example Quiz, Activity, Project). Tag one label per assignment. Deleting a label unlabels assignments but never deletes them. Labels are per class (TQ7 proposal). | FR-ASG-08; TQ7 | Could | M | M4 | ASG-01 |

## SUB: Submissions

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-SUB-01 | **File type validation and upload.** Accept PDF, JPG, and PNG, checked by file content and not only by extension. Other types are rejected at selection with a clear message. Images are resized in the browser before upload (TRD §9.1 step 0). Files go to private storage. | FR-SUB-01; TRD §9.1 | Must | M | M0 | FND-06, SPK-01 |
| EG-SUB-02 | **File limits.** 10 files per submission, 10 MB per file, 20 PDF pages. 15 MB total, with reference files counted in the same grading budget (TRD §11.3). Limits shown before upload. Errors name the exceeded limit. | FR-SUB-02; TRD §9.2 | Must | S | M0 | SUB-01 |
| EG-SUB-03 | **HEIC conversion.** iPhone HEIC photos converted to JPEG on upload. Library chosen at S4 (TQ5). Stays within the S4 memory budget. | FR-SUB-01 (HEIC); TRD §9.4; TQ5 | Must | M | M1 | SUB-01, SPK-04 |
| EG-SUB-04 | **Upload reliability.** Progress shown. An interrupted upload can resume without losing finished files. "Submitted" only when all files are stored. Staged uploads older than 24 hours are cleaned up. | FR-SUB-03; TRD §12 | Should | M | M0 | SUB-01 |
| EG-SUB-05 | **One active submission and receipt.** One record per student per assignment. Resubmission updates that record. Receipt with timestamp and file list shown right away (FR-SUB-08 is Should). | FR-SUB-07, FR-SUB-08 | Must | S | M0 | SUB-01, ASG-01 |
| EG-SUB-06 | **Late handling.** Accept submissions after the due date. Flag them Late for the instructor and the student. Always record the timestamp. Blocked when late work is closed (ASG-09). Late uses the latest submission time, and the instructor sees both times (A4). | FR-SUB-04; A4; TRD §5.2 | Must | S | M0 | SUB-05, ASG-09 |
| EG-SUB-07 | **Resubmission.** New files replace the old ones, and grading re-triggers. When the new version is stored, the previous version's files are deleted from storage and the database, and only the version record stays (Backend Schema §10.2a). Each accepted resubmission uses one attempt. A resubmission that fails for a system reason still uses one, and the instructor can return it (SUB-10). | FR-SUB-05; backend-schema | Must | M | M1 | SUB-05, AI-08, ASG-08 |
| EG-SUB-08 | **Locked after approval.** Read-only view, with no resubmit control, until the instructor reopens the submission. | FR-SUB-06 | Must | S | M2 | REV-03 |
| EG-SUB-09 | **Attempts-left display.** "N resubmissions left" or "Unlimited resubmissions" on the assignment and result pages. At 0, the resubmit control becomes a message explaining the limit. Instructor sees the same count. | FR-SUB-09 | Must | S | M1 | SUB-07 |
| EG-SUB-10 | **Instructor overrides.** Grant N extra attempts to one student. Allow one late submission for one student when late work is closed, which unlocks that upload. Both actions are logged and notify the student. | FR-SUB-10; A11 | Must | M | M2 | SUB-07, ASG-09, NTF-01 |

## AI: Grading pipeline

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-AI-01 | **Grading queue and singleton jobs.** `grade.submission` queue with singleton key `grade:<submissionId>`. Modes: first, resubmit, regrade_criteria, rerun, regrade_approved. | TRD §10.1; FR-AI-02 | Must | M | M1 | FND-09 |
| EG-AI-02 | **Key pacing.** One token bucket per instructor, default 5 requests per minute (value set from S3). Empty bucket re-enqueues with `startAfter`. Global concurrency cap of 3. Students see "Grading in progress, usually about a minute". | TRD §10.2, §11; PRD §9.5 | Must | M | M1 | AI-01, SPK-03 |
| EG-AI-03 | **Grading pipeline.** Steps 1 to 7 of TRD §10.3: stale check, key check, paced Gemini call with 60 s timeout, transactional result write, and a GradingAttempt row for every attempt (model, prompt version, latency, outcome). | TRD §10.3, §10.9; FR-AI-01 | Must | L | M1 | AI-01, AI-02, KEY-03, ASG-02, SUB-05 |
| EG-AI-04 | **Request construction and prompt.** Versioned `grade-v1` system prompt. Student and reference content treated as data, never instructions. Random-boundary delimiters. Input order as in TRD §10.4. Files sent inline. Instructor comments, other students' work, and identities never sent. Test cases go in the AI Guardrails doc, which does not exist yet. | TRD §10.4, §9.1; PRD §9.1, §9.7 | Must | M | M1 | AI-03, ASG-07 |
| EG-AI-05 | **Output validation.** JSON parses. Score is finite and within 0 to max. Feedback is non-empty and at most 4,000 characters. Letter derived by the server, and any model letter ignored. Confidence and readability stored for the queue marker. Feedback target 100 to 300 words. | TRD §10.6; FR-AI-01; PRD §9.2, §9.3 | Must | S | M1 | AI-03, ASG-06 |
| EG-AI-06 | **Retry and error classes.** Transient errors get 3 attempts in total, with exponential backoff (base 5 s, cap 60 s, honor `retry-after`). Then Needs manual review with cause AI_FAILED. Key invalid, quota, file quality, and stale get no retry and the right cause. Per-minute versus daily quota classification per TQ3. | TRD §10.7, TQ3; FR-AI-04 | Must | M | M1 | AI-03 |
| EG-AI-07 | **File-quality failures.** Corrupted, unreadable, password-protected, or blank files: no retry, immediate student error with a re-upload prompt, and no attempt consumed. | FR-AI-05; PRD §9.5 | Must | S | M1 | SUB-01, AI-03 |
| EG-AI-08 | **Grading triggers.** New submission, resubmission, and instructor re-run start grading. A due-date edit does not. A re-run never consumes an attempt. | FR-AI-02; TRD §10.8 | Must | S | M1 | AI-03, SUB-05 |
| EG-AI-09 | **Debounced criteria re-grade.** On confirm: increment `criteriaVersion`, set `regradeNotBefore` to now + 120 s, enqueue `regrade.assignment`. Each later edit moves the window; only the last job does the work. Unapproved submissions reset to Queued. Approved submissions untouched. Progress banner. Quota running out mid-batch gives KEY_QUOTA on the rest. | FR-AI-02, FR-ASG-04; TRD §10.5 | Must | L | M2 | AI-01, AI-08 |
| EG-AI-10 | **Stale-result protection.** Version check before and after the Gemini call. An older job's result is discarded. Only the latest submission version is saved. | FR-AI-06; TRD §10.3 | Should | S | M1 | AI-03 |
| EG-AI-11 | **Student result view and AI disclosure.** Score and feedback appear with the AI-generated chip as soon as grading completes. Page says results are AI-generated, will be reviewed by the instructor, and that grade questions go to the instructor. Updates automatically without a refresh. | FR-AI-03, FR-AI-07; PRD §9.8 | Must | M | M1 | AI-03, SUB-05, FE-04 |

## REV: Review and approval

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-REV-01 | **Review queue.** Lists AI-generated (unapproved), Needs manual review, and Re-grade pending items. Archived classes are excluded. Filter by class, assignment, and status. Sort by submission time and Late. Shows the cause and the confidence or readability marker. | FR-REV-01; PRD §9.2 | Must | M | M2 | AI-06, SUB-06 |
| EG-REV-02 | **Side-by-side viewer.** Original PDF pages and images shown next to the AI score and feedback, with no page change. | FR-REV-02; TRD §15.5 | Must | L | M2 | SUB-01, FND-06, AI-03 |
| EG-REV-03 | **Edit and approve.** Edit score (numeric, validated against range and format) and feedback, then approve. Store the original AI value and the final value. | FR-REV-03; TRD §10.8 | Must | M | M2 | REV-01, AI-05 |
| EG-REV-04 | **Status chips.** AI-generated changes to Instructor-approved on approval. The student sees the change. | FR-REV-04 | Must | S | M2 | REV-03, AI-11 |
| EG-REV-05 | **Manual grading and re-run.** For Needs manual review items: enter score and feedback from scratch and approve in one step, or re-run AI individually or in bulk after the key is fixed or quota resets. | FR-REV-06; TRD §10.8 | Must | M | M2 | REV-03, AI-03 |
| EG-REV-06 | **Reopen approved submission.** Re-enables resubmission. Dialog offers "also grant N attempts", defaulting to 1 when the student has none left. | FR-REV-05 | Should | S | M2 | REV-03, SUB-10 |
| EG-REV-07 | **Approve-vs-edit tracking.** Record whether each approval was edit-free, score-only, feedback-only, or both. | FR-REV-08 | Should | S | M2 | REV-03 |
| EG-REV-08 | **Instructor comment.** Optional comment stored apart from AI feedback, labeled "Instructor comment" for students. Never sent to Gemini. Does not count as editing AI feedback. | FR-REV-09; TRD §10.4 | Should | S | M2 | REV-03 |
| EG-REV-09 | **Re-grade an approved submission.** Individually or in bulk. Student keeps the approved grade. New result shows in the queue as "Re-grade pending review". Instructor approves (student notified) or chooses "Keep previous grade" (discard). A second re-grade while one is pending gets a 409. | FR-REV-10; TRD §10.9 | Should | M | M2 | AI-09, REV-03 |
| EG-REV-10 | **Bulk approve.** Select unedited AI-generated submissions, confirm, and approve them together. | FR-REV-07 | Could | S | M4 | REV-03 |

## GB: Tracker, gradebook, and stats

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-GB-01 | **Gradebook table.** Students by assignments. Cells show score in the assignment's own format and status: AI-generated, Late, Instructor-approved, Needs manual review, Not submitted. "Re-grade pending" marker where it applies. | FR-GB-01 | Must | M | M2 | REV-04, ASG-02 |
| EG-GB-02 | **Gradebook CSV.** One row per student, one score column per assignment, plus status columns. UTF-8 with BOM. Opens cleanly in Excel and Google Sheets. | FR-GB-02 | Must | S | M2 | GB-01 |
| EG-GB-03 | **Mixed formats.** Each assignment shows its own format in the table and CSV. No cross-assignment totals in v1. | FR-GB-03 | Must | S | M2 | GB-01 |
| EG-GB-04 | **Per-assignment submission tracker.** Counts for Turned in, Late, Missing, Not yet due, and Needs manual review. Queued and Grading show as "Grading in progress". Search by name. Multi-select status filter. Expandable rows show time, score, status, attempts left, feedback, instructor comment, and files. | FR-GB-04 | Should | L | M2 | GB-01, REV-04, SUB-09 |
| EG-GB-05 | **Criteria-changed filter and bulk re-grade.** Lists approved submissions flagged under FR-ASG-04, with a "Re-grade selected" action. | FR-GB-04, FR-ASG-04, FR-REV-10 | Should | S | M2 | GB-04, REV-09 |
| EG-GB-06 | **Per-assignment export.** CSV with student name, status, submission time, Late flag, score, AI feedback, and instructor comment. | FR-GB-05 | Could | S | M4 | GB-02 |
| EG-GB-07 | **Label filter.** Filter the gradebook and assignment list by label. | FR-GB-06 | Could | S | M4 | ASG-11 |
| EG-GB-08 | **Class-wide stats for students.** Average and count of graded submissions per assignment, from approved scores only. Hidden until 5 graded submissions exist. No minimum, maximum, or distribution. Priority is not stated in the PRD (proposed Should, confirm). | PRD §11; A5 | Should (proposed) | S | M2 | REV-03, ASG-03 |

## NTF: Notifications and email

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-NTF-01 | **In-app notification center.** Unread count. Each item deep-links to the submission, assignment, class, or settings page. In-app is the source of truth. Includes the in-app half of `notify()`: one row per recipient. Email is added by NTF-03. | FR-NTF-01; TRD §13.1 | Must | M | M1 | FND-03, AUTH-01 |
| EG-NTF-02 | **Mailer.** `Mailer` interface with `smtp` (nodemailer) and `fake` drivers (TRD §13.5). `send.email` job with retryLimit 5. Production provider as chosen at S5 (TQ10). | FR-NTF-02 (part); TRD §13.5, §10.1 | Should | M | M3 | FND-02, FND-09, SPK-05 |
| EG-NTF-03 | **Email channel for `notify()`.** Builds on the in-app rows from NTF-01. Email enqueued only when the channel applies and the address is verified, with the exceptions for verification, reset, and suspension notices. Respects per-category preferences. | FR-NTF-02 (verified-only rule); TRD §13.1, §13.3 | Should | M | M3 | NTF-01, NTF-02 |
| EG-NTF-04 | **Email content rules.** Short description and an absolute deep link built from `APP_URL`. Never contains scores, feedback, or file names. Plain text and HTML. No tracking pixels. | FR-NTF-02 (deep link); TRD §13.4 | Should | S | M3 | NTF-02 |
| EG-NTF-05 | **Event coverage.** Emit all notification types in PRD §10 (graded, approved, awaiting review, manual review, key, reopened, join, attempts granted, late allowed, published, due date, class deleted, instructor deleted, suspended, retention notice). Announcements follow in ANN-04. | PRD §10; TRD §13.2 | Must | L | M3 | NTF-03, ADM-02, ADM-06 |
| EG-NTF-06 | **Instructor digests.** Hourly `digest.flush` for new submissions and join requests. Digest rows marked sent in the same transaction. | FR-NTF-03; TRD §12 | Could | M | M3 | NTF-03 |
| EG-NTF-07 | **Email preferences.** Turn each email category on or off. In-app notifications cannot be turned off. | FR-NTF-04 | Could | S | M3 | NTF-03 |

## ADM: Super Admin and jobs

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-ADM-01 | **Admin creation script.** `pnpm admin:create` reads the production database URL from the environment. No web sign-up for admins. | TRD §17.2, TQ8; FR-ADM-01 | Must | S | M3 | FND-03, AUTH-02 |
| EG-ADM-02 | **Account management.** Search, view metadata, suspend or reinstate (optional reason, emailed even if unverified), and delete accounts. Suspended users see "Account suspended". A suspended instructor's classes show "Temporarily unavailable" to students. Metadata only. | FR-ADM-01; A16 | Must | M | M3 | ADM-01, AUTH-02 |
| EG-ADM-03 | **Class management.** View any class. Archive or delete it (metadata only). Deletion notifies the instructor and approved students. | FR-ADM-02 | Should | M | M3 | ADM-01, CLS-11 |
| EG-ADM-04 | **Audit log.** Every admin action records actor, target, and timestamp. | FR-ADM-04 | Should | S | M3 | ADM-02 |
| EG-ADM-05 | **Platform health view.** Grading success rate, manual-review fallback rate, key and quota error rate, and queue depth. Cut first if M3 runs long. | FR-ADM-03 | Could | M | M3 | AI-06, FND-09 |
| EG-ADM-06 | **Retention and cleanup jobs.** `retention.sweep` (30-day notice at 335 days after archive, delete at 365 days, and delete audit log rows older than 12 months). `staged.cleanup`, `storage.cleanup`, and `token.cleanup`. Deletion paths are Must through AUTH-10 and CLS-11. | TRD §12; A10, A15; NFR Data retention | Should | M | M3 | FND-09, CLS-10 |

## ANN: Class announcements (Could)

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-ANN-01 | **Post announcement.** Title, description, and optional attachment (PDF, JPG, PNG, same limits as SUB-02). Newest first in the class stream. | FR-ANN-01 | Could | M | M4 | SUB-02, FND-06, CLS-05 |
| EG-ANN-02 | **Student view.** Approved students see the stream and can download attachments. Pending and declined students cannot. | FR-ANN-02 | Could | S | M4 | ANN-01, CLS-05 |
| EG-ANN-03 | **Delete announcement.** Confirmation required. The announcement and its files are deleted completely and leave student streams immediately. | FR-ANN-03 | Could | S | M4 | ANN-01 |
| EG-ANN-04 | **Announcement notifications.** In-app notification for approved students. Email follows each student's preference (default digest). | FR-ANN-04; PRD §10 | Could | S | M4 | NTF-03, NTF-06, NTF-07 |
| EG-ANN-05 | **No interaction.** No comments, replies, or reactions in API or UI. Covered by a test. | FR-ANN-05 | Could | S | M4 | ANN-01 |

## QA: Testing, evaluation, and security

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-QA-01 | **Authorization matrix tests.** Every route tested against the permission matrix, including deny paths. | TRD §7.2; PRD §5.1 | Must | M | M0 | FND-08 |
| EG-QA-02 | **Unit and integration test setup.** Vitest and Supertest against the test database (the `edugemini-test` project locally, a service container in CI). Includes the safety guard from TRD §16.2a. | TRD §16.2, §16.3 | Infra | S | M0 | FND-07 |
| EG-QA-03 | **Playwright harness.** Config, CI `e2e` job, and smoke tests for sign-up and sign-in. | TRD §16.2a, §16.3 | Infra | M | M0 | FND-10, AUTH-01 |
| EG-QA-04 | **Theme contrast script.** Checks every light and dark token pair against WCAG 2.1 AA. | PRD §12 Theming; ux-brief | Should | S | M1 | FE-02 |
| EG-QA-05 | **Accessibility checks.** `@axe-core/playwright` on core flows. Violations reported in CI. | PRD §12 Accessibility; TRD §16.2a | Should | M | M5 | QA-03, FE-05 |
| EG-QA-06 | **Gold-set grading evaluation.** At least 30 human-graded submissions covering typed work, handwritten photos, and poor scans, plus prompt-injection samples. Target: at least 80% of scores within 10% of max of the human score, and every injection sample ignored. Run with `pnpm eval:grading`. Store model and prompt version. | PRD §9.6; TRD §16 | Must | L | M5 | AI-04, AI-05 |
| EG-QA-07 | **Turnaround and burst test.** Median about 1 minute. 200 uploads to one assignment near a due date with no errors. Queued state shown clearly. | PRD §12 Turnaround, Scalability | Should | M | M5 | AI-03, SUB-02 |
| EG-QA-08 | **Security checks.** CSRF, cookie flags, signed-URL expiry, content-based file validation, and `pnpm audit --prod` results reviewed. | PRD §12 Security; TRD §14, §16.3 | Must | M | M5 | QA-01, SUB-01 |
| EG-QA-09 | **Full Playwright suite.** Smoke tests on all projects for each PR. Full Chromium on the default branch and nightly. Covers the core flow steps 1 to 4 and a complete grading cycle. | TRD §16.2a, §16.3; PRD §18 M5 | Must | L | M5 | QA-03, REV-04, GB-02, NTF-05 |

## DEMO: Demo, docs, and launch

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-DEMO-01 | **Seed script.** Demo classes, students, assignments, and submissions in every state. | PRD §18 M5; TRD §17.2 | Should | M | M5 | REV-04, GB-03 |
| EG-DEMO-02 | **README and walkthrough.** Setup, environment, architecture summary, demo script. States the cold-start caveat if S6 fails. | PRD §18 M5; TRD §17.1 | Must | S | M5 | FND-10, DEMO-01 |
| EG-DEMO-03 | **Onboarding walkthrough.** Walkthrough for the 3-minute key setup and creating a first class. | PRD §18 M5; FR-KEY-07 | Should | M | M5 | KEY-06, AUTH-09 |
| EG-DEMO-04 | **Usability test and metrics.** Run a SUS usability test. Collect the success metrics in PRD §14. Priority not stated in the PRD. | PRD §14, §18 M5 | Not stated | M | M5 | DEMO-01 |
| EG-DEMO-05 | **Terms and Privacy Notice wording.** Owner writes or approves the text (PRD §16.3, Open Question 3). Required before any real student uses the product. Placeholder used until then. | FR-AUTH-09; PRD §11 | Must | S | M5 | Owner decision (no code dependency) |
| EG-DEMO-06 | **Uptime monitor.** UptimeRobot pings `/healthz` every 5 minutes. Set up in M0 so S6 has data. | TRD §4.2; SPK-06 | Should | S | M0 | FND-04, FND-10 |

## FE: Frontend shell

| ID | Ticket and acceptance | Refs | Pri | Size | MS | Depends on |
|---|---|---|---|---|---|---|
| EG-FE-01 | **App shell and routing.** Routes per TRD §15.1. Guards per §15.2 for role, class membership, and suspended users. Mobile-first layout with no horizontal scroll at phone width. | TRD §15.1, §15.2; PRD §12 Device support | Must | M | M0 | FND-01, AUTH-02 |
| EG-FE-02 | **Design tokens and themes.** Light and dark themes from `ux-brief.md`. Follow the system setting by default. The manual choice in Settings > Account is AUTH-08. | PRD §12 Theming; ux-brief | Should | M | M0 | FE-01 |
| EG-FE-03 | **Shared forms and components.** react-hook-form with the shared Zod schemas. shadcn/ui primitives. A shared error component that tells users how to recover. | TRD §15.4; PRD §12 Maintainability | Should | M | M0 | FE-01, FND-01 |
| EG-FE-04 | **Data fetching and polling.** TanStack Query. Grading status updates without a refresh when the result is ready. | TRD §15.3; PRD §9.8 | Must | S | M1 | FE-01, AI-03 |
| EG-FE-05 | **Accessibility baseline.** Labels, keyboard access, focus order, visible focus, and color not the only signal, for core flows (WCAG 2.1 AA). | PRD §12 Accessibility; TRD §15.6 | Should | M | M0 | FE-01 |
| EG-FE-06 | **Error and recovery copy.** Standard messages that say how to recover: file limits, key problems, closed late work. | PRD §12 Maintainability | Should | S | M0 | FE-03 |

---

## Build order (critical path)

1. **M0:** FND-01 to FND-04, then FND-10 with SPK-01 and SPK-02. Then AUTH-02, AUTH-01, and CLS-01 to CLS-05. Then ASG-01, ASG-02, SUB-01, SUB-02, SUB-05, and the rest of M0.
2. **M1:** NTF-01 (in-app notifications) and SPK-03 (sets pacing), then KEY-01 and KEY-02, then AI-01 to AI-03 on the fake Gemini adapter (decided 2026-11-16: the pipeline needs only a saved key and its status), then KEY-03 with SPK-03, then AI-04 to AI-08. SPK-04 runs before SUB-03. FE-04 and AI-11 close out M1.
3. **M2:** REV-01 to REV-05, then SUB-08 and SUB-10, then GB-01 to GB-04. Then AI-09 and ASG-04 (criteria re-grade).
4. **M3:** NTF-02 to NTF-05, ADM-01 to ADM-06, AUTH-05 to AUTH-10. SPK-05 runs before NTF-02.
5. **M4 (cut first):** ANN-01 to ANN-05, ASG-11, REV-10, GB-06, GB-07, NTF-06 to NTF-07 if needed.
6. **M5:** QA-04 to QA-09, DEMO-01 to DEMO-05, SPK-06.

## Open decisions and gaps

These need an owner decision or an artifact that doesn't exist yet. Tickets that depend on them are listed.

| Item | Source | Tickets affected | Action needed |
|---|---|---|---|
| TQ1: verification link lifetime (24 h proposed) | TRD §17.5 | AUTH-05 | Confirm |
| TQ3: daily versus per-minute quota | TRD §17.5 | AI-06, ADM-05 | Resolve at S3 |
| TQ5: HEIC library | TRD §17.5 | SUB-03 | Resolve at S4 |
| TQ7: label scope (per class proposed) | TRD §17.5 | ASG-11 | Confirm |
| TQ10: SMTP provider | TRD §17.5 | NTF-02, AUTH-05, AUTH-06 | Resolve at S5 |
| TQ11: Gemini model (2.5 Flash candidate) | TRD §17.5 | SPK-03, KEY-03, AI-02 | Resolve at S3 |
| PRD §16.3: announcements in v1 | PRD §16.3 | ANN-01 to ANN-05 | Owner decision; M4 is cut first by default |
| PRD §16.3: pilot with real classes | PRD §16.3 | None (not ticketed) | Owner decision |
| PRD §16.3 Q3: Terms and Privacy wording | PRD §16.3 | DEMO-05, AUTH-04, KEY-04 | Owner writes or approves |
| Missing doc: AI Guardrails (prompt text, injection tests) | PRD §9.7; TRD §10.4 | AI-04, QA-06 | Write before AI-04 |
| Missing doc: Deployment Runbook | TRD §4.5 | FND-10 | Write before deploying |
| `backend-schema.md` §16.2: Q5 to Q7 (backups, Prisma drops SQL objects, runtime role) | backend-schema | FND-03, SPK-02 | Verify at scaffold and S2 |

## Schedule conflicts to decide

1. **Priorities not stated:** EG-GB-08 (class stats) and EG-DEMO-04 (usability test).
2. **Email deliverability (S5) can run in M0.** It needs only an SMTP account, which would catch a provider problem before M3.
