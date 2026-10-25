import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { RemoteProject, RemoteSnapshot } from "@/lib/remoteSnapshot";
import {
  act,
  hostConfigured,
  useRemoteView,
  type Status,
} from "~/remote/connection";
import { AccountChip, BadgeDot } from "~/ui/status-dots";

const STATUS_TEXT: Record<Status, string> = {
  connecting: "Connexion à Arkadia…",
  open: "PC connecté",
  lost: "Connexion perdue, nouvelle tentative…",
};

/** Every project in the sidebar's order, with its tabs and their badges. */
export function ProjectsScreen() {
  const { status, snapshot } = useRemoteView();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <View style={styles.status}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: status === "open" ? "#30d158" : "#8e8e93" },
          ]}
        />
        <Text style={styles.statusText}>
          {hostConfigured()
            ? STATUS_TEXT[status]
            : "Adresse du PC manquante dans la configuration"}
        </Text>
      </View>
      {snapshot && <ProjectSections snapshot={snapshot} />}
    </ScrollView>
  );
}

function ProjectSections({ snapshot }: { snapshot: RemoteSnapshot }) {
  return (
    <>
      {snapshot.active.length > 0 && (
        <Section title="Actifs" projects={snapshot.active} />
      )}
      {snapshot.groups.map((g, i) => (
        <Section
          key={`${g.name ?? ""}-${i}`}
          title={g.name}
          projects={g.projects}
        />
      ))}
    </>
  );
}

function Section({
  title,
  projects,
}: {
  title: string | null;
  projects: RemoteProject[];
}) {
  return (
    <View style={styles.section}>
      {title && <Text style={styles.sectionTitle}>{title}</Text>}
      {projects.map((p) => (
        <ProjectGroup key={p.id} project={p} />
      ))}
    </View>
  );
}

async function openNewTab(project: RemoteProject) {
  try {
    const { tabId } = await act({ kind: "newTab", projectId: project.id });
    if (tabId) router.push({ pathname: "/tab/[id]", params: { id: tabId } });
  } catch (e) {
    Alert.alert(
      "Nouvel onglet impossible",
      e instanceof Error ? e.message : String(e),
    );
  }
}

function ProjectGroup({ project }: { project: RemoteProject }) {
  return (
    <View style={styles.group}>
      <View style={styles.row}>
        <View style={[styles.projectDot, { backgroundColor: project.color }]} />
        <Text
          style={[styles.projectName, project.tabs.length === 0 && styles.idle]}
          numberOfLines={1}
        >
          {project.name}
        </Text>
        <Pressable
          accessibilityLabel={`Nouvel onglet dans ${project.name}`}
          hitSlop={10}
          onPress={() => void openNewTab(project)}
        >
          <SymbolView name="plus" size={20} tintColor="#0a84ff" />
        </Pressable>
      </View>
      {project.tabs.map((t) => (
        <Pressable
          key={t.id}
          onPress={() =>
            router.push({ pathname: "/tab/[id]", params: { id: t.id } })
          }
          style={({ pressed }) => [
            styles.row,
            styles.tabRow,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.separator} />
          <Text style={styles.tabTitle} numberOfLines={1}>
            {t.title}
          </Text>
          <AccountChip account={t.account} />
          {t.panes.length > 1 && (
            <Text style={styles.paneCount}>{t.panes.length}</Text>
          )}
          <BadgeDot badge={t.badge} />
          <SymbolView name="chevron.right" size={13} tintColor="#5a5a5e" />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: "#8e8e93", fontSize: 13 },
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
    marginBottom: 12,
    borderRadius: 24,
    backgroundColor: "#1c1c1e",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 16,
  },
  tabRow: { paddingLeft: 38 },
  pressed: { backgroundColor: "#2c2c2e" },
  separator: {
    position: "absolute",
    top: 0,
    left: 38,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#38383a",
  },
  projectDot: { width: 10, height: 10, borderRadius: 5 },
  projectName: { flex: 1, color: "#ffffff", fontSize: 17, fontWeight: "600" },
  idle: { color: "#8e8e93", fontWeight: "500" },
  tabTitle: { flex: 1, color: "#ffffff", fontSize: 15 },
  paneCount: { color: "#8e8e93", fontSize: 12 },
});
