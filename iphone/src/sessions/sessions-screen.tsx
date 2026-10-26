import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  groupByDayThenProject,
  type DayProject,
  type SessionDay,
} from "@/lib/sessionsByDay";
import {
  filterByMeta,
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
import { allProjects } from "~/remote/snapshot";

/** Rows drawn at once: the full history runs into the thousands. */
const MAX_ROWS = 200;
/** Typing pause before searching inside the conversations (a full scan). */
const SEARCH_DELAY_MS = 400;
/** A folder that is no project of the desktop. */
const NO_PROJECT_COLOR = "#8e8e93";

/** « 21:42 »: the day is the section's. */
function timeOf(mtime: number): string {
  const d = new Date(mtime);
  return (
    `${d.getHours()}`.padStart(2, "0") +
    ":" +
    `${d.getMinutes()}`.padStart(2, "0")
  );
}

interface DaySection {
  key: string;
  day: SessionDay;
  data: DayProject[];
}

/**
 * Past Claude sessions, newest first: one section per day, its title held at
 * the top while its projects pass by, and a time line down each day that
 * every project hangs on (choice B of 25/10/2026). Searchable by title,
 * folder and content like the web page. Tapping one resumes it in a new tab
 * of its project.
 */
export function SessionsScreen() {
  const { status, snapshot } = useRemoteView();
  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SessionMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  // Day titles and times are relative to when the list was loaded.
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

  const sections = useMemo((): DaySection[] => {
    if (!sessions) return [];
    const listed: ListedSession[] = query.trim()
      ? mergeSearchResults(sessions, filterByMeta(sessions, query), matches)
      : sessions;
    return groupByDayThenProject(listed.slice(0, MAX_ROWS), now).map((day) => ({
      key: String(day.day),
      day,
      data: day.projects,
    }));
  }, [sessions, query, matches, now]);

  // A session's folder carries the color of the desktop project of that name.
  const colors = useMemo(() => {
    const byName = new Map<string, string>();
    if (snapshot)
      for (const p of allProjects(snapshot)) byName.set(p.name, p.color);
    return byName;
  }, [snapshot]);

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
          // An opaque bar of fixed height, so the day title held at the top
          // stays right under the search field (under a large title or a
          // see-through bar it would slide behind it).
          headerLargeTitleEnabled: false,
          headerTransparent: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: "#000000" },
          headerSearchBarOptions: {
            placeholder: "Chercher dans les conversations",
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            hideWhenScrolling: false,
            // Over the black screen the default field is black too.
            barTintColor: "#2c2c2e",
            textColor: "#ffffff",
            tintColor: "#0a84ff",
          },
        }}
      />
      <SectionList
        sections={sections}
        keyExtractor={(project) => project.name}
        stickySectionHeadersEnabled
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <>
            {!sessions && (
              <Text style={styles.note}>
                {failed ? "Liste indisponible." : "Chargement…"}
              </Text>
            )}
            {searching && (
              <Text style={styles.note}>Recherche dans les conversations…</Text>
            )}
            {sessions && sections.length === 0 && !searching && (
              <Text style={styles.note}>Aucune session.</Text>
            )}
          </>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHead}>
            <View style={styles.lineBelowKnob} />
            <View style={styles.knob} />
            <Text style={styles.dayLabel}>{section.day.label}</Text>
            {section.day.label !== section.day.date && (
              <Text style={styles.dayDate}>{section.day.date}</Text>
            )}
          </View>
        )}
        renderItem={({ item: project, index, section }) => {
          const last = index === section.data.length - 1;
          return (
            <View style={[styles.hang, last && styles.hangLast]}>
              <View style={[styles.line, last && styles.lineLast]} />
              <View
                style={[
                  styles.hook,
                  {
                    backgroundColor:
                      colors.get(project.name) ?? NO_PROJECT_COLOR,
                  },
                ]}
              />
              <View style={styles.card}>
                <View style={styles.projectHead}>
                  <Text style={styles.projectName} numberOfLines={1}>
                    {project.name}
                  </Text>
                  <Text style={styles.projectCount}>
                    {project.sessions.length}
                  </Text>
                </View>
                {project.sessions.map((s) => (
                  <Pressable
                    key={s.id}
                    disabled={resuming !== null}
                    onPress={() => void resume(s)}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.separator} />
                    <View style={styles.rowText}>
                      <Text
                        style={[styles.title, s.from_prompt && styles.italic]}
                        numberOfLines={2}
                      >
                        {s.title}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {timeOf(s.mtime)}
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
          );
        }}
      />
    </>
  );
}

/** The time line's axis, from the screen's left edge. */
const AXIS_X = 22;
const LINE_WIDTH = 2;
const KNOB = 16;
const HOOK = 10;
/** Black ring that detaches a dot from the line. */
const RING = 3;

const styles = StyleSheet.create({
  content: { paddingBottom: 40 },
  note: { color: "#8e8e93", fontSize: 15, textAlign: "center", padding: 20 },
  // Opaque: held at the top, the cards pass under it.
  dayHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: AXIS_X - KNOB / 2,
    paddingRight: 20,
    paddingTop: 16,
    paddingBottom: 10,
    backgroundColor: "#000000",
  },
  lineBelowKnob: {
    position: "absolute",
    left: AXIS_X - LINE_WIDTH / 2,
    width: LINE_WIDTH,
    top: "50%",
    bottom: 0,
    backgroundColor: "#3a3a3c",
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: "#ffffff",
  },
  dayLabel: { color: "#ffffff", fontSize: 22, fontWeight: "700" },
  dayDate: { flexShrink: 1, color: "#8e8e93", fontSize: 15 },
  hang: { paddingLeft: AXIS_X + 12, paddingRight: 16, paddingBottom: 10 },
  hangLast: { paddingBottom: 6 },
  line: {
    position: "absolute",
    left: AXIS_X - LINE_WIDTH / 2,
    width: LINE_WIDTH,
    top: 0,
    bottom: 0,
    backgroundColor: "#3a3a3c",
  },
  // The line stops at the day's last card.
  lineLast: { bottom: 18 },
  hook: {
    position: "absolute",
    left: AXIS_X - HOOK / 2 - RING,
    top: 16,
    width: HOOK + 2 * RING,
    height: HOOK + 2 * RING,
    borderRadius: HOOK / 2 + RING,
    borderWidth: RING,
    borderColor: "#000000",
  },
  card: {
    borderRadius: 22,
    backgroundColor: "#1c1c1e",
    overflow: "hidden",
  },
  projectHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  projectName: { flex: 1, color: "#ffffff", fontSize: 17, fontWeight: "600" },
  projectCount: { color: "#8e8e93", fontSize: 13 },
  // Indented under the project's name: its sessions stem from it.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 30,
    paddingRight: 16,
    paddingVertical: 11,
  },
  pressed: { backgroundColor: "#2c2c2e" },
  separator: {
    position: "absolute",
    top: 0,
    left: 30,
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
