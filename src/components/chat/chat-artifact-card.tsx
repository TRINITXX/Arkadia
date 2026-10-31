import { AppWindow, SquareArrowOutUpRight } from "lucide-react";
import { openUrl } from "@/lib/bridge";

/** The artifact's id, shortened: its name when the link bears none. */
function shortId(href: string): string {
  const id = /\/artifact\/([^/?#]+)/.exec(href)?.[1] ?? "";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

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
  const named =
    label.trim() && label.trim() !== href && !/^https?:/.test(label);
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
      <span className="t">{named ? label.trim() : shortId(href)}</span>
      <span className="go">
        Ouvrir <SquareArrowOutUpRight />
      </span>
    </span>
  );
}
