import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import {
  formatCountdown,
  type Account,
  type UsageWindow,
} from "@/lib/accounts";
import type { RemoteAction } from "@/lib/remoteActions";
import { act, useRemoteView } from "~/remote/connection";

async function run(action: RemoteAction) {
  try {
    await act(action);
  } catch (e) {
    Alert.alert(
      "Action impossible",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/**
 * The Claude accounts, as a settings list (choice A of 25/10/2026): usage
 * over 5 hours and the week, the 5-hour reset, a tick on the account new tabs
 * open on (tap to change). Adding or removing one stays on the desktop.
 */
export function AccountsScreen() {
  const { snapshot } = useRemoteView();
  // The reset countdown moves by the minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const state = snapshot?.accounts ?? null;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      {!state ? (
        <Text style={styles.note}>
          {snapshot ? "Un seul compte Claude sur le PC." : "Chargement…"}
        </Text>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Nouveaux onglets sur</Text>
          <View style={styles.group}>
            {state.accounts.map((a, i) => (
              <AccountRow
                key={a.id}
                account={a}
                current={a.id === state.current}
                first={i === 0}
                now={now}
              />
            ))}
          </View>
          <Text style={styles.sectionTitle}>Limite atteinte</Text>
          <View style={styles.group}>
            <View style={styles.row}>
              <Text style={styles.label}>Changer seul de compte</Text>
              <Switch
                value={snapshot?.autoSwitch ?? false}
                onValueChange={(on) => void run({ kind: "autoSwitch", on })}
              />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function AccountRow({
  account,
  current,
  first,
  now,
}: {
  account: Account;
  current: boolean;
  first: boolean;
  now: number;
}) {
  const u = account.usage;
  const countdown = formatCountdown(u?.fiveHour?.resetsAt, now);
  return (
    <Pressable
      onPress={() =>
        !current && void run({ kind: "setAccount", accountId: account.id })
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {!first && <View style={styles.separator} />}
      <View style={[styles.dot, { backgroundColor: account.color }]} />
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>
          {account.label}
        </Text>
        <UsageBar
          name="5 h"
          window={u?.fiveHour}
          color={account.color}
          stale={account.stale}
          after={countdown ? `reprise dans ${countdown}` : null}
        />
        <UsageBar
          name="Sem."
          window={u?.sevenDay}
          color={account.color}
          stale={account.stale}
          after={null}
        />
      </View>
      {current && <SymbolView name="checkmark" size={17} tintColor="#0a84ff" />}
    </Pressable>
  );
}

function UsageBar({
  name,
  window,
  color,
  stale,
  after,
}: {
  name: string;
  window: UsageWindow | null | undefined;
  color: string;
  stale: boolean;
  after: string | null;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(window?.pct ?? 0)));
  const full = pct >= 100;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barName}>{name}</Text>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${pct}%`,
              backgroundColor: full ? "#ff453a" : color,
              opacity: stale ? 0.4 : 1,
            },
          ]}
        />
      </View>
      <Text style={styles.barValue}>
        {window ? (full && after ? after : `${pct} %`) : "–"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 },
  note: { color: "#8e8e93", fontSize: 15, textAlign: "center", padding: 20 },
  sectionTitle: {
    color: "#8e8e93",
    fontSize: 15,
    fontWeight: "600",
    paddingHorizontal: 32,
    paddingTop: 18,
    paddingBottom: 6,
  },
  group: {
    marginHorizontal: 16,
    borderRadius: 24,
    backgroundColor: "#1c1c1e",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 46,
  },
  pressed: { backgroundColor: "#2c2c2e" },
  separator: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#38383a",
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  body: { flex: 1, gap: 6 },
  label: { flex: 1, color: "#ffffff", fontSize: 16, fontWeight: "500" },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barName: { width: 34, color: "#8e8e93", fontSize: 11.5 },
  track: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 3 },
  barValue: {
    minWidth: 44,
    color: "#8e8e93",
    fontSize: 11.5,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
});
