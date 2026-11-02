import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type {
  ElicitationAnswer,
  PermissionResult,
} from "@/lib/chat/chatProtocol";
import { latestPlan, type ChatState } from "@/lib/chat/chatState";
import { A } from "~/chat/asks/ask-colors";
import { ElicitationAsk } from "~/chat/asks/elicitation-ask";
import { PermissionAsk } from "~/chat/asks/permission-ask";
import { PlanAsk } from "~/chat/asks/plan-ask";
import { QuestionAsk } from "~/chat/asks/question-ask";
import { RoundSheet } from "~/chat/asks/round-sheet";
import { useRoundSheet } from "~/chat/asks/round-store";
import { phoneAsk } from "@/lib/chat/phoneAsks";
import { useAsksMaxHeight } from "~/chat/asks/use-asks-max-height";
import { useSentHold } from "~/chat/asks/use-sent-hold";
import { C } from "~/chat/chat-theme";
import type { ChatActions } from "~/chat/use-chat";
import { tap } from "~/ui/haptics";

export interface ChatAsksProps {
  chatId: string;
  state: ChatState;
  actions: ChatActions;
  /**
   * Which of them this place shows: the ❓ round above the docked pills and
   * workflow card, a request under them, in the input's place, as the
   * desktop's column stacks them (`chat-view.tsx`).
   */
  part: "round" | "request";
}

/**
 * What waits for the user's answer, above the composer: a permission, a
 * question (AskUserQuestion), a plan to approve, an MCP server's request, or
 * Claude's ❓ round in text, one at a time in the desktop's order
 * (`phoneAsk`). Up to 60 % of the screen, scrolling inside past it. Null
 * when nothing waits (the round's sheet closed included).
 *
 * The screen hides its composer while a request or an elicitation shows,
 * and under the round's unfolded sheet (`useRoundShown`), as the desktop's
 * input card does. Short of room (pills and workflow card under it, the
 * keyboard up), the sheet or the card alone shrinks and scrolls inside, as
 * the desktop's sheet does (`sheet-open`).
 */
export function ChatAsks({ chatId, state, actions, part }: ChatAsksProps) {
  const { closed, requests, sdk, working, items, restRound } = state;
  const ask = useMemo(
    () => phoneAsk({ closed, requests, sdk, working, items, restRound }),
    [closed, requests, sdk, working, items, restRound],
  );
  const maxHeight = useAsksMaxHeight();
  const round = useRoundSheet(
    chatId,
    ask?.kind === "round" ? ask.round.id : "",
  );
  const { sent, hold } = useSentHold();
  const plan = useMemo(() => {
    if (ask?.kind !== "plan") return null;
    const own = ask.request.input.plan;
    return typeof own === "string" && own.trim() ? own : latestPlan(items);
  }, [ask, items]);

  if (!ask || (ask.kind === "round") !== (part === "round")) return null;
  if (ask.kind === "round" && round.closed) return null;

  if (ask.kind === "round")
    return (
      <View style={[styles.sheet, { maxHeight }]}>
        <RoundSheet
          key={ask.round.id}
          chatId={chatId}
          round={ask.round}
          working={state.working}
          onSend={(text) => void actions.send(text)}
          onStop={() => void actions.interrupt()}
        />
      </View>
    );

  const id = ask.request.requestId;
  // Every answer of a panel comes here, its tap grace passed: one tap each.
  const answer = (result: PermissionResult) => {
    tap();
    hold(id);
    void actions.answer(id, result);
  };
  const elicitAnswer = (result: ElicitationAnswer) => {
    tap();
    hold(id);
    void actions.elicitAnswer(id, result);
  };
  let panel: ReactNode;
  if (ask.kind === "question")
    panel = <QuestionAsk key={id} request={ask.request} onAnswer={answer} />;
  else if (ask.kind === "plan")
    panel = (
      <PlanAsk
        key={id}
        request={ask.request}
        plan={plan}
        onAnswer={answer}
        onMode={(mode) => void actions.setMode(mode)}
      />
    );
  else if (ask.kind === "permission")
    panel = (
      <PermissionAsk
        key={id}
        request={ask.request}
        subagents={state.subagents}
        onAnswer={answer}
      />
    );
  else
    panel = (
      <ElicitationAsk key={id} request={ask.request} onAnswer={elicitAnswer} />
    );
  return (
    <View style={[styles.card, { maxHeight }, sent === id && styles.sent]}>
      {panel}
    </View>
  );
}

const styles = StyleSheet.create({
  /** `.chat-box.ask`: the input card, brown-edged while it waits. */
  card: {
    flexShrink: 1,
    marginHorizontal: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: A.askLine,
    backgroundColor: C.raised,
  },
  /** `.chat-sheet-q`. */
  sheet: {
    flexShrink: 1,
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: A.askLine,
    backgroundColor: A.sheet,
    overflow: "hidden",
  },
  /** Answered, on its way to the PC: no second answer. */
  sent: { opacity: 0.5, pointerEvents: "none" },
});
