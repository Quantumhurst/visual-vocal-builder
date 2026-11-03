// Confirmation answers — pure, unit-testable.
//
// Owner-count and equity changes now pause on a visible confirmation card.
// A short "yes"/"confirm" answers it locally instead of paying for a model
// turn; a "change"/"no" keeps the card open so the user can adjust.

const CONFIRM =
  /^(?:(?:yes|yeah|yep|sure|ok|okay|correct|looks good|that'?s right|that is right|lock it in|do it|go ahead)(?:,?\s+confirm)?|confirm(?:ed)?(?:\s+(?:the\s+|this\s+)?split)?)(?:,?\s*please)?[.!?]*$/i;

const CHANGE =
  /^(?:no|nope|not right|not yet|change|edit|adjust|go back|wait|hold on)(?:\s+(?:it|that|this|the split))?[.!?]*$/i;

export function isConfirmationAnswer(text: string): boolean {
  return CONFIRM.test((text ?? "").trim());
}

export function isChangeAnswer(text: string): boolean {
  return CHANGE.test((text ?? "").trim());
}
