# Progress Tracker: EduGemini

How the docs fit together, the start-of-session routine and the end-of-session checklist are in [README.md](README.md). Read that first. This file is where progress is saved: update it at the end of every session.

**Build status is written here only.** The work itself is defined in [feature-tickets.md](feature-tickets.md). Decisions and open questions stay in the doc that owns them; this file links to them.

## Current status

**Phase:** building. **Active milestone:** M0, in progress. **Last updated:** 2026-11-15

All docs are still "Draft for review". Code is in `apps/api`, `apps/web`, `packages/shared` and `packages/ai`. The API has sign-up, sign-in, sign-out, `/me`, and create, list and get class (instructors only). The web app has the landing, sign-up, sign-in, Terms, Privacy and not-found pages. Instructors have a class dashboard, a create-class form and a class page with the code and join link; students still see a placeholder dashboard.

Repository: github.com/MarkCabalbag/EduGemini. `main` is the new version, `development` is where work happens, `main-old-version` is the previous app. The owner reviews and commits; do not commit or push unless asked.

## Milestones

Scope and exit criteria: [PRD §18](prd.md). Ticket list and build order: [feature-tickets.md](feature-tickets.md).

| Milestone | Done | Status | Tickets done |
|---|---|---|---|
| M0 Foundations | 8 / 47 | In progress | FND-01, FND-04, FND-08, AUTH-01, AUTH-02, QA-02, CLS-01, CLS-02. Partly done: FND-02 (the mailer, storage and Gemini fakes come with their own tickets), FND-03 (Backend Schema Q5 and Q6 still to verify), FND-05 (join, reset and upload limits come with those endpoints; the general 120 per minute per user limit covers every route behind the session, and a route with its own API Spec A12 row adds that limiter), FE-01 (only the signed-in guard so far), FE-02 (tokens and the system theme; no manual choice yet), FE-03 (form components built; more arrive with screens), AUTH-04 (the tick, the Gemini notice and the version are in; the final Terms wording is DEMO-05), CLS-03 (code, join link and Copy buttons are done; the "case-insensitive on entry" part is built and tested with join by code in CLS-04) |
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
- [x] Web, instructors: class dashboard (cards, empty state, show more), create-class form with the attestation checkbox, and the class page with the code and join link and Copy buttons (EG-CLS-01, EG-CLS-02, most of EG-CLS-03)

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
- [ ] Decide: add the `cookie` package as a direct dependency (TRD T-D11)? It is only needed once the app sets more cookies (the return-to cookie, TRD §6.4)
- [ ] CLS-04 (join by code) with the join screen (`/join/:code`), which also finishes CLS-03 (case-insensitive entry). It adds students to the `class.view` and `class.list` policy actions (PRD §5.1 already has the row) and the student view of a class, which needs API-1 (instructor name on the student card) decided first
- [ ] Left out of the class screens on purpose, each comes with its own ticket: the "create your first assignment" and "add a Gemini key" prompts on the class page (ASG-01, KEY tickets); counts on class cards and in the class response (CLS-05, ASG-01); the "Show archived" switch (CLS-10); edit, regenerate and disable code (CLS-07, CLS-08); the class page tabs (as each tab's ticket lands)
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
| [API Spec A10](api-spec.md) | API-1 to API-4, API-7, API-8 | The endpoints each one names |
| [API Spec Appendix C](api-spec.md) | Provider facts to verify | The spike named in each row |
| [UX Brief §16.2](ux-brief.md) | D-U1 to D-U6 | D-U5, D-U6: EG-AI-11 (M1) |
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
| 2026-11-15 | The class creation limit counts after validation. The general limit (120 per minute) is one shared counter per user (per IP when signed out), mounted once in `createApp` for every route behind the session. A route whose own row allows more (notifications) must be excluded when it is added | API Spec A12, code-standards §5 |

## Notes for next session

- Read order, who wins when docs disagree, the commands, and the working rules are in [README.md](README.md).
- `openapi.yaml` is still partial; an API change updates it together with `api-spec.md` (API Spec A9).
- Local development uses `GEMINI_MODE=fake`, so no Gemini key is needed before S3.
