# App Flow Document: EduGemini (v2.2)

**Aligned to:** [PRD v2.2](prd.md) | Earlier version archived at `docs/archive/app-flow-v1.md`

> Requirement IDs in brackets (for example `[FR-CLS-07]`) point to the PRD for acceptance criteria. Priorities (Must / Should / Could) are in the PRD; flows marked **(Could)** are cut first if the schedule slips. Defaults the PRD assumed on the owner's behalf are referenced as A1 to A16 (PRD Section 16.2). Flow-level defaults that the PRD does not cover are listed in Section 15.

## Navigation Map

**Global header (signed in):**

- **Logo**: goes to the Dashboard (class list).
- **Review Queue** (instructors only): badge shows items awaiting review.
- **Notifications**: bell with an unread count.
- **Settings**: Account (name, password, delete account) and AI / Gemini key (instructors only).

**Class page tabs:**

| Role | Tabs |
|---|---|
| Instructor | Overview · Assignments (each opens its tracker and edit view) · People · Gradebook · Announcements (Could) |
| Student | Assignments (each opens its detail page) · Announcements (Could) |

**Super Admin** uses a separate admin area: Accounts · Classes · Platform health (Could) · Audit log.

## Screen Inventory and Access Rules

### Screens

| Area | Screens | Who can open |
|---|---|---|
| **Public** | Landing, Sign up, Sign in, Forgot password, Reset password (from email link), Verify email (from email link), Join-link landing, Terms, Privacy Notice | Anyone |
| **Both roles** | Dashboard, Notifications center, Settings > Account (name, password, delete account) | Signed-in students and instructors |
| **Student** | Join a class, Class page (assignment list, announcements), Assignment detail (upload and result) | Student; class screens need an Approved membership |
| **Instructor** | Settings > AI (Gemini key), Create class, Class Overview, Assignments tab (published and Drafts), Assignment wizard (create and edit), Assignment tracker, People, Gradebook, Announcements, Review Queue, Submission screen | Instructor, for their own classes only |
| **Super Admin** | Accounts, Classes, Platform health, Audit log | Super Admin only |

### Access rules

1. **Signed out, protected page**: the user is sent to sign-in and then returned to the page they asked for. This covers email links and notification links. With no target, they land on their dashboard.
2. **Wrong role** (for example a student opens an instructor URL): a generic "You don't have access to this page" screen with a link home. It does not reveal whether the item exists.
3. **Student without an Approved membership** (non-member, Declined, or Removed): the same generic no-access screen. A Pending student sees the "Pending approval" screen instead.
4. **Suspended account**: only "Account suspended" is reachable.
5. **Missing or deleted item**: "This item is no longer available" with a link to the dashboard.
6. **Signed in, opening sign-in or sign-up**: redirected to the dashboard.
7. **Session expires mid-task**: the user signs in and returns to the same page. An unfinished assignment wizard is already saved as a draft (Section 5.1). An in-progress upload is not resumed; the student re-selects the files.

## 1. Authentication & Onboarding

1. **Landing/Signup**: user signs up with email and password. Sign-up collects first and last name (display name in rosters and gradebooks) and requires accepting the Terms and Privacy Notice, which say submissions are processed by Google Gemini and reviewed by the instructor. `[FR-AUTH-01, 09]`
   - Password of at least 10 characters; duplicate email rejected with a clear message.
2. **Role selection**: user explicitly picks "I am a Student" or "I am an Instructor". The role is set once; one role per account in v1 (A6). There is no role switching: a user who picked the wrong role deletes the account (step 8) and signs up again, and the email becomes available again. `[FR-AUTH-03]`
3. **Email verification**: a banner offers to resend the verification email. Unverified users can use the app but get no email notifications until verified (A2). `[FR-AUTH-04]`
   - Opening the link shows "Email verified" and removes the banner. If the user is signed out, it then prompts sign-in.
   - An expired or already-used link shows "This link is no longer valid" with a "Send a new link" action.
4. **Login**: returning users log in with email and password and land on their role-appropriate dashboard. A wrong email or password shows one generic message ("Email or password is incorrect") that does not reveal whether the email has an account; repeated failures are rate-limited with a "try again later" message. Sessions expire after inactivity; users can sign out of all devices. `[FR-AUTH-06]`
5. **Password reset** `[FR-AUTH-05]`:
   - The user enters their email. The screen always says "If that email has an account, we sent a link", whether or not it does.
   - The link opens a "Set new password" form (at least 10 characters). It expires after 60 minutes and works once. On success the user's other sessions are signed out and they sign in with the new password.
