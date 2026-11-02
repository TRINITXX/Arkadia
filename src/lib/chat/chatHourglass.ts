/**
 * Whether Claude's reply ends on a lone ⏳ paragraph (« nothing asked of
 * you », the hooks' signal): it isn't more text after the opening line, so
 * that line stays plain (the user's ask of 02/11/2026).
 */
export function endsWithHourglass(text: string): boolean {
  return /\n[ \t]*\n[ \t]*\u23f3\ufe0f?\s*$/u.test(text);
}
