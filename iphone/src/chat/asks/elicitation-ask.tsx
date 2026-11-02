import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Linking,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native";
import {
  elicitContent,
  elicitFields,
  elicitUrl,
  initialValues,
  type ElicitValues,
} from "@/lib/chat/chatElicitation";
import type { ElicitationAnswer } from "@/lib/chat/chatProtocol";
import { mcpName, type PendingElicitation } from "@/lib/chat/chatSdkSettings";
import { A } from "~/chat/asks/ask-colors";
import { AskButton } from "~/chat/asks/ask-button";
import { AskFrame } from "~/chat/asks/ask-frame";
import { AskHead } from "~/chat/asks/ask-head";
import { ElicitField } from "~/chat/asks/elicit-field";
import { useTapGrace } from "~/chat/asks/use-tap-grace";
import { C, T } from "~/chat/chat-theme";
import { failure } from "~/ui/haptics";

/**
 * An MCP server asks the user something (the desktop's
 * `chat-elicitation-panel.tsx`): a form built from its schema, or a page to
 * open (a sign-in), opened on this phone by the button only, and only an
 * http(s) address. Accept or refuse; nothing is preselected. The server's
 * words are untrusted: shown as text.
 */
export function ElicitationAsk({
  request,
  onAnswer,
}: {
  request: PendingElicitation;
  onAnswer: (result: ElicitationAnswer) => void;
}) {
  const url = request.mode === "url" ? elicitUrl(request.url) : null;
  const fields = useMemo(
    () => (request.mode === "url" ? [] : elicitFields(request.requestedSchema)),
    [request.mode, request.requestedSchema],
  );
  const [values, setValues] = useState<ElicitValues>(() =>
    initialValues(request.requestedSchema, fields),
  );
  const [error, setError] = useState<string | null>(null);
  const grace = useTapGrace();

  // The field with the keyboard comes into view once the card has shrunk
  // above it (`useAsksMaxHeight`).
  const scrollRef = useRef<ScrollViewInstance>(null);
  const tops = useRef<Record<string, number>>({});
  const focused = useRef<string | null>(null);
  const reveal = useCallback(() => {
    const top = focused.current ? tops.current[focused.current] : undefined;
    if (top !== undefined)
      scrollRef.current?.scrollTo({ y: Math.max(0, top - 8), animated: true });
  }, []);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", reveal);
    return () => shown.remove();
  }, [reveal]);

  const decline = () => onAnswer({ action: "decline" });
  const accept = () => {
    if (request.mode === "url") {
      if (!url) return;
      void Linking.openURL(url.href).catch(() => {});
      onAnswer({ action: "accept" });
      return;
    }
    const answer = elicitContent(fields, values);
    if ("error" in answer) {
      failure();
      setError(answer.error);
      return;
    }
    onAnswer({ action: "accept", content: answer.content });
  };
  const set = (key: string, value: ElicitValues[string]) => {
    setError(null);
    setValues((v) => ({ ...v, [key]: value }));
  };

  const server = mcpName(request.displayName ?? request.serverName);
  return (
    <AskFrame
      ref={scrollRef}
      head={
        <AskHead
          icon="powerplug"
          title={request.title ?? `${server} demande`}
          note="serveur MCP"
        />
      }
      footer={
        <View style={styles.row}>
          <AskButton
            grow
            tone="ghost"
            icon="xmark"
            label="Refuser"
            onPress={grace(decline)}
          />
          <AskButton
            grow
            tone="primary"
            icon={
              request.mode === "url"
                ? "arrow.up.right.square"
                : "paperplane.fill"
            }
            label={request.mode === "url" ? "Ouvrir la page" : "Envoyer"}
            disabled={request.mode === "url" && !url}
            onPress={grace(accept)}
          />
        </View>
      }
    >
      {request.message ? (
        <Text style={styles.message} selectable>
          {request.message}
        </Text>
      ) : null}
      {request.description ? (
        <Text style={styles.sub}>{request.description}</Text>
      ) : null}
      {request.mode === "url" ? (
        <View style={styles.url}>
          {url ? (
            <>
              <Text style={styles.host}>{url.host}</Text>
              <Text style={styles.href} numberOfLines={2} selectable>
                {url.href}
              </Text>
            </>
          ) : (
            <Text style={styles.href}>
              Adresse refusée : {request.url ?? "aucune"}
            </Text>
          )}
        </View>
      ) : (
        fields.map((f) => (
          <ElicitField
            key={f.key}
            field={f}
            value={values[f.key]}
            onChange={(v) => set(f.key, v)}
            onLayout={(e) => {
              tops.current[f.key] = e.nativeEvent.layout.y;
            }}
            onFocus={() => {
              focused.current = f.key;
              reveal();
            }}
            onSubmit={grace(accept)}
          />
        ))
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </AskFrame>
  );
}

const styles = StyleSheet.create({
  message: {
    color: C.ink,
    fontSize: T.body,
    lineHeight: 21,
    marginHorizontal: 2,
  },
  sub: { color: C.mute, fontSize: T.small, marginHorizontal: 2 },
  url: {
    gap: 2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    backgroundColor: C.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  host: { color: A.strong, fontSize: T.small + 1, fontWeight: "600" },
  href: { color: C.mute, fontSize: T.small - 1 },
  error: { color: A.error, fontSize: T.small, marginHorizontal: 2 },
  row: { flexDirection: "row", gap: 8 },
});