6. **First-run guidance (Could)**: the dashboard shows a dismissible "how to get started" panel. Instructor steps: add your Gemini key, create a class, create an assignment, share the code. Student steps: join a class, submit. `[FR-AUTH-08]`
7. **Account settings** (all roles): update display name; change password (current password required). `[FR-AUTH-07]`
8. **Delete account** (students and instructors): Settings > Account > Delete account. The user re-enters their password and types DELETE to confirm, then is signed out. `[FR-AUTH-10]`
   - **Instructors** first see the consequences: their classes are archived and later deleted, their Gemini key is deleted, and their students are notified.
   - **Students** are told their personal data and uploaded files are deleted, and that their instructor keeps only an anonymized "Deleted student" row with score and status (A14).

## 2. Instructor Setup: Gemini Key

Each instructor connects their own Gemini API key before AI grading can run. `[FR-KEY-01 to 07]`

1. **Where**: Settings > AI, or the "Add your Gemini key" step in the getting-started panel or the banner shown while no valid key exists.
2. **Help**: inline steps with a link to get a free key from Google AI Studio. `[FR-KEY-07]`
3. **Disclosure**: before the first save, a notice explains that student work is sent to Google Gemini under this key, that on Google's free tier content may be used by Google to improve its products, and that paid-tier terms differ (verify Google's current terms). The instructor must tick "I understand". `[FR-KEY-04]`
4. **Save and validate**: the app makes a test call. Success shows "Connected". Failure shows a specific reason (invalid key, API not enabled, quota reached, network problem). `[FR-KEY-02]`
5. **After saving**: only the last 4 characters are shown; the key can be replaced or removed. Status shows Connected, Needs attention, or Quota reached, plus the last successful grading time. A "Test connection" action re-checks the key. `[FR-KEY-03, 06]`
6. **No valid key**: the instructor can still create and publish assignments (A8). A persistent banner explains that AI grading is off; student submissions go to **Needs manual review**. See Section 11 for what happens when a key later fails.
7. **After a key is fixed or replaced**: when a valid key is saved and submissions are waiting in Needs manual review because of a key or quota problem, a prompt offers "Re-run AI grading on N submissions". The instructor chooses; nothing re-runs automatically, because re-running spends their quota. `[FR-KEY-05]`

## 3. Dashboard (Home Screen)

- Both roles land on a **list of their classes**. A dismissible getting-started panel appears at the top (Could). A notification bell with an unread count is in the global header. `[FR-NTF-01]`
- **Instructor**: classes they created, shown with section, subject, and room when set. A badge shows pending join requests when approval is on. Archived classes are hidden by default, with a toggle to show and restore them. `[FR-CLS-06]`
- **Student**: the "Enrolled" list shows every class with a status chip: **Approved**, **Pending**, or **Declined**. Only Approved classes open. Pending shows "Pending approval"; Declined shows "Declined"; neither exposes class content. Archived classes stay in the list, marked Archived, and open read-only. A removed student's class disappears from the list. If the instructor's account is suspended, the class shows "Temporarily unavailable". `[FR-CLS-08]`
- **Empty states**: an instructor with no classes sees a prominent "Create your first class" call to action (and the key banner if no key is connected). A student with no classes sees a "Join a class with a code" input.
- Instructors always see a **Create class** button; students always see **Join a class**. Clicking an Approved class opens that class's page.

## 4. Instructor Flow: Class Management

1. **Create class**: name (required); optional description, section, subject, and room. The instructor ticks an attestation: they have the authority to collect and upload their students' work, and students (or guardians where required) have been told it is processed by AI. The system then generates a unique 8-character class code and a shareable join link. The instructor lands on the class Overview, which shows the code and link and prompts the next steps: create the first assignment, and add a Gemini key if none is connected. `[FR-CLS-01, 02, 09]`
2. **Class settings**: "Require approval to join" toggle, **off by default**. `[FR-CLS-07]`
3. **Class page** has these areas:
   - **Overview**: the code and join link with copy buttons; regenerate and disable controls for the code (the join link follows the code; existing members are unaffected). `[FR-CLS-04]`
   - **Assignments**: published list, filterable by label (Could), with a **Drafts** section at the top that only the instructor sees (Resume or Delete). Each assignment opens to its tracker (Section 8).
   - **People**: roster and join requests (below).
   - **Announcements (Could)**: see Section 9.
   - **Gradebook**: see Section 8.
