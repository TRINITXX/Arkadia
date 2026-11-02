import { useEffect, useMemo } from "react";
import { FlatList } from "react-native";
import type { McpServerInfo } from "@/lib/chat/chatProtocol";
import { mcpRows } from "@/lib/chat/chatSlash";
import { mcpRowView } from "@/lib/chat/phoneSlash";
import { McpServerRow } from "~/chat/slash/mcp-row";
import { SlashSheet } from "~/chat/slash/slash-sheet";
import { useMcpPending } from "~/chat/slash/use-mcp-pending";
import type { ChatActions } from "~/chat/use-chat";

/**
 * /mcp: the chat's MCP servers by section, those that need the user first
 * (`mcpRows`), their state asked again as it opens. A row's button connects
 * or reconnects, its switch cuts a server off or back on; a sign-in opens
 * in the PC's browser (the callback lands there).
 */
export function McpSheet({
  visible,
  query,
  onQuery,
  servers,
  actions,
  onClose,
}: {
  visible: boolean;
  query: string;
  onQuery: (query: string) => void;
  servers: McpServerInfo[];
  actions: ChatActions;
  onClose: () => void;
}) {
  const { refreshMcp } = actions;
  useEffect(() => {
    if (visible) void refreshMcp();
  }, [visible, refreshMcp]);
  const rows = useMemo(() => mcpRows(servers, query), [servers, query]);
  const mcp = useMcpPending(servers, actions.mcp);

  return (
    <SlashSheet
      visible={visible}
      title="Serveurs MCP"
      icon="powerplug"
      query={query}
      onQuery={onQuery}
      onClose={onClose}
      notice={rows.length === 0 ? { text: "Aucun serveur MCP" } : null}
    >
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <McpServerRow
            row={item}
            view={mcpRowView(item, mcp.pending[item.id])}
            onAct={() => mcp.pick(item, false)}
            onToggle={() => mcp.pick(item, true)}
          />
        )}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        indicatorStyle="white"
      />
    </SlashSheet>
  );
}
