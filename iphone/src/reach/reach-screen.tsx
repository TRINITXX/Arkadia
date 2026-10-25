import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { isLate, type WakeProgress } from "@/mobile/wake";
import { reconnectNow } from "~/remote/connection";
import { hasRelay, openArkadia, wakePc, type Reach } from "~/remote/reach";

type StepState = "done" | "now" | "fail" | "todo";

/**
 * The PC cannot be reached: off (with a button to wake it), offline, or
 * Arkadia closed (with a button to start it). A wake asked from here shows
 * its steps in a list (choice A of 25/10/2026), and the screen moves on by
 * itself if the PC comes up after all.
 */
export function ReachScreen({
  reach,
  wake,
}: {
  reach: Reach;
  wake: WakeProgress | null;
}) {
  if (wake) return <WakeSteps wake={wake} reach={reach} />;
  if (reach === "off")
    return (
      <Panel
        icon="desktopcomputer"
        title="PC éteint"
        text="Le PC ne répond pas sur le réseau."
        action={
          hasRelay()
            ? {
                label: "Allumer le PC",
                onPress: () => void wakePc(reconnectNow),
              }
            : null
        }
      />
    );
  if (reach === "closed")
    return (
      <Panel
        icon="macwindow"
        title="Arkadia est fermé"
        text="Le PC est allumé."
        action={{ label: "Ouvrir Arkadia", onPress: () => void openArkadia() }}
      />
    );
  if (reach === "starting")
    return <Panel icon="macwindow" title="Ouverture d’Arkadia…" spinner />;
  return (
    <Panel
      icon="wifi.slash"
      title="PC hors ligne"
      text="Le PC est éteint, en veille, ou Tailscale est coupé sur cet iPhone."
      action={{ label: "Réessayer", onPress: reconnectNow, plain: true }}
    />
  );
}

function Panel({
  icon,
  title,
  text,
  action,
  spinner,
}: {
  icon: SFSymbol;
  title: string;
  text?: string;
  action?: { label: string; onPress: () => void; plain?: boolean } | null;
  spinner?: boolean;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.icon}>
        <SymbolView name={icon} size={42} tintColor="#8e8e93" />
      </View>
      <Text style={styles.title}>{title}</Text>
      {text && <Text style={styles.text}>{text}</Text>}
      {spinner && <ActivityIndicator color="#8e8e93" style={styles.gap} />}
      {action && (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.button,
            action.plain && styles.plainButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.buttonText, action.plain && styles.plainText]}>
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Steps of a wake: the order, the PC back on the network, Windows ready. */
function WakeSteps({ wake, reach }: { wake: WakeProgress; reach: Reach }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const late = isLate(wake, now);
  const up = wake.done === 3;
  const stateOf = (step: number): StepState =>
    step < wake.done
      ? "done"
      : step > wake.done
        ? "todo"
        : late
          ? "fail"
          : "now";
  const labels = [
    "Ordre envoyé",
    wake.done >= 2 ? "PC allumé" : "Le PC démarre",
    "Windows prêt",
  ];
  const failLabel = wake.failed ? "L’ordre n’est pas parti" : "Rien après 30 s";
  const seconds = Math.max(0, Math.floor((now - wake.since) / 1000));

  return (
    <View style={styles.screen}>
      <View style={styles.icon}>
        <SymbolView name="desktopcomputer" size={42} tintColor="#8e8e93" />
      </View>
      <Text style={styles.title}>
        {up ? "PC allumé" : late ? "Le PC ne répond pas" : "Allumage du PC"}
      </Text>
      <View style={styles.group}>
        {labels.map((label, step) => {
          const state = stateOf(step);
          // Once late, what would come after the stuck step is not shown.
          if (late && state === "todo") return null;
          return (
            <View key={step} style={styles.stepRow}>
              {step > 0 && <View style={styles.separator} />}
              <StepMark state={state} />
              <Text
                style={[
                  styles.stepText,
                  state === "todo" && styles.muted,
                  state === "fail" && styles.failText,
                ]}
              >
                {state === "fail" ? failLabel : label}
              </Text>
              {state === "now" && step > 0 && (
                <Text style={styles.seconds}>{seconds} s</Text>
              )}
            </View>
          );
        })}
      </View>
      {late && (
        <>
          <Text style={styles.foot}>
            Si le PC s’allume quand même, cet écran changera tout seul.
          </Text>
          <Pressable
            onPress={() => void wakePc(reconnectNow)}
            style={({ pressed }) => [
              styles.button,
              styles.plainButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.buttonText, styles.plainText]}>Réessayer</Text>
          </Pressable>
        </>
      )}
      {up &&
        (reach === "closed" ? (
          <Pressable
            onPress={() => void openArkadia()}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>Ouvrir Arkadia</Text>
          </Pressable>
        ) : (
          <Text style={styles.foot}>Connexion à Arkadia…</Text>
        ))}
    </View>
  );
}

function StepMark({ state }: { state: StepState }) {
  if (state === "done")
    return (
      <View style={[styles.mark, styles.markDone]}>
        <SymbolView name="checkmark" size={13} tintColor="#000000" />
      </View>
    );
  if (state === "fail")
    return (
      <View style={[styles.mark, styles.markFail]}>
        <SymbolView name="xmark" size={12} tintColor="#ffd6d6" />
      </View>
    );
  if (state === "now") return <ActivityIndicator color="#ffffff" />;
  return <View style={[styles.mark, styles.markTodo]} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "#000000",
  },
  icon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#1c1c1e",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "#ffffff", fontSize: 28, fontWeight: "700", marginTop: 18 },
  text: {
    color: "#8e8e93",
    fontSize: 15,
    marginTop: 6,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  gap: { marginTop: 20 },
  button: {
    marginTop: 28,
    height: 50,
    paddingHorizontal: 28,
    borderRadius: 25,
    backgroundColor: "#0a84ff",
    alignItems: "center",
    justifyContent: "center",
  },
  plainButton: { backgroundColor: "#2c2c2e" },
  pressed: { opacity: 0.7 },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  plainText: { fontWeight: "500" },
  group: {
    alignSelf: "stretch",
    marginTop: 28,
    borderRadius: 24,
    backgroundColor: "#1c1c1e",
    overflow: "hidden",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  separator: {
    position: "absolute",
    top: 0,
    left: 52,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#38383a",
  },
  stepText: { flex: 1, color: "#ffffff", fontSize: 17 },
  muted: { color: "#8e8e93" },
  failText: { color: "#ff6961" },
  seconds: { color: "#8e8e93", fontSize: 15, fontVariant: ["tabular-nums"] },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  markDone: { backgroundColor: "#30d158" },
  markFail: { backgroundColor: "#7f1d1d" },
  markTodo: { borderWidth: 1.5, borderColor: "rgba(235,235,245,0.3)" },
  foot: {
    color: "#8e8e93",
    fontSize: 13,
    marginTop: 12,
    textAlign: "center",
  },
});
