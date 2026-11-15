-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "role" AS ENUM ('STUDENT', 'INSTRUCTOR', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED', 'REMOVED');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "scoring_format" AS ENUM ('POINTS', 'PERCENTAGE', 'LETTER_NUMERIC');

-- CreateEnum
CREATE TYPE "submission_state" AS ENUM ('QUEUED', 'GRADING', 'AI_GENERATED', 'NEEDS_MANUAL_REVIEW', 'INSTRUCTOR_APPROVED');

-- CreateEnum
CREATE TYPE "manual_review_cause" AS ENUM ('AI_FAILED', 'KEY_MISSING', 'KEY_INVALID', 'KEY_QUOTA', 'FILE_QUALITY');

-- CreateEnum
CREATE TYPE "version_status" AS ENUM ('UPLOADING', 'STORED', 'REPLACED');

-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('STORED', 'FAILED');

-- CreateEnum
CREATE TYPE "grade_source" AS ENUM ('AI', 'INSTRUCTOR');

-- CreateEnum
CREATE TYPE "grade_status" AS ENUM ('ACTIVE', 'PENDING_REVIEW', 'SUPERSEDED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "key_status" AS ENUM ('CONNECTED', 'NEEDS_ATTENTION', 'QUOTA_REACHED');

-- CreateEnum
CREATE TYPE "review_action_type" AS ENUM ('APPROVE', 'REOPEN', 'MANUAL_GRADE', 'GRANT_ATTEMPTS', 'ALLOW_LATE', 'REGRADE_REQUEST', 'REGRADE_APPROVE', 'REGRADE_KEEP_PREVIOUS');

-- CreateEnum
CREATE TYPE "attempt_outcome" AS ENUM ('SUCCESS', 'TRANSIENT_ERROR', 'KEY_ERROR', 'QUOTA_ERROR', 'FILE_ERROR', 'STALE_DISCARDED');

-- CreateEnum
CREATE TYPE "token_purpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('SUBMISSION_GRADED', 'GRADE_APPROVED', 'SUBMISSION_AWAITING_REVIEW', 'NEEDS_MANUAL_REVIEW_INSTRUCTOR', 'NEEDS_MANUAL_REVIEW_STUDENT', 'KEY_NEEDS_ATTENTION', 'REGRADE_COMPLETE', 'SUBMISSION_REOPENED', 'JOIN_REQUEST_RECEIVED', 'JOIN_DECIDED', 'ATTEMPTS_GRANTED', 'LATE_ALLOWED', 'ASSIGNMENT_PUBLISHED', 'DUE_DATE_CHANGED', 'CLASS_DELETED', 'INSTRUCTOR_ACCOUNT_DELETED', 'ACCOUNT_STATUS_CHANGED', 'RETENTION_NOTICE', 'ANNOUNCEMENT_POSTED');

-- CreateEnum
CREATE TYPE "email_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "terms_accepted_at" TIMESTAMPTZ(3),
    "terms_version" TEXT,
    "suspended_at" TIMESTAMPTZ(3),
    "suspend_reason" TEXT,
    "tombstone" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "token_purpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "email_on" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category")
);

