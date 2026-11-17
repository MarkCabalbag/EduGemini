/**
 * How often each view asks the API again (API Spec A13), in milliseconds. TanStack Query pauses an interval while the tab
 * is hidden (its `refetchIntervalInBackground` is off by default), as the API Spec and TRD §15.3 require.
 */
export const POLL_MS = {
  /** The unread count in the header bell (NTF-04). */
  notificationBadge: 60_000,
  /** The student's own submission while it is uploading or being graded (API Spec SUB-01, A13). */
  studentSubmission: 5_000,
} as const;
