# Progress Tracker: EduGemini

How the docs fit together, the start-of-session routine and the end-of-session checklist are in [README.md](README.md). Read that first. This file is where progress is saved: update it at the end of every session.

**Build status is written here only.** The work itself is defined in [feature-tickets.md](feature-tickets.md). Decisions and open questions stay in the doc that owns them; this file links to them.

## Current status

**Phase:** building. **Active milestone:** M0, in progress. **Last updated:** 2026-11-16

All docs are still "Draft for review". Code is in `apps/api`, `apps/web`, `packages/shared` and `packages/ai`. The API has sign-up, sign-in, sign-out, `/me`, create, list, get, archive and restore class (the list is for instructors; a student can get a class they are approved in), join by code for students (`POST /api/join`), the join-link preview (`GET /api/join/{code}`), join approval for instructors (the toggle, the People list with counts, approve, decline, reverse, remove, and approve all pending), and the student's Enrolled list (`GET /api/me/enrollments`). The web app has the landing, sign-up, sign-in, Terms, Privacy, join-link and not-found pages. Instructors have a class dashboard (with a "Show archived" switch), a create-class form and a class page with two sections, Overview (the code and join link, and Archive or Restore) and People (join approval, the pending, approved, declined and removed lists, and a confirm dialog before removing); students have a dashboard with a code box to join a class and a list of their classes with status chips, and a class page (name, details, instructor name; a Pending student sees only "Pending approval").

Everything through CLS-10 is committed and pushed to `development`, including the seven docs that had edits waiting for review (`api-spec.md`, `backend-schema.md`, `code-standards.md`, `feature-tickets.md`, `prd.md`, `trd.md`, `ux-brief.md`). The owner has still to review those edits; the docs are all still "Draft for review".

Repository: github.com/MarkCabalbag/EduGemini. `main` is the new version, `development` is where work happens, `main-old-version` is the previous app. The owner reviews and commits; do not commit or push unless asked.

## Milestones

Scope and exit criteria: [PRD §18](prd.md). Ticket list and build order: [feature-tickets.md](feature-tickets.md).

