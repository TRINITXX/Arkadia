import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import {
  enterLeadsTo,
  nextQuestionLeft,
  recoReason,
  roundReply,
  type RoundAnswer,
  type RoundQuestion,
} from "@/lib/chat/chatQuestionRound";
import { withRoundAnswer } from "@/lib/chat/phoneAsks";
import { A } from "~/chat/asks/ask-colors";
import { AskDictationLine } from "~/chat/asks/ask-dictation-line";
import { AskField } from "~/chat/asks/ask-field";
import { RoundOption } from "~/chat/asks/round-option";
import {
  dictateInto,
  updateRound,
  useRoundSheet,
} from "~/chat/asks/round-store";
import { useAskDictation } from "~/chat/asks/use-ask-dictation";
import { C, T } from "~/chat/chat-theme";
import { success, tap, tick } from "~/ui/haptics";

/**
 * Claude's round of ❓ questions written in his last reply (the desktop's
 * `chat-question-sheet.tsx`, the user's mockup A): one question at a time,
 * its place in a bar of segments (green once answered), its options with
 * Claude's reco and reason inside the one it names (a reco naming none is a
 * choice of its own), the mic left of a free field, the send on its right.
 * A pick moves on to a question left; Return goes on, and sends once all
 * are answered; the send answers them all, « Q1 : … » per line. Folds to
 * one line, closes (×: answered in the composer). Keyed by its round.
 */
