// Transcript hygiene — pure, unit-testable.
//
// Meta's recognizer can attach control/annotation tokens to a transcript
// (`<|speaker_A|>`, `<|language|>` and similar). They are metadata, not
// words the user said, and must never stop a voice command from matching.

export function stripAsrAnnotations(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/<\|[^|]*\|>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
