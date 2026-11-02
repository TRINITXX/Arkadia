import { useEffect, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import { stepBy, type Question } from "@/lib/chat/chatQuestions";
import { A } from "~/chat/asks/ask-colors";
import { C, T } from "~/chat/chat-theme";
import { tick } from "~/ui/haptics";

/**
 * Several questions, one at a time as the terminal asks them (the desktop's
 * `.chat-ask-tabs`): a tab each, ticked once answered, then « Envoyer ». The
 * arrows stay at the ends; the tab shown scrolls into view.
 */
export function QuestionTabs({
  questions,
  answers,
  complete,
  step,
  onStep,
}: {
  questions: Question[];
  answers: string[];
  complete: boolean;
  step: number;
  onStep: (step: number) => void;
}) {
  const count = questions.length;
  // A tab or an arrow: another question shown, a pick of where to be.
  const go = (to: number) => {
    tick();
    onStep(to);
  };
  const scrollRef = useRef<ScrollViewInstance>(null);
  const spots = useRef<Record<number, number>>({});
  useEffect(() => {
    const x = spots.current[step];
    if (x !== undefined)
      scrollRef.current?.scrollTo({ x: Math.max(0, x - 40), animated: true });
  }, [step]);

  const tab = (i: number, label: string, done: boolean, icon: SFSymbol) => (
    <Pressable
      key={i}
      accessibilityRole="tab"
      accessibilityState={{ selected: step === i }}
      accessibilityLabel={i < count ? questions[i].question : label}
      onLayout={(e) => {
        spots.current[i] = e.nativeEvent.layout.x;
      }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={() => go(i)}
      style={[styles.tab, step === i && styles.on]}
    >
      <SymbolView name={icon} size={13} tintColor={done ? C.accent : C.mute} />
      <Text style={[styles.label, step === i && styles.labelOn]}>{label}</Text>
    </Pressable>
  );

  const arrow = (icon: SFSymbol, label: string, to: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={to === step}
      onPress={() => go(to)}
      style={({ pressed }) => [
        styles.arrow,
        (pressed || to === step) && styles.dim,
      ]}
    >
      <SymbolView name={icon} size={14} tintColor={C.mute} />
    </Pressable>
  );

  return (
    <View style={styles.bar}>
      {arrow("chevron.left", "Question précédente", stepBy(step, -1, count))}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.tabs}
        style={styles.scroll}
      >
        {questions.map((q, i) =>
          tab(
            i,
            q.header || `Question ${i + 1}`,
            !!answers[i],
            answers[i] ? "checkmark.square.fill" : "square",
          ),
        )}
        {tab(count, "Envoyer", complete, "checkmark")}
      </ScrollView>
      {arrow("chevron.right", "Question suivante", stepBy(step, 1, count))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    marginHorizontal: -4,
  },
  // As tall as the arrows: a tab takes taps on its full height (`hitSlop`).
  scroll: { flex: 1, alignSelf: "stretch" },
  tabs: { gap: 4, alignItems: "center" },
  tab: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "transparent",
  },
  on: { backgroundColor: A.picked, borderColor: A.askLine },
  label: { color: C.mute, fontSize: T.small },
  labelOn: { color: A.strong },
  arrow: {
    width: 32,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { opacity: 0.35 },
});
