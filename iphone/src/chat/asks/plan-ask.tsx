import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PermissionMode, PermissionResult } from "@/lib/chat/chatProtocol";
import type { PendingRequest } from "@/lib/chat/chatState";
import { AskButton } from "~/chat/asks/ask-button";
import { AskDictationLine } from "~/chat/asks/ask-dictation-line";
import { AskField } from "~/chat/asks/ask-field";
import { AskFrame } from "~/chat/asks/ask-frame";
import { AskHead } from "~/chat/asks/ask-head";
import { useAskDictation } from "~/chat/asks/use-ask-dictation";
import { useTapGrace } from "~/chat/asks/use-tap-grace";
import { C, T } from "~/chat/chat-theme";
import { MarkdownText } from "~/messages/markdown-text";

/**
 * ExitPlanMode (the desktop's `chat-plan-approval.tsx`): the plan itself, then
 * the terminal's choices: go on in auto mode, with edits accepted, approving
 * each edit, or keep planning with a remark. The desktop shows the plan in
 * its column; a phone shows it here, the buttons under it.
 */
export function PlanAsk({
  request,
  plan,
  onAnswer,
  onMode,
}: {
  request: PendingRequest;
  /** Its input's plan, else the last one written (`latestPlan`). */
  plan: string | null;
  onAnswer: (result: PermissionResult) => void;
  onMode: (mode: PermissionMode) => void;
}) {
  const [remark, setRemark] = useState("");
  const grace = useTapGrace();
  const dictation = useAskDictation();
  const approve = (mode?: PermissionMode) => {
    onAnswer({ behavior: "allow", updatedInput: request.input });
    // Approving leaves plan mode for the default one: switch after.
    if (mode) onMode(mode);
  };
  const keepPlanning = () =>
    onAnswer({
      behavior: "deny",
      message: remark.trim() || "The user wants to keep planning.",
    });
  return (
    <AskFrame
      head={<AskHead icon="list.clipboard" title="Claude propose ce plan" />}
      footer={
        <>
          <AskField
            value={remark}
            placeholder="Une remarque pour continuer le plan…"
            returnKeyType="send"
            onChangeText={setRemark}
            onSubmitEditing={grace(() => {
              if (remark.trim())
                onAnswer({ behavior: "deny", message: remark.trim() });
            })}
            mic={{
              dictation,
              id: "remark",
              onText: (text) =>
                setRemark((prev) =>
                  prev.trim() ? `${prev.trimEnd()} ${text}` : text,
                ),
            }}
          />
          <AskDictationLine dictation={dictation} />
          <View style={styles.row}>
            <AskButton
              grow
              tone="primary"
              icon="bolt.fill"
              label="Oui, en mode auto"
              onPress={grace(() => approve("auto"))}
            />
            <AskButton
              grow
              icon="checkmark"
              label="Oui, modifs acceptées"
              onPress={grace(() => approve("acceptEdits"))}
            />
          </View>
          <View style={styles.row}>
            <AskButton
              grow
              icon="checkmark"
              label="Oui, je valide chaque modif"
              onPress={grace(() => approve())}
            />
            <AskButton
              grow
              tone="ghost"
              icon="pencil"
              label="Non, continue le plan"
              onPress={grace(keepPlanning)}
            />
          </View>
        </>
      }
    >
      {plan ? (
        <MarkdownText markdown={plan} />
      ) : (
        <Text style={styles.sub}>
          Plan introuvable : regarde au-dessus dans la conversation.
        </Text>
      )}
    </AskFrame>
  );
}

const styles = StyleSheet.create({
  sub: { color: C.mute, fontSize: T.small, marginHorizontal: 2 },
  row: { flexDirection: "row", gap: 8 },
});
