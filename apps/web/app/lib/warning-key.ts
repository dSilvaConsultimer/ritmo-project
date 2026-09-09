/**
 * Two financial warnings can legitimately have identical text — see
 * docs/DECISIONS.md DEC-047 (a real live-validation finding: repeated
 * fixture data produced the same "Beach trip budget is still unknown"
 * warning more than once in `FinancialSnapshot.warnings`). React requires
 * every list item to have a unique `key`; using the warning text itself
 * breaks as soon as two entries are equal, producing "Encountered two
 * children with the same key." Combining the text with its position in
 * the array keeps every key unique (array positions never repeat) without
 * deduplicating, reordering, dropping, or otherwise changing the meaning
 * of any warning — every warning still renders, exactly as computed.
 */
export function warningKey(text: string, index: number): string {
  return `${index}:${text}`;
}
