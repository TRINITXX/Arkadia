import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  baseName,
  filterByMeta,
  formatWhen,
  groupByRecency,
  mergeSearchResults,
  type ClaudeSession,
  type ListedSession,
  type SessionMatch,
} from "@/lib/sessionsIndex";
import {
  act,
  listSessions,
  searchSessions,
  useRemoteView,
} from "~/remote/connection";

/** Rows drawn at once: the full history runs into the thousands. */
const MAX_ROWS = 200;
/** Typing pause before searching inside the conversations (a full scan). */
const SEARCH_DELAY_MS = 400;

/**
 * Past Claude sessions, newest first, grouped by day (choice A of
 * 25/10/2026), searchable by title, folder and content like the web page.
 * Tapping one resumes it in a new tab of its project.
 */
export function SessionsScreen() {
  const { status } = useRemoteView();
  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SessionMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  // Recency buckets and times are relative to when the list was loaded.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "open") return;
    let live = true;
    listSessions()
      .then((list) => {
        if (!live) return;
        setSessions(list);
        setNow(Date.now());
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [status]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchSessions(q)
        .then((found) => live && setMatches(found))
        .catch(() => {})
        .finally(() => live && setSearching(false));
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const groups = useMemo(() => {
    if (!sessions) return [];
    const listed: ListedSession[] = query.trim()
      ? mergeSearchResults(sessions, filterByMeta(sessions, query), matches)
      : sessions;
    return groupByRecency(listed.slice(0, MAX_ROWS), now).filter(
      (g) => g.sessions.length > 0,
    );
  }, [sessions, query, matches, now]);

  const resume = async (session: ClaudeSession) => {
    setResuming(session.id);
    try {
      const { tabId } = await act({ kind: "resume", session });
      if (tabId) router.push({ pathname: "/tab/[id]", params: { id: tabId } });
    } catch (e) {
      Alert.alert(
        "Reprise impossible",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setResuming(null);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: "Chercher dans les conversations",
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            hideWhenScrolling: false,
          },
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
      >
        {!sessions && (
          <Text style={styles.note}>
            {failed ? "Liste indisponible." : "Chargement…"}
          </Text>
        )}
        {searching && (
          <Text style={styles.note}>Recherche dans les conversations…</Text>
        )}
        {sessions && groups.length === 0 && !searching && (
          <Text style={styles.note}>Aucune session.</Text>
        )}
        {groups.map((g) => (
          <View key={g.label} style={styles.section}>
            <Text style={styles.sectionTitle}>{g.label}</Text>
            <View style={styles.group}>
              {g.sessions.map((s, i) => (
                <Pressable
                  key={s.id}
                  disabled={resuming !== null}
                  onPress={() => void resume(s)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  {i > 0 && <View style={styles.separator} />}
                  <View style={styles.rowText}>
                    <Text
                      style={[styles.title, s.from_prompt && styles.italic]}
                      numberOfLines={2}
                    >
                      {s.title}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {baseName(s.cwd)} · {formatWhen(s.mtime, now)}
                      {s.count ? ` · ${s.count}×` : ""}
                    </Text>
                    {s.excerpt ? (
                      <Text style={styles.excerpt} numberOfLines={2}>
                        {s.excerpt}
                      </Text>
                    ) : null}
                  </View>
                  {resuming === s.id ? (
                    <ActivityIndicator color="#8e8e93" />
                  ) : (
                    <SymbolView
                      name="chevron.right"
                      size={13}
                      tintColor="#5a5a5e"
                    />
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 },
  note: { color: "#8e8e93", fontSize: 15, textAlign: "center", padding: 20 },
  section: { paddingTop: 14 },
  sectionTitle: {
    color: "#8e8e93",
    fontSize: 15,
    fontWeight: "600",
    paddingHorizontal: 32,
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
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
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
  rowText: { flex: 1, gap: 3 },
  title: { color: "#ffffff", fontSize: 16 },
  italic: { fontStyle: "italic" },
  meta: { color: "#8e8e93", fontSize: 13 },
  excerpt: { color: "#c7c7cc", fontSize: 13 },
});
