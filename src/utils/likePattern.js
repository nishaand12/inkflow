/**
 * `%` and `_` are wildcards in a LIKE/ILIKE pattern and `\` escapes them, so a
 * search term containing any of these would otherwise match far more than the
 * user typed — "100%" would match every row.
 */
export function escapeLikeTerm(term) {
  return String(term ?? "").replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** A contains-match pattern for a user-supplied term. */
export function containsPattern(term) {
  return `%${escapeLikeTerm(term)}%`;
}
