/**
 * Which links are claude.ai artifacts: the chat draws them as cards, on the
 * desktop (`chat-artifact-card.tsx`) and on the iPhone (`artifact-card.tsx`),
 * and the desktop opens them in its panel (`openLink`). Free of Tauri: the
 * app imports it.
 */

/** `https://claude.ai/artifact/<id>` or `https://claude.ai/code/artifact/<id>`. */
export function isArtifactUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "claude.ai" &&
      u.pathname.includes("/artifact/")
    );
  } catch {
    return false;
  }
}
