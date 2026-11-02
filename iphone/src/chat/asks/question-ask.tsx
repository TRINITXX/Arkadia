import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { PermissionResult } from "@/lib/chat/chatProtocol";
import {
  answerOf,
  answersOf,
  questionsOf,
  stepAfterPick,
  stepBy,
} from "@/lib/chat/chatQuestions";
import type { PendingRequest } from "@/lib/chat/chatState";
import { A } from "~/chat/asks/ask-colors";
import { AskButton } from "~/chat/asks/ask-button";
import { AskDictationLine } from "~/chat/asks/ask-dictation-line";
import { AskField } from "~/chat/asks/ask-field";
import { AskFrame } from "~/chat/asks/ask-frame";
import { AskHead } from "~/chat/asks/ask-head";
import { QuestionOption } from "~/chat/asks/question-option";
import { QuestionTabs } from "~/chat/asks/question-tabs";
import { useAskDictation } from "~/chat/asks/use-ask-dictation";
import { useTapGrace } from "~/chat/asks/use-tap-grace";
import { C, T } from "~/chat/chat-theme";

/**
 * Claude's AskUserQuestion (the desktop's `chat-question-panel.tsx`): options
 * by a tap, or your own words (dictated too). Several questions come one at a
 * time behind tabs, then « Envoyer » sends them all, as the tool expects
 * them. The own-words field stays under the options, never under the
 * keyboard.
 */
export function QuestionAsk({
  request,
  onAnswer,
}: {
  request: PendingRequest;
  onAnswer: (result: PermissionResult) => void;
}) {
  const questions = useMemo(() => questionsOf(request.input), [request.input]);
  /** Also the « Envoyer » step's number. */
  const count = questions.length;
  const tabbed = count > 1;
  const [step, setStep] = useState(0);
  /** Per question: the options picked, and the own words. */
  const [draft, setDraft] = useState(() => ({
    picked: questions.map((): string[] => []),
    other: questions.map(() => ""),
  }));
  const { picked, other } = draft;
  const grace = useTapGrace();
  const dictation = useAskDictation();

  const answers = questions.map((_, i) => answerOf(picked[i], other[i]));
  const complete = answersOf(questions, answers);

  const submit = () => {
    if (!complete) return;
    onAnswer({
      behavior: "allow",
      updatedInput: { ...request.input, answers: complete },
    });
  };
  const dismiss = () =>
    onAnswer({
      behavior: "deny",
      message: "The user dismissed the question.",
    });

  const pick = (qi: number, label: string) => {
    const { multiSelect } = questions[qi];
    void Haptics.selectionAsync();
    setDraft((d) => ({
      other: d.other.map((t, i) => (i === qi ? "" : t)),
      picked: d.picked.map((sel, i) => {
        if (i !== qi) return sel;
        if (!multiSelect) return [label];
        return sel.includes(label)
          ? sel.filter((l) => l !== label)
          : [...sel, label];
      }),
    }));
    if (tabbed) setStep(stepAfterPick(qi, count, multiSelect));
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

  // Return sends a lone question; with tabs it goes on, and sends from the
  // last step.
  const enter = () => {
    if (!tabbed || step === count) submit();
    else if (answers[step]) setStep(stepBy(step, 1, count));
  };

  const q = step < count ? questions[step] : null;
  return (
    <AskFrame
      head={
        tabbed ? (
          <QuestionTabs
            questions={questions}
            answers={answers}
            complete={!!complete}
            step={step}
            onStep={setStep}
          />
        ) : null
      }
      footer={
        <>
          {q && (
            <AskField
              value={other[step]}
              placeholder="Autre réponse…"
              returnKeyType={tabbed ? "next" : "send"}
              onChangeText={(text) => write(step, () => text)}
              onSubmitEditing={grace(enter)}
              mic={{
                dictation,
                id: String(step),
                onText: (text) =>
                  write(step, (prev) =>
                    prev.trim() ? `${prev.trimEnd()} ${text}` : text,
                  ),
              }}
            />
          )}
          <AskDictationLine
            dictation={dictation}
            label={
              dictation.field !== null && dictation.field !== String(step)
                ? questions[Number(dictation.field)]?.header ||
                  `Question ${Number(dictation.field) + 1}`
                : undefined
            }
          />
          <View style={styles.row}>
            <AskButton
              grow
              tone="ghost"
              icon="xmark"
              label="Ignorer"
              onPress={grace(dismiss)}
            />
            {tabbed && q ? (
              <AskButton
                grow
                icon="arrow.right"
                label="Suivant"
                disabled={!answers[step]}
                onPress={() => setStep(stepBy(step, 1, count))}
              />
            ) : (
              <AskButton
                grow
                tone="primary"
                icon="paperplane.fill"
                label={tabbed ? "Envoyer" : "Répondre"}
                disabled={!complete}
                onPress={grace(submit)}
              />
            )}
          </View>
        </>
      }
    >
      {q ? (
        <View key={step} style={styles.question}>
          <AskHead icon="questionmark.circle" title={q.question} />
          {q.multiSelect && (
            <Text style={styles.sub}>Plusieurs choix possibles</Text>
          )}
          {q.options.map((option, oi) => (
            <QuestionOption
              key={`${oi}:${option.label}`}
              n={oi + 1}
              label={option.label}
              description={option.description}
              multi={!!q.multiSelect}
              picked={picked[step].includes(option.label)}
              onPress={() => pick(step, option.label)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.question}>
          <AskHead icon="checkmark" title="Vérifie tes réponses" />
          {questions.map((question, i) => (
            <Pressable
              key={`${i}:${question.question}`}
              accessibilityRole="button"
              onPress={() => setStep(i)}
              style={({ pressed }) => [
                styles.review,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.reviewQ}>{question.question}</Text>
              <Text
                style={[styles.reviewA, !answers[i] && styles.reviewMissing]}
              >
                → {answers[i] || "sans réponse"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </AskFrame>
  );
}

const styles = StyleSheet.create({
  question: { gap: 2 },
  sub: {
    color: C.mute,
    fontSize: T.small,
    marginHorizontal: 2,
    marginTop: -4,
    marginBottom: 6,
  },
  row: { flexDirection: "row", gap: 8 },
  review: {
    minHeight: 44,
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  pressed: { backgroundColor: "#25282c" },
  reviewQ: { color: C.dim, fontSize: T.small },
  reviewA: { color: C.ink, fontSize: T.body },
  reviewMissing: { color: A.error },
});
