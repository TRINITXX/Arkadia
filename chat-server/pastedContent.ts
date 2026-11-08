/**
 * A text the user pasted, as Claude Code keeps it in the session: wrapped in
 * tags named by 4 hex digits, opening and closing alike, each on its own
 * line (its terminal since 10/2026, the chat's `inline_pastes` since
 * 08/11/2026). Shared by the chat server and the page.
 */
const WRAPPED =
  /\n{0,2}<pasted_content id="([0-9a-f]{4})">\n(?:([\s\S]*?)\n)?<\/pasted_content id="\1">\n{0,2}/g;

/** Claude Code's escape of a tag's name inside the text (« <\pasted_content »). */
const ESCAPED_TAG = /<\\(?=\/?pasted_content)/g;

/**
 * A user message as the user wrote it: its pastes out of their tags, each a
 * paragraph (a paste sent mid-line comes back on its own); `pastes`: their
 * texts, trimmed as the chat sends them.
 */
export function unwrapPastedContent(text: string): {
  text: string;
  pastes: string[];
} {
  const parts: string[] = [];
  const pastes: string[] = [];
  const unescape = (s: string) => s.replace(ESCAPED_TAG, "<");
  let at = 0;
  for (const m of text.matchAll(WRAPPED)) {
    if (m.index > at) parts.push(unescape(text.slice(at, m.index)));
    const body = unescape(m[2] ?? "").trim();
    parts.push(body);
    pastes.push(body);
    at = m.index + m[0].length;
  }
  if (at === 0) return { text, pastes };
  if (at < text.length) parts.push(unescape(text.slice(at)));
  return { text: parts.join("\n\n").trim(), pastes };
}
