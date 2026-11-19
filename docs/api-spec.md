# API and Integrations Specification: EduGemini (v1.0)

| | |
|---|---|
| **Status** | approved |
| **Owner** | Project owner (sole developer) |
| **Machine-readable contract** | [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1). Same operation IDs as this document |
| **Precedence** | PRD v2.2 wins on behavior. Backend Schema wins on stored data and enums. This document wins on request and response shapes. `openapi.yaml` wins on exact field types once both are read |
| **Inputs** | [PRD v2.2](prd.md), [App Flow v2.2](app-flow.md), [TRD v1.0](trd.md) §6 to §10 and §13, [Backend Schema](backend-schema.md), [UX Brief](ux-brief.md) §11 |

> **Written for:** the developer building the API and the web client, and the reviewer checking that every requirement has a contract.

---

## Part A: Internal API

### A1. Scope and counts

This part specifies every endpoint the web client exposes. It has **99 endpoints** in 16 groups. `openapi.yaml` uses the same groups as tags, except that FILE-01 has its own `Files` tag. `/healthz` is the only route outside `/api`. Each endpoint has a stable ID (for example `SUB-05`). The same ID is the `operationId` in `openapi.yaml`.

References such as `A4` or `A7` point to sections of this part. The PRD's assumed defaults are written `PRD A1` to `PRD A16`.

There are **no inbound webhooks**. There are no external callbacks. Gemini results are read by the worker, not pushed to us.

### A2. Conventions

