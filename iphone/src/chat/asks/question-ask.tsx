import { useMemo, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import type { PermissionResult } from "@/lib/chat/chatProtocol";
import { enterLeadsTo, nextQuestionLeft } from "@/lib/chat/chatQuestionRound";
import {
  answerOf,
  answersOf,
  questionsOf,
  recoOf,
} from "@/lib/chat/chatQuestions";
import type { PendingRequest } from "@/lib/chat/chatState";
import { AskDictationLine } from "~/chat/asks/ask-dictation-line";
import { AskField } from "~/chat/asks/ask-field";
import { RoundOption } from "~/chat/asks/round-option";
// The ❓ sheet's look, the same.
import { sheetStyles as styles } from "~/chat/asks/round-sheet";
import { useAskDictation } from "~/chat/asks/use-ask-dictation";
import { useTapGrace } from "~/chat/asks/use-tap-grace";
import { C } from "~/chat/chat-theme";
import { tap, tick } from "~/ui/haptics";

/**
 * Claude's AskUserQuestion in the look of the ❓ sheet (`RoundSheet`), as on
 * the desktop (`chat-question-panel.tsx`, the user's pick of 15/11/2026): a
 * segment per question on top, its options as a), b)… with a radio (a square
 * box where several can be picked), the mic left of your own words and the
 * button that goes on to a question left, or sends once all are answered,
 * as the tool expects them. × dismisses the question. Folds to one line.
 */
export function QuestionAsk({
  request,
  onAnswer,
}: {
  request: PendingRequest;
  onAnswer: (result: PermissionResult) => void;
}) {
  const questions = useMemo(() => questionsOf(request.input), [request.input]);
  const count = questions.length;
  const [step, setStep] = useState(0);
  const [folded, setFolded] = useState(false);
  /** Per question: the options picked, and the own words. */
  const [draft, setDraft] = useState(() => ({
    picked: questions.map((): string[] => []),
    other: questions.map(() => ""),
  }));
  const { picked, other } = draft;
  const grace = useTapGrace();
  const dictation = useAskDictation();

  const answers = questions.map((_, i) => answerOf(picked[i], other[i]));
  const answered = answers.map(Boolean);
  const done = answered.filter(Boolean).length;
  const complete = answersOf(questions, answers);

  const submit = () => {
    if (!complete) return;
    // Sent, the panel dims and takes no touch while the PC answers: its
    // keyboard and its mic go too, else Return or the mic would still act.
    Keyboard.dismiss();
    if (dictation.phase !== "idle") dictation.drop();
    onAnswer({
      behavior: "allow",
      updatedInput: { ...request.input, answers: complete },
    });
  };
  const dismiss = () => {
    // Its field takes no more words: a dictation under way stops.
    if (dictation.phase !== "idle") dictation.drop();
    onAnswer({
      behavior: "deny",
      message: "The user dismissed the question.",
    });
  };
  const goTo = (i: number) => setStep(i);
  const fold = (on: boolean) => {
    tick();
    setFolded(on);
  };

  // A single choice picked goes on to the next question left, as in the
  // sheet; picked again, it unpicks. A multiple choice stays for more picks.
  const pick = (qi: number, label: string) => {
    const { multiSelect } = questions[qi];
    const was = picked[qi].includes(label);
    tick();
    setDraft((d) => ({
      other: d.other.map((t, i) => (i === qi ? "" : t)),
      picked: d.picked.map((sel, i) => {
        if (i !== qi) return sel;
        if (!multiSelect) return was ? [] : [label];
        return was ? sel.filter((l) => l !== label) : [...sel, label];
      }),
    }));
    if (multiSelect || was) return;
    const next = nextQuestionLeft(answered, qi);
    if (next !== null) goTo(next);
  };

  /** Own words for question `qi` drop its picks: they win anyway (`answerOf`). */
  const write = (qi: number, text: (prev: string) => string) =>
    setDraft((d) => {
      const typed = text(d.other[qi]);
      return {
        other: d.other.map((t, i) => (i === qi ? typed : t)),
        picked: d.picked.map((sel, i) => (i === qi && typed ? [] : sel)),
      };
    });

  // Return: on to the next question left, sent once all are answered.
  const leadsTo = enterLeadsTo(answered, step);
  // The button at the field's end: on to a question left; with every one
  // answered, it sends (the tool needs one answer per question).
  const left = nextQuestionLeft(answered, step);
  const listened = dictation.field !== null ? Number(dictation.field) : null;

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

  // No question to read (an input the tool should never send): the header
  // alone, its × still dismisses it, else Claude would wait for good.
  const q = step < count ? questions[step] : null;
  return (
    <View style={styles.sheet}>
      <View style={[styles.head, !folded && q && styles.headLine]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={folded ? "Déplier" : "Replier"}
          onPress={() => fold(!folded)}
          style={[styles.fold, folded && styles.foldWide]}
        >
          <SymbolView
            name="questionmark.circle"
            size={16}
            tintColor={C.accent}
          />
          {folded && (
            <Text style={styles.foldText} numberOfLines={1}>
              <Text style={styles.foldTitle}>Questions de Claude</Text> · {done}{" "}
              sur {count} répondue{done > 1 ? "s" : ""}
            </Text>
          )}
        </Pressable>
        {!folded && (
          <View style={styles.steps} accessibilityRole="tablist">
            {questions.map((x, i) => (
              <Pressable
                key={`${i}:${x.question}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: i === step }}
                accessibilityLabel={`${x.header ? `${x.header} : ` : ""}${x.question}${answered[i] ? " (répondue)" : ""}`}
                onPress={() => {
                  tick();
                  goTo(i);
                }}
                style={styles.seg}
              >
                <View
                  style={[
                    styles.bar,
                    answered[i] && styles.barDone,
                    i === step && styles.barOn,
                  ]}
                />
                {listened === i && <View style={styles.recDot} />}
              </Pressable>
            ))}
          </View>
        )}
        {!folded && q && (
          <Text style={styles.pos}>
            {step + 1} sur {count}
          </Text>
        )}
        {iconButton(
          folded ? "chevron.right" : "chevron.down",
          folded ? "Déplier" : "Replier",
          () => fold(!folded),
        )}
        {iconButton("xmark", "Ignorer la question", grace(dismiss))}
      </View>
      {!folded && q && (
        <>
          <ScrollView
            // Another question starts at its top: its title never hidden.
            key={step}
            style={styles.body}
            contentContainerStyle={styles.bodyPad}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>{q.question}</Text>
            {q.multiSelect && (
              <Text style={styles.text}>Plusieurs choix possibles</Text>
            )}
            {q.options.map((option, oi) => {
              const { text, reco } = recoOf(option.label);
              return (
                <RoundOption
                  key={`${step}:${oi}:${option.label}`}
                  letter={String.fromCharCode(97 + oi)}
                  label={text}
                  reco={reco}
                  description={option.description}
                  multi={!!q.multiSelect}
                  on={picked[step].includes(option.label)}
                  onPress={() => pick(step, option.label)}
                />
              );
            })}
          </ScrollView>
          <View style={styles.free}>
            <AskField
              multiline
              value={other[step]}
              accessibilityLabel={`Ta réponse à ${q.header || `la question ${step + 1}`}`}
              onChangeText={(text) => write(step, () => text)}
              returnKeyType={
                leadsTo === "send" ? "send" : leadsTo !== null ? "next" : "done"
              }
              submitBehavior={leadsTo === null ? "blurAndSubmit" : "submit"}
              onSubmitEditing={grace(() => {
                if (leadsTo === "send") submit();
                else if (leadsTo !== null) goTo(leadsTo);
              })}
              mic={{
                dictation,
                id: String(step),
                onText: (text) =>
                  write(step, (prev) =>
                    prev.trim() ? `${prev.trimEnd()} ${text}` : text,
                  ),
              }}
              trailing={
                !complete && left !== null ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Question suivante"
                    hitSlop={4}
                    onPress={() => {
                      tap();
                      goTo(left);
                    }}
                    style={({ pressed }) => [
                      styles.send,
                      pressed && styles.sendDim,
                    ]}
                  >
                    <SymbolView
                      name="arrow.right"
                      size={15}
                      tintColor={C.accentInk}
                    />
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Envoyer les réponses"
                    accessibilityHint={
                      complete ? undefined : "Choisis ou écris une réponse"
                    }
                    disabled={!complete}
                    hitSlop={4}
                    onPress={grace(submit)}
                    style={({ pressed }) => [
                      styles.send,
                      (!complete || pressed) && styles.sendDim,
                    ]}
                  >
                    <SymbolView
                      name="paperplane.fill"
                      size={15}
                      tintColor={C.accentInk}
                    />
                  </Pressable>
                )
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
              listened !== null && (folded || listened !== step)
                ? questions[listened]?.header || `Question ${listened + 1}`
                : undefined
            }
          />
        </View>
      )}
    </View>
  );
}