| Milestone | Done | Status | Tickets done |
|---|---|---|---|
| M0 Foundations | 14 / 47 | In progress | FND-01, FND-04, FND-08, AUTH-01, AUTH-02, QA-02, CLS-01, CLS-02, CLS-03, CLS-04, CLS-05, CLS-06, CLS-09, CLS-10 (the effects of removal on the gradebook, review queue and tracker are checked in REV-01, GB-01 and GB-04, when those exist; a suspended instructor's class showing "Temporarily unavailable" waits for suspension, ADM-02; the `JOIN_REQUEST_RECEIVED` and `JOIN_DECIDED` notifications wait for NTF-01 and NTF-05; no notification code exists yet). Partly done: FND-02 (the mailer, storage and Gemini fakes come with their own tickets), FND-03 (Backend Schema Q5 and Q6 still to verify), FND-05 (reset and upload limits come with those endpoints; the general 120 per minute per user limit covers every route behind the session, and a route with its own API Spec A12 row adds that limiter), FE-01 (only the signed-in guard so far), FE-02 (tokens and the system theme; no manual choice yet), FE-03 (form components built; more arrive with screens), AUTH-04 (the tick, the Gemini notice and the version are in; the final Terms wording is DEMO-05) |
| M1 AI grading and keys | 0 / 26 | Not started | None |
| M2 Review, tracker, and gradebook | 0 / 20 | Not started | None |
| M3 Notifications and admin | 0 / 19 | Not started | None |
| M4 Announcements, labels (Could, cut first) | 0 / 9 | Not started | None |
| M5 Demo hardening | 0 / 11 | Not started | None |

A ticket is done when its acceptance text in `feature-tickets.md` is met and its tests pass.

## Working features

Tick a box when the feature works and its tests pass.

- [x] Monorepo scaffold with strict TypeScript and lint rules (EG-FND-01)
- [x] API baseline: validation, error format, security headers, `/healthz` (EG-FND-04)
- [x] Authorization policy from the PRD permission matrix (EG-FND-08)
- [x] Sessions and password hashing (EG-AUTH-02)
- [x] Sign up, sign in and sign out with email and password (EG-AUTH-01)
- [x] Unit and database test setup (EG-QA-02)
- [x] Web: sign-up, sign-in and sign-out screens with route guards and the UX Brief design tokens, light and dark (parts of EG-FE-01, EG-FE-02, EG-FE-03, EG-AUTH-04)
- [x] Class API for instructors: create (with the attestation and an 8-character join code), list, and get one; 20 creates per hour per user, reads limited to 120 per minute (API part of EG-CLS-01, EG-CLS-02, EG-CLS-03)
- [x] Join a class by code: `POST /api/join` adds a student as Active, or Pending when the class needs approval; joining twice changes nothing; a removed student is refused; an invalid code gives one identical error; 10 failed attempts per hour per user. The student dashboard has the code box (entry is case-insensitive) and shows the result or the error. The join link `/join/:code` shows the class and the instructor's first name; a signed-out visitor signs up (Student preselected) or signs in and the join goes on by itself; a student who was already signed in presses Join class (EG-CLS-04, finishes EG-CLS-03)
- [x] Web, instructors: class dashboard (cards, empty state, show more), create-class form with the attestation checkbox, and the class page with the code and join link and Copy buttons (EG-CLS-01, EG-CLS-02, most of EG-CLS-03)
- [x] Join approval (EG-CLS-05). API: `PATCH /classes/{id}/settings` turns approval on or off and never changes existing students; `GET /classes/{id}/people` gives complete counts and a filtered, paged list (oldest first, with name and email); `POST /enrollments/{id}/decision` does approve, decline, reverse (an undone decline or a reinstated removal) and remove, and an action from the wrong state is a `CONFLICT` with the current state (two decisions at once: one wins); `POST /classes/{id}/approve-pending` is refused while approval is on; the class response carries `counts`. Web: the class page has Overview and People sections (`?tab=people`); People has the approval switch, Pending, Approved and Declined lists with their counts and actions, and "Approve all pending" while approval is off and students are still waiting (shown from the data, so it stays after a reload)
- [x] Student Enrolled list (EG-CLS-06). API: `GET /me/enrollments` gives the student's own classes, newest joined first, with the status, the instructor's first name and last initial, and whether the class is archived; removed classes are left out. `GET /classes/{id}` now works for a student: approved gets the details and no join code, link or counts; pending gets `ENROLLMENT_PENDING` with only the class name; declined, removed and strangers get `NOT_FOUND`. Web: the student dashboard lists each class with a status chip (Approved, Pending approval, Declined, Archived) and only an approved class opens; the student class page shows the details and the instructor name, and a pending student sees only the class name and "Pending approval"; a class just joined appears in the list at once
- [x] Roster and removal (EG-CLS-09). The API already did the work (remove, reinstate, the Removed list, the class leaving the student's Enrolled list, a re-join refused with `JOIN_BLOCKED`); this ticket pins the whole lifecycle with tests and finishes the screen. Web: People has a fourth list, Removed, with Reinstate (no question asked); Remove now asks first in a confirm dialog that names the student and the class, says their submissions are kept and they can be reinstated, puts the focus on Cancel, traps focus, closes on Escape except while the request runs, and gives the focus back to the Remove button. Not checkable yet: the effects on the gradebook, review queue and tracker (those screens do not exist)
- [x] Archive and restore a class (EG-CLS-10). API: `POST /classes/{id}/archive` and `/restore` for the owning instructor, both idempotent (archiving again does not move the date; restore clears `archived_at` and `retention_notice_at`); another instructor, a student or a missing class gets `NOT_FOUND`. An archived class is read-only: the approval switch, the decision route and approve all pending answer `CLASS_ARCHIVED` (409), the People list still reads, its join code reads as invalid, and approved students still see it, marked Archived. Web: the class page shows an Archived chip, hides the class code while archived, and has a card at the bottom of Overview: Archive class (asks first, in a confirm dialog) or Restore class (no question); People on an archived class has the switch disabled and no student actions; the dashboard has a "Show archived" switch that swaps the list between active and archived classes (always shown, so an instructor whose only class is archived can still reach it), and archived cards carry an Archived chip. Not checkable yet: the review queue excluding archived classes, and assignments being read-only (those do not exist)

## Spikes

Tests, pass criteria and fallbacks: [TRD §17.1](trd.md).

| Spike | Ticket | Milestone | Result |
|---|---|---|---|
| S1 upload path | EG-SPK-01 | M0 | Not run |
| S2 database and queue through the pooler | EG-SPK-02 | M0 | Partly: migrations and role creation verified on the Supabase session pooler. Not yet from Render, and pg-boss not yet run |
| S3 Gemini model and limits | EG-SPK-03 | M1 | Not run |
| S4 HEIC and PDF memory | EG-SPK-04 | M1 | Not run |
| S5 email deliverability | EG-SPK-05 | M3 | Not run |
| S6 keep-alive | EG-SPK-06 | M5 | Not run |

## Up next

- [ ] At deploy (EG-FND-10): check that `req.ip` is the real client behind Vercel and Render. The sign-in limits key on it; if everyone shares one address, they share one limit
- [ ] Decide: add the `cookie` package as a direct dependency (TRD T-D11)? It is only needed once the app sets more cookies (the return-to cookie, TRD §6.4). Today the return path, and with it a join link's code, travels in the router state, so it survives sign-in and sign-up but not a reload or a new tab
- [ ] Next to build: ASG-01 (create assignment), the next step on the critical path. ASG-01 and the other assignment writes must answer `CLASS_ARCHIVED` for an archived class, as the member routes now do. The small class tickets CLS-07 (edit details) and CLS-08 (regenerate or disable the code) can be done any time; both must refuse an archived class too
- [ ] Confirm a ticket reference in `feature-tickets.md`: the CLS-09 row says the queue and tracker effects of removal are verified in "REV-01 and GB-03", but GB-03 is Mixed formats; the tracker tickets are GB-01 and GB-04
- [ ] Flaky web test: `join-link.test.tsx` "joins by itself right after sign-in…" fails in about 2 of 5 runs, with and without the CLS-05 and CLS-06 changes (full suite and isolated). It reads the router state right after "You joined" appears, while `JoinLink.tsx` calls `mutate` and `navigate` in one effect, so it is a timing race. Fix it in its own change (wait for the state to clear instead of reading it at once)
- [ ] Notifications owed by join approval, added with NTF-01 and NTF-05: `JOIN_REQUEST_RECEIVED` when a student joins a class that needs approval (JOIN-01), and `JOIN_DECIDED` on approve, decline and approve all (PPL-02, PPL-03; the API Spec's batches of 200 only matter then)
- [ ] Left out of the class screens on purpose, each comes with its own ticket: the "create your first assignment" and "add a Gemini key" prompts on the class page (ASG-01, KEY tickets); counts on class cards and assignment counts (ASG-01); edit, regenerate and disable code (CLS-07, CLS-08); the other class page sections (as each one's ticket lands); the student class page has no assignment list yet (ASG tickets); the student half of `GET /api/classes` (CLS-01) is not built because the Enrolled list uses `GET /api/me/enrollments`; declined, removed and non-member students see the "couldn't find that page" screen, not the UX Brief's "You don't have access to this page", which is not built
- [ ] Other candidates for the next piece: FND-07 (CI), FND-06 (storage adapter), FND-09 (job queue)
- [ ] Verify Backend Schema Q5 (backups) and Q6 (does `migrate dev` drop SQL-owned objects) while the schema is still small
- [ ] Decide the two remaining "Schedule conflicts to decide" in `feature-tickets.md`
- [ ] Review the docs and approve them, or say which need changes
- [ ] Write the Deployment Runbook before EG-FND-10 deploys; deploy with SPK-01 and SPK-02 at the end of M0
- [ ] Set up EG-DEMO-06 (uptime monitor) in M0 so S6 has data

## Open questions

The question text and proposed answers are in the source doc. When one is settled, write the answer there, then remove it from this table.

| Source | Open items | First blocks |
|---|---|---|
| [PRD §16.3](prd.md) | Q1 Gemini model, Q2 announcements in v1, Q3 Terms wording, Q4 pilot | Q1: S3 (M1). Q3: before any real student |
| [TRD §17.5](trd.md) | Confirm: TQ1, TQ7. Settled by spikes: TQ3, TQ5, TQ10, TQ11 | TQ1: EG-AUTH-05 (M3) |
| [Backend Schema §16.2](backend-schema.md) | Q5 (backups), Q6 (Prisma and SQL-owned objects) | Closing EG-FND-03 |
| [API Spec A10](api-spec.md) | API-2 to API-4, API-7, API-8 | The endpoints each one names |
| [API Spec Appendix C](api-spec.md) | Provider facts to verify | The spike named in each row |
| [UX Brief §16.2](ux-brief.md) | D-U1 to D-U3, D-U5, D-U6 | D-U5, D-U6: EG-AI-11 (M1) |
| [feature-tickets.md](feature-tickets.md) | Schedule conflicts 1 and 2; missing docs (AI Guardrails, Deployment Runbook) | Runbook: EG-FND-10. Guardrails: EG-AI-04 |

## Decision log

Decisions made before the build are in PRD §16.1 and §16.2, TRD §1.2, App Flow §15, and API Spec A10. Add a row here only for a decision made during the build, after writing it into the doc that owns it.

| Date | Decision | Written in |
|---|---|---|
| 2026-11-15 | No Docker. Local dev runs on hosted Supabase (`edugemini`, `edugemini-test`), a fake mailer replaces Mailpit, CI keeps its Postgres service container | TRD §4.1, §13.5, §16.2a |
| 2026-11-15 | Prior-version files are deleted from storage and the database when a newer version is stored; the version record stays (Q1) | Backend Schema §10.2a, PRD FR-SUB-05 |
| 2026-11-15 | Images are resized in the browser before upload (Q2) | TRD §9.1 |
| 2026-11-15 | Archived classes are excluded from the review queue (Q3) | Backend Schema §9.3 |
| 2026-11-15 | Audit logs are kept 12 months, then deleted by the retention sweep (Q4) | Backend Schema §10.9 |
| 2026-11-15 | A deleted announcement is deleted completely, with no tombstone (Q8) | Backend Schema §10.6 |
| 2026-11-15 | Sessions: 7 days idle, 30 days absolute (TQ2) | TRD §6.2 |
| 2026-11-15 | In-app notifications (NTF-01) move to M1; password reset stays in M3 | `feature-tickets.md` |
| 2026-11-15 | Build locally first and deploy at the end of M0. Work directly from `feature-tickets.md`, with no speckit files | This file |
| 2026-11-15 | Prisma stays on 6.x and TypeScript on 6.0.x for now | TRD §2 |
| 2026-11-15 | Sign-in limits count failed attempts only (20 per 15 minutes per IP, 5 per email and IP together, so a stranger cannot lock the real owner out), with a 300-attempt cap per IP; sign-up is 60 per hour per IP, so a class on one network is not blocked | API Spec A12 |
| 2026-11-15 | Google sign-in is removed from v1: email and password only. FR-AUTH-02, D13, F3, AUTH-03 (ticket), AUTH-09 to AUTH-11 (endpoints), the `auth_identities` table (dropped by a second migration), `hasPassword` and the Google settings are gone. Section numbers in Backend Schema §4 and API Spec Part C are kept, so those lists skip the removed number | PRD §7, TRD §6, API Spec B.1, Backend Schema §4 |
| 2026-11-15 | The test project's safety guard replaces the old `_e2e` database-name rule; integration tests run with `pnpm test:int` | TRD §16.2a |
| 2026-11-15 | Viewing classes is a permission of its own: instructors see their own classes, approved students the classes they are in. Policy actions `class.view` and `class.list` (instructors only until the join tickets) | PRD §5.1, API Spec A15 |
| 2026-11-15 | List cursors do not expire: a cursor marks a position, and only a cursor the server did not issue is rejected | API Spec A2 |
| 2026-11-15 | API-1: students see the instructor's first name and last initial on the class card (UX D-U4). The join limit counts every refused join, not only invalid codes, and not a code of the wrong length | API Spec A10, A12; UX Brief §16.2 |
| 2026-11-15 | The join-link preview counts failed tries only (30 per hour per IP), so a class opening the link on one network is not blocked, and it is not part of the general 120 per minute limit. A student who was already signed in presses Join class; one who has just signed in or signed up is joined by the page, so opening a link never joins anyone by itself | API Spec JOIN-02, A12; App Flow F2; code-standards §5 |
| 2026-11-15 | The class creation limit counts after validation. The general limit (120 per minute) is one shared counter per user (per IP when signed out), mounted once in `createApp` for every route behind the session. A route whose own row allows more (notifications) must be excluded when it is added | API Spec A12, code-standards §5 |
| 2026-11-16 | Students view a class through `class.view` as `member` and list their classes through a new action, `class.listEnrolled` (any student, any status). `class.list` stays instructors-only, because routes use it as their instructors-only role check. Get-class has no role check in the route for the same reason students may use it: the service decides from the class and the student's enrollment | API Spec A15, JOIN-03; `policy.ts` |
| 2026-11-16 | An archived class is read-only for the member routes too: decision (approve, decline, reverse, remove) and approve all pending answer `CLASS_ARCHIVED` (409) after the ownership check, so another instructor still gets `NOT_FOUND`; the People list still reads. Restore clears `archived_at` and `retention_notice_at` together (the database allows no notice date without an archive date), and archiving again starts a new 12-month clock. The dashboard's "Show archived" switch swaps between the active and the archived list, because the API returns one status per request | API Spec CLS-05, CLS-06, PPL-02, PPL-03; UX Brief (Class Overview, People, §10.2) |
| 2026-11-16 | Dialogs use `@radix-ui/react-dialog`, added with the first dialog (CLS-09), as the TRD and UX Brief already planned. `ConfirmDialog` is the one dialog component for now; other shadcn parts are added with the screens that need them. Removed is a fourth list in People, with Reinstate | TRD §2, UX Brief §6 and People notes |

## Notes for next session

- Read order, who wins when docs disagree, the commands, and the working rules are in [README.md](README.md).
- `openapi.yaml` is still partial; an API change updates it together with `api-spec.md` (API Spec A9).
- Local development uses `GEMINI_MODE=fake`, so no Gemini key is needed before S3.
