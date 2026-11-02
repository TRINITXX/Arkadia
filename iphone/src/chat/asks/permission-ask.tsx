import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { toolLabel } from "@/lib/chat/chatGroups";
import {
  alwaysChoices,
  permissionAsker,
  suggestionDetail,
} from "@/lib/chat/chatPermissions";
import type { PermissionResult } from "@/lib/chat/chatProtocol";
import { mcpName } from "@/lib/chat/chatSdkSettings";
import type { PendingRequest, Subagent } from "@/lib/chat/chatState";
import { permissionView } from "@/lib/chat/phoneAsks";
import { A } from "~/chat/asks/ask-colors";
import { AskButton } from "~/chat/asks/ask-button";
import { AskFrame } from "~/chat/asks/ask-frame";
import { AskHead } from "~/chat/asks/ask-head";
import { PermissionInput } from "~/chat/asks/permission-input";
import { useTapGrace } from "~/chat/asks/use-tap-grace";
import { C, MONO, T } from "~/chat/chat-theme";

/**
 * Any other tool Claude Code asks about (the desktop's
 * `chat-permission-panel.tsx`): who asks (a subagent), what it would do and
 * on which path or MCP server; allow, allow and stop asking (one button per
 * rule change it suggests, none when Claude Code forbids it), or refuse.
 * Nothing stands out on « Autoriser » for a request Claude Code wants
 * cautious (`defaultToNo`): « Refuser » does.
 */
export function PermissionAsk({
  request,
  subagents,
  onAnswer,
}: {
  request: PendingRequest;
  subagents: Subagent[];
  onAnswer: (result: PermissionResult) => void;
}) {
  const grace = useTapGrace();
  const view = useMemo(() => permissionView(request), [request]);
  const asker = permissionAsker(request.agentId, subagents);
  const always = alwaysChoices(request);
  const cautious = request.defaultToNo === true;
  return (
    <AskFrame
      head={
        <>
          {asker && <Text style={styles.asker}>{asker}</Text>}
          <AskHead
            icon="shield.lefthalf.filled"
            title={
              request.title ?? `Autoriser ${toolLabel(request.toolName)} ?`
            }
          />
        </>
      }
      footer={
        <>
          {always.map(({ suggestion, label }) => (
            <AskButton
              key={label}
              icon="checkmark.circle"
              label={label}
              hint={suggestionDetail(suggestion)}
              onPress={grace(() =>
                onAnswer({
                  behavior: "allow",
                  updatedInput: request.input,
                  updatedPermissions: [suggestion],
                }),
              )}
            />
          ))}
          <View style={styles.row}>
            <AskButton
              grow
              icon="xmark"
              label="Refuser"
              tone={cautious ? "no" : "ghost"}
              hint={
                cautious
                  ? "Claude Code conseille de refuser par défaut cette action"
                  : undefined
              }
              onPress={grace(() =>
                onAnswer({
                  behavior: "deny",
                  message: "The user refused this action.",
                }),
              )}
            />
            <AskButton
              grow
              icon="checkmark"
              label="Autoriser"
              tone={cautious ? "plain" : "primary"}
              onPress={grace(() =>
                onAnswer({ behavior: "allow", updatedInput: request.input }),
              )}
            />
          </View>
        </>
      }
    >
      {request.description ? (
        <Text style={styles.sub}>{request.description}</Text>
      ) : null}
      <PermissionInput view={view} />
      {(request.blockedPath || request.mcpServer) && (
        <View style={styles.facts}>
          {request.blockedPath ? (
            <Text style={styles.fact}>
              Chemin concerné :{" "}
              <Text style={styles.code} selectable>
                {request.blockedPath}
              </Text>
            </Text>
          ) : null}
          {request.mcpServer ? (
            <Text style={styles.fact}>
              Serveur MCP :{" "}
              <Text style={styles.bold}>{mcpName(request.mcpServer.name)}</Text>
              {request.mcpServer.source !== "sdk" &&
                ` (configuré : ${request.mcpServer.source})`}
            </Text>
          ) : null}
        </View>
      )}
    </AskFrame>
  );
}

const styles = StyleSheet.create({
  asker: {
    color: A.asker,
    fontSize: T.small - 1,
    marginHorizontal: 2,
    marginBottom: 6,
  },
  sub: { color: C.mute, fontSize: T.small, marginHorizontal: 2 },
  facts: { gap: 3, marginHorizontal: 2 },
  fact: { color: C.mute, fontSize: T.small - 1 },
  code: { fontFamily: MONO, fontSize: 11.5, color: C.dim },
  bold: { color: C.dim, fontWeight: "500" },
  row: { flexDirection: "row", gap: 8 },
});