4. **People view** `[FR-CLS-05, 07]`:
   - Approval **off**: students who enter the code are Active immediately. The instructor can remove a student; removal hides them from the active gradebook but keeps their submission history, and can be reversed. Their submissions also leave the review queue and tracker (and return if they are reinstated), and the class disappears from their Enrolled list.
   - Approval **on**: new joiners are Pending. The view shows counts of Approved, Pending, and Declined. The instructor can approve, decline, reverse either decision, or remove an approved student.
   - Turning approval on never changes existing Active students. Turning it off does not auto-approve Pending students; the instructor is offered "Approve all pending".
   - The view shows only the name and email people gave at sign-up; no demographic fields.
5. **Archive class**: makes the class read-only; it can be restored. `[FR-CLS-06]`
6. **Edit class details**: name, description, section, subject, and room can be changed at any time; the code and members are unaffected. `[FR-CLS-10]`
7. **Delete class**: Overview > Delete class. The dialog offers "Archive instead", offers a gradebook CSV download first, and states how many students, assignments, and submissions will be permanently removed. The instructor types the class name to confirm. Everything in the class is deleted immediately, and approved students are notified. `[FR-CLS-11]`

## 5. Instructor Flow: Assignments

### 5.1 Create assignment (multi-step wizard) `[FR-ASG-01 to 11]`

1. **Step 1: Basic info**: title (required), instructions (optional), and a label (Could; pick or create one). The assignment is autosaved as a draft after this step, so leaving the wizard never loses progress.
2. **Step 2: Criteria**: free-text grading criteria (required), with inline guidance and examples. Optional **reference files**: up to 3 PDF/JPG/PNG files (rubric image, answer key, model solution). Each file has a **"Visible to students" toggle, off by default**. Gemini always receives the files, labeled as reference material. `[FR-ASG-07]`
3. **Step 3: Due date and scoring**: due date, time, and timezone; scoring format (points/max, percentage, or letter + numeric); max score. For letter + numeric, show the default letter scale with adjustable ranges. The format cannot be changed after any submission exists (A13). `[FR-ASG-02, 06]`
4. **Step 4: Submission rules**:
   - **Resubmissions allowed after the first submission**: 0 to 10, or Unlimited; default 3. `[FR-ASG-10]`
   - **Accept late submissions**: on by default. `[FR-ASG-11]`
5. **Review step**: summary of all fields, then **Save as draft** (invisible to students; it appears in the Drafts section of the class Assignments tab, where the instructor can resume editing or delete it) or **Publish assignment**. Publishing warns, but does not block, when the due date is already in the past (every submission will be Late) or when no valid Gemini key is connected (A8). On publish, approved students are notified (Section 10). `[FR-ASG-03]`
6. Published assignments appear on the class's assignment list, visible to approved students.

### 5.2 Edit after publish `[FR-ASG-04, 05]`

The instructor can reopen any step. What happens on save depends on what changed:

| Change | Result |
|---|---|
| **Criteria** or **reference files** (added, removed, replaced) | Confirmation dialog states how many submissions will be re-graded, that their AI scores will be replaced, and that re-grading uses the instructor's Gemini quota. On confirm, **unapproved** submissions are re-graded; students are notified the score may have changed. **Approved** submissions are not touched; they are flagged "Criteria changed since approval" and can be found with the tracker's "Criteria changed" filter, where the instructor can re-grade them individually or in bulk with "Re-grade selected" (A3). While a re-grade awaits review, the student keeps seeing the approved grade (Section 7, step 11). Rapid successive edits are combined into one confirmation. |
| **Due date** | Late flags are recomputed for all submissions. No re-grade. Approved students are notified of the new due date (Section 10). |
| Title, instructions, label, resubmission limit, late policy, reference-file visibility | Saved immediately. No re-grade. Lowering the resubmission limit never removes attempts already used. |

