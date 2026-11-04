// Confirmation answers — pure, unit-testable.
//
// Owner-count and equity changes now pause on a visible confirmation card.
// A short "yes"/"confirm" answers it locally instead of paying for a model
// turn; a "change"/"no" keeps the card open so the user can adjust.

const CONFIRM =
  /^(?:(?:yes|yeah|yep|sure|ok|okay|correct|looks good|that'?s right|that is right|lock it in|lock in(?:\s+the\s+split)?|do it|go ahead|perfect|that works|that looks good|that's fine|done|proceed|agree)(?:,?\s+(?:please\s+)?confirm(?:ed)?)?|(?:(?:i|we|please)\s+)?confirm(?:ed)?(?:\s+(?:it|that|this|the\s+split|this\s+split|crew\s+split|the\s+crew\s+split|split|to\s+move\s+on|and\s+move\s+on|now))?|split(?:\s+confirmed)?|the split|move on|let'?s move on)(?:,?\s*please)?[.,!?;:]*$/i;

const CHANGE =
  /^(?:no|nope|not right|not yet|change|edit|adjust|go back|wait|hold on)(?:\s+(?:it|that|this|the split))?[.,!?;:]*$/i;

export function isConfirmationAnswer(text: string): boolean {
  return CONFIRM.test((text ?? "").trim());
}

export function isChangeAnswer(text: string): boolean {
  return CHANGE.test((text ?? "").trim());
}
