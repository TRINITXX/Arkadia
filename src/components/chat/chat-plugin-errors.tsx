import { useState } from "react";
import { RotateCw } from "lucide-react";
import type { ChatItem } from "@/lib/chat/chatState";

type NoticeItem = Extract<ChatItem, { kind: "notice" }>;

/**
 * Plugins that failed to load (`init.plugin_errors`), and « Recharger »:
 * plugins and skills read again from disk, the result said under it by the
 * chat server. One click per notice: the next init says what still fails.
 */
export function ChatPluginErrors({
  item,
  onReload,
}: {
  item: NoticeItem;
  onReload?: () => void;
}) {
  const [asked, setAsked] = useState(false);
  return (
    <div className="chat-unit chat-notice-block error chat-plugin-errors">
      <div className="text">{item.text}</div>
      {onReload && (
        <button
          type="button"
          className="chat-btn"
          disabled={asked}
          title="Relire les plugins et les skills depuis le disque"
          onClick={() => {
            setAsked(true);
            onReload();
          }}
        >
          <RotateCw /> {asked ? "Rechargement demandé" : "Recharger"}
        </button>
      )}
    </div>
  );
}