Re-grades never consume a student's resubmission attempts. While a re-grade runs, the assignment's tracker shows a progress banner ("Re-grading 18 of 40"). If the instructor's quota runs out partway, finished items keep their results and the rest go to Needs manual review (Section 11).

### 5.3 Archive, delete, and labels

- **Archive** (recommended default): hides the assignment from students and keeps all submissions and grades; restorable. **Delete** is permanent and requires a confirmation that states how many submissions will be removed and asks the instructor to type the assignment title. `[FR-ASG-09]`
- **Labels (Could)**: the instructor creates and deletes custom labels and tags assignments. Deleting a label never deletes assignments; they become unlabeled. `[FR-ASG-08]`

## 6. Student Flow: Join Class & Submit

1. **Join class**: the student enters a class code (case-insensitive) or follows a join link. An invalid code shows a clear error; repeated invalid attempts are rate-limited; joining twice with the same code does nothing new. `[FR-CLS-03]`
   - **Join link while signed out**: the code is kept through sign-in or sign-up, and sign-up preselects Student. After signing in or signing up, the join continues automatically. A student who is already signed in sees the class and presses **Join class**, so opening a link never joins anyone by itself. A signed-in instructor who opens a join link sees "Instructor accounts can't join classes".
   - **Codes that don't work**: the code of an archived class, or a disabled or regenerated code, reads as invalid and shows no class information. A removed student who re-enters the code stays Removed and sees "You can't join this class right now. Contact the instructor."
   - Approval **off**: the student is added immediately and the class appears on their dashboard.
   - Approval **on**: the class appears as **Pending approval**. The student is notified when approved or declined. A declined student who re-enters the code stays Declined until the instructor reverses it.
