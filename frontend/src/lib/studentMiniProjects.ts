// Student-facing mini-projects wire module.
//
// C2 lands the REASON_LABELS map + CanSubmitReason type only — the full wire
// module (fetchList, fetchDetail, submit, ...) is added in C3.
//
// REASON_LABELS is the single source of truth for the copy shown when the
// backend returns `can_submit: false` with a `can_submit_reason_if_not`
// literal. Keys MUST stay in sync with the union in
// `StudentMiniProjectDetail.can_submit_reason_if_not` (see ./types.ts).

export const REASON_LABELS = {
  mp_not_visible: 'This mini-project is no longer available.',
  pending_group_assignment: "Your teacher will assign you to a group soon. You'll be able to submit then.",
  group_disabled: 'Your group is disabled. Contact your teacher.',
  already_accepted: 'Your project has been accepted — no further submission needed.',
  awaiting_evaluation: 'Your previous submission is awaiting evaluation.',
  hard_deadline_passed: 'The submission deadline has passed.',
  resubmission_deadline_passed: 'The resubmission deadline has passed.',
} as const;

export type CanSubmitReason = keyof typeof REASON_LABELS;
