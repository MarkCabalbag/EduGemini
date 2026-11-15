# App Flow Document: EduGemini (v1)

## 1. Authentication & Onboarding
1. **Landing/Signup**: User chooses to sign up via email/password or Google OAuth.
2. **Role selection**: User explicitly picks "I am a Student" or "I am an Instructor" during signup. This sets their account type going forward.
3. **Login**: Returning users log in via email/password or Google; routed to their role-appropriate dashboard.

## 2. Dashboard (Home Screen)
- Both roles land on a **list of their classes** (cards/list view) after login.
  - Instructor: classes they created.
  - Student: classes they've joined.
- Clicking a class opens that class's assignment list.
- Empty state (no classes yet): instructor sees a prominent "Create your first class" CTA; student sees a "Join a class with a code" input.

## 3. Instructor Flow: Class Management
1. **Create class** → name the class → system generates a unique class code + shareable join link.
2. **Class page** displays: the code and join link (copy buttons for each), list of enrolled students, list of assignments, and a gradebook tab.
3. Instructor can view/remove enrolled students from the class page (roster management).

## 4. Instructor Flow: Create Assignment (multi-step wizard)
1. **Step 1 — Basic info**: assignment title.
2. **Step 2 — Criteria**: free-text grading criteria/instructions field.
3. **Step 3 — Due date & scoring format**: set due date; choose scoring format (points/max, percentage, or letter+numeric).
4. **Review step**: summary of all fields before confirming → "Publish assignment."
5. Published assignment appears on the class's assignment list, visible to enrolled students.
6. **Editing after publish**: instructor can reopen any step and edit criteria/due date at any time; saving changes triggers automatic re-grading of all existing submissions for that assignment (UI should show a confirmation warning before this re-grade is triggered, given it affects already-graded student work).

## 5. Student Flow: Join Class & Submit
1. **Join class**: student enters a class code (or follows a join link) → added to class roster → class appears on their dashboard.
2. **Assignment detail page**: shows title, free-text criteria, due date, scoring format. If not yet submitted, shows an upload control.
3. **Upload**: student selects one or more files (PDF or image) → submits.
4. **Confirmation**: inline confirmation on the same assignment page ("Submitted — grading in progress").
5. **Feedback appears inline** on the same assignment page once grading completes: overall score (in the chosen format) + narrative feedback, tagged with an "AI-generated" chip.
6. **Resubmission**: while status is "AI-generated" (not yet instructor-approved), the student can re-upload files from the same page, replacing prior files and re-triggering grading. Once "Instructor-approved," the upload control is disabled unless the instructor reopens it.
7. **Late submission**: if the due date has passed, the upload still succeeds, but the resulting submission is internally flagged "late" for the instructor's view (student isn't blocked).

## 6. Instructor Flow: Review Queue
1. Instructor opens the **Review Queue** (accessible from the dashboard or per-class).
2. **Ordering**: flagged items first (needs-manual-review due to AI grading failure, or late submissions), then the remaining queue oldest-submitted-first.
3. Each queue item, when opened, shows: the original uploaded file(s) rendered/viewable alongside the AI's score and narrative feedback.
4. Instructor can **edit** the score and/or feedback text directly, then **approve**.
5. On approval: student-facing chip updates from "AI-generated" to "Instructor-approved"; student is notified; submission locks against further resubmission (until/unless instructor reopens it).
6. **Manual-review fallback item** (AI grading failed after retries): instructor sees this item flagged distinctly in the queue and must grade/approve it manually (no AI score pre-filled, or a clear "AI grading failed" indicator).

## 7. Gradebook
- Per-class tab showing a table: students (rows) × assignments (columns) × score + status (AI-generated / late / instructor-approved).
- **CSV export** button on this view.
- Students do not see this table; they only see their own scores on their own assignment pages, plus anonymized class-wide average stats per assignment.

## 8. Notifications
- Triggered events: submission graded (AI), instructor approved a grade, (instructor-facing) new submission awaiting review.
- Delivered both in-app and via email.
- **Clicking a notification deep-links directly to the relevant item** (e.g., straight to the graded assignment page, or straight to that submission in the review queue) — not to a generic notification list.

## 9. Error & Edge States
- **Transient AI failure** (API error/timeout): system retries automatically a couple of times; submission shows a "grading in progress" state to the student throughout, with no visible error unless it ultimately lands in the manual-review fallback.
- **File-quality failure** (corrupted/unreadable file): student sees an immediate error on the assignment page asking them to re-upload; no retry attempted.
- **Class code reuse/invalid code**: student sees a clear "invalid code" error on the join screen.

## 10. Super Admin Flow (minimal, v1)
- Separate admin view (not part of regular instructor/student navigation) listing all accounts and classes platform-wide, with the ability to manage (e.g., disable) accounts. Full detail deferred to the Security & Access document.