export function RoundSheet({
  chatId,
  round,
  working,
  onSend,
  onStop,
}: {
  chatId: string;
  round: { id: string; questions: RoundQuestion[] };
  /** Claude works again under the sheet (it stays, 02/11/2026). */
  working: boolean;
  onSend: (text: string) => void;
  /** Unfolded, the sheet hides the composer and its stop: its own one. */
  onStop: () => void;
}) {
  const replyId = round.id;
  const sheet = useRoundSheet(chatId, replyId);
  const [view, setView] = useState({ step: 0 });
  const dictation = useAskDictation();
  if (sheet.closed) return null;

  const { questions } = round;
  const folded = sheet.folded;
  // Later replies may add questions to the round: never past its last.
  const step = Math.min(view.step, questions.length - 1);
  const q = questions[step];
  const a = sheet.answers[q.key] ?? {};
  const isAnswered = (x: RoundQuestion) => !!roundReply([x], sheet.answers);
  const answeredFlags = questions.map(isAnswered);
  const answered = answeredFlags.filter(Boolean).length;
  const reply = roundReply(questions, sheet.answers);

  const goTo = (i: number) => setView({ step: i });
  const set = (key: string, patch: RoundAnswer) =>
    updateRound(chatId, replyId, (s) => withRoundAnswer(s, key, patch));
  const setFolded = (on: boolean) => {
    tick();
    updateRound(chatId, replyId, (s) => ({ ...s, folded: on }));
  };
  // An option picked again lets it go: a pick too.
  const unpick = (patch: RoundAnswer) => {
    tick();
    set(q.key, patch);
  };
  // Picked: on to the next question left, after this one first.
  const pickAndGo = (patch: RoundAnswer) => {
    tick();
    set(q.key, patch);
    const next = nextQuestionLeft(answeredFlags, step);
    if (next !== null) goTo(next);
  };
  const close = () => {
    // Its fields take no more words: a dictation under way stops.
    if (dictation.phase !== "idle") dictation.drop();
    updateRound(chatId, replyId, (s) => ({ ...s, closed: true }));
  };
  const send = () => {
    if (!reply) return;
    success();
    onSend(reply);
    close();
  };
  // Return: on to the next question left, sent once all are answered.
  const leadsTo = enterLeadsTo(answeredFlags, step);

  // An option it names carries its reason; else the recommendation is a
  // choice of its own.
  const named = q.options.find((o) => o.key === q.recommendedKey);
  const why =
    named && q.recommendation ? recoReason(q.recommendation, named) : "";
  const ownReco = !named && q.recommendation ? q.recommendation : null;
  const listened = questions.find((x) => x.key === dictation.field);

  const iconButton = (icon: SFSymbol, label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      <SymbolView name={icon} size={15} tintColor={C.mute} />
    </Pressable>
  );

  return (
    <View style={styles.sheet}>
      <View style={[styles.head, !folded && styles.headLine]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={folded ? "Déplier" : "Replier"}
          onPress={() => setFolded(!folded)}
          style={[styles.fold, folded && styles.foldWide]}
        >
          <SymbolView
            name="questionmark.circle"
            size={16}
            tintColor={C.accent}
          />
          {folded && (
            <Text style={styles.foldText} numberOfLines={1}>
              <Text style={styles.foldTitle}>Questions de Claude</Text> ·{" "}
              {answered} sur {questions.length} répondue
              {answered > 1 ? "s" : ""}
            </Text>
          )}
        </Pressable>
        {!folded && (
          <View style={styles.steps} accessibilityRole="tablist">
            {questions.map((x, i) => (
              <Pressable
                key={x.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: i === step }}
                accessibilityLabel={`${x.id} : ${x.title}${answeredFlags[i] ? " (répondue)" : ""}`}
                onPress={() => {
                  tick();
                  goTo(i);
                }}
                style={styles.seg}
              >
                <View
                  style={[
                    styles.bar,
                    answeredFlags[i] && styles.barDone,
                    i === step && styles.barOn,
                  ]}
                />
                {dictation.field === x.key && <View style={styles.recDot} />}
              </Pressable>
            ))}
          </View>
        )}
        {!folded && (
          <Text style={styles.pos}>
            {step + 1} sur {questions.length}
          </Text>
        )}
        {working &&
          !folded &&
          iconButton("stop.fill", "Arrêter Claude", () => {
            tap();
            onStop();
          })}
        {iconButton(
          folded ? "chevron.right" : "chevron.down",
          folded ? "Déplier" : "Replier",
          () => setFolded(!folded),
        )}
        {iconButton("xmark", "Fermer (répondre dans la saisie)", () => {
          tap();
          close();
        })}
      </View>
      {!folded && (
        <>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyPad}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>{q.title}</Text>
            {/* Always whole, never cut: a line hidden is a line missed
                (the user's ask of 07/11/2026). Claude writes it after
                « Titre : », in lower case. */}
            {q.body ? (
              <Text style={styles.text}>
                {q.body.charAt(0).toUpperCase() + q.body.slice(1)}
              </Text>
            ) : null}
            {q.options.map((o) => {
              const on = a.option === o.key;
              const rec = q.recommendedKey === o.key;
              return (
                <RoundOption
                  key={o.key}
                  letter={o.key}
                  label={o.label}
                  reco={rec}
                  reason={rec ? why : undefined}
                  on={on}
                  onPress={() =>
                    on
                      ? unpick({ option: undefined })
                      : pickAndGo({ option: o.key, reco: false })
                  }
                />
              );
            })}
            {ownReco && (
              <RoundOption
                label={ownReco}
                reco
                on={!!a.reco}
                onPress={() =>
                  a.reco
                    ? unpick({ reco: false })
                    : pickAndGo({ reco: true, option: undefined })
                }
              />
            )}
          </ScrollView>
          <View style={styles.free}>
            <AskField
              multiline
              value={a.text ?? ""}
              accessibilityLabel={`Ta réponse à ${q.id}`}
              onChangeText={(text) => set(q.key, { text })}
              returnKeyType={
                leadsTo === "send" ? "send" : leadsTo !== null ? "next" : "done"
              }
              submitBehavior={leadsTo === null ? "blurAndSubmit" : "submit"}
              onSubmitEditing={() => {
                if (leadsTo === "send") send();
                else if (leadsTo !== null) goTo(leadsTo);
              }}
              mic={{
                dictation,
                id: q.key,
                onText: (text) => dictateInto(chatId, replyId, q.key, text),
              }}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Envoyer les réponses"
                  accessibilityHint={
                    reply
                      ? `Envoyer ${answered} réponse${answered > 1 ? "s" : ""} sur ${questions.length}`
                      : "Choisis ou écris au moins une réponse"
                  }
                  disabled={!reply}
                  hitSlop={4}
                  onPress={send}
                  style={({ pressed }) => [
                    styles.send,
                    (!reply || pressed) && styles.sendDim,
                  ]}
                >
                  <SymbolView
                    name="paperplane.fill"
                    size={15}
                    tintColor={C.accentInk}
                  />
                </Pressable>
              }
            />
          </View>
        </>
      )}
      {/* Folded, or another question shown: the words still come, named. */}
      {(dictation.phase !== "idle" || dictation.error) && (
        <View style={styles.dictation}>
          <AskDictationLine
            dictation={dictation}
            label={
              listened && (folded || listened.key !== q.key)
                ? listened.id
                : undefined
            }
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flexShrink: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 4,
    paddingRight: 2,
  },
  headLine: { borderBottomWidth: 1, borderBottomColor: C.line },
  fold: {
    height: 44,
    minWidth: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 6,
  },
  foldWide: { flex: 1 },
  foldText: { flex: 1, color: C.mute, fontSize: T.small - 1 },
  foldTitle: { color: A.strong, fontSize: T.small + 1, fontWeight: "600" },
  steps: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  seg: {
    flex: 1,
    maxWidth: 36,
    height: 44,
    justifyContent: "center",
  },
  bar: { height: 4, borderRadius: 2, backgroundColor: A.seg },
  barDone: { backgroundColor: A.segDone },
  barOn: { backgroundColor: C.accent },
  recDot: {
    position: "absolute",
    top: 12,
    right: 0,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: A.recording,
  },
  pos: { color: C.mute, fontSize: T.small - 1 },
  icon: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  pressed: { backgroundColor: A.button },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyPad: { gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  title: { color: A.strong, fontSize: T.body, fontWeight: "600" },
  text: { color: C.dim, fontSize: T.small + 0.5, lineHeight: 19 },
  free: {
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 12,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.accent,
  },
  sendDim: { opacity: 0.4 },
  dictation: { flexShrink: 0, paddingHorizontal: 4, paddingBottom: 10 },
});
