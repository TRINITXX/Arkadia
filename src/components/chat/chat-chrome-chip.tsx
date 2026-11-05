import { Globe } from "lucide-react";
import { toggleChromeOf, useChromePane } from "@/lib/chromePanes";

/**
 * A « Chrome » chip under the input while Claude drives a Chrome window for
 * this chat, beside the shells' one (Alexis, 05/11/2026): the window may be
 * hidden, parked off-screen. A click shows it in the panel, or hides it.
 */
export function ChatChromeChip({ paneId }: { paneId: string }) {
  const on = useChromePane(paneId);
  if (!on) return null;
  return (
    <span
      className="chat-chip chrome"
      onClick={() => toggleChromeOf(paneId)}
      title="Claude pilote une fenêtre Chrome : clic pour l'afficher ou la cacher"
    >
      <Globe /> Chrome
    </span>
  );
}
