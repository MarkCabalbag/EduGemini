# PRD: EduGemini (v2.2)

| | |
|---|---|
| **Status** | Draft for review |
| **Owner** | Project owner (sole developer) |
| **Supersedes** | PRD v1.2 (archived at `docs/archive/prd-v1.2.md`) |
| **Related docs** | [App Flow](app-flow.md) · [UX Brief](ux-brief.md) · [TRD](trd.md) · [Backend Schema](backend-schema.md) · [API Spec](api-spec.md) ([OpenAPI](openapi.yaml)) · [Feature Tickets](feature-tickets.md) · [Progress Tracker](progress-tracker.md) · [Code Standards](code-standards.md) · not written yet: AI Guardrails, Deployment Runbook |

> **How to read this.** This PRD says *what* the product does and *why*. Technical design is in the [TRD](trd.md). Every requirement carries a priority: **Must**, **Should**, or **Could**. Decisions the owner confirmed are in Section 16.1. Defaults assumed on the owner's behalf are in Section 16.2 (A1 to A16), and each can be overridden.

---

## 1. Overview

EduGemini is an AI-assisted classroom management web application. Instructors create classes and assignments with free-text grading criteria. Students upload file-based submissions (PDF or images). Google Gemini grades each submission against the criteria and writes feedback. Instructors keep final authority through a review and approval workflow, so the AI accelerates grading but never has the last word.

Each instructor connects **their own Google Gemini API key**, so the platform itself carries no AI cost.

**One-line value proposition:** *First-pass grading in minutes, with the instructor always in control.*

## 2. Background and Problem

### 2.1 Problem statement

- **Instructors** spend excessive time manually grading large volumes of submissions, much of it repetitive first-pass work.
- **Students** often get thin or delayed feedback, which limits their ability to improve.
- **Existing tools** either automate only objective questions (quizzes) or require institutional procurement and LMS setup, which blocks individual teachers.

EduGemini automates first-pass grading against instructor-defined criteria and keeps a human in the loop for trust and accuracy.

### 2.2 Evidence and assumptions

No external user research is cited. The claims above are working assumptions, each with a way to check it (see also Section 14).

| Assumption | How it will be validated |
|---|---|
| First-pass grading of file-based work is slow and repetitive enough to be worth automating | Time a manual grading baseline on a sample set, then time review-and-approve in EduGemini |
| AI first-pass scores are close enough to a human grader to be useful with review | Evaluate against a human-graded gold set (Section 9.6) |
| Students value fast, specific feedback | Short post-test survey and observed behavior (do students open their feedback?) |
| Individual instructors will accept getting their own free Gemini key | Timed onboarding walkthrough with test users (Goal 4) |

### 2.3 Alternatives and differentiation

*To be validated before the product is presented publicly.*

| Alternative | Gap EduGemini addresses |
|---|---|
| LMS tools such as Google Classroom or Canvas | Strong at distribution and gradebooks; first-pass grading of free-form file work is largely manual, and adoption is tied to an institution |
| Exam and paper grading tools | Built for institutional courses and exams; need institutional setup |
| Plagiarism and similarity tools | Detect copying; they do not grade or give feedback |
| General AI chat assistants | No roster, due dates, review workflow, or student-facing results; the instructor copy-pastes per student |

**Differentiation:** self-serve for an individual instructor, free-text criteria (no rubric builder to learn), mandatory human approval, feedback to students within minutes, and free to run through the instructor's own Gemini key.

## 3. Goals and Non-Goals

### 3.1 Project context

- EduGemini is a **portfolio project** built by one developer. It is hosted for demonstration and, optionally, a small pilot with friendly classes. It is not planned as a public commercial launch in v1.
- **Cost:** the platform pays nothing for AI. Each instructor supplies their own Gemini API key (free tier or paid).
- **Audience:** mixed. Students may be adults or minors; the instructor attests to their authority to upload student work and to informing students (see FR-CLS-09).
- **Language:** English only.

### 3.2 Goals

1. Cut instructor grading time per assignment substantially versus a manual baseline.
2. Give students useful feedback within minutes of submitting.
3. Build instructor trust through transparency: visible AI status, original file next to AI output, editable results.
4. Support bottom-up adoption: a single teacher can sign up, add a Gemini key, create a class, and run an assignment end to end in under 15 minutes.
5. Fail gracefully: no student is ever left with a broken or silent submission.
6. Keep AI usage inside each instructor's own limits through bounded resubmissions and no wasteful re-grading.

### 3.3 Non-goals

See Section 17.

## 4. Target Users and Personas

Target users are individual instructors and teachers who sign up independently. v1 is not scoped to a specific school or institution.

| Persona | Description | Key needs | Key fears |
|---|---|---|---|
| **Maya, independent instructor** | Runs several classes (for example a tutoring practice, a college course, or a workshop series); grades 30 to 150 submissions per assignment | Fast first pass, easy review, a clear view of who has and has not submitted, CSV for own records, a painless way to connect a free Gemini key | AI giving wrong grades under Maya's name; surprise re-grading; students gaming unlimited resubmissions; running out of free quota mid-assignment; extra tools to learn |
| **Jon, student** | Submits PDFs or phone photos of handwritten work; may be in multiple classes | Quick, understandable feedback; clear status; knowing how many attempts remain; ability to fix mistakes before approval | Unfair AI score with no recourse; losing work to a failed upload |
| **Platform owner (Super Admin)** | Operates the product | Visibility into accounts, classes, and AI failures; ability to suspend abuse | Outages hidden as isolated failures; unauthorized access to student data |

## 5. Roles and Permissions

| Role | Summary (exact permissions are in Section 5.1) |
|---|---|
| **Student** | Joins classes with a code, submits files, sees their own AI score and feedback, resubmits before approval within the attempt limit, and manages their own account |
| **Instructor** | Connects their own Gemini key, creates and manages classes and assignments, reviews and approves AI results, grants overrides, posts announcements, and exports grades |
| **Super Admin** | Manages accounts and classes platform-wide and monitors platform health. Does not create classes or grade, and has metadata-only access (no student submission content) (A1) |

### 5.1 Permission matrix

| Action | Student | Instructor (own class) | Super Admin |
|---|---|---|---|
| Create class | No | Yes | No |
| Join class via code | Yes | No | No |
| Approve, decline, or remove join requests | No | Yes | No |
| Regenerate or disable class code | No | Yes | No |
| Remove a student from a class | No | Yes | No |
| Archive class | No | Yes | Yes |
| Edit class details | No | Yes | No |
| Create / edit assignment | No | Yes | No |
| Delete or archive assignment | No | Yes | No |
| Create / delete assignment labels | No | Yes | No |
| Add, replace, or remove own Gemini key | No | Yes | No |
| Post or delete announcements | No | Yes | No |
| View announcements | Yes (approved) | Yes | No |
| Upload or resubmit submission | Yes (own, pre-approval, within attempt limit) | No | No |
| Grant extra resubmission attempts | No | Yes | No |
| Allow an individual late submission when late is closed | No | Yes | No |
| View own score and feedback | Yes | n/a | n/a |
| View other students' individual data | **No** | Yes | **No** (metadata only) |
| View anonymized class stats | Yes | Yes | Yes |
| Edit and approve score or feedback | No | Yes | No |
| Add instructor comment | No | Yes | No |
| Reopen an approved submission | No | Yes | No |
| View submission tracker / gradebook / export CSV | No | Yes | No |
| Update own name and password | Yes | Yes | Yes |
| Delete own account | Yes | Yes | No |
| Suspend, reinstate, or delete accounts | No | No | Yes |
| Delete class | No | Yes (own class) | Yes (moderation) |
| View platform health metrics | No | No | Yes |