| Topic | Rule |
|---|---|
| Base path | `/api`. The only exception is `GET /healthz` (SYS-01) |
| Format | JSON, UTF-8. Field names `camelCase`. Enum values `UPPER_SNAKE_CASE`, exactly as in the Backend Schema |
| Identifiers | UUID v4 strings for every resource. Class codes are the only non-UUID identifiers (join codes, 8 characters) |
| Timestamps | ISO-8601 in UTC with milliseconds, for example `2026-11-20T15:59:00.000Z`. Clients render the viewer's zone (F13). Due dates keep `timezone` so the instructor's zone is shown |
| Scores | JSON numbers with at most two decimal places. Never strings |
| Single resource | The object itself, no wrapper |
| List | `{ "items": [...], "nextCursor": "string or null" }` |
| Pagination | Cursor based. `limit` query parameter, default 25, maximum 100. Cursors are opaque and do not expire (a cursor marks a position, not a snapshot, so a list that changes between pages never breaks); a cursor the server did not issue returns `VALIDATION` |
| Sorting and filtering | Documented per endpoint as query parameters. Unknown parameters are rejected with `VALIDATION` |
| Empty body | `204 No Content` for actions with no response body |
| Request IDs | Every response carries `X-Request-Id`. Clients quote it in support messages |
| Caching | Authenticated responses send `Cache-Control: no-store`. The one public GET (`/join/{code}`) sends `no-store` too |
| Rate limit headers | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` on limited endpoints. `Retry-After` on every `429` |
| Content type | JSON endpoints require `application/json`. Multipart endpoints (REF-01, ANN-02) require `multipart/form-data`. The per-file upload (SUB-03) sends the raw file bytes with the file's own MIME type, and the file name in `X-File-Name` (A7) |
| Body size | JSON bodies up to 100 KB. Multipart per-file limits are in A7 |
| Versioning | None in v1. The web client and API ship together. Changes follow A9 |

### A3. Authentication and authorization

**Session.** Sign-in sets the cookie `eg_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`). The value is an opaque token; the server stores its hash (Backend Schema §4.3). Sessions expire after 7 days idle and 30 days absolute (TQ2). `POST /api/auth/signout-all` removes every session of the user.

**Origin check.** Every non-`GET` request must send an `Origin` header equal to `APP_URL`. Otherwise the server returns `403 CSRF_ORIGIN` before reading the body.

**Status policy.** Responses follow one rule set, applied to every endpoint:

| Status | When | Example |
|---|---|---|
| `401 UNAUTHENTICATED` | No session, or the session is expired or revoked | Any protected call without a cookie |
| `403 ACCOUNT_SUSPENDED` | The user is suspended (checked on every request, no cache) | Any protected call while suspended |
| `403 ENROLLMENT_PENDING` | A student is pending in the class the call names | `GET /api/classes/{classId}/assignments` as a pending student |
| `403 JOIN_BLOCKED` | A removed student re-enters the code (the message is generic) | JOIN-01 |
| `403 INSTRUCTOR_CANNOT_JOIN` | An instructor opens a join link | JOIN-01, JOIN-02 |
| `403 CSRF_ORIGIN` | Missing or foreign `Origin` on a non-`GET` request | Any mutation from another site |
| `404 NOT_FOUND` | The item does not exist **or** the caller has no relationship to it. The response is identical in both cases (no enumeration, App Flow Access Rules 2 and 5) | Another instructor's submission; a declined student's class |
| `409` (specific code) | The request conflicts with the current state | `ATTEMPTS_EXHAUSTED`, `LOCKED_APPROVED` |
| `422` (specific code) | The request is well formed but cannot be applied | `CONFIRMATION_REQUIRED`, `KEY_INVALID` |
| `429 RATE_LIMITED` | Limit exceeded; `Retry-After` set | Sign-in after too many failures |

**Roles.** `STUDENT`, `INSTRUCTOR`, `SUPER_ADMIN` (PRD §5). An endpoint's **Access** line says which roles may call it. A role mismatch on a resource the caller cannot see returns `404`; a role mismatch on a route only one role may use (for example `/api/admin/*` for a student) returns `404` as well, so the route's existence is not revealed.

**Relationship checks.** Class-scoped routes check, in order: the caller's role, the caller's enrollment (students) or ownership (instructors), and the enrollment status. A student must be `ACTIVE` to read class content. `PENDING` gets `403 ENROLLMENT_PENDING`. `DECLINED` and `REMOVED` get `404`.

**Admin.** Admin routes check `SUPER_ADMIN` and return metadata only (Backend Schema §12; TRD §7.3). No admin response includes submission content, feedback, comments, file names, or key data.

### A4. Error envelope and catalog

Every error response has this shape:

```json
{
  "error": {
    "code": "ATTEMPTS_EXHAUSTED",
    "message": "No resubmissions left.",
    "requestId": "9f2c...",
    "fields": { "title": "Required" },
    "details": { "remaining": 0 }
  }
}
```

- `code` is the only field the UI branches on. Its copy is looked up from the UX Brief §11.2 strings. `message` is for logs and developers; it is never shown verbatim to users except where the code's row says so.
- `fields` appears only for `VALIDATION` and `CONFIRMATION_REQUIRED`, keyed by JSON path.
- `details` is optional and typed per code.
- Internal errors never include stack traces, SQL, provider payloads, or key material.

**Catalog.** The codes below are the complete list. Adding a code is an additive change (A9).

| Code | Status | Meaning | UI copy (UX Brief §11.2) |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | No valid session | Redirect to sign-in with return path |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password (generic) | Email or password is incorrect. |
| `VALIDATION` | 400 | Body, query, or path failed validation | Field message from `fields` |
| `PASSWORD_INCORRECT` | 400 | Current password wrong (ACC-03, ACC-04) | Current password is incorrect. |
| `TOKEN_INVALID` | 400 | Reset or verify token expired, used, or unknown | This link is no longer valid. |
| `CONFIRMATION_MISMATCH` | 400 | Typed confirmation does not match | Type the exact name to confirm. |
| `CONFIRMATION_REQUIRED` | 422 | Criteria or reference files changed without an impact token | Confirm the re-grade count first. |
| `CONFIRMATION_STALE` | 409 | Impact token no longer matches the current counts | The counts changed. Review them again. |
| `ACCOUNT_SUSPENDED` | 403 | Account suspended | Account suspended. |
| `ENROLLMENT_PENDING` | 403 | Student is pending in this class | Pending approval. Your instructor will review your request. |
| `JOIN_BLOCKED` | 403 | Removed student re-enters the code (a declined student stays Declined, JOIN-01) | You can't join this class right now. Contact the instructor. |
| `INSTRUCTOR_CANNOT_JOIN` | 403 | Instructor account opened a join link | Instructor accounts can't join classes. |
| `CSRF_ORIGIN` | 403 | Foreign or missing `Origin` | Something went wrong. (never shown in detail) |
| `NOT_FOUND` | 404 | Missing, or no relationship to the caller | We couldn't find that page. / This item is no longer available. |
| `INVALID_JOIN_CODE` | 404 | Code unknown, disabled, regenerated, or archived (all identical) | That code didn't work. Check it and try again. |
| `EMAIL_TAKEN` | 409 | Sign-up with an existing email | An account with this email already exists. |
| `CONFLICT` | 409 | Generic stale state (carries `details.currentState`) | Refresh to see the latest. |
| `LOCKED_APPROVED` | 409 | Resubmit or edit after approval | This submission is locked after approval. |
| `ATTEMPTS_EXHAUSTED` | 409 | No resubmissions left | You've used all your resubmissions. Your instructor can give you more. |
| `LATE_CLOSED` | 409 | Past due, late submissions closed, not allowed individually | Late submissions are closed for this assignment. |
| `FORMAT_LOCKED` | 409 | Scoring format changed after submissions exist (PRD A13) | Scoring can't change after submissions exist. |
| `CLASS_ARCHIVED` | 409 | Write to an archived class | This class is archived and read-only. |
| `KEY_MISSING` | 422 | Re-run requested with no connected key | Connect your Gemini key first. |
| `GRADE_PENDING_EXISTS` | 409 | A re-grade is already waiting for review | A re-grade is already pending review. |
| `NOT_REGRADABLE` | 409 | Re-grade requested on an unapproved submission | Only approved submissions can be re-graded this way. |
| `UPLOAD_NOT_OPEN` | 409 | Upload targets a version that is already stored | Start a new upload to replace files. |
| `UPLOAD_INCOMPLETE` | 409 | Finalize while listed files are missing or failed | Some files haven't finished uploading. |
| `ALREADY_APPROVED` | 409 | Approve on an approved submission | Already approved. |
| `LABEL_EXISTS` | 409 | Duplicate label name in the class | A label with this name already exists. |
| `FILE_TYPE` | 415 | Not PDF, JPEG, or PNG (by content) | This file type isn't supported. Use PDF, JPG, or PNG. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Wrong `Content-Type` for the endpoint | Something went wrong. (never shown in detail) |
| `PAYLOAD_TOO_LARGE` | 413 | JSON body over 100 KB | Something went wrong. (never shown in detail) |
| `FILE_TOO_LARGE` | 413 | One file over 10 MiB | This file is larger than 10 MB. |
| `FILE_LIMIT` | 422 | Count, total size, or page count over the limit (`details.limit`) | Shows the limit named in `details.limit` |
| `FILE_ERROR` | 422 | Password-protected, corrupt, or unreadable (`details.failureCode`) | This file couldn't be read. Try re-saving it or choosing a different file. |
| `KEY_INVALID` | 422 | Key rejected by the provider | This key isn't valid. Check it and try again. |
| `KEY_API_DISABLED` | 422 | Key valid but the Gemini API is not enabled for it | The Gemini API isn't enabled for this key. |
| `KEY_QUOTA` | 422 | Key test hit the daily limit | This key has reached its daily limit. |
| `RATE_LIMITED` | 429 | Limit exceeded | Too many attempts. Try again in a few minutes. |
| `SERVICE_UNAVAILABLE` | 503 | Maintenance or a dependency is down (`details.service`) | EduGemini is down for maintenance. We'll be back soon. |
| `PROVIDER_UNAVAILABLE` | 503 | A provider (Gemini) could not be reached during a key check; nothing was saved | We couldn't reach Google right now. Try again in a few minutes. |
| `INTERNAL` | 500 | Unexpected failure | Something went wrong on our side. |

**Standard error sets.** To keep endpoint sections short, each endpoint lists the codes it can return from these sets in addition to its own:

| Set | Codes |
|---|---|
| `STD-PUBLIC` | `RATE_LIMITED`, `INTERNAL` |
| `STD-AUTH` (protected GET) | `UNAUTHENTICATED`, `ACCOUNT_SUSPENDED`, `RATE_LIMITED`, `INTERNAL` |
| `STD-MUT` (JSON mutation) | `STD-AUTH` plus `CSRF_ORIGIN`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `VALIDATION` |
| `STD-UPLOAD` (multipart) | `STD-AUTH` plus `CSRF_ORIGIN`, `FILE_TOO_LARGE`, `FILE_TYPE`, `FILE_LIMIT`, `FILE_ERROR` |

### A5. Shared schemas

These are the shapes used across endpoints. Each has a matching component in `openapi.yaml`.

**`Me`**: the signed-in user.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `email` | string | Lowercase |
| `firstName`, `lastName` | string | |
| `role` | `STUDENT` \| `INSTRUCTOR` \| `SUPER_ADMIN` | One role per account (PRD A6) |
| `emailVerified` | boolean | Banner when false (FR-AUTH-04) |
| `suspended` | boolean | Always false on a successful response; present for symmetry with the 403 |
| `preferences` | `Preferences` | See ACC-05 |

**`Preferences`**: `{ "emailCategories": { "grading": true, "joins": true, "announcements": false } }`. Categories are fixed: `grading`, `joins`, `announcements`, `account`. `account` cannot be turned off (suspension and deletion notices).

**`KeyStatus`**: the instructor's key (never the key itself). `connected` says a key is saved. `status` is null when no key is saved and until the key is first checked with Gemini (EG-KEY-03); after that it is `CONNECTED`, `NEEDS_ATTENTION`, or `QUOTA_REACHED`.

| Field | Type |
|---|---|
| `connected` | boolean |
| `status` | `CONNECTED` \| `NEEDS_ATTENTION` \| `QUOTA_REACHED` \| `null` |
| `last4` | string (4) or null |
| `lastSuccessAt` | timestamp or null |
| `disclosureAckAt` | timestamp or null |

**`ClassSummary`**: a class as the caller sees it.

| Field | Instructor | Student |
|---|---|---|
| `id`, `name`, `description`, `section`, `subject`, `room` | yes | yes |
| `status` | `ACTIVE` \| `ARCHIVED` | `ACTIVE` \| `ARCHIVED` |
| `instructorName` | — | first name and last initial (API-1; UX D-U4) |
| `joinCode`, `joinLink`, `joinCodeActive` | yes | no |
| `requireApproval` | yes | no |
| `enrollment` | — | `{ "status": "ACTIVE" \| "PENDING" \| "DECLINED" \| "REMOVED" }` for the caller's own row |
| `counts` | `{ approved, pending, declined, removed }` | — |

**`EnrollmentView`**: `{ id, student: { id, displayName, email? }, status, joinedAt, decidedAt }`. `email` is present for the owning instructor only (PRD §11). `displayName` is the first and last name entered at sign-up.

**`AssignmentSummary`**: a row in a list.

| Field | Notes |
|---|---|
| `id`, `classId`, `title`, `dueAt`, `timezone` | `classId` lets an assignment page link back to its class |
| `label` | `{ id, name }` or null |
| `status` | `DRAFT` \| `PUBLISHED` \| `ARCHIVED`. Drafts appear to instructors only |
| `scoringFormat`, `maxScore` | |
| `maxResubmissions` | integer 0 to 10, or null for Unlimited |
| `acceptLate` | boolean |
| `criteriaVersion` | integer |
| `my` | Students: `{ state: DisplayState, attemptsLeft, isLate }` where `state` is the student display state (A5, Submission) |
| `counts` | Instructors: `{ turnedIn, late, missing, notYetDue, needsReview }` (Backend Schema §8.3) |

**`AssignmentDetail`**: `AssignmentSummary` plus `instructions`, `criteriaText`, `letterScale` (array of `{ letter, min }`, null for default), `referenceFiles` (`ReferenceFileView[]`: instructors see all; students see only `visibleToStudents: true`).

**`AssignmentInput`** (create and PATCH): the writable fields.

| Field | Rule |
|---|---|
| `title` | 1 to 200 characters |
| `instructions` | Optional, up to 5,000 characters |
| `criteriaText` | 1 to 5,000 characters; required to publish; may be empty on a draft (ASG-02) |
| `dueAt` | ISO timestamp |
| `timezone` | IANA zone name, for example `Asia/Manila` |
| `scoringFormat` | `POINTS` \| `PERCENTAGE` \| `LETTER_NUMERIC` |
| `maxScore` | Greater than 0, at most 1000. Forced to 100 for `PERCENTAGE` and `LETTER_NUMERIC` |
| `letterScale` | Optional array; required values from the default scale when omitted (UX/PRD FR-ASG-06) |
| `maxResubmissions` | Integer 0 to 10, or null for Unlimited. Default 3 on create |
| `acceptLate` | Boolean. Default true |
| `labelId` | Optional, must belong to the same class |
| `impactToken` | Required on PATCH when `criteriaText` or the reference-file set changes (A6) |

**`StudentSubmission`** (SUB-01): the student's own state for one assignment.

| Field | Notes |
|---|---|
| `state` | `DisplayState` (below) |
| `isLate` | Derived from `latestSubmittedAt` and `dueAt` (Backend Schema §8.1) |
| `closed` | True when late is closed for this student and no allowance exists |
| `attemptsLeft` | Integer, or null for Unlimited |
| `unlimited` | Boolean |
| `firstSubmittedAt`, `latestSubmittedAt` | Timestamp or null |
| `files` | `FileView[]` for the current version (empty before upload) |
| `grade` | `GradeView` or null. Shown when `state` is `AI_GENERATED` or `INSTRUCTOR_APPROVED` |
| `instructorComment` | String or null. Shown only when approved (App Flow 6, step 9) |
| `draftVersion` | `DraftVersion` or null when an upload is open |

**`DisplayState`** (student-facing; the mapping keeps causes and internal states off student screens):

| `DisplayState` | Database state | Student copy |
|---|---|---|
| `NOT_SUBMITTED` | no submission row, or no stored version | Not submitted |
| `UPLOADING` | a version is `UPLOADING` | Uploading |
| `GRADING` | `QUEUED` or `GRADING` | Grading in progress, usually about a minute |
| `AWAITING_REVIEW` | `NEEDS_MANUAL_REVIEW` (any cause) | Submitted, awaiting instructor review |
| `AI_GENERATED` | `AI_GENERATED` | AI-generated |
| `INSTRUCTOR_APPROVED` | `INSTRUCTOR_APPROVED` | Instructor-approved |

Students never receive `manualReviewCause`, `criteriaChanged`, or re-grade details. Instructors do.

**`GradeView`**: `{ source: "AI" | "INSTRUCTOR", score, maxScore, scoringFormat, letter, percentage, feedback, chip }`. `percentage` is `score / maxScore * 100`, rounded to a whole number for display. `chip` is the status token name from the UX Brief (for example `status-ai`). Letter is computed from the scale on the server (PRD §9.4), never trusted from the model.

**`InstructorSubmission`** (INS-01): the Submission screen.

| Field | Notes |
|---|---|
| `id`, `state`, `manualReviewCause` | Cause only when `state` is `NEEDS_MANUAL_REVIEW` |
| `assignment` | `{ id, title, dueAt, scoringFormat, maxScore }` |
| `student` | `{ id, displayName }` (email is not shown on this screen) |
| `isLate`, `firstSubmittedAt`, `latestSubmittedAt` | Both timestamps shown (PRD A4) |
| `attemptsLeft`, `resubmissionsUsed`, `extraAttempts`, `lateAllowed` | |
| `criteriaChanged` | True when approved and the grade's criteria version is behind |
| `approvedAt`, `approvedBy` | `{ id, displayName }` or null |
| `activeGrade` | `GradeView` or null |
| `pendingRegrade` | `GradeView` or null (FR-REV-10) |
| `instructorComment` | String or null |
| `files` | `FileView[]` for the current version |
| `reviewHistory` | Last 50 `ReviewActionView` entries, newest first |

**`FileView`**: `{ id, clientFileId, ordinal, displayName, mimeType, sizeBytes, pageCount, status, failureCode }`. `clientFileId` is the key the browser gave the file: how SUB-03 and SUB-04 address it and how finalize lists it. Files are downloaded through FILE-01, never by URL in this object.

**`VersionView`**: `{ id, versionNo, status, createdAt, storedAt }`.

**`DraftVersion`**: a `VersionView` plus `files` (`FileView[]`, the files stored in the open upload so far, in order). It lets the page pick an upload up again after a reload or a visit to another page.

**`ReferenceFileView`**: `{ id, ordinal, label, mimeType, sizeBytes, visibleToStudents }`. `label` is "Reference file N" (the schema stores no display name for reference files; see A10).

**`ReviewQueueItem`**: `{ submissionId, class: { id, name }, assignment: { id, title }, student: { displayName }, state, manualReviewCause, pendingRegrade, isLate, latestSubmittedAt, criteriaChanged }`. A re-grade awaiting review has `state: "INSTRUCTOR_APPROVED"` and `pendingRegrade: true`.

**`TrackerRow`**: `{ submissionId, student: { id, displayName }, displayState, score, maxScore, letter, isLate, attemptsLeft, criteriaChanged, latestSubmittedAt, manualReviewCause }`. `submissionId` is null for students with no submission. `displayState` uses the instructor view: `NOT_SUBMITTED`, `MISSING`, `NOT_YET_DUE`, `GRADING`, `NEEDS_REVIEW`, `AI_GENERATED`, `INSTRUCTOR_APPROVED`, and `LATE` is a separate boolean.

**`GradebookCell`**: `{ assignmentId, displayState, score, letter }`. Score is in the assignment's own format (PRD FR-GB-03).

**`Notification`**: `{ id, type, title, body, link, readAt, createdAt }`. `title` and `body` come from the copy table in the UX Brief (§11.6) for the notification type. They never contain grades, feedback, or file names (Backend Schema §4.20).

**`Announcement`**: `{ id, title, body, createdAt, author: { displayName }, files: [{ id, label, mimeType, sizeBytes }] }`. `label` is "Attachment N" (API-2).

**`Progress`**: `{ batchId, kind: "REGRADE" | "RERUN" | "BULK_APPROVE", total, done, state: "RUNNING" | "DONE" | "PAUSED_QUOTA", updatedAt }`.

**`CriteriaImpact`**: `{ unapprovedCount, approvedCount, pendingRegradeCount, impactToken, impactExpiresAt }`. The token lasts 10 minutes and is bound to the assignment, its criteria version, and the counts (A6).

**`Page`**: `{ items, nextCursor }` wrapper for every list (A2).

**`AdminUser`** and **`AdminClass`**: metadata only.

| Type | Fields |
|---|---|
| `AdminUser` | `id`, `email`, `firstName`, `lastName`, `role`, `status` (`ACTIVE` \| `SUSPENDED` \| `TOMBSTONE`), `createdAt`, `classCount` |
| `AdminClass` | `id`, `name`, `instructor: { id, displayName }`, `studentCount`, `assignmentCount`, `status` (`ACTIVE` \| `ARCHIVED`), `archivedAt` |

**`AuditEntry`**: `{ id, actor: { id, role }, action, target: { type, id }, reason, createdAt }`.

**`Health`** (SYS-01): `{ status: "ok" | "degraded", time }`. No version, dependency names, or counts (A8).

### A6. Authorization-dependent writes: the re-grade confirmation

Changing criteria or reference files re-grades unapproved work (FR-ASG-04). The confirmation the instructor saw must match what is applied. The mechanism:

1. `POST /api/assignments/{id}/criteria-impact` (ASG-05) returns the counts and a signed `impactToken` (10 minutes).
2. `PATCH /api/assignments/{id}` (ASG-04) with changed criteria or files must include that token.
3. The server recomputes the counts inside the transaction. If they differ from the token's counts, it returns `409 CONFIRMATION_STALE` with the new counts in `details`, and the client asks the instructor again.
4. A missing or invalid token returns `422 CONFIRMATION_REQUIRED`.

Edits that do not change criteria or files (title, instructions, label, limits, late policy, due date) need no token. A due-date change never re-grades (D6).

A draft has nothing to re-grade, so adding or removing a reference file on a draft needs no token (an `impactToken` sent with it is ignored). On a published assignment the token is required; until the impact check is built (ASG-04), adding or removing a reference file there answers `CONFIRMATION_REQUIRED`, as a criteria edit does.

### A7. Upload protocol

Uploads are a three-step flow so that a retry never loses files and a submission exists only when every file is stored (FR-SUB-03).

1. **Open a version.** `POST /api/assignments/{assignmentId}/versions` (SUB-02). Returns the open `VersionView`. If a version is already `UPLOADING`, it returns that one (idempotent). A page that finds `draftVersion` in SUB-01 already knows the open version and its stored files, so it does not need to ask. An upload that is not finalized within 24 hours of being opened is deleted with its files (TRD §9.3).
2. **Send each file.** `PUT /api/versions/{versionId}/files/{clientFileId}` (SUB-03). The body is the raw file bytes (`Content-Type` set to the file's MIME type, which the server re-checks against the content). `X-File-Name` carries the display name, URL-encoded, at most 255 bytes. The server streams the body to a temporary file, enforces the 10 MiB limit while streaming, sniffs the content (PDF, JPEG, PNG, HEIC), converts HEIC to JPEG, counts PDF pages, and stores the result. Re-sending the same `clientFileId` replaces that file's row (idempotent). The response is the `FileView` of the stored file. A file the server refuses stores nothing, and the answer is the error.
3. **Finalize.** `POST /api/versions/{versionId}/finalize` (SUB-05) with the list of `clientFileId`s the client expects. The server checks that every expected file is `STORED`, re-checks the attempt count inside a locked transaction, and only then queues grading.

**Why raw bytes, not multipart, for the per-file PUT.** One file per request keeps each request small and retryable on mobile networks, and it lets the client show per-file progress. The reference-file and announcement endpoints use `multipart/form-data` because they accept several files or a title in the same request.

**Limits enforced on every file (A7 is the single definition).** Count and size limits are from PRD FR-SUB-02. Per-file: 10 MiB, 20 pages (PDF), PDF/JPEG/PNG after conversion. Per-version: 10 files, 15 MiB total. Reference files count toward the same 15 MiB grading budget (TRD §11.3), which is checked at finalize and reported as `FILE_LIMIT` with `details.limit: "grading-budget"` if exceeded. Verify the Gemini request-size limit at spike S3: a Google announcement reports inline payloads raised to 100 MB base64, while a Firebase page still states 20 MB. The 15 MiB budget stays until S3 confirms a different figure.

### A8. Health and maintenance

`GET /healthz` (SYS-01) runs a trivial query (a one-row read through Prisma, because raw SQL is limited to three places, code-standards §7) and returns `200 { status: "ok" }` or `503 { status: "degraded" }`. It is outside `/api`, unauthenticated, and returns nothing internal. Maintenance mode returns `503 SERVICE_UNAVAILABLE` from every `/api` route except `/healthz` and returns the maintenance page to browsers (App Flow §11).

### A9. Change policy

| Change | Allowed without a version bump? | Rule |
|---|---|---|
| New endpoint | Yes | Add an ID; update `openapi.yaml` in the same change |
| New optional request field | Yes | Old clients keep working |
| New response field | Yes | Clients must ignore unknown fields |
| New error code | Yes | Clients must handle unknown codes with the generic message |
| Removed or renamed field, changed type, stricter validation | No | Ships with the web client, in one release; the OpenAPI breaking-change check must pass or be overridden deliberately |
| Changed status code for an existing error | No | Same as above |

The breaking-change check compares the previous `openapi.yaml` with the new one in CI (TRD §16.3).

### A10. Decisions in this document that need owner confirmation

| # | Decision | Where | Status |
|---|---|---|---|
| API-1 | Students see the instructor's first name and last initial on the class card | ClassSummary | Decided 2026-11-15 |
| API-2 | Reference files show as "Reference file N" and announcement attachments as "Attachment N", because the schema stores no display name for them | ReferenceFileView, Announcement | Proposed; avoids a schema change |
| API-3 | `impactToken` confirmation for criteria and file changes | A6 | Proposed |
| API-4 | Raw-byte PUT for each file | A7 | Proposed |
| API-6 | `Idempotency-Key` headers are not used; idempotency comes from state checks and client file IDs | A11 | Decided |
| API-7 | Students get `NOT_FOUND` for draft and archived assignments, with the same copy as a missing item | ASG-03, SUB-02 | Proposed |
| API-8 | UI copy in the A4 catalog that is not yet in UX Brief §11.2 | A4 | Proposed; add to the UX Brief once approved |

### A11. Concurrency and idempotency

- **Row locks.** Every mutation that changes a submission locks its row (`SELECT ... FOR UPDATE`) inside the transaction. Approve, reopen, grant, allow-late, re-run, re-grade, finalize, and the grade-write from the worker all take the same lock, so they serialize.
- **Class locks.** Code regeneration and class deletion lock the class row.
- **Idempotent by state.** Repeating a request that is already satisfied returns the current state and succeeds where the PRD allows (for example, a second `POST /api/classes/{id}/archive` on an archived class returns 200 with the same body). A request that conflicts with the state returns the `409` code in the endpoint section.
- **Idempotent by key.** Uploads use `clientFileId`; a version create returns the open version.
- **No client keys.** `Idempotency-Key` is not supported (API-6).

### A12. Rate limits

| Scope | Limit | Notes |
|---|---|---|
| Sign-in, per IP | 20 failed attempts per 15 minutes | Successful sign-ins do not count, so a class sharing one network is not blocked |
| Sign-in, per IP, all attempts | 300 per 15 minutes | Caps the CPU spent on password checks |
| Sign-in, per email and IP | 5 failed attempts per 15 minutes | Counted per email and IP together, so someone guessing at an email can only lock their own network out of it, not the real owner. Returns `RATE_LIMITED` with the same copy for known and unknown emails |
| Sign-up, per IP | 60 per hour | Sized for a class signing up together on one school network |
| Password reset request, per email | 3 per hour | Same response for known and unknown emails |
| Join code attempts, per user | 10 failed attempts per hour | Any refused join counts (`INVALID_JOIN_CODE`, `JOIN_BLOCKED`); a successful join and a code of the wrong length do not |
| Join link preview, per IP | 30 failed tries per hour | Only failed tries count, for the same reason as sign-in. Not part of the general limit below |
| Uploads (PUT), per user | 60 per minute | Opening a version (SUB-02) and sending a file (SUB-03) share one count |
| Grading triggers, per user | 30 per minute | Pacing per instructor key is separate (TRD §10.2) |
| Bulk actions, per instructor | 10 per minute | |
| Class creation, per user | 20 per hour | Counted after validation, so a request with errors does not use it up |
| Notifications read and count, per user | 300 per minute | Polling-friendly. One count for the four notification routes (NTF-01 to NTF-04); they are not part of the general limit below |
| Admin, per admin | 60 per minute | |
| Everything else, per user | 120 per minute | One shared counter per user across every route that has no row of its own above |

### A13. Polling contract

| Client view | Endpoint | Interval | Stops when |
|---|---|---|---|
| Student assignment page, while `GRADING` or `UPLOADING` | SUB-01 | 5 seconds | State is not `GRADING` or `UPLOADING` |
| Instructor Submission screen, while a re-grade or re-run is queued | INS-01 | 5 seconds | No `pendingRegrade` change is expected |
| Re-grade or bulk progress banner | BLK-04 | 3 seconds | `state` is `DONE` or `PAUSED_QUOTA` |
| Notification badge | NTF-04 | 60 seconds | Tab hidden |
| Review-queue badge | REV-02 | 60 seconds | Tab hidden |

Polling pauses when the tab is hidden. Each poll sends `If-None-Match` where the response has an `ETag`; a `304` keeps the cached copy. No server-sent events or websockets in v1 (TRD T-D5).

### A14. Export format (CSV)

Used by TRK-02 and TRK-04.

- `text/csv; charset=utf-8`, with a UTF-8 byte-order mark (`EF BB BF`) so Excel and Google Sheets open the file correctly (FR-GB-02).
- The first row is the header. Fields are quoted when they contain a comma, quote, or line break. Quotes are doubled.
- Any cell whose value starts with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed with `'`. This applies to every text field, including student names and feedback (TRD §8.3).
- Streamed row by row. The filename is `<class-or-assignment-slug>-<yyyy-mm-dd>.csv`, using only letters, digits, and hyphens.
- Scores appear in the assignment's own format: points as `42/50`, percentage as `84%`, letter as `B+ (87)`. The raw numeric score is always the first numeric column so spreadsheets can sort it.

### A15. Permissions summary

This table maps the PRD §5.1 matrix onto endpoint IDs. Each row has a test in the authorization matrix (TRD §7.2).

| Action (PRD §5.1) | Endpoints | Student | Instructor (own class) | Super Admin |
|---|---|---|---|---|
| Create class | CLS-02 | — | ✓ | — |
| View own classes and class details | CLS-01, CLS-03, JOIN-03 | ✓ (approved; JOIN-03 lists a student's own classes with any status except removed) | ✓ | — |
| Join via code | JOIN-01 | ✓ | — | — |
| Approve, decline, remove joins | PPL-02, PPL-03 | — | ✓ | — |
| Regenerate or disable code | CLS-08, CLS-09 | — | ✓ | — |
| Remove a student | PPL-02 | — | ✓ | — |
| Archive class | CLS-05, CLS-06 | — | ✓ | ✓ (ADM-07) |
| Edit class details | CLS-04 | — | ✓ | — |
| Delete class | CLS-07, CLS-11 | — | ✓ | ✓ (ADM-08) |
| View assignments | ASG-01, ASG-03 | ✓ (approved, published only) | ✓ | — |
| Create or edit assignment | ASG-02, ASG-04 | — | ✓ | — |
| Delete or archive assignment | ASG-07, ASG-09 | — | ✓ | — |
| Labels | ASG-10 to ASG-12 | — | ✓ | — |
| Own Gemini key | KEY-01 to KEY-04 | — | ✓ | — |
| Announcements | ANN-01 to ANN-03 | read ✓ (approved) | ✓ | — |
| Upload or resubmit | SUB-02 to SUB-06 | ✓ (own, within limits) | — | — |
| Grant attempts, allow late | INS-04, INS-05 | — | ✓ | — |
| View own score and feedback | SUB-01 | ✓ | — | — |
| View other students' data | INS-01, TRK-01, TRK-03 | — | ✓ | metadata only (ADM-01, ADM-02) |
| Class stats | TRK-05 | ✓ (approved) | ✓ | ✓ (metadata) |
| Edit and approve | INS-02, INS-11 | — | ✓ | — |
| Instructor comment | INS-10 | — | ✓ | — |
| Reopen | INS-03 | — | ✓ | — |
| Tracker, gradebook, CSV | TRK-01 to TRK-04 | — | ✓ | — |
| Update own name, password | ACC-02, ACC-03 | ✓ | ✓ | ✓ |
| Delete own account | ACC-04 | ✓ | ✓ | — |
| Suspend, reinstate, delete accounts | ADM-03 to ADM-05 | — | — | ✓ |
| Platform health | ADM-09 | — | — | ✓ |

Each endpoint section repeats its own access line; this table is the summary.
## Part B: Endpoint specifications

Each endpoint has the same fields:

- **Access:** who may call it.
- **FR:** the PRD requirements it serves.
- **Request** and **Response:** the body, parameters, and success status. Field types are in `openapi.yaml`.
- **Errors:** codes from the catalog (A4). The standard set named in the header line is included automatically.
- **Effects:** side effects, jobs, and notifications.
- **Concurrency** and **Limit:** when they apply.
- **Test:** the E2E spec (TRD §16.2a) that covers it.

### B.1 Authentication (8 endpoints)

#### AUTH-01 · Sign up
`POST /api/auth/signup` · Standard set: `STD-PUBLIC`, `CSRF_ORIGIN`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `VALIDATION`
- **Access:** anonymous.
- **FR:** FR-AUTH-01, FR-AUTH-03, FR-AUTH-04, FR-AUTH-09.
- **Request:** `{ email, password, firstName, lastName, role: "STUDENT" | "INSTRUCTOR", acceptTerms: true, termsVersion }`. Password 10 or more characters, checked against a common-password list. `acceptTerms` must be `true`.
- **Response:** `201` `Me`, and sets `eg_session`. The new account is signed in at once; verification is a banner, not a gate (PRD A2; FR-AUTH-04).
- **Errors:** `EMAIL_TAKEN`, `VALIDATION` (field messages in `fields`), `RATE_LIMITED`.
- **Effects:** queues a `VERIFY_EMAIL` token (24 hours) and the verification email. Added with EG-AUTH-05 (M3); until then sign-up sends nothing.
- **Limit:** see A12.
- **Test:** `auth.spec` (FR-AUTH-01, 03, 09).

#### AUTH-02 · Sign in
`POST /api/auth/signin` · Standard set: `STD-PUBLIC`, `CSRF_ORIGIN`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `VALIDATION`
- **Access:** anonymous.
- **FR:** FR-AUTH-01, FR-AUTH-06.
- **Request:** `{ email, password }`.
- **Response:** `200` `Me`, and sets `eg_session`. Redirects are the client's job; the return path is restored from the `eg_return` cookie (TRD §6.4).
- **Errors:** `INVALID_CREDENTIALS` (the same body for a wrong password and an unknown email), `ACCOUNT_SUSPENDED` (403, only after the password is verified, so suspension is not revealed to strangers), `RATE_LIMITED`.
- **Effects:** creates a session row.
- **Limit:** see A12.
- **Test:** `auth.spec` (generic error, lockout).

#### AUTH-03 · Sign out
`POST /api/auth/signout` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** any signed-in user.
- **FR:** FR-AUTH-06.
- **Request:** no body.
- **Response:** `204`, and clears `eg_session`.
- **Errors:** none beyond the standard set (an expired session also returns `204`).
- **Effects:** deletes the current session row.
- **Test:** `auth.spec`.

#### AUTH-04 · Sign out everywhere
`POST /api/auth/signout-all` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** any signed-in user.
- **FR:** FR-AUTH-06.
- **Request:** no body.
- **Response:** `204`, and clears `eg_session`.
- **Effects:** deletes every session row for the user, including the current one.
- **Test:** `auth.spec`.

#### AUTH-05 · Request a password reset
`POST /api/auth/forgot-password` · Standard set: `STD-PUBLIC`, `CSRF_ORIGIN`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `VALIDATION`
- **Access:** anonymous.
- **FR:** FR-AUTH-05.
- **Request:** `{ email }`.
- **Response:** `202` with the same body for every email: `{ message: "If that email has an account, we sent a link." }`. The response time is padded to a fixed minimum so it does not reveal the account either.
- **Errors:** `RATE_LIMITED` (per email and per IP; the body is still identical).
- **Effects:** for an existing account, creates a `RESET_PASSWORD` token (60 minutes, single use) and sends the email.
- **Limit:** 3 per hour per email (A12).
- **Test:** `auth.spec` (enumeration, FR-AUTH-05).

#### AUTH-06 · Set a new password from a reset link
`POST /api/auth/reset-password` · Standard set: `STD-PUBLIC`, `CSRF_ORIGIN`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `VALIDATION`
- **Access:** anonymous, with a valid token.
- **FR:** FR-AUTH-05.
- **Request:** `{ token, newPassword }`. The same password rules as AUTH-01.
- **Response:** `204`.
- **Errors:** `TOKEN_INVALID` (expired, used, or unknown; one message for all three), `VALIDATION`.
- **Effects:** marks the token used, sets the password hash, and deletes every session of the user (App Flow §1 step 5).
- **Concurrency:** the token row is locked, so two submissions cannot both succeed.
- **Test:** `auth.spec` (single use, expiry).

#### AUTH-07 · Verify email
`POST /api/auth/verify-email` · Standard set: `STD-PUBLIC`, `CSRF_ORIGIN`, `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `VALIDATION`
- **Access:** anonymous or signed in, with a valid token.
- **FR:** FR-AUTH-04.
- **Request:** `{ token }`.
- **Response:** `200` `{ emailVerified: true }`.
- **Errors:** `TOKEN_INVALID`.
- **Effects:** sets `email_verified_at`, marks the token used, and enables email notifications (FR-AUTH-04).
- **Test:** `auth.spec` (verification).

#### AUTH-08 · Resend the verification email
`POST /api/auth/resend-verification` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** signed-in, unverified user.
- **FR:** FR-AUTH-04.
- **Request:** no body.
- **Response:** `202`. A verified user gets `204` with no email (the banner is hidden anyway).
- **Errors:** `RATE_LIMITED` (3 per hour).
- **Effects:** invalidates earlier unused verification tokens and creates one new token.
- **Test:** `auth.spec`.

### B.2 Account (7 endpoints)

#### ACC-01 · Get the current user
`GET /api/me`
- **Access:** any signed-in user.
- **FR:** FR-AUTH-07, FR-AUTH-08.
- **Response:** `200` `Me`.
- **Errors:** STD-AUTH.
- **Test:** `auth.spec`.

#### ACC-02 · Update name
`PATCH /api/me` · Standard set: `STD-MUT`
- **Access:** any signed-in user.
- **FR:** FR-AUTH-07.
- **Request:** `{ firstName?, lastName? }` (1 to 100 characters each).
- **Response:** `200` `Me`.
- **Effects:** the new name appears in rosters and gradebooks at once (no copies are stored elsewhere).
- **Test:** `account.spec`.

#### ACC-03 · Change password
`POST /api/me/password` · Standard set: `STD-MUT`
- **Access:** any signed-in user.
- **FR:** FR-AUTH-07.
- **Request:** `{ currentPassword, newPassword }`. `currentPassword` is required.
- **Response:** `204`. Other sessions stay signed in (the user is changing their own password, not recovering it).
- **Errors:** `PASSWORD_INCORRECT`, `VALIDATION` and `ACCOUNT_SUSPENDED` (standard).
- **Test:** `account.spec`.

#### ACC-04 · Delete own account
`DELETE /api/me` · Standard set: `STD-MUT`
- **Access:** any signed-in user (students and instructors).
- **FR:** FR-AUTH-10, D10.
- **Request:** `{ password, confirmation: "DELETE" }`. `confirmation` must equal `DELETE` exactly.
- **Response:** `204`, and clears `eg_session`.
- **Errors:** `CONFIRMATION_MISMATCH`, `PASSWORD_INCORRECT`, `VALIDATION`.
- **Effects:** runs the deletion path in Backend Schema §10.3 (student) or §10.4 (instructor). Instructors' classes are archived and their students are notified. The response does not wait for the storage cleanup, which runs from the outbox.
- **Concurrency:** the user row is locked. A second delete request returns `204` (already deleted).
- **Test:** `account.spec` (both roles).

#### ACC-05 · Get notification preferences
`GET /api/me/preferences`
- **Access:** any signed-in user.
- **FR:** FR-NTF-04.
- **Response:** `200` `Preferences`.
- **Test:** `notifications.spec`.

#### ACC-06 · Update notification preferences
`PUT /api/me/preferences` · Standard set: `STD-MUT`
- **Access:** any signed-in user.
- **FR:** FR-NTF-04.
- **Request:** `{ emailCategories: { grading?, joins?, announcements? } }`. `account` is not accepted; it is always on.
- **Response:** `200` `Preferences`.
- **Errors:** `VALIDATION` (for example, `account` present).
- **Effects:** writes `notification_preferences` rows. Existing queued emails are re-checked when sent, so a change applies to them too.
- **Test:** `notifications.spec`.

#### ACC-07 · Preview what deleting the account will remove
`GET /api/me/deletion-impact`
- **Access:** any signed-in user.
- **FR:** FR-AUTH-10.
- **Response:** `200` `{ role, classesArchived, studentsNotified, keyDeleted, submissionsDeleted, filesDeleted }`. Counts are for the confirmation screen only; they are recomputed at delete time.
- **Errors:** STD-AUTH.
- **Test:** `account.spec`.

### B.3 Instructor Gemini key (4 endpoints)

#### KEY-01 · Get key status
`GET /api/me/key`
- **Access:** instructor.
- **FR:** FR-KEY-01, FR-KEY-06.
- **Response:** `200` `KeyStatus`. Never the key, never the ciphertext, only `last4`.
- **Errors:** STD-AUTH, `NOT_FOUND` for any other role.
- **Test:** `key.spec`.

#### KEY-02 · Save a key
`PUT /api/me/key` · Standard set: `STD-MUT`
- **Access:** instructor.
- **FR:** FR-KEY-01, FR-KEY-02, FR-KEY-03, FR-KEY-04.
- **Request:** `{ apiKey, disclosureAcknowledged: true }`. `disclosureAcknowledged` must be `true` on the first save (FR-KEY-04). The key is never echoed.
- **Response:** `200` `KeyStatus` with `status: "CONNECTED"`.
- **Errors:** `KEY_INVALID`, `KEY_API_DISABLED`, `KEY_QUOTA`, `VALIDATION` (missing acknowledgement), `PROVIDER_UNAVAILABLE` (503; the key is not saved). The UI shows the provider reason for each code (UX Brief §11.2).
- **Effects:** runs the Gemini model-list call (no generation quota, TRD §11.5). On success, encrypts the key (AES-256-GCM, Backend Schema §12.5), stores ciphertext, IV, tag, `key_version`, and `last4`, and replaces any previous key. On failure, nothing is stored and any previous key is kept. Until EG-KEY-03 is built the Gemini call is not made: the key is stored as sent and the response has `status: null`. The key is trimmed first, so `last4` is the trimmed key's. The first-save rule is checked inside the locked transaction: with no key saved, any `disclosureAcknowledged` other than `true` is `VALIDATION` with `fields.disclosureAcknowledged`; replacing a saved key needs none and keeps the first acknowledgement time. A key shorter than 20 or longer than 200 characters is `VALIDATION` with `fields.apiKey`.
- **Concurrency:** the instructor's key row is locked during the replace.
- **External:** Gemini (B1).
- **Test:** `key.spec`.

#### KEY-03 · Remove the key
`DELETE /api/me/key` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** instructor.
- **FR:** FR-KEY-01, FR-KEY-05.
- **Response:** `204`.
- **Effects:** deletes the key row (also when there is none: `204` either way). Queued grading jobs for this instructor move their submissions to Needs manual review with cause `KEY_MISSING` (App Flow §11). The instructor gets a `KEY_NEEDS_ATTENTION` notification. The job and notification effects come with the grading and missing-key tickets (EG-AI-03, EG-KEY-07); until then only the row is deleted.
- **Test:** `key.spec`.

#### KEY-04 · Test the saved key
`POST /api/me/key/test` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** instructor.
- **FR:** FR-KEY-02, FR-KEY-06.
- **Response:** `200` `KeyStatus`. Uses the same model-list call. Does not spend generation quota.
- **Errors:** `KEY_INVALID`, `KEY_API_DISABLED`, `KEY_QUOTA`, `PROVIDER_UNAVAILABLE`. A failure updates `status` on the stored key.
- **Limit:** 6 per hour per instructor, to keep the provider call count low.
- **Test:** `key.spec`.
### B.4 Classes (11 endpoints)

#### CLS-01 · List classes
`GET /api/classes?status=ACTIVE|ARCHIVED&cursor&limit`
- **Access:** instructor (classes they own) or student (classes with an enrollment that is not `REMOVED`).
- **FR:** FR-CLS-06, FR-CLS-08, FR-AUTH-08.
- **Response:** `200` `Page<ClassSummary>`. Archived classes are returned only when `status=ARCHIVED` is asked for, so the instructor's default view hides them (App Flow §3).
- **Errors:** STD-AUTH, `VALIDATION`.
- **Test:** `class.spec`.

#### CLS-02 · Create class
`POST /api/classes` · Standard set: `STD-MUT`
- **Access:** instructor.
- **FR:** FR-CLS-01, FR-CLS-02, FR-CLS-09.
- **Request:** `{ name, description?, section?, subject?, room?, attestation: { confirmed: true } }`. `attestation.confirmed` must be `true` (FR-CLS-09). The name is 1 to 120 characters.
- **Response:** `201` `ClassSummary` including `joinCode` and `joinLink`.
- **Errors:** `VALIDATION`, `RATE_LIMITED` (20 per hour).
- **Effects:** generates a join code from the 32-character alphabet (Backend Schema §4.7). On a collision, it retries up to five times (six tries in all). Sets `attested_at`.
- **Test:** `class.spec`.

#### CLS-03 · Get class
`GET /api/classes/{classId}`
- **Access:** owning instructor; or an enrolled student (`ACTIVE` gets the full view; `PENDING` gets `403 ENROLLMENT_PENDING`; `DECLINED` and `REMOVED` get `404`).
- **FR:** FR-CLS-01, FR-CLS-07, FR-CLS-08.
- **Response:** `200` `ClassSummary`. For instructors, includes `counts`.
- **Errors:** `NOT_FOUND`, `ENROLLMENT_PENDING` (details: `{ className }` only).
- **Test:** `class.spec`.

#### CLS-04 · Edit class details
`PATCH /api/classes/{classId}` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-CLS-10.
- **Request:** any of `{ name, description, section, subject, room }`, with the limits of CLS-02. A field left out is unchanged, and a blank optional field is cleared. The name cannot be blank. Any other field, such as `joinCode`, is `VALIDATION`.
- **Response:** `200` `ClassSummary`.
- **Errors:** `NOT_FOUND`, `CLASS_ARCHIVED`, `VALIDATION`.
- **Effects:** the code and members are not affected (FR-CLS-10). An archived class is read-only, so it answers `CLASS_ARCHIVED` until it is restored.
- **Test:** `class.spec`.

#### CLS-05 · Archive class
`POST /api/classes/{classId}/archive` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor; the Super Admin uses ADM-07.
- **FR:** FR-CLS-06.
- **Response:** `200` `ClassSummary` with `status: ARCHIVED`. Archiving an archived class returns `200` with the same body (idempotent, A11).
- **Effects:** the class becomes read-only for everyone: the approval switch and the member routes (PPL-02, PPL-03) answer `CLASS_ARCHIVED`, and its join code reads as invalid. Archiving again does not move `archived_at`. The review queue excludes its items (Backend Schema open question 3). Students keep read access (FR-CLS-06).
- **Test:** `class.spec`.

#### CLS-06 · Restore class
`POST /api/classes/{classId}/restore` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-CLS-06.
- **Response:** `200` `ClassSummary` with `status: ACTIVE`. Idempotent.
- **Effects:** writes are allowed again. Restore clears `archived_at` and `retention_notice_at`, and archiving again starts a new 12-month clock. A retention notice already sent stays sent.
- **Test:** `class.spec`.

#### CLS-07 · Delete class
`DELETE /api/classes/{classId}` · Standard set: `STD-MUT`
- **Access:** owning instructor; the Super Admin uses ADM-08.
- **FR:** FR-CLS-11, D12.
- **Request:** `{ confirmation }`. The value must equal the class name exactly (case-sensitive, trimmed).
- **Response:** `204`.
- **Errors:** `CONFIRMATION_MISMATCH`. An archived class can be deleted, so there is no `CLASS_ARCHIVED`.
- **Effects:** deletes the class and everything in it in one transaction, and writes the storage outbox (Backend Schema §10.2). Approved students get `CLASS_DELETED`, which opens their class list (`/classes`), because the class is gone. The response does not wait for storage cleanup.
- **Concurrency:** the class row is locked. A grading job for a deleted submission finds nothing and ends without a write.
- **Test:** `class.spec` (typed confirmation, cascade).

#### CLS-08 · Regenerate join code
`POST /api/classes/{classId}/code/regenerate` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-CLS-04.
- **Response:** `200` `ClassSummary` with the new `joinCode`, `joinLink`, and `joinCodeActive: true`.
- **Errors:** `NOT_FOUND`, `CLASS_ARCHIVED` (an archived class is read-only, FR-CLS-06).
- **Effects:** the old code stops working at once (it returns `INVALID_JOIN_CODE`). Members are unaffected. This is also how a disabled code is enabled again.
- **Concurrency:** class row lock; collision retry as in CLS-02.
- **Test:** `class.spec`.

#### CLS-09 · Disable join code
`POST /api/classes/{classId}/code/disable` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-CLS-04.
- **Response:** `200` `ClassSummary` with `joinCodeActive: false`. Idempotent.
- **Errors:** `NOT_FOUND`, `CLASS_ARCHIVED` (an archived class is read-only, FR-CLS-06).
- **Effects:** the code reads as invalid for everyone (no class information is shown). The code stays on the class, so `joinCode` and `joinLink` do not change. Members are unaffected.
- **Test:** `class.spec`.

#### CLS-10 · Change join approval
`PATCH /api/classes/{classId}/settings` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-CLS-07.
- **Request:** `{ requireApproval: boolean }`.
- **Response:** `200` `{ requireApproval, pendingCount }`. `pendingCount` tells the client whether to offer "Approve all pending" after the toggle is turned off (App Flow §4, step 4).
- **Effects:** turning it on never changes existing active students. Turning it off never auto-approves pending students (Backend Schema §6.2).
- **Errors:** `CLASS_ARCHIVED`.
- **Test:** `class.spec`.

#### CLS-11 · Preview class deletion
`GET /api/classes/{classId}/deletion-impact`
- **Access:** owning instructor; the Super Admin uses ADM-08 (metadata).
- **FR:** FR-CLS-11.
- **Response:** `200` `{ students, approvedStudents, pendingStudents, assignments, submissions, files, gradebookCsvPath }`. `students` counts every enrollment, whatever its state. `gradebookCsvPath` points to TRK-04 so the instructor can download before deleting; it is left out until that download exists.
- **Effects:** none. The counts are recomputed when the delete is confirmed.
- **Test:** `class.spec`.

### B.5 Joining and enrollment (6 endpoints)

#### JOIN-01 · Join a class by code
`POST /api/join` · Standard set: `STD-MUT`
- **Access:** student.
- **FR:** FR-CLS-03, FR-CLS-07.
- **Request:** `{ code }`. The code is trimmed and uppercased before lookup, so entry is case-insensitive.
- **Response:**
  - `201` `{ classId, className, status }` for a new enrollment. `status` is `ACTIVE` (approval off) or `PENDING` (approval on).
  - `200` with the same body when the student is already `ACTIVE`, `PENDING`, or `DECLINED`. Joining twice does nothing new (FR-CLS-03). A declined student stays declined (App Flow §6 step 1).
- **Errors:**
  - `INVALID_JOIN_CODE` (404) for an unknown, disabled, regenerated, or archived code. All four are identical.
  - `JOIN_BLOCKED` (403) for a removed student. The copy is "You can't join this class right now. Contact the instructor."
  - `INSTRUCTOR_CANNOT_JOIN` (403) for an instructor account.
  - `RATE_LIMITED` (10 invalid attempts per hour per user; `INVALID_JOIN_CODE` counts).
- **Effects:** approval on creates a `JOIN_REQUEST_RECEIVED` notification for the instructor (digest). Approval off creates no notification.
- **Concurrency:** the `(class_id, student_id)` unique key handles two simultaneous joins; the loser reads the existing row and returns `200`.
- **Test:** `class.spec` (join approval on and off, invalid codes).

#### JOIN-02 · Preview a join link
`GET /api/join/{code}`
- **Access:** anonymous or signed in. Instructors get `INSTRUCTOR_CANNOT_JOIN` when signed in as one.
- **FR:** FR-AUTH-08, App Flow §Screens (join-link landing).
- **Response:** `200` `{ className, instructorFirstName, requireApproval }`. No student data, no assignments, no counts.
- **Errors:** `INVALID_JOIN_CODE` (404) for any code that does not work; `INSTRUCTOR_CANNOT_JOIN` (403); `RATE_LIMITED` (30 failed tries per hour per IP, because a valid code reveals the class name; a good code is not counted, so a class opening the link on one network is not blocked). A code of the wrong length is `INVALID_JOIN_CODE` too, not `VALIDATION`. The code is trimmed and uppercased, as in JOIN-01.
- **Effects:** none. `Cache-Control: no-store`.
- **Test:** `auth.spec` (join link while signed out).

#### JOIN-03 · List my enrollments
`GET /api/me/enrollments?cursor&limit`
- **Access:** student.
- **FR:** FR-CLS-08.
- **Response:** `200` `Page<{ classId, className, status, instructorName, archived, joinedAt }>`. `REMOVED` rows are omitted (App Flow §3). Newest joined first. `instructorName` is the first name and last initial.
- **Errors:** STD-AUTH, `VALIDATION`.
- **Test:** `class.spec` (Enrolled list).

#### PPL-01 · List people in a class
`GET /api/classes/{classId}/people?status=ACTIVE|PENDING|DECLINED|REMOVED&cursor&limit`
- **Access:** owning instructor.
- **FR:** FR-CLS-05, FR-CLS-07, FR-GB-01 (roster for the gradebook).
- **Response:** `200` `{ counts: { approved, pending, declined, removed }, items: EnrollmentView[], nextCursor }`. The `counts` object is always complete, whatever the filter. Items are in join order, oldest first, so the longest-waiting request is at the top.
- **Errors:** `NOT_FOUND` for students and other instructors.
- **Effects:** none. `email` appears on each item (PRD §11: instructors see name and email only).
- **Test:** `class.spec` (People view).

#### PPL-02 · Change an enrollment decision
`POST /api/enrollments/{enrollmentId}/decision` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-CLS-05, FR-CLS-07, FR-CLS-03.
- **Request:** `{ action: "APPROVE" | "DECLINE" | "REVERSE" | "REMOVE" }`.
- **Allowed transitions** (Backend Schema §6.2):

  | Action | From | To |
  |---|---|---|
  | `APPROVE` | `PENDING` | `ACTIVE` |
  | `DECLINE` | `PENDING` | `DECLINED` |
  | `REVERSE` | `DECLINED` | `ACTIVE` |
  | `REVERSE` | `REMOVED` | `ACTIVE` (reinstate) |
  | `REMOVE` | `ACTIVE` | `REMOVED` |

- **Response:** `200` `EnrollmentView`.
- **Errors:** `CONFLICT` (409) with `details.currentState` when the transition is not allowed; `CLASS_ARCHIVED` (409) when the class is archived (it is read-only, FR-CLS-06).
- **Effects:**
  - `APPROVE` and `DECLINE` create `JOIN_DECIDED` for the student (with the class name).
  - `REMOVE` creates no notification (the PRD matrix has none). The student's submissions leave the queue and tracker because the status is no longer `ACTIVE` (derived).
  - `REVERSE` to `ACTIVE` returns the submissions to the queue and tracker.
- **Concurrency:** the enrollment row is locked; two decisions on the same row serialize, and the second sees the new state and returns `CONFLICT`.
- **Test:** `class.spec` (approve, decline, remove, reinstate).

#### PPL-03 · Approve all pending
`POST /api/classes/{classId}/approve-pending` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-CLS-07.
- **Response:** `200` `{ approvedCount }`.
- **Errors:** `CONFLICT` when join approval is still on (the action is only for after it is turned off, Backend Schema §6.2); `CLASS_ARCHIVED` (409) when the class is archived.
- **Effects:** every pending row becomes `ACTIVE`, and each student gets `JOIN_DECIDED`. Runs in one transaction; for large classes it is processed in batches of 200 with the same final result.
- **Test:** `class.spec`.
### B.6 Assignments and labels (12 endpoints)

Drafts need a few fields before the wizard has collected them. The rule for all draft writes: a draft may have an empty `criteriaText` and a placeholder `dueAt` (seven days ahead of creation). Publishing (ASG-06) requires a non-empty `criteriaText` and a real `dueAt`. Drafts are never visible to students (FR-ASG-03), so placeholders are never shown to them.

#### ASG-01 · List assignments
`GET /api/classes/{classId}/assignments?status=&labelId=&cursor=&limit=&sort=dueAt`
- **Access:** owning instructor (all statuses, including drafts), or an `ACTIVE` student (published only).
- **FR:** FR-ASG-03, FR-ASG-08, FR-GB-06, FR-SUB-09, FR-AUTH-08.
- **Response:** `200` `Page<AssignmentSummary>`. Students get `my` on each row. Default order is nearest due date first (App Flow §6 step 2). A student is always limited to published assignments, so a `status` filter that leaves them out gives an empty page.
- **Errors:** `ENROLLMENT_PENDING` (403), `NOT_FOUND`, `VALIDATION` (unknown filter), STD-AUTH.
- **Test:** `assignment.spec`, `grading.spec` (student row chips).

#### ASG-02 · Create assignment (draft)
`POST /api/classes/{classId}/assignments` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-ASG-01, FR-ASG-03, FR-ASG-10, FR-ASG-11, F15.
- **Request:** `AssignmentInput`. Only `title` is required for a draft. Other fields take defaults: `maxResubmissions` 3, `acceptLate` true, `timezone` from the request or UTC, `scoringFormat` `POINTS`, `maxScore` 100.
- **Response:** `201` `AssignmentDetail` with `status: DRAFT`.
- **Errors:** `CLASS_ARCHIVED`, `VALIDATION`.
- **Effects:** none beyond the row. The wizard calls this once after step 1, then uses ASG-04 for each later save (F15).
- **Test:** `assignment.spec` (autosave).

#### ASG-03 · Get assignment
`GET /api/assignments/{assignmentId}`
- **Access:** owning instructor, or an `ACTIVE` student for a published assignment.
- **FR:** FR-ASG-01 to FR-ASG-11 (read side), FR-GB-04.
- **Response:** `200` `AssignmentDetail`.
  - Instructors also get `counts` (`turnedIn`, `late`, `missing`, `notYetDue`, `needsReview`, and `submissions` as the total, used for the deletion confirmation) and every reference file.
  - Students get `my` and only the reference files marked visible.
- **Errors:** `NOT_FOUND` (students on drafts and archived assignments), `ENROLLMENT_PENDING`. The class is checked first: a pending student gets `ENROLLMENT_PENDING` for any assignment that exists in it, a draft included, and learns nothing else.
- **Test:** `assignment.spec`.

#### ASG-04 · Edit assignment
`PATCH /api/assignments/{assignmentId}` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-ASG-02, FR-ASG-04, FR-ASG-05, FR-ASG-06, FR-ASG-08, FR-ASG-09, FR-ASG-10, FR-ASG-11.
- **Request:** a partial `AssignmentInput`. If `criteriaText` changes, `impactToken` is required (A6). Changing `scoringFormat` is allowed only before any submission exists (an upload that is still open is not a submission until it is finalized).
- **Response:** `200` `AssignmentDetail`.
- **Errors:**
  - `CONFIRMATION_REQUIRED` (422) when criteria change without a token.
  - `CONFIRMATION_STALE` (409) when the token's counts no longer match. `details` carries the new counts.
  - `FORMAT_LOCKED` (409) when the scoring format changes after a submission exists (PRD A13).
  - `CLASS_ARCHIVED` (409).
  - `VALIDATION`.
- **Effects:**
  - Criteria change: increments `criteriaVersion`, sets `regradeNotBefore` (two minutes, TRD §10.5), and enqueues the debounced re-grade. Unapproved submissions go back to "Grading in progress" (App Flow §6 step 11).
  - Due date change: recomputes Late for everyone (derived) and sends `DUE_DATE_CHANGED` to approved students who have not already approved on it (PRD §10).
  - Title, instructions, label, limits, and late policy: no re-grade, no notification.
- **Concurrency:** the assignment row is locked. Two criteria edits in quick succession merge into one debounced run (App Flow §5.2).
- **Test:** `assignment.spec`, `review.spec` (criteria change flow).

#### ASG-05 · Preview criteria impact
`POST /api/assignments/{assignmentId}/criteria-impact`
- **Access:** owning instructor.
- **FR:** FR-ASG-04, PRD A3.
- **Request:** `{ changesCriteria: boolean, changesReferenceFiles: boolean }`. Describes the change the instructor is about to save.
- **Response:** `200` `CriteriaImpact`. If neither flag is true, the counts are zero and the token is still issued, so the client can always send one.
- **Effects:** none. This endpoint changes no data; POST is used because the body describes a proposed change.
- **Test:** `review.spec` (confirmation count matches the tracker).

#### ASG-06 · Publish assignment
`POST /api/assignments/{assignmentId}/publish` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-ASG-03, F16.
- **Request:** no body.
- **Response:** `200` `AssignmentDetail` with `status: PUBLISHED` and `warnings`:
  - `DUE_IN_PAST`: every submission will be Late (warning only, F16).
  - `NO_VALID_KEY`: no connected key, so submissions go to Needs manual review (PRD A8).
  Publishing a published assignment returns `200` (idempotent).
- **Errors:** `VALIDATION` (for example, empty `criteriaText`; `fields.criteriaText` says "Add grading criteria before publishing"), `CLASS_ARCHIVED`.
- **Effects:** sets `published_at`. Approved students get `ASSIGNMENT_PUBLISHED` (PRD §10).
- **Test:** `assignment.spec` (publish warnings).

#### ASG-07 · Archive assignment
`POST /api/assignments/{assignmentId}/archive` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-ASG-09.
- **Response:** `200` `AssignmentDetail` with `status: ARCHIVED`. Idempotent.
- **Effects:** hidden from students; submissions and grades kept (restorable).
- **Test:** `assignment.spec`.

#### ASG-08 · Restore assignment
`POST /api/assignments/{assignmentId}/restore` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-ASG-09.
- **Response:** `200` `AssignmentDetail` with `status: PUBLISHED`. Idempotent.
- **Test:** `assignment.spec`.

#### ASG-09 · Delete assignment
`DELETE /api/assignments/{assignmentId}` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-ASG-09.
- **Request:** `{ confirmation }`. Must equal the assignment title exactly. The confirmation dialog shows `counts.submissions` from ASG-03 first.
- **Response:** `204`.
- **Errors:** `CONFIRMATION_MISMATCH`, `CLASS_ARCHIVED`.
- **Effects:** deletes the assignment and its submissions, grades, and files (Backend Schema §10.5). Storage cleanup runs from the outbox.
- **Test:** `assignment.spec`.

#### ASG-10 · List labels
`GET /api/classes/{classId}/labels`
- **Access:** owning instructor. Students get `NOT_FOUND`; they see label names on assignment rows only.
- **FR:** FR-ASG-08, FR-GB-06.
- **Response:** `200` `{ items: [{ id, name, assignmentCount }] }`.
- **Test:** `assignment.spec`.

#### ASG-11 · Create label
`POST /api/classes/{classId}/labels` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-ASG-08.
- **Request:** `{ name }`, 1 to 60 characters, trimmed, case-insensitive uniqueness within the class.
- **Response:** `201` `{ id, name, assignmentCount: 0 }`.
- **Errors:** `LABEL_EXISTS`, `VALIDATION`, `CLASS_ARCHIVED`.
- **Test:** `assignment.spec`.

#### ASG-12 · Delete label
`DELETE /api/labels/{labelId}` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor of the label's class.
- **FR:** FR-ASG-08.
- **Response:** `204`.
- **Effects:** the label is removed; its assignments are kept and become unlabeled (`label_id` set to null).
- **Test:** `assignment.spec`.

### B.7 Reference files (4 endpoints)

Reference files are part of the criteria (FR-ASG-07). Adding, replacing, or removing one is a criteria change and needs an `impactToken` (A6). Changing only its visibility is not.

#### REF-01 · Add a reference file
`POST /api/assignments/{assignmentId}/reference-files` · Standard set: `STD-UPLOAD`
- **Access:** owning instructor.
- **FR:** FR-ASG-07, FR-SUB-02.
- **Request:** `multipart/form-data` with:
  - `file`: one PDF, JPEG, or PNG (10 MiB maximum, checked by content).
  - `impactToken`: required on a published assignment, and ignored on a draft (A6).
- **Response:** `201` `ReferenceFileView`. The ordinal is the next free one from 1 to 3. The file is stored at `reference/<classId>/<assignmentId>/<uuid>.<ext>` (TRD §9.3).
- **Errors:** `FILE_LIMIT` with `details.limit: "reference-count"` when three files already exist (or `"pages"` for a PDF of more than 20); `CONFIRMATION_REQUIRED`, `CONFIRMATION_STALE`, `FILE_TYPE`, `FILE_TOO_LARGE`, `FILE_ERROR`; `VALIDATION` when the form has no `file` field; `CLASS_ARCHIVED`; `CONFLICT` for an archived assignment.
- **Effects:** same as a criteria change in ASG-04 (re-grade debounce).
- **Test:** `assignment.spec`, `upload.spec` (reference file rules).

#### REF-02 · Change reference file visibility
`PATCH /api/reference-files/{fileId}` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-ASG-07, D4.
- **Request:** `{ visibleToStudents: boolean }`.
- **Response:** `200` `ReferenceFileView`.
- **Effects:** not a criteria change, so no re-grade and no token.
- **Test:** `assignment.spec`.

#### REF-03 · Remove a reference file
`DELETE /api/reference-files/{fileId}` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-ASG-07.
- **Request:** header `X-Impact-Token` (A6). Required on a published assignment, not on a draft.
- **Response:** `204`.
- **Errors:** `CONFIRMATION_REQUIRED`, `CONFIRMATION_STALE`.
- **Effects:** removes the row and writes the storage outbox entry. Re-grades as a criteria change.
- **Test:** `assignment.spec`.

#### REF-04 · Get a reference file link
`GET /api/reference-files/{fileId}/url`
- **Access:** owning instructor; or an `ACTIVE` student when `visibleToStudents` is true.
- **FR:** FR-ASG-07, PRD §11.
- **Response:** `200` `{ url, expiresAt }`. The URL lasts five minutes (TRD §9.3).
- **Errors:** `NOT_FOUND` (including a hidden file for a student).
- **Test:** `upload.spec`.
### B.8 Student submission and files (7 endpoints)

Upload runs in three steps (A7): open a version, send each file, finalize. Only the finalize step queues grading, so a submission never exists while files are still arriving.

#### SUB-01 · Get my submission
`GET /api/assignments/{assignmentId}/me`
- **Access:** `ACTIVE` student in the class, for a published assignment.
- **FR:** FR-SUB-06, FR-SUB-09, FR-AI-03, FR-AI-07, FR-SUB-04, FR-REV-09.
- **Response:** `200` `StudentSubmission`. `state` uses the student `DisplayState` (A5); `grade` is present for `AI_GENERATED` and `INSTRUCTOR_APPROVED` and null otherwise (it carries the score, the feedback and the chip only, never the model, the prompt version or a cause), and `grade.letter` is null until the letter scale exists (AI-05); `instructorComment` only when approved; `attemptsLeft` is `null` with `unlimited: true` for Unlimited. `state` is `UPLOADING` only while an upload is open and no version is stored yet. Once a version is stored the state stays the submission's, and an upload opened for a resubmission is reported in `draftVersion`. While an upload is open, `draftVersion.files` lists the files stored in it, so a student who reloads or comes back sees them again (SUB-04).
- **Errors:** `NOT_FOUND`, `ENROLLMENT_PENDING`, STD-AUTH.
- **Effects:** none.
- **Polling:** every 5 seconds while `state` is `GRADING` or `UPLOADING` (A13).
- **Test:** `grading.spec`, `attempts.spec`.

#### SUB-02 · Open an upload version
`POST /api/assignments/{assignmentId}/versions` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** `ACTIVE` student, published assignment.
- **FR:** FR-SUB-03, FR-SUB-05, FR-SUB-07, FR-SUB-09, FR-ASG-11, FR-SUB-10.
- **Request:** no body.
- **Response:**
  - `201` `VersionView` when a new version is opened.
  - `200` with the existing `VersionView` when one is already `UPLOADING` (idempotent; the client resumes it).
- **Errors:**
  - `ATTEMPTS_EXHAUSTED` (409) when a resubmission is needed and `attemptsLeft` is 0.
  - `LATE_CLOSED` (409) when the due date has passed, late is closed, and `lateAllowed` is false. It is checked before an upload that is already open is returned, and for a resubmission as well as a first submission. Sending a file (SUB-03) does not check it; finalize does.
  - `LOCKED_APPROVED` (409) when the submission is approved.
  - `CLASS_ARCHIVED` (409).
  - `NOT_FOUND`, `ENROLLMENT_PENDING`.
- **Effects:** creates the `submissions` row (state null) if none exists. Does not consume an attempt; that happens at finalize (A7).
- **Concurrency:** the submission row is locked; the partial unique index allows one `UPLOADING` version per submission.
- **Limit:** 60 per minute (uploads).
- **Test:** `upload.spec`, `attempts.spec`, `late.spec`.

#### SUB-03 · Send one file
`PUT /api/versions/{versionId}/files/{clientFileId}`
- **Access:** the student who owns the version.
- **FR:** FR-SUB-01, FR-SUB-02, FR-SUB-03, FR-SUB-08, FR-AI-05, PRD A12.
- **Request:** raw file bytes. Headers: `Content-Type` (the file's MIME type), `X-File-Name` (URL-encoded display name, at most 255 bytes), `Content-Length` (required; the server rejects chunked bodies over 10 MiB without reading past the limit). A missing or unreadable `X-File-Name` becomes "file", control characters are removed, and a longer name is cut to 255 bytes. A declared `Content-Length` over 10 MiB is refused with `FILE_TOO_LARGE` before the body is read, and the connection is closed.
- **Response:**
  - `201` `FileView` for a new file. `200` when `clientFileId` already exists and is replaced (idempotent).
  - A refused file stores nothing: no row and no object. The answer is the error, and the student sends another file.
- **Errors:**
  - `FILE_TYPE` (415): the content is not PDF, JPEG, PNG, or HEIC (checked by magic bytes, not the extension; HEIC is converted to JPEG, PRD A12).
  - `FILE_TOO_LARGE` (413): over 10 MiB while streaming.
  - `FILE_LIMIT` (422): `details.limit` is `files` (more than 10 in the version), `total-size` (the version's files would add up to more than 15 MiB; a file being replaced is not counted twice), or `pages` (a PDF of more than 20).
  - `UPLOAD_NOT_OPEN` (409): the version is not `UPLOADING`.
  - `UNSUPPORTED_MEDIA_TYPE` (415): the request is not a file upload.
  - `FILE_ERROR` (422): a PDF that is password-protected or cannot be read. `details.failureCode` is `PASSWORD` or `CORRUPT`.
- **Effects:** streams to a temporary file, converts HEIC, counts PDF pages (kept on the file as `pageCount`), computes SHA-256, stores the object under a server-generated path (TRD §9.1), writes the `submission_files` row. A replaced file's old object goes to the outbox.
- **Concurrency:** `(version_id, client_file_id)` is unique; the same ID twice is a replace, not a duplicate.
- **Limit:** 60 per minute per user.
- **Test:** `upload.spec` (every fixture in the TRD §16.2a table).

#### SUB-04 · Remove one file from an open upload
`DELETE /api/versions/{versionId}/files/{clientFileId}` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** the owning student.
- **FR:** FR-SUB-03.
- **Response:** `204`. Removing a file that is already gone, or that was never stored, also returns `204`.
- **Errors:** `UPLOAD_NOT_OPEN` (409) when the version is not `UPLOADING`; `NOT_FOUND` for anyone but the owning student (a removed student, an instructor and a missing version included). It does not check `CLASS_ARCHIVED`, as SUB-03 does not.
- **Effects:** deletes the row; the object goes to the outbox. The place the file held is free again for the next file sent.
- **Concurrency:** the submission row is locked, as in finalize, so a removal and a finalize at the same moment run one after the other.
- **Limit:** none of its own (the general 120 per minute).
- **Test:** `upload.spec` (reorder and remove).

#### SUB-05 · Finalize the upload
`POST /api/versions/{versionId}/finalize` · Standard set: `STD-MUT`
- **Access:** the owning student.
- **FR:** FR-SUB-03, FR-SUB-04, FR-SUB-05, FR-SUB-07, FR-AI-02, FR-SUB-09.
- **Request:** `{ expectedFileIds: string[] }` (1 to 10 `clientFileId`s, in the order shown to the student). The server does not trust the list alone; it checks the stored rows. The list is the final set of files: a file stored in the version but not in the list is dropped, and the files take the list's order as their `ordinal`.
- **Response:** `200` `StudentSubmission` with `state: "GRADING"` (display `GRADING`, database `QUEUED`).
- **Errors:**
  - `UPLOAD_INCOMPLETE` (409): `details.missing` lists the `clientFileId`s that are absent or `FAILED`.
  - `UPLOAD_NOT_OPEN` (409): the version was replaced by a newer one. A second finalize of the version that is already the submission's current version is not an error: it returns `200` with the same body and changes nothing.
  - `ATTEMPTS_EXHAUSTED`, `LATE_CLOSED`, `LOCKED_APPROVED` (409), re-checked inside the lock.
  - `CLASS_ARCHIVED` (409).
  - `FILE_LIMIT` (422): `details.limit` is `total-size` (the files add up to more than 15 MiB) or `grading-budget` (the files plus the assignment's reference files add up to more than 15 MiB, A7).
- **Effects, in one transaction:**
  - Files in the version that are not in `expectedFileIds` are deleted and their objects go to the storage outbox.
  - The version becomes `STORED`, `stored_at` is set, and `current_version_id` points to it.
  - `first_submitted_at` is set on the first version; `latest_submitted_at` is always set.
  - `resubmissions_used` increases by 1 for every version after the first (FR-SUB-05).
  - The previous version becomes `REPLACED`. Its `submission_files` rows are deleted and its objects go to the storage outbox (Backend Schema §10.2a).
  - `state` becomes `QUEUED`, and the grading job is enqueued after commit (mode `first` or `resubmit`).
- **Concurrency:** the submission row is locked. A second finalize of the same version returns the first result. A resubmission that races an approval is decided by commit order (PRD §13).
- **Test:** `upload.spec`, `grading.spec`, `attempts.spec`.

#### SUB-06 · Cancel an open upload
`DELETE /api/versions/{versionId}` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** the owning student.
- **FR:** FR-SUB-03.
- **Response:** `204`.
- **Errors:** `UPLOAD_NOT_OPEN` (409) for a stored version.
- **Effects:** deletes the open version and its files; objects go to the outbox. A submission with no stored version returns to `NOT_SUBMITTED`. It runs on the locked submission row, so a cancel and a finalize at the same moment run one after the other, and a version that is stored or replaced is never deleted. Cancelling a resubmission leaves the current version, its files, its grade and the attempts used alone. A cancel sent again finds no version and answers `NOT_FOUND`.
- **Test:** `upload.spec`.

#### FILE-01 · Get a file link
`GET /api/files/{fileId}/url`
- **Access:** the student who owns a submission file; the owning instructor for submission and announcement files in their class; an `ACTIVE` class member for announcement files. Reference files use REF-04.
- **FR:** FR-REV-02, FR-SUB-08, FR-ANN-02, PRD §11.
- **Response:** `200` `{ url, expiresAt }`. The URL lasts five minutes (TRD §9.3). Every call is authorized again; a link is never reused past its expiry.
- **Errors:** `NOT_FOUND` for every inaccessible file, a `FAILED` file (no object), and a file that no longer exists.
- **Test:** `upload.spec`, `review.spec`, `announcements.spec`.

### B.9 Instructor submission actions (11 endpoints)

Every endpoint in this group locks the submission row (or the assignment, for the student-keyed endpoints) and writes a `review_actions` row where the table says so.

#### INS-01 · Get the Submission screen
`GET /api/submissions/{submissionId}`
- **Access:** owning instructor.
- **FR:** FR-REV-02, FR-REV-03, FR-REV-10, FR-SUB-09, FR-GB-04.
- **Response:** `200` `InstructorSubmission`.
- **Errors:** `NOT_FOUND`.
- **Polling:** every 5 seconds while a grade or re-grade is queued (A13).
- **Test:** `review.spec`.

#### INS-02 · Approve
`POST /api/submissions/{submissionId}/approve` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-REV-03, FR-REV-04, FR-REV-08, FR-REV-09.
- **Request:** `{ score?: number, feedback?: string (up to 4,000 characters), instructorComment?: string (up to 2,000) }`. Omitted fields keep the AI value. A score is checked against 0 to `maxScore` and, for `LETTER_NUMERIC`, the letter is derived from the scale (PRD §9.4).
- **Response:** `200` `InstructorSubmission` with `state: "INSTRUCTOR_APPROVED"`.
- **Errors:**
  - `VALIDATION` (400) with `fields.score` for an out-of-range score.
  - `CONFLICT` (409, `details.currentState`) when the state is `QUEUED` or `GRADING`, or has no grade.
  - `ALREADY_APPROVED` (409).
- **Effects:**
  - If the score or feedback changed, writes an `INSTRUCTOR` grade as `ACTIVE`, supersedes the AI grade, and sets `approved_at`.
  - `review_actions` gets `APPROVE` with `aiScore`, `finalScore`, and `editClass`. The server computes `editClass`: `edit_free`, `score_only`, `feedback_only`, or `both`. The client never sends it.
  - Student gets `GRADE_APPROVED`, with a note when the score or feedback changed (PRD §10).
- **Concurrency:** the row lock decides approve against a resubmit. Whichever commits first wins; the other returns `CONFLICT` or `LOCKED_APPROVED` (App Flow §6, step 9).
- **Test:** `review.spec` (edit, approve, edit classification).

#### INS-03 · Reopen an approved submission
`POST /api/submissions/{submissionId}/reopen` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-REV-05, FR-SUB-06.
- **Request:** `{ grantAttempts?: integer (1 to 10) }`. The UI prefills `1` when the student has none left (D8).
- **Response:** `200` `InstructorSubmission` with `state: "AI_GENERATED"` and `approvedAt: null`.
- **Errors:** `CONFLICT` (409) when the submission is not approved.
- **Effects:** clears `approved_at`. Writes `REOPEN`, and `GRANT_ATTEMPTS` when `grantAttempts` is set. The student gets `SUBMISSION_REOPENED`, and `ATTEMPTS_GRANTED` when attempts were granted. A pending re-grade (FR-REV-10) is not affected.
- **Test:** `attempts.spec`, `review.spec`.

#### INS-04 · Grant attempts to a student
`POST /api/assignments/{assignmentId}/students/{studentId}/grant-attempts` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-SUB-10(a), FR-SUB-09, D7.
- **Request:** `{ count: integer (1 to 10) }`. "Give attempt back" in the UI sends `count: 1`.
- **Response:** `200` `{ attemptsLeft, extraAttempts }`. Works without a submission row, for example before the student has submitted.
- **Errors:** `CONFLICT` (409, `details.reason: "unlimited"`) when the assignment's resubmission limit is Unlimited. `NOT_FOUND` for a student not in the class.
- **Effects:** `extraAttempts` increases by `count` (creating the row with `state` null if needed). Writes `GRANT_ATTEMPTS` with `attemptsGranted`. The student gets `ATTEMPTS_GRANTED` with the new total.
- **Concurrency:** the submission row is locked (or the assignment and student pair, when there is no row).
- **Test:** `attempts.spec`.

#### INS-05 · Allow a late submission for a student
`POST /api/assignments/{assignmentId}/students/{studentId}/allow-late` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-SUB-10(b), FR-ASG-11, PRD A11.
- **Request:** no body.
- **Response:** `200` `{ lateAllowed: true }`. Idempotent.
- **Effects:** sets `late_allowed`, creating the submission row (state null) if needed. Writes `ALLOW_LATE`. The student gets `LATE_ALLOWED`, which unlocks their upload (PRD A11).
- **Errors:** `CLASS_ARCHIVED`, `NOT_FOUND`.
- **Test:** `late.spec`.

#### INS-06 · Re-run AI grading for a manual-review item
`POST /api/submissions/{submissionId}/rerun` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-REV-06, FR-KEY-05.
- **Request:** no body.
- **Response:** `202` `{ state: "GRADING" }`.
- **Errors:**
  - `CONFLICT` (409) unless the state is `NEEDS_MANUAL_REVIEW`.
  - `KEY_MISSING` (422) when no connected key exists. The button's copy says "Connect your Gemini key first."
  - `CLASS_ARCHIVED` (409).
- **Effects:** enqueues `grade.submission` with mode `rerun`. No student attempt is consumed (FR-SUB-05).
- **Test:** `grading.spec` (re-run prompt).

#### INS-07 · Re-grade an approved submission
`POST /api/submissions/{submissionId}/regrade` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-REV-10, FR-ASG-04.
- **Request:** no body.
- **Response:** `202` `{ state: "INSTRUCTOR_APPROVED", pendingRegrade: true }`. The student's approved grade stays visible (D9).
- **Errors:**
  - `NOT_REGRADABLE` (409) when the submission is not approved (unapproved items use the criteria re-grade or INS-06).
  - `GRADE_PENDING_EXISTS` (409) when a pending re-grade already exists.
  - `KEY_MISSING` (422).
- **Effects:** enqueues `grade.submission` with mode `regrade_approved`. The result is stored as `PENDING_REVIEW`. No notification to the instructor (PRD D17); the result appears in the review queue and its badge count (REV-02).
- **Test:** `review.spec` (approved re-grade flow).

#### INS-08 · Approve the pending re-grade
`POST /api/submissions/{submissionId}/regrade/approve` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-REV-10.
- **Request:** the same optional edits as INS-02 (`score`, `feedback`, `instructorComment`) applied to the pending result.
- **Response:** `200` `InstructorSubmission`, with `activeGrade` now the new result and `pendingRegrade: null`.
- **Errors:** `CONFLICT` (409) when no pending result exists; `VALIDATION`.
- **Effects:** runs the swap in Backend Schema §7.2: the old active grade becomes `SUPERSEDED`, the pending grade becomes `ACTIVE`, `active_grade_id` moves. Writes `REGRADE_APPROVE`. The student gets `REGRADE_COMPLETE`.
- **Test:** `review.spec`.

#### INS-09 · Keep the previous grade
`POST /api/submissions/{submissionId}/regrade/keep-previous` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-REV-10.
- **Response:** `200` `InstructorSubmission` with `pendingRegrade: null`.
- **Errors:** `CONFLICT` (409) when no pending result exists.
- **Effects:** the pending result becomes `DISCARDED`. Writes `REGRADE_KEEP_PREVIOUS`. The student is not notified (nothing changed for them).
- **Test:** `review.spec`.

#### INS-10 · Save the instructor comment
`POST /api/submissions/{submissionId}/comment` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-REV-09.
- **Request:** `{ comment: string (up to 2,000) | null }`. `null` clears it.
- **Response:** `200` `InstructorSubmission`.
- **Effects:** stored separately from the AI feedback. Never sent to Gemini. Visible to the student when approved (App Flow §6 step 9).
- **Errors:** `CLASS_ARCHIVED`, `VALIDATION`.
- **Test:** `review.spec`.

#### INS-11 · Enter a manual grade and approve
`POST /api/submissions/{submissionId}/manual-grade` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-REV-06, FR-REV-03.
- **Request:** `{ score: number, feedback: string (1 to 4,000 characters), instructorComment?: string }`. The score is checked against the assignment's range; a letter is derived from the scale.
- **Response:** `200` `InstructorSubmission` with `state: "INSTRUCTOR_APPROVED"`.
- **Errors:** `CONFLICT` (409) unless the state is `NEEDS_MANUAL_REVIEW`; `VALIDATION`.
- **Effects:** writes an `INSTRUCTOR` grade as `ACTIVE`, sets `approved_at`, and writes `MANUAL_GRADE` and `APPROVE`. The student gets `GRADE_APPROVED`.
- **Note:** a manual grade is entered and approved in one step, so no unapproved instructor grade ever exists (TRD §10.8).
- **Test:** `review.spec` (manual path).

### B.10 Bulk actions and progress (4 endpoints)

Bulk actions take at most 200 submissions per request. Larger sets are split by the client into batches of 200, each with its own confirmation.

#### BLK-01 · Bulk approve unedited AI results
`POST /api/assignments/{assignmentId}/bulk-approve` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-REV-07.
- **Request:** `{ submissionIds: uuid[] (1 to 200), confirmedCount: integer }`. `confirmedCount` must equal `submissionIds.length`, so the request matches the confirmation the instructor saw.
- **Response:** `200` `{ approvedCount, skipped: [{ submissionId, reason }] }`. `reason` is `EDITED` (an instructor grade already exists), `NOT_AI_GENERATED`, or `NOT_OWNED`.
- **Errors:** `CONFIRMATION_MISMATCH` (400) when `confirmedCount` differs; `VALIDATION`; `RATE_LIMITED` (10 per minute).
- **Effects:** approves each eligible item in its own transaction (edit classification `edit_free`), so one failure does not undo the others. Each approval sends `GRADE_APPROVED`.
- **Test:** `review.spec` (bulk approve confirmation).

#### BLK-02 · Re-run AI for manual-review items
`POST /api/assignments/{assignmentId}/bulk-rerun` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-REV-06, FR-KEY-05, PRD A8.
- **Request:** `{ scope: "NEEDS_MANUAL_REVIEW" }` or `{ submissionIds: uuid[] (1 to 200) }`.
- **Response:** `202` `Progress` (`kind: "RERUN"`, `total`, `state: "RUNNING"`).
- **Errors:** `KEY_MISSING` (422) with no connected key; `CONFLICT` (409) when no item is eligible.
- **Effects:** enqueues one `grade.submission` (mode `rerun`) per item. Jobs are paced by the instructor's key limits (TRD §10.2). No attempts are consumed. If quota runs out, the rest stop with `KEY_QUOTA` and the state becomes `PAUSED_QUOTA` (TRD §10.5).
- **Test:** `grading.spec` (re-run after the key is fixed).

#### BLK-03 · Re-grade approved submissions
`POST /api/assignments/{assignmentId}/bulk-regrade` · Standard set: `STD-MUT`
- **Access:** owning instructor.
- **FR:** FR-REV-10, FR-GB-04 ("Re-grade selected").
- **Request:** `{ scope: "CRITERIA_CHANGED" }` or `{ submissionIds: uuid[] (1 to 200) }`.
- **Response:** `202` `{ batchId, total, skipped: [{ submissionId, reason }] }`. `reason` is `NOT_APPROVED` or `PENDING_EXISTS`.
- **Errors:** `KEY_MISSING` (422); `CONFLICT` (409) when nothing is eligible.
- **Effects:** one `regrade_approved` job per item (FR-REV-10). Students keep their approved grades (D9). Progress is available from BLK-04.
- **Test:** `review.spec` (approved re-grade, bulk).

#### BLK-04 · Get progress of a batch
`GET /api/assignments/{assignmentId}/progress?batchId=`
- **Access:** owning instructor.
- **FR:** FR-ASG-04 (re-grade progress banner, App Flow §5.2).
- **Response:** `200` `Progress`. Without `batchId`, returns the newest batch for the assignment, or `{ state: "DONE", total: 0, done: 0 }`.
- **Errors:** `NOT_FOUND`.
- **Polling:** every 3 seconds while `state` is `RUNNING` (A13).
- **Test:** `review.spec` (progress banner).

### B.11 Review queue (2 endpoints)

#### REV-01 · List the review queue
`GET /api/review-queue?classId=&assignmentId=&status=AI_GENERATED|NEEDS_MANUAL_REVIEW|PENDING_REGRADE&sort=flagged|submittedAt|late&order=asc|desc&cursor=&limit=`
- **Access:** instructor (own classes).
- **FR:** FR-REV-01, FR-REV-02 (entry point), FR-ASG-04.
- **Response:** `200` `Page<ReviewQueueItem>`. Default sort is `flagged`: needs-review, late, and low-confidence items first, then oldest submitted first (App Flow §7 step 2; Backend Schema §9.4). Archived classes are excluded (Backend Schema open question 3).
- **Errors:** `VALIDATION` (unknown filter), STD-AUTH.
- **Test:** `review.spec` (queue order).

#### REV-02 · Review-queue counts
`GET /api/review-queue/count`
- **Access:** instructor.
- **FR:** FR-REV-01, App Flow §1 (header badge).
- **Response:** `200` `{ total, needsReview, pendingRegrade }`.
- **Polling:** every 60 seconds, paused when the tab is hidden (A13).
- **Test:** `review.spec`.

### B.12 Tracker, gradebook, and statistics (5 endpoints)

#### TRK-01 · Assignment tracker
`GET /api/assignments/{assignmentId}/tracker?status=&criteriaChanged=&q=&cursor=&limit=`
- **Access:** owning instructor.
- **FR:** FR-GB-04, FR-ASG-04, FR-SUB-09, FR-GB-06.
- **Request:** `status` is a comma-separated list of tracker display states (A5). `q` searches student names (case-insensitive). `criteriaChanged=true` lists approved submissions flagged after a criteria change.
- **Response:** `200`:

  ```json
  { "assignment": { "id", "title", "dueAt", "maxScore", "scoringFormat" },
    "classStats": { "average": 74.0, "unit": "percent", "gradedCount": 18, "hidden": false, "minimumGraded": 5 },
    "counts": { "turnedIn": 24, "late": 2, "missing": 4, "notYetDue": 0, "needsReview": 1 },
    "items": [ TrackerRow ], "nextCursor": null }
  ```

  Only `ACTIVE` students are included (PRD FR-GB-04). `classStats.average` is `null` and `hidden` is `true` below five graded submissions (PRD A5).
- **Errors:** `NOT_FOUND`, `VALIDATION`.
- **Test:** `tracker.spec`.

#### TRK-02 · Export the assignment tracker as CSV
`GET /api/assignments/{assignmentId}/export.csv`
- **Access:** owning instructor.
- **FR:** FR-GB-05, FR-GB-02 (privacy rules).
- **Response:** `200` CSV (A14). Columns: `Student`, `Status`, `Submitted`, `Late`, `Score`, `Max`, `Letter`, `AI feedback`, `Instructor comment`. No email addresses.
- **Errors:** `NOT_FOUND`.
- **Test:** `tracker.spec` (BOM, escaping).

#### TRK-03 · Gradebook
`GET /api/classes/{classId}/gradebook?labelId=&includeArchived=false&cursor=&limit=`
- **Access:** owning instructor.
- **FR:** FR-GB-01, FR-GB-03, FR-GB-06, FR-ASG-09.
- **Response:** `200` `{ columns: [{ assignmentId, title, label, scoringFormat, maxScore, archived }], items: [{ student: { id, displayName }, cells: GradebookCell[] }], nextCursor }`. Archived assignments appear only with `includeArchived=true` (the "Show archived" toggle). Removed, pending, and declined students are excluded.
- **Errors:** `NOT_FOUND`.
- **Effects:** a cell opens the submission screen (INS-01) or, for "Not submitted", the tracker row (App Flow §8.2).
- **Test:** `tracker.spec` (gradebook).

#### TRK-04 · Gradebook as CSV
`GET /api/classes/{classId}/gradebook.csv?labelId=&includeArchived=false`
- **Access:** owning instructor.
- **FR:** FR-GB-02, FR-GB-03.
- **Response:** `200` CSV (A14). One row per student. Columns: `Student`, then for each assignment `<title> (score)` and `<title> (status)`. Duplicate titles get a numeric suffix. Scores are in each assignment's own format.
- **Errors:** `NOT_FOUND`.
- **Test:** `tracker.spec`.

#### TRK-05 · Class statistics for an assignment
`GET /api/assignments/{assignmentId}/stats`
- **Access:** an `ACTIVE` student in the class, or the owning instructor.
- **FR:** FR-GB, PRD §11 (class stats), PRD A5.
- **Response:** `200` `{ average, unit: "percent", gradedCount, minimumGraded: 5, hidden }`. Average is over approved scores only, expressed as a percentage of the maximum so it reads the same for every format (PRD A5). `average` is `null` and `hidden` is `true` below five graded submissions. No minimum, maximum, or distribution is returned (PRD §11).
- **Errors:** `NOT_FOUND`, `ENROLLMENT_PENDING`.
- **Test:** `tracker.spec`.

### B.13 Announcements (3 endpoints, Could)

Announcements are the Could-priority feature (M4). The endpoints are specified now so the schema and the notification types stay consistent.

#### ANN-01 · List announcements
`GET /api/classes/{classId}/announcements?cursor=&limit=`
- **Access:** owning instructor; or an `ACTIVE` student.
- **FR:** FR-ANN-01, FR-ANN-02, FR-ANN-05.
- **Response:** `200` `Page<Announcement>`, newest first.
- **Errors:** `NOT_FOUND` (students who are pending, declined, or removed), STD-AUTH.
- **Test:** `announcements.spec`.

#### ANN-02 · Post an announcement
`POST /api/classes/{classId}/announcements` · Standard set: `STD-UPLOAD`
- **Access:** owning instructor.
- **FR:** FR-ANN-01, FR-ANN-04.
- **Request:** `multipart/form-data` with `title` (1 to 200 characters), `body` (up to 5,000 characters), and an optional `file` (one PDF, JPEG, or PNG, 10 MiB maximum, checked by content).
- **Response:** `201` `Announcement`.
- **Errors:** `VALIDATION`, `FILE_TYPE`, `FILE_TOO_LARGE`, `CLASS_ARCHIVED`.
- **Effects:** `ANNOUNCEMENT_POSTED` to approved students (in-app, and email as a digest by preference). Students cannot reply or react (FR-ANN-05).
- **Test:** `announcements.spec`.

#### ANN-03 · Delete an announcement
`DELETE /api/announcements/{announcementId}` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** owning instructor.
- **FR:** FR-ANN-03.
- **Response:** `204`.
- **Effects:** deletes the announcement and its attachment rows at once. Attachments go to the storage outbox (Backend Schema §10.6). Notification links to it show "This item is no longer available" (App Flow §10).
- **Test:** `announcements.spec`.

### B.14 Notifications (4 endpoints)

#### NTF-01 · List notifications
`GET /api/notifications?unreadOnly=&cursor=&limit=`
- **Access:** any signed-in user.
- **FR:** FR-NTF-01.
- **Response:** `200` `Page<Notification>`, newest first. `title` and `body` are copy from the UX Brief, filled with identifiers and short labels only (Backend Schema §4.20).
- **Errors:** STD-AUTH.
- **Test:** `notifications.spec`.

#### NTF-02 · Mark one notification read
`POST /api/notifications/{notificationId}/read` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** the recipient.
- **FR:** FR-NTF-01.
- **Response:** `204`. Idempotent. Another user's notification returns `NOT_FOUND`.
- **Test:** `notifications.spec`.

#### NTF-03 · Mark all notifications read
`POST /api/notifications/read-all` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** any signed-in user.
- **FR:** FR-NTF-01 (App Flow §10).
- **Response:** `200` `{ marked: integer }`.
- **Test:** `notifications.spec`.

#### NTF-04 · Unread count
`GET /api/notifications/unread-count`
- **Access:** any signed-in user.
- **FR:** FR-NTF-01.
- **Response:** `200` `{ count: integer }`. Sends `ETag`.
- **Polling:** every 60 seconds (A13).
- **Test:** `notifications.spec`.

### B.15 Super Admin (10 endpoints)

Every admin endpoint returns metadata only. No response contains submission content, feedback, comments, file names, or key data (Backend Schema §12; TRD §7.3). Every write is written to `audit_logs` with actor, target, and an optional reason. Admin routes return `404` to non-admins (A3).

#### ADM-01 · List users
`GET /api/admin/users?q=&role=&status=&cursor=&limit=`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-01.
- **Response:** `200` `Page<AdminUser>`. `q` searches email and name.
- **Test:** `admin.spec`.

#### ADM-02 · Get user
`GET /api/admin/users/{userId}`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-01.
- **Response:** `200` `AdminUser` plus `classes: [{ id, name, role }]`. Metadata only.
- **Test:** `admin.spec`.

#### ADM-03 · Suspend user
`POST /api/admin/users/{userId}/suspend` · Standard set: `STD-MUT`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-01, PRD A16.
- **Request:** `{ reason?: string (up to 500) }`.
- **Response:** `200` `AdminUser` with `status: "SUSPENDED"`. Idempotent.
- **Errors:** `CONFLICT` (409, `details.reason: "admin-account"`) for another admin account, or the caller's own.
- **Effects:** ends all of the user's sessions. Sends `ACCOUNT_STATUS_CHANGED` by email to the address on file, even if unverified, with the reason when given (PRD A16). Writes `audit_logs` (`ACCOUNT_SUSPENDED`, reason).
- **Test:** `admin.spec` (suspension, email, sessions).

#### ADM-04 · Reinstate user
`POST /api/admin/users/{userId}/reinstate` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-01, PRD A16.
- **Response:** `200` `AdminUser` with `status: "ACTIVE"`. Idempotent.
- **Effects:** sends `ACCOUNT_STATUS_CHANGED` and writes `audit_logs` (`ACCOUNT_REINSTATED`).
- **Test:** `admin.spec`.

#### ADM-05 · Delete user
`DELETE /api/admin/users/{userId}` · Standard set: `STD-MUT`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-01, FR-AUTH-10, PRD A14.
- **Request:** `{ confirmation: "DELETE" }`.
- **Response:** `204`.
- **Errors:** `CONFIRMATION_MISMATCH`; `CONFLICT` (409, `details.reason: "admin-account"`).
- **Effects:** runs the same path as ACC-04 for the target: student (Backend Schema §10.3) or instructor (§10.4). Writes `audit_logs` (`ACCOUNT_DELETED`) with counts only.
- **Test:** `admin.spec`, `account.spec`.

#### ADM-06 · List classes
`GET /api/admin/classes?q=&status=&cursor=&limit=`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-02.
- **Response:** `200` `Page<AdminClass>`.
- **Test:** `admin.spec`.

#### ADM-07 · Archive class (admin)
`POST /api/admin/classes/{classId}/archive` · Standard set: `STD-MUT` minus `VALIDATION`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-02, FR-CLS-06.
- **Response:** `200` `AdminClass`. Idempotent.
- **Effects:** same state change as CLS-05. Writes `audit_logs`.
- **Test:** `admin.spec`.

#### ADM-08 · Delete class (admin)
`DELETE /api/admin/classes/{classId}` · Standard set: `STD-MUT`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-02, FR-CLS-11.
- **Request:** `{ confirmation }`, which must equal the class name.
- **Response:** `204`.
- **Errors:** `CONFIRMATION_MISMATCH`.
- **Effects:** the class deletion path (Backend Schema §10.2). Approved students **and** the instructor get `CLASS_DELETED` (PRD §10). Writes `audit_logs` (`CLASS_DELETED`) with counts only.
- **Test:** `admin.spec`.

#### ADM-09 · Platform health
`GET /api/admin/health?window=24h|7d`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-03.
- **Response:** `200`:

  ```json
  { "window": "24h",
    "gradingSuccessRate": 0.97,
    "manualReviewRate": { "total": 0.03, "byCause": { "AI_FAILED": 0.01, "KEY_INVALID": 0.01, "KEY_QUOTA": 0.01, "KEY_MISSING": 0, "FILE_QUALITY": 0 } },
    "keyQuotaErrorRate": 0.02,
    "queueDepth": { "grade.submission": 3, "send.email": 0 } }
  ```

  Computed from `grading_attempts` and `submissions`. Cost per day is not reported (the platform pays no AI cost, PRD D2).
- **Test:** `admin.spec`.

#### ADM-10 · Audit log
`GET /api/admin/audit?action=&targetType=&from=&to=&cursor=&limit=`
- **Access:** `SUPER_ADMIN`.
- **FR:** FR-ADM-04.
- **Response:** `200` `Page<AuditEntry>`, newest first. Read-only; the table is append-only (Backend Schema §7.4).
- **Test:** `admin.spec`.

### B.16 System (1 endpoint)

#### SYS-01 · Health check
`GET /healthz` (outside `/api`)
- **Access:** anonymous. Used by UptimeRobot and by the platform's health check.
- **FR:** Operations (TRD §17.1, S6).
- **Response:** `200` `Health` (`status: "ok"`), or `503` (`status: "degraded"`) when the database check fails. The body never includes version, dependency names, or counts (A8).
- **Effects:** runs a trivial query, which keeps the free database active (TRD §4.2).
- **Headers:** `Cache-Control: no-store`.
- **Test:** S6 in the TRD; `api` project smoke test.
## Part C: External integrations

Each integration uses the same template:

- **Purpose:** why we call it.
- **Calls:** the operations we make.
- **Auth and secrets:** how we authenticate and where the secret lives.
- **Contract:** the request and response parts we depend on.
- **Timeouts and retries**, and **error mapping** to our codes.
- **Limits:** quotas and sizes. Anything not confirmed by a provider's documentation is marked **verify**, with the spike that settles it (TRD §17.1).
- **Data sent:** what leaves our system (privacy).
- **Test substitute**, **failure behavior**, and **monitoring**.

Provider facts marked "confirmed" were checked against the sources listed at the end of this part. Items marked "verify" were not confirmed against the provider's own reference page; Appendix C lists them.

### C.1 Google Gemini (grading and key validation)

- **Purpose:** grades a submission against the criteria (FR-AI-01), and validates an instructor's key (FR-KEY-02).
- **Calls:**
  - `models.list` (a model-list call) to validate a key (KEY-02, KEY-04). It consumes no generation quota (TRD §11.5; **verify**).
  - `interactions.create` through the `@google/genai` SDK for grading, with `system_instruction` (prompt version `grade-v1`), `input` content blocks, `response_format: { type: 'text', mime_type: 'application/json', schema: GradeOutput }` (lowercase JSON Schema), `store: false`, `automatic_continuation: false`, and SDK retries off (`maxRetries: 0`, the grading job retries). The answer is `output_text`.
- **Auth and secrets:** the instructor's own key, given to a new SDK client for each call. The client uses API version `v1beta`, because the `document` input type is not in `v1` (Gemini answers 400). The key is decrypted in memory for one call and never logged, returned, or cached. The redaction list in TRD §14 covers it.
- **Model:** from `GEMINI_MODEL` (TRD §11.1). Default `gemini-2.5-flash`.
- **Request contract:**
  - Text blocks are `{ type: 'text' }`, each wrapped in a random boundary token (TRD §10.4); a PDF is `{ type: 'document', mime_type, data }` and an image `{ type: 'image', mime_type, data }`, base64 inline.
  - Files are sent inline, not through the Files API (TRD §10.4 and §11.3).
  - The total raw file size per call is capped at 15 MiB (TRD §11.3).
- **Response contract:** the JSON text is in `candidates[0].content.parts[0].text`, matching `GradeOutput`:

  ```json
  { "score": 42, "feedback": "…", "confidence": "high", "readabilityIssue": false }
  ```

  The `letter` field is not requested. If the model returns one anyway, it is ignored, because the server derives the letter (PRD §9.4).
- **Timeouts and retries:** 60 seconds per attempt. Up to three attempts with exponential backoff, base 5 seconds, cap 60 seconds, and jitter (TRD §10.7). `Retry-After` is honored when present.
- **Error mapping:**

  | Provider signal | Our class | Retry | Result |
  |---|---|---|---|
  | `400 INVALID_ARGUMENT` | Malformed request (our bug, or an unsupported file) | No | `NEEDS_MANUAL_REVIEW`, `AI_FAILED`, logged as `error_class: MALFORMED` |
  | `401` or `403` (invalid key) | `KEY_INVALID` | No | Key status `NEEDS_ATTENTION`; `KEY_INVALID` |
  | `403` (API not enabled for the project) | `KEY_API_DISABLED` | No | Key status `NEEDS_ATTENTION` |
  | A file the provider cannot read (the signal is unknown until spike S3; **verify**) | `FILE_QUALITY` | No | `NEEDS_MANUAL_REVIEW`, `FILE_QUALITY`; attempt outcome `FILE_ERROR` |
  | `429 RESOURCE_EXHAUSTED`, daily quota | `KEY_QUOTA` | No | Key status `QUOTA_REACHED`; `KEY_QUOTA` |
  | `429 RESOURCE_EXHAUSTED`, per-minute quota | Transient | Yes, honoring `Retry-After` | Retry; then `AI_FAILED` if exhausted |
  | `500`, `503`, network error, timeout | Transient | Yes | Retry; then `AI_FAILED` |
  | Invalid JSON, score out of range, empty feedback | Transient (TRD §10.6) | Yes | Retry; then `AI_FAILED` |
  | Prompt blocked by the provider's safety filters (`promptFeedback.blockReason`) | `BLOCKED` | No | `NEEDS_MANUAL_REVIEW`, `AI_FAILED`, logged as `error_class: BLOCKED` |

  Distinguishing daily from per-minute quota is open question TQ3 (TRD §17.5). As built (portfolio scope, 2026-11-19): a 429 whose body names a per-day quota is daily, any other 429 is per-minute. A 400 that says the key is not valid is `KEY_INVALID`. The SDK's error carries the HTTP `status`. The live adapter is `packages/ai/src/live-gemini.ts` and holds the `grade-v1` prompt text, since the AI Guardrails document is cut.
- **Limits (verify at spike S3):**
  - Requests per minute, requests per day, and tokens per minute depend on the model and the free tier, and change over time. Recorded in TRD §11.2 at S3.
  - **Inline payload size:** sources disagree. A Google announcement reports the inline payload limit raised from 20 MB to 100 MB, measured in base64 (verify on ai.google.dev). A Firebase AI Logic page still states 20 MB. The product budget of 15 MiB raw (about 20 MB base64) fits either figure, so the design does not change until S3 settles it.
  - **Files API:** third-party write-ups say uploaded files are kept for 48 hours on Google's side (verify). This is the reason the design sends files inline.
  - **Blocked-response shape:** the search did not confirm `promptFeedback.blockReason` on the official errors page (verify at S3).
- **Data sent:** the assignment title and instructions, the criteria text, reference files (when attached), the student's files in order, and scoring details. **Never sent:** student names or emails, other students' work, the instructor comment (PRD §9.1; TRD §10.4).
- **Test substitute:** the fake adapter with scenario tags, used by tests only (TRD §16.2a). The adapter, fake or live, returns the model's JSON text and the grading job parses it, so the fake's malformed and out-of-range scenarios go through the real parser and a schema change breaks the tests.
- **Failure behavior:** an outage or quota problem moves submissions to Needs manual review with the cause shown to the instructor. Students see "Submitted, awaiting instructor review" (FR-AI-04, FR-KEY-05). No retry storms: the per-key limiter and the retry caps apply.
- **Monitoring:** every call writes a `grading_attempts` row (Backend Schema §4.17). The admin health endpoint (ADM-09) reports success rate, manual-review rate by cause, and key or quota error rate.
- **Spike:** S3 (model, limits, error shapes, inline size), S4 (large payloads and memory).

### C.3 Supabase Postgres and pg-boss

- **Purpose:** the only database, and the job queue (grading, email, cleanup, digests).
- **Connections:** three roles and two poolers, specified in Backend Schema §12.3:
  - `DATABASE_URL`: `app_runtime` over the transaction pooler (port 6543), for Prisma queries.
  - `DIRECT_URL`: `postgres` over the session pooler (port 5432), for migrations and `db:boss:init`.
  - `PGBOSS_URL`: `app_runtime` over the session pooler (port 5432), for pg-boss at runtime.
- **Username form:** Supabase's pooler expects `role.project-ref` (Backend Schema §12.3; **verify** at S2).
- **Pool and timeouts:**
  - Prisma connection limit 5 on the free host (512 MB RAM, TRD §4.2).
  - Connect timeout 10 seconds.
  - Statement timeout 10 seconds for API requests. Grading and cleanup jobs run with a longer limit set per job.
- **Retries:** connection-level errors (for example P1001, P1017) retry up to three times with backoff, but never for writes that already committed. Application errors are not retried at this layer.
- **Health:** a trivial query in SYS-01. A failure returns `503 degraded` and the maintenance behavior in A8.
- **Limits (verify):** free-tier database size and inactivity pausing (TRD §4.2). Backup availability on the free tier is an open question (Backend Schema §16.2, item 5).
- **Test substitute:** the `edugemini-test` Supabase project locally and a Postgres service container in CI (TRD §4.1, §16.3).
- **Spike:** S2.

### C.4 Supabase Storage

- **Purpose:** private object storage for submission files, reference files, and announcement attachments (TRD §9).
- **Interface:** `StorageAdapter`, with the operations below. The one real implementation is `supabase`, used in development and production alike (there is no local-disk storage and no storage setting, decided 2026-11-17). The tests use an in-memory fake that holds the objects in memory and returns a made-up link.

  | Operation | Behavior |
  |---|---|
  | `put(bucket, path, stream, contentType, maxBytes)` | Streams to storage, enforces `maxBytes`, returns `{ size, sha256 }`. Fails with `FILE_TOO_LARGE` if the cap is reached, and stores nothing. A path that already exists is replaced, so a retried upload is harmless |
  | `get(bucket, path)` | Streams the object (used only by server-side processing, never returned to clients). A missing object is `NOT_FOUND` |
  | `signedUrl(bucket, path, ttlSeconds = 300)` | Returns a time-limited URL. A missing object is `NOT_FOUND` |
  | `remove(bucket, paths[])` | Idempotent: a missing object counts as removed |
  | `exists(bucket, path)` | Used by the cleanup job before it marks an outbox row complete |

- **Calls:** the adapter calls the Storage REST API with `fetch` and the service-role key, so there is no `supabase-js` dependency (TRD T-D11): `POST /storage/v1/object/{bucket}/{path}` with `x-upsert: true` (put), `GET` on the same path (get), `POST /storage/v1/object/sign/{bucket}/{path}` with `{ expiresIn }` in seconds (signedUrl), `DELETE /storage/v1/object/{bucket}` with `{ prefixes }` (remove) and `HEAD` on the object path (exists). Storage answers 400 or 404 for a missing object. `remove` counts a missing object as removed. Run against a real private bucket on 2026-11-17 (a streamed put from a file, `HEAD` for exists before and after, the sign response and a download of the signed link, remove): all of it worked as written.
- **Auth and secrets:** the API key (`SUPABASE_SERVICE_ROLE_KEY`) on the API only. It can be the new secret key (`sb_secret_...`), which is the one to use because Supabase retires the legacy JWT `service_role` key in early 2027; the adapter sends it as both `apikey` and `Authorization: Bearer`, and Storage accepted that. Buckets are private. The key never reaches the browser or the build.
- **Bucket setup (done once, in the Supabase dashboard, Storage):** create a private bucket (private is the default; the app reads files only through signed links, [Supabase: buckets fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals)) and put its exact name in `STORAGE_BUCKET`. A bucket can also restrict file types and size. If it lists allowed file types, `application/pdf`, `image/jpeg` and `image/png` must be among them, because those are the only types the app sends; a type outside the list is refused by Storage (`415 invalid_mime_type`), which the adapter reports as `SERVICE_UNAVAILABLE` for storage. The size limit must be at least 10 MiB (the dev bucket's is 50 MiB).
- **Object paths:** generated by the server from IDs and an ordinal (TRD §9.1). User-supplied file names never appear in paths.
- **Timeouts and retries:** 30 seconds per operation. `put` does not retry: a stream can be read once, so the upload route, which holds the temporary file (TRD §9.1), calls it again. Deletes are retried by the outbox job (Backend Schema §10.1), not inline.
- **Limits (verify):** free-tier storage size (**1 GB** in Backend Schema §15.2; verify the current figure) and egress. Storage is the binding constraint for the free tier, which is why client-side resize is proposed (Backend Schema §15.2, open question 2).
- **Failure behavior:** if storage is down, the file PUT returns `503 SERVICE_UNAVAILABLE` with `details.service: "storage"` and the student keeps the file on the device, so they can retry. Nothing is stored partially.
- **Test substitute:** the in-memory fake (`test/memory-storage.ts`) in the integration tests and CI. CI needs no bucket for them.
- **Spike:** S1 (upload path) and the storage tests in the E2E suite.

### C.5 Email (SMTP)

- **Purpose:** verification and reset emails, account notices, retention notices, immediate notifications, and instructor digests (FR-NTF-02, FR-NTF-03).
- **Provider:** an SMTP provider. **Brevo** is the candidate. Its help center states a free-plan limit of **300 emails per day** (confirmed by the search; the daily limit resets, and unused sends do not roll over).
- **Interface:** `Mailer.send({ to, subject, text, html })` over SMTP (nodemailer), with `MAIL_FROM` as the sender (a configured sender address in v1, not a verified domain; PRD D15).
- **Auth and secrets:** `SMTP_USER` and `SMTP_PASS` (environment only). STARTTLS on port 587 (**verify** the provider's SMTP settings).
- **Templates** (each has a plain-text and an HTML version; no tracking pixels):

  | Template | Used by | Contains |
  |---|---|---|
  | `verify-email` | AUTH-01, AUTH-08 | Link with a 24-hour token |
  | `reset-password` | AUTH-05 | Link with a 60-minute token |
  | `account-status` | ADM-03, ADM-04 | The status change and the optional reason |
  | `retention-notice` | `retention.sweep` | Date of deletion and a link to the gradebook CSV |
  | `notification` | Immediate notifications | Title from the UX copy and a deep link |
  | `digest` | `digest.flush` | A count per type and a deep link to the queue |

  No template includes a grade, feedback, a file name, or a student's name in a way that reveals another student (Backend Schema §4.20; TRD §13.4).
- **Recipients:** only verified addresses, except the verification and reset emails and the account-status notices, which go to the address on file (PRD §10). Preferences (ACC-06) apply to every other category.
- **Retries and failures:**
  - `send.email` jobs retry up to five times with exponential backoff.
  - A permanent failure (for example, a rejected recipient) marks the notification `FAILED` and keeps the in-app notification, which remains the source of truth (PRD §15).
  - When the daily quota is reached, the job is deferred to the next day by moving `email_after` forward, and the admin health view shows a quota warning. Digests reduce volume so the quota is not reached in normal use.
- **Timeouts:** 20 seconds per send.
- **Test substitute:** the fake mailer (`MAIL_DRIVER=fake`) in development and CI. The E2E suite reads its outbox endpoint (TRD §13.5, §16.2a).
- **Monitoring:** `notifications.email_status` counts by state (Backend Schema §4.20) and the health view (ADM-09).
- **Spike:** S5 (inbox placement with Gmail and Outlook test accounts, and the quota check).

### C.6 Vercel (web hosting and the `/api` rewrite)

- **Purpose:** serves the built web app and forwards `/api/*` to the Render service, so the browser sees one origin (TRD T-D1).
- **Configuration:** `vercel.json` with one rewrite: `/api/:path*` to `https://<render-host>/api/:path*`. `/healthz` is not rewritten; the uptime monitor calls the Render host through the same path (**verify** that the monitor URL should be the Render host, not the Vercel one).
- **Headers:** Vercel sets `X-Forwarded-Host` and `X-Forwarded-Proto`. Express sets `trust proxy` to 1, so secure cookies and the Origin check see the public origin.
- **Cookies:** `Set-Cookie` from Render passes through the rewrite and is stored for the Vercel origin. Confirmed in spike S1, not assumed.
- **Timeouts (confirmed):** a proxied request has a maximum of **120 seconds**, after which Vercel returns `ROUTER_EXTERNAL_TARGET_ERROR` when the target fails or does not answer in time. Our longest synchronous call is an upload PUT (under 30 seconds) and the bulk actions (which return `202` or are limited to 200 items), so the limit is not reached in normal use.
- **Body size (not confirmed):** the search found no official cap on request bodies for external rewrites. One author reports that the 4.5 MB limit for serverless functions does not apply to external proxying (**unverified**). Spike S1 uploads a 10 MiB file through the rewrite to settle it. Fallback: Express serves the built web app itself (one service, same origin, no Vercel).
- **Monitoring:** Vercel deployment logs; the API's own request logs carry `X-Request-Id` for correlation.
- **Test substitute:** the Vite dev server proxies `/api` to the local API, so the web app and API share one origin and the same-origin behavior is tested without Vercel (TRD §4.1).

### C.7 Render (API and worker hosting)

- **Purpose:** runs the Express API, the pg-boss worker (in the same process), and the migrations at start (TRD §3, §4.5).
- **Plan:** free web service: 512 MB RAM, spins down after about 15 minutes with no traffic, and 750 instance-hours per month (TRD §4.2; **verify** the current terms).
- **Build and start:**
  - Build: `pnpm install --frozen-lockfile && pnpm build`.
  - Start: `prisma migrate deploy && node dist/server.js` (migrations apply before traffic).
  - Health check path: `/healthz`.
- **Environment:** set in the Render dashboard. Never committed. Listed in TRD Appendix A.
- **Graceful shutdown** (on `SIGTERM`):
  1. Stop accepting new HTTP requests; let in-flight requests finish for up to 20 seconds.
  2. Stop pg-boss gracefully with a timeout: running jobs finish or are returned to the queue (pg-boss semantics; **verify** the option names in the pinned version).
  3. Close the database pools.
- **Keep-alive:** UptimeRobot (C.8) pings `/healthz` every five minutes, which prevents the spin-down during active hours. Spike S6 measures cold starts.
- **Memory:** two concurrent HEIC or PDF jobs maximum (TRD §9.4), enforced by a semaphore in the API.
- **Monitoring:** Render logs and health-check status; application logs are structured JSON with `X-Request-Id`.

### C.8 UptimeRobot (monitoring)

- **Purpose:** detects downtime and keeps the free host awake (C.7).
- **Monitor:** HTTPS, `https://<render-host>/healthz`, every five minutes, with a keyword check for `"ok"` (**verify** the free plan's interval and monitor count).
- **Alerts:** email to the owner when the monitor is down for two checks in a row.
- **Data:** only the monitor's own uptime data. The monitor sends no user data and has no access to the application.

### C.9 Integration matrix and degradation

| Service | Used for | When it fails | What the user sees | Detected by |
|---|---|---|---|---|
| Gemini | Grading and key checks | Outage, quota, invalid key | Student: "Submitted, awaiting instructor review". Instructor: banner and cause | `grading_attempts`, ADM-09 |
| Supabase Postgres | Everything | Database down | Maintenance page; `/healthz` returns 503 | UptimeRobot; SYS-01 |
| Supabase Storage | Files | Storage down | Upload shows a retry message; nothing is partly stored | Storage errors; outbox backlog |
| SMTP provider | Email | Provider down or daily quota reached | In-app notifications still appear; email is deferred | `notifications.email_status`, ADM-09 |
| Vercel | Web app and rewrite | Platform outage | The site is unreachable | Vercel status; UptimeRobot on the API host |
| Render | API and worker | Platform outage or spin-down | Requests are slow for about a minute after a spin-down | UptimeRobot; Render logs |
| UptimeRobot | Monitoring only | Monitor down | No user impact | Its own status page |

**Sources checked for this part** (web search, June 2026):
- Gemini inline size and Files API: fast.io, Firebase AI Logic input file requirements, Google's file-limits announcement on the Google blog.
- Gemini error codes: ai.google.dev, Gemini API errors page.
- Supabase Storage signed URLs and removal: the supabase-js storage README and mirror documentation (verify against supabase.com).
- Vercel timeout and rewrite behavior: vercel.com documentation on rewrites and limits.
- Brevo free-plan limit: Brevo help center (300 emails per day, no time limit).

## Appendix A: Traceability from PRD requirements to endpoints

Every PRD v2.2 requirement ID is listed. "UI only" means the requirement has no endpoint of its own; the screen behavior comes from the UX Brief and the App Flow, and any data it reads is named.

| FR ID | Endpoints | Note |
|---|---|---|
| FR-AUTH-01 | AUTH-01, AUTH-02 | |
| FR-AUTH-03 | AUTH-01 | |
| FR-AUTH-04 | AUTH-01, AUTH-07, AUTH-08 | Banner is UI; the flag is `Me.emailVerified` |
| FR-AUTH-05 | AUTH-05, AUTH-06 | |
| FR-AUTH-06 | AUTH-02, AUTH-03, AUTH-04 | |
| FR-AUTH-07 | ACC-02, ACC-03 | |
| FR-AUTH-08 | ACC-01, JOIN-02 | UI only (reads the role and the join preview) |
| FR-AUTH-09 | AUTH-01 | |
| FR-AUTH-10 | ACC-04, ACC-07, ADM-05 | |
| FR-KEY-01 | KEY-01, KEY-02, KEY-03 | |
| FR-KEY-02 | KEY-02, KEY-04 | |
| FR-KEY-03 | KEY-01, KEY-02 | Only `last4` is returned |
| FR-KEY-04 | KEY-02 | `disclosureAcknowledged` is required on the first save |
| FR-KEY-05 | KEY-03, INS-06, INS-07, BLK-02 | Re-run after a fix is the instructor's choice (no automatic re-run) |
| FR-KEY-06 | KEY-01, KEY-04 | |
| FR-KEY-07 | KEY-01 | UI only (static help; reads the status) |
| FR-CLS-01 | CLS-02, CLS-03 | |
| FR-CLS-02 | CLS-02, CLS-08, JOIN-01 | |
| FR-CLS-03 | JOIN-01, JOIN-02 | |
| FR-CLS-04 | CLS-08, CLS-09 | |
| FR-CLS-05 | PPL-01, PPL-02 | Removal hides submissions from the queue and tracker (derived) |
| FR-CLS-06 | CLS-01, CLS-05, CLS-06, ADM-07 | |
| FR-CLS-07 | CLS-10, PPL-01, PPL-02, PPL-03, JOIN-01 | |
| FR-CLS-08 | JOIN-03, CLS-01 | |
| FR-CLS-09 | CLS-02 | |
| FR-CLS-10 | CLS-04 | |
| FR-CLS-11 | CLS-07, CLS-11, ADM-08 | |
| FR-ASG-01 | ASG-02, ASG-03, ASG-04 | |
| FR-ASG-02 | ASG-04 | `FORMAT_LOCKED` |
| FR-ASG-03 | ASG-01, ASG-02, ASG-06 | |
| FR-ASG-04 | ASG-04, ASG-05, REF-01, REF-03 | Impact token (A6) |
| FR-ASG-05 | ASG-04 | Late is derived; no stored flag |
| FR-ASG-06 | ASG-04 | `letterScale` |
| FR-ASG-07 | REF-01, REF-02, REF-03, REF-04 | |
| FR-ASG-08 | ASG-01, ASG-10, ASG-11, ASG-12 | |
| FR-ASG-09 | ASG-07, ASG-08, ASG-09 | |
| FR-ASG-10 | ASG-02, ASG-04, INS-04 | `maxResubmissions` |
| FR-ASG-11 | ASG-02, ASG-04, INS-05 | |
| FR-SUB-01 | SUB-03 | Magic-byte check; HEIC converted |
| FR-SUB-02 | SUB-03, SUB-05, REF-01, ANN-02 | Limits from A7 |
| FR-SUB-03 | SUB-02, SUB-03, SUB-04, SUB-05, SUB-06 | Upload protocol (A7) |
| FR-SUB-04 | SUB-01, SUB-05, TRK-01 | Late is derived |
| FR-SUB-05 | SUB-02, SUB-05 | Attempt consumed at finalize, versions after the first |
| FR-SUB-06 | SUB-01, SUB-02 | `LOCKED_APPROVED` |
| FR-SUB-07 | SUB-02, SUB-05 | One submission row per student and assignment |
| FR-SUB-08 | SUB-03, SUB-05 | Receipt is the response to finalize |
| FR-SUB-09 | ASG-01, SUB-01, INS-01, TRK-01 | `attemptsLeft` |
| FR-SUB-10 | INS-03, INS-04, INS-05 | Both logged and notified |
| FR-AI-01 | INS-01, SUB-01 | `GradeView` |
| FR-AI-02 | ASG-04, INS-06, INS-07, REF-01, SUB-05 | A due-date change does not appear here (D6) |
| FR-AI-03 | SUB-01 | |
| FR-AI-04 | ADM-09, INS-01 | Cause shown to the instructor; neutral copy to students |
| FR-AI-05 | SUB-03 | `FILE_ERROR`; no attempt |
| FR-AI-06 | SUB-05 | Stale result discarded in the worker (TRD §10.3) |
| FR-AI-07 | SUB-01 | UI only (disclosure copy keyed to `grade.source`) |
| FR-REV-01 | REV-01, REV-02 | |
| FR-REV-02 | FILE-01, INS-01 | |
| FR-REV-03 | INS-02, INS-08, INS-11 | |
| FR-REV-04 | INS-02, INS-11 | |
| FR-REV-05 | INS-03 | |
| FR-REV-06 | BLK-02, INS-06, INS-11 | |
| FR-REV-07 | BLK-01 | |
| FR-REV-08 | INS-02, INS-08 | `editClass` computed by the server |
| FR-REV-09 | INS-02, INS-10 | Never sent to Gemini |
| FR-REV-10 | BLK-03, INS-07, INS-08, INS-09 | D9 |
| FR-GB-01 | TRK-03 | |
| FR-GB-02 | TRK-04 | UTF-8 BOM (A14) |
| FR-GB-03 | TRK-03, TRK-04 | Each assignment in its own format |
| FR-GB-04 | TRK-01 | Counts, filters, search, criteria-changed filter |
| FR-GB-05 | TRK-02 | |
| FR-GB-06 | ASG-01, TRK-03 | |
| FR-NTF-01 | NTF-01, NTF-02, NTF-03, NTF-04 | |
| FR-NTF-02 | UI only (email sent by the worker; catalog in C.5) | No endpoint of its own |
| FR-NTF-03 | UI only (digest job; catalog in C.5) | No endpoint of its own |
| FR-NTF-04 | ACC-05, ACC-06 | |
| FR-ADM-01 | ADM-01, ADM-02, ADM-03, ADM-04, ADM-05 | Metadata only |
| FR-ADM-02 | ADM-06, ADM-07, ADM-08 | |
| FR-ADM-03 | ADM-09 | |
| FR-ADM-04 | ADM-10 (and every admin write, A3) | |
| FR-ANN-01 | ANN-02 | Could (M4) |
| FR-ANN-02 | ANN-01, FILE-01 | |
| FR-ANN-03 | ANN-03 | |
| FR-ANN-04 | ANN-02, NTF-01 | Announcement notifications are created by ANN-02 |
| FR-ANN-05 | ANN-01 | UI only: no reaction or comment endpoints exist |

## Appendix B: Endpoint index

Generated from the endpoint headings in Part B. The ID is the `operationId` in `openapi.yaml`.

| ID | Method | Path | Endpoint | Group |
|---|---|---|---|---|
| BLK-01 | POST | `/api/assignments/{assignmentId}/bulk-approve` | Bulk approve unedited AI results | B.10 Bulk actions and progress |
| BLK-02 | POST | `/api/assignments/{assignmentId}/bulk-rerun` | Re-run AI for manual-review items | B.10 Bulk actions and progress |
| BLK-03 | POST | `/api/assignments/{assignmentId}/bulk-regrade` | Re-grade approved submissions | B.10 Bulk actions and progress |
| BLK-04 | GET | `/api/assignments/{assignmentId}/progress?batchId=` | Get progress of a batch | B.10 Bulk actions and progress |
| REV-01 | GET | `/api/review-queue?classId=&assignmentId=&status=AI_GENERATED|NEEDS_MANUAL_REVIEW|PENDING_REGRADE&sort=flagged|submittedAt|late&order=asc|desc&cursor=&limit=` | List the review queue | B.11 Review queue |
| REV-02 | GET | `/api/review-queue/count` | Review-queue counts | B.11 Review queue |
| TRK-01 | GET | `/api/assignments/{assignmentId}/tracker?status=&criteriaChanged=&q=&cursor=&limit=` | Assignment tracker | B.12 Tracker, gradebook, and statistics |
| TRK-02 | GET | `/api/assignments/{assignmentId}/export.csv` | Export the assignment tracker as CSV | B.12 Tracker, gradebook, and statistics |
| TRK-03 | GET | `/api/classes/{classId}/gradebook?labelId=&includeArchived=false&cursor=&limit=` | Gradebook | B.12 Tracker, gradebook, and statistics |
| TRK-04 | GET | `/api/classes/{classId}/gradebook.csv?labelId=&includeArchived=false` | Gradebook as CSV | B.12 Tracker, gradebook, and statistics |
| TRK-05 | GET | `/api/assignments/{assignmentId}/stats` | Class statistics for an assignment | B.12 Tracker, gradebook, and statistics |
| ANN-01 | GET | `/api/classes/{classId}/announcements?cursor=&limit=` | List announcements | B.13 Announcements |
| ANN-02 | POST | `/api/classes/{classId}/announcements` | Post an announcement | B.13 Announcements |
| ANN-03 | DELETE | `/api/announcements/{announcementId}` | Delete an announcement | B.13 Announcements |
| NTF-01 | GET | `/api/notifications?unreadOnly=&cursor=&limit=` | List notifications | B.14 Notifications |
| NTF-02 | POST | `/api/notifications/{notificationId}/read` | Mark one notification read | B.14 Notifications |
| NTF-03 | POST | `/api/notifications/read-all` | Mark all notifications read | B.14 Notifications |
| NTF-04 | GET | `/api/notifications/unread-count` | Unread count | B.14 Notifications |
| ADM-01 | GET | `/api/admin/users?q=&role=&status=&cursor=&limit=` | List users | B.15 Super Admin |
| ADM-02 | GET | `/api/admin/users/{userId}` | Get user | B.15 Super Admin |
| ADM-03 | POST | `/api/admin/users/{userId}/suspend` | Suspend user | B.15 Super Admin |
| ADM-04 | POST | `/api/admin/users/{userId}/reinstate` | Reinstate user | B.15 Super Admin |
| ADM-05 | DELETE | `/api/admin/users/{userId}` | Delete user | B.15 Super Admin |
| ADM-06 | GET | `/api/admin/classes?q=&status=&cursor=&limit=` | List classes | B.15 Super Admin |
| ADM-07 | POST | `/api/admin/classes/{classId}/archive` | Archive class (admin) | B.15 Super Admin |
| ADM-08 | DELETE | `/api/admin/classes/{classId}` | Delete class (admin) | B.15 Super Admin |
| ADM-09 | GET | `/api/admin/health?window=24h|7d` | Platform health | B.15 Super Admin |
| ADM-10 | GET | `/api/admin/audit?action=&targetType=&from=&to=&cursor=&limit=` | Audit log | B.15 Super Admin |
| SYS-01 | GET | `/healthz` | Health check | B.16 System |
| AUTH-01 | POST | `/api/auth/signup` | Sign up | B.1 Authentication |
| AUTH-02 | POST | `/api/auth/signin` | Sign in | B.1 Authentication |
| AUTH-03 | POST | `/api/auth/signout` | Sign out | B.1 Authentication |
| AUTH-04 | POST | `/api/auth/signout-all` | Sign out everywhere | B.1 Authentication |
| AUTH-05 | POST | `/api/auth/forgot-password` | Request a password reset | B.1 Authentication |
| AUTH-06 | POST | `/api/auth/reset-password` | Set a new password from a reset link | B.1 Authentication |
| AUTH-07 | POST | `/api/auth/verify-email` | Verify email | B.1 Authentication |
| AUTH-08 | POST | `/api/auth/resend-verification` | Resend the verification email | B.1 Authentication |
| ACC-01 | GET | `/api/me` | Get the current user | B.2 Account |
| ACC-02 | PATCH | `/api/me` | Update name | B.2 Account |
| ACC-03 | POST | `/api/me/password` | Change password | B.2 Account |
| ACC-04 | DELETE | `/api/me` | Delete own account | B.2 Account |
| ACC-05 | GET | `/api/me/preferences` | Get notification preferences | B.2 Account |
| ACC-06 | PUT | `/api/me/preferences` | Update notification preferences | B.2 Account |
| ACC-07 | GET | `/api/me/deletion-impact` | Preview what deleting the account will remove | B.2 Account |
| KEY-01 | GET | `/api/me/key` | Get key status | B.3 Instructor Gemini key |
| KEY-02 | PUT | `/api/me/key` | Save a key | B.3 Instructor Gemini key |
| KEY-03 | DELETE | `/api/me/key` | Remove the key | B.3 Instructor Gemini key |
| KEY-04 | POST | `/api/me/key/test` | Test the saved key | B.3 Instructor Gemini key |
| CLS-01 | GET | `/api/classes?status=ACTIVE|ARCHIVED&cursor&limit` | List classes | B.4 Classes |
| CLS-02 | POST | `/api/classes` | Create class | B.4 Classes |
| CLS-03 | GET | `/api/classes/{classId}` | Get class | B.4 Classes |
| CLS-04 | PATCH | `/api/classes/{classId}` | Edit class details | B.4 Classes |
| CLS-05 | POST | `/api/classes/{classId}/archive` | Archive class | B.4 Classes |
| CLS-06 | POST | `/api/classes/{classId}/restore` | Restore class | B.4 Classes |
| CLS-07 | DELETE | `/api/classes/{classId}` | Delete class | B.4 Classes |
| CLS-08 | POST | `/api/classes/{classId}/code/regenerate` | Regenerate join code | B.4 Classes |
| CLS-09 | POST | `/api/classes/{classId}/code/disable` | Disable join code | B.4 Classes |
| CLS-10 | PATCH | `/api/classes/{classId}/settings` | Change join approval | B.4 Classes |
| CLS-11 | GET | `/api/classes/{classId}/deletion-impact` | Preview class deletion | B.4 Classes |
| JOIN-01 | POST | `/api/join` | Join a class by code | B.5 Joining and enrollment |
| JOIN-02 | GET | `/api/join/{code}` | Preview a join link | B.5 Joining and enrollment |
| JOIN-03 | GET | `/api/me/enrollments?cursor&limit` | List my enrollments | B.5 Joining and enrollment |
| PPL-01 | GET | `/api/classes/{classId}/people?status=ACTIVE|PENDING|DECLINED|REMOVED&cursor&limit` | List people in a class | B.5 Joining and enrollment |
| PPL-02 | POST | `/api/enrollments/{enrollmentId}/decision` | Change an enrollment decision | B.5 Joining and enrollment |
| PPL-03 | POST | `/api/classes/{classId}/approve-pending` | Approve all pending | B.5 Joining and enrollment |
| ASG-01 | GET | `/api/classes/{classId}/assignments?status=&labelId=&cursor=&limit=&sort=dueAt` | List assignments | B.6 Assignments and labels |
| ASG-02 | POST | `/api/classes/{classId}/assignments` | Create assignment (draft) | B.6 Assignments and labels |
| ASG-03 | GET | `/api/assignments/{assignmentId}` | Get assignment | B.6 Assignments and labels |
| ASG-04 | PATCH | `/api/assignments/{assignmentId}` | Edit assignment | B.6 Assignments and labels |
| ASG-05 | POST | `/api/assignments/{assignmentId}/criteria-impact` | Preview criteria impact | B.6 Assignments and labels |
| ASG-06 | POST | `/api/assignments/{assignmentId}/publish` | Publish assignment | B.6 Assignments and labels |
| ASG-07 | POST | `/api/assignments/{assignmentId}/archive` | Archive assignment | B.6 Assignments and labels |
| ASG-08 | POST | `/api/assignments/{assignmentId}/restore` | Restore assignment | B.6 Assignments and labels |
| ASG-09 | DELETE | `/api/assignments/{assignmentId}` | Delete assignment | B.6 Assignments and labels |
| ASG-10 | GET | `/api/classes/{classId}/labels` | List labels | B.6 Assignments and labels |
| ASG-11 | POST | `/api/classes/{classId}/labels` | Create label | B.6 Assignments and labels |
| ASG-12 | DELETE | `/api/labels/{labelId}` | Delete label | B.6 Assignments and labels |
| REF-01 | POST | `/api/assignments/{assignmentId}/reference-files` | Add a reference file | B.7 Reference files |
| REF-02 | PATCH | `/api/reference-files/{fileId}` | Change reference file visibility | B.7 Reference files |
| REF-03 | DELETE | `/api/reference-files/{fileId}` | Remove a reference file | B.7 Reference files |
| REF-04 | GET | `/api/reference-files/{fileId}/url` | Get a reference file link | B.7 Reference files |
| SUB-01 | GET | `/api/assignments/{assignmentId}/me` | Get my submission | B.8 Student submission and files |
| SUB-02 | POST | `/api/assignments/{assignmentId}/versions` | Open an upload version | B.8 Student submission and files |
| SUB-03 | PUT | `/api/versions/{versionId}/files/{clientFileId}` | Send one file | B.8 Student submission and files |
| SUB-04 | DELETE | `/api/versions/{versionId}/files/{clientFileId}` | Remove one file from an open upload | B.8 Student submission and files |
| SUB-05 | POST | `/api/versions/{versionId}/finalize` | Finalize the upload | B.8 Student submission and files |
| SUB-06 | DELETE | `/api/versions/{versionId}` | Cancel an open upload | B.8 Student submission and files |
| FILE-01 | GET | `/api/files/{fileId}/url` | Get a file link | B.8 Student submission and files |
| INS-01 | GET | `/api/submissions/{submissionId}` | Get the Submission screen | B.9 Instructor submission actions |
| INS-02 | POST | `/api/submissions/{submissionId}/approve` | Approve | B.9 Instructor submission actions |
| INS-03 | POST | `/api/submissions/{submissionId}/reopen` | Reopen an approved submission | B.9 Instructor submission actions |
| INS-04 | POST | `/api/assignments/{assignmentId}/students/{studentId}/grant-attempts` | Grant attempts to a student | B.9 Instructor submission actions |
| INS-05 | POST | `/api/assignments/{assignmentId}/students/{studentId}/allow-late` | Allow a late submission for a student | B.9 Instructor submission actions |
| INS-06 | POST | `/api/submissions/{submissionId}/rerun` | Re-run AI grading for a manual-review item | B.9 Instructor submission actions |
| INS-07 | POST | `/api/submissions/{submissionId}/regrade` | Re-grade an approved submission | B.9 Instructor submission actions |
| INS-08 | POST | `/api/submissions/{submissionId}/regrade/approve` | Approve the pending re-grade | B.9 Instructor submission actions |
| INS-09 | POST | `/api/submissions/{submissionId}/regrade/keep-previous` | Keep the previous grade | B.9 Instructor submission actions |
| INS-10 | POST | `/api/submissions/{submissionId}/comment` | Save the instructor comment | B.9 Instructor submission actions |
| INS-11 | POST | `/api/submissions/{submissionId}/manual-grade` | Enter a manual grade and approve | B.9 Instructor submission actions |

## Appendix C: Provider facts to verify

These are the items marked **verify** in Part C. None is needed to write the spec, but each must be settled before the matching code is written. Spikes come from TRD §17.1.

| Fact | Where | Settled by |
|---|---|---|
| Gemini inline payload limit (20 MB or 100 MB, base64) | C.1 | S3 |
| Gemini `promptFeedback.blockReason` shape and status code | C.1 | S3 |
| Gemini per-minute and per-day limits for the chosen model | C.1 | S3 |
| Gemini daily versus per-minute quota error details | C.1 | S3 (TQ3) |
| Files API retention (48 hours, third-party source) | C.1 | Not used in v1; confirm before any change |
| Supabase pooler username form (`role.project-ref`) | C.3 | S2 |
| Vercel request-body limit for external rewrites | C.6 | S1 (10 MiB upload) |
| Brevo SMTP host, port, and daily limit (300 per day, from its help center) | C.5 | S5 |
| UptimeRobot free-plan interval and monitor count | C.8 | Setup |
| Render free-plan terms (RAM, spin-down, instance hours) | C.7 | Before launch |
| pg-boss option names (`deleteAfterSeconds`, `archiveCompletedAfterSeconds`, graceful stop) | C.7, Backend Schema §11 | Scaffold |
