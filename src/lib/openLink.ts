import { open as openExternal } from "@tauri-apps/plugin-shell";

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

/** `paneId` = the pane that printed the link, `null` = unknown (the main
 *  window then uses the active pane): the artifact opens in that pane's tab,
 *  signed in to its Claude account. */
type ArtifactOpener = (url: string, paneId: string | null) => void;

let artifactOpener: ArtifactOpener | null = null;

/** The main window registers its artifact panel here. Popup windows register
 *  nothing, so their artifact links keep opening in the browser. */
export function setArtifactOpener(opener: ArtifactOpener | null): void {
  artifactOpener = opener;
}

/** Opens a clicked link: an artifact in the panel, anything else in the
 *  default browser. */
export async function openLink(
  url: string,
  paneId: string | null = null,
): Promise<void> {
  if (artifactOpener && isArtifactUrl(url)) {
    artifactOpener(url, paneId);
    return;
  }
  await openExternal(url);
}
