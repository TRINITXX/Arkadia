import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { ChatState } from "@/lib/chat/chatState";
import { statusFigures } from "@/lib/chat/chatStatus";
import { C, T } from "~/chat/chat-theme";
import { ContextSheet } from "~/chat/status/context-sheet";
import { LimitsSheet } from "~/chat/status/limits-sheet";
import { UsageRing } from "~/chat/status/usage-ring";
import { useChatShown } from "~/chat/use-chat-shown";
import { tap } from "~/ui/haptics";

/** The countdown moves by the minute: a look every 30 s keeps it current. */
const TICK_MS = 30_000;

/**
 * The desktop's status line (`chat-status-bar.tsx`) in the input's bottom
 * row, after the model, effort and mode (mockup A « Anneaux dans la barre
 * du bas » of 02/11/2026): context, the 5 h session and the week as rings
 * that fill, amber from 80 %, and the session's reset. A tap on the context
 * ring opens what fills it, on the session or week ring their figures and
 * resets. « N MCP en échec » is its own chip (`McpChip`), first in the row.
 */
export function StatusChips({
  chatId,
  state,
}: {
  chatId: string;
  state: Pick<ChatState, "context" | "limits" | "asleep" | "closed">;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<"context" | "limits" | null>(null);
  const fiveReset = state.limits.fiveHour?.resetsAt;
  const sevenReset = state.limits.sevenDay?.resetsAt;
  // Out of sight (the app away, a screen over this one): no countdown to
  // keep; right again on return.
  const shown = useChatShown(chatId);
  useEffect(() => {
    if (!shown) return;
    if (fiveReset === undefined && sevenReset === undefined) return;
    // The clock stood still while no reset was known.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [fiveReset, sevenReset, shown]);

  const { context, fiveHour, sevenDay, reset, resetFull } = statusFigures(
    state,
    now,
  );
  const show = (sheet: "context" | "limits") => () => {
    tap();
    setOpen(sheet);
  };
  const close = () => setOpen(null);
  return (
    <>
      {(context || fiveHour || sevenDay) && (
        <View style={styles.rings}>
          {context && (
            <Pressable
              onPress={show("context")}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Contexte utilisé : ${Math.round(context.percent)} %`}
            >
              <UsageRing percent={context.percent} hot={context.hot} />
            </Pressable>
          )}
          {fiveHour && (
            <Pressable
              onPress={show("limits")}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Session de 5 h utilisée : ${Math.round(fiveHour.percent)} %`}
            >
              <UsageRing percent={fiveHour.percent} hot={fiveHour.hot} />
            </Pressable>
          )}
          {sevenDay && (
            <Pressable
              onPress={show("limits")}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Semaine utilisée : ${Math.round(sevenDay.percent)} %`}
            >
              <UsageRing percent={sevenDay.percent} hot={sevenDay.hot} />
            </Pressable>
          )}
          {reset && (
            <Pressable
              style={styles.reset}
              onPress={show("limits")}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Reset de la session dans ${resetFull}`}
            >
              <SymbolView name="timer" size={11} tintColor={C.mute} />
              <Text style={styles.resetText}>{reset}</Text>
            </Pressable>
          )}
        </View>
      )}
      {context && (
        <ContextSheet
          chatId={chatId}
          visible={open === "context"}
          ring={context}
          asleep={state.asleep}
          closed={state.closed !== null}
          onClose={close}
        />
      )}
      <LimitsSheet
        visible={open === "limits"}
        fiveHour={fiveHour}
        sevenDay={sevenDay}
        now={now}
        onClose={close}
      />
    </>
  );
}

const styles = StyleSheet.create({
  rings: { flexDirection: "row", alignItems: "center", gap: 5 },
  reset: { flexDirection: "row", alignItems: "center", gap: 3 },
  resetText: {
    color: C.dim,
    fontSize: T.tiny,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});
