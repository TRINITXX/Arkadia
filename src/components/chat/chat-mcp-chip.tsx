import { useState } from "react";
import { Plug } from "lucide-react";
import type { McpServerInfo } from "@/lib/chat/chatProtocol";
import {
  mcpFailed,
  mcpName,
  mcpSorted,
  mcpStatusLabel,
} from "@/lib/chat/chatSdkSettings";
import { useChatLayer } from "@/lib/chat/useChatLayers";

/**
 * « N MCP en échec » in the status bar, only while one is: a click lists
 * every server with its state (the failed first, with why), and asks the
 * chat server for their state now (`onOpen`). A list left open stays until
 * closed, even once all are fine again.
 */
export function ChatMcpChip({
  servers,
  onOpen,
}: {
  servers: McpServerInfo[];
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  useChatLayer(open, () => setOpen(false));
  const failed = mcpFailed(servers).length;
  if (failed === 0 && !open) return null;
  return (
    <span className="chat-anchor">
      <span
        className={`chat-chip chat-mcp-chip${failed > 0 ? " warn" : ""}`}
        title="Serveurs MCP : leur état"
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
      >
        <Plug /> {failed > 0 ? `${failed} MCP en échec` : "MCP"}
      </span>
      {open && (
        <div className="chat-mcp-list" onMouseLeave={() => setOpen(false)}>
          {mcpSorted(servers).map((s) => (
            <div key={s.name} className={`row ${s.status}`}>
              <span className="dot" />
              <span className="n" title={s.name}>
                {mcpName(s.name)}
              </span>
              <span className="st">{mcpStatusLabel(s.status)}</span>
              {s.error && <div className="err">{s.error}</div>}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