2. **Class page**: the assignment list (nearest due date first; filterable by label), announcements (Could), and anonymized class stats once available (step 10). Each assignment row shows the title, label (Could), due date, and the student's own status chip: Not submitted, Grading in progress, AI-generated, Awaiting instructor review, Instructor-approved, Late, or Closed (past due and late submissions are not accepted). With no assignments, the page says "No assignments yet." An archived class opens read-only: assignments and feedback can be viewed, but nothing can be submitted.
3. **Assignment detail page** shows: title, instructions, criteria, any reference files the instructor marked visible, due date (shown in the viewer's local time), scoring format, late policy, and **"N resubmissions left"** (or "Unlimited resubmissions"). It also states that scores and feedback are AI-generated and reviewed by the instructor, and that grade questions go to the instructor. `[FR-AI-07, FR-SUB-09]` If not yet submitted, an upload control is shown.
4. **Upload**: limits are shown before upload (10 files, 10 MB each, 15 MB total, 20 pages per PDF). PDF, JPG, and PNG are accepted; iPhone HEIC photos are converted automatically (A12); other types are rejected at selection with a clear message. Before submitting, the student sees thumbnails of the selected files and can reorder them, remove one, or add more (on phones the picker offers the camera and photo library). Progress is shown; interrupted uploads can be retried without losing uploaded files; the submission counts only once all files are stored. After submitting, the student can view and download their own files. `[FR-SUB-01 to 03]`
5. **Confirmation**: inline receipt on the same page with timestamp and file list, and "Grading in progress, usually about a minute". The page updates by itself when the result is ready. When many submissions are queued, a note says it may take longer than usual. `[FR-SUB-08; PRD Sections 9.5 and 9.8]`
6. **Feedback appears inline** once grading completes: overall score in the chosen format plus narrative feedback, tagged with an **AI-generated** chip (visible immediately, A7). `[FR-AI-03]`
7. **Resubmission**: until the instructor approves, and while attempts remain, the student can re-upload from the same page. New files replace prior files, grading re-runs, and one attempt is used. If a resubmission arrives while grading is in flight, the latest version wins. At **0 left**, the resubmit control is replaced by a message explaining the limit (the instructor can grant more attempts or reopen the submission). A failed upload or unreadable file never uses an attempt. A resubmission that ends in Needs manual review because of a system problem (Gemini failure, key or quota problem) still uses an attempt; the instructor can give it back (Section 7, step 8). `[FR-SUB-05, 07, 09]`
8. **Late submission** `[FR-SUB-04, FR-ASG-11]`:
   - If late is accepted (default): the upload succeeds and is shown as **Late** to the student and the instructor. Late is based on the latest submission time (A4).
   - If the instructor closed late submissions: the upload is blocked with a clear message. The instructor can allow an individual late submission, which unlocks that student's upload for the assignment (A11); the student is notified.
9. **After approval**: the student sees a read-only view with the final score, feedback, the separate **Instructor comment** (if any), and an **Instructor-approved** chip. There is no resubmit control unless the instructor reopens the submission, in which case the student is notified. If a resubmission and an approval collide, approval wins and the student sees why resubmitting failed. If the instructor later re-grades the submission, the student keeps seeing the approved grade until the new result is approved. `[FR-SUB-06, FR-REV-09]`
10. **Class stats**: the student sees anonymized class-wide stats per assignment (class average and number of graded submissions only) from approved scores only, hidden until at least 5 graded submissions exist (A5). Students never see another student's individual data.
11. **Instructor changes the criteria or reference files**: an unapproved submission goes back to "Grading in progress" (the earlier AI result is hidden, because it was graded against the old criteria). The student is notified when the new result is ready. Approved submissions are not affected. `[FR-ASG-04]`

## 7. Instructor Flow: Review Queue

Every route to a single submission (a queue item, a tracker row, a gradebook cell, or a notification link) opens the same **Submission screen**. It holds all instructor actions for that submission: view files, edit and approve, comment, reopen, re-run or re-grade, grant attempts, and allow late. Approved submissions are not in the queue; the instructor reaches them through the tracker or gradebook.

1. **Open** the Review Queue from the header link (all classes), or from a class's Overview, which opens it filtered to that class. It lists AI-generated (unapproved) submissions, Needs-manual-review submissions, and re-grades of approved submissions awaiting review, filterable by class, assignment, and status, and sortable by submission time and Late. `[FR-REV-01]`
2. **Default ordering**: flagged items first (Needs manual review, Late, or the low-confidence/readability marker), then the remaining queue oldest-submitted first.
3. **Open an item**: the original uploaded file(s) are shown beside the AI score and narrative feedback, using a PDF page viewer and an image viewer, without leaving the page. The item also shows the Late flag, the first and latest submission times (A4), resubmissions left, and any "Criteria changed since approval" flag. `[FR-REV-02]`
4. **Edit and approve**: the instructor can edit the score (numeric input validated against the assignment's range and format; for letter + numeric the letter updates from the scale) and the feedback text, then approve. Edits are recorded and approvals are classified as edit-free, score-only, feedback-only, or both. `[FR-REV-03, 08]`
5. **Instructor comment**: an optional separate comment, shown to the student as "Instructor comment". It is never sent to Gemini and does not count as editing the AI feedback. `[FR-REV-09]`
6. **On approval**: the chip changes from AI-generated to **Instructor-approved**, the student is notified, and the submission locks against resubmission. `[FR-REV-04]`
7. **Bulk approve (Could)**: select several unedited AI-generated items and approve them after a confirmation step. `[FR-REV-07]`
8. **Needs-manual-review items**: flagged distinctly, with the cause shown (AI failed after retries, or key problem). No AI score is pre-filled. The instructor either enters score and feedback from scratch or re-runs AI grading, individually or in bulk after fixing the key or waiting for quota to reset. Because the student's resubmission still used an attempt, a system-caused item also offers "Give attempt back", which opens the grant-attempts dialog with 1 prefilled. `[FR-REV-06, FR-SUB-10]`
9. **Reopen an approved submission**: re-enables resubmission and returns the chip to its prior state; the student is notified. The reopen dialog includes "also grant N attempts", defaulting to 1 when the student has none left, so a reopened student is never blocked. `[FR-REV-05]`
10. **Per-student overrides** (here or in the tracker): grant extra resubmission attempts (enter a number), or allow a late submission when late is closed. Both are logged and notify the student. `[FR-SUB-10]`
11. **Re-grade an approved submission** (from the tracker's "Criteria changed" filter or a single submission): the student keeps seeing the approved, locked grade. The new AI result appears in the queue as "Re-grade pending review", shown beside the current approved grade. The instructor either approves it (the student is notified and sees the new grade) or chooses "Keep previous grade", which discards the new result. `[FR-REV-10]`
12. **Submission changed while open**: if the student resubmits, or a re-grade finishes, while the instructor has the item open, a banner says "Student resubmitted, reload to see the latest". Unsaved edits are not applied to the new version.

## 8. Assignment Tracker & Gradebook

### 8.1 Assignment submission tracker `[FR-GB-04]`

- A header shows the class stats for this assignment (class average and number of graded submissions), the same numbers students see.
- Per assignment, for approved students: counts of **Turned in** (any valid submission; Late and Needs manual review ones are subsets), **Late**, **Missing** (past due, nothing submitted), **Not yet due** (before the due date, nothing submitted), and **Needs manual review**.
- Queued and Grading submissions appear with the status "Grading in progress".
- A **"Criteria changed"** filter lists approved submissions flagged after a criteria or reference-file edit, with a bulk **"Re-grade selected"** action (Section 7, step 11).
- Search by student name; multi-select filter by status.
- Each student row expands to show submission time, current score, status, resubmissions left, feedback, instructor comment, and the submitted files. The override actions from Section 7 step 10 are available here.
- **Export this assignment (Could)**: CSV with student name, status, submission time, late flag, score, AI feedback, and instructor comment. `[FR-GB-05]`

### 8.2 Gradebook `[FR-GB-01 to 03, 06]`

- Per-class tab: a table of students (rows) x assignments (columns), showing the score in each assignment's own format plus status: AI-generated, Late, Instructor-approved, Needs manual review, or Not submitted. An approved submission with a re-grade waiting for review shows Instructor-approved with a "Re-grade pending" marker. There are no cross-assignment totals.
- Filter by label (Could). Archived assignments are hidden by default; a "Show archived" toggle reveals them. Removed students are hidden but their history is kept.
- **CSV export** button on this view (UTF-8 with BOM so it opens correctly in Excel and Google Sheets).
- Clicking a cell opens that student's Submission screen (Section 7). A "Not submitted" cell opens the student's row in the tracker, where "Allow late submission" is available.
- Students do not see this table; they see only their own scores on their own assignment pages, plus anonymized class stats.

## 9. Announcements (Could)

A one-way class feed with no comments or reactions. `[FR-ANN-01 to 05]`

1. **Post**: the instructor adds a title, a description, and an optional attachment (PDF, JPG, PNG; same limits as submissions). Newest first.
2. **View**: approved students see the stream and can download attachments. Pending and declined students cannot.
3. **Delete**: after a confirmation, it disappears from students' streams immediately. The announcement and its files are deleted completely. A notification link to it shows "This item is no longer available".
4. **Notify**: approved students get an in-app notification; email follows their preferences (default: digest).

## 10. Notifications

- **In-app**: a notification center with an unread count. **Clicking a notification deep-links directly to the relevant item** (the graded assignment page, the submission in the review queue, the class People view, the key settings), not to a generic list. The center lists newest first with unread items highlighted; opening an item marks it read, and a "Mark all read" action is available. If the target is no longer available (deleted, archived, or no access), the user sees "This item is no longer available" with a link back to the dashboard. A link opened while signed out goes to sign-in and then on to the target (Access Rules). `[FR-NTF-01]`
- **Email**: sent to verified addresses only (account suspension and reinstatement notices go to the address on file), with a deep link. Instructor emails for new submissions and join requests are digested (Could). Users can turn email off per category; in-app cannot be disabled (Could). `[FR-NTF-02 to 04]`

The full event list (recipient, in-app, and email) is the matrix in PRD Section 10.

## 11. Error & Edge States

- **Transient AI failure** (API error, timeout, short rate limit, invalid output): the system retries silently a capped number of times. The student sees "Grading in progress" throughout, with no visible error unless it ends in Needs manual review ("Submitted, awaiting instructor review"). `[FR-AI-04]`
- **Key problem or exhausted quota**: grading is skipped; submissions go to Needs manual review with the cause shown to the instructor; the instructor gets a persistent banner and a notification; the student sees the same neutral message as above. After the fix or quota reset, the instructor re-runs AI from the queue. If the instructor removes the key while submissions are queued, those submissions move to Needs manual review. Resubmissions that land there still use a student attempt; the instructor can give it back. `[FR-KEY-05]`
- **File-quality failure** (corrupted, unreadable, password-protected, blank): no retry. The student sees an immediate, specific error on the assignment page asking them to re-upload; no attempt is used. `[FR-AI-05]`
- **Blank, rotated, or low-resolution images**: flagged as a readability issue; may produce a file error or the low-confidence marker in the queue.
- **Invalid or reused class code**: a clear "invalid code" error on the join screen; repeated attempts are rate-limited.
- **Disabled or regenerated code**: the old code no longer works; existing members are unaffected.
- **Score edited out of range**: blocked with inline validation.
- **Account deleted** (by the user, Section 1 step 8, or by the Super Admin): for a student, personal data and uploaded files are deleted and the instructor sees an anonymized "Deleted student" row with score and status only. For an instructor, their key is deleted, classes are archived and later deleted, and students are notified.
- **Suspended account**: sign-in shows "Account suspended" and nothing else is reachable. A suspended instructor's classes show to students as "Temporarily unavailable".
- **Disputes**: no in-app flow in v1; the student pages tell students to take grade questions to the instructor.
- **Quota runs out during a re-grade or bulk re-run**: items already finished keep their results; the rest go to Needs manual review with the cause "quota". The instructor gets the key notification and can re-run the remainder later (Section 2, step 7).
- **Empty states**: Review Queue shows "All caught up". A class with no assignments shows instructors "Create your first assignment" and students "No assignments yet". People with no students shows the class code and join link. A tracker or gradebook with no approved students says "No students yet" with a link to the code. Notifications shows "You're all caught up". Announcements (Could) shows "No announcements yet".
- **Loading and request failures**: pages show a loading placeholder. A failed request shows a clear message with a Retry action and never loses what the user typed. Pages that update on their own (grading status, queue badge) fall back to periodic refresh if the live connection drops.
- **Error pages**: a generic "not found or no access" page (it never says whether the item exists), a "Something went wrong" page with Retry, and a maintenance page.

## 12. Super Admin Flow (minimal)

A separate admin view, outside regular instructor and student navigation. The Super Admin has metadata-only access: no student submission content, no instructor actions, and no way to read any API key (A1). `[FR-ADM-01 to 04]`

- **Admin accounts** are created outside the app (seeded by the owner); there is no public sign-up for admins.
- **Accounts**: search, view, suspend, reinstate, and delete any instructor or student account. Suspending or reinstating takes an optional reason, asks for confirmation, and emails the user (A16). A suspended user cannot sign in and sees "Account suspended".
- **Classes**: view, archive, and delete any class. Deleting notifies the instructor and approved students. Admin approval is not required for instructors to create or use a class.
- **Platform health (Could)**: grading success rate, manual-review fallback rate, key and quota error rate, queue depth.
- **Audit log**: every admin action is logged with actor, target, and timestamp.

## 13. System-initiated Flows

Things that happen without a user clicking anything.

| Trigger | What the system does | What users see |
|---|---|---|
| Submission stored | Queues a grading job for the instructor's key. Jobs for one key are paced to stay inside its limits. Calls Gemini, validates the result, retries silently a capped number of times, and discards results for outdated versions | Student: "Grading in progress", then the result. Instructor: new item in the queue and a notification |
| Grading ends in a system failure or key problem | Sets Needs manual review with the cause and counts it for platform health | Student: the neutral "awaiting instructor review" message. Instructor: flagged item, plus the key banner if key-related |
| Due date passes | Students with no submission move from Not yet due to Missing in the tracker. If late is closed, uploads are blocked except for individually allowed students | Tracker counts update; students see Late or Closed |
| Due date is edited | Late flags are recomputed; no re-grade | Approved students are notified |
| Criteria or reference files edited and confirmed | Edits are combined; unapproved submissions are re-graded; approved ones are flagged | Re-grade progress banner; student notifications |
| Key status changes (invalid, quota reached, later working again) | Status updates on the next grading call or when the instructor uses "Test connection" (never on a timer, to protect their quota); the instructor is notified when it needs attention. Nothing re-runs automatically | Key settings, banner, notification |
| Verification or reset link ages out | The link stops working (reset: 60 minutes; verification: set in the TRD) | "This link is no longer valid" with a way to get a new one |
| Session goes idle | The session expires | Next action asks for sign-in, then returns to the page |
| Digest window closes (Could) | Batches new submissions, join requests, and announcements into one email | Digest email |
| 30 days before archived-class data reaches 12 months (A15) | Sends the instructor a deletion notice with a gradebook CSV link, if the account still exists. At 12 months the data is deleted | Notification and email |
| Instructor account deleted | Deletes the key, archives the classes, and notifies students. Class data is deleted later under the retention rule | Students see the class as archived and read-only until deletion |
| Account suspended | Ends the user's sessions | Next sign-in shows "Account suspended" |

## 14. Status Reference

**Submission states** (PRD Section 8.1): Uploading, Queued, Grading, AI-generated, Needs manual review, File error, Instructor-approved. **Late** is a flag layered on any state. **Missing** and **Not yet due** are tracker views, not states.

**Enrollment states** (PRD Section 8.3): Active (shown to users as "Approved"), Pending, Declined, Removed.

| Student sees | When |
|---|---|
| "Grading in progress, usually about a minute" | Queued or Grading |
| Score + feedback + **AI-generated** chip + attempts left | AI-generated |
| "Submitted, awaiting instructor review" | Needs manual review (AI failure or key problem) |
| Immediate re-upload error | File error |
| Final score + feedback + Instructor comment + **Instructor-approved** chip, read-only | Instructor-approved |
| The same approved grade, unchanged | Approved, with a re-grade waiting for instructor review |

## 15. Flow-level Defaults (assumed; override any)

These fill gaps the PRD does not cover. They affect screens and behavior only, not requirements.

| # | Default | Where it applies |
|---|---|---|
| F1 | Drafts live in a Drafts section on the class Assignments tab, instructor-only, with Resume and Delete | 5.1 |
| F2 | A join link keeps the code through sign-in or sign-up; sign-up preselects Student; a signed-in instructor sees "Instructor accounts can't join classes" | 6 step 1 |
| F4 | Before submitting, students see thumbnails and can reorder, remove, and add files; afterwards they can view and download their own files | 6 step 4 |
| F5 | Archived classes stay visible to students, read-only; removed students' classes disappear; a suspended instructor's classes show "Temporarily unavailable" | 3, 6, 11 |
| F6 | The review queue lists reviewable items only; Queued and Grading show as "Grading in progress" in the tracker | 7, 8.1 |
| F7 | Tracker counts: Turned in includes Late and Needs manual review; Missing is past due with nothing submitted; Not yet due is before the due date with nothing submitted | 8.1 |
| F8 | Approved items flagged for criteria changes are found through the tracker's "Criteria changed" filter, with bulk "Re-grade selected" | 5.2, 8.1 |
| F9 | If a submission changes while the instructor has it open, a "reload" banner appears and unsaved edits are not applied to the new version | 7 step 12 |
| F10 | The notification center lists newest first, marks items read on open, has "Mark all read", and shows "This item is no longer available" for unreachable targets | 10 |
| F11 | Class stats show class average and graded count only; the instructor sees the same numbers at the top of the tracker | 6 step 10, 8.1 |
| F12 | A removed student's submissions leave the queue and tracker, and return if they are reinstated | 4 |
| F13 | Due dates are shown in the viewer's local time | 6 step 3 |
| F15 | The assignment wizard autosaves a draft after step 1 | 5.1 |
| F16 | Publishing warns, but does not block, on a past due date or a missing key | 5.1 |
| F17 | After a valid key is saved, a prompt offers to re-run key-caused manual-review items; nothing re-runs automatically | 2 step 7 |
| F18 | Re-grades show a progress banner; if quota runs out partway, the rest go to manual review | 5.2, 11 |
| F19 | One Submission screen is the target of queue items, tracker rows, gradebook cells, and notification links | 7, 8 |
| F20 | Signed-out users opening a protected link sign in and return to the target; wrong-role and non-member access shows a generic no-access page | Access Rules |
| F21 | A user who picked the wrong role deletes the account and signs up again | 1 |
| F22 | Sign-in errors are generic and rate-limited; reset requests never reveal whether an email has an account | 1 |
| F23 | Student assignment rows show the due date and the student's own status chip, including a Closed state | 6 step 2 |
| F24 | After a criteria change, a student's unapproved submission returns to "Grading in progress" and the old AI result is hidden | 6 step 11 |
| F25 | Archived or disabled codes read as invalid; a removed student re-entering a code stays Removed | 6 step 1 |
| F26 | Super Admin accounts are created outside the app | 12 |
