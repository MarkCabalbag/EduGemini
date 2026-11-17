# EduGemini docs: start here

This file is the only place that explains how the docs work together. It does not repeat what the other docs say; it points to them. If this file and another doc disagree about **how the docs work**, this file wins. For any **fact** about the product, the doc that owns it wins (Section 3).

**What EduGemini is:** a web app where instructors create classes and assignments, students submit work, and Gemini (using the instructor's own API key) grades it. The instructor reviews and approves every grade. Full detail: [PRD](prd.md).

## 1. Start of every session (read this before doing anything)

You have no memory of earlier sessions. Do not rely on a summary or on what seems likely. Check the real state:

1. Read [progress-tracker.md](progress-tracker.md): current status, what is done, what is next, open questions, decisions made during the build.
2. Run `git status` and `git log --oneline -10` on the `development` branch to see what is committed and what is not. The tracker says what is *done*; git says what *exists*.
3. Read the build order in [feature-tickets.md](feature-tickets.md), then the doc that owns the area you are about to work on (Section 2).
4. Before building, run `pnpm test`, `pnpm typecheck` and `pnpm lint` so you know the starting point is green.
5. If something you need is not written in the docs, **ask the owner**. Do not invent requirements, endpoints, table names or error codes.

## 2. The docs and what each one owns

```
PRD (what and why) ─► App Flow (screens and states) ─► UX Brief (look and copy)
        │
        └─► TRD (how it is built) ─► Backend Schema (stored data)
                                  ─► API Spec + openapi.yaml (requests and responses)
                                  ─► Code Standards (how code is written)

Feature Tickets (the work list and build order)  ·  Progress Tracker (where we are)
```

| File | Owns | Look here when you need |
|---|---|---|
| [prd.md](prd.md) | Product behavior, requirement IDs (FR-*), priorities, permissions (§5.1), assumptions (A1 to A16), milestones (§18) | What a feature must do, who may do it, what is in or out of scope |
| [app-flow.md](app-flow.md) | Screens, navigation, states, access rules, flow-level copy | What the user sees and what happens next |
| [ux-brief.md](ux-brief.md) | Visual design, components, design tokens, microcopy, accessibility checklist | Colors, layout, wording of messages |
| [trd.md](trd.md) | Stack, architecture, hosting, auth and session design, file and grading pipelines, security, testing strategy, environment variables (Appendix A) | How something is built and run |
| [backend-schema.md](backend-schema.md) | Tables, columns, enums, constraints, deletion and retention rules, the Prisma schema (Appendix A) and raw SQL (Appendix B) | Anything stored in the database |
| [api-spec.md](api-spec.md) | Every endpoint, error codes (A4), rate limits (A12), upload protocol, external services (Part C) | What a request and response look like |
| [openapi.yaml](openapi.yaml) | Machine-readable API contract: exact field types | Exact types, the error code enum |
| [code-standards.md](code-standards.md) | Repository layout, naming, TypeScript rules, patterns, lint rules, test rules | How to write and organize code |
| [feature-tickets.md](feature-tickets.md) | Tickets (EG-*), their acceptance text, dependencies, build order, open decisions | What to build next and when a ticket is done |
| [progress-tracker.md](progress-tracker.md) | Build status, milestone counts, spikes, next steps, open questions, build-time decision log | Where we are right now |
| [apps/web/PRODUCT.md](../apps/web/PRODUCT.md), [apps/web/DESIGN.md](../apps/web/DESIGN.md) | Nothing. Summaries for the Impeccable design skill: product facts, and the visual system as built in `src/index.css` | Never as a source; fix them if they disagree with the doc or code they summarize |
| `archive/` | Superseded documents | Nothing. Do not build from it |

**Not written yet:** AI Guardrails (prompt text and injection tests, needed before EG-AI-04) and the Deployment Runbook (needed before EG-FND-10). Do not invent them from memory.

## 3. When docs disagree

| About | This doc wins |
|---|---|
| Behavior, permissions, scope | PRD |
| Stored data, enums, constraints | Backend Schema |
| Request and response shapes, error codes, rate limits | API Spec |
| Exact field types in the API | `openapi.yaml` |
| Everything about how code is written | Code Standards (but it never restates a fact owned by another doc) |

Then fix the losing doc in the same change. Never leave two docs saying different things.

## 4. Where progress is saved

**Only in [progress-tracker.md](progress-tracker.md).** Chat history is lost between sessions; the tracker and git are not.

At the end of every session, before stopping:

1. Update the tracker: status, milestone counts, the ticket list (below), spikes, "Up next", open questions.
2. A ticket counts as **done** only when its acceptance text in `feature-tickets.md` is met and its tests pass. Anything partial goes in the tracker as "partly done" with what is missing.
3. A decision made during the build is written first into the doc that owns the fact, then one row is added to the tracker's decision log. A decision that exists only in the tracker or in chat will be lost.
4. Make sure the tracker matches git. If work is uncommitted, say so.

## 5. How to edit the docs

- State each fact in **one** doc. Link to it from the others.
- Apply a cross-doc change directly in every affected doc. Do not write "changes this doc asks of other docs".
- No revision histories, no "who proposed what" notes, no planning or analysis docs unless the owner asks.
- Keep sections short. Cut anything that is not needed.
- An API change updates `api-spec.md` and `openapi.yaml` together.
- A new library needs the owner's approval first (TRD T-D11).
- To change a code convention, change `code-standards.md` first.

## 6. Working agreement with the owner

- **Simple code.** Plain, short, readable by any developer. No extra layers, validators, scripts or helpers until a ticket needs them. Review your own work for over-engineering before showing it.
- **Ask before committing.** Finish one piece, show what changed and the test results, update the tracker, then ask. The owner decides what goes into `development`.
- **Never push.** Use the owner's configured git identity. Commit messages end with the attribution line the session was given.
- **Secrets.** `.env` holds real credentials and is git-ignored. Never print, paste, log or commit its contents. Check it only by reporting which variables are set, never their values.
- **Ask when unsure.** A wrong guess about a requirement costs more than a question.

## 7. Facts a new session needs

- **Repository:** github.com/MarkCabalbag/EduGemini. `main` is the stable version, `development` is where work happens, `main-old-version` is the previous app (do not build from it).
- **Layout and stack:** [code-standards.md §1](code-standards.md) and [TRD §2](trd.md).
- **Local setup:** no Docker. The API runs on the developer's machine against two hosted Supabase projects: `edugemini` (development) and `edugemini-test` (tests). Details and the connection-string rules are in [TRD §4](trd.md); every variable is in [TRD Appendix A](trd.md); `.env.example` shows the shape. The web app runs on port 5173 and proxies `/api` to the API on port 4000.
- **Commands** (run from the repository root): `pnpm test` (unit tests, no database), `pnpm test:int` (database tests against the test project), `pnpm typecheck`, `pnpm lint`, `pnpm dev:api`, `pnpm dev:web`, `pnpm db:boss:init` (installs or upgrades pg-boss's schema with the owner role, `DIRECT_URL`; run it once before the API starts for the first time and after each pg-boss upgrade).
- **Windows:** run `pnpm` from PowerShell. Bash cannot find `node` for pnpm. The database URLs for migrations and the test project must use the Supabase **session pooler** (port 5432, no `?pgbouncer=true`); the transaction pooler (port 6543) is only for the API's runtime connection. `pnpm add` and `pnpm install` finish with `prisma generate`, which failed once with `EPERM` because a running process held the Prisma engine file; the packages were installed anyway. Stop running dev servers and run it again, or use `pnpm install --ignore-scripts` to check the lockfile.
