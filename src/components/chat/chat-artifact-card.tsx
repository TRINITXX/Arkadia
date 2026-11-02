import { AppWindow, SquareArrowOutUpRight } from "lucide-react";
import { artifactCardTitle, useArtifactTitle } from "@/lib/artifactTitles";
import { openUrl } from "@/lib/bridge";

/**
 * A claude.ai artifact link in Claude's words, as a card: « Artefact ·
 * titre · Ouvrir ». It opens like the link did, in the tab's artifact panel
 * (`openLink`). Inline: it sits in a paragraph.
 */
export function ChatArtifactCard({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  // The title its page showed in the panel (`artifactTitles`).
  const known = useArtifactTitle(href);
  const open = () => void openUrl(href).catch(() => {});
  return (
    <span
      className="chat-artifact"
      role="link"
      tabIndex={0}
      title={href}
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
      }}
    >
      <AppWindow className="ico" />
      <span className="k">Artefact</span>
      <span className="t">{artifactCardTitle(href, label, known)}</span>
      {/* The open icon alone: the card opens on a click anyway. */}
      <SquareArrowOutUpRight className="go" aria-label="Ouvrir" />
    </span>
  );
}
