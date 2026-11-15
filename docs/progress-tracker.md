# Progress Tracker: EduGemini

Read this file first when resuming work. Update it at the end of every session.

**Build status is written here only.** The work itself is defined in [feature-tickets.md](feature-tickets.md). Decisions and open questions stay in the doc that owns them; this file links to them.

## Current status

**Phase:** docs drafted, no code yet. **Active milestone:** M0, not started. **Last updated:** 2026-11-15

All docs are "Draft for review" and `feature-tickets.md` is "draft for triage". The folder is not a git repository yet.

## Milestones

Scope and exit criteria: [PRD §18](prd.md). Ticket list and build order: [feature-tickets.md](feature-tickets.md).

| Milestone | Done | Status | Tickets done |
|---|---|---|---|
| M0 Foundations | 0 / 48 | Not started | None |
| M1 AI grading and keys | 0 / 26 | Not started | None |
| M2 Review, tracker, and gradebook | 0 / 20 | Not started | None |
| M3 Notifications and admin | 0 / 19 | Not started | None |
| M4 Announcements, labels (Could, cut first) | 0 / 9 | Not started | None |
| M5 Demo hardening | 0 / 11 | Not started | None |

A ticket is done when its acceptance text in `feature-tickets.md` is met and its tests pass.

## Spikes

Tests, pass criteria and fallbacks: [TRD §17.1](trd.md).

| Spike | Ticket | Milestone | Result |
|---|---|---|---|
| S1 upload path | EG-SPK-01 | M0 | Not run |
| S2 database and queue through the pooler | EG-SPK-02 | M0 | Not run |
| S3 Gemini model and limits | EG-SPK-03 | M1 | Not run |
| S4 HEIC and PDF memory | EG-SPK-04 | M1 | Not run |
| S5 email deliverability | EG-SPK-05 | M3 | Not run |
| S6 keep-alive | EG-SPK-06 | M5 | Not run |

## Up next

- [ ] Review the docs and approve them, or say which need changes
- [ ] Decide the two remaining "Schedule conflicts to decide" in `feature-tickets.md`
- [ ] Create the two Supabase projects (`edugemini`, `edugemini-test`) and put the connection strings in `.env` yourself (TRD §4.1, §4.3)
- [ ] Create the git repository, then start M0 locally: FND-01 to FND-04. Deploy (FND-10) with SPK-01 and SPK-02 at the end of M0
- [ ] Write the Deployment Runbook before EG-FND-10 deploys
- [ ] Set up EG-DEMO-06 (uptime monitor) in M0 so S6 has data

## Open questions

The question text and proposed answers are in the source doc. When one is settled, write the answer there, then remove it from this table.

| Source | Open items | First blocks |
|---|---|---|
| [PRD §16.3](prd.md) | Q1 Gemini model, Q2 announcements in v1, Q3 Terms wording, Q4 pilot | Q1: S3 (M1). Q3: before any real student |
| [TRD §17.5](trd.md) | Confirm: TQ1, TQ7. Settled by spikes: TQ3, TQ5, TQ10, TQ11 | TQ1: EG-AUTH-05 (M3) |
| [Backend Schema §16.2](backend-schema.md) | Q5 to Q7, verified at scaffold and S2 | EG-FND-03 (M0) |
| [API Spec A10](api-spec.md) | API-1 to API-5, API-7, API-8 | The endpoints each one names |
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

## Notes for next session

- Read order: this file, then the build order in `feature-tickets.md`, then the doc that owns the area you are working on.
- When docs disagree: the PRD wins on behavior, Backend Schema on stored data and enums, API Spec on request and response shapes, `openapi.yaml` on exact field types. Fix the other doc in the same change.
- An API change updates `api-spec.md` and `openapi.yaml` together (API Spec A9). `openapi.yaml` is partial until scaffold.
- A new library needs owner approval first (TRD T-D11).
- Local development uses `GEMINI_MODE=fake`, so no Gemini key is needed before S3.
- `docs/archive/` is superseded. Do not build from it.
- Code follows [code-standards.md](code-standards.md). To change a convention, change that file first.