-- CreateTable
CREATE TABLE "instructor_keys" (
    "id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "last4" CHAR(4) NOT NULL,
    "status" "key_status" NOT NULL DEFAULT 'CONNECTED',
    "last_success_at" TIMESTAMPTZ(3),
    "disclosure_ack_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instructor_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "section" TEXT,
    "subject" TEXT,
    "room" TEXT,
    "join_code" VARCHAR(8) NOT NULL,
    "join_code_active" BOOLEAN NOT NULL DEFAULT true,
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
    "attested_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "retention_notice_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "enrollment_status" NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_labels" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,

    CONSTRAINT "assignment_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "label_id" UUID,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "criteria_text" TEXT NOT NULL,
    "criteria_version" INTEGER NOT NULL DEFAULT 1,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "scoring_format" "scoring_format" NOT NULL,
    "max_score" DECIMAL(6,2) NOT NULL,
    "letter_scale" JSONB,
    "max_resubmissions" INTEGER,
    "accept_late" BOOLEAN NOT NULL DEFAULT true,
    "status" "assignment_status" NOT NULL DEFAULT 'DRAFT',
    "regrade_not_before" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_files" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "visible_to_students" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "state" "submission_state",
    "manual_review_cause" "manual_review_cause",
    "current_version_id" UUID,
    "active_grade_id" UUID,
    "resubmissions_used" INTEGER NOT NULL DEFAULT 0,
    "extra_attempts" INTEGER NOT NULL DEFAULT 0,
    "late_allowed" BOOLEAN NOT NULL DEFAULT false,
    "first_submitted_at" TIMESTAMPTZ(3),
    "latest_submitted_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "instructor_comment" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_versions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "version_status" NOT NULL DEFAULT 'UPLOADING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stored_at" TIMESTAMPTZ(3),

    CONSTRAINT "submission_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_files" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "client_file_id" VARCHAR(64) NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" "file_status" NOT NULL DEFAULT 'STORED',
    "storage_path" TEXT,
    "display_name" TEXT,
    "mime_type" VARCHAR(64),
    "size_bytes" BIGINT,
    "page_count" INTEGER,
    "sha256" CHAR(64),
    "failure_code" VARCHAR(16),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_results" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "source" "grade_source" NOT NULL,
    "status" "grade_status" NOT NULL,
    "score" DECIMAL(6,2),
    "letter" VARCHAR(3),
    "feedback" TEXT,
    "criteria_version" INTEGER NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT,
    "confidence" VARCHAR(6),
    "readability_issue" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_actions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "review_action_type" NOT NULL,
    "ai_score" DECIMAL(6,2),
    "final_score" DECIMAL(6,2),
    "edit_class" VARCHAR(16),
    "attempts_granted" INTEGER,
    "late_allowed" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_attempts" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "outcome" "attempt_outcome" NOT NULL,
    "error_class" VARCHAR(32),
    "latency_ms" INTEGER,
    "model" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grading_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_files" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "payload" JSONB NOT NULL,
    "link" VARCHAR(512) NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "email_status" "email_status" NOT NULL DEFAULT 'SKIPPED',
    "email_after" TIMESTAMPTZ(3),
    "emailed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" "role",
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(64) NOT NULL,
    "target_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_deletions" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_path" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "storage_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key" ON "auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_user_id_idx" ON "email_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_tokens_expires_at_idx" ON "email_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_keys_instructor_id_key" ON "instructor_keys"("instructor_id");

-- CreateIndex
CREATE UNIQUE INDEX "classes_join_code_key" ON "classes"("join_code");

-- CreateIndex
CREATE INDEX "classes_instructor_id_idx" ON "classes"("instructor_id");

-- CreateIndex
CREATE INDEX "enrollments_student_id_idx" ON "enrollments"("student_id");

-- CreateIndex
CREATE INDEX "enrollments_class_id_status_idx" ON "enrollments"("class_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_class_id_student_id_key" ON "enrollments"("class_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_labels_class_id_name_key" ON "assignment_labels"("class_id", "name");

-- CreateIndex
CREATE INDEX "assignments_class_id_status_due_at_idx" ON "assignments"("class_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "assignments_label_id_idx" ON "assignments"("label_id");

-- CreateIndex
CREATE UNIQUE INDEX "reference_files_storage_path_key" ON "reference_files"("storage_path");

-- CreateIndex
CREATE UNIQUE INDEX "reference_files_assignment_id_ordinal_key" ON "reference_files"("assignment_id", "ordinal");

-- CreateIndex
CREATE INDEX "submissions_student_id_idx" ON "submissions"("student_id");

-- CreateIndex
CREATE INDEX "submissions_assignment_id_state_idx" ON "submissions"("assignment_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_assignment_id_student_id_key" ON "submissions"("assignment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_versions_submission_id_version_no_key" ON "submission_versions"("submission_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "submission_versions_id_submission_id_key" ON "submission_versions"("id", "submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_files_storage_path_key" ON "submission_files"("storage_path");

-- CreateIndex
CREATE UNIQUE INDEX "submission_files_version_id_client_file_id_key" ON "submission_files"("version_id", "client_file_id");

-- CreateIndex
CREATE INDEX "grade_results_submission_id_status_idx" ON "grade_results"("submission_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "grade_results_id_submission_id_key" ON "grade_results"("id", "submission_id");

-- CreateIndex
CREATE INDEX "review_actions_submission_id_created_at_idx" ON "review_actions"("submission_id", "created_at");

-- CreateIndex
CREATE INDEX "grading_attempts_submission_id_idx" ON "grading_attempts"("submission_id");

-- CreateIndex
CREATE INDEX "grading_attempts_created_at_idx" ON "grading_attempts"("created_at");

-- CreateIndex
CREATE INDEX "announcements_author_id_idx" ON "announcements"("author_id");

-- CreateIndex
CREATE INDEX "announcements_class_id_created_at_idx" ON "announcements"("class_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_files_storage_path_key" ON "announcement_files"("storage_path");

-- CreateIndex
CREATE INDEX "announcement_files_announcement_id_idx" ON "announcement_files"("announcement_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_deletions_bucket_object_path_key" ON "storage_deletions"("bucket", "object_path");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_keys" ADD CONSTRAINT "instructor_keys_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_labels" ADD CONSTRAINT "assignment_labels_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "assignment_labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_files" ADD CONSTRAINT "reference_files_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "submission_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_results" ADD CONSTRAINT "grade_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_attempts" ADD CONSTRAINT "grading_attempts_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_files" ADD CONSTRAINT "announcement_files_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================
-- Raw SQL from docs/backend-schema.md Appendix B (applied after the Prisma tables)
-- ============================================================

-- ============================================================
-- B.1 CHECK constraints
-- ============================================================

ALTER TABLE users ADD CONSTRAINT users_email_lower CHECK (email = lower(email));
ALTER TABLE users ADD CONSTRAINT users_email_shape CHECK (position('@' IN email) > 1);
ALTER TABLE users ADD CONSTRAINT users_terms_required
  CHECK (tombstone OR terms_accepted_at IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT users_tombstone_consistent
  CHECK (NOT tombstone OR (password_hash IS NULL AND email LIKE 'deleted-%@tombstone.invalid'));

ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_provider
  CHECK (provider IN ('google'));

ALTER TABLE sessions ADD CONSTRAINT sessions_expiry_after_create
  CHECK (expires_at > created_at);
ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_expiry_after_create
  CHECK (expires_at > created_at);

ALTER TABLE instructor_keys ADD CONSTRAINT instructor_keys_iv_length
  CHECK (octet_length(iv) = 12 AND octet_length(auth_tag) = 16);
ALTER TABLE instructor_keys ADD CONSTRAINT instructor_keys_version
  CHECK (key_version >= 1);

ALTER TABLE classes ADD CONSTRAINT classes_join_code_format
  CHECK (join_code ~ '^[A-HJ-NP-Z2-9]{8}$');
ALTER TABLE classes ADD CONSTRAINT classes_name_length
  CHECK (char_length(name) BETWEEN 1 AND 120);
ALTER TABLE classes ADD CONSTRAINT classes_retention_order
  CHECK (retention_notice_at IS NULL OR (archived_at IS NOT NULL AND retention_notice_at >= archived_at));

ALTER TABLE assignments ADD CONSTRAINT assignments_max_resubmissions_range
  CHECK (max_resubmissions IS NULL OR max_resubmissions BETWEEN 0 AND 10);
ALTER TABLE assignments ADD CONSTRAINT assignments_max_score_range
  CHECK (max_score > 0 AND max_score <= 1000);
ALTER TABLE assignments ADD CONSTRAINT assignments_timezone_present
  CHECK (char_length(timezone) > 0);
ALTER TABLE assignments ADD CONSTRAINT assignments_published_has_time
  CHECK (status = 'DRAFT' OR published_at IS NOT NULL);

ALTER TABLE reference_files ADD CONSTRAINT reference_files_ordinal
  CHECK (ordinal BETWEEN 1 AND 3);
ALTER TABLE reference_files ADD CONSTRAINT reference_files_size
  CHECK (size_bytes > 0 AND size_bytes <= 10485760);
ALTER TABLE reference_files ADD CONSTRAINT reference_files_mime
  CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png'));

ALTER TABLE submissions ADD CONSTRAINT submissions_attempts_nonnegative
  CHECK (resubmissions_used >= 0 AND extra_attempts >= 0);
ALTER TABLE submissions ADD CONSTRAINT submissions_state_matches_version
  CHECK ((state IS NULL) = (current_version_id IS NULL));
ALTER TABLE submissions ADD CONSTRAINT submissions_cause_matches_state
  CHECK ((state = 'NEEDS_MANUAL_REVIEW') = (manual_review_cause IS NOT NULL));
ALTER TABLE submissions ADD CONSTRAINT submissions_approval_matches_state
  CHECK ((state = 'INSTRUCTOR_APPROVED') = (approved_at IS NOT NULL));
ALTER TABLE submissions ADD CONSTRAINT submissions_approved_has_grade
  CHECK (state IS DISTINCT FROM 'INSTRUCTOR_APPROVED' OR active_grade_id IS NOT NULL);
ALTER TABLE submissions ADD CONSTRAINT submissions_time_order
  CHECK (first_submitted_at IS NULL OR latest_submitted_at >= first_submitted_at);

ALTER TABLE submission_versions ADD CONSTRAINT submission_versions_stored_matches_status
  CHECK ((status = 'UPLOADING') = (stored_at IS NULL));

ALTER TABLE submission_files ADD CONSTRAINT submission_files_stored_fields
  CHECK (
    (status = 'STORED' AND storage_path IS NOT NULL AND size_bytes > 0
       AND sha256 IS NOT NULL AND mime_type IS NOT NULL)
    OR
    (status = 'FAILED' AND failure_code IS NOT NULL)
  );
ALTER TABLE submission_files ADD CONSTRAINT submission_files_size_limit
  CHECK (size_bytes IS NULL OR size_bytes <= 10485760);
ALTER TABLE submission_files ADD CONSTRAINT submission_files_page_limit
  CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 20);
ALTER TABLE submission_files ADD CONSTRAINT submission_files_ordinal
  CHECK (ordinal BETWEEN 1 AND 10);
ALTER TABLE submission_files ADD CONSTRAINT submission_files_mime
  CHECK (mime_type IS NULL OR mime_type IN ('application/pdf', 'image/jpeg', 'image/png'));
ALTER TABLE submission_files ADD CONSTRAINT submission_files_failure_code
  CHECK (failure_code IS NULL OR failure_code IN ('TYPE', 'SIZE', 'PAGES', 'PASSWORD', 'CORRUPT'));

ALTER TABLE grade_results ADD CONSTRAINT grade_results_score_nonnegative
  CHECK (score IS NULL OR score >= 0);
ALTER TABLE grade_results ADD CONSTRAINT grade_results_ai_provenance
  CHECK (source <> 'AI' OR (model IS NOT NULL AND prompt_version IS NOT NULL));
ALTER TABLE grade_results ADD CONSTRAINT grade_results_live_has_score
  CHECK (status NOT IN ('ACTIVE', 'PENDING_REVIEW') OR score IS NOT NULL);
ALTER TABLE grade_results ADD CONSTRAINT grade_results_letter_format
  CHECK (letter IS NULL OR letter ~ '^[A-F][+-]?$');
ALTER TABLE grade_results ADD CONSTRAINT grade_results_confidence_values
  CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low'));

ALTER TABLE review_actions ADD CONSTRAINT review_actions_payload
  CHECK (
    (action = 'APPROVE' AND final_score IS NOT NULL)
    OR (action = 'GRANT_ATTEMPTS' AND attempts_granted IS NOT NULL AND attempts_granted > 0)
    OR (action = 'ALLOW_LATE' AND late_allowed IS TRUE)
    OR action IN ('REOPEN', 'MANUAL_GRADE', 'REGRADE_REQUEST', 'REGRADE_APPROVE', 'REGRADE_KEEP_PREVIOUS')
  );
ALTER TABLE review_actions ADD CONSTRAINT review_actions_edit_class
  CHECK (edit_class IS NULL OR edit_class IN ('edit_free', 'score_only', 'feedback_only', 'both'));

ALTER TABLE grading_attempts ADD CONSTRAINT grading_attempts_number
  CHECK (attempt_no >= 1);

ALTER TABLE notifications ADD CONSTRAINT notifications_link_relative
  CHECK (link LIKE '/%' AND link NOT LIKE '//%');
ALTER TABLE notifications ADD CONSTRAINT notifications_pending_has_time
  CHECK (email_status <> 'PENDING' OR email_after IS NOT NULL);

ALTER TABLE announcements ADD CONSTRAINT announcements_title_length
  CHECK (char_length(title) BETWEEN 1 AND 200);

ALTER TABLE storage_deletions ADD CONSTRAINT storage_deletions_attempts
  CHECK (attempts >= 0);

-- ============================================================
-- B.2 Partial unique indexes
-- ============================================================

CREATE UNIQUE INDEX grade_results_one_active
  ON grade_results (submission_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX grade_results_one_pending
  ON grade_results (submission_id) WHERE status = 'PENDING_REVIEW';
CREATE UNIQUE INDEX submission_versions_one_uploading
  ON submission_versions (submission_id) WHERE status = 'UPLOADING';

-- ============================================================
-- B.3 Partial indexes for queries (Section 9.3)
-- ============================================================

CREATE INDEX submissions_review_queue_idx
  ON submissions (assignment_id, latest_submitted_at)
  WHERE state IN ('AI_GENERATED', 'NEEDS_MANUAL_REVIEW');
CREATE INDEX submissions_approved_idx
  ON submissions (assignment_id) WHERE state = 'INSTRUCTOR_APPROVED';
CREATE INDEX notifications_unread_idx
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_email_due_idx
  ON notifications (email_after) WHERE email_status = 'PENDING';
CREATE INDEX classes_archived_idx
  ON classes (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX submission_versions_uploading_idx
  ON submission_versions (created_at) WHERE status = 'UPLOADING';
CREATE INDEX storage_deletions_pending_idx
  ON storage_deletions (requested_at) WHERE completed_at IS NULL;
CREATE INDEX announcements_stream_idx
  ON announcements (class_id, created_at DESC);

-- ============================================================
-- B.4 Deferrable composite foreign keys (Section 7.3)
-- ============================================================

ALTER TABLE submissions ADD CONSTRAINT submissions_current_version_fk
  FOREIGN KEY (current_version_id, id)
  REFERENCES submission_versions (id, submission_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE submissions ADD CONSTRAINT submissions_active_grade_fk
  FOREIGN KEY (active_grade_id, id)
  REFERENCES grade_results (id, submission_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE grade_results ADD CONSTRAINT grade_results_version_fk
  FOREIGN KEY (version_id, submission_id)
  REFERENCES submission_versions (id, submission_id)
  DEFERRABLE INITIALLY DEFERRED;

-- ============================================================
-- B.5 Triggers (Section 7.4)
-- ============================================================

CREATE OR REPLACE FUNCTION grade_score_in_range() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  max_pts numeric;
BEGIN
  IF NEW.score IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.max_score INTO max_pts
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
   WHERE s.id = NEW.submission_id;

  IF max_pts IS NULL THEN
    RAISE EXCEPTION 'grade references an unknown submission'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.score > max_pts THEN
    RAISE EXCEPTION 'score % is above the maximum %', NEW.score, max_pts
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER grade_score_in_range
  BEFORE INSERT OR UPDATE OF score ON grade_results
  FOR EACH ROW EXECUTE FUNCTION grade_score_in_range();

CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.created_at < now() - interval '12 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only; rows can be deleted only after 12 months'
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();

-- ============================================================
-- B.6 Roles, grants, and row-level security (Sections 12.1 to 12.4)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOINHERIT;
  END IF;
  -- Supabase provides these roles. Plain Postgres (the CI service container) does not, so create them there.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','auth_identities','sessions','email_tokens','notification_preferences',
    'instructor_keys','classes','enrollments','assignment_labels','assignments',
    'reference_files','submissions','submission_versions','submission_files',
    'grade_results','review_actions','grading_attempts','announcements',
    'announcement_files','notifications','audit_logs','storage_deletions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY app_runtime_all ON public.%I FOR ALL TO app_runtime USING (true) WITH CHECK (true)',
      t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ============================================================
-- B.7 Run after `pnpm db:boss:init` (Section 11.1)
-- ============================================================
-- GRANT USAGE ON SCHEMA pgboss TO app_runtime;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO app_runtime;
-- GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA pgboss TO app_runtime;