## 6. Core User Flow (End to End)

1. **Instructor signs up, connects a Gemini key, and creates a class** (name, plus optional section, subject, and room). The key setup is guided and takes minutes. The system generates a unique, joinable class code.
2. **Instructor creates an assignment** with free-text grading criteria (optionally attaching reference files), a due date, a scoring format (points/max, percentage, or letter + numeric), a resubmission limit, and a late policy. The instructor may tag it with a label (for example Quiz or Project).
3. **Student signs up, joins the class with the code, and sees the assignment.** If the instructor turned on join approval, the student sees "Pending approval" until the instructor approves.
4. **Student uploads one or more files** (PDF or JPG/PNG). Late submissions after the due date are accepted but flagged **Late**, unless the instructor has closed late submissions for that assignment.
5. **Gemini grades the submission** against the criteria and returns one overall score (in the assignment's format) and one narrative feedback block.
6. **The student immediately sees the result**, tagged with an **AI-generated** status chip, along with how many resubmission attempts remain.
7. **The student may resubmit** (replacing files and triggering re-grading) any time before the instructor approves, while attempts remain. The instructor can grant extra attempts.
8. **Instructor reviews** the AI output in the review queue, with the original files shown alongside the AI score and feedback. The instructor may edit both and add a separate comment, then approves. The chip changes to **Instructor-approved**, and the student can no longer resubmit unless the instructor reopens the submission.
9. **If the instructor edits the criteria or reference files after submissions exist**, unapproved submissions are re-graded after a confirmation. Due-date edits only recompute Late flags (see FR-ASG-04).
10. **Instructor tracks progress** in the assignment submission tracker (who turned in, who is late, who is missing) and views the gradebook (students x assignments x scores with status). Both can be exported as CSV.
11. **Instructor posts announcements** to keep the class informed (Could).
12. **Notifications** (in-app and email) go out for the events listed in Section 10.

## 7. Functional Requirements

Each requirement has an ID for traceability, a priority, and testable acceptance criteria.

### 7.1 Authentication and Accounts (FR-AUTH)

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-AUTH-01 | Must | Email/password sign-up and sign-in for both roles | Password of at least 10 characters with a basic strength check; duplicate emails rejected with a clear message; sign-up collects first and last name (used as the display name in rosters and gradebooks) |
| FR-AUTH-02 | Must | Google OAuth for both roles | A user who signs in with Google and later with the same email via password is linked to a single account, not duplicated. If the existing account's email was never verified, Google sign-in marks it verified and clears the existing password (the user can set a new one in Settings) |
| FR-AUTH-03 | Must | Role selection at sign-up | Role is chosen once; one role per account in v1 (A6) |
| FR-AUTH-04 | Should | Email verification | Unverified accounts can use the app but receive no email notifications until verified; a banner offers to resend the verification email (A2) |
| FR-AUTH-05 | Must | Password reset | Reset link expires after 60 minutes and is single-use |
| FR-AUTH-06 | Should | Session management | Sessions expire after inactivity; the user can sign out of all devices |
| FR-AUTH-07 | Should | Account settings | Any signed-in user can update their display name and change their password (current password required); Google-only accounts can set a password to enable email sign-in |
| FR-AUTH-08 | Could | First-run guidance | The home page shows short, role-specific "how to get started" steps (instructor: add key, create a class, create an assignment, share the code; student: join a class, submit) and can be dismissed |
| FR-AUTH-09 | Must | Terms and privacy acceptance | Sign-up requires accepting the Terms and Privacy Notice, which state that submissions are processed by Google Gemini and reviewed by the instructor |
| FR-AUTH-10 | Must | Delete own account | Students and instructors can delete their own account in Settings. The user re-enters their password (or signs in with Google again) and types DELETE to confirm. Instructors are told the consequences first: their classes are archived and later deleted, their Gemini key is deleted, and their students are notified. For a student, personal data and uploaded files are deleted and the instructor's gradebook keeps an anonymized "Deleted student" row (A14) |

### 7.2 Instructor Gemini Key (FR-KEY)

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-KEY-01 | Must | Add, replace, and remove own key | Instructor-only settings area; one active key per instructor, used for all of that instructor's classes; removing the key disables AI grading for their assignments (see FR-KEY-05) |
| FR-KEY-02 | Must | Validate on save | A test call runs on save. Success shows "Connected". Failure shows a specific, plain-language reason (invalid key, API not enabled, quota reached, network problem) |
| FR-KEY-03 | Must | Protect the key | Stored encrypted; after saving, only a masked ending (last 4 characters) is shown; never visible to or usable by students, other instructors, or Super Admin; never written to logs or notifications |
| FR-KEY-04 | Must | Data-use disclosure | Before the first key is saved, a plain-language notice explains that student work will be sent to Google Gemini under the instructor's key, that on Google's free tier content may be used by Google to improve its products, and that paid-tier terms differ (instructor should verify Google's current terms). Saving requires ticking "I understand" |
| FR-KEY-05 | Must | Missing, invalid, or exhausted key | If the key is missing, invalid, or its daily limit is reached: AI grading is not attempted, a persistent banner tells the instructor how to fix it, affected submissions go to **Needs manual review**, and students see "Submitted, awaiting instructor review". Short-lived rate limits are handled by silent retry (FR-AI-04). After the fix or quota reset, the instructor can re-run AI grading on affected submissions individually or in bulk (A8) |
| FR-KEY-06 | Should | Key status | Settings show Connected, Needs attention, or Quota reached, plus the time of the last successful grading |
| FR-KEY-07 | Should | Setup help | Inline steps (with a link) for getting a free key from Google AI Studio; a first-time user completes setup in under 3 minutes in a walkthrough |

### 7.3 Classes (FR-CLS)

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-CLS-01 | Must | Instructor creates unlimited classes | Each class has a name, a unique class code, and optional description, section, subject, and room |
| FR-CLS-02 | Must | Unique, shareable class code and join link | Code is unguessable (8 characters, excluding look-alike characters such as 0/O and 1/I); case-insensitive on entry; instructor can copy the code and a join link in one click each |
| FR-CLS-03 | Must | Students join via code; unlimited classes per student | Joining twice with the same code is idempotent; invalid code shows a clear error; repeated invalid attempts are rate-limited. If join approval is on (FR-CLS-07), the student enters **Pending** and is notified of the outcome |
| FR-CLS-04 | Should | Code management | Instructor can regenerate or disable a code (the join link follows the code); existing members are unaffected |
| FR-CLS-05 | Should | Roster management | Instructor can view the roster and remove a student; removal hides the student from the active gradebook but retains submission history. Their submissions also leave the review queue and tracker, and return if the student is reinstated; the class disappears from their Enrolled list |
| FR-CLS-06 | Should | Archive class | Archived classes become read-only and can be restored. Students still see an archived class in their Enrolled list, read-only: they can view assignments and feedback but cannot submit |
| FR-CLS-07 | Should | Optional join approval | Per-class toggle, **off by default** (code-join stays instant). When on, new joiners are **Pending** and cannot see assignments, announcements, or class data until approved. The instructor can approve, decline, and later reverse either decision or remove an approved student. The People view shows counts of Approved, Pending, and Declined |
| FR-CLS-08 | Should | Student class list | A student's "Enrolled" page lists every class with its status (Approved, Pending, Declined) |
| FR-CLS-09 | Must | Instructor attestation | When creating a class, the instructor confirms they have the authority to collect and upload their students' work, and that students (or guardians where required) have been told their work is processed by AI |
| FR-CLS-10 | Should | Edit class details | Instructor can change name, description, section, subject, and room at any time; the code and members are unaffected |
| FR-CLS-11 | Should | Delete class | Instructor can permanently delete their own class. The confirmation offers "Archive instead" and a gradebook CSV download, states how many students, assignments, and submissions will be removed, and requires typing the class name. All class data (submissions, files, grades, announcements) is deleted immediately and approved students are notified |

### 7.4 Assignments (FR-ASG)

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-ASG-01 | Must | Create assignment | Fields: title, instructions (optional), free-text grading criteria (required), due date and time with timezone, scoring format, max score |
| FR-ASG-02 | Must | Scoring format per assignment | Instructor chooses one of: **points/max** (for example 42/50), **percentage** (for example 84%), **letter + numeric** (for example B+ / 87). The format is locked once any submission exists (A13) |
| FR-ASG-03 | Should | Draft vs. published | Assignments can be saved as drafts invisible to students; publishing makes them visible and notifies approved students (Section 10) |
| FR-ASG-04 | Must | Edit published assignment | Editing **criteria or reference files** triggers re-grading of **unapproved** submissions. The UI shows a **confirmation dialog** stating how many submissions will be re-graded, that their AI scores will be replaced, and that re-grading uses the instructor's Gemini quota. Approved submissions are not re-graded; they are flagged "Criteria changed since approval" and the instructor may re-grade them individually or in bulk (A3, FR-REV-10). Rapid successive edits are combined into one confirmation. Editing the **due date** only recomputes Late flags. Editing title, instructions, label, or settings does not re-grade. Re-grades never consume student attempts |
| FR-ASG-05 | Must | Due-date semantics | Due date changes recompute "Late" flags for all submissions and notify approved students (Section 10) |
| FR-ASG-06 | Should | Letter-grade scale | Default scale (A, A-, B+ ... F) with default numeric ranges; instructor may adjust ranges per assignment |
| FR-ASG-07 | Should | Reference files for criteria | Instructor may attach up to 3 optional reference files (PDF, JPG, PNG; same size limits as FR-SUB-02), for example a rubric image, answer key, or model solution. Gemini always receives them with the criteria, labeled as reference material. **Each file has a "Visible to students" toggle, off by default;** students see only files marked visible. Free-text criteria remain required, and this is not a structured rubric builder |
| FR-ASG-08 | Could | Assignment labels | Instructor can create and delete custom labels (for example Quiz, Activity, Project) and tag assignments with one label. Deleting a label never deletes assignments; they become unlabeled. Labels filter the assignment list and gradebook |
| FR-ASG-09 | Should | Delete or archive assignment | Archiving hides the assignment from students and keeps all submissions and grades (restorable). Deleting is permanent, removes its submissions and grades, and requires a confirmation stating how many submissions will be removed. Archive is the recommended default in the UI |
| FR-ASG-10 | Must | Resubmission limit | Per assignment, the instructor sets how many resubmissions are allowed after the first submission: 0 to 10, or Unlimited. Default 3 (A9). Applies only before approval. Changing the limit later never removes attempts already used |
| FR-ASG-11 | Should | Late policy | Per-assignment toggle **Accept late submissions**, on by default. When off, students cannot submit after the due date, and the instructor can allow an individual late submission (FR-SUB-10) |

### 7.5 Submissions (FR-SUB)

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-SUB-01 | Must | Multiple files per submission | Supported types: **PDF, JPG, PNG**. Other types are rejected at selection time with a clear message. iPhone photos in HEIC format are accepted and converted to JPEG automatically (A12) |
| FR-SUB-02 | Must | File limits | Limits: 10 files per submission, 10 MB per file, 15 MB total, 20 pages per PDF. Reference files count toward the same 15 MB when grading. The total can rise if the Gemini limit check (TRD spike S3) allows it. Limits are shown before upload, and errors name the specific limit exceeded |
| FR-SUB-03 | Should | Upload reliability | Upload shows progress; interrupted uploads can be retried without losing already-uploaded files; a submission is only "submitted" once all files are stored |
| FR-SUB-04 | Must | Late handling | Submissions after the due date are accepted and visibly flagged **Late** to the instructor and the student, unless the assignment has closed late submissions (FR-ASG-11). The submission timestamp is always recorded |
| FR-SUB-05 | Must | Resubmission | Allowed only before approval and while attempts remain (FR-ASG-10). New files **replace** prior files and re-trigger grading. Once the new submission is stored, the prior files are deleted from storage; only the version's number and time are kept. Re-grades caused by an instructor edit never consume a student's attempts. A resubmission that ends in Needs manual review because of a system problem (Gemini failure, key or quota problem) still uses an attempt; the instructor can give it back with FR-SUB-10(a) |
| FR-SUB-06 | Must | Locked after approval | Once approved, the student sees a read-only view and no resubmit control, until the instructor reopens it |
| FR-SUB-07 | Must | One active submission per student per assignment | A resubmission updates the same submission record; it does not create a parallel one |
| FR-SUB-08 | Should | Submission receipt | Student sees confirmation with timestamp and file list immediately on upload |
| FR-SUB-09 | Must | Attempts-left display | Students see "N resubmissions left" (or "Unlimited resubmissions") on the assignment and result pages; at 0 the resubmit control is replaced by a message explaining the limit. The instructor sees the same count per student |
| FR-SUB-10 | Must | Instructor overrides | From the tracker or review view the instructor can (a) grant additional resubmission attempts to one student by specifying a number, and (b) allow a late submission for one student when the assignment is closed to late work, which unlocks that student's upload for the assignment (A11). Both actions are logged and notify the student |

### 7.6 AI Grading (FR-AI)

See Section 9 for the grading requirements.

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-AI-01 | Must | One overall score and one narrative feedback block per submission | Score is valid for the assignment's format and within range; feedback is non-empty. No AI-inferred sub-criteria breakdown in v1 |
| FR-AI-02 | Must | Grading triggers | New submission, resubmission, re-grade after a criteria or reference-file edit, and instructor-triggered re-run. A due-date edit does not trigger grading |
| FR-AI-03 | Must | Result immediately visible to the student | Visible with the **AI-generated** chip as soon as grading completes (A7) |
| FR-AI-04 | Must | Transient failure handling | API error, timeout, or short-lived rate limit: automatic silent retry with a capped number of attempts (Section 9.5); if still failing, status becomes **Needs manual review**; the student sees "Submitted, awaiting instructor review" rather than an error |
| FR-AI-05 | Must | File-quality failure handling | Corrupted or unreadable file: **no retry**; the student sees an immediate error asking them to re-upload. A failed upload or file-quality rejection does **not** consume a resubmission attempt |
| FR-AI-06 | Should | Stale-result protection | If a resubmission arrives while a grading job is in flight, the older job's result is discarded; only the latest submission version's result is saved |
| FR-AI-07 | Must | AI disclosure to students | Assignment and result pages state that the score and feedback are AI-generated and will be reviewed by the instructor, and that questions about grades go to the instructor |

### 7.7 Review and Approval (FR-REV)

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-REV-01 | Must | Review queue | Lists AI-generated (unapproved) submissions, Needs-manual-review submissions, and re-grades of approved submissions awaiting review (FR-REV-10); filterable by class, assignment, and status; sortable by submission time and Late |
| FR-REV-02 | Must | Side-by-side review | Original file(s) are viewable next to the AI score and feedback without leaving the page (PDF page viewer and image viewer) |
| FR-REV-03 | Must | Edit and approve | Instructor can edit score and feedback text, then approve. The score edit uses a numeric input validated against the assignment's range and format. Edits are recorded (original AI value plus final value) for quality metrics |
| FR-REV-04 | Must | Status chips | **AI-generated** becomes **Instructor-approved** on approval; the student sees the change |
| FR-REV-05 | Should | Reopen | Instructor can reopen an approved submission, which re-enables student resubmission and returns the chip to its prior state. The reopen dialog includes "also grant N attempts", defaulting to 1 when the student has none left, so reopening is never a dead end |
| FR-REV-06 | Must | Manual grading path | For Needs-manual-review items, the instructor can enter score and feedback from scratch, or re-run AI grading (individually, or in bulk after fixing the key or waiting for quota reset) |
| FR-REV-07 | Could | Bulk approve | Instructor can select multiple unedited AI-generated submissions and approve them at once, with a confirmation step |
| FR-REV-08 | Should | Approve vs. edit tracking | System records whether each approval was edit-free, score-only edit, feedback-only edit, or both |
| FR-REV-09 | Should | Instructor comment | Optional free-text comment, stored separately from the AI feedback and labeled "Instructor comment" to the student. It is never sent to Gemini and does not count as editing the AI feedback in quality metrics |
| FR-REV-10 | Should | Re-grade an approved submission | The instructor can re-grade an approved submission individually or in bulk (for example after a criteria change). The student keeps seeing the approved, locked grade. The new AI result appears in the review queue as "Re-grade pending review". The instructor either approves it (the student is notified and sees the new grade) or chooses "Keep previous grade", which discards the new result |

### 7.8 Submission Tracker and Gradebook (FR-GB)

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-GB-01 | Must | Table of students x assignments | Cells show score (in the assignment's format) and status: AI-generated, Late, Instructor-approved, Needs manual review, Not submitted. An approved submission with a re-grade waiting for review shows Instructor-approved with a "Re-grade pending" marker |
| FR-GB-02 | Must | CSV export | One row per student, one column per assignment for score, plus status columns; opens correctly in Excel and Google Sheets (UTF-8 with BOM) |
| FR-GB-03 | Must | Mixed formats | Formats are per assignment, so CSV and table show each assignment's native format; no cross-assignment totals in v1 |
| FR-GB-04 | Should | Assignment submission tracker | A per-assignment dashboard for approved students showing counts for **Turned in** (any valid submission; Late and Needs manual review ones are subsets), **Late**, **Missing** (past due, nothing submitted), **Not yet due** (before the due date, nothing submitted), and **Needs manual review**. Queued and Grading submissions show as "Grading in progress". Search by student name and multi-select filter by status. Each student row expands to show submission time, current score, status, resubmissions left, feedback, instructor comment, and the submitted files. A "Criteria changed" filter lists approved submissions flagged under FR-ASG-04, with a bulk "Re-grade selected" action |
| FR-GB-05 | Could | Per-assignment export | Export a single assignment as CSV with student name, status, submission time, late flag, score, AI feedback, and instructor comment |
| FR-GB-06 | Could | Filter by label | Gradebook and assignment list can be filtered by assignment label |

### 7.9 Notifications (FR-NTF)

See Section 10 for the matrix.

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-NTF-01 | Must | In-app notifications | Notification center with unread count; each item deep-links to the relevant submission, assignment, class page, or settings page |
| FR-NTF-02 | Should | Email notifications | Sent for the events in Section 10; includes a deep link; sent from a configured sender address (a verified custom domain is a post-v1 upgrade); only to verified emails (the verification and password-reset emails, and account suspension or reinstatement notices, go to the address on file) |
| FR-NTF-03 | Could | Instructor email digests | New-submission and join-request emails to instructors are digested (for example one email per assignment per hour) |
| FR-NTF-04 | Could | Preferences | Users can turn email notifications off per category; in-app cannot be disabled |

### 7.10 Super Admin (FR-ADM)

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-ADM-01 | Must | Account management | Search, view, suspend, reinstate, and delete any instructor or student account (metadata only). A suspended user cannot sign in and sees an "Account suspended" message; a suspended instructor's classes show to students as "Temporarily unavailable". Suspending or reinstating takes an optional reason and emails the user (A16) |
| FR-ADM-02 | Should | Class management | View and archive or delete any class (metadata only); deletion notifies the instructor and approved students (Section 10). Instructors can use a class immediately after creating it; admin approval is **not** a gate |
| FR-ADM-03 | Could | Platform health | Dashboard of grading success rate, manual-review fallback rate, key and quota error rate, and queue depth |
| FR-ADM-04 | Should | Audit log | All admin actions are logged with actor, target, and timestamp |

### 7.11 Class Announcements (FR-ANN) (Could)

A lightweight, one-way class feed with no comments or replies.

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-ANN-01 | Could | Post announcement | Instructor posts a title, a description, and an optional attachment (PDF, JPG, PNG; same limits as FR-SUB-02) to a class. Newest first in the class stream |
| FR-ANN-02 | Could | View announcements | Approved students see the stream and can download attachments. Pending or declined students cannot |
| FR-ANN-03 | Could | Delete announcement | Instructor can delete an announcement after a confirmation; it is deleted completely, with its files, and disappears from students' streams immediately |
| FR-ANN-04 | Could | Announcement notifications | New announcements create an in-app notification for approved students; email follows each student's preferences (default: digest) |
| FR-ANN-05 | Could | No interaction | Students cannot comment on or react to announcements in v1 |

## 8. State Model

### 8.1 Submission states

| State | Meaning | Student sees | Instructor sees |
|---|---|---|---|
| **Uploading** | Files being transferred | Progress indicator | Not visible |
| **Queued** | Stored, waiting for grading | "Grading in progress" | Shown as "Grading in progress" in the tracker |
| **Grading** | Gemini job running (including silent retries) | "Grading in progress" | Shown as "Grading in progress" in the tracker |
| **AI-generated** | Grading succeeded; unapproved | Score, feedback, **AI-generated** chip, attempts left | Needs review |
| **Needs manual review** | Retries exhausted, or key missing/invalid/exhausted | "Submitted, awaiting instructor review" | Flagged item in queue, with the cause |
| **File error** | Corrupted or unreadable file | Immediate error with re-upload prompt (no attempt consumed) | Not visible (no valid submission) |
| **Instructor-approved** | Instructor approved; locked | Final score, feedback, instructor comment, **Instructor-approved** chip | Complete |

**Late** is an independent flag layered on top of any state above, not a state of its own. A re-graded approved submission keeps the Instructor-approved state, and its grade stays visible to the student, while the new AI result waits for review (FR-REV-10). **Missing** and **Not yet due** are tracker views for students with no submission and are not submission states.

### 8.2 Transitions

- Uploading to Queued (all files stored) or to File error (validation or readability failure).
- Queued to Grading to AI-generated (success) or Needs manual review (retries exhausted, or key problem).
- AI-generated or Needs manual review to Grading (student resubmits with attempts remaining, instructor re-runs AI, or criteria or reference files edited and the instructor confirmed re-grading).
- AI-generated or Needs manual review to Instructor-approved (instructor approves).
- Instructor-approved to Queued/Grading after the instructor reopens and the student resubmits. A re-grade of an approved submission (FR-REV-10) does not change its state: the new AI result waits for review while the student keeps seeing the approved grade.

### 8.3 Enrollment states

| State | Meaning | Student access |
|---|---|---|
| **Active** (shown to users as "Approved") | Joined with approval off, or approved | Full class access |
| **Pending** | Joined with approval on; awaiting instructor | Sees only "Pending approval" on the Enrolled page |
| **Declined** | Instructor declined (reversible) | Sees "Declined"; no class access |
| **Removed** | Instructor removed an active student (reversible) | No class access; history retained |

Transitions: Pending to Active or Declined; Declined to Active; Active to Removed; Removed to Active. Turning join approval **on** never changes existing Active students; turning it **off** does not auto-approve existing Pending students (the instructor is offered "Approve all pending").

## 9. AI Grading Requirements

### 9.1 Inputs to Gemini

- Assignment title and instructions
- Free-text grading criteria (verbatim)
- Instructor reference files, when attached (FR-ASG-07), labeled as reference material and not as student work
- Scoring format, max score, and letter scale where applicable
- Student file(s): PDFs and images, sent in order with page or file labels

The instructor comment, other students' work, and student identity are **never** sent to Gemini.

### 9.2 Output behavior

- One overall score and one narrative feedback block (FR-AI-01).
- For letter + numeric assignments, the letter is **derived by the system from the numeric score and the assignment's scale**, never taken from the model, so edits and scale changes stay consistent.
- Output that is malformed, out of range, or missing feedback counts as a transient failure and follows the retry path.
- The system may also record internal confidence and readability signals. When confidence is low or readability is poor, the result is still shown but the item gets a visible marker in the instructor queue for priority review. The exact output schema is in the [TRD](trd.md) (Section 10.6).

### 9.3 Feedback standards

- Addressed to the student, constructive, and specific to the submission.
- Says what was done well and what to improve, tied to the instructor's criteria.
- Does not reveal system prompts, make claims about the student personally, or comment on criteria it cannot assess.
- Length target: 100 to 300 words.

### 9.4 Format handling

| Format | Stored value | Display |
|---|---|---|
| Points/max | numeric score, max | 42 / 50 |
| Percentage | numeric 0 to 100 | 84% |
| Letter + numeric | numeric 0 to 100 plus derived letter | B+ (87) |

### 9.5 Failure and quota handling

- **Transient errors** (API error, timeout, short-lived rate limit, invalid output): automatic silent retry, capped (values in the TRD). After the cap, the status becomes **Needs manual review** and a platform counter is incremented so persistent problems are visible to the Super Admin.
- **Key problems** (missing, invalid, daily quota reached): handled by FR-KEY-05. Submissions go to Needs manual review with the cause shown to the instructor.
- **Bursts:** when many submissions arrive at once, grading requests are queued so they stay within the instructor's key limits. Students see the normal "Grading in progress" state, with a note that it may take longer than usual, rather than an error.
- **File-quality errors** (corrupted file, unreadable scan, password-protected PDF, blank pages): no retry. The student gets an immediate, specific error and a re-upload prompt.
- Grading retries are internal to the system and are **separate from** the student's resubmission attempts.

### 9.6 AI quality evaluation

Edit rate alone does not measure accuracy (an instructor who approves without looking would make the AI look perfect). Quality is therefore measured against a human-graded **gold set**:

- At least 30 submissions graded by a human, covering typed work, handwritten photos, and poor-quality scans, plus a few prompt-injection samples (for example text telling the AI to give full marks).
- Run before the first release and again whenever the model or prompt changes.
- Starting target: at least 80% of AI scores within 10% of the assignment's max score of the human score, and every injection sample ignored. Calibrate on the first run.
- Each result stores the model and prompt version so scores can be audited later.

### 9.7 Fairness and integrity

- Grading should be consistent across re-grades of the same work (low variability).
- Student file content is treated strictly as data to be graded, never as instructions. The instructor review step is the backstop.
- Test cases belong in the AI Guardrails doc.

### 9.8 Expected turnaround

The UI shows "Grading in progress, usually about a minute" and updates automatically when the result is ready, without a page refresh.

## 10. Notifications Matrix

| Event | Recipient | In-app | Email | Notes |
|---|---|---|---|---|
| Submission graded (AI result available) | Student | Yes | Yes | Includes link to feedback |
| Instructor approved grade | Student | Yes | Yes | Notes if score or feedback was edited |
| New submission awaiting review | Instructor | Yes | Yes (digest) | Late flag shown |
| Submission moved to Needs manual review | Instructor | Yes | Yes (digest) | Highlights the cause (AI failure or key problem) |
| Submission moved to Needs manual review | Student | Yes | No | Neutral wording: "awaiting instructor review" |
| Gemini key needs attention (invalid, quota reached) | Instructor | Yes | Yes (immediate) | Links to key settings |
| Criteria or reference files changed; re-grade complete | Student | Yes | Yes | Tells the student the score may have changed |
| Submission reopened by instructor | Student | Yes | Yes | Invites resubmission |
| File error on upload | Student | Immediate on-screen | No | Shown in the upload flow |
| Join request received | Instructor | Yes | Yes (digest) | Only when join approval is on |
| Join request approved or declined | Student | Yes | Yes | Includes class name |
| Extra resubmission attempts granted | Student | Yes | Yes | States how many attempts are now available |
| Late submission allowed by instructor | Student | Yes | Yes | Tells the student they can now submit |
| New assignment published | Approved students | Yes | Yes | Includes class, title, and due date |
| Assignment due date changed | Approved students (not those already approved on it) | Yes | Yes | States the new due date and whether their Late flag changed |
| Class deleted (by the instructor or the Super Admin) | Approved students (and the instructor, when the Super Admin deletes it) | Yes | Yes | Tells the student the class and their submissions were removed |
| Instructor account deleted | Approved students | Yes | Yes | Tells the student the class is archived and read-only until deletion |
| Account suspended or reinstated | Affected user | No | Yes (sent even if unverified) | Includes the optional reason (A16) |
| Archived-class data scheduled for deletion | Instructor | Yes | Yes | Sent 30 days before deletion, with a link to download the gradebook CSV (A15); not sent if the instructor's account no longer exists |
| New announcement (Could) | Approved students | Yes | Digest (preference-based) | Includes title and link |

Emails go only to verified addresses (FR-AUTH-04). The exceptions are the verification and password-reset emails themselves and account suspension or reinstatement notices, which go to the address on file.

## 11. Visibility and Privacy Rules

- A student sees only their own scores, feedback, instructor comments, and submissions, never a classmate's individual data.
- Students see **anonymized class-wide stats per assignment** (class average and number of graded submissions only; no minimum, maximum, or distribution, which could identify an individual in a small class), computed from **approved scores only**, with no identities. Stats are hidden until at least 5 graded submissions exist, so a small class cannot reveal one student's score (A5).
- The instructor can view original uploaded file(s) alongside the AI score and feedback in the review queue.
- **Pending and declined students** cannot see assignments, announcements, or any class content. Instructors see only the name and email provided at sign-up.
- **Reference files** are always sent to Gemini; students can see only the ones the instructor marked visible. Announcement attachments are visible only to the class's instructor and approved students.
- **Data minimization:** the platform collects name, email, and class membership only. It does not collect gender or other demographic fields.
- **Super Admin has metadata-only access** and cannot open student submissions (A1).
- **Third-party processing:** student work is sent to Google Gemini only for grading, using the instructor's own API key. Because Google's free tier may allow content to be used to improve its products, this is disclosed to the instructor before saving a key (FR-KEY-04) and to users in the Privacy Notice (FR-AUTH-09). The product accepts any valid key, so an instructor who needs stronger guarantees can use a paid-tier key.
- **Minors and consent:** the instructor attests to authority and to informing students or guardians (FR-CLS-09). The Privacy Notice and Terms need wording review before any real student uses the product (Open Question 3).
- Uploaded files are stored privately; access is checked against role and class membership on every request, and links are short-lived.

## 12. Non-Functional Requirements

| Area | Priority | Target |
|---|---|---|
| **Turnaround** | Should | While the instructor's key is within quota: median about 1 minute, 90% within 2 minutes, 99% within 5 minutes |
| **Availability** | Could | Best effort, with a 99% monthly target and no formal SLA |
| **Reliability** | Must | Core actions (sign in, view assignments, submit, view feedback) complete without errors under normal load |
| **Scalability** | Should | The app accepts at least 200 uploads for one assignment near a due date without errors. Grading throughput is bounded by the instructor's key limits, so results may arrive over a longer period; the queued state must be shown clearly |
| **Cost control** | Must | Platform AI cost is zero by design. Resubmission limits and no-wasteful-re-grade rules protect each instructor's quota |
| **Security** | Must | HTTPS everywhere, encrypted storage at rest, hashed passwords, encrypted API keys, access control on all class data, file-type validation by content, protection against common web vulnerabilities. Detail is in the [TRD](trd.md) (Section 14) |
| **Privacy** | Must | Data deletion on request; Privacy Notice and Terms; data minimization (Section 11) |
| **Accessibility** | Should | WCAG 2.1 AA for core flows |
| **Theming** | Should | Light and dark themes in v1. Follows the system setting by default, with a manual choice in Settings > Account. Both themes meet WCAG 2.1 AA contrast (checked by script; see UX Brief) |
| **Device and browser support** | Must | Latest two versions of Chrome, Safari, Edge, Firefox; responsive from phone to desktop (students upload from phones) |
| **Maintainability** | Should | Graceful degradation and clear error messages that tell users how to recover |
| **Observability** | Should | Structured logs, grading job metrics, error alerting, per-submission audit trail |
| **Data retention** | Should | Submission files and results retained until deleted by the user, or 12 months after a class is archived, then deleted (A10). The instructor is notified 30 days before deletion (A15) |

## 13. Edge Cases and Rules

| Scenario | Expected behavior |
|---|---|
| Student resubmits while grading is in progress | Latest version wins; earlier job result is discarded (FR-AI-06). One attempt is consumed per accepted resubmission |
| Student resubmits after due date | Allowed pre-approval if late is open and attempts remain; Late flag is based on the **latest** submission time, and the instructor sees both timestamps (A4) |
| Assignment closed to late work, student tries after due date | Upload is blocked with a clear message; the instructor can allow an individual late submission (FR-SUB-10) |
| Student reaches 0 resubmissions left | Resubmit control is replaced by an explanation; instructor can grant more attempts or reopen the submission (reopening can grant attempts at the same time, FR-REV-05) |
| Instructor lowers the resubmission limit below attempts already used | Existing attempts stand; the student simply has 0 left |
| Upload fails or the file is unreadable | No attempt is consumed (FR-AI-05) |
| Resubmission ends in Needs manual review because of a system problem | The attempt stays used; the instructor can give it back with grant attempts (FR-SUB-05, FR-SUB-10) |
| Instructor re-grades an approved submission | The student keeps seeing the approved grade until the instructor approves the new result or chooses "Keep previous grade" (FR-REV-10) |
| Instructor-triggered re-grade (criteria or reference files) | Does not consume student attempts; uses the instructor's Gemini quota |
| Instructor edits criteria while a student is mid-upload | Submission is graded against the criteria current when grading starts |
| Criteria edited when some submissions are already **approved** | Approved submissions are not auto-re-graded; flagged "Criteria changed since approval"; the instructor may re-grade them individually or in bulk (A3) |
| Instructor edits criteria several times quickly | Re-grade is combined into one confirmation covering the final change |
| Due date moved | Late flags are recomputed; no re-grade |
| Reference file removed, replaced, or its content changed | Treated as a criteria change (FR-ASG-04). Changing only its student visibility is not |
| Instructor has no key, or the key is invalid or exhausted | AI grading is skipped; submissions go to Needs manual review; the instructor sees a banner; students see a neutral message (FR-KEY-05) |
| Instructor removes the key while submissions are queued | Queued submissions move to Needs manual review; the instructor is notified |
| Student joins a class with approval on, then the instructor turns approval off | Existing Pending students remain Pending until the instructor uses "Approve all pending" |
| Student declined, then re-enters the code | Remains Declined; the instructor must reverse the decision |
| Student removed, then re-enters the code | Stays Removed; the student sees "You can't join this class right now. Contact the instructor." |
| Student enters the code of an archived class, or a disabled or regenerated code | Treated as an invalid code; no class information is shown |
| Instructor deletes a class | Everything in it is deleted immediately after confirmation; approved students are notified (FR-CLS-11) |
| Google sign-in with an email that has an unverified password account | Accounts link, the email becomes verified, and the old password is cleared (FR-AUTH-02) |
| Student removed from class | Submissions retained, hidden from the active gradebook, review queue, and tracker; restored if the student is reinstated (FR-CLS-05) |
| Assignment archived | Hidden from students; grades retained and restorable; excluded from the default gradebook view with a "Show archived" toggle |
| Assignment deleted | Permanent removal after confirmation; the gradebook and exports no longer include it |
| Label deleted | Assignments keep existing and become unlabeled |
| Announcement deleted after students were notified | Deleted completely, with its files; notification links show "This item is no longer available" |
| Student account deleted (by the student or the Super Admin) | Personal data and uploaded files are deleted; the instructor's gradebook keeps an anonymized "Deleted student" row with score and status only (A14) |
| Instructor account deleted | Their key is deleted; classes are archived, then deleted per retention policy; students notified |
| Mixed PDF and images in one submission | Supported; order preserved as uploaded |
| Very large PDF (over page cap) | Rejected at upload with the specific limit named |
| Blank, rotated, or low-resolution images | Flagged as a readability issue; may trigger a file error or low-confidence marker |
| Score edited by instructor outside valid range | Blocked with inline validation |
| Gemini returns a score above max | Treated as invalid output and retried |
| Simultaneous approve by instructor and resubmit by student | Approval wins if committed first; the student sees the locked state and a message explaining why resubmission failed |
| Disputes | No in-app mechanism in v1; the UI tells students that questions about grades go to the instructor (FR-AI-07) |

## 14. Success Metrics

Targets are starting points, sized for a portfolio project with a small group of testers. Calibrate after the first evaluation run.

| Metric | Definition and method | Target |
|---|---|---|
| **AI accuracy** | Share of AI scores within 10% of max score of a human grader on the gold set (Section 9.6) | At least 80%, and all injection samples ignored |
| **Time saved** | Instructor time to review and approve a batch of at least 10 submissions versus a manual baseline for the same batch | 50% or more reduction |
| **Turnaround** | Time from upload to AI feedback available, with a key inside quota | The Section 12 targets: median about 1 minute, 90% within 2 minutes, 99% within 5 minutes |
| **Reliability** | Share of submissions falling back to Needs manual review, excluding key and quota events (reported separately) | Under 2% |
| **Onboarding** | Timed walkthrough with at least 3 new instructors: sign up, add key, create class, publish assignment, see a graded submission | Under 15 minutes |
| **Usability** | System Usability Scale (SUS, higher is better) from at least 5 instructors and 5 students | Average of 75 or higher |
| **Review behavior** | Share of approvals that were edit-free, and share where the score changed. Tracked as a signal, not a goal, because rubber-stamping inflates it | Reported, no fixed target |
| **Student experience** | Share of graded students who open their feedback | 70% or more |
| **Resubmission health** | Average resubmissions per student per assignment, and share of students reaching 0 attempts left | Used to tune the default limit; no target |
| **Quota health** | Share of grading calls failing because of key or quota limits | Reported; informs the setup help and pacing |

**Instrumentation required:** submission, grading start and finish, retries, fallback and its cause, review open, edit, approve, resubmit, attempts granted, late exceptions, re-grade trigger, key setup success and failure, tracker and gradebook views, and CSV exports.

Adoption and retention targets are not set while the project is a portfolio piece. Revisit them if the project goes public.

## 15. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Handwritten or poor-quality scans** reduce grading accuracy | Wrong scores, low trust | Readability flag, low-confidence marker, upload quality tips, instructor review as backstop, gold set that includes real handwritten samples |
| **Free-tier rate limits and daily quotas** | Grading delays or failures; manual-review spikes | Queued grading, silent retry for short limits, clear key-status messaging, bulk re-run after reset, resubmission limits, no re-grade on due-date edits |
| **Free-tier data use by Google** | Student work may be used to improve Google products | Disclosure and acknowledgement at key setup, Privacy Notice, instructor attestation, any valid key (including paid) accepted |
| **Instructor API keys leaked or mishandled** | Misuse of an instructor's Google account quota | Encrypted storage, masked display, never logged, never visible to others, remove-key control |
| **Re-grading on criteria edits surprises instructors** | Lost review effort, frustration | Confirmation with affected count, approved items not auto-re-graded, combined confirmations |
| **No dispute flow** | Student trust depends on instructor review quality | Visible chips, edit tracking, instructor comment, AI disclosure note directing students to the instructor; revisit dispute flow in a later version |
| **Retry logic masks persistent Gemini outages** | Hidden degradation | Capped retries, platform failure counters, admin health view |
| **Unbounded resubmissions encourage trial-and-error against the AI** | Quota burn; inflated scores; unfair advantage | Per-assignment limit with instructor override; monitor resubmission health |
| **Student privacy and minors' data** | Reputational and regulatory exposure | Data minimization, instructor attestation, Terms and Privacy Notice, deletion on request, Super Admin metadata-only access. Wording review before real students use it |
| **Prompt injection through student or reference files** | Inflated scores | Data-only prompting, injection samples in the gold set, instructor review |
| **Score inconsistency across students or re-grades** | Perceived unfairness | Low-variability grading, versioned prompts, recorded model version, gold set |
| **Free-text criteria are vague or contradictory** | Poor grading | Inline guidance and examples; optional reference files; a preview grade on a sample file is a later-version candidate |
| **Over-reliance on AI by instructors (rubber-stamping)** | Quality erosion | Bulk-approve confirmation, edit tracking, gold-set based accuracy instead of edit rate |
| **Email deliverability and notification overload** | Missed or ignored notifications | Digests, preferences, in-app as the source of truth; a verified custom domain after v1 |
| **Scope too large for one developer** | Delays core grading flow | Priorities (Must/Should/Could); announcements, labels, bulk approve, and per-assignment export are cut first |

## 16. Decisions and Open Questions

### 16.1 Confirmed decisions (owner)

| # | Decision |
|---|---|
| D1 | Audience is mixed (adults and possibly minors); the instructor attests to authority and to informing students |
| D2 | Each instructor adds their own Gemini API key (free or paid). The platform pays no AI cost and has no billing |
| D3 | This PRD is product-only; technical detail lives in the TRD |
| D4 | Reference files have a per-file "Visible to students" toggle, off by default |
| D5 | This is a portfolio project. No public-launch program in v1 |
| D6 | Editing only the due date recomputes Late flags and does not re-grade |
| D7 | If a resubmission ends in Needs manual review because of a system problem, it still uses a student attempt; the instructor can give it back |
| D8 | The reopen dialog can grant attempts at the same time (default 1 when the student has none left) |
| D9 | When an approved submission is re-graded, the student keeps seeing the approved grade until the instructor approves the new result |
| D10 | Users can delete their own account in Settings (self-service) |
| D11 | Students are notified when a new assignment is published and when its due date changes |
| D12 | Instructors can permanently delete their own classes, not only archive them |
| D13 | Google sign-in on an unverified password account links it, verifies it, and clears the old password |
| D14 | Light and dark themes in v1; the UX Brief specifies both, with a manual choice in Settings > Account |
| D15 | v1 sends email from a configured sender address, with no custom domain |
| D16 | Total upload size per submission is 15 MB, with reference files counted in the same total when grading |
| D17 | No notification to the instructor when a re-grade is ready; it appears in the review queue |

### 16.2 Assumed defaults (override any)

| # | Default |
|---|---|
| A1 | Super Admin has metadata-only access and cannot create classes, grade, or open student submissions. All admin actions are logged |
| A2 | Email verification only gates email notifications, not creating classes or codes |
| A3 | Criteria or reference-file edits do not auto-re-grade approved submissions; they are flagged for the instructor |
| A4 | Late is based on the latest submission time; the instructor sees both timestamps |
| A5 | Class stats need at least 5 graded submissions and use approved scores only |
| A6 | One role per account in v1 |
| A7 | Students see AI feedback immediately, before instructor review |
| A8 | An instructor without a valid key can still publish assignments; submissions go to manual review with a visible banner |
| A9 | Defaults: 3 resubmissions, join approval off, late submissions accepted, up to 3 reference files |
| A10 | Retain data until deleted, or 12 months after class archive, then delete |
| A11 | "Allow late submission" unlocks the student's upload for that assignment |
| A12 | HEIC photos are accepted and converted to JPEG automatically |
| A13 | Scoring format is locked once any submission exists; no conversion in v1 |
| A14 | On account deletion, personal data and uploaded files are deleted at once; the instructor's gradebook keeps an anonymized "Deleted student" row with score and status only |
| A15 | Instructors are notified 30 days before archived-class data is deleted at the 12-month mark, with a link to download the gradebook |
| A16 | Suspending or reinstating an account takes an optional reason and emails the user |

The Must/Should/Could priorities in Section 7 are also proposals, sized for one developer.

### 16.3 Open questions

| # | Question | Owner / when |
|---|---|---|
| 1 | Which Gemini model will be used, and what are its input limits? These set the final file, page, and reference-file caps | Model chosen in TRD §11 (candidate Gemini 2.5 Flash); confirmed and limits recorded at spike S3. The caps in FR-SUB-02 can rise after that |
| 2 | Should announcements ship in v1 or move later? | Owner, after M3 |
| 3 | Who writes and reviews the Terms and Privacy Notice wording? Needed before any real student uses the product | Owner, before pilot |
| 4 | Is a small pilot with real classes planned, and if so when? This decides whether M5 is demo-only or includes real classes | Owner |

## 17. Explicitly Out of Scope for v1

- Payments and billing; platform-paid AI
- Native mobile app (the web app must still work well on phones)
- Multi-language grading, including non-English criteria (English is assumed)
- Real-time collaboration
- Plagiarism, similarity-index, and AI-generated-content detection
- LMS integrations (Google Classroom, Canvas, and others)
- Gradebook analytics beyond the basic table, tracker, and CSV export
- Structured rubric builder (criteria stays free-text, with optional reference files)
- AI-inferred sub-criteria score breakdown
- In-app dispute or appeal flow, and public or private comment threads
- Comments or reactions on announcements
- Admin approval as a gate for class creation
- Collection of gender or other demographic data
- Co-instructors, teaching assistants, and group submissions
- Per-school admin tier (only Super Admin, Instructor, and Student)
- Submission file types beyond PDF and JPG/PNG (HEIC is converted, not stored as a supported type); for example DOCX, PPTX, XLSX, plain text, code files, video, audio
- A public-launch program (formal legal review, compliance certification, beta recruitment)

### 17.1 Later-version backlog (candidates)

- Broader submission formats (DOCX, PPTX, XLSX first)
- Assignment-level option to hold AI feedback until approval
- Preview grade on a sample file before publishing
- Similarity-index tool for comparing submissions within an assignment
- Role switching for users who are both instructors and students
- Scoring-format conversion after submissions exist
- Co-instructors and teaching assistants
- Student "Leave class" action
- Student "Upcoming work" view across classes
- Duplicate an assignment into another class

## 18. Release Plan

Milestones are sequenced by dependency. Dates are not fixed; set them after the TRD estimate.

| Phase | Scope | Exit criteria |
|---|---|---|
| **M0: Foundations** | Auth and terms acceptance, roles, classes with attestation (edit and delete), class codes and join link, join approval, assignments (late policy, resubmission limit, reference files with visibility), file upload and storage | An instructor and a student can complete steps 1 to 4 of the core flow |
| **M1: AI grading and keys** | In-app notification center, Gemini key setup with disclosure and validation, grading pipeline, scoring formats, retry and fallback, quota handling, student result view with chips, attempts-left, and AI disclosure | Grading meets the turnaround target on a small internal set; key problems degrade to manual review cleanly |
| **M2: Review, tracker, and gradebook** | Review queue with side-by-side view, edit and approve, instructor comment, re-grade flow with confirmation, attempt and late overrides, tracker, gradebook, CSV export, assignment archive and delete | An instructor can run a full assignment cycle end to end |
| **M3: Notifications and admin** | Email notifications and the remaining notification events, account settings and account deletion, first-run guidance, Super Admin tools, audit log | All events in Section 10 working; admin can manage accounts and classes |
| **M4: Announcements, labels (Could)** | Class announcements with notifications, assignment labels, bulk approve, per-assignment export | Cut first if the schedule slips |
| **M5: Demo hardening** | Gold-set evaluation, onboarding walkthrough, usability test (SUS), seeded demo data, README and walkthrough, Terms and Privacy Notice wording, optional small pilot | Section 14 metrics collected; the demo runs end to end without manual fixes |

## 19. Dependencies and Assumptions

- Instructors can obtain a Gemini API key from Google (free tier or paid) and accept Google's terms for it. Free-tier limits and terms may change; the product must degrade gracefully (FR-KEY-05).
- Gemini API with multimodal (PDF and image) support. The model for v1 is chosen in the TRD, and its input limits determine the final file and reference-file caps.
- An email delivery provider (SMTP) and a sender address.
- Private object storage with signed-link support.
- An asynchronous job queue for grading.
- Instructors write criteria in English.

## Appendix A: Glossary

| Term | Meaning |
|---|---|
| **Class code** | Short code a student enters (or a join link carries) to join a class |
| **Criteria** | The instructor's free-text description of how work should be graded |
| **Reference file** | Optional file (rubric image, answer key, model solution) attached to an assignment; always seen by Gemini, shown to students only if marked visible |
| **Resubmission / attempt** | A student replacing their files before approval. The first submission is free; each later one uses an attempt |
| **AI-generated** | Status of a score and feedback produced by Gemini and not yet approved |
| **Instructor-approved** | Status after the instructor accepts (possibly after editing) the grade; the submission is locked |
| **Needs manual review** | The AI could not grade (failure, or key problem); the instructor must grade or re-run AI |
| **Gold set** | A fixed set of human-graded submissions used to measure AI accuracy |
| **Gemini key** | The instructor's own Google Gemini API key used for grading their classes |
