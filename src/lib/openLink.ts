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

/** The artifact's page, without query or fragment: Claude Code opens
 *  `…/artifact/<id>?via=auto_preview`, the terminal prints the bare link, and
 *  both must find the same tab of the panel. */
export function artifactPageUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Whether a link from the BROWSER relay is a republish: the
 *  `artifact-refresh` Claude Code hook marks those `?arkadia=refresh`. */
export function isRepublish(url: string): boolean {
  try {
    return new URL(url).searchParams.get("arkadia") === "refresh";
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
